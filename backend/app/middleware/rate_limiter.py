"""
Rate limiter — fixed one-minute windows per client.

Auth endpoints get a tight budget (password guessing), everything else a
generous one. Uses Redis when REDIS_URL answers so several API instances share
one budget; otherwise an in-process dictionary, which is correct for a single
container and honest about being per-process.
"""

import logging
import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import settings

log = logging.getLogger("brief.rate_limiter")


class _MemoryBackend:
    def __init__(self):
        self._hits: dict[str, tuple[int, int]] = defaultdict(lambda: (0, 0))  # key -> (window, count)

    async def hit(self, key: str, window: int) -> int:
        w, c = self._hits[key]
        if w != window:
            w, c = window, 0
        c += 1
        self._hits[key] = (w, c)
        if len(self._hits) > 50_000:  # keep memory bounded on a long-lived process
            stale = [k for k, (kw, _) in self._hits.items() if kw != window]
            for k in stale:
                del self._hits[k]
        return c

    async def peek(self, key: str, window: int) -> int:
        w, c = self._hits.get(key, (0, 0))
        return c if w == window else 0

    async def reset(self, key: str, window: int) -> None:
        self._hits.pop(key, None)


class _RedisBackend:
    def __init__(self, client):
        self._r = client

    async def hit(self, key: str, window: int) -> int:
        rkey = f"brief:rl:{key}:{window}"
        pipe = self._r.pipeline()
        pipe.incr(rkey)
        pipe.expire(rkey, max(90, settings.LOGIN_LOCKOUT_MINUTES * 60 + 30))
        count, _ = await pipe.execute()
        return int(count)

    async def peek(self, key: str, window: int) -> int:
        value = await self._r.get(f"brief:rl:{key}:{window}")
        return int(value or 0)

    async def reset(self, key: str, window: int) -> None:
        await self._r.delete(f"brief:rl:{key}:{window}")


async def make_backend():
    if not settings.REDIS_URL:
        log.info("rate limiter: in-memory backend (REDIS_URL unset)")
        return _MemoryBackend()
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
        await client.ping()
        log.info("rate limiter: redis backend")
        return _RedisBackend(client)
    except Exception as exc:
        log.info("rate limiter: in-memory backend (%s)", type(exc).__name__)
        return _MemoryBackend()


# One shared backend for the process. Starlette instantiates middleware itself,
# so the lifespan configures this holder rather than an instance.
_holder: dict = {"backend": _MemoryBackend()}


async def configure_backend() -> None:
    _holder["backend"] = await make_backend()


def current_backend():
    """The shared counter store — also used by the login lockout."""
    return _holder["backend"]


class RateLimitMiddleware(BaseHTTPMiddleware):
    @property
    def backend(self):
        return _holder["backend"]

    @backend.setter
    def backend(self, value):
        _holder["backend"] = value

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or request.method == "OPTIONS":
            return await call_next(request)

        client = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
            request.client.host if request.client else "unknown"
        )
        is_auth = path.startswith("/api/auth/")
        limit = settings.RATE_LIMIT_AUTH if is_auth else settings.RATE_LIMIT_API
        window = int(time.time() // 60)
        try:
            count = await self.backend.hit(f"{'auth' if is_auth else 'api'}:{client}", window)
        except Exception:  # a limiter outage must not take the API down
            self.backend = _MemoryBackend()
            count = await self.backend.hit(f"{'auth' if is_auth else 'api'}:{client}", window)

        if count > limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. The network is busy; try again in a minute."},
                headers={"Retry-After": str(60 - int(time.time()) % 60)},
            )
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
        return response

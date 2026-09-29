"""
Login lockout (Directive v2.1 §1.2).

After MAX_LOGIN_ATTEMPTS failed logins for one account — or from one client
address — inside a LOGIN_LOCKOUT_MINUTES window, further attempts are refused
with 429 until the window rolls over. Counters live in the same backend as the
rate limiter (Redis when available, otherwise in-process), so a cluster shares
one view of an attacker.

Failures count per account *and* per client so neither a distributed guess on
one handle nor one client spraying many handles slips under the limit.
"""

import time

from fastapi import HTTPException

from app.config import settings
from app.middleware.rate_limiter import current_backend


def _window() -> int:
    return int(time.time() // (settings.LOGIN_LOCKOUT_MINUTES * 60))


def _retry_after() -> int:
    span = settings.LOGIN_LOCKOUT_MINUTES * 60
    return span - int(time.time()) % span


def _keys(identifier: str, client: str) -> list[str]:
    return [f"login:acct:{identifier.lower()}", f"login:ip:{client}"]


async def assert_not_locked(identifier: str, client: str) -> None:
    backend = current_backend()
    window = _window()
    for key in _keys(identifier, client):
        try:
            count = await backend.peek(key, window)
        except Exception:  # limiter outage must not block logins
            return
        if count >= settings.MAX_LOGIN_ATTEMPTS:
            retry = _retry_after()
            raise HTTPException(
                429,
                f"Too many failed login attempts. Try again in {max(1, retry // 60)} minute(s).",
                headers={"Retry-After": str(retry)},
            )


async def record_failure(identifier: str, client: str) -> int:
    """Count one failed attempt; returns attempts remaining for the account."""
    backend = current_backend()
    window = _window()
    acct = 0
    for key in _keys(identifier, client):
        try:
            count = await backend.hit(key, window)
        except Exception:
            return settings.MAX_LOGIN_ATTEMPTS
        if key.startswith("login:acct:"):
            acct = count
    return max(0, settings.MAX_LOGIN_ATTEMPTS - acct)


async def clear(identifier: str, client: str) -> None:
    """A successful login forgives earlier typos for that account."""
    backend = current_backend()
    window = _window()
    try:
        await backend.reset(f"login:acct:{identifier.lower()}", window)
    except Exception:
        pass

"""
Login lockout (Directive v2.1 §1.2).

After MAX_LOGIN_ATTEMPTS failed logins for one account — or from one client
address — inside a LOGIN_LOCKOUT_MINUTES window, further attempts are refused
with 429 until the window rolls over. Counters live in the same backend as the
rate limiter (Redis when available, otherwise in-process), so a cluster shares
one view of an attacker.

Failures count per account *and* per client, but the two budgets are not the
same number and must not be. Five wrong guesses at one password is a person
having a bad morning; five wrong guesses from one *address* is nothing at all,
because on a mobile network the address is a carrier's NAT shared by thousands
of subscribers. Treating those alike means a stranger's typos sign a market out
of its own accounts — which is exactly what it did.

So: a tight budget per account, a loose one per address, and a successful
login forgives both. The address budget still exists, because one host
spraying many handles is an attack and should meet a wall — it is just a wall
far away from where a person stands.
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


def _keys(identifier: str, client: str) -> list[tuple[str, int]]:
    """Each counter with the budget it is judged against."""
    return [
        (f"login:acct:{identifier.lower()}", settings.MAX_LOGIN_ATTEMPTS),
        (f"login:ip:{client}", settings.MAX_LOGIN_ATTEMPTS_PER_IP),
    ]


async def assert_not_locked(identifier: str, client: str) -> None:
    backend = current_backend()
    window = _window()
    for key, limit in _keys(identifier, client):
        try:
            count = await backend.peek(key, window)
        except Exception:  # limiter outage must not block logins
            return
        if count >= limit:
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
    for key, _limit in _keys(identifier, client):
        try:
            count = await backend.hit(key, window)
        except Exception:
            return settings.MAX_LOGIN_ATTEMPTS
        if key.startswith("login:acct:"):
            acct = count
    return max(0, settings.MAX_LOGIN_ATTEMPTS - acct)


async def clear(identifier: str, client: str) -> None:
    """A successful login forgives earlier typos — for the account *and* for the
    address.

    Forgiving only the account was the subtler half of the same bug: once an
    address had tripped its counter, even a correct password could not clear
    it, so the whole NAT stayed signed out until the window rolled over. The
    person whose password is right should always be able to get in."""
    backend = current_backend()
    window = _window()
    for key, _limit in _keys(identifier, client):
        try:
            await backend.reset(key, window)
        except Exception:
            pass

"""The login lockout must punish the right party.

The bug these specs pin, verbatim from a phone in Kisumu:

    5 wrong passwords, typed by *anyone*, behind one mobile carrier's NAT
    → the next person on that address with the *correct* password gets 429
    → they assume their account is broken and register a new one.

Kenyan mobile data is CGNAT: thousands of subscribers share one public IPv4, so
"one client address" is a neighbourhood, not a person. An account budget of
five is right. An address budget of five is a denial of service we inflict on
ourselves.
"""

import uuid

import pytest


def _handle(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:6]}"


async def _register(client, handle: str, password: str = "Correct-horse-9") -> dict:
    response = await client.post(
        "/api/auth/register",
        json={
            "business_name": f"{handle} Traders",
            "vendor_handle": handle,
            "email": f"{handle}@example.com",
            "password": password,
            "city": "Kisumu",
            "country": "Kenya",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _login(client, handle: str, password: str, client_ip: str):
    return await client.post(
        "/api/auth/login",
        data={"username": handle, "password": password},
        headers={"X-Forwarded-For": client_ip},
    )


async def test_a_strangers_typos_do_not_sign_out_a_neighbourhood(client):
    """The reported failure: other people's wrong passwords, one shared address."""
    victim = await _register(client, _handle("victim"))
    shared_ip = "41.90.64.201"

    for i in range(5):
        r = await _login(client, _handle(f"stranger{i}"), "Not-my-pass-1", shared_ip)
        assert r.status_code == 401, r.text

    # Same address, correct password. This is the line that used to say 429.
    r = await _login(client, victim["vendor_handle"], "Correct-horse-9", shared_ip)
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]


async def test_one_account_still_gets_five_tries_and_no_more(client):
    """The protection that matters is untouched: guessing one password stops."""
    victim = await _register(client, _handle("guessed"))
    ip = "41.90.64.202"

    for attempt in range(1, 6):
        r = await _login(client, victim["vendor_handle"], "Wrong-pass-1", ip)
        assert r.status_code == (401 if attempt < 5 else 429), (attempt, r.text)

    r = await _login(client, victim["vendor_handle"], "Correct-horse-9", ip)
    assert r.status_code == 429
    assert r.headers.get("retry-after")


async def test_a_correct_password_on_another_account_still_works_from_that_address(client):
    """A locked account must not take its neighbours down with it."""
    locked = await _register(client, _handle("locked"))
    neighbour = await _register(client, _handle("neighbour"))
    ip = "41.90.64.203"

    for _ in range(5):
        await _login(client, locked["vendor_handle"], "Wrong-pass-1", ip)

    assert (await _login(client, locked["vendor_handle"], "Correct-horse-9", ip)).status_code == 429
    assert (await _login(client, neighbour["vendor_handle"], "Correct-horse-9", ip)).status_code == 200


async def test_signing_in_forgives_the_address_too(client):
    """A successful login clears the shared counter, not just the account one.

    Without this, an address that tripped earlier keeps refusing everyone —
    including people whose password is right — until the window rolls over.
    """
    good = await _register(client, _handle("good"))
    ip = "41.90.64.204"

    for i in range(5):
        await _login(client, _handle(f"typo{i}"), "Wrong-pass-1", ip)

    # The counter is below the address ceiling, so this succeeds — and clears it.
    assert (await _login(client, good["vendor_handle"], "Correct-horse-9", ip)).status_code == 200

    from app.services import login_guard

    backend = login_guard.current_backend()
    window = login_guard._window()
    remaining = await backend.peek(f"login:ip:{ip}", window)
    assert remaining == 0, f"address counter should be forgiven, still at {remaining}"


async def test_a_spray_from_one_host_does_meet_a_wall(client):
    """The address budget is loose, not absent: it still stops a machine."""
    from app.config import settings
    from app.services import login_guard

    ip = "41.90.64.205"
    backend = login_guard.current_backend()
    window = login_guard._window()
    for _ in range(settings.MAX_LOGIN_ATTEMPTS_PER_IP):
        await backend.hit(f"login:ip:{ip}", window)

    r = await _login(client, _handle("anyone"), "Wrong-pass-1", ip)
    assert r.status_code == 429
    assert r.headers.get("retry-after")

"""v2.15 — the security boundary, data-subject rights, and the Morning Brief.

Pins the four things the audit said were missing (2026-10-25):

    · operations surfaces are for operators, not for any signed-in vendor
    · metrics are closed in production without a token
    · a member can take their own data out and close their own account
    · the Morning Brief is read-only, vendor-scoped, and cites its records
"""

import uuid
from datetime import date, datetime, timedelta

import pytest

from app.config import settings as live_settings

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _vendor(client, suffix):
    handle = f"tb_{suffix}"
    r = await client.post("/api/auth/register", json={
        "account_kind": "person",
        "display_name": f"T B {suffix}",
        "business_name": f"T B {suffix}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["produce"],
        "physical_location": "Kisumu",
    })
    assert r.status_code == 201, r.text
    return handle, {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["vendor_id"]


# --- authorization: operations surfaces -------------------------------------------------

async def test_a_plain_vendor_cannot_read_operations(client, monkeypatch):
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "somebody_else")
    _, headers, _ = await _vendor(client, "plain_ops")

    for path in ("/api/ops/status", "/api/ops/slow", "/api/ops/jobs"):
        r = await client.get(path, headers=headers)
        assert r.status_code == 403, f"{path} -> {r.status_code}"
        assert "operator" in r.json()["detail"].lower()


async def test_an_operator_reaches_operations(client, monkeypatch):
    handle, headers, _ = await _vendor(client, "operator")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", handle)

    r = await client.get("/api/ops/status", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["environment"]["operator_gate"] is True
    # The payment mode is stated, so "mock in production" can never be silent.
    assert set(r.json()["payments"]) == {"provider", "available", "reason"}


async def test_operator_list_fails_closed(client, monkeypatch):
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "")
    _, headers, _ = await _vendor(client, "no_ops")
    assert (await client.get("/api/ops/status", headers=headers)).status_code == 403


async def test_unauthenticated_operations_still_401(client):
    assert (await client.get("/api/ops/status")).status_code == 401


# --- configuration policy ---------------------------------------------------------------

def test_production_turns_off_schema_autocreate():
    from app.config import Settings

    base = dict(DATABASE_URL=live_settings.DATABASE_URL, SECRET_KEY="a" * 64)
    prod = Settings(ENVIRONMENT="production", **base)
    assert prod.AUTO_CREATE_TABLES is True
    assert prod.auto_create_tables is False          # policy, not the raw flag

    opted_in = Settings(ENVIRONMENT="production", ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION=True, **base)
    assert opted_in.auto_create_tables is True


def test_payments_available_is_false_for_mock_in_production():
    from app.config import Settings

    base = dict(DATABASE_URL=live_settings.DATABASE_URL, SECRET_KEY="a" * 64)
    assert Settings(ENVIRONMENT="development", **base).payments_available is True
    assert Settings(ENVIRONMENT="production", **base).payments_available is False
    half = Settings(ENVIRONMENT="production", PSP_PROVIDER="intasend",
                    PSP_WEBHOOK_SECRET="b" * 64, **base)   # keys still unset
    assert half.payments_available is False
    ready = Settings(ENVIRONMENT="production", PSP_PROVIDER="intasend",
                     PSP_WEBHOOK_SECRET="b" * 64, PSP_API_KEY="k", PSP_API_SECRET="s", **base)
    assert ready.payments_available is True


# --- data-subject rights ----------------------------------------------------------------

async def test_export_contains_only_my_records(client):
    handle, headers, _ = await _vendor(client, "exporter")
    _, other_headers, _ = await _vendor(client, "other")

    await client.post("/api/stock/add", json={
        "name": "My Sukuma", "category": "produce", "price": 30, "quantity": 40, "unit": "bunch",
    }, headers=headers)
    await client.post("/api/stock/add", json={
        "name": "Their Sukuma", "category": "produce", "price": 30, "quantity": 40, "unit": "bunch",
    }, headers=other_headers)

    r = await client.get("/api/vendors/me/export", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["account"]["vendor_handle"] == handle
    names = [item["name"] for item in body["stock_items"]]
    assert "My Sukuma" in names
    assert "Their Sukuma" not in names
    assert body["chat"]["messages_sent"] == []


async def test_export_needs_a_token(client):
    assert (await client.get("/api/vendors/me/export")).status_code == 401


async def test_closing_an_account_requires_the_handle(client):
    _, headers, _ = await _vendor(client, "closer")
    r = await client.post("/api/vendors/me/close", json={"confirmation": "wrong_handle"}, headers=headers)
    assert r.status_code == 400
    assert "cannot be undone" in r.json()["detail"]


async def test_closing_an_account_erases_identity_and_blocks_sign_in(client):
    handle, headers, _ = await _vendor(client, "gone")
    r = await client.post("/api/vendors/me/close", json={"confirmation": handle}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["closed"] is True

    # The old credentials no longer work...
    login = await client.post("/api/auth/login", data={"username": f"{handle}@example.com", "password": PASSWORD})
    assert login.status_code == 401
    login = await client.post("/api/auth/login", data={"username": handle, "password": PASSWORD})
    assert login.status_code == 401

    # ...the old token cannot resurrect the account...
    assert (await client.get("/api/vendors/me", headers=headers)).status_code == 401

    # ...and the handle is free again, while the record itself still exists.
    again = await client.post("/api/auth/register", json={
        "account_kind": "person", "display_name": "New Person", "business_name": "New Person",
        "vendor_handle": handle, "email": f"{handle}@example.com", "password": PASSWORD,
    })
    assert again.status_code == 201, again.text


# --- the Morning Brief ------------------------------------------------------------------

async def test_brief_is_empty_and_honest_for_a_new_account(client):
    """A brand-new account owns nothing, so no signal may cite it.

    Network-wide open requests are allowed to appear (that is the point of the
    signal), so the assertion is scoped to the record types this account owns.
    """
    _, headers, _ = await _vendor(client, "empty")
    r = await client.get("/api/brief/morning", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    mine = {"low_stock", "pending_movements", "expiring_claims"}
    assert not [s for s in body["signals"] if s["kind"] in mine], body
    assert all(s["record_ids"] for s in body["signals"])


async def test_brief_cites_only_my_records(client):
    handle, headers, _ = await _vendor(client, "briefed")
    _, other_headers, _ = await _vendor(client, "bystander")

    mine = await client.post("/api/stock/add", json={
        "name": "Low item", "category": "produce", "price": 30, "quantity": 1, "unit": "bunch",
    }, headers=headers)
    theirs = await client.post("/api/stock/add", json={
        "name": "Their low item", "category": "produce", "price": 30, "quantity": 1, "unit": "bunch",
    }, headers=other_headers)
    my_id = mine.json()["stock_id"]

    r = await client.get("/api/brief/morning", headers=headers)
    body = r.json()
    low = next(s for s in body["signals"] if s["kind"] == "low_stock")
    assert my_id in low["record_ids"]
    assert theirs.json()["stock_id"] not in low["record_ids"]
    assert low["route"] == "/stock"
    assert body["vendor_handle"] == handle
    # Every signal is traceable: kind, severity, a route and a source time.
    for signal in body["signals"]:
        assert signal["record_ids"], signal
        assert signal["severity"] in ("critical", "warning", "info")
        assert signal["route"].startswith("/")
        assert "generated" not in signal["title"].lower()


async def test_brief_flags_expiring_paperwork(client):
    handle, headers, vendor_id = await _vendor(client, "claims")
    # A verified claim whose printed expiry is three days away.
    r = await client.post("/api/passport/claims", headers=headers, data={
        "claim_key": "kra_pin",
        "reference": "P051234567X",
        "issued_on": (date.today() - timedelta(days=300)).isoformat(),
        "expires_on": (date.today() + timedelta(days=3)).isoformat(),
    })
    assert r.status_code == 201, r.text

    r = await client.get("/api/brief/morning", headers=headers)
    body = r.json()
    kinds = {s["kind"] for s in body["signals"]}
    assert "expiring_claims" in kinds, body


async def test_brief_needs_a_token(client):
    assert (await client.get("/api/brief/morning")).status_code == 401

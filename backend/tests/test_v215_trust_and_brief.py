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
from app.database import async_session

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


# --- measurement: definitions travel with the numbers ---------------------------------

async def test_measurement_is_operator_only(client, monkeypatch):
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "somebody_else")
    _, headers, _ = await _vendor(client, "meas_plain")
    r = await client.get("/api/ops/measurement", headers=headers)
    assert r.status_code == 403
    assert (await client.get("/api/ops/measurement")).status_code == 401


async def test_measurement_states_its_definitions_and_refuses_to_guess(client, monkeypatch):
    handle, headers, _ = await _vendor(client, "meas_op")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", handle)

    # Give this vendor a real activation signal, so the funnel is not all zeroes.
    await client.post("/api/stock/add", json={
        "name": "Managu", "category": "produce", "price": 20, "quantity": 4, "unit": "bunch",
    }, headers=headers)

    r = await client.get("/api/ops/measurement?days=30", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()

    funnel = body["funnel"]
    assert funnel["registered"] >= 1
    assert funnel["activated"] >= 1
    # A rate can never exceed 1; if it does, the denominator is wrong.
    assert 0.0 <= funnel["activation_rate"] <= 1.0
    assert 0.0 <= funnel["repeat_rate"] <= 1.0
    assert 0.0 <= body["commerce"]["completion_rate"] <= 1.0

    # Every headline number ships with the rule that produced it.
    assert set(body["definitions"]) >= {"registered", "activated", "repeated", "completion_rate"}
    # And what cannot be measured is named, not estimated.
    unmeasured = {item["metric"] for item in body["not_measured"]}
    assert {"cost_per_vendor", "brief_opens", "revenue"} <= unmeasured
    for item in body["not_measured"]:
        assert item["reason"].strip()


async def test_measurement_window_is_bounded(client, monkeypatch):
    handle, headers, _ = await _vendor(client, "meas_window")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", handle)
    assert (await client.get("/api/ops/measurement?days=0", headers=headers)).status_code == 422
    assert (await client.get("/api/ops/measurement?days=3650", headers=headers)).status_code == 422


# --- receivables: money owed on a delivered order --------------------------------

async def _delivered_unpaid_order(client, supplier, buyer):
    """A real movement, delivered and received, with no payment against it."""
    import uuid as _uuid

    stock = await client.post("/api/stock/add", headers=supplier, json={
        "name": "Receivable tomatoes", "sku": f"REC-{_uuid.uuid4().hex[:6]}",
        "category": "produce", "quantity_in_stock": 10, "unit_of_measure": "crate",
        "unit_price": 1500,
    })
    assert stock.status_code == 201, stock.text
    stock_id = stock.json()["stock_id"]
    sourced = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 2})
    assert sourced.status_code == 201, sourced.text
    movement_id = sourced.json()["movement_id"]

    from tests.order_helpers import complete_self_pickup
    await complete_self_pickup(client, movement_id, supplier, buyer)
    return movement_id


async def test_delivered_unpaid_order_appears_as_a_receivable(client):
    _, supplier, _ = await _vendor(client, "recv_sup")
    _, buyer, _ = await _vendor(client, "recv_buy")
    movement_id = await _delivered_unpaid_order(client, supplier, buyer)

    brief = (await client.get("/api/brief/morning", headers=supplier)).json()
    signal = next((s for s in brief["signals"] if s["kind"] == "receivables"), None)
    assert signal is not None, brief
    assert signal["title"] == "Money to follow up"
    # The citation is the movement the vendor actually supplied.
    assert movement_id in signal["record_ids"]
    assert signal["route"] == "/orders"

    # The buyer is not owed anything by themselves.
    buyer_brief = (await client.get("/api/brief/morning", headers=buyer)).json()
    assert not any(s["kind"] == "receivables" and movement_id in s["record_ids"]
                   for s in buyer_brief["signals"])


async def test_a_settled_payment_clears_the_receivable(client):
    from app.database import async_session
    from app.models.payments import PaymentIntent
    from sqlalchemy import select
    import uuid as _uuid

    _, supplier, _ = await _vendor(client, "recv_sup2")
    _, buyer, buyer_id = await _vendor(client, "recv_buy2")
    movement_id = await _delivered_unpaid_order(client, supplier, buyer)

    before = (await client.get("/api/brief/morning", headers=supplier)).json()
    assert any(s["kind"] == "receivables" for s in before["signals"])

    async with async_session() as db:
        db.add(PaymentIntent(
            id=_uuid.uuid4(), vendor_id=_uuid.UUID(buyer_id),
            entity_type="stock_movement_payment", entity_id=_uuid.UUID(movement_id),
            amount_ksh=3000, provider="MPESA", phone="254700000001",
            target_psp_sub="TRADE", psp_api_ref=f"REC-{_uuid.uuid4().hex[:8]}",
            status="completed",
        ))
        await db.commit()

    after = (await client.get("/api/brief/morning", headers=supplier)).json()
    leftovers = [s for s in after["signals"] if s["kind"] == "receivables"]
    assert not any(movement_id in s["record_ids"] for s in leftovers), after


# --- tenant isolation on every v2.15 surface -----------------------------------
# The release gate asks for "role checks plus tenant scoping" with positive *and*
# negative access tests. These are the negative half for the new endpoints.

async def test_one_vendor_cannot_read_another_vendors_records(client):
    _, alice, alice_id = await _vendor(client, "iso_alice")
    _, bob, _ = await _vendor(client, "iso_bob")

    await client.post("/api/stock/add", json={
        "name": "Alice's sukuma", "category": "produce", "price": 30, "quantity": 9, "unit": "bunch",
    }, headers=alice)

    # The brief is scoped by the token: Bob's brief cannot cite Alice's stock.
    # `open_requests` is network-wide by design, so compare only the signals that
    # are built from the vendor's own records.
    OWNED = {"low_stock", "receivables", "pending_movements", "expiring_claims"}
    alice_brief = (await client.get("/api/brief/morning", headers=alice)).json()
    alice_ids = {rid for s in alice_brief["signals"] if s["kind"] in OWNED for rid in s["record_ids"]}
    bob_brief = (await client.get("/api/brief/morning", headers=bob)).json()
    bob_ids = {rid for s in bob_brief["signals"] if s["kind"] in OWNED for rid in s["record_ids"]}
    assert alice_ids
    assert not (alice_ids & bob_ids), "the brief leaked another vendor's record ids"

    # The export is mine, not the network's.
    alice_export = (await client.get("/api/vendors/me/export", headers=alice)).json()
    bob_export = (await client.get("/api/vendors/me/export", headers=bob)).json()
    alice_stock = {row["id"] for row in alice_export.get("stock_items", [])}
    bob_stock = {row["id"] for row in bob_export.get("stock_items", [])}
    assert alice_stock
    assert not (alice_stock & bob_stock)

    # A payment intent belonging to someone else is a 404, not a 403 with detail.
    import uuid as _uuid
    other_intent = _uuid.uuid4()
    async with async_session() as db:
        from app.models.payments import PaymentIntent
        db.add(PaymentIntent(
            id=other_intent, vendor_id=_uuid.UUID(str(alice_id)),
            entity_type="chama_deposit", entity_id=_uuid.uuid4(), amount_ksh=500,
            provider="MPESA", phone="254700000009", target_psp_sub="CHAMA_X",
            psp_api_ref=f"ISO-{_uuid.uuid4().hex[:8]}", status="pending",
        ))
        await db.commit()

    # Alice can read her own; Bob cannot read Alice's.
    assert (await client.get(f"/api/payments/intents/{other_intent}", headers=alice)).status_code == 200
    assert (await client.get(f"/api/payments/intents/{other_intent}", headers=bob)).status_code == 404


async def test_billing_and_measurement_never_cross_tenants(client, monkeypatch):
    handle, alice, _ = await _vendor(client, "iso_bill_alice")
    _, bob, _ = await _vendor(client, "iso_bill_bob")

    await client.post("/api/billing/subscribe", json={"plan_tier": "readiness"}, headers=alice)
    alice_billing = (await client.get("/api/billing/me", headers=alice)).json()
    bob_billing = (await client.get("/api/billing/me", headers=bob)).json()

    assert alice_billing["subscription"]["id"] != (bob_billing["subscription"] or {}).get("id")
    assert bob_billing["subscription"] is None
    assert {i["id"] for i in alice_billing["invoices"]}.isdisjoint({i["id"] for i in bob_billing["invoices"]})

    # Measurement is operator-only and aggregate; a plain vendor gets nothing.
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "somebody_else")
    assert (await client.get("/api/ops/measurement", headers=bob)).status_code == 403

"""v2.12 — Inverted pyramid growth planner, hard-coded business rules, 5-gear
resources motion, server-side plan entitlements and six-month rollout gates.

Covers every launch acceptance criterion:

    1. A valid movement progresses through every permitted state.
    2. An invalid transition is rejected by the backend.
    3. Retrying a received event cannot debit or credit inventory twice.
    4. Failed background jobs recover without duplicating side effects.
    5. Business Pulse matches database records across all 5 motion gears.
    6. Collective demand cannot bypass MOQ, authorization or order validation.
    7. Expired compliance claims disappear from public verified views & pulse.
    8. Payment confirmation and physical delivery remain independent states,
       and simulated/mock payments are blocked in production.
    9. Disabling the six-month program stops new experimental launches (409)
       without deleting records or blocking outstanding obligations.
   10. Paid plans enforce server-side seat & watch entitlements and never
       automatically confer verification.
"""

import uuid
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.config import settings
from app.database import async_session
from app.models.stock import StockItem, StockMovement, StockReservation
from app.modules.standing import sweep as standing_sweep
from app.modules.standing.models import BusinessClaim
from app.platform import event_outbox
from app.services import psp_client, stock_engine
from tests.order_helpers import complete_self_pickup

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, prefix="grw", categories=None, phone="254712345678"):
    suffix = uuid.uuid4().hex[:8]
    handle = f"{prefix}_{suffix}"
    res = await client.post("/api/auth/register", json={
        "business_name": f"Business {suffix[:4]}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "phone": phone,
        "password": PASSWORD,
        "business_categories": categories or ["produce", "packaging"],
        "physical_location": "Kisumu Market",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    return body, {"Authorization": f"Bearer {body['access_token']}"}, handle


async def _add_stock(client, headers, **overrides):
    payload = {
        "name": overrides.get("name", "Grade A Maize"),
        "sku": overrides.get("sku", f"SKU-{uuid.uuid4().hex[:6]}"),
        "category": overrides.get("category", "produce"),
        "quantity_in_stock": overrides.get("quantity_in_stock", 50),
        "unit_of_measure": overrides.get("unit_of_measure", "bag"),
        "unit_price": overrides.get("unit_price", 3200),
        "wholesale_price": overrides.get("wholesale_price", 3000),
        "min_order_quantity": overrides.get("min_order_quantity", 2),
        "visible_to_network": overrides.get("visible_to_network", True),
    }
    res = await client.post("/api/stock/add", headers=headers, json=payload)
    assert res.status_code == 201, res.text
    return res.json()["stock_id"]


# ── 1 & 2 & 3. Movement progression, invalid transitions & idempotent receipt ─

async def test_movement_valid_progression_invalid_transitions_and_idempotent_receipt(client):
    _, supplier, _ = await _register(client, "supp")
    _, buyer, _ = await _register(client, "buyr")
    sku = f"IDEMP-{uuid.uuid4().hex[:6]}"
    stock_id = await _add_stock(client, supplier, sku=sku, quantity_in_stock=30, min_order_quantity=2)

    # Create pending movement (reserves 5 bags)
    src = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 5})
    assert src.status_code == 201, src.text
    movement_id = src.json()["movement_id"]
    assert src.json()["status"] == "pending"

    # Invalid transitions from `pending`: cannot ship or receive before confirm
    ship_early = await client.post(f"/api/stock/movements/{movement_id}/ship", headers=supplier)
    assert ship_early.status_code == 400
    recv_early = await client.post(f"/api/stock/movements/{movement_id}/receive", headers=buyer)
    assert recv_early.status_code == 400
    # Buyer cannot confirm supplier's movement
    wrong_actor = await client.post(f"/api/stock/movements/{movement_id}/confirm", headers=buyer)
    assert wrong_actor.status_code == 403

    # Walk valid progression: pending -> confirmed -> pickup ready -> quote selected -> shipped -> received
    done = await complete_self_pickup(client, movement_id, supplier, buyer)
    assert done["status"] == "received"

    # Check supplier and buyer shelves after first receipt
    supp_shelf = (await client.get(f"/api/stock/{stock_id}", headers=supplier)).json()
    assert supp_shelf["quantity_in_stock"] == 25
    assert supp_shelf["quantity_reserved"] == 0
    assert supp_shelf["quantity_available"] == 25

    buyer_shelf = (await client.get("/api/stock/my-stock", headers=buyer)).json()
    transferred = next(i for i in buyer_shelf if i["sku"] == sku)
    assert transferred["quantity_in_stock"] == 5

    # Retrying receipt via HTTP is rejected and does not alter shelves
    retry_http = await client.post(
        f"/api/orders/{movement_id}/receive",
        headers=supplier,
        json={"receipt_code": "000000"},
    )
    assert retry_http.status_code == 400

    # Retrying `_settle_receipt` directly in a worker/retry scenario is a safe no-op
    async with async_session() as db:
        m = await db.get(StockMovement, uuid.UUID(movement_id))
        item = await db.get(StockItem, uuid.UUID(stock_id))
        await stock_engine._settle_receipt(db, m, item)
        await db.commit()

    supp_shelf_after = (await client.get(f"/api/stock/{stock_id}", headers=supplier)).json()
    assert supp_shelf_after["quantity_in_stock"] == 25
    buyer_shelf_after = (await client.get("/api/stock/my-stock", headers=buyer)).json()
    transferred_after = next(i for i in buyer_shelf_after if i["sku"] == sku)
    assert transferred_after["quantity_in_stock"] == 5


# ── 4. Failed background jobs recover without duplicating side effects ────────

async def test_background_jobs_recover_idempotently(client):
    _, supplier, _ = await _register(client, "wk_supp")
    _, buyer, _ = await _register(client, "wk_buyr")
    stock_id = await _add_stock(client, supplier, quantity_in_stock=20, min_order_quantity=1)

    # 1. Hold expiry recovery: running expire_stale_holds twice after a failure
    # releases the reservation only once and sends one cancellation notice per side.
    src = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 4})
    mid = uuid.UUID(src.json()["movement_id"])
    async with async_session() as db:
        await db.execute(
            update(StockReservation)
            .where(StockReservation.movement_id == mid)
            .values(hold_expires_at=datetime.utcnow() - timedelta(minutes=5))
        )
        await db.commit()
        first_expired = await stock_engine.expire_stale_holds(db)
        await db.commit()
        second_expired = await stock_engine.expire_stale_holds(db)
        await db.commit()

    assert first_expired == 1
    assert second_expired == 0
    shelf = (await client.get(f"/api/stock/{stock_id}", headers=supplier)).json()
    assert shelf["quantity_in_stock"] == 20 and shelf["quantity_reserved"] == 0

    # 2. Standing expiry reminder recovery: running remind_expiring twice for the
    # same window only notifies once because `reminded_windows` records the window.
    soon = (date.today() + timedelta(days=10)).isoformat()
    claim_res = await client.post(
        "/api/passport/claims",
        data={"claim_key": "tax_compliance", "reference": "TCC-WK-1", "expires_on": soon},
        headers=supplier,
    )
    assert claim_res.status_code == 201
    async with async_session() as db:
        first_reminded = await standing_sweep.remind_expiring(db)
        second_reminded = await standing_sweep.remind_expiring(db)
    assert first_reminded >= 1
    assert second_reminded == 0

    # 3. Transactional outbox drain recovery: draining twice processes each event once.
    await event_outbox.drain(async_session)
    second_drain = await event_outbox.drain(async_session)
    assert second_drain == 0


# ── 5. Business Pulse & Blueprint match database records ─────────────────────

async def test_business_pulse_and_blueprint_match_database_records(client, monkeypatch):
    _, supplier, supp_handle = await _register(client, "pulse_s")
    _, buyer, _ = await _register(client, "pulse_b")
    _, verifier, ver_handle = await _register(client, "pulse_v")
    monkeypatch.setattr(settings, "VERIFIER_HANDLES", ver_handle)

    # Add 2 visible items and 1 hidden item
    s1 = await _add_stock(client, supplier, name="Visible Beans", quantity_in_stock=40, visible_to_network=True)
    await _add_stock(client, supplier, name="Visible Rice", quantity_in_stock=25, visible_to_network=True)
    await _add_stock(client, supplier, name="Private Stock", quantity_in_stock=10, visible_to_network=False)

    # Connect supplier and buyer
    buyer_me = (await client.get("/api/vendors/me", headers=buyer)).json()
    conn_res = await client.post(f"/api/vendors/connect/{buyer_me['id']}", headers=supplier)
    assert conn_res.status_code in (200, 201)

    # Create 1 completed movement and 1 open movement
    m_done = (await client.post(f"/api/stock/{s1}/source", headers=buyer, json={"quantity": 4})).json()["movement_id"]
    await complete_self_pickup(client, m_done, supplier, buyer)
    m_open = (await client.post(f"/api/stock/{s1}/source", headers=buyer, json={"quantity": 2})).json()["movement_id"]
    assert m_open

    # Add 1 verified claim and 1 documented claim
    c1 = (await client.post(
        "/api/passport/claims",
        data={"claim_key": "kra_pin", "reference": "P051234567A"},
        headers=supplier,
    )).json()
    await client.post(
        f"/api/passport/claims/{c1['id']}/verify",
        data={"method": "registry_check", "note": "Verified KRA PIN"},
        headers=verifier,
    )
    await client.post(
        "/api/passport/claims",
        data={"claim_key": "county_permit", "reference": "KSM-2026-99"},
        headers=supplier,
    )

    # Add 1 standing watch
    w_res = await client.post("/api/requests/watches", headers=supplier, json={"keywords": "maize"})
    assert w_res.status_code == 201

    pulse_res = await client.get("/api/growth/pulse", headers=supplier)
    assert pulse_res.status_code == 200, pulse_res.text
    data = pulse_res.json()
    p = data["pulse"]

    assert p["visible_listings"] == 2
    assert p["total_listings"] == 3
    assert p["open_trades"] == 1
    assert p["completed_movements"] == 1
    assert p["supplier_links"] == 1
    assert p["fulfillment_rate"] == 100.0
    assert p["fulfillment_mark"]["key"] == "rising"  # 1 completed movement (< 3 for Level 1)
    assert p["verified_claims"] == 1
    assert p["documented_claims"] == 1
    assert p["active_watches"] == 1

    blueprint = (await client.get("/api/growth/blueprint", headers=supplier)).json()
    assert len(blueprint["inverted_pyramid"]) == 4
    assert blueprint["inverted_pyramid"][0]["active"] is True
    assert blueprint["inverted_pyramid"][1]["active"] is True
    assert len(blueprint["plans"]) == 4
    assert len(blueprint["hard_coded_rules"]) == 6
    assert len(blueprint["six_month_rollout"]) == 6
    assert len(blueprint["acceptance_gates"]) == 9


# ── 6. Collective demand cannot bypass MOQ, authorization or order validation ─

async def test_collective_demand_enforces_moq_authorization_and_order_sequence(client):
    _, organiser, _ = await _register(client, "col_org")
    _, member, _ = await _register(client, "col_mem")

    grp = await client.post("/api/groups/create", headers=organiser, json={
        "name": f"Sourcing Pool {uuid.uuid4().hex[:4]}",
        "group_type": "sourcing",
    })
    group_id = grp.json()["group_id"]
    await client.post(f"/api/groups/{group_id}/join", headers=member)

    req = await client.post("/api/collective/create", headers=organiser, json={
        "group_id": group_id,
        "item_name": "Cooking Oil 20L Jerrycans",
        "target_quantity": 20,
        "target_price_per_unit": 4200,
        "unit_of_measure": "jerrycan",
    })
    assert req.status_code == 201
    cid = req.json()["collective_id"]

    # Partial pledge (10 of 20) — below target MOQ
    await client.post(f"/api/collective/{cid}/pledge", headers=member, json={"pledged_quantity": 10})

    # Organiser CANNOT bypass MOQ to move to negotiating, ordered or fulfilled
    for forbidden_status in ("quota_met", "negotiating", "ordered", "fulfilled"):
        res = await client.post(f"/api/collective/{cid}/status", headers=organiser, params={"status": forbidden_status})
        assert res.status_code == 400, (forbidden_status, res.text)
        assert "target MOQ" in res.json()["detail"]

    # Non-organiser cannot change status even after meeting MOQ
    await client.post(f"/api/collective/{cid}/pledge", headers=organiser, json={"pledged_quantity": 10})
    unauth = await client.post(f"/api/collective/{cid}/status", headers=member, params={"status": "ordered"})
    assert unauth.status_code == 403

    # Cannot jump straight from `quota_met` to `fulfilled` without `ordered` first
    skip_order = await client.post(f"/api/collective/{cid}/status", headers=organiser, params={"status": "fulfilled"})
    assert skip_order.status_code == 400
    assert "must be ordered before" in skip_order.json()["detail"]

    # Valid sequence: quota_met -> negotiating -> ordered -> fulfilled
    assert (await client.post(f"/api/collective/{cid}/status", headers=organiser, params={"status": "negotiating"})).status_code == 200
    assert (await client.post(f"/api/collective/{cid}/status", headers=organiser, params={"status": "ordered"})).status_code == 200
    assert (await client.post(f"/api/collective/{cid}/status", headers=organiser, params={"status": "fulfilled"})).status_code == 200


# ── 7. Expired compliance claims disappear from public verified views & pulse ─

async def test_expired_claims_disappear_from_public_views_and_pulse(client, monkeypatch):
    _, owner, owner_handle = await _register(client, "exp_own")
    _, viewer, _ = await _register(client, "exp_vw")
    _, verifier, ver_handle = await _register(client, "exp_ver")
    monkeypatch.setattr(settings, "VERIFIER_HANDLES", ver_handle)

    future_date = (date.today() + timedelta(days=30)).isoformat()
    claim = (await client.post(
        "/api/passport/claims",
        data={"claim_key": "tax_compliance", "reference": "TCC-EXP-99", "expires_on": future_date},
        headers=owner,
    )).json()
    ver = await client.post(
        f"/api/passport/claims/{claim['id']}/verify",
        data={"method": "registry_check", "note": "Valid TCC", "expires_on": future_date},
        headers=verifier,
    )
    assert ver.status_code == 200

    # Public passport shows 1 verified fact while current
    pub_before = (await client.get(f"/api/passport/{owner_handle}", headers=viewer)).json()
    assert len(pub_before["facts"]) == 1

    # Move expiry date into the past
    past_date = date.today() - timedelta(days=2)
    async with async_session() as db:
        await db.execute(
            update(BusinessClaim)
            .where(BusinessClaim.id == uuid.UUID(claim["id"]))
            .values(expires_on=past_date)
        )
        await db.commit()

    # Immediately disappears from public passport and from live Business Pulse verified count
    pub_after = (await client.get(f"/api/passport/{owner_handle}", headers=viewer)).json()
    assert pub_after["facts"] == []
    assert pub_after["counts"]["verified"] == 0

    pulse_after = (await client.get("/api/growth/pulse", headers=owner)).json()["pulse"]
    assert pulse_after["verified_claims"] == 0
    assert pulse_after["expired_claims"] == 1


# ── 8. Payment & delivery independence + no simulated payments in production ──

async def test_payment_and_delivery_independence_and_production_psp_guard(client, monkeypatch):
    # 1. Production environment blocks mock/simulated PSP
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "PSP_PROVIDER", "mock")
    with pytest.raises(psp_client.PSPError, match="forbidden in production"):
        psp_client.get_psp_client()
    with pytest.raises(psp_client.PSPError, match="forbidden in production"):
        psp_client.mock_psp()

    monkeypatch.setattr(settings, "ENVIRONMENT", "development")

    # 2. Completing a physical delivery does NOT fabricate a paid PaymentIntent
    _, supplier, _ = await _register(client, "pay_supp")
    _, buyer, _ = await _register(client, "pay_buyr")
    stock_id = await _add_stock(client, supplier, quantity_in_stock=15, min_order_quantity=1)
    src = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 2})
    movement_id = src.json()["movement_id"]

    await complete_self_pickup(client, movement_id, supplier, buyer)
    order_detail = (await client.get(f"/api/orders/{movement_id}", headers=buyer)).json()
    assert order_detail["status"] == "received"
    assert order_detail["payment"]["status"] == "unpaid"


# ── 9 & 10. Entitlements, verification guardrail & six-month motion shutdown ──

async def test_plan_entitlements_verification_guardrail_and_motion_shutdown(client, monkeypatch):
    _, vendor_tok, vendor_handle = await _register(client, "plan_v")
    _, buyer_tok, _ = await _register(client, "plan_b")

    # Starter tier has 1 seat (the owner) -> adding a second seat is refused (403)
    seat_fail = await client.post("/api/growth/seats", headers=vendor_tok, json={
        "member_email": "finance@shop.co.ke",
        "role": "finance",
    })
    assert seat_fail.status_code == 403
    assert "Upgrade your plan" in seat_fail.json()["detail"]

    # Upgrade to Readiness (3 seats, 25 watches) — must NOT grant is_verified!
    plan_res = await client.put("/api/growth/plan", headers=vendor_tok, json={"plan_tier": "readiness"})
    assert plan_res.status_code == 200, plan_res.text
    ent = plan_res.json()
    assert ent["tier"] == "readiness"
    assert ent["max_seats"] == 3
    assert ent["max_watches"] == 25

    me = (await client.get("/api/vendors/me", headers=vendor_tok)).json()
    assert me["plan_tier"] == "readiness"
    assert me["is_verified"] is False  # Paid plan never confers verification

    watches_info = (await client.get("/api/requests/watches", headers=vendor_tok)).json()
    assert watches_info["limit"] == 25

    # Now adding 2 team seats succeeds (total 3 seats used), 4th fails
    s1 = await client.post("/api/growth/seats", headers=vendor_tok, json={
        "member_email": "finance@shop.co.ke",
        "role": "finance",
    })
    assert s1.status_code == 201
    assert s1.json()["seats_used"] == 2

    s2 = await client.post("/api/growth/seats", headers=vendor_tok, json={
        "member_email": "clerk@shop.co.ke",
        "role": "clerk",
    })
    assert s2.status_code == 201
    assert s2.json()["seats_used"] == 3

    s3 = await client.post("/api/growth/seats", headers=vendor_tok, json={
        "member_email": "extra@shop.co.ke",
        "role": "clerk",
    })
    assert s3.status_code == 403

    # Start an in-flight movement BEFORE shutting down the six-month program
    stock_id = await _add_stock(client, vendor_tok, quantity_in_stock=20, min_order_quantity=1)
    inflight = (await client.post(f"/api/stock/{stock_id}/source", headers=buyer_tok, json={"quantity": 3})).json()
    movement_id = inflight["movement_id"]

    # Disable the six-month experimental program window
    monkeypatch.setattr(settings, "SIX_MONTH_PROGRAM_ENABLED", False)

    # New experimental plan upgrades and new collective buys are stopped (409)
    blocked_plan = await client.put("/api/growth/plan", headers=vendor_tok, json={"plan_tier": "network"})
    assert blocked_plan.status_code == 409
    assert "six-month rollout window is closed" in blocked_plan.json()["detail"]

    grp = await client.post("/api/groups/create", headers=vendor_tok, json={
        "name": f"Shutdown Group {uuid.uuid4().hex[:4]}",
        "group_type": "sourcing",
    })
    blocked_col = await client.post("/api/collective/create", headers=vendor_tok, json={
        "group_id": grp.json()["group_id"],
        "item_name": "Sugar 50kg",
        "target_quantity": 10,
    })
    assert blocked_col.status_code == 409

    # Existing records, Business Pulse, and in-flight movement obligations continue uninterrupted!
    pulse = await client.get("/api/growth/pulse", headers=vendor_tok)
    assert pulse.status_code == 200
    assert pulse.json()["program_status"]["active"] is False
    assert pulse.json()["program_status"]["preserve_existing_records"] is True

    completed = await complete_self_pickup(client, movement_id, vendor_tok, buyer_tok)
    assert completed["status"] == "received"


# ── 11. Fulfilment marks enforce exact sample-size and rate thresholds ────────

async def test_fulfilment_mark_sample_size_thresholds(client):
    from app.models.vendor import Vendor

    v = Vendor(business_name="Threshold Test", vendor_handle="thresh", email="t@example.com", password_hash="x")
    v.movements_completed = 0
    v.movements_cancelled = 0
    assert stock_engine.fulfillment_mark(v)["key"] == "new"

    # 2 completed at 100% is still `rising` because sample size < 3
    v.movements_completed = 2
    v.movements_cancelled = 0
    assert stock_engine.fulfillment_mark(v)["key"] == "rising"

    # 3 completed at 100% reaches `l1` (Level 1: >=3 & >=70%)
    v.movements_completed = 3
    v.movements_cancelled = 1  # 75% across 4 movements (3 completed)
    assert stock_engine.fulfillment_mark(v)["key"] == "l1"

    # 10 completed at 90.9% reaches `l2` (Level 2: >=10 & >=85%)
    v.movements_completed = 10
    v.movements_cancelled = 1
    assert stock_engine.fulfillment_mark(v)["key"] == "l2"

    # 19 completed at 100% stays `l2` until sample size reaches 20
    v.movements_completed = 19
    v.movements_cancelled = 0
    assert stock_engine.fulfillment_mark(v)["key"] == "l2"

    # 20 completed at 95.2% reaches `top` (Top supplier: >=20 & >=95%)
    v.movements_completed = 20
    v.movements_cancelled = 1
    assert stock_engine.fulfillment_mark(v)["key"] == "top"


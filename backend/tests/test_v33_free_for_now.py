"""v3.3 — free for now.

What these prove, with the product defaults (no paywall, billing closed, fees off):
- every feature is open to every account, and the server says so;
- nobody can start a paid subscription or buy a plan through the public endpoint;
- membership: profiles, verification requests, operator decisions, suspension,
  a directory that respects privacy, and a full audit trail;
- fees: the schedule says nothing is charged, and no fee is ever recorded;
- group logistics: create, join, leave, route, schedule, delivery status and
  the transition rules, with participants seeing detail and outsiders not.
"""

import uuid

import pytest
from sqlalchemy import select, update

from app.config import settings as live_settings
from app.database import async_session
from app.models.vendor import Vendor
from app.modules.fees.models import FeeRecord, FeeRule
from app.modules.fees.service import compute_fee

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


@pytest.fixture(autouse=True)
def _free_defaults(monkeypatch):
    monkeypatch.setattr(live_settings, "FREE_FOR_NOW", True)
    monkeypatch.setattr(live_settings, "BILLING_ENABLED", False)
    monkeypatch.setattr(live_settings, "FEES_ENABLED", False)


async def _vendor(client, suffix):
    handle = f"free_{suffix}"
    r = await client.post("/api/auth/register", json={
        "account_kind": "business",
        "display_name": f"Free {suffix}",
        "business_name": f"Free {suffix} Ltd",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["produce"],
    })
    assert r.status_code == 201, r.text
    return handle, {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["vendor_id"]


async def _operator(client, monkeypatch, suffix):
    handle, headers, vid = await _vendor(client, suffix)
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", handle)
    return handle, headers, vid


# ---------- entitlements and billing -------------------------------------------------

async def test_every_feature_is_unlocked_for_a_free_account(client):
    _, headers, _ = await _vendor(client, "ent")
    rows = (await client.get("/api/entitlements/me", headers=headers)).json()
    features = rows["features"] if isinstance(rows, dict) else rows
    assert features and all(f["unlocked"] for f in features if f["enabled"])


async def test_premium_analytics_open_to_a_free_vendor(client):
    _, headers, _ = await _vendor(client, "anal")
    r = await client.get("/api/analytics/price-position", headers=headers)
    assert r.status_code == 200, r.text


async def test_new_paid_subscription_is_refused_while_billing_is_closed(client):
    _, headers, _ = await _vendor(client, "sub")
    r = await client.post("/api/billing/subscribe", json={"plan_tier": "growth"}, headers=headers)
    assert r.status_code == 403
    assert "not open yet" in r.text


async def test_public_plan_change_to_paid_is_refused(client):
    _, headers, _ = await _vendor(client, "plan")
    r = await client.put("/api/growth/plan", headers=headers, json={"plan_tier": "business_pro"})
    assert r.status_code == 403
    assert "free for now" in r.text.lower()


async def test_existing_paid_subscription_keeps_working_when_billing_is_closed(client):
    """Stop new charges, keep existing customers. A subscriber's benefits are unchanged."""
    _, headers, vid = await _vendor(client, "keep")
    async with async_session() as db:
        await db.execute(update(Vendor).where(Vendor.id == uuid.UUID(str(vid))).values(plan_tier="growth"))
        await db.commit()
    me = (await client.get("/api/billing/me", headers=headers))
    assert me.status_code == 200
    ent = (await client.get("/api/entitlements/me", headers=headers)).json()
    assert ent["tier"] == "growth"


# ---------- membership ---------------------------------------------------------------

async def test_new_member_is_not_in_the_directory_until_they_opt_in(client):
    handle, headers, _ = await _vendor(client, "dir")
    me = (await client.get("/api/membership/me", headers=headers)).json()
    assert me["directory_visible"] is False
    assert me["fees"] == "none"
    resp = await client.get("/api/membership/directory", params={"q": "Free dir"}, headers=headers)
    assert resp.status_code == 200, resp.text
    listed = resp.json()
    assert handle not in [m["handle"] for m in listed]


async def test_opt_in_puts_member_in_directory_without_private_fields(client):
    handle, headers, _ = await _vendor(client, "optin")
    r = await client.put("/api/membership/me", headers=headers, json={
        "directory_visible": True, "category": "artisan", "professional_class": "Plumber",
        "bio": "Pipes and pumps in Kisumu",
    })
    assert r.status_code == 200, r.text
    listed = (await client.get("/api/membership/directory", params={"category": "artisan"}, headers=headers)).json()
    hit = [m for m in listed if m["handle"] == handle]
    assert hit and hit[0]["professional_class"] == "Plumber"
    assert "contact_phone" not in hit[0]  # contact stays private unless show_contact is on


async def test_unknown_category_is_refused_and_protected_fields_are_ignored(client):
    _, headers, _ = await _vendor(client, "bad")
    assert (await client.put("/api/membership/me", headers=headers,
                             json={"category": "spaceship"})).status_code == 400
    # Fields outside the member's list are ignored, never applied.
    assert (await client.put("/api/membership/me", headers=headers,
                             json={"verification_status": "verified"})).status_code == 200
    me = (await client.get("/api/membership/me", headers=headers)).json()
    assert me["verification_status"] == "unverified" and me["verified"] is False


async def test_verification_request_then_operator_approves_and_audits(client, monkeypatch):
    op, op_headers, _ = await _operator(client, monkeypatch, "vop")
    handle, headers, vid = await _vendor(client, "vreq")
    assert (await client.post("/api/membership/me/verification", headers=headers)).status_code == 201
    assert (await client.post("/api/membership/me/verification", headers=headers)).status_code == 409
    queue = (await client.get("/api/membership/admin/queue", params={"status": "pending"},
                              headers=op_headers)).json()
    assert handle in [q["handle"] for q in queue]
    r = await client.post(f"/api/membership/admin/{vid}/verification", headers=op_headers,
                          json={"decision": "approve", "note": "ID checked"})
    assert r.status_code == 200, r.text
    me = (await client.get("/api/membership/me", headers=headers)).json()
    assert me["verified"] is True and me["verified_at"]
    events = (await client.get("/api/membership/me/events", headers=headers)).json()
    actions = [e["action"] for e in events]
    assert "verification_requested" in actions and "verification_approved" in actions
    approved = [e for e in events if e["action"] == "verification_approved"][0]
    assert approved["actor"] == op and approved["note"] == "ID checked"


async def test_suspension_hides_member_and_blocks_edits(client, monkeypatch):
    _, op_headers, _ = await _operator(client, monkeypatch, "sop")
    handle, headers, vid = await _vendor(client, "susp")
    await client.put("/api/membership/me", headers=headers, json={"directory_visible": True})
    r = await client.post(f"/api/membership/admin/{vid}/status", headers=op_headers,
                          json={"status": "suspended", "note": "complaints"})
    assert r.status_code == 200
    listed = (await client.get("/api/membership/directory", headers=headers)).json()
    assert handle not in [m["handle"] for m in listed]
    edit = await client.put("/api/membership/me", headers=headers, json={"bio": "back"})
    assert edit.status_code == 403
    back = await client.post(f"/api/membership/admin/{vid}/status", headers=op_headers,
                             json={"status": "active"})
    assert back.status_code == 200
    actions = [e["action"] for e in (await client.get(f"/api/membership/admin/{vid}/events",
                                                      headers=op_headers)).json()]
    assert "membership_suspended" in actions and "membership_reinstated" in actions


async def test_membership_admin_is_operator_only(client, monkeypatch):
    _, headers, vid = await _vendor(client, "notop")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "someone_else")
    r = await client.post(f"/api/membership/admin/{vid}/verification", headers=headers,
                          json={"decision": "approve"})
    assert r.status_code == 403


# ---------- fees ---------------------------------------------------------------------

async def test_fee_schedule_says_nothing_is_charged(client):
    _, headers, _ = await _vendor(client, "feesched")
    resp = await client.get("/api/fees/schedule", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["fees_live"] is False
    assert "No fees are being charged" in data["message"]
    assert data["rules"] and all(r["enabled"] is False for r in data["rules"])
    assert all(r["charging_now"] is False for r in data["rules"])
    assert all(r["amount_kes"] == 0 and r["rate_bps"] == 0 for r in data["rules"])


async def test_fee_calculation_is_zero_when_disabled_and_percent_is_capped():
    off = FeeRule(key="x", label="x", basis="bps", amount_kes=0, rate_bps=500, enabled=False)
    on = FeeRule(key="y", label="y", basis="bps", amount_kes=0, rate_bps=500, enabled=True)
    flat = FeeRule(key="z", label="z", basis="flat", amount_kes=50, rate_bps=0, enabled=True)
    assert compute_fee(off, 10_000) == 0
    assert compute_fee(on, 10_000) == 500  # 5%
    assert compute_fee(flat, 0) == 50
    assert compute_fee(None, 10_000) == 0


async def test_no_fee_is_ever_recorded_while_free(client, monkeypatch):
    # Even with the deployment fee switch on, FREE_FOR_NOW keeps fees at zero.
    monkeypatch.setattr(live_settings, "FEES_ENABLED", True)
    from app.modules.fees import service as fees
    async with async_session() as db:
        await fees.ensure_rules(db)
        row = await db.get(FeeRule, "logistics_coordination")
        row.enabled = True
        row.rate_bps = 300
        await db.commit()
        fee = await fees.fee_for(db, "logistics_coordination", base_amount_kes=10_000,
                                 subject_type="group_order", subject_id="t")
        await db.commit()
    assert fee == 0
    async with async_session() as db:
        rows = (await db.execute(select(FeeRecord).where(FeeRecord.subject_id == "t"))).scalars().all()
    assert rows == []


async def test_fee_rule_changes_are_operator_only(client, monkeypatch):
    _, headers, _ = await _vendor(client, "feeuser")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "nobody_here")
    r = await client.put("/api/fees/admin/bulk_pool", headers=headers, json={"enabled": True})
    assert r.status_code == 403


# ---------- group logistics ----------------------------------------------------------

async def test_group_order_full_flow(client, monkeypatch):
    org_h, org, org_vid = await _operator(client, monkeypatch, "org")  # operator can also schedule
    _, buyer, _ = await _vendor(client, "buyer")
    _, outsider, _ = await _vendor(client, "outside")

    order = await client.post("/api/logistics/orders", headers=org, json={
        "title": "Cement bulk buy", "item_summary": "10 bags", "delivery_point": "Kisumu market"})
    assert order.status_code == 201, order.text
    oid = order.json()["id"]
    assert order.json()["my_role"] == "organiser"

    joined = await client.post(f"/api/logistics/orders/{oid}/join", headers=buyer,
                               json={"quantity_note": "3 bags"})
    assert joined.status_code == 200 and joined.json()["participant_count"] == 2
    assert (await client.post(f"/api/logistics/orders/{oid}/join", headers=buyer)).status_code == 409

    # outsider sees it in the open list but not its participant detail
    assert oid in [o["id"] for o in (await client.get("/api/logistics/orders/open", headers=outsider)).json()]
    detail = (await client.get(f"/api/logistics/orders/{oid}", headers=buyer)).json()
    assert {p["handle"] for p in detail["participants"]} >= {org_h}
    assert (await client.get(f"/api/logistics/orders/{oid}", headers=outsider)).status_code == 200

    route = await client.post(f"/api/logistics/orders/{oid}/route", headers=org, json={
        "stops": [{"label": "far", "lat": -0.10, "lng": 34.90},
                  {"label": "near", "lat": -0.09, "lng": 34.76}],
        "start_lat": -0.09, "start_lng": 34.75})
    assert route.status_code == 200, route.text
    assert route.json()["algorithm"]
    assert (await client.post(f"/api/logistics/orders/{oid}/route", headers=buyer,
                              json={"stops": [{"label": "a", "lat": 0, "lng": 0}]})).status_code == 403

    # cannot schedule without a provider
    provider = await client.post("/api/logistics/providers", headers=org,
                                 json={"name": "Lake Runners", "contact": "via chat", "service_area": "Kisumu"})
    assert provider.status_code == 201
    pid = provider.json()["id"]
    sched = {"provider_id": pid, "window_start": "2026-11-10T09:00:00", "window_end": "2026-11-10T12:00:00"}
    sched_ok = await client.post(f"/api/logistics/orders/{oid}/schedule", headers=org, json=sched)
    assert sched_ok.status_code == 200, sched_ok.text
    assert (await client.post(f"/api/logistics/orders/{oid}/schedule", headers=buyer, json=sched)).status_code == 403

    # status moves must follow the rules
    assert (await client.post(f"/api/logistics/orders/{oid}/status", headers=org,
                              json={"status": "scheduled"})).status_code == 409  # still open
    assert (await client.post(f"/api/logistics/orders/{oid}/status", headers=org,
                              json={"status": "locked"})).status_code == 200
    assert (await client.post(f"/api/logistics/orders/{oid}/status", headers=org,
                              json={"status": "scheduled"})).status_code == 200
    assert (await client.post(f"/api/logistics/orders/{oid}/status", headers=org,
                              json={"status": "delivered"})).status_code == 409  # skips in_transit
    for step in ("in_transit", "delivered"):
        assert (await client.post(f"/api/logistics/orders/{oid}/status", headers=org,
                                  json={"status": step})).status_code == 200

    events = (await client.get(f"/api/logistics/orders/{oid}", headers=org)).json()["events"]
    actions = [e["action"] for e in events]
    assert "joined" in actions and "route_planned" in actions and "status_delivered" in actions


async def test_leave_only_while_open_and_organiser_cannot_leave(client):
    _, org, _ = await _vendor(client, "lorg")
    _, buyer, _ = await _vendor(client, "lbuy")
    oid = (await client.post("/api/logistics/orders", headers=org, json={"title": "Sugar split"})).json()["id"]
    await client.post(f"/api/logistics/orders/{oid}/join", headers=buyer)
    assert (await client.post(f"/api/logistics/orders/{oid}/leave", headers=buyer)).status_code == 200
    assert (await client.post(f"/api/logistics/orders/{oid}/leave", headers=org)).status_code == 409


async def test_cancelled_order_is_final(client):
    _, org, _ = await _vendor(client, "cxl")
    oid = (await client.post("/api/logistics/orders", headers=org, json={"title": "Cancel me"})).json()["id"]
    assert (await client.post(f"/api/logistics/orders/{oid}/status", headers=org,
                              json={"status": "cancelled"})).status_code == 200
    assert (await client.post(f"/api/logistics/orders/{oid}/status", headers=org,
                              json={"status": "open"})).status_code == 409
    assert (await client.post(f"/api/logistics/orders/{oid}/join", headers=org)).status_code == 409


async def test_logistics_admin_list_is_operator_only(client, monkeypatch):
    _, headers, _ = await _vendor(client, "lo")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "nobody_here")
    assert (await client.get("/api/logistics/admin/orders", headers=headers)).status_code == 403


async def test_billing_overview_says_sales_are_closed(client):
    """The billing page reads these flags instead of guessing: free for now, no sales."""
    _, headers, _ = await _vendor(client, "flags")
    body = (await client.get("/api/billing/me", headers=headers)).json()
    assert body["free_for_now"] is True
    assert body["sales_open"] is False

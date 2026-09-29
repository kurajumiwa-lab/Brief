"""
Directive v2.1 surface: auth hardening, notifications, quality verification,
alternatives, holds, the chat deal protocol, SRM-lite, collective sourcing,
courier shipments, event check-in and file uploads.
"""

import io
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.database import async_session
from app.models.stock import StockReservation
from app.services import stock_engine

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, handle: str, categories: list[str], role: str = "both") -> tuple[dict, dict]:
    suffix = uuid.uuid4().hex[:6]
    r = await client.post("/api/auth/register", json={
        "business_name": handle.replace("_", " ").title(), "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com", "password": PASSWORD,
        "business_categories": categories, "physical_location": "Nairobi",
    })
    assert r.status_code == 201, r.text
    tok = r.json()
    headers = {"Authorization": f"Bearer {tok['access_token']}"}
    if role != "both":
        await client.post(f"/api/vendors/switch-role/{role}", headers=headers)
    return tok, headers


async def _add_stock(client, headers, **overrides) -> str:
    body = {"name": "Tomatoes (crate)", "sku": f"TOM-{uuid.uuid4().hex[:4]}", "category": "fresh produce",
            "quantity_in_stock": 40, "unit_of_measure": "crate", "wholesale_price": 3000, "unit_price": 3500,
            "min_order_quantity": 1, "visible_to_network": True}
    body.update(overrides)
    r = await client.post("/api/stock/add", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()["stock_id"]


async def _notifications(client, headers, **params) -> dict:
    r = await client.get("/api/notifications", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _types(payload: dict) -> list[str]:
    return [n["type"] for n in payload["notifications"]]


# --- auth ------------------------------------------------------------------------------

async def test_password_policy_refresh_and_lockout(client):
    weak = {"business_name": "Weak", "vendor_handle": f"weak_{uuid.uuid4().hex[:6]}",
            "email": f"weak_{uuid.uuid4().hex[:6]}@example.com", "password": "alllowercase1"}
    r = await client.post("/api/auth/register", json=weak)
    assert r.status_code == 400 and "uppercase" in r.json()["detail"]

    tok, headers = await _register(client, "refresher", ["textiles"])
    assert tok["refresh_token"]
    r = await client.post("/api/auth/refresh", json={"refresh_token": tok["refresh_token"]})
    assert r.status_code == 200, r.text
    renewed = r.json()
    assert renewed["access_token"] and renewed["vendor_id"] == tok["vendor_id"]
    # an access token is not a refresh token
    r = await client.post("/api/auth/refresh", json={"refresh_token": tok["access_token"]})
    assert r.status_code == 401

    # lockout at MAX_LOGIN_ATTEMPTS wrong passwords — the right one no longer helps
    for attempt in range(1, 6):
        r = await client.post("/api/auth/login", data={"username": tok["vendor_handle"], "password": "Wrong-pass-1"})
        assert r.status_code == (401 if attempt < 5 else 429), (attempt, r.text)
    r = await client.post("/api/auth/login", data={"username": tok["vendor_handle"], "password": PASSWORD})
    assert r.status_code == 429 and r.headers.get("retry-after")


# --- notifications + stock quality + alternatives ---------------------------------------------

async def test_verification_alternatives_and_notifications(client):
    _, seller = await _register(client, "grower", ["fresh produce"], "selling")
    _, buyer = await _register(client, "eatery", ["food service"], "sourcing")
    r = await client.get("/api/vendors/me", headers=seller)
    seller_id = r.json()["id"]

    # vendors cannot self-award patron verification; lab certification needs a spec sheet
    r = await client.post("/api/stock/add", headers=seller, json={"name": "Kale", "quality_status": "patron_verified"})
    assert r.status_code == 400
    r = await client.post("/api/stock/add", headers=seller, json={"name": "Kale", "quality_status": "lab_certified"})
    assert r.status_code == 400

    tom = await _add_stock(client, seller)
    alt1 = await _add_stock(client, seller, name="Tomatoes, grade B (crate)", wholesale_price=2600)
    alt2 = await _add_stock(client, seller, name="Cherry tomatoes (punnet)", category="fresh produce", unit_of_measure="punnet",
                            wholesale_price=120, quantity_in_stock=200)
    r = await client.get(f"/api/stock/{tom}", headers=buyer)
    assert r.json()["quality_status"] == "unverified" and r.json()["vendor_is_patron"] is False

    # multipart self-declaration with an uploaded spec sheet
    r = await client.post(
        f"/api/stock/{tom}/verify", headers=seller,
        data={"batch_number": "MWEA-0927", "origin_country": "Kenya",
              "expiry_date": (datetime.utcnow() + timedelta(days=5)).isoformat() + "Z"},
        files={"spec_sheet": ("spec.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["quality_status"] == "self_declared" and body["spec_sheet_url"].startswith("/static/")
    r = await client.get(body["spec_sheet_url"])
    assert r.status_code == 200 and r.content.startswith(b"%PDF")

    # with a spec sheet on file, lab certification is accepted
    r = await client.post(f"/api/stock/{tom}/verify", headers=seller, data={"batch_number": "MWEA-0927", "lab_certified": "true"})
    assert r.status_code == 200 and r.json()["quality_status"] == "lab_certified"

    # alternatives: same category, other items, cheapest first; never the item itself
    r = await client.get(f"/api/stock/{tom}/alternatives", headers=buyer)
    assert r.status_code == 200
    ids = [a["id"] for a in r.json()]
    assert tom not in ids and {alt1, alt2} <= set(ids)
    assert [a["id"] for a in r.json()][:2] == sorted([alt1, alt2], key=lambda i: {alt1: 2600, alt2: 120}[i])

    # a sourcing request notifies the supplier, with a hold on the stock
    r = await client.post(f"/api/stock/{tom}/source", headers=buyer, json={"quantity": 3})
    assert r.status_code == 201, r.text
    movement_id = r.json()["movement_id"]
    seller_notes = await _notifications(client, seller)
    assert seller_notes["unread_count"] >= 1 and "source_request" in _types(seller_notes)
    r = await client.get("/api/stock/movements", headers=buyer)
    pending = next(m for m in r.json() if m["id"] == movement_id)
    assert pending["status"] == "pending" and pending["hold_expires_at"]

    # read one / read all
    first = seller_notes["notifications"][0]
    r = await client.post(f"/api/notifications/{first['id']}/read", headers=seller)
    assert r.status_code == 200
    r = await client.post("/api/notifications/read-all", headers=seller)
    assert r.status_code == 200
    assert (await _notifications(client, seller))["unread_count"] == 0
    r = await client.get("/api/notifications/unread-count", headers=seller)
    assert r.json()["unread_count"] == 0
    # someone else's notification cannot be marked
    r = await client.post(f"/api/notifications/{first['id']}/read", headers=buyer)
    assert r.status_code == 404

    # an expired hold is released: movement cancelled, both sides told, stock freed
    async with async_session() as db:
        await db.execute(update(StockReservation).where(StockReservation.movement_id == uuid.UUID(movement_id))
                         .values(hold_expires_at=datetime.utcnow() - timedelta(minutes=1)))
        await db.commit()
        n = await stock_engine.expire_stale_holds(db)
        await db.commit()
    assert n == 1
    r = await client.get("/api/stock/movements", headers=buyer)
    assert next(m for m in r.json() if m["id"] == movement_id)["status"] == "cancelled"
    assert "source_cancelled" in _types(await _notifications(client, buyer))
    r = await client.get(f"/api/stock/{tom}", headers=seller)
    assert r.json()["quantity_reserved"] == 0 and r.json()["quantity_in_stock"] == 40

    # fulfil one for real → SRM-lite numbers
    r = await client.post(f"/api/stock/{tom}/source", headers=buyer, json={"quantity": 2})
    mid = r.json()["movement_id"]
    for who, action in ((seller, "confirm"), (seller, "ship"), (buyer, "receive")):
        r = await client.post(f"/api/stock/movements/{mid}/{action}", headers=who)
        assert r.status_code == 200, r.text
    r = await client.get("/api/stock/movements", headers=buyer)
    done = next(m for m in r.json() if m["id"] == mid)
    assert done["status"] == "received" and done["confirmed_at"] and done["shipped_at"] and done["completed_at"]
    handle = (await client.get("/api/vendors/me", headers=seller)).json()["vendor_handle"]
    r = await client.get(f"/api/vendors/{handle}/performance", headers=buyer)
    assert r.status_code == 200
    perf = r.json()
    assert perf["total_deals_completed"] == 1 and perf["fulfillment_rate"] == 100.0 and perf["reliability_score"] > 0
    r = await client.get(f"/api/vendors/{handle}", headers=buyer)
    assert r.json()["fulfillment_rate"] == 100.0 and r.json()["reliability_score"] == perf["reliability_score"]
    assert seller_id == perf.get("vendor_id", seller_id)


# --- deal protocol ------------------------------------------------------------------------------

async def test_deal_protocol_in_chat(client):
    _, seller = await _register(client, "wholesaler", ["fresh produce"], "selling")
    _, buyer = await _register(client, "kiosk", ["retail"], "sourcing")
    onions = await _add_stock(client, seller, name="Red onions (net)", unit_of_measure="net", wholesale_price=1100, quantity_in_stock=60)

    r = await client.post(f"/api/chat/deal/{onions}", headers=buyer)
    assert r.status_code in (200, 201), r.text
    room = r.json()["room"]
    assert room["room_type"] == "deal" and len(room["participants"]) == 2

    # a proposal must carry valid terms
    r = await client.post(f"/api/chat/{room['id']}/message", headers=buyer,
                          json={"content": "?", "message_type": "deal_proposal", "deal_data": {"quantity": 0}})
    assert r.status_code == 400
    # clients cannot forge system messages
    r = await client.post(f"/api/chat/{room['id']}/message", headers=buyer, json={"content": "x", "message_type": "system"})
    assert r.status_code == 400

    r = await client.post(f"/api/chat/{room['id']}/message", headers=buyer, json={
        "content": "4 nets at 1,050?", "message_type": "deal_proposal",
        "deal_data": {"stock_item_id": onions, "quantity": 4, "proposed_price_per_unit": 1050,
                      "delivery_terms": "pickup", "payment_terms": "on_delivery"}})
    assert r.status_code == 201, r.text
    proposal = r.json()["sent"]
    assert proposal["deal_data"]["status"] == "proposed" and proposal["deal_data"]["total"] == 4200
    assert "deal_proposal" in _types(await _notifications(client, seller))

    # only the other party may answer
    r = await client.post(f"/api/chat/{room['id']}/deals/{proposal['id']}/accept", headers=buyer)
    assert r.status_code == 403

    r = await client.post(f"/api/chat/{room['id']}/deals/{proposal['id']}/counter", headers=seller,
                          json={"proposed_price_per_unit": 1100, "quantity": 4, "notes": "1,100 is my floor"})
    assert r.status_code == 201, r.text
    counter = r.json()["sent"]
    assert counter["deal_data"]["round"] == 2 and counter["deal_data"]["parent_message_id"] == proposal["id"]
    assert "deal_countered" in _types(await _notifications(client, buyer))
    # the original is now marked countered and can no longer be accepted
    r = await client.post(f"/api/chat/{room['id']}/deals/{proposal['id']}/accept", headers=seller)
    assert r.status_code == 400

    r = await client.post(f"/api/chat/{room['id']}/deals/{counter['id']}/accept", headers=buyer)
    assert r.status_code == 200, r.text
    assert r.json()["movement_status"] == "confirmed"
    movement_id = r.json()["movement_id"]
    assert "deal_accepted" in _types(await _notifications(client, seller))

    r = await client.get(f"/api/chat/{room['id']}/messages", headers=seller)
    msgs = r.json()
    assert any(m["message_type"] == "system" and m["deal_data"].get("kind") == "deal_accepted" for m in msgs)
    accepted = next(m for m in msgs if m["id"] == counter["id"])
    assert accepted["deal_data"]["status"] == "accepted" and accepted["deal_data"]["movement_id"] == movement_id

    # stock is reserved at the agreed price; the supplier ships, the buyer receives
    r = await client.get(f"/api/stock/{onions}", headers=seller)
    assert r.json()["quantity_reserved"] == 4
    r = await client.get("/api/stock/movements", headers=buyer)
    mv = next(m for m in r.json() if m["id"] == movement_id)
    assert mv["unit_price"] == 1100 and mv["total_value"] == 4400 and mv["status"] == "confirmed"

    # declining works on a fresh proposal
    r = await client.post(f"/api/chat/{room['id']}/message", headers=buyer, json={
        "content": "and 2 more?", "message_type": "deal_proposal",
        "deal_data": {"stock_item_id": onions, "quantity": 2, "proposed_price_per_unit": 900}})
    second = r.json()["sent"]
    r = await client.post(f"/api/chat/{room['id']}/deals/{second['id']}/decline", headers=seller)
    assert r.status_code == 200 and r.json()["status"] == "declined"
    assert "deal_declined" in _types(await _notifications(client, buyer))


# --- collective sourcing + patron verification ---------------------------------------------------

async def test_collective_sourcing_and_patron_flow(client):
    _, patron = await _register(client, "patron", ["fresh produce"], "selling")
    member_tok, member = await _register(client, "member", ["fresh produce"], "both")
    other_tok, other = await _register(client, "other", ["food service"], "sourcing")
    r = await client.post("/api/vendors/become-patron", headers=patron)
    assert r.status_code in (200, 201), r.text

    r = await client.post("/api/groups/create", headers=patron, json={"name": f"Collective {uuid.uuid4().hex[:4]}", "group_type": "sourcing"})
    group_id = r.json()["group_id"]
    for h in (member, other):
        assert (await client.post(f"/api/groups/{group_id}/join", headers=h)).status_code == 200

    r = await client.post("/api/collective/create", headers=patron, json={
        "group_id": group_id, "item_name": "Tomato crates", "target_quantity": 10, "target_price_per_unit": 3000,
        "unit_of_measure": "crate", "deadline": (datetime.utcnow() + timedelta(days=3)).isoformat() + "Z"})
    assert r.status_code == 201, r.text
    cid = r.json()["collective_id"]
    assert "collective_update" in _types(await _notifications(client, member))

    r = await client.post(f"/api/collective/{cid}/pledge", headers=member, json={"pledged_quantity": 6})
    assert r.status_code == 200 and r.json()["status"] == "gathering"
    r = await client.post(f"/api/collective/{cid}/pledge", headers=other, json={"pledged_quantity": 4, "max_price_per_unit": 3100})
    assert r.json()["status"] == "quota_met" and r.json()["current_pledged_quantity"] == 10
    r = await client.get(f"/api/collective/{cid}", headers=patron)
    detail = r.json()
    assert detail["pledge_count"] == 2 and detail["progress_pct"] == 100.0 and len(detail["pledges"]) == 2

    # withdrawing drops it back to gathering; re-pledging updates in place
    r = await client.post(f"/api/collective/{cid}/withdraw", headers=other)
    assert r.json()["status"] == "gathering"
    r = await client.post(f"/api/collective/{cid}/pledge", headers=member, json={"pledged_quantity": 10})
    assert r.json()["status"] == "quota_met" and r.json()["current_pledged_quantity"] == 10

    # only the organiser / admins move it along; outsiders see nothing
    assert (await client.post(f"/api/collective/{cid}/status", headers=member, params={"status": "ordered"})).status_code == 403
    r = await client.post(f"/api/collective/{cid}/status", headers=patron, params={"status": "ordered"})
    assert r.status_code == 200
    _, stranger = await _register(client, "stranger", ["textiles"])
    assert (await client.get(f"/api/collective/{cid}", headers=stranger)).status_code == 404
    assert (await client.get("/api/collective", headers=stranger)).json() == []

    # patron verification: only for approved members of the patron's list
    r = await client.post("/api/vendor-lists/create", headers=patron, json={"name": f"Produce list {uuid.uuid4().hex[:4]}", "requires_approval": True})
    assert r.status_code == 201, r.text
    list_id = r.json()["list_id"]
    item = await _add_stock(client, member, name="Kale (bunch)")
    r = await client.post(f"/api/stock/{item}/patron-verify", headers=patron)
    assert r.status_code == 403
    assert (await client.post(f"/api/vendor-lists/{list_id}/register", headers=member)).status_code in (200, 201)
    assert "list_registration" in _types(await _notifications(client, patron))
    assert (await client.post(f"/api/vendor-lists/{list_id}/approve/{member_tok['vendor_id']}", headers=patron)).status_code == 200
    assert "list_approved" in _types(await _notifications(client, member))
    r = await client.post(f"/api/stock/{item}/patron-verify", headers=patron)
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/stock/{item}", headers=other)
    assert r.json()["quality_status"] == "patron_verified" and r.json()["verified_at"]
    assert "stock_verified" in _types(await _notifications(client, member))
    # the vendor editing provenance drops the badge back to self-declared
    r = await client.put(f"/api/stock/{item}", headers=member, json={"batch_number": "NEW-1"})
    assert r.json()["quality_status"] == "self_declared"
    r = await client.get("/api/vendors/me/patron", headers=patron)
    assert r.json()["tier"] == "starter" and r.json()["total_vendors_managed"] == 1


# --- events + shipments -------------------------------------------------------------------------

async def test_event_checkin_and_courier_shipments(client):
    _, organiser = await _register(client, "organiser", ["fresh produce"])
    guest_tok, guest = await _register(client, "guest", ["fresh produce"])
    courier_tok, courier = await _register(client, "rider", ["logistics"])

    start = datetime.utcnow() + timedelta(days=2)
    r = await client.post("/api/events/create", headers=organiser, json={
        "title": "Market day", "event_type": "market_day", "start_date": start.isoformat(),
        "end_date": (start + timedelta(hours=6)).isoformat(), "max_vendors": 10})
    assert r.status_code == 201, r.text
    event_id = r.json()["event_id"]
    assert (await client.post(f"/api/events/{event_id}/register", headers=guest)).status_code == 200
    assert "event_registration" in _types(await _notifications(client, organiser))

    # self check-in only on the day; the organiser can check anyone in
    assert (await client.post(f"/api/events/{event_id}/check-in", headers=guest)).status_code == 400
    r = await client.post(f"/api/events/{event_id}/check-in/{guest_tok['vendor_id']}", headers=organiser)
    assert r.status_code == 200 and r.json()["status"] == "attended"
    assert (await client.post(f"/api/events/{event_id}/check-in/{guest_tok['vendor_id']}", headers=guest)).status_code == 404
    r = await client.get(f"/api/events/{event_id}/analytics", headers=organiser)
    assert r.status_code == 200
    a = r.json()
    assert a["registered"] == 1 and a["attended"] == 1 and a["attendance_rate"] == 100.0 and a["categories"][0]["category"] == "fresh produce"
    assert (await client.get(f"/api/events/{event_id}/analytics", headers=guest)).status_code in (403, 404)

    # courier shipment: booked by the sender, advanced by the courier, rated by the receiver
    r = await client.post("/api/tools/courier/register", headers=courier, json={"courier_name": "Rider One", "coverage_areas": ["CBD"]})
    assert r.status_code == 201, r.text
    couriers = (await client.get("/api/tools/couriers", headers=organiser)).json()
    cid = next(c["id"] for c in couriers if c["vendor_id"] == courier_tok["vendor_id"])
    r = await client.post(f"/api/tools/couriers/{cid}/shipments", headers=organiser, json={
        "receiver_vendor_id": guest_tok["vendor_id"], "origin": "Ngara", "destination": "CBD", "weight_kg": 12, "cost": 400})
    assert r.status_code == 201, r.text
    sid, tracking = r.json()["shipment_id"], r.json()["tracking_number"]
    assert tracking.startswith("BRF-")
    assert "shipment_update" in _types(await _notifications(client, courier))

    # the sender cannot move it; the courier cannot go backwards; the receiver may confirm delivery
    assert (await client.post(f"/api/tools/shipments/{sid}/status", headers=organiser, params={"status": "in_transit"})).status_code == 403
    assert (await client.post(f"/api/tools/shipments/{sid}/status", headers=courier, params={"status": "in_transit"})).status_code == 200
    assert (await client.post(f"/api/tools/shipments/{sid}/status", headers=courier, params={"status": "picked_up"})).status_code == 400
    assert (await client.post(f"/api/tools/shipments/{sid}/rate", headers=guest, json={"rating": 5})).status_code == 400
    r = await client.post(f"/api/tools/shipments/{sid}/status", headers=guest, params={"status": "delivered"})
    assert r.status_code == 200
    r = await client.get(f"/api/tools/shipments/track/{tracking.lower()}", headers=organiser)
    assert r.status_code == 200 and r.json()["status"] == "delivered" and len(r.json()["status_history"]) == 3
    r = await client.post(f"/api/tools/shipments/{sid}/rate", headers=guest, json={"rating": 4, "review": "Fine"})
    assert r.status_code == 200 and r.json()["courier_rating"] == 4.0
    assert (await client.post(f"/api/tools/shipments/{sid}/rate", headers=organiser, json={"rating": 1})).status_code == 400
    couriers = (await client.get("/api/tools/couriers", headers=organiser)).json()
    me = next(c for c in couriers if c["id"] == cid)
    assert me["rating"] == 4.0 and me["total_deliveries"] == 1
    r = await client.get("/api/tools/shipments", headers=courier, params={"role": "courier"})
    assert [s["id"] for s in r.json()] == [sid] and r.json()[0]["my_role"] == "courier"
    assert (await client.get("/api/tools/shipments", headers=guest, params={"role": "sent"})).json() == []


# --- files ----------------------------------------------------------------------------------------

async def test_file_upload_limits(client):
    _, headers = await _register(client, "uploader", ["textiles"])
    r = await client.get("/api/files/limits", headers=headers)
    assert r.status_code == 200 and r.json()["backend"] == "local" and ".pdf" in r.json()["allowed"]
    r = await client.post("/api/files/upload", headers=headers, files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")})
    assert r.status_code == 400
    r = await client.post("/api/files/upload", headers=headers, files={"file": ("logo.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 100), "image/png")})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["url"].startswith("/static/") and body["size"] == 108 and body["content_type"] == "image/png"
    r = await client.get(body["url"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/png")
    assert (await client.post("/api/files/upload", files={"file": ("a.png", io.BytesIO(b"1"), "image/png")})).status_code == 401

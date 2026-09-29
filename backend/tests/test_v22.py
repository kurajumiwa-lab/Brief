"""
v2.2 surface: trade analytics, vendor-list reviews, the discovery algorithm,
courier route optimisation, tool bookings & availability calendars, and the
ops/metrics endpoints.
"""

import uuid
from datetime import datetime, timedelta

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, handle: str, categories: list[str], role: str = "both", **extra) -> tuple[dict, dict]:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "business_name": handle.replace("_", " ").title(), "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com", "password": PASSWORD,
        "business_categories": categories, "physical_location": "Nairobi",
    }
    body.update(extra)
    r = await client.post("/api/auth/register", json=body)
    assert r.status_code == 201, r.text
    tok = r.json()
    headers = {"Authorization": f"Bearer {tok['access_token']}"}
    if role != "both":
        await client.post(f"/api/vendors/switch-role/{role}", headers=headers)
    return tok, headers


async def _me(client, headers) -> dict:
    r = await client.get("/api/vendors/me", headers=headers)
    assert r.status_code == 200
    return r.json()


async def _add_stock(client, headers, **overrides) -> str:
    body = {"name": "Tomatoes (crate)", "sku": f"TOM-{uuid.uuid4().hex[:4]}", "category": "fresh produce",
            "quantity_in_stock": 60, "unit_of_measure": "crate", "wholesale_price": 3000, "unit_price": 3500,
            "min_order_quantity": 1, "visible_to_network": True}
    body.update(overrides)
    r = await client.post("/api/stock/add", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()["stock_id"]


async def _trade(client, seller, buyer, stock_id, quantity=2, price=None) -> str:
    """Walk one movement all the way to `received`."""
    payload = {"quantity": quantity}
    if price is not None:
        payload["proposed_price"] = price
    r = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json=payload)
    assert r.status_code == 201, r.text
    movement_id = r.json()["movement_id"]
    for headers, action in ((seller, "confirm"), (seller, "ship"), (buyer, "receive")):
        r = await client.post(f"/api/stock/movements/{movement_id}/{action}", headers=headers)
        assert r.status_code == 200, r.text
    return movement_id


async def _notifications(client, headers, **params) -> dict:
    r = await client.get("/api/notifications", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _types(payload: dict) -> list[str]:
    return [n["type"] for n in payload["notifications"]]


# --- trade analytics (§3.5) -----------------------------------------------------------------

async def test_trade_analytics_dashboard(client):
    _, seller = await _register(client, "grower", ["fresh produce"], "selling")
    _, buyer = await _register(client, "eatery", ["food service"], "sourcing")
    _, peer = await _register(client, "rival", ["fresh produce"], "selling")

    # a category only this test trades in, so the network benchmark is exactly
    # the one peer shelf below (the suite shares one database across files)
    cat = "specialty preserves"
    tom = await _add_stock(client, seller, category=cat, wholesale_price=3000)
    await _add_stock(client, peer, name="Preserves, Kariobangi", category=cat, wholesale_price=2700)
    await _add_stock(client, seller, name="Onions (net)", category=cat, wholesale_price=1100)

    await _trade(client, seller, buyer, tom, quantity=4, price=3000)
    onions = (await client.get("/api/stock/my-stock", headers=seller)).json()
    onion_id = next(i["id"] for i in onions if i["name"] == "Onions (net)")
    await _trade(client, seller, buyer, onion_id, quantity=10, price=1100)

    seller_handle = (await _me(client, seller))["vendor_handle"]
    buyer_handle = (await _me(client, buyer))["vendor_handle"]

    r = await client.get("/api/analytics/overview", headers=seller, params={"days": 90})
    assert r.status_code == 200, r.text
    body = r.json()
    summary = body["summary"]
    assert summary["supplied_value"] == pytest.approx(4 * 3000 + 10 * 1100, rel=1e-6)
    assert summary["sourced_value"] == 0.0
    assert summary["trade_value"] == summary["supplied_value"] + summary["sourced_value"]
    assert summary["movements_settled"] == 2 and summary["units_moved"] == 14
    assert summary["counterparties"] == 1 and summary["movements_cancelled"] == 0
    assert summary["avg_movement_value"] == pytest.approx(summary["trade_value"] / 2, rel=1e-3)
    assert summary["open_movements_total"] == 0

    # trend buckets weekly for a 90-day window and carries both settled trades
    assert body["trend"] and body["trend"][0]["bucket"] == "week"
    assert sum(t["movements"] for t in body["trend"]) == 2
    assert sum(t["value"] for t in body["trend"]) == pytest.approx(summary["trade_value"], rel=1e-6)

    # counterparties are named and carry the live pair score
    assert body["counterparties"][0]["vendor_handle"] == buyer_handle
    assert body["counterparties"][0]["parasitism_score"] > 0
    assert body["counterparties"][0]["balance_label"] == "they buy more"

    # categories share the trade value; price position compares with the network
    cats = {c["category"]: c for c in body["categories"]}
    assert cats[cat]["movements"] == 2 and cats[cat]["share_pct"] == 100.0
    positions = {p["category"]: p for p in body["price_position"]}
    assert cat in positions
    assert positions[cat]["network_avg_price"] == pytest.approx(2700, rel=0.01)
    assert positions[cat]["network_vendors"] == 1
    assert positions[cat]["my_avg_price"] == pytest.approx(2050, rel=0.01)  # (3000 + 1100) / 2
    assert positions[cat]["position"] == "below"

    # network context and a single-file drill-down into one counterparty
    r = await client.get("/api/analytics/network", headers=seller)
    assert r.json()["trade_value"] >= summary["trade_value"]
    r = await client.get(f"/api/analytics/counterparty/{buyer_handle}", headers=seller)
    detail = r.json()
    assert detail["you_sold"]["movements"] == 2
    assert detail["net_position"] == pytest.approx(summary["trade_value"], rel=1e-6)
    assert len(detail["history"]) >= 1 and detail["top_items"]
    # a vendor cannot drill into themselves
    r = await client.get(f"/api/analytics/counterparty/{seller_handle}", headers=seller)
    assert r.status_code == 400

    # trend and weights endpoints are reachable too
    assert (await client.get("/api/analytics/trend", headers=seller, params={"days": 30})).status_code == 200
    weights = (await client.get("/api/analytics/weights", headers=seller)).json()["factors"]
    assert weights["complementarity"] == 25 and sum(weights.values()) == 100


# --- vendor-list reviews (§4.2) ---------------------------------------------------------------

async def test_vendor_list_reviews(client):
    _, patron = await _register(client, "patron", ["fresh produce"], "selling")
    _, member = await _register(client, "member", ["fresh produce"], "both")
    _, member2 = await _register(client, "member2", ["fresh produce"], "both")
    _, outsider = await _register(client, "outsider", ["hardware"], "both")

    assert (await client.post("/api/vendors/become-patron", headers=patron)).status_code in (200, 201)
    r = await client.post("/api/vendor-lists/create", headers=patron,
                          json={"name": f"Wakulima Fresh {uuid.uuid4().hex[:4]}", "category": "fresh produce",
                                "requires_approval": True})
    assert r.status_code == 201, r.text
    list_id = r.json()["list_id"]
    member_id = (await _me(client, member))["id"]
    member2_id = (await _me(client, member2))["id"]

    for headers, vendor_id in ((member, member_id), (member2, member2_id)):
        assert (await client.post(f"/api/vendor-lists/{list_id}/register", headers=headers)).status_code == 200
        assert (await client.post(f"/api/vendor-lists/{list_id}/approve/{vendor_id}", headers=patron)).status_code == 200

    # outsiders may not review
    r = await client.post(f"/api/vendor-lists/{list_id}/reviews", headers=outsider, json={"rating": 1})
    assert r.status_code == 403

    r = await client.post(f"/api/vendor-lists/{list_id}/reviews", headers=member,
                          json={"rating": 4, "title": "Good market days", "body": "The patron actually shows up."})
    assert r.status_code == 201, r.text
    assert r.json()["avg_rating"] == 4.0 and r.json()["review_count"] == 1
    review_id = r.json()["review_id"]

    # one review per vendor per list
    r = await client.post(f"/api/vendor-lists/{list_id}/reviews", headers=member, json={"rating": 5})
    assert r.status_code == 400

    r = await client.post(f"/api/vendor-lists/{list_id}/reviews", headers=member2, json={"rating": 2, "body": "Thin crowds."})
    assert r.json()["avg_rating"] == 3.0 and r.json()["review_count"] == 2

    # the patron is told, and the list carries the aggregate for browse/sort
    assert "list_review" in _types(await _notifications(client, patron))
    r = await client.get("/api/vendor-lists/browse", headers=outsider)
    listed = next(v for v in r.json() if v["id"] == list_id)
    assert listed["avg_rating"] == 3.0 and listed["review_count"] == 2

    # reading a list's reviews: distribution, eligibility, helpful votes
    r = await client.get(f"/api/vendor-lists/{list_id}/reviews", headers=member2)
    payload = r.json()
    assert payload["distribution"]["4"] == 1 and payload["distribution"]["2"] == 1
    assert payload["can_review"] is False  # already reviewed
    r = await client.get(f"/api/vendor-lists/{list_id}/reviews", headers=outsider)
    assert r.json()["can_review"] is False and r.json()["my_status"] is None

    # your own review is addressable directly, for the drawer's edit affordance
    r = await client.get(f"/api/vendor-lists/{list_id}/reviews/mine", headers=member)
    assert r.status_code == 200 and r.json()["mine"] is True and r.json()["rating"] == 4
    assert r.json()["can_edit"] is True
    assert (await client.get(f"/api/vendor-lists/{list_id}/reviews/mine", headers=outsider)).status_code == 404

    r = await client.post(f"/api/vendor-lists/{list_id}/reviews/{review_id}/helpful", headers=member2)
    assert r.status_code == 200 and r.json()["helpful_count"] == 1
    assert (await client.post(f"/api/vendor-lists/{list_id}/reviews/{review_id}/helpful", headers=member2)).status_code == 400
    assert (await client.post(f"/api/vendor-lists/{list_id}/reviews/{review_id}/helpful", headers=member)).status_code == 400

    # editing and deleting move the aggregate with them
    r = await client.put(f"/api/vendor-lists/{list_id}/reviews/mine", headers=member, json={"rating": 5, "body": "Reconsidered."})
    assert r.status_code == 200 and r.json()["avg_rating"] == 3.5
    r = await client.delete(f"/api/vendor-lists/{list_id}/reviews/mine", headers=member2)
    assert r.status_code == 200 and r.json()["avg_rating"] == 5.0 and r.json()["review_count"] == 1
    assert (await client.delete(f"/api/vendor-lists/{list_id}/reviews/mine", headers=member2)).status_code == 404


# --- discovery algorithm (§4.5) ----------------------------------------------------------------

async def test_discovery_algorithm(client):
    _, me = await _register(client, "sourcer", ["retail"], "sourcing")
    _, complement = await _register(client, "grower", ["fresh produce"], "selling")
    _, irrelevant = await _register(client, "hardware", ["hardware"], "selling")

    # what I source, and what I stock
    r = await client.put("/api/vendors/me/profile", headers=me,
                         json={"sourcing_interests": ["fresh produce"], "primary_goods": ["hardware"]})
    assert r.status_code == 200
    await _add_stock(client, complement, name="Kale (bunch)", category="fresh produce", quantity_in_stock=200)
    await _add_stock(client, complement, name="Spinach (bunch)", category="fresh produce")
    await _add_stock(client, irrelevant, name="Padlocks", category="hardware")

    r = await client.get("/api/vendors/discover", headers=me, params={"limit": 25})
    assert r.status_code == 200, r.text
    ranked = r.json()
    assert ranked, "expected at least one discovery candidate"
    by_handle = {v["vendor_handle"]: v for v in ranked}
    mine = by_handle[(await _me(client, complement))["vendor_handle"]]
    unrelated = by_handle[(await _me(client, irrelevant))["vendor_handle"]]
    assert mine["score"] > unrelated["score"] >= 0
    assert set(mine["factors"]) == {"complementarity", "reciprocity", "trade_evidence", "proximity", "graph", "reputation"}
    assert mine["factors"]["complementarity"] == 25
    assert mine["factors"]["trade_evidence"] > 0 and unrelated["factors"]["trade_evidence"] == 0
    assert any("fresh produce" in reason for reason in mine["reasons"])
    assert [v["score"] for v in ranked] == sorted([v["score"] for v in ranked], reverse=True)

    # weights are published so the ranking is auditable
    r = await client.get("/api/vendors/discover/weights", headers=me)
    assert r.json()["factors"]["trade_evidence"] == 20

    # connecting removes them from discovery (and from /suggested), until asked otherwise
    complement_id = (await _me(client, complement))["id"]
    assert (await client.post(f"/api/vendors/connect/{complement_id}", headers=me)).status_code == 200
    r = await client.get("/api/vendors/discover", headers=me)
    handles = [v["vendor_handle"] for v in r.json()]
    complement_handle = (await _me(client, complement))["vendor_handle"]
    assert complement_handle not in handles
    complement_handle = (await _me(client, complement))["vendor_handle"]
    r = await client.get("/api/vendors/discover", headers=me, params={"include_connected": True})
    included = r.json()
    assert any(v["vendor_handle"] == complement_handle for v in included)
    assert (await client.get("/api/vendors/discover", headers=me, params={"min_score": 99})).json() == []


# --- courier route optimisation (§5.5) ---------------------------------------------------------

DEPOT = (-1.2921, 36.8219)
STOP_A = (-1.3000, 36.8000)
STOP_B = (-1.3500, 36.9000)
STOP_C = (-1.2500, 36.9500)
STOP_D = (-1.4000, 36.7500)


async def test_route_optimisation(client):
    _, courier = await _register(client, "boda", ["logistics"], "both", geo_lat=DEPOT[0], geo_lng=DEPOT[1])
    _, sender = await _register(client, "shipper", ["retail"], "both")
    receivers = []
    for handle, (lat, lng) in (("recv_a", STOP_A), ("recv_b", STOP_B), ("recv_c", STOP_C)):
        _, headers = await _register(client, handle, ["retail"], "both", geo_lat=lat, geo_lng=lng)
        receivers.append(headers)

    r = await client.post("/api/tools/courier/register", headers=courier,
                          json={"courier_name": "Boda Express", "coverage_areas": ["Nairobi"],
                                "service_types": ["same_day"], "base_rate": 200})
    assert r.status_code == 201
    courier_id = r.json()["courier_id"]

    # three parcels to book onto the courier
    shipment_ids = []
    for headers in receivers:
        receiver_id = (await _me(client, headers))["id"]
        r = await client.post(f"/api/tools/couriers/{courier_id}/shipments", headers=sender,
                              json={"receiver_vendor_id": receiver_id, "origin": "Ngara", "destination": "Nairobi",
                                    "weight_kg": 5})
        assert r.status_code == 201, r.text
        shipment_ids.append(r.json()["shipment_id"])

    # only the courier plans its own run
    r = await client.post(f"/api/tools/couriers/{courier_id}/routes/from-shipments", headers=sender)
    assert r.status_code == 403

    r = await client.post(f"/api/tools/couriers/{courier_id}/routes/from-shipments", headers=courier)
    assert r.status_code == 201, r.text
    plan = r.json()
    assert plan["total_stops"] == 3 and len(plan["stops"]) == 3
    assert [s["sequence"] for s in plan["stops"]] == [1, 2, 3]
    assert all(s["shipment_id"] in shipment_ids for s in plan["stops"])
    assert plan["algorithm"] == "nearest_neighbour+2opt"
    plan_id = plan["id"]

    # a deliberately zig-zag stop list comes back shorter than the booking order
    stops = [
        {"label": "D (far south-west)", "lat": STOP_D[0], "lng": STOP_D[1]},
        {"label": "C (north-east)", "lat": STOP_C[0], "lng": STOP_C[1]},
        {"label": "B (south-east)", "lat": STOP_B[0], "lng": STOP_B[1]},
        {"label": "A (next door)", "lat": STOP_A[0], "lng": STOP_A[1]},
    ]
    r = await client.post(f"/api/tools/couriers/{courier_id}/routes", headers=courier, json={
        "stops": stops, "name": "Zig-zag day", "start_lat": DEPOT[0], "start_lng": DEPOT[1],
        "average_speed_kmh": 24, "service_minutes": 10,
    })
    assert r.status_code == 201, r.text
    optimised = r.json()
    assert optimised["total_distance_km"] < optimised["baseline_distance_km"]
    assert optimised["saved_km"] > 0 and optimised["saved_pct"] > 0
    assert [s["label"] for s in optimised["stops"]] != [s["label"] for s in stops]
    assert optimised["stops"][0]["label"].startswith("A")  # nearest first
    assert optimised["estimated_minutes"] >= 10 * len(stops)  # service time is counted
    assert optimised["stops"][0]["cumulative_km"] <= optimised["stops"][-1]["cumulative_km"]

    # a courier with no depot coordinates still gets a plan: the first leg is
    # unknown, every later leg is priced
    r = await client.post(f"/api/tools/couriers/{courier_id}/routes", headers=courier, json={
        "stops": [{"label": "First", "lat": STOP_A[0], "lng": STOP_A[1]},
                  {"label": "Second", "lat": STOP_B[0], "lng": STOP_B[1]}],
        "name": "No depot",
    })
    assert r.status_code == 201, r.text
    no_depot = r.json()
    assert no_depot["stops"][0]["distance_from_prev_km"] == 0
    assert no_depot["total_distance_km"] > 0  # the second leg still has coordinates

    # the courier lists their plans; a sender sees the plan carrying their parcel
    r = await client.get("/api/tools/routes", headers=courier, params={"role": "courier"})
    assert {p["id"] for p in r.json()} >= {plan_id, optimised["id"]}
    r = await client.get("/api/tools/routes", headers=sender, params={"role": "booker"})
    assert {p["id"] for p in r.json()} == {plan_id}
    # an unrelated vendor cannot read the courier's plan
    _, stranger = await _register(client, "nosy", ["retail"], "both")
    assert (await client.get(f"/api/tools/routes/{plan_id}", headers=stranger)).status_code == 403

    # dispatch notifies the senders whose parcels are on the run; stops can be ticked off
    r = await client.post(f"/api/tools/routes/{plan_id}/status", headers=courier, params={"status": "dispatched"})
    assert r.status_code == 200 and r.json()["status"] == "dispatched"
    assert "route_update" in _types(await _notifications(client, sender))
    stop_id = plan["stops"][0]["id"]
    r = await client.post(f"/api/tools/routes/{plan_id}/stops/{stop_id}/solve", headers=courier)
    assert r.status_code == 200 and r.json()["stops_remaining"] == 2
    assert (await client.post(f"/api/tools/routes/{plan_id}/status", headers=courier,
                              params={"status": "completed"})).status_code == 200
    assert (await client.post(f"/api/tools/routes/{plan_id}/status", headers=courier,
                              params={"status": "dispatched"})).status_code == 400


# --- tool bookings: warehouse calendar, popups, hotels (§5.2–5.4) ------------------------------

async def test_tool_bookings_and_calendars(client):
    _, host = await _register(client, "warehouse", ["logistics"], "selling")
    _, guest = await _register(client, "kiosk", ["retail"], "sourcing")
    _, guest2 = await _register(client, "duka", ["retail"], "sourcing")

    r = await client.post("/api/tools/list", headers=host, json={
        "category": "warehouse", "title": "Gikomba dry store", "location": "Gikomba",
        "price_per_unit": 150, "price_unit": "per_day", "capacity": {"sqm": 20},
    })
    tool_id = r.json()["tool_id"]
    r = await client.post("/api/tools/list", headers=host, json={
        "category": "popup_shop", "title": "Kariokor Saturday pitch", "price_per_unit": 2000, "price_unit": "per_day",
        "popup_shop": {"venue_name": "Kariokor", "foot_traffic_estimate": 2500, "shared_spaces_available": 2},
    })
    popup_id = r.json()["tool_id"]
    r = await client.post("/api/tools/list", headers=host, json={
        "category": "hotel_sourcing", "title": "Mombasa sourcing beds", "price_per_unit": 3500, "price_unit": "per_day",
        "capacity": {"rooms": 4},
        "hotel_sourcing": {"hotel_name": "Traveller's Inn", "includes_storage": True},
    })
    hotel_id = r.json()["tool_id"]
    r = await client.post("/api/tools/list", headers=host, json={"category": "equipment", "title": "Trolley"})
    equipment_id = r.json()["tool_id"]

    start = (datetime.utcnow() + timedelta(days=2)).replace(microsecond=0)
    end = start + timedelta(days=3)

    # the host cannot book their own space, and equipment has no calendar
    own = {"start_date": start.isoformat() + "Z", "end_date": end.isoformat() + "Z", "quantity": 5}
    assert (await client.post(f"/api/tools/{tool_id}/book", headers=host, json=own)).status_code == 400
    assert (await client.post(f"/api/tools/{equipment_id}/book", headers=guest, json=own)).status_code == 400
    bad = {"start_date": end.isoformat() + "Z", "end_date": start.isoformat() + "Z", "quantity": 1}
    assert (await client.post(f"/api/tools/{tool_id}/book", headers=guest, json=bad)).status_code == 400

    r = await client.post(f"/api/tools/{tool_id}/book", headers=guest, json={
        "start_date": start.isoformat() + "Z", "end_date": end.isoformat() + "Z",
        "quantity": 10, "unit": "sqm", "details": {"section": "A3"}, "notes": "Palletised tomatoes",
    })
    assert r.status_code == 201, r.text
    booking = r.json()
    assert booking["status"] == "requested" and booking["kind"] == "warehouse"
    assert booking["estimated_cost"] == 150 * 10
    assert booking["rental_id"] == booking["booking_id"]  # legacy alias
    booking_id = booking["booking_id"]
    assert "booking_request" in _types(await _notifications(client, host))

    # a second booking that does not fit the window is refused, not silently queued
    r = await client.post(f"/api/tools/{tool_id}/book", headers=guest2, json={
        "start_date": start.isoformat() + "Z", "end_date": end.isoformat() + "Z", "quantity": 15, "unit": "sqm",
    })
    assert r.status_code == 409 and "free" in r.json()["detail"]

    # the calendar paints the window: capacity, committed, free
    r = await client.get(f"/api/tools/{tool_id}/availability-calendar", headers=guest,
                         params={"from": start.date().isoformat(), "to": (end - timedelta(days=1)).date().isoformat()})
    assert r.status_code == 200, r.text
    calendar = r.json()
    assert calendar["capacity"] == 20 and calendar["kind"] == "warehouse" and calendar["unit"] == "sqm"
    assert len(calendar["days"]) == 3
    day = calendar["days"][0]
    assert day["committed"] == 10 and day["free"] == 10 and day["full"] is False
    assert day["my_quantity"] == 10
    assert calendar["mine"] and calendar["mine"][0]["id"] == booking_id

    # a confirmed booking still occupies the window; cancelling frees it
    assert (await client.post(f"/api/tools/bookings/{booking_id}/status", headers=guest,
                              params={"status": "confirmed"})).status_code == 403
    r = await client.post(f"/api/tools/bookings/{booking_id}/status", headers=host,
                          params={"status": "confirmed", "note": "See you Tuesday"})
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    assert "booking_update" in _types(await _notifications(client, guest))
    r = await client.get(f"/api/tools/{tool_id}/availability-calendar", headers=host, params={"days": 5})
    assert next(d for d in r.json()["days"] if d["date"] == start.date().isoformat())["committed"] == 10
    r = await client.post(f"/api/tools/bookings/{booking_id}/status", headers=guest, params={"status": "cancelled"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    r = await client.get(f"/api/tools/{tool_id}/availability-calendar", headers=host, params={"days": 5})
    assert next(d for d in r.json()["days"] if d["date"] == start.date().isoformat())["committed"] == 0
    assert (await client.post(f"/api/tools/bookings/{booking_id}/status", headers=guest,
                              params={"status": "completed"})).status_code == 400

    # popup pitches are shared spaces; hotels count rooms, not bookings
    r = await client.post(f"/api/tools/{popup_id}/book", headers=guest, json={
        "start_date": start.isoformat() + "Z", "end_date": end.isoformat() + "Z", "quantity": 1,
        "details": {"needs_power": True},
    })
    assert r.status_code == 201 and r.json()["kind"] == "popup_shop"
    r = await client.post(f"/api/tools/{popup_id}/book", headers=guest2, json={
        "start_date": start.isoformat() + "Z", "end_date": end.isoformat() + "Z", "quantity": 1})
    assert r.status_code == 201
    r = await client.post(f"/api/tools/{popup_id}/book", headers=guest, json={
        "start_date": start.isoformat() + "Z", "end_date": end.isoformat() + "Z", "quantity": 1})
    assert r.status_code == 409  # only two shared spaces

    r = await client.post(f"/api/tools/{hotel_id}/book", headers=guest, json={
        "start_date": start.isoformat() + "Z", "end_date": end.isoformat() + "Z",
        "quantity": 2, "unit": "rooms", "details": {"rooms": 2, "guests": 3, "includes_storage": True},
    })
    assert r.status_code == 201 and r.json()["kind"] == "hotel_sourcing"

    # the booking form's date inputs send bare dates (`2026-10-01`); they book
    # the same window as the datetime form
    later = (start + timedelta(days=30)).date()
    r = await client.post(f"/api/tools/{tool_id}/book", headers=guest, json={
        "start_date": later.isoformat(), "end_date": (later + timedelta(days=2)).isoformat(), "quantity": 1,
    })
    assert r.status_code == 201, r.text
    assert r.json()["start_date"].startswith(later.isoformat())

    # both sides see the booking in their lists, tagged by role
    r = await client.get("/api/tools/bookings", headers=host, params={"role": "host"})
    assert {b["id"] for b in r.json()} >= {booking_id}
    assert all(b["my_role"] == "host" for b in r.json())
    r = await client.get("/api/tools/bookings", headers=guest, params={"role": "booker"})
    assert len(r.json()) >= 3
    assert any(b["can_decide"] is False for b in r.json())

    # the v2.1 warehouse alias still works and points at the same booking model
    r = await client.post(f"/api/tools/{tool_id}/book-warehouse", headers=guest2, json={
        "start_date": (start + timedelta(days=10)).isoformat() + "Z",
        "end_date": (start + timedelta(days=12)).isoformat() + "Z",
        "space_allocated": {"sqm": 4},
    })
    assert r.status_code == 201 and r.json()["booking_id"]
    detail = (await client.get(f"/api/tools/bookings/{r.json()['booking_id']}", headers=guest2)).json()
    assert detail["details"]["space_allocated"] == {"sqm": 4}


# --- monitoring & ops (§6.2) --------------------------------------------------------------------

async def test_metrics_and_ops_endpoints(client):
    # the scrape target is open (no vendor token) and speaks Prometheus
    r = await client.get("/api/metrics")
    assert r.status_code == 200
    assert "text/plain" in r.headers["content-type"]
    body = r.text
    assert "brief_up 1" in body
    assert "brief_requests_total" in body and "brief_request_duration_ms_bucket" in body

    _, vendor = await _register(client, "operator", ["retail"], "both")
    r = await client.get("/api/vendors/me", headers=vendor)
    assert r.headers.get("x-request-id")  # every response is traceable

    r = await client.get("/api/ops/status", headers=vendor)
    assert r.status_code == 200, r.text
    status = r.json()
    assert status["version"] == "2.2.0"
    assert status["database"]["reachable"] is True
    assert status["http"]["requests_total"] >= 1
    assert status["http"]["p95_ms"] >= 0 and "routes" in status["http"]
    assert status["limits"]["rate_limit_api_per_min"] == 600
    assert status["environment"]["storage"] in ("local", "s3")

    r = await client.get("/api/ops/slow", headers=vendor)
    assert r.status_code == 200 and r.json()["threshold_ms"] >= 100

    # ops is behind the vendor gate; metrics is not
    assert (await client.get("/api/ops/status")).status_code == 401

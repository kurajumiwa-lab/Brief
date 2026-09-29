"""
End-to-end smoke test of the vendor network, in the order a vendor lives it.

Two vendors: @mama_mboga (produce) and @kibanda_kitchen (food). One stocks,
the other sources; the movement walks pending → confirmed → shipped →
received; the parasitism engine scores the pair. Then groups, chat, patron
lists, tools, events and the POS push path.
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client, handle: str, categories: list[str]) -> dict:
    suffix = uuid.uuid4().hex[:6]
    r = await client.post("/api/auth/register", json={
        "business_name": handle.replace("_", " ").title(),
        "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com",
        "password": "Correct-horse-9",
        "business_categories": categories,
        "physical_location": "Nairobi",
    })
    assert r.status_code == 201, r.text
    return r.json()


async def test_root_and_health(client):
    r = await client.get("/api")
    assert r.status_code == 200
    assert r.json()["philosophy"] == "No consumers. Only vendors."
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json()["database"] is True


async def test_vendor_only_gate(client):
    r = await client.get("/api/vendors/me")
    assert r.status_code == 401
    assert "vendors" in r.json()["detail"].lower()
    assert r.headers["x-brief-network"] == "vendors-only"


async def test_full_loop(client):
    supplier = await _register(client, "mama_mboga", ["produce"])
    buyer = await _register(client, "kibanda_kitchen", ["food"])
    s, b = _auth(supplier["access_token"]), _auth(buyer["access_token"])

    # Login by handle works too.
    r = await client.post("/api/auth/login", data={"username": supplier["vendor_handle"], "password": "Correct-horse-9"})
    assert r.status_code == 200 and r.json()["vendor_id"] == supplier["vendor_id"]

    # Duplicate handle is refused.
    r = await client.post("/api/auth/register", json={
        "business_name": "X", "vendor_handle": supplier["vendor_handle"], "email": "x@example.com", "password": "12345678",
    })
    assert r.status_code == 400

    # Roles are fluid.
    r = await client.post("/api/vendors/switch-role/sourcing", headers=b)
    assert r.json()["role"] == "sourcing"

    # --- stock, not listings -------------------------------------------------
    r = await client.post("/api/stock/add", headers=s, json={
        "name": "Sukuma wiki", "sku": "SUK-1", "category": "produce", "quantity_in_stock": 100,
        "unit_of_measure": "bunches", "unit_price": 30, "wholesale_price": 20, "min_order_quantity": 10,
        "tags": ["greens", "fresh"],
    })
    assert r.status_code == 201, r.text
    stock_id = r.json()["stock_id"]

    r = await client.get("/api/stock/network-stock", headers=b, params={"search": "greens"})
    names = [i["name"] for i in r.json()]
    assert "Sukuma wiki" in names  # JSONB tag containment

    r = await client.get("/api/stock/network-stock", headers=s)
    assert all(i["vendor_id"] != supplier["vendor_id"] for i in r.json())  # never your own shelf

    # Below the minimum order is refused; too much is refused.
    r = await client.post(f"/api/stock/{stock_id}/source", headers=b, json={"quantity": 5})
    assert r.status_code == 400 and "Minimum" in r.json()["detail"]
    r = await client.post(f"/api/stock/{stock_id}/source", headers=b, json={"quantity": 500})
    assert r.status_code == 400

    # A real sourcing request reserves stock.
    r = await client.post(f"/api/stock/{stock_id}/source", headers=b, json={"quantity": 40, "notes": "Friday delivery"})
    assert r.status_code == 201, r.text
    movement_id = r.json()["movement_id"]
    assert r.json()["total_value"] == 800.0  # wholesale 20 × 40

    r = await client.get(f"/api/stock/{stock_id}", headers=s)
    item = r.json()
    assert (item["quantity_in_stock"], item["quantity_reserved"], item["quantity_available"]) == (100, 40, 60)

    # Only the supplier confirms; the buyer cannot.
    r = await client.post(f"/api/stock/movements/{movement_id}/confirm", headers=b)
    assert r.status_code == 403
    for action, who in (("confirm", s), ("ship", s), ("receive", b)):
        r = await client.post(f"/api/stock/movements/{movement_id}/{action}", headers=who)
        assert r.status_code == 200, (action, r.text)
    assert r.json()["status"] == "received"

    # Shelves moved.
    r = await client.get(f"/api/stock/{stock_id}", headers=s)
    item = r.json()
    assert (item["quantity_in_stock"], item["quantity_reserved"], item["quantity_available"]) == (60, 0, 60)
    r = await client.get("/api/stock/my-stock", headers=b)
    mine = [i for i in r.json() if i["sku"] == "SUK-1"]
    assert mine and mine[0]["quantity_in_stock"] == 40 and mine[0]["source"] == "network_transfer"
    assert mine[0]["visible_to_network"] is False

    # Scores exist now.
    r = await client.get("/api/vendors/me", headers=s)
    me = r.json()
    assert me["total_supplied"] == 1 and me["network_score"] > 0 and me["total_stock_moved"] == 40
    r = await client.get("/api/vendors/connections", headers=b)
    conns = r.json()
    assert len(conns) == 1 and conns[0]["vendor_id"] == supplier["vendor_id"] and conns[0]["parasitism_score"] > 0
    r = await client.get("/api/vendors/graph", headers=b)
    g = r.json()
    assert len(g["nodes"]) == 2 and len(g["edges"]) == 1

    # Movement history, both directions.
    r = await client.get("/api/stock/movements", headers=b, params={"direction": "incoming"})
    assert r.json()[0]["status"] == "received" and r.json()[0]["direction"] == "incoming"

    # A second request, then cancelled, releases the reservation.
    r = await client.post(f"/api/stock/{stock_id}/source", headers=b, json={"quantity": 10})
    m2 = r.json()["movement_id"]
    r = await client.post(f"/api/stock/movements/{m2}/cancel", headers=s)
    assert r.status_code == 200
    r = await client.get(f"/api/stock/{stock_id}", headers=s)
    assert r.json()["quantity_available"] == 60

    # Connecting again is a no-op error, not a duplicate row.
    r = await client.post(f"/api/vendors/connect/{supplier['vendor_id']}", headers=b)
    assert r.status_code == 400

    # --- groups + chat ----------------------------------------------------------
    r = await client.post("/api/groups/create", headers=s, json={
        "name": "Wakulima Sourcing Collective", "group_type": "sourcing", "category": "produce", "region": "Nairobi",
    })
    assert r.status_code == 201, r.text
    group_id, room_id = r.json()["group_id"], r.json()["chat_room_id"]

    # Not a member yet → the group's room refuses the buyer.
    r = await client.post(f"/api/chat/{room_id}/message", headers=b, json={"content": "hello?"})
    assert r.status_code == 403
    r = await client.post(f"/api/groups/{group_id}/join", headers=b)
    assert r.status_code == 200 and r.json()["status"] == "member"
    r = await client.post(f"/api/chat/{room_id}/message", headers=b, json={
        "content": "Anyone got sukuma at 18?", "message_type": "stock_share", "shared_stock_id": stock_id,
    })
    assert r.status_code == 201, r.text
    assert r.json()["sent"]["shared_stock"]["name"] == "Sukuma wiki"
    r = await client.get(f"/api/chat/{room_id}/messages", headers=s)
    assert r.json()[-1]["sender_handle"] == buyer["vendor_handle"]

    r = await client.get(f"/api/groups/{group_id}", headers=b)
    assert r.json()["member_count"] == 2 and r.json()["my_role"] == "member"

    # Direct room is idempotent.
    r1 = await client.post(f"/api/chat/direct/{supplier['vendor_id']}", headers=b)
    r2 = await client.post(f"/api/chat/direct/{buyer['vendor_id']}", headers=s)
    assert r1.json()["room_id"] == r2.json()["room_id"]

    # Niche topic is open to all.
    r = await client.post("/api/chat/niche-topic", headers=s, json={"name": "Import regulations", "topic": "KRA, KEBS, clearing"})
    topic_id = r.json()["room_id"]
    r = await client.post(f"/api/chat/{topic_id}/message", headers=b, json={"content": "Which agent do you use at Mombasa?"})
    assert r.status_code == 201
    r = await client.get("/api/chat/rooms", headers=b)
    kinds = {room["room_type"] for room in r.json()}
    assert {"group", "direct", "niche"} <= kinds

    # --- patron + vendor list -----------------------------------------------------
    r = await client.post("/api/vendor-lists/create", headers=s, json={"name": "Nope"})
    assert r.status_code == 403
    r = await client.post("/api/vendors/become-patron", headers=s)
    assert r.status_code == 200 and r.json()["tier"] == "starter"
    r = await client.post("/api/vendor-lists/create", headers=s, json={
        "name": "Nairobi Fresh Produce Vendors", "category": "produce", "max_vendors": 500,
        "entry_criteria": {"business_categories": ["food", "produce"]},
    })
    assert r.status_code == 201, r.text
    list_id = r.json()["list_id"]
    assert r.json()["max_vendors"] == 20  # starter cap applied
    r = await client.post("/api/vendor-lists/create", headers=s, json={"name": "Second list"})
    assert r.status_code == 403  # starter: one list

    r = await client.post(f"/api/vendor-lists/{list_id}/register", headers=b)
    assert r.json()["status"] == "pending"
    r = await client.get(f"/api/vendor-lists/{list_id}/members", headers=b, params={"status": "pending"})
    assert r.json() == []  # pending is private to the patron
    r = await client.get(f"/api/vendor-lists/{list_id}/members", headers=s, params={"status": "pending"})
    assert r.json()[0]["vendor_id"] == buyer["vendor_id"]
    r = await client.post(f"/api/vendor-lists/{list_id}/approve/{buyer['vendor_id']}", headers=s)
    assert r.status_code == 200
    r = await client.get("/api/vendor-lists/browse", headers=b)
    vl = next(x for x in r.json() if x["id"] == list_id)
    assert vl["member_count"] == 1 and vl["my_status"] == "approved"
    r = await client.get("/api/vendors/me/patron", headers=s)
    assert r.json()["total_vendors_managed"] == 1

    # Group-created list needs no patron.
    r = await client.post(f"/api/groups/{group_id}/create-vendor-list", headers=s, json={"name": "Collective buyers"})
    assert r.status_code == 201
    r = await client.post(f"/api/groups/{group_id}/create-vendor-list", headers=b, json={"name": "Not admin"})
    assert r.status_code == 403

    # --- tools --------------------------------------------------------------------
    r = await client.post("/api/tools/list", headers=s, json={
        "category": "warehouse", "title": "Cold room, Wakulima market", "location": "Nairobi",
        "price_per_unit": 1500, "price_unit": "per_day", "capacity": {"sqm": 40},
    })
    assert r.status_code == 201
    tool_id = r.json()["tool_id"]
    r = await client.post(f"/api/tools/{tool_id}/book-warehouse", headers=b, json={
        "start_date": "2026-10-01T08:00:00", "end_date": "2026-10-08T08:00:00", "space_allocated": {"sqm": 10},
    })
    assert r.status_code == 201, r.text
    r = await client.post("/api/tools/courier/register", headers=b, json={
        "courier_name": "Boda Express", "coverage_areas": ["CBD", "Westlands"], "service_types": ["same_day"], "price_per_kg": 50,
    })
    assert r.status_code == 201
    r = await client.get("/api/tools/couriers", headers=s, params={"area": "CBD"})
    assert r.json()[0]["courier_name"] == "Boda Express"
    r = await client.get("/api/tools/browse", headers=b, params={"category": "courier"})
    assert any(t["title"] == "Boda Express" for t in r.json())

    # --- events -------------------------------------------------------------------
    r = await client.post("/api/events/create", headers=s, json={
        "title": "Saturday sourcing run", "event_type": "sourcing_trip",
        "start_date": "2027-01-09T06:00:00", "end_date": "2027-01-09T12:00:00",
        "location": "Marikiti", "max_vendors": 1, "vendor_list_id": list_id,
    })
    assert r.status_code == 201, r.text
    event_id = r.json()["event_id"]
    r = await client.post(f"/api/events/{event_id}/register", headers=b)
    assert r.status_code == 200
    r = await client.post(f"/api/events/{event_id}/register", headers=b)
    assert r.status_code == 400  # already
    r = await client.get("/api/events/browse", headers=b)
    ev = next(e for e in r.json() if e["id"] == event_id)
    assert ev["spots_left"] == 0 and ev["my_status"] == "registered"
    r = await client.get("/api/vendors/me/patron", headers=s)
    assert r.json()["total_events_organized"] == 1

    # --- POS bridge (push path) ----------------------------------------------------
    r = await client.post("/api/pos/connect", headers=s, json={"pos_type": "square", "connection_name": "No token"})
    assert r.status_code == 400
    r = await client.post("/api/pos/connect", headers=s, json={"pos_type": "csv", "connection_name": "Till export"})
    assert r.status_code == 201 and r.json()["mode"] == "push"
    conn_id = r.json()["connection_id"]

    rows = [
        {"name": "Sukuma wiki", "sku": "SUK-1", "quantity": 75, "unit_price": 30},
        {"name": "Managu", "sku": "MAN-1", "quantity": 20, "unit_price": 40, "category": "produce"},
    ]
    r = await client.post(f"/api/pos/{conn_id}/push", headers=s, json={"items": rows})
    assert r.status_code == 200, r.text
    assert (r.json()["items_added"], r.json()["items_updated"]) == (1, 1)
    r = await client.post(f"/api/pos/{conn_id}/push", headers=s, json={"items": rows})
    assert (r.json()["items_added"], r.json()["items_updated"]) == (0, 2)  # idempotent
    r = await client.get(f"/api/stock/{stock_id}", headers=s)
    assert r.json()["quantity_in_stock"] == 75 and r.json()["last_pos_sync"]

    csv_body = "name,sku,quantity,unit_price\nTerere,TER-1,12,25\n"
    r = await client.post(f"/api/pos/{conn_id}/push-csv", headers=s,
                          files={"file": ("till.csv", csv_body, "text/csv")})
    assert r.status_code == 200 and r.json()["items_added"] == 1
    r = await client.get(f"/api/pos/sync-logs/{conn_id}", headers=s)
    assert len(r.json()) == 3 and all(l["status"] == "success" for l in r.json())

    # Pull connection stores the token encrypted and a sync failure is a log, not a 500.
    r = await client.post("/api/pos/connect", headers=b, json={
        "pos_type": "shopify", "connection_name": "Shop", "api_key": "shpat_x", "store_id": "kibanda.myshopify.com",
    })
    assert r.status_code == 201
    shop_conn = r.json()["connection_id"]
    r = await client.get("/api/pos/connections", headers=b)
    assert r.json()[0]["has_credentials"] is True and "shpat" not in r.text
    r = await client.post(f"/api/pos/{shop_conn}/sync", headers=b)
    assert r.status_code == 200 and r.json()["status"] == "failed" and r.json()["errors"]

    # Suggestions surface the produce vendor to the food vendor.
    r = await client.put("/api/vendors/me/profile", headers=b, json={"sourcing_interests": ["produce"]})
    assert r.status_code == 200
    r = await client.get("/api/vendors/suggested", headers=b)
    # supplier is already connected (trade created the link), so it is filtered out
    assert all(sug["vendor_id"] != supplier["vendor_id"] for sug in r.json())

    # Stats reflect two vendors and one connection at minimum.
    r = await client.get("/api/vendors/stats", headers=s)
    assert r.json()["vendors"] >= 2 and r.json()["connections"] >= 1


async def test_bulk_import_updates_by_sku(client):
    v = await _register(client, "duka_la_vitabu", ["books"])
    h = _auth(v["access_token"])
    csv1 = "name,sku,category,quantity,unit_price,wholesale_price\nExercise book A4,EX-A4,stationery,200,60,45\n"
    r = await client.post("/api/stock/bulk-import", headers=h, files={"file": ("s.csv", csv1, "text/csv")})
    assert r.status_code == 200 and r.json()["added"] == 1
    csv2 = "name,sku,category,quantity,unit_price,wholesale_price\nExercise book A4,EX-A4,stationery,150,60,45\n"
    r = await client.post("/api/stock/bulk-import", headers=h, files={"file": ("s.csv", csv2, "text/csv")})
    assert r.json()["updated"] == 1 and r.json()["added"] == 0
    r = await client.get("/api/stock/my-stock", headers=h)
    assert len(r.json()) == 1 and r.json()[0]["quantity_in_stock"] == 150


async def test_rate_limit_on_auth(client):
    # The auth budget is tight; hammer login until the limiter answers 429.
    statuses = set()
    for _ in range(40):
        r = await client.post("/api/auth/login", data={"username": "nobody", "password": "x"})
        statuses.add(r.status_code)
        if r.status_code == 429:
            break
    assert 429 in statuses

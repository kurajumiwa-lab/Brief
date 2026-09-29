"""
Seed the demo network through the public API.

    python seed_demo.py                      # against http://localhost:8000
    BASE_URL=https://brief.example.com python seed_demo.py

Idempotent: vendors that already exist are logged in instead of registered
and everything else is skipped when it is already there. Doubles as an
end-to-end smoke test of the v2.1 surface (verification, deals, holds,
collective sourcing, shipments, check-in, notifications).

Demo accounts (password for all: Brief-demo-2026, email {handle}@brief-demo.co.ke)

    @mama_mboga        patron · selling      fresh produce, runs a list + a sourcing collective
    @kibanda_kitchen   sourcing              small eatery buying from the network
    @gikomba_textiles  both                  second-hand textiles, runs "Eastlands Traders"
    @boda_express      courier               registered courier on the Tools board
"""

import os
import sys
from datetime import datetime, timedelta

import httpx

BASE = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/") + "/api"
PASSWORD = os.environ.get("SEED_PASSWORD", "Brief-demo-2026")
DOMAIN = "brief-demo.co.ke"

VENDORS = {
    "mama_mboga": dict(business_name="Mama Mboga Fresh Produce", business_categories=["fresh produce", "vegetables"],
                       business_description="Fresh sukuma, spinach and tomatoes from Kiambu farms, at Ngara market daily from 5am.",
                       physical_location="Ngara Market, Nairobi", phone="+254700000001"),
    "kibanda_kitchen": dict(business_name="Kibanda Kitchen", business_categories=["food service", "catering"],
                            business_description="Lunch spot on Kirinyaga Road. We buy vegetables, grains and cooking oil weekly.",
                            physical_location="Kirinyaga Road, Nairobi CBD", phone="+254700000002"),
    "gikomba_textiles": dict(business_name="Gikomba Textiles", business_categories=["textiles", "clothing"],
                             business_description="Mitumba bales and sorted grade-A garments. Wholesale and retail.",
                             physical_location="Gikomba Market, Nairobi", phone="+254700000003"),
    "boda_express": dict(business_name="Boda Express Couriers", business_categories=["logistics", "courier"],
                         business_description="Same-day parcel delivery across Nairobi and Kiambu on 12 motorbikes.",
                         physical_location="Kenyatta Avenue, Nairobi", phone="+254700000004"),
}

STOCK = {
    "mama_mboga": [
        dict(name="Sukuma Wiki (bunch)", sku="SUK-1", category="fresh produce", quantity_in_stock=400, unit_of_measure="bunch",
             cost_price=15, wholesale_price=20, unit_price=30, min_order_quantity=20, tags=["greens", "daily"],
             bulk_discount_tiers=[{"qty": 100, "discount": 10}], quality_status="self_declared", batch_number="KB-2026-09-28",
             origin_country="Kenya"),
        dict(name="Spinach (bunch)", sku="SPN-1", category="fresh produce", quantity_in_stock=150, unit_of_measure="bunch",
             cost_price=20, wholesale_price=28, unit_price=40, min_order_quantity=10, tags=["greens"]),
        dict(name="Tomatoes (crate)", sku="TOM-C", category="fresh produce", quantity_in_stock=25, unit_of_measure="crate",
             cost_price=2800, wholesale_price=3400, unit_price=3900, min_order_quantity=1, tags=["tomatoes", "crate"],
             specifications={"grade": "A", "weight_kg": 64}, quality_status="self_declared", batch_number="MWEA-0927",
             origin_country="Kenya"),
        dict(name="Red Onions (net, 13kg)", sku="ONI-1", category="fresh produce", quantity_in_stock=60, unit_of_measure="net",
             cost_price=900, wholesale_price=1100, unit_price=1300, min_order_quantity=2, tags=["onions"],
             origin_country="Tanzania"),
        dict(name="Coriander (dhania, bunch)", sku="COR-1", category="fresh produce", quantity_in_stock=8, unit_of_measure="bunch",
             cost_price=8, wholesale_price=12, unit_price=20, min_order_quantity=10, tags=["herbs"]),
    ],
    "gikomba_textiles": [
        dict(name="Kitenge fabric (6 yards)", sku="KTG-6", category="textiles", quantity_in_stock=120, unit_of_measure="piece",
             cost_price=650, wholesale_price=850, unit_price=1200, min_order_quantity=5, tags=["kitenge", "fabric"],
             origin_country="Tanzania", quality_status="self_declared", batch_number="DAR-0915"),
        dict(name="Sweaters, grade A (mixed)", sku="SWT-M", category="clothing", quantity_in_stock=300, unit_of_measure="piece",
             cost_price=120, wholesale_price=180, unit_price=350, min_order_quantity=20, tags=["mitumba", "winter"]),
        dict(name="Kids' bale (45kg)", sku="BAL-K", category="clothing", quantity_in_stock=6, unit_of_measure="bale",
             cost_price=14000, wholesale_price=16500, unit_price=18000, min_order_quantity=1, tags=["bale", "kids"],
             origin_country="United Kingdom"),
    ],
}


class Client:
    def __init__(self):
        self.http = httpx.Client(base_url=BASE, timeout=30)
        self.tokens: dict[str, str] = {}
        self.ids: dict[str, str] = {}

    def auth(self, handle):
        return {"Authorization": f"Bearer {self.tokens[handle]}"}

    def call(self, handle, method, path, ok=(200, 201), **kw):
        r = self.http.request(method, path, headers=self.auth(handle) if handle else None, **kw)
        if r.status_code not in ok:
            raise SystemExit(f"{method} {path} as @{handle}: {r.status_code} {r.text[:300]}")
        return r.json() if r.content else None

    def soft(self, handle, method, path, **kw):
        """Like call() but tolerates 400/409 (already done)."""
        r = self.http.request(method, path, headers=self.auth(handle) if handle else None, **kw)
        if r.status_code in (200, 201):
            return r.json() if r.content else None
        if r.status_code in (400, 409):
            return None
        raise SystemExit(f"{method} {path} as @{handle}: {r.status_code} {r.text[:300]}")


def step(msg):
    print(f"  · {msg}")


def main():
    c = Client()
    print(f"Seeding {BASE}")

    # 1. accounts -----------------------------------------------------------------------
    for handle, info in VENDORS.items():
        r = c.http.post("/auth/register", json={"vendor_handle": handle, "email": f"{handle}@{DOMAIN}", "password": PASSWORD, **info})
        if r.status_code == 201:
            step(f"registered @{handle}")
        elif r.status_code == 400:
            r = c.http.post("/auth/login", data={"username": f"@{handle}", "password": PASSWORD})
            if r.status_code != 200:
                raise SystemExit(f"login @{handle}: {r.status_code} {r.text}")
            step(f"logged in @{handle}")
        else:
            raise SystemExit(f"register @{handle}: {r.status_code} {r.text}")
        tok = r.json()
        c.tokens[handle] = tok["access_token"]
        c.ids[handle] = tok["vendor_id"]

    c.call("mama_mboga", "PUT", "/vendors/me", json={"current_role": "selling", "geo_lat": -1.2745, "geo_lng": 36.8258})
    c.call("kibanda_kitchen", "PUT", "/vendors/me", json={"current_role": "sourcing", "geo_lat": -1.2833, "geo_lng": 36.8290})
    c.call("gikomba_textiles", "PUT", "/vendors/me", json={"current_role": "both", "geo_lat": -1.2811, "geo_lng": 36.8425})
    c.call("boda_express", "PUT", "/vendors/me", json={"current_role": "dormant"})
    c.call("mama_mboga", "PUT", "/vendors/me/profile", json={
        "primary_goods": ["sukuma wiki", "spinach", "tomatoes", "onions"], "accepts_bulk": True, "offers_credit": False,
        "operating_hours": {"mon-sat": "05:00-14:00"}, "warehouse_address": "Stall 41, Ngara Market"})
    c.call("kibanda_kitchen", "PUT", "/vendors/me/profile", json={
        "sourcing_interests": ["vegetables", "maize flour", "cooking oil"], "min_order_value": 2000, "accepts_bulk": True})
    c.soft("mama_mboga", "POST", "/vendors/become-patron")
    step("roles, profiles, patron")

    # 2. connections ----------------------------------------------------------------------
    for a, b in (("kibanda_kitchen", "mama_mboga"), ("gikomba_textiles", "mama_mboga"), ("kibanda_kitchen", "gikomba_textiles"),
                 ("boda_express", "mama_mboga"), ("boda_express", "kibanda_kitchen")):
        c.soft(a, "POST", f"/vendors/connect/{c.ids[b]}")
    step("connections")

    # 3. stock ----------------------------------------------------------------------------
    sku_ids: dict[str, str] = {}
    for handle, items in STOCK.items():
        mine = {s["sku"]: s["id"] for s in c.call(handle, "GET", "/stock/my-stock")}
        for item in items:
            if item["sku"] in mine:
                sku_ids[item["sku"]] = mine[item["sku"]]
                continue
            ack = c.call(handle, "POST", "/stock/add", json={"visible_to_network": True, **item})
            sku_ids[item["sku"]] = ack["stock_id"]
    step(f"{len(sku_ids)} stock items")

    # 4. lists, groups, niche room ------------------------------------------------------------
    lists = c.call("mama_mboga", "GET", "/vendor-lists/mine")
    vl = next((l for l in lists if l["name"] == "Nairobi Fresh Produce Vendors"), None)
    if not vl:
        ack = c.call("mama_mboga", "POST", "/vendor-lists/create", json={
            "name": "Nairobi Fresh Produce Vendors", "category": "fresh produce", "region": "Nairobi", "max_vendors": 40,
            "description": "Vetted growers and market sellers supplying Nairobi eateries. Approval within a day.",
            "entry_criteria": {"min_network_score": 0, "categories": ["fresh produce", "food service"]}})
        list_id = ack["list_id"]
    else:
        list_id = vl["id"]
    c.soft("kibanda_kitchen", "POST", f"/vendor-lists/{list_id}/register")       # stays pending → patron notification
    c.soft("gikomba_textiles", "POST", f"/vendor-lists/{list_id}/register")
    c.soft("mama_mboga", "POST", f"/vendor-lists/{list_id}/approve/{c.ids['gikomba_textiles']}")

    def ensure_group(owner, payload):
        mine = c.call(owner, "GET", "/groups/mine")
        g = next((g for g in mine if g["name"] == payload["name"]), None)
        return g["id"] if g else c.call(owner, "POST", "/groups/create", json=payload)["group_id"]

    wakulima = ensure_group("mama_mboga", {
        "name": "Wakulima Sourcing Collective", "group_type": "sourcing", "category": "fresh produce", "region": "Nairobi",
        "description": "Pool orders for crates and nets so we all buy at farm-gate prices.", "tags": ["bulk", "produce"],
        "rules": ["Post real quantities", "Pay the organiser within 24h of quota"]})
    eastlands = ensure_group("gikomba_textiles", {
        "name": "Eastlands Traders", "group_type": "regional", "region": "Eastlands", "requires_approval": True,
        "description": "Gikomba, Kamukunji and Burma traders — stock alerts, transport sharing, county notices.",
        "tags": ["eastlands", "textiles"]})
    for h in ("kibanda_kitchen", "gikomba_textiles"):
        c.soft(h, "POST", f"/groups/{wakulima}/join")
    c.soft("mama_mboga", "POST", f"/groups/{eastlands}/join")                    # pending → admin notification
    c.soft("gikomba_textiles", "POST", f"/groups/{eastlands}/approve/{c.ids['mama_mboga']}")

    rooms = c.call("gikomba_textiles", "GET", "/chat/rooms", params={"room_type": "niche"})
    if not any(r["name"] == "Import regulations" for r in rooms):
        c.call("gikomba_textiles", "POST", "/chat/niche-topic", json={
            "name": "Import regulations", "topic": "KRA, KEBS and county rules for imported bales and fabric",
            "topic_tags": ["kra", "kebs", "imports"]})
    step("lists, groups, niche room")

    # 5. movements: one completed, one pending hold -----------------------------------------------
    movements = c.call("kibanda_kitchen", "GET", "/stock/movements")
    if not any(m["sku"] == "SUK-1" and m["status"] == "received" for m in movements):
        ack = c.call("kibanda_kitchen", "POST", f"/stock/{sku_ids['SUK-1']}/source", json={"quantity": 40, "notes": "For the week. Pick up Monday 6am."})
        mid = ack["movement_id"]
        for actor, action in (("mama_mboga", "confirm"), ("mama_mboga", "ship"), ("kibanda_kitchen", "receive")):
            c.call(actor, "POST", f"/stock/movements/{mid}/{action}")
    if not any(m["sku"] == "TOM-C" and m["status"] == "pending" for m in movements):
        c.call("kibanda_kitchen", "POST", f"/stock/{sku_ids['TOM-C']}/source", json={"quantity": 2, "notes": "Two crates if grade A."})
    step("movements (1 received, 1 pending hold)")

    # 6. quality: self-declared via /verify + patron verification -------------------------------
    c.call("mama_mboga", "POST", f"/stock/{sku_ids['SPN-1']}/verify",
           data={"batch_number": "KB-2026-09-29", "origin_country": "Kenya",
                 "expiry_date": (datetime.utcnow() + timedelta(days=4)).isoformat()})
    c.soft("mama_mboga", "POST", f"/stock/{sku_ids['KTG-6']}/patron-verify")   # gikomba is an approved member of mama's list
    step("verification (self-declared + patron-verified)")

    # 7. deal protocol in a deal room ---------------------------------------------------------------
    deal = c.call("kibanda_kitchen", "POST", f"/chat/deal/{sku_ids['ONI-1']}")
    room_id = deal["room_id"]
    msgs = c.call("kibanda_kitchen", "GET", f"/chat/{room_id}/messages")
    if not any(m["message_type"] == "deal_proposal" for m in msgs):
        prop = c.call("kibanda_kitchen", "POST", f"/chat/{room_id}/message", json={
            "content": "Can you do 4 nets at 1,150 each? Collecting Saturday.", "message_type": "deal_proposal",
            "deal_data": {"stock_item_id": sku_ids["ONI-1"], "quantity": 4, "proposed_price_per_unit": 1150,
                          "delivery_terms": "pickup", "payment_terms": "on_delivery"}})
        counter = c.call("mama_mboga", "POST", f"/chat/{room_id}/deals/{prop['message_id']}/counter", json={
            "proposed_price_per_unit": 1200, "quantity": 4, "delivery_terms": "pickup", "payment_terms": "on_delivery",
            "notes": "1,200 and I keep the biggest nets for you."})
        c.call("kibanda_kitchen", "POST", f"/chat/{room_id}/deals/{counter['message_id']}/accept")
    step("deal proposal → counter → accepted (movement confirmed)")

    # 8. collective sourcing in Wakulima --------------------------------------------------------------
    reqs = c.call("mama_mboga", "GET", "/collective", params={"group_id": wakulima})
    if not reqs:
        ack = c.call("mama_mboga", "POST", "/collective/create", json={
            "group_id": wakulima, "item_name": "Grade A tomatoes (64kg crate)", "item_category": "fresh produce",
            "target_quantity": 30, "target_price_per_unit": 3200, "unit_of_measure": "crate",
            "description": "Mwea farm-gate price holds at 30 crates. Split the lorry.",
            "deadline": (datetime.utcnow() + timedelta(days=5)).isoformat()})
        cid = ack["collective_id"]
        c.call("kibanda_kitchen", "POST", f"/collective/{cid}/pledge", json={"pledged_quantity": 6, "max_price_per_unit": 3300})
        c.call("gikomba_textiles", "POST", f"/collective/{cid}/pledge", json={"pledged_quantity": 4, "notes": "For the staff canteen."})
    step("collective sourcing request with pledges")

    # 9. courier + shipment ---------------------------------------------------------------------------------
    couriers = c.call("boda_express", "GET", "/tools/couriers")
    courier = next((k for k in couriers if k["vendor_handle"] == "boda_express"), None)
    if not courier:
        c.call("boda_express", "POST", "/tools/courier/register", json={
            "courier_name": "Boda Express", "registration_number": "KMDA 442B", "coverage_areas": ["Nairobi CBD", "Eastlands", "Kiambu"],
            "service_types": ["same_day", "parcel", "cold_chain"], "price_per_kg": 25, "base_rate": 150})
        courier = next(k for k in c.call("boda_express", "GET", "/tools/couriers") if k["vendor_handle"] == "boda_express")
    shipments = c.call("mama_mboga", "GET", "/tools/shipments", params={"role": "sent"})
    if not shipments:
        ack = c.call("mama_mboga", "POST", f"/tools/couriers/{courier['id']}/shipments", json={
            "receiver_vendor_id": c.ids["kibanda_kitchen"], "origin": "Ngara Market", "destination": "Kirinyaga Road",
            "weight_kg": 18, "cost": 600, "notes": "40 bunches sukuma, keep upright."})
        sid = ack["shipment_id"]
        for status in ("in_transit", "out_for_delivery", "delivered"):
            c.call("boda_express", "POST", f"/tools/shipments/{sid}/status", params={"status": status})
        c.call("kibanda_kitchen", "POST", f"/tools/shipments/{sid}/rate", json={"rating": 5, "review": "40 minutes door to door."})
    step("courier registered, shipment delivered + rated")

    # 10. event with a registration -------------------------------------------------------------------------
    events = c.call("mama_mboga", "GET", "/events/mine")
    if not events:
        start = (datetime.utcnow() + timedelta(days=9)).replace(hour=6, minute=0, second=0, microsecond=0)
        ack = c.call("mama_mboga", "POST", "/events/create", json={
            "title": "Ngara Farm-Gate Saturday", "event_type": "market_day", "start_date": start.isoformat(),
            "end_date": (start + timedelta(hours=8)).isoformat(), "location": "Ngara Market, Nairobi", "max_vendors": 30,
            "description": "Farmers bring produce direct; eateries buy at farm-gate prices. Bring crates.",
            "vendor_requirements": {"categories": ["fresh produce", "food service"]}})
        c.call("kibanda_kitchen", "POST", f"/events/{ack['event_id']}/register")
    else:
        ev = events[0]
        if ev.get("registered_count", 0) == 0:
            c.soft("kibanda_kitchen", "POST", f"/events/{ev['id']}/register")
    step("event + registration")

    # 11. POS connection (CSV push) ---------------------------------------------------------------------------
    conns = c.call("mama_mboga", "GET", "/pos/connections")
    if not conns:
        c.call("mama_mboga", "POST", "/pos/connect", json={"pos_type": "csv", "connection_name": "Stall ledger (CSV)", "auto_sync": False})
    step("POS connection")

    unread = c.call("mama_mboga", "GET", "/notifications/unread-count")
    print(f"Done. @mama_mboga has {unread.get('unread_count', unread)} unread notifications. Password for all demo accounts: {PASSWORD}")


if __name__ == "__main__":
    try:
        main()
    except httpx.ConnectError:
        print(f"Cannot reach {BASE} — start the API first (python dev_local.py).", file=sys.stderr)
        sys.exit(1)

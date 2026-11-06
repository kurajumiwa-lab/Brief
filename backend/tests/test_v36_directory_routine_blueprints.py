"""v3.6 — public offer browse, knowledge directory, daily routine, free blueprints.

What these prove:
- anyone can browse shared stock with no account; new items show a plain label;
- only verified businesses can host; a promise is required; reviews need check-in;
- a delivered record is only possible after the session date;
- the Today window shows only checks that are switched on, and a dot only when
  something is waiting and not yet done today;
- a started blueprint puts its next step into Today; ticking it moves on;
- blueprints and the directory are readable with no account.
"""

import uuid
from datetime import datetime, timedelta

import pytest

from app.config import settings as live_settings
from tests.order_helpers import complete_self_pickup
from tests.test_v35_offers import PASSWORD, _add_stock, _register, _verified_seller

pytestmark = pytest.mark.asyncio


def _soon(days=1):
    return (datetime.utcnow() + timedelta(days=days)).replace(microsecond=0).isoformat()


def _past(days=3):
    return (datetime.utcnow() - timedelta(days=days)).replace(microsecond=0).isoformat()


PROMISE = "Leave able to price a product and cost one batch from start to finish."
DELIVERED = "Covered pricing, costing and a practice batch. Eleven of twelve attendees finished."


async def _listing(client, headers, **over):
    body = {"kind": "seminar", "title": "Pricing your product", "sector": "manufacturing",
            "summary": "A short practical session.", "price_kes": 500, "starts_at": _soon(),
            "location": "Kisumu", "capacity": 3, "promised_outcomes": PROMISE, **over}
    r = await client.post("/api/knowledge/listings", headers=headers, json=body)
    assert r.status_code == 201, r.text
    lid = r.json()["id"]
    p = await client.post(f"/api/knowledge/listings/{lid}/publish", headers=headers)
    assert p.status_code == 200, p.text
    return lid


# ---------- public offer browse ------------------------------------------------------------

async def test_public_browse_needs_no_account_and_labels_new_goods(client, monkeypatch):
    _, supplier, _ = await _verified_seller(client, monkeypatch, "pub1")
    stock_id = await _add_stock(client, supplier, name="Pub Browse Soap")
    r = await client.get("/api/offers/public", params={"q": "Pub Browse"})
    assert r.status_code == 200, r.text
    item = next(i for i in r.json()["offers"] if i["id"] == stock_id)
    assert item["trust"]["level"] == "new"
    assert item["trust"]["label"] == "New on the network"
    assert item["seller"]["verified"] is True
    assert "phone" not in str(item) and "email" not in str(item)


async def test_public_browse_marks_confirmed_after_a_deal(client, monkeypatch):
    _, supplier, _ = await _verified_seller(client, monkeypatch, "pub2")
    _, buyer, _ = await _register(client, "pub2b")
    stock_id = await _add_stock(client, supplier, name="Pub Deal Oil")
    src = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 2})
    await complete_self_pickup(client, src.json()["movement_id"], supplier, buyer)
    rows = (await client.get("/api/offers/public", params={"q": "Pub Deal Oil"})).json()["offers"]
    assert rows[0]["trust"]["level"] == "confirmed"


async def test_unverified_seller_items_are_visible_but_labelled(client):
    _, supplier, _ = await _register(client, "pub3u")
    stock_id = await _add_stock(client, supplier, name="Pub Unverified Flour")
    rows = (await client.get("/api/offers/public", params={"q": "Pub Unverified"})).json()["offers"]
    item = next(i for i in rows if i["id"] == stock_id)
    assert item["trust"]["label"] == "New: seller not yet verified"


# ---------- knowledge directory ------------------------------------------------------------

async def test_sectors_and_browse_are_public(client):
    r = await client.get("/api/knowledge/sectors")
    keys = [s["key"] for s in r.json()["sectors"]]
    assert {"agriculture", "retail", "manufacturing", "hospitality", "beauty", "technology"} <= set(keys)
    assert (await client.get("/api/knowledge/listings")).status_code == 200


async def test_unverified_business_cannot_host(client):
    _, headers, _ = await _register(client, "kn1")
    r = await client.post("/api/knowledge/listings", headers=headers, json={
        "title": "Not allowed yet", "sector": "retail", "promised_outcomes": PROMISE})
    assert r.status_code == 403


async def test_promise_is_required_and_sector_must_be_known(client, monkeypatch):
    _, headers, _ = await _verified_seller(client, monkeypatch, "kn2")
    short = await client.post("/api/knowledge/listings", headers=headers, json={
        "title": "Too vague", "sector": "retail", "promised_outcomes": "Be better"})
    assert short.status_code == 422
    bad_sector = await client.post("/api/knowledge/listings", headers=headers, json={
        "title": "Wrong sector", "sector": "space-mining", "promised_outcomes": PROMISE})
    assert bad_sector.status_code == 422


async def test_draft_is_hidden_until_published(client, monkeypatch):
    _, headers, _ = await _verified_seller(client, monkeypatch, "kn3")
    r = await client.post("/api/knowledge/listings", headers=headers, json={
        "title": "Draft session", "sector": "retail", "promised_outcomes": PROMISE})
    lid = r.json()["id"]
    assert (await client.get(f"/api/knowledge/listings/{lid}")).status_code == 404
    await client.post(f"/api/knowledge/listings/{lid}/publish", headers=headers)
    assert (await client.get(f"/api/knowledge/listings/{lid}")).status_code == 200


async def test_registration_capacity_and_check_in_by_organiser_only(client, monkeypatch):
    _, host, _ = await _verified_seller(client, monkeypatch, "kn4")
    lid = await _listing(client, host, capacity=1)
    _, a, _ = await _register(client, "kn4a")
    _, b, _ = await _register(client, "kn4b")
    _, c, cid = await _register(client, "kn4c")
    assert (await client.post(f"/api/knowledge/listings/{lid}/register", headers=a)).status_code == 200
    assert (await client.post(f"/api/knowledge/listings/{lid}/register", headers=b)).status_code == 409  # full
    # Only the organiser can check people in. Anyone else gets 404, so the list is not revealed.
    _, _, aid = await _register(client, "kn4aa")
    assert (await client.post(f"/api/knowledge/listings/{lid}/check-in/{aid}", headers=a)).status_code == 404
    listing = (await client.get(f"/api/knowledge/listings/{lid}")).json()
    assert listing["attendee_count"] == 1 and listing["spaces_left"] == 0
    assert c and cid  # third party unused here


async def test_review_needs_check_in_then_one_per_person(client, monkeypatch):
    _, host, _ = await _verified_seller(client, monkeypatch, "kn5")
    lid = await _listing(client, host)
    _, a, aid_ = await _register(client, "kn5a")
    await client.post(f"/api/knowledge/listings/{lid}/register", headers=a)
    early = await client.post(f"/api/knowledge/listings/{lid}/review", headers=a, json={"rating": 5})
    assert early.status_code == 403
    attendees = (await client.get(f"/api/knowledge/listings/{lid}/attendees", headers=host)).json()["attendees"]
    me = next(x for x in attendees if x["business"].startswith("kn5a"))
    ci = await client.post(f"/api/knowledge/listings/{lid}/check-in/{me['vendor_id']}", headers=host)
    assert ci.status_code == 200 and ci.json()["checked_in"] is True
    ok = await client.post(f"/api/knowledge/listings/{lid}/review", headers=a, json={"rating": 4, "comment": "Clear"})
    assert ok.status_code == 201
    again = await client.post(f"/api/knowledge/listings/{lid}/review", headers=a, json={"rating": 1})
    assert again.status_code == 409
    detail = (await client.get(f"/api/knowledge/listings/{lid}")).json()
    assert detail["rating"] == 4.0 and detail["review_count"] == 1


async def test_delivered_record_only_after_the_session_date(client, monkeypatch):
    _, host, _ = await _verified_seller(client, monkeypatch, "kn6")
    future = await _listing(client, host, title="Future session")
    early = await client.post(f"/api/knowledge/listings/{future}/deliver", headers=host,
                              json={"delivered_outcomes": DELIVERED})
    assert early.status_code == 400
    past = await _listing(client, host, title="Past session", starts_at=_past())
    done = await client.post(f"/api/knowledge/listings/{past}/deliver", headers=host,
                             json={"delivered_outcomes": DELIVERED})
    assert done.status_code == 200 and done.json()["status"] == "completed"
    detail = (await client.get(f"/api/knowledge/listings/{past}")).json()
    assert detail["delivered_outcomes"] == DELIVERED
    assert detail["record_status"].startswith("Delivered record")


async def test_promised_only_is_said_plainly_before_delivery(client, monkeypatch):
    _, host, _ = await _verified_seller(client, monkeypatch, "kn7")
    lid = await _listing(client, host)
    detail = (await client.get(f"/api/knowledge/listings/{lid}")).json()
    assert detail["record_status"].startswith("Promised only")


async def test_browse_filters_by_sector_and_hides_cancelled(client, monkeypatch):
    _, host, _ = await _verified_seller(client, monkeypatch, "kn8")
    keep = await _listing(client, host, title="Hospitality filter check", sector="hospitality")
    gone = await _listing(client, host, title="Hospitality cancelled check", sector="hospitality")
    await client.post(f"/api/knowledge/listings/{gone}/cancel", headers=host)
    ids = [l["id"] for l in (await client.get("/api/knowledge/listings",
                                              params={"sector": "hospitality", "q": "Hospitality"})).json()["listings"]]
    assert keep in ids and gone not in ids


# ---------- daily routine ------------------------------------------------------------------

async def test_defaults_and_switching_checks(client):
    _, headers, _ = await _register(client, "rt1")
    cat = {c["key"]: c["enabled"] for c in (await client.get("/api/routine/catalogue", headers=headers)).json()["checks"]}
    assert cat["appointments"] is True and cat["today_plans"] is True and cat["stock_out"] is True
    assert cat["offers"] is False and cat["sessions"] is False
    r = await client.put("/api/routine/preferences", headers=headers, json={"checks": {"appointments": False}})
    assert r.status_code == 200
    today = (await client.get("/api/routine/today", headers=headers)).json()
    assert "appointments" not in [i["key"] for i in today["items"]]
    bad = await client.put("/api/routine/preferences", headers=headers, json={"checks": {"made-up": True}})
    assert bad.status_code == 422


async def test_sold_out_stock_makes_a_dot_until_marked_done(client):
    _, headers, _ = await _register(client, "rt2")
    await _add_stock(client, headers, name="Routine Empty Rice", quantity_in_stock=0)
    today = (await client.get("/api/routine/today", headers=headers)).json()
    item = next(i for i in today["items"] if i["key"] == "stock_out")
    assert item["dot"] is True and item["count"] >= 1
    assert today["dots"] >= 1
    await client.post("/api/routine/done/stock_out", headers=headers)
    item = next(i for i in (await client.get("/api/routine/today", headers=headers)).json()["items"]
                if i["key"] == "stock_out")
    assert item["done"] is True and item["dot"] is False
    await client.delete("/api/routine/done/stock_out", headers=headers)


async def test_every_check_says_why(client):
    _, headers, _ = await _register(client, "rt3")
    checks = (await client.get("/api/routine/catalogue", headers=headers)).json()["checks"]
    assert checks and all(c["why"] and len(c["why"]) > 30 for c in checks)


async def test_unknown_check_cannot_be_marked(client):
    _, headers, _ = await _register(client, "rt4")
    assert (await client.post("/api/routine/done/not-a-check", headers=headers)).status_code == 404


# ---------- free blueprints ----------------------------------------------------------------

async def test_library_and_steps_are_public_and_free(client):
    lib = (await client.get("/api/blueprints")).json()["blueprints"]
    assert {"market-stall", "home-soap", "food-catering", "beauty-salon"} <= {b["key"] for b in lib}
    assert all(b["cost"] == "Free" for b in lib)
    one = (await client.get("/api/blueprints/home-soap")).json()
    assert one["steps"] and all(s["detail"] for s in one["steps"])
    assert (await client.get("/api/blueprints/no-such")).status_code == 404


async def test_started_blueprint_feeds_today_and_steps_move_on(client):
    _, headers, _ = await _register(client, "bp1")
    assert (await client.post("/api/blueprints/market-stall/start", headers=headers)).json()["created"] is True
    assert (await client.post("/api/blueprints/market-stall/start", headers=headers)).json()["created"] is False
    keys = [i["key"] for i in (await client.get("/api/routine/today", headers=headers)).json()["items"]]
    assert "bp:market-stall:choose-items" in keys
    await client.post("/api/blueprints/market-stall/steps/choose-items", headers=headers)
    keys = [i["key"] for i in (await client.get("/api/routine/today", headers=headers)).json()["items"]]
    assert "bp:market-stall:choose-items" not in keys
    assert "bp:market-stall:start-money" in keys


async def test_step_needs_a_started_blueprint_and_a_real_step(client):
    _, headers, _ = await _register(client, "bp2")
    r = await client.post("/api/blueprints/home-soap/steps/label", headers=headers)
    assert r.status_code == 409
    await client.post("/api/blueprints/home-soap/start", headers=headers)
    r = await client.post("/api/blueprints/home-soap/steps/not-a-step", headers=headers)
    assert r.status_code == 404


async def test_untick_brings_a_step_back(client):
    _, headers, _ = await _register(client, "bp3")
    await client.post("/api/blueprints/beauty-salon/start", headers=headers)
    await client.post("/api/blueprints/beauty-salon/steps/services-prices", headers=headers)
    await client.delete("/api/blueprints/beauty-salon/steps/services-prices", headers=headers)
    mine = (await client.get("/api/blueprints/mine/progress", headers=headers)).json()["started"][0]
    assert mine["done_count"] == 0


# ---------- the gate: public reads only, personal routes still need an account --------

async def test_personal_and_write_routes_still_need_an_account(client):
    assert (await client.get("/api/routine/today")).status_code == 401
    assert (await client.get("/api/knowledge/mine")).status_code == 401
    assert (await client.get("/api/blueprints/mine/progress")).status_code == 401
    assert (await client.post("/api/blueprints/market-stall/start")).status_code == 401
    assert (await client.post("/api/knowledge/listings", json={})).status_code == 401
    assert (await client.get("/api/knowledge/listings/00000000-0000-0000-0000-000000000000/me")).status_code in (401, 404)

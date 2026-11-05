"""v3.5 — verified offer shelf.

What these prove:
- an offer reaches the primary shelf only when its seller is verified AND a
  different business has completed a deal for it, or the Brief team confirmed it
  by hand (and the seller is verified);
- a deal that is not yet received does not count;
- an unverified seller never reaches the shelf, even if confirmed by hand;
- a seller sees the status of each of their items and why;
- only the Brief team (governance admin) can confirm or un-confirm by hand.
"""

import uuid

import pytest

from app.config import settings as live_settings
from app.modules.offers.service import CONFIRMED, HIDDEN, LISTED, decide
from tests.order_helpers import complete_self_pickup

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


# ---------- the rule itself (no database) ---------------------------------------------

def test_hidden_when_not_shared_whatever_else_is_true():
    d = decide(shared=False, seller_verified=True, other_business_deals=3, by_hand=True)
    assert d.status == HIDDEN


def test_unverified_seller_is_listed_even_with_deals_or_hand_confirmation():
    assert decide(shared=True, seller_verified=False, other_business_deals=5, by_hand=True).status == LISTED


def test_verified_seller_with_one_other_business_deal_is_confirmed():
    d = decide(shared=True, seller_verified=True, other_business_deals=1, by_hand=False)
    assert d.status == CONFIRMED and "1 other business completed" in d.reason


def test_verified_seller_by_hand_is_confirmed_without_deals():
    assert decide(shared=True, seller_verified=True, other_business_deals=0, by_hand=True).status == CONFIRMED


def test_verified_seller_with_no_deals_is_listed_and_says_why():
    d = decide(shared=True, seller_verified=True, other_business_deals=0, by_hand=False)
    assert d.status == LISTED and "first completed deal" in d.reason


# ---------- helpers ----------------------------------------------------------------------

async def _register(client, prefix):
    handle = f"{prefix}_{uuid.uuid4().hex[:8]}"
    r = await client.post("/api/auth/register", json={
        "account_kind": "business",
        "display_name": prefix,
        "business_name": f"{prefix} Ltd",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["produce"],
    })
    assert r.status_code == 201, r.text
    return handle, {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["vendor_id"]


async def _verified_seller(client, monkeypatch, prefix):
    """A business that has been through membership verification by an operator."""
    op_handle, op_headers, _ = await _register(client, "opv")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", op_handle)
    handle, headers, vid = await _register(client, prefix)
    assert (await client.post("/api/membership/me/verification", headers=headers)).status_code == 201
    r = await client.post(f"/api/membership/admin/{vid}/verification", headers=op_headers,
                          json={"decision": "approve", "note": "ID checked"})
    assert r.status_code == 200, r.text
    return handle, headers, vid


async def _add_stock(client, headers, name="Grade A Maize", **overrides):
    payload = {
        "name": name,
        "sku": f"SKU-{uuid.uuid4().hex[:6]}",
        "category": "produce",
        "quantity_in_stock": overrides.get("quantity_in_stock", 50),
        "unit_of_measure": "bag",
        "unit_price": 3200,
        "wholesale_price": 3000,
        "min_order_quantity": 2,
        "visible_to_network": overrides.get("visible_to_network", True),
    }
    r = await client.post("/api/stock/add", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    return r.json()["stock_id"]


async def _shelf_ids(client, headers):
    r = await client.get("/api/offers/confirmed", headers=headers)
    assert r.status_code == 200, r.text
    return [o["id"] for o in r.json()["offers"]]


async def _my_status(client, headers, stock_id):
    items = (await client.get("/api/offers/mine", headers=headers)).json()["items"]
    return next(i for i in items if i["id"] == stock_id)


@pytest.fixture
def ops(monkeypatch):
    """Make the caller the Brief team (governance admin) for the test."""
    def grant(handle):
        monkeypatch.setattr(live_settings, "MARKET_OPS_ROLES", f"admin:{handle}")
    return grant


# ---------- the shelf and the deal gate --------------------------------------------------

async def test_unverified_seller_with_a_completed_deal_stays_off_the_shelf(client):
    _, supplier, _ = await _register(client, "unv")
    _, buyer, _ = await _register(client, "unvb")
    stock_id = await _add_stock(client, supplier)
    src = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 5})
    await complete_self_pickup(client, src.json()["movement_id"], supplier, buyer)

    assert stock_id not in await _shelf_ids(client, buyer)
    assert (await _my_status(client, supplier, stock_id))["reason"].startswith("Waiting for the business to be verified")


async def test_verified_seller_listed_until_a_deal_is_received(client, monkeypatch):
    _, supplier, _ = await _verified_seller(client, monkeypatch, "dl")
    _, buyer, _ = await _register(client, "dlb")
    stock_id = await _add_stock(client, supplier)

    # A pending deal does not count.
    src = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 5})
    assert src.status_code == 201, src.text
    assert stock_id not in await _shelf_ids(client, buyer)
    assert (await _my_status(client, supplier, stock_id))["status"] == LISTED

    # Once it is received, it is confirmed and visible to other businesses.
    await complete_self_pickup(client, src.json()["movement_id"], supplier, buyer)
    assert stock_id in await _shelf_ids(client, buyer)
    mine = await _my_status(client, supplier, stock_id)
    assert mine["status"] == CONFIRMED and "completed a deal" in mine["reason"]


async def test_seller_does_not_see_own_offer_on_the_shelf(client, monkeypatch):
    _, supplier, _ = await _verified_seller(client, monkeypatch, "own")
    _, buyer, _ = await _register(client, "ownb")
    stock_id = await _add_stock(client, supplier)
    src = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 2})
    await complete_self_pickup(client, src.json()["movement_id"], supplier, buyer)
    assert stock_id not in await _shelf_ids(client, supplier)


async def test_item_not_shared_with_network_is_hidden_even_after_a_deal(client, monkeypatch):
    _, supplier, _ = await _verified_seller(client, monkeypatch, "hid")
    _, buyer, _ = await _register(client, "hidb")
    stock_id = await _add_stock(client, supplier, visible_to_network=False)
    assert stock_id not in await _shelf_ids(client, buyer)
    assert (await _my_status(client, supplier, stock_id))["status"] == HIDDEN


# ---------- manual confirmation by the Brief team ----------------------------------------

async def test_only_the_brief_team_can_confirm_by_hand(client, monkeypatch):
    _, supplier, _ = await _verified_seller(client, monkeypatch, "hand1")
    _, other, _ = await _register(client, "hand1o")
    stock_id = await _add_stock(client, supplier)
    r = await client.post(f"/api/offers/{stock_id}/confirm", headers=other,
                          json={"reason": "Looks good to me"})
    assert r.status_code == 403


async def test_hand_confirmation_needs_a_real_reason_and_a_verified_seller(client, monkeypatch, ops):
    team_handle, team, _ = await _register(client, "team1")
    ops(team_handle)
    _, unverified, _ = await _register(client, "hand2u")
    unverified_item = await _add_stock(client, unverified)
    _, verified, _ = await _verified_seller(client, monkeypatch, "hand2v")
    verified_item = await _add_stock(client, verified)

    short = await client.post(f"/api/offers/{verified_item}/confirm", headers=team, json={"reason": "ok"})
    assert short.status_code == 422

    refused = await client.post(f"/api/offers/{unverified_item}/confirm", headers=team,
                                json={"reason": "Checked the shop in person"})
    assert refused.status_code == 409

    ok = await client.post(f"/api/offers/{verified_item}/confirm", headers=team,
                           json={"reason": "Visited the shop, stock and prices checked"})
    assert ok.status_code == 200 and ok.json()["created"] is True


async def test_hand_confirmed_offer_reaches_the_shelf_and_can_be_taken_back(client, monkeypatch, ops):
    team_handle, team, _ = await _register(client, "team2")
    ops(team_handle)
    _, verified, _ = await _verified_seller(client, monkeypatch, "hand3v")
    _, buyer, _ = await _register(client, "hand3b")
    stock_id = await _add_stock(client, verified)
    assert stock_id not in await _shelf_ids(client, buyer)

    await client.post(f"/api/offers/{stock_id}/confirm", headers=team,
                      json={"reason": "Visited the shop, stock and prices checked"})
    assert stock_id in await _shelf_ids(client, buyer)
    mine = await _my_status(client, verified, stock_id)
    assert mine["status"] == CONFIRMED and mine["reason"] == "Confirmed by the Brief team."

    removed = await client.delete(f"/api/offers/{stock_id}/confirm", headers=team)
    assert removed.status_code == 200 and removed.json()["removed"] is True
    assert stock_id not in await _shelf_ids(client, buyer)


async def test_second_hand_confirmation_is_a_no_op(client, monkeypatch, ops):
    team_handle, team, _ = await _register(client, "team3")
    ops(team_handle)
    _, verified, _ = await _verified_seller(client, monkeypatch, "hand4v")
    stock_id = await _add_stock(client, verified)
    first = await client.post(f"/api/offers/{stock_id}/confirm", headers=team,
                              json={"reason": "Visited the shop, stock and prices checked"})
    again = await client.post(f"/api/offers/{stock_id}/confirm", headers=team,
                              json={"reason": "Visited the shop, stock and prices checked"})
    assert first.json()["created"] is True and again.json()["created"] is False

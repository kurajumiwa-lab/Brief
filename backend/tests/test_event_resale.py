"""Second-hand pass resale: one listing, atomic handover, no double seat."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.database import async_session
from app.models.vendor import Vendor
from tests.test_smoke import _auth, _register

pytestmark = pytest.mark.asyncio


async def _paid_event(client, host_headers, *, fee=1000, capacity=1):
    start = datetime.utcnow() + timedelta(days=10)
    response = await client.post("/api/events/create", headers=host_headers, json={
        "title": "Rooftop listening session",
        "description": "A small paid show.",
        "event_type": "networking",
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(hours=4)).isoformat(),
        "location": "Kisumu, Milimani",
        "max_vendors": capacity,
        "entry_fee": fee,
        "payment_method": "CASH",
    })
    assert response.status_code == 201, response.text
    return response.json()["event_id"]


async def _confirmed_pass(client, host_headers, seller_headers, event_id):
    booked = await client.post(f"/api/events/{event_id}/register", headers=seller_headers)
    assert booked.status_code == 200, booked.text
    rid = booked.json()["registration"]["id"]
    confirmed = await client.post(f"/api/events/{event_id}/confirm-payment/{rid}", headers=host_headers)
    assert confirmed.status_code == 200, confirmed.text
    return rid, confirmed.json()["pass_code"]


async def test_listing_claim_and_atomic_handover(client):
    host, seller, buyer = [await _register(client, name, ["events"])
                           for name in ("resale_host", "resale_seller", "resale_buyer")]
    h, s, b = (_auth(x["access_token"]) for x in (host, seller, buyer))
    event_id = await _paid_event(client, h)
    rid, old_code = await _confirmed_pass(client, h, s, event_id)

    eligible = await client.get("/api/event-desk/resale/eligible", headers=s)
    assert eligible.status_code == 200, eligible.text
    assert [p["registration_id"] for p in eligible.json()["passes"]] == [rid]
    assert eligible.json()["passes"][0]["max_price_kes"] == 1000

    too_much = await client.post("/api/event-desk/resale/list", headers=s, json={
        "registration_id": rid, "price_kes": 1500, "note": "Touting",
    })
    assert too_much.status_code == 422

    listed = await client.post("/api/event-desk/resale/list", headers=s, json={
        "registration_id": rid, "price_kes": 900, "note": "Can't make it — balcony seat.",
    })
    assert listed.status_code == 201, listed.text
    resale_id = listed.json()["listing"]["id"]
    assert listed.json()["listing"]["status"] == "listed"

    # The unique registration constraint is the double-listing lock.
    again = await client.post("/api/event-desk/resale/list", headers=s, json={
        "registration_id": rid, "price_kes": 800,
    })
    assert again.status_code == 409

    board = await client.get("/api/event-desk/resale/board", headers=b)
    assert [x["id"] for x in board.json()["listings"]] == [resale_id]
    assert board.json()["listings"][0]["seller"]["handle"] == seller["vendor_handle"]
    assert board.json()["listings"][0]["contact"] is None

    own = await client.post(f"/api/event-desk/resale/{resale_id}/claim", headers=s)
    assert own.status_code == 409

    claimed = await client.post(f"/api/event-desk/resale/{resale_id}/claim", headers=b)
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["listing"]["status"] == "claimed"
    assert claimed.json()["listing"]["contact"]["handle"] == seller["vendor_handle"]
    assert claimed.json()["listing"]["pass_code"] is None

    second = await client.post(f"/api/event-desk/resale/{resale_id}/claim", headers=h)
    assert second.status_code == 409

    # One side is not enough.
    one = await client.post(f"/api/event-desk/resale/{resale_id}/handover", headers=s)
    assert one.status_code == 200
    assert one.json()["listing"]["status"] == "claimed"
    assert one.json()["listing"]["seller_confirmed"] is True
    assert one.json()["listing"]["buyer_confirmed"] is False

    done = await client.post(f"/api/event-desk/resale/{resale_id}/handover", headers=b)
    assert done.status_code == 200, done.text
    listing = done.json()["listing"]
    assert listing["status"] == "completed"
    new_code = listing["pass_code"]
    assert new_code and new_code != old_code

    # The seat moved, it did not multiply.
    buyer_event = await client.get(f"/api/events/{event_id}", headers=b)
    assert buyer_event.json()["my_booking_status"] == "CONFIRMED"
    assert buyer_event.json()["my_registration"]["pass_code"] == new_code
    assert buyer_event.json()["my_registration"]["transferred"] is True
    assert buyer_event.json()["my_registration"]["mpesa_code"] is None
    assert buyer_event.json()["confirmed_count"] == 1
    assert buyer_event.json()["spots_left"] == 0

    seller_event = await client.get(f"/api/events/{event_id}", headers=s)
    assert seller_event.json()["my_registration"] is None

    agenda = await client.get("/api/outside/agenda", headers=b)
    item = next(x for x in agenda.json()["items"] if x["kind"] == "event" and x["title"] == "Rooftop listening session")
    assert item["pass_code"] == new_code

    async with async_session() as db:
        seller_row = await db.get(Vendor, seller["vendor_id"])
        buyer_row = await db.get(Vendor, buyer["vendor_id"])
        assert seller_row.resale_trades == 1
        assert buyer_row.resale_trades == 1

    late_cancel = await client.post(f"/api/event-desk/resale/{resale_id}/cancel", headers=s)
    assert late_cancel.status_code == 409

    # A seller cannot re-list the same pass after a completed handover.
    relist = await client.post("/api/event-desk/resale/list", headers=s, json={
        "registration_id": rid, "price_kes": 0,
    })
    assert relist.status_code in (404, 409)


async def test_buyer_with_a_booking_cannot_claim_and_seller_can_withdraw(client):
    host, seller, buyer, other = [await _register(client, name, ["events"])
                                  for name in ("withdraw_host", "withdraw_seller", "withdraw_buyer", "withdraw_other")]
    h, s, b, o = (_auth(x["access_token"]) for x in (host, seller, buyer, other))
    event_id = await _paid_event(client, h, capacity=2)
    rid, _ = await _confirmed_pass(client, h, s, event_id)
    occupied = await client.post(f"/api/events/{event_id}/register", headers=b)
    assert occupied.status_code == 200

    listed = await client.post("/api/event-desk/resale/list", headers=s, json={
        "registration_id": rid, "price_kes": 500,
    })
    assert listed.status_code == 201, listed.text
    resale_id = listed.json()["listing"]["id"]

    blocked = await client.post(f"/api/event-desk/resale/{resale_id}/claim", headers=b)
    assert blocked.status_code == 409

    claimed = await client.post(f"/api/event-desk/resale/{resale_id}/claim", headers=o)
    assert claimed.status_code == 200
    released = await client.post(f"/api/event-desk/resale/{resale_id}/release", headers=o)
    assert released.status_code == 200
    assert released.json()["listing"]["status"] == "listed"

    withdrawn = await client.post(f"/api/event-desk/resale/{resale_id}/cancel", headers=s)
    assert withdrawn.status_code == 200
    assert withdrawn.json()["listing"]["status"] == "cancelled"
    assert (await client.get("/api/event-desk/resale/board", headers=o)).json()["listings"] == []

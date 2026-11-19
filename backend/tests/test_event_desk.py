"""Contract tests for the event vendor desk.

The wedge must work as one loop, not as four disconnected endpoints:
build a rate card → broadcast a structured request → quote → accept → contact.
"""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from tests.test_smoke import _auth, _register

pytestmark = pytest.mark.asyncio


async def _event(client, headers, *, title="Kisumu garden wedding", days=21):
    start = datetime.utcnow() + timedelta(days=days)
    response = await client.post("/api/events/create", headers=headers, json={
        "title": title,
        "description": "A garden ceremony for 120 guests.",
        "event_type": "wedding",
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(hours=8)).isoformat(),
        "location": "Kisumu, Milimani",
        "entry_fee": 0,
    })
    assert response.status_code == 201, response.text
    return response.json()["event_id"], start


async def _rate_card(client, headers):
    saved = await client.put("/api/event-desk/rate-card", headers=headers, json={
        "headline": "Garden weddings, set up before the first guest",
        "summary": "Full decor, tables and lighting for 120 guests in Kisumu and Kisii.",
        "event_categories": ["decor", "sound_lighting"],
        "proof_links": [
            {"label": "Last wedding, Kisumu", "url": "https://example.com/portfolio/1", "kind": "portfolio"},
        ],
        "reach_claims": [
            {"platform": "TikTok", "metric": "views on the last setup", "value": "48K", "note": "Self-reported"},
        ],
        "is_public": True,
    })
    assert saved.status_code == 200, saved.text
    packages = await client.put("/api/event-desk/rate-card/packages", headers=headers, json={
        "packages": [
            {"name": "Ceremony decor", "description": "Arch, aisle and 120 chairs.",
             "price_kes": 85000, "price_unit": "per_event",
             "inclusions": ["Arch", "Aisle flowers", "120 chairs"], "is_active": True, "sort_order": 0},
            {"name": "Reception lighting", "description": "Warm bulbs and a small PA.",
             "price_kes": 32000, "price_unit": "per_event",
             "inclusions": ["Festoon lights", "PA", "One technician"], "is_active": True, "sort_order": 1},
        ]
    })
    assert packages.status_code == 200, packages.text
    return saved.json()["rate_card"], packages.json()["rate_card"]


async def _request(client, headers, event_id, start, **overrides):
    body = {
        "title": "Decor and lighting for a garden wedding",
        "category": "decor",
        "brief": "We need an arch, aisle flowers and warm reception lighting. Setup from 6am.",
        "budget_min_kes": 90000,
        "budget_max_kes": 140000,
        "payer": "organizer",
        "requirements": {
            "access_time": "From 6:00am",
            "power": "One 13A socket at the reception",
            "parking": "Two vans inside the compound",
            "setup": "No drilling into the pergola",
            "notes": "The ceremony starts at 11am.",
        },
        "response_deadline": (start - timedelta(days=7)).isoformat(),
    }
    body.update(overrides)
    response = await client.post(f"/api/event-desk/events/{event_id}/requests", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()["request"]


async def test_rate_card_is_built_published_and_read_without_an_account(client):
    vendor = await _register(client, "decor_maker", ["decor"])
    headers = _auth(vendor["access_token"])

    empty = await client.get("/api/event-desk/rate-card", headers=headers)
    assert empty.status_code == 200 and empty.json()["rate_card"] is None

    card, with_packages = await _rate_card(client, headers)
    assert card["headline"].startswith("Garden weddings")
    assert [p["name"] for p in with_packages["packages"]] == ["Ceremony decor", "Reception lighting"]
    assert with_packages["proof_links"][0]["verification"] == "self_reported"
    assert with_packages["reach_claims"][0]["source"] == "self_reported"

    # Editing keeps the package id so an existing quote keeps its reference.
    package_id = with_packages["packages"][0]["id"]
    edited = await client.put("/api/event-desk/rate-card/packages", headers=headers, json={
        "packages": [{
            "id": package_id, "name": "Ceremony decor", "description": "Arch, aisle and 120 chairs.",
            "price_kes": 90000, "price_unit": "per_event",
            "inclusions": ["Arch", "Aisle flowers", "120 chairs"], "is_active": True, "sort_order": 0,
        }]
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["rate_card"]["packages"][0]["id"] == package_id
    assert edited.json()["rate_card"]["packages"][0]["price_kes"] == 90000

    public = await client.get(f"/api/event-desk/public/rate-cards/{vendor['vendor_handle']}")
    assert public.status_code == 200, public.text
    assert public.json()["vendor"]["handle"] == vendor["vendor_handle"]
    assert public.json()["packages"][0]["price_kes"] == 90000
    assert "phone" not in public.text.lower() or "contact" not in public.text.lower()

    hidden = await client.put("/api/event-desk/rate-card", headers=headers, json={
        "headline": "Garden weddings, set up before the first guest",
        "summary": "", "event_categories": ["decor"], "proof_links": [], "reach_claims": [],
        "is_public": False,
    })
    assert hidden.status_code == 200
    assert (await client.get(f"/api/event-desk/public/rate-cards/{vendor['vendor_handle']}")).status_code == 404

    bad_link = await client.put("/api/event-desk/rate-card", headers=headers, json={
        "headline": "Garden weddings", "summary": "",
        "proof_links": [{"label": "x", "url": "http://example.com", "kind": "portfolio"}],
    })
    assert bad_link.status_code == 422


async def test_the_loop_broadcast_quote_accept_and_open_contacts(client):
    organiser, decorator, caterer, onlooker = [
        await _register(client, name, ["events"])
        for name in ("wedding_organiser", "decor_vendor", "caterer_vendor", "curious_vendor")
    ]
    oh, dh, ch, xh = (_auth(x["access_token"]) for x in (organiser, decorator, caterer, onlooker))
    event_id, start = await _event(client, oh)

    request = await _request(client, oh, event_id, start)
    assert request["status"] == "open" and request["quote_count"] == 0
    assert request["requirements"]["parking"] == "Two vans inside the compound"

    board = await client.get("/api/event-desk/requests?category=decor&region=Kisumu", headers=dh)
    assert board.status_code == 200, board.text
    assert [r["id"] for r in board.json()["requests"]] == [request["id"]]
    assert board.json()["requests"][0]["can_quote"] is True

    card, with_packages = await _rate_card(client, dh)
    package_id = with_packages["packages"][0]["id"]
    first = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=dh, json={
        "amount_kes": 110000, "package_id": package_id,
        "message": "We can do the arch, aisle and lighting as one crew.",
        "inclusions": ["Arch", "Aisle flowers", "Reception lighting"],
    })
    assert first.status_code == 200, first.text
    quote_id = first.json()["quote"]["id"]

    # One vendor, one quote: a second submission updates the same row.
    revised = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=dh, json={
        "amount_kes": 105000, "package_id": package_id, "message": "We found a shorter transport run.",
        "inclusions": ["Arch", "Aisle flowers", "Reception lighting", "Delivery"],
    })
    assert revised.status_code == 200 and revised.json()["quote"]["id"] == quote_id
    assert revised.json()["quote"]["amount_kes"] == 105000

    other = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=ch, json={
        "amount_kes": 98000, "message": "Catering and decor can travel together.",
    })
    assert other.status_code == 200, other.text
    other_id = other.json()["quote"]["id"]

    mine = await client.get("/api/event-desk/requests/mine", headers=oh)
    accepted_request = next(r for r in mine.json()["requests"] if r["id"] == request["id"])
    assert accepted_request["quote_count"] == 2

    detail = await client.get(f"/api/event-desk/requests/{request['id']}", headers=oh)
    assert detail.status_code == 200 and len(detail.json()["quotes"]) == 2
    assert all(q["vendor_contact"] is None for q in detail.json()["quotes"])

    # A vendor sees the open brief, the count, and only their own quote.
    vendor_view = await client.get(f"/api/event-desk/requests/{request['id']}", headers=dh)
    assert vendor_view.status_code == 200
    assert vendor_view.json()["quote_count"] == 2
    assert [q["id"] for q in vendor_view.json()["quotes"]] == [quote_id]

    # An onlooker can read an open brief but gets no quote rows.
    onlook = await client.get(f"/api/event-desk/requests/{request['id']}", headers=xh)
    assert onlook.status_code == 200 and onlook.json()["quotes"] == []

    forbidden = await client.post(f"/api/event-desk/quotes/{quote_id}/status", headers=xh, json={"status": "accepted"})
    assert forbidden.status_code == 403

    accepted = await client.post(f"/api/event-desk/quotes/{quote_id}/status", headers=oh, json={"status": "accepted"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["quote"]["status"] == "accepted"
    assert accepted.json()["quote"]["vendor_contact"]["email"].startswith("decor_vendor_")

    mine = await client.get("/api/event-desk/requests/mine", headers=oh)
    awarded = next(r for r in mine.json()["requests"] if r["id"] == request["id"])
    assert awarded["status"] == "awarded"

    detail = await client.get(f"/api/event-desk/requests/{request['id']}", headers=oh)
    by_id = {q["id"]: q for q in detail.json()["quotes"]}
    assert by_id[quote_id]["status"] == "accepted" and by_id[quote_id]["vendor_contact"]
    assert by_id[other_id]["status"] == "declined" and by_id[other_id]["vendor_contact"] is None

    # The booked vendor sees the organiser's contact. Payment is still direct.
    vendor_quotes = await client.get("/api/event-desk/quotes/mine", headers=dh)
    booked = next(q for q in vendor_quotes.json()["quotes"] if q["id"] == quote_id)
    assert booked["request"]["status"] == "awarded"
    assert booked["organizer_contact"]["email"].startswith("wedding_organiser_")

    cannot_withdraw = await client.post(f"/api/event-desk/quotes/{quote_id}/status", headers=dh, json={"status": "withdrawn"})
    assert cannot_withdraw.status_code == 409
    closed = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=ch, json={"amount_kes": 1})
    assert closed.status_code == 409

    # The public card carries the recorded booking and never a phone or email.
    public = await client.get(f"/api/event-desk/public/rate-cards/{decorator['vendor_handle']}")
    assert public.status_code == 200
    assert public.json()["accepted_bookings"] == 1
    body = public.text.lower()
    assert "@example.com" not in body and "phone" not in body


async def test_only_the_organiser_can_broadcast_or_close_and_deadlines_hold(client):
    organiser, vendor, outsider = [
        await _register(client, name, ["events"]) for name in ("owner_org", "quote_vendor", "outside_org")
    ]
    oh, vh, xh = (_auth(x["access_token"]) for x in (organiser, vendor, outsider))
    event_id, start = await _event(client, oh, title="Kisii ceremony")

    stolen = await client.post(f"/api/event-desk/events/{event_id}/requests", headers=xh, json={
        "title": "Not mine", "category": "decor",
        "response_deadline": (start - timedelta(days=5)).isoformat(),
    })
    assert stolen.status_code == 403

    request = await _request(client, oh, event_id, start)
    cannot_close = await client.post(f"/api/event-desk/requests/{request['id']}/status", headers=xh,
                                     json={"status": "closed"})
    assert cannot_close.status_code == 403

    closed = await client.post(f"/api/event-desk/requests/{request['id']}/status", headers=oh,
                               json={"status": "closed"})
    assert closed.status_code == 200 and closed.json()["request"]["status"] == "closed"
    late = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=vh, json={"amount_kes": 9000})
    assert late.status_code == 409

    second = await _request(client, oh, event_id, start, title="Second brief")
    from app.database import async_session
    from app.modules.event_desk.models import EventVendorRequest
    from uuid import UUID
    async with async_session() as db:
        row = await db.get(EventVendorRequest, UUID(second["id"]))
        row.response_deadline = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()
    expired = await client.post(f"/api/event-desk/requests/{second['id']}/quotes", headers=vh, json={"amount_kes": 9000})
    assert expired.status_code == 409

    own = await client.post(f"/api/event-desk/requests/{second['id']}/quotes", headers=oh, json={"amount_kes": 9000})
    assert own.status_code == 409


async def test_an_expired_quote_cannot_be_accepted(client):
    organiser, vendor = [await _register(client, name, ["events"]) for name in ("expiry_org", "expiry_vendor")]
    oh, vh = _auth(organiser["access_token"]), _auth(vendor["access_token"])
    event_id, start = await _event(client, oh, title="Expiry wedding")
    request = await _request(client, oh, event_id, start)
    submitted = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=vh, json={
        "amount_kes": 50000,
        "valid_until": (datetime.utcnow() + timedelta(days=2)).isoformat(),
    })
    assert submitted.status_code == 200, submitted.text
    quote_id = submitted.json()["quote"]["id"]

    from app.database import async_session
    from app.modules.event_desk.models import EventVendorQuote
    from uuid import UUID
    async with async_session() as db:
        row = await db.get(EventVendorQuote, UUID(quote_id))
        row.valid_until = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()

    accepted = await client.post(f"/api/event-desk/quotes/{quote_id}/status", headers=oh, json={"status": "accepted"})
    assert accepted.status_code == 409
    assert "expired" in accepted.text.lower()


async def test_a_vendor_can_withdraw_before_a_decision(client):
    organiser, vendor = [await _register(client, name, ["events"]) for name in ("withdraw_org", "withdraw_vendor")]
    oh, vh = _auth(organiser["access_token"]), _auth(vendor["access_token"])
    event_id, start = await _event(client, oh, title="Withdrawal wedding")
    request = await _request(client, oh, event_id, start)
    submitted = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=vh, json={"amount_kes": 61000})
    quote_id = submitted.json()["quote"]["id"]
    withdrawn = await client.post(f"/api/event-desk/quotes/{quote_id}/status", headers=vh, json={"status": "withdrawn"})
    assert withdrawn.status_code == 200
    assert withdrawn.json()["quote"]["status"] == "withdrawn"
    refused = await client.post(f"/api/event-desk/quotes/{quote_id}/status", headers=oh, json={"status": "accepted"})
    assert refused.status_code == 409


async def test_a_quote_submitted_in_time_can_be_accepted_after_the_deadline(client):
    """The deadline stops new quotes, not the organiser's decision."""
    organiser, vendor = [await _register(client, name, ["events"]) for name in ("decision_org", "decision_vendor")]
    oh, vh = _auth(organiser["access_token"]), _auth(vendor["access_token"])
    event_id, start = await _event(client, oh, title="Late decision wedding")
    request = await _request(client, oh, event_id, start)
    submitted = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=vh, json={"amount_kes": 73000})
    assert submitted.status_code == 200
    quote_id = submitted.json()["quote"]["id"]

    from app.database import async_session
    from app.modules.event_desk.models import EventVendorRequest
    from uuid import UUID
    async with async_session() as db:
        row = await db.get(EventVendorRequest, UUID(request["id"]))
        row.response_deadline = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()

    late_new_quote = await client.post(f"/api/event-desk/requests/{request['id']}/quotes", headers=vh, json={"amount_kes": 1})
    assert late_new_quote.status_code == 409
    accepted = await client.post(f"/api/event-desk/quotes/{quote_id}/status", headers=oh, json={"status": "accepted"})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["quote"]["status"] == "accepted"

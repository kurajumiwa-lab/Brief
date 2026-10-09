"""v2.10 — the locked decisions, enforced in code.

The critique's decision table, made testable on the trade foundation:

    · Trade lifecycle is an EXPLICIT state machine with auditable history
      — every legal transition is in the flow map; the audit trail
      (`request_events`) is append-only and written in the same transaction.
    · Integrations ride a TRANSACTIONAL OUTBOX — market facts
      (`event_outbox`) commit atomically with the state change, and the
      background worker drains them (FOR UPDATE SKIP LOCKED).
    · Trust/analytics substrate — events carry no prices and no notes, so
      history can be replayed without leaking negotiations.

The v2.9 suite pins the API behavior; this suite pins the machinery under it.
"""

import uuid

import pytest
from sqlalchemy import select

from app.database import async_session
from app.modules.trade.models import RequestEvent
from app.platform import event_outbox
from app.platform.event_outbox import OutboxEvent

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _vendor(client, suffix, **extra):
    handle = f"fdn_{suffix}"
    r = await client.post("/api/auth/register", json={
        "business_name": f"Foundation {suffix[:4]}", "vendor_handle": handle,
        "email": f"{handle}@example.com", "password": PASSWORD,
        "business_categories": extra.get("categories", ["groceries"]),
        "physical_location": extra.get("location", "Kisumu market"),
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
async def a(client):
    return await _vendor(client, uuid.uuid4().hex[:8])


@pytest.fixture
async def b(client):
    return await _vendor(client, uuid.uuid4().hex[:8])


@pytest.fixture
async def c(client):
    return await _vendor(client, uuid.uuid4().hex[:8])


async def _post(client, headers, **overrides):
    body = {
        "request_type": "stock",
        "description": "20 bags of maize flour, wholesale price",
        "location": "Kisumu market",
        "needed_by": "tomorrow",
        "budget_kes": 48000,
        **overrides,
    }
    r = await client.post("/api/requests", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def _offer(client, headers, request_id, note="I can supply this", **overrides):
    r = await client.post(f"/api/requests/{request_id}/offers",
                          json={"note": note, "price_kes": 45000, **overrides}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def _db_events(request_id, model=RequestEvent):
    async with async_session() as db:
        rows = (await db.execute(
            select(model).where(model.request_id == request_id)
            .order_by(model.id.asc())
        )).scalars().all()
        return rows


async def _db_outbox(request_id):
    async with async_session() as db:
        rows = (await db.execute(
            select(OutboxEvent).where(OutboxEvent.payload["request_id"].astext == request_id)
            .order_by(OutboxEvent.created_at.asc())
        )).scalars().all()
        return rows


async def test_posting_writes_the_first_history_line_and_the_market_fact(client, a):
    request = await _post(client, a)
    detail = (await client.get(f"/api/requests/{request['id']}", headers=a)).json()
    assert detail["events"][0]["type"] == "posted"
    assert detail["status"] == "open"

    rows = await _db_events(uuid.UUID(request["id"]))
    assert [e.event_type for e in rows] == ["posted"]
    assert rows[0].payload["request_type"] == "stock"

    outbox = await _db_outbox(request["id"])
    assert [o.topic for o in outbox] == ["trade.request.posted"]
    assert all(o.processed_at is None for o in outbox)


async def test_offers_write_history_and_updates_are_recorded(client, a, b):
    request = await _post(client, a)
    await _offer(client, b, request["id"])
    await _offer(client, b, request["id"], note="Actually 44,000, final")   # update in place

    detail = (await client.get(f"/api/requests/{request['id']}", headers=a)).json()
    types = [e["type"] for e in detail["events"]]
    assert types == ["posted", "offer_received", "offer_updated"]
    assert detail["events"][1]["offer_id"] == detail["offers"][0]["id"]

    # The audit trail stays private to the requester — the responder and the
    # open feed see the facts, not the play-by-play.
    theirs = (await client.get(f"/api/requests/{request['id']}", headers=b)).json()
    assert "events" not in theirs
    feed = (await client.get("/api/requests", params={"scope": "open"}, headers=b)).json()
    assert all("events" not in row for row in feed)


async def test_accepting_writes_the_full_history_and_one_market_fact(client, a, b, c):
    request = await _post(client, a)
    await _offer(client, b, request["id"], price_kes=46000)
    c_offer = await _offer(client, c, request["id"], price_kes=44000)
    accepted = await client.post(
        f"/api/requests/{request['id']}/offers/{c_offer['id']}/accept", headers=a)
    assert accepted.status_code == 200

    detail = (await client.get(f"/api/requests/{request['id']}", headers=a)).json()
    tail = [e["type"] for e in detail["events"]][-4:]
    assert tail == ["offer_received", "offer_accepted", "rival_offers_declined", "request_fulfilled"]
    assert detail["status"] == "fulfilled"
    assert detail["accepted_offer_id"] == c_offer["id"]

    rows = await _db_events(uuid.UUID(request["id"]))
    rival = next(e for e in rows if e.event_type == "rival_offers_declined")
    assert rival.payload["count"] == 1          # b's offer declined, on the record


async def test_the_outbox_holds_facts_until_the_worker_drains_them(client, a, b):
    request = await _post(client, a)
    offer = await _offer(client, b, request["id"])
    await client.post(f"/api/requests/{request['id']}/offers/{offer['id']}/accept", headers=a)

    outbox = await _db_outbox(request["id"])
    assert [o.topic for o in outbox] == [
        "trade.request.posted", "trade.request.offer_received", "trade.request.fulfilled",
    ]
    assert all(o.processed_at is None for o in outbox)

    drained = await event_outbox.drain(async_session)
    assert drained >= 3                          # this request's three, plus any earlier tests'
    remaining = [o for o in await _db_outbox(request["id"]) if o.processed_at is None]
    assert remaining == []                       # this request is fully processed
    # Draining is idempotent per event: a second pass over drained rows
    # processes nothing new for this request.
    await event_outbox.drain(async_session)
    assert all(o.processed_at is not None for o in await _db_outbox(request["id"]))


async def test_terminal_states_refuse_everything_the_flow_map_leaves_out(client, a, b):
    request = await _post(client, a)
    offer = await _offer(client, b, request["id"])

    first = await client.post(f"/api/requests/{request['id']}/cancel", headers=a)
    assert first.status_code == 200
    # cancelled is terminal: no accepting, no second cancel.
    late = await client.post(f"/api/requests/{request['id']}/offers/{offer['id']}/accept", headers=a)
    assert late.status_code == 409
    again = await client.post(f"/api/requests/{request['id']}/cancel", headers=a)
    assert again.status_code == 409

    rows = await _db_events(uuid.UUID(request["id"]))
    assert [e.event_type for e in rows] == ["posted", "offer_received", "request_cancelled"]
    outbox = await _db_outbox(request["id"])
    assert [o.topic for o in outbox] == [
        "trade.request.posted", "trade.request.offer_received", "trade.request.cancelled",
    ]

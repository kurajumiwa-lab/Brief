"""v2.9 — business requests: the reusable way to express a need.

The four jobs (stock, workers, delivery, rentals) each have screens. What the
network never had is one object for the moment the directory cannot answer:
a request. These tests pin the whole lifecycle and the rules that make it
trustworthy:

    post → relevant businesses see it → offers arrive → accept one → fulfilled

…plus the refusal rules: no responding to your own request, one offer per
responder, only the requester accepts or cancels, and a closed request takes
no new offers.
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _vendor(client, suffix, **extra):
    handle = f"req_{suffix}"
    r = await client.post("/api/auth/register", json={
        "business_name": f"Request {suffix[:4]}", "vendor_handle": handle,
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


async def _post(client, headers, **overrides):
    body = {
        "request_type": "stock",
        "description": "20 bags of maize flour, wholesale price",
        "location": "Kisumu market",
        "needed_by": "tomorrow",
        "budget_kes": 48000,
        **overrides,
    }
    return await client.post("/api/requests", json=body, headers=headers)


# ── posting ────────────────────────────────────────────────────────────────────
async def test_post_a_request_and_read_it_back(client, a):
    r = await _post(client, a)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["request_type"] == "stock"
    assert body["status"] == "open"
    assert body["offers_count"] == 0
    assert body["is_mine"] is True
    # A request without coordinates still carries its words.
    assert body["location"] == "Kisumu market"
    assert body["needed_by"] == "tomorrow"
    assert body["budget_kes"] == 48000

    detail = await client.get(f"/api/requests/{body['id']}", headers=a)
    assert detail.status_code == 200
    assert detail.json()["description"].startswith("20 bags")


async def test_unknown_type_and_urgency_are_refused(client, a):
    bad_type = await _post(client, a, request_type="magic")
    assert bad_type.status_code == 400
    bad_urgency = await _post(client, a, needed_by="eventually")
    assert bad_urgency.status_code == 400
    too_short = await _post(client, a, description="rice")
    assert too_short.status_code == 422


# ── the two scopes ─────────────────────────────────────────────────────────────
async def test_mine_lists_my_requests_open_lists_other_peoples(client, a, b):
    mine = (await _post(client, a)).json()
    theirs = (await _post(client, b)).json()

    r = await client.get("/api/requests", params={"scope": "mine"}, headers=a)
    ids = [row["id"] for row in r.json()]
    assert mine["id"] in ids and theirs["id"] not in ids

    r = await client.get("/api/requests", params={"scope": "open"}, headers=a)
    ids = [row["id"] for row in r.json()]
    assert theirs["id"] in ids and mine["id"] not in ids


async def test_open_feed_prefers_shared_market_context(client, a, b):
    """Two open requests, same words — the one from my city ranks first."""
    home = (await _post(client, b, location="Kisumu market",
                        description="need a loader tomorrow at dawn")).json()
    away = (await _post(client, b, location="Mombasa island",
                        description="cement bags wanted this week")).json()
    # `a` trades from Kisumu (the fixture's default location).
    r = await client.get("/api/requests", params={"scope": "open"}, headers=a)
    rows = r.json()
    ids = [row["id"] for row in rows]
    assert home["id"] in ids and away["id"] in ids
    assert ids.index(home["id"]) < ids.index(away["id"])
    # The wire says why: distance, not a hidden score.
    home_row = next(row for row in rows if row["id"] == home["id"])
    assert "distance_km" in home_row


async def test_type_filter_narrows_the_feed(client, a, b):
    stock = (await _post(client, b)).json()
    worker = (await _post(client, b, request_type="worker",
                          description="three loaders for tomorrow morning")).json()
    r = await client.get("/api/requests",
                         params={"scope": "open", "request_type": "worker"}, headers=a)
    ids = [row["id"] for row in r.json()]
    assert worker["id"] in ids and stock["id"] not in ids


# ── offers ─────────────────────────────────────────────────────────────────────
async def test_offer_lifecycle_from_response_to_fulfilled(client, a, b):
    request = (await _post(client, a)).json()

    offer = await client.post(f"/api/requests/{request['id']}/offers", json={
        "note": "I have 25 bags ready", "price_kes": 2300, "lead_time": "ready now",
    }, headers=b)
    assert offer.status_code == 201, offer.text
    offer = offer.json()
    assert offer["status"] == "offered" and offer["is_mine"] is True

    # Updating replaces the words instead of stacking a second offer.
    updated = await client.post(f"/api/requests/{request['id']}/offers", json={
        "note": "Final: 25 bags at 2250", "price_kes": 2250,
    }, headers=b)
    assert updated.status_code == 201
    detail = (await client.get(f"/api/requests/{request['id']}", headers=a)).json()
    assert detail["offers_count"] == 1

    # The requester sees the offer; a third party must not.
    c = await _vendor(client, uuid.uuid4().hex[:8])
    as_stranger = (await client.get(f"/api/requests/{request['id']}", headers=c)).json()
    assert as_stranger["offers"] == [] and as_stranger["offers_count"] == 1
    as_owner = (await client.get(f"/api/requests/{request['id']}", headers=a)).json()
    assert len(as_owner["offers"]) == 1

    accept = await client.post(
        f"/api/requests/{request['id']}/offers/{offer['id']}/accept", headers=a)
    assert accept.status_code == 200
    assert accept.json()["status"] == "fulfilled"

    closed = (await client.get(f"/api/requests/{request['id']}", headers=a)).json()
    assert closed["status"] == "fulfilled" and closed["closed_at"]
    # A closed request takes no new offers.
    late = await client.post(f"/api/requests/{request['id']}/offers", json={
        "note": "too late but here", "price_kes": 2000}, headers=c)
    assert late.status_code == 409


async def test_the_request_rules_refuse_abuse(client, a, b):
    request = (await _post(client, a)).json()

    # No self-responding.
    self_offer = await client.post(f"/api/requests/{request['id']}/offers", json={
        "note": "answering myself"}, headers=a)
    assert self_offer.status_code == 409

    # Only the requester accepts.
    offer = (await client.post(f"/api/requests/{request['id']}/offers", json={
        "note": "I can supply today", "price_kes": 100}, headers=b)).json()
    stranger_accept = await client.post(
        f"/api/requests/{request['id']}/offers/{offer['id']}/accept",
        headers=await _vendor(client, uuid.uuid4().hex[:8]))
    assert stranger_accept.status_code == 403
    responder_accept = await client.post(
        f"/api/requests/{request['id']}/offers/{offer['id']}/accept", headers=b)
    assert responder_accept.status_code == 403

    # Only the requester cancels — and a cancelled request is closed for good.
    cancel = await client.post(f"/api/requests/{request['id']}/cancel", headers=b)
    assert cancel.status_code == 403
    cancel = await client.post(f"/api/requests/{request['id']}/cancel", headers=a)
    assert cancel.status_code == 200
    again = await client.post(f"/api/requests/{request['id']}/cancel", headers=a)
    assert again.status_code == 409
    late_offer = await client.post(f"/api/requests/{request['id']}/offers", json={
        "note": "after cancel"}, headers=b)
    assert late_offer.status_code == 409


async def test_every_type_walks_the_same_flow(client, a, b):
    """The critique's core claim: the type changes the wording, not the flow."""
    for rtype, description in (
        ("worker", "three loaders tomorrow morning near the market"),
        ("delivery", "pick up a parcel at Kibuye deliver to Kondele"),
        ("rental", "concrete mixer for two days this week"),
        ("errand", "buy packaging bags at the wholesale and drop them"),
        ("service", "fix the shop shutter before opening"),
    ):
        request = (await _post(client, a, request_type=rtype, description=description)).json()
        offer = await client.post(
            f"/api/requests/{request['id']}/offers",
            json={"note": f"I do this — {rtype}", "price_kes": 1500}, headers=b)
        assert offer.status_code == 201
        accepted = await client.post(
            f"/api/requests/{request['id']}/offers/{offer.json()['id']}/accept",
            headers=a)
        assert accepted.status_code == 200
        assert accepted.json()["status"] == "fulfilled"


async def test_missing_request_answers_404(client, a):
    r = await client.get(f"/api/requests/{uuid.uuid4()}", headers=a)
    assert r.status_code == 404

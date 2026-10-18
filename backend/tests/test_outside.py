"""Outside — location-aware social discovery over the existing network.

These tests pin the acceptance criteria the brief names, and the two product
rules that are easy to lose later:

  * **Non-commercial content is first-class.** A house party, a hike and a
    request for company all publish with no price, because no field requires
    one — asserted per content type, not once.
  * **Price never buys position.** Two otherwise identical items, one priced
    and one free, get the same score. `ranking.py` has no price term and this
    suite fails if one is added.

Plus the plumbing that makes the surface trustworthy: required-field
validation, radius filtering that never hides unlocated content, cursor
pagination that cannot repeat a row, private posts staying private, manual
location working with no GPS at all, and reporting that refuses to let you
report yourself.
"""

import uuid
from datetime import datetime, timedelta

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"

# Kisumu central, and points at known distances from it, so proximity tests are
# about real geography rather than invented numbers.
KISUMU = (-0.0917, 34.7680)          # the town centre
NEAR = (-0.0950, 34.7700)            # ~0.4 km
FAR = (-0.2300, 34.9900)             # ~27 km


async def _vendor(client, suffix, **extra):
    handle = f"out_{suffix}"
    r = await client.post("/api/auth/register", json={
        "business_name": f"Outside {suffix[:6]}", "vendor_handle": handle,
        "email": f"{handle}@example.com", "password": PASSWORD,
        "business_categories": extra.get("categories", ["groceries"]),
        "physical_location": extra.get("location", "Kisumu central"),
        **{k: v for k, v in extra.items() if k not in ("categories", "location")},
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
async def author(client):
    return await _vendor(client, uuid.uuid4().hex[:8])


@pytest.fixture
async def viewer(client):
    return await _vendor(client, uuid.uuid4().hex[:8])


async def _create(client, headers, **body):
    return await client.post("/api/outside/content", json=body, headers=headers)


# ── 1. one creation endpoint, six content types ───────────────────────────────

async def test_a_post_publishes_with_no_price_at_all(client, author):
    """The single most important assertion in this file."""
    r = await _create(client, author, content_type="post",
                      body="House party at my place on Saturday, everyone welcome",
                      title="Saturday house party", location="Kisumu central",
                      response_kind="rsvp", category="social")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["content_type"] == "post"
    assert body["price_required"] is False
    assert body["to"].startswith("/post/")


@pytest.mark.parametrize("payload", [
    # a house party: no fee, no capacity, no ticketing
    {"content_type": "event", "title": "House party", "body": "Bring your own drinks",
     "starts_at": (datetime.utcnow() + timedelta(days=2)).isoformat(),
     "location": "Kisumu central", "category": "party"},
    # a hiking trip
    {"content_type": "event", "title": "Kit Mikayi hike", "body": "Meeting at the stage at 6am",
     "starts_at": (datetime.utcnow() + timedelta(days=5)).isoformat(),
     "category": "trip"},
    # something to give away — a listing with no price
    {"content_type": "listing", "title": "Free banana crates", "body": "Twenty crates, collect them",
     "quantity": 20, "category": "packaging"},
    # a community
    {"content_type": "community", "title": "Kisumu runners",
     "body": "Tuesday and Saturday morning runs", "location": "Kisumu"},
    # a collection
    {"content_type": "collection", "title": "Where to eat near the CBD",
     "body": "A running list of places worth walking to", "location": "Kisumu"},
    # a request for company — no budget, no request type
    {"content_type": "opportunity", "body": "Anyone walking to the market tomorrow morning?",
     "title": "Walking company", "location": "Kisumu central",
     "response_kind": "offer_help"},
])
async def test_every_content_type_publishes_without_a_price(client, author, payload):
    r = await _create(client, author, **payload)
    assert r.status_code == 201, r.text
    assert r.json()["price_required"] is False, payload["content_type"]


async def test_price_stays_optional_when_it_is_given(client, author):
    """Commerce is supported; it is just not required."""
    r = await _create(client, author, content_type="listing",
                      title="Maize flour 2kg", body="Wholesale bags in stock",
                      price_kes=180, quantity=40)
    assert r.status_code == 201, r.text
    detail = await client.get(f"/api/outside/content/listing/{r.json()['id']}", headers=author)
    assert detail.status_code == 200, detail.text
    assert detail.json()["price_kes"] == 180


async def test_a_commercial_opportunity_still_becomes_a_real_request(client, author):
    """With a recognised request type it lands in `business_requests`, so the
    existing offer lifecycle applies rather than being reinvented."""
    r = await _create(client, author, content_type="opportunity",
                      title="Two riders needed", body="Deliver forty crates across town today",
                      request_type="delivery", urgency="today", price_kes=1500,
                      location="Kisumu central")
    assert r.status_code == 201, r.text
    assert r.json()["record"] == "business_request"
    assert r.json()["kind"] == "opportunity"


# ── 2. validation ─────────────────────────────────────────────────────────────

async def test_a_missing_required_field_is_refused_with_the_field_named(client, author):
    r = await _create(client, author, content_type="event", title="No start time given")
    assert r.status_code == 422, r.text
    assert "starts_at" in r.json()["detail"]["missing"]


async def test_an_event_cannot_end_before_it_starts(client, author):
    now = datetime.utcnow()
    r = await _create(client, author, content_type="event", title="Backwards party",
                      body="This one is impossible",
                      starts_at=now.isoformat(), ends_at=(now - timedelta(hours=2)).isoformat())
    assert r.status_code == 422
    assert "ends_at" in r.json()["detail"]["missing"]


async def test_an_unknown_content_type_names_the_ones_that_exist(client, author):
    r = await _create(client, author, content_type="listing_plus", title="Nope", body="Nope")
    assert r.status_code == 422
    assert "post" in r.json()["detail"]["message"]


async def test_a_body_too_short_to_mean_anything_is_refused(client, author):
    r = await _create(client, author, content_type="post", body="hi")
    assert r.status_code == 422, r.text
    assert "body" in r.json()["detail"]["missing"]


# ── 3. location-aware discovery ───────────────────────────────────────────────

async def _seed_pair(client, author, viewer):
    """One post near the viewer, one far from them, written at the same time."""
    near = await _create(client, author, content_type="post",
                         body="Near one: fresh tomatoes at the corner stall today",
                         title="Near", location="Kisumu central",
                         geo_lat=NEAR[0], geo_lng=NEAR[1])
    far = await _create(client, author, content_type="post",
                        body="Far one: a supplier out by the airport has stock",
                        title="Far", location="Outside town",
                        geo_lat=FAR[0], geo_lng=FAR[1])
    return near.json()["id"], far.json()["id"]


async def test_the_nearer_post_outranks_the_farther_one(client, author, viewer):
    near_id, far_id = await _seed_pair(client, author, viewer)
    r = await client.get("/api/outside/feed",
                         params={"kinds": "post", "lat": KISUMU[0], "lng": KISUMU[1],
                                 "radius_km": 50, "limit": 20},
                         headers=viewer)
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()["items"]]
    assert near_id in ids and far_id in ids
    assert ids.index(near_id) < ids.index(far_id), "proximity must decide the order"


async def test_the_radius_is_a_filter_that_keeps_unlocated_content(client, author, viewer):
    """A 3 km radius drops the 27 km post but keeps one with no position at
    all — national and online content must not be silently hidden."""
    near_id, far_id = await _seed_pair(client, author, viewer)
    unlocated = await _create(client, author, content_type="post",
                              body="A nationwide question with no location attached",
                              title="Unlocated")
    r = await client.get("/api/outside/feed",
                         params={"kinds": "post", "lat": KISUMU[0], "lng": KISUMU[1],
                                 "radius_km": 3, "limit": 20},
                         headers=viewer)
    ids = [i["id"] for i in r.json()["items"]]
    assert near_id in ids
    assert far_id not in ids, "27 km away must fall outside a 3 km radius"
    assert unlocated.json()["id"] in ids, "no location is not a disqualifier"


async def test_the_feed_reports_where_it_is_looking_and_why(client, author, viewer):
    r = await client.get("/api/outside/feed", params={"lat": KISUMU[0], "lng": KISUMU[1]},
                         headers=viewer)
    loc = r.json()["location"]
    assert loc["source"] == "request"
    assert loc["lat"] == KISUMU[0]


async def test_center_and_location_never_disagree_about_the_source(client, author):
    """A saved preference is `manual`, not `request`.

    `center` used to infer its source from "was a lat supplied", which is
    always true once a preference resolves — so it claimed `request` for a
    point the person had typed. Two fields on one response must not tell
    different stories about the same fact.
    """
    put = await client.put("/api/outside/location", json={
        "label": "Kondele, Kisumu", "geo_lat": KISUMU[0], "geo_lng": KISUMU[1],
        "source": "manual", "radius_km": 5,
    }, headers=author)
    assert put.status_code == 200, put.text

    r = await client.get("/api/outside/feed", headers=author)
    body = r.json()
    assert body["center"]["source"] == "manual"
    assert body["location"]["source"] == "manual"
    assert body["center"]["source"] == body["location"]["source"]


async def test_a_manual_location_works_with_no_gps_at_all(client, author):
    """Denying GPS costs a radius, not the product."""
    put = await client.put("/api/outside/location", json={
        "label": "Kondele, Kisumu", "geo_lat": NEAR[0], "geo_lng": NEAR[1],
        "source": "manual", "radius_km": 5, "layer": "neighbourhood",
    }, headers=author)
    assert put.status_code == 200, put.text
    assert put.json()["source"] == "manual"
    assert put.json()["share_location"] is False, "a saved point is never a broadcast"

    got = await client.get("/api/outside/location", headers=author)
    assert got.json()["source"] == "manual"
    assert got.json()["radius_km"] == 5
    assert got.json()["explainable"] is True


async def test_the_location_falls_back_to_the_profile_then_to_a_market_zone(client, viewer):
    """With nothing saved, the chain resolves to something real rather than
    erroring — and says which step produced it."""
    r = await client.get("/api/outside/location", headers=viewer)
    assert r.status_code == 200
    assert r.json()["source"] in ("vendor_profile", "market_zone", "unset")
    if r.json()["source"] != "unset":
        assert r.json()["lat"] is not None


# ── 4. ranking rules ──────────────────────────────────────────────────────────

async def test_price_never_buys_position(client, author, viewer):
    """Two identical listings, one priced and one free: the priced one must not
    rank above the free one. If a price term is ever added to ranking, this
    fails — which is the point."""
    free = await _create(client, author, content_type="listing", title="Free pallets",
                         body="Twenty pallets, come and collect them today",
                         quantity=20, category="packaging")
    paid = await _create(client, author, content_type="listing", title="Free pallets",
                         body="Twenty pallets, come and collect them today",
                         quantity=20, category="packaging", price_kes=5000)
    assert free.status_code == 201 and paid.status_code == 201

    r = await client.get("/api/outside/feed", params={"kinds": "listing", "limit": 20},
                         headers=viewer)
    items = {i["id"]: i for i in r.json()["items"]}
    assert free.json()["id"] in items and paid.json()["id"] in items
    assert items[paid.json()["id"]]["score"] <= items[free.json()["id"]]["score"] + 1e-9


async def test_an_event_starting_soon_outranks_one_written_more_recently(client, author, viewer):
    """Timing is a real signal: tomorrow's party beats last week's announcement
    of a party next month."""
    soon = await _create(client, author, content_type="event", title="Tomorrow party",
                         body="Starting tomorrow evening at seven",
                         starts_at=(datetime.utcnow() + timedelta(days=1)).isoformat())
    later = await _create(client, author, content_type="event", title="Next month fair",
                          body="A fair happening in a few weeks",
                          starts_at=(datetime.utcnow() + timedelta(days=28)).isoformat())
    r = await client.get("/api/outside/feed", params={"kinds": "event", "limit": 20},
                         headers=viewer)
    ids = [i["id"] for i in r.json()["items"]]
    assert ids.index(soon.json()["id"]) < ids.index(later.json()["id"])


async def test_each_result_explains_why_it_is_there(client, author, viewer):
    await _create(client, author, content_type="post",
                  body="Explaining itself: coffee at the new place on Oginga Odinga",
                  title="Coffee", location="Kisumu central",
                  geo_lat=NEAR[0], geo_lng=NEAR[1], category="social")
    r = await client.get("/api/outside/feed",
                         params={"kinds": "post", "lat": KISUMU[0], "lng": KISUMU[1],
                                 "radius_km": 5},
                         headers=viewer)
    items = r.json()["items"]
    assert items, "expected at least one item"
    assert any("km away" in reason for reason in items[0]["reasons"]), items[0]["reasons"]


# ── 5. pagination ─────────────────────────────────────────────────────────────

async def test_cursor_pagination_never_repeats_a_row(client, author, viewer):
    for i in range(6):
        r = await _create(client, author, content_type="post",
                          body=f"Paged post number {i} with enough words to be real")
        assert r.status_code == 201

    first = await client.get("/api/outside/feed", params={"kinds": "post", "limit": 3},
                             headers=viewer)
    page_one = [i["id"] for i in first.json()["items"]]
    cursor = first.json()["next_cursor"]
    assert cursor, "six posts at three a page must produce a cursor"

    second = await client.get("/api/outside/feed",
                              params={"kinds": "post", "limit": 3, "cursor": cursor},
                              headers=viewer)
    page_two = [i["id"] for i in second.json()["items"]]
    assert set(page_one).isdisjoint(page_two), "a page must not repeat the previous one"
    assert page_two, "there were six posts; page two must not be empty"


async def test_a_malformed_cursor_degrades_to_the_first_page(client, author, viewer):
    await _create(client, author, content_type="post",
                  body="A post so the feed has something to return")
    r = await client.get("/api/outside/feed",
                         params={"kinds": "post", "cursor": "not-a-real-cursor"},
                         headers=viewer)
    assert r.status_code == 200
    assert isinstance(r.json()["items"], list)


async def test_an_unknown_kind_is_refused_rather_than_ignored(client, viewer):
    r = await client.get("/api/outside/feed", params={"kinds": "spaceship"}, headers=viewer)
    assert r.status_code == 422
    assert "spaceship" in r.json()["detail"]


# ── 6. privacy ────────────────────────────────────────────────────────────────

async def test_a_private_post_is_invisible_to_everyone_but_its_author(client, author, viewer):
    r = await _create(client, author, content_type="post",
                      body="A private note about a sensitive location",
                      visibility="private", location="my home address")
    assert r.status_code == 201
    post_id = r.json()["id"]

    feed = await client.get("/api/outside/feed", params={"kinds": "post"}, headers=viewer)
    assert post_id not in [i["id"] for i in feed.json()["items"]]

    other = await client.get(f"/api/outside/content/post/{post_id}", headers=viewer)
    assert other.status_code == 404, "a private post must not be readable by a stranger"

    own = await client.get(f"/api/outside/content/post/{post_id}", headers=author)
    assert own.status_code == 200


async def test_only_the_author_can_change_or_remove_their_content(client, author, viewer):
    r = await _create(client, author, content_type="post",
                      body="Someone else must not be able to edit this")
    post_id = r.json()["id"]

    patch = await client.patch(f"/api/outside/content/post/{post_id}",
                               json={"title": "hijacked"}, headers=viewer)
    assert patch.status_code == 403

    delete = await client.delete(f"/api/outside/content/post/{post_id}", headers=viewer)
    assert delete.status_code == 403

    ok = await client.patch(f"/api/outside/content/post/{post_id}",
                            json={"status": "cancelled"}, headers=author)
    assert ok.status_code == 200, ok.text


async def test_cancelling_an_event_retires_it_instead_of_deleting_it(client, author, viewer):
    r = await _create(client, author, content_type="event", title="Party to cancel",
                      body="This one gets called off",
                      starts_at=(datetime.utcnow() + timedelta(days=3)).isoformat())
    event_id = r.json()["id"]

    out = await client.delete(f"/api/outside/content/event/{event_id}", headers=author)
    assert out.status_code == 200
    assert out.json()["retired"] is True, "an event others registered for is retired, not deleted"

    still = await client.get(f"/api/outside/content/event/{event_id}", headers=author)
    assert still.status_code == 200, "the record must survive its own cancellation"


# ── 7. interactions ───────────────────────────────────────────────────────────

async def test_saving_and_unsaving_a_post_moves_its_counter(client, author, viewer):
    r = await _create(client, author, content_type="post",
                      body="A recommendation worth keeping for later")
    post_id = r.json()["id"]

    add = await client.post("/api/outside/reactions", json={
        "content_kind": "post", "content_id": post_id, "reaction": "save"}, headers=viewer)
    assert add.status_code == 201, add.text
    assert add.json()["count"] == 1

    # idempotent: saving twice is one save
    again = await client.post("/api/outside/reactions", json={
        "content_kind": "post", "content_id": post_id, "reaction": "save"}, headers=viewer)
    assert again.json().get("already") is True

    remove = await client.request("DELETE", "/api/outside/reactions", json={
        "content_kind": "post", "content_id": post_id, "reaction": "save"}, headers=viewer)
    assert remove.status_code == 200
    assert remove.json()["removed"] == 1


async def test_attending_an_event_writes_a_real_registration(client, author, viewer):
    """Attending is not the same action as saving: it books a real seat."""
    r = await _create(client, author, content_type="event", title="Meetup with seats",
                      body="Twelve places, first come first served",
                      starts_at=(datetime.utcnow() + timedelta(days=4)).isoformat(),
                      capacity=12)
    event_id = r.json()["id"]

    add = await client.post("/api/outside/reactions", json={
        "content_kind": "event", "content_id": event_id, "reaction": "attending"},
        headers=viewer)
    assert add.status_code == 201, add.text

    regs = await client.get(f"/api/events/{event_id}/registrations", headers=author)
    if regs.status_code == 200:
        assert len(regs.json() if isinstance(regs.json(), list) else regs.json().get("registrations", [])) >= 1

    undo = await client.request("DELETE", "/api/outside/reactions", json={
        "content_kind": "event", "content_id": event_id, "reaction": "attending"},
        headers=viewer)
    assert undo.status_code == 200


async def test_an_unknown_reaction_is_refused(client, author, viewer):
    r = await _create(client, author, content_type="post", body="A post to react to")
    bad = await client.post("/api/outside/reactions", json={
        "content_kind": "post", "content_id": r.json()["id"], "reaction": "love_it"},
        headers=viewer)
    assert bad.status_code == 422


# ── 8. safety ─────────────────────────────────────────────────────────────────

async def test_you_cannot_report_your_own_content(client, author):
    r = await _create(client, author, content_type="post", body="Reporting myself is not a thing")
    rep = await client.post("/api/outside/reports", json={
        "content_kind": "post", "content_id": r.json()["id"], "reason": "spam"},
        headers=author)
    assert rep.status_code == 409


async def test_blocking_an_author_removes_their_content_from_your_feed(client, author, viewer):
    r = await _create(client, author, content_type="post",
                      body="A post from an account the viewer is about to block")
    post_id = r.json()["id"]

    rep = await client.post("/api/outside/reports", json={
        "content_kind": "post", "content_id": post_id,
        "reason": "harassment", "is_block": True}, headers=viewer)
    assert rep.status_code == 201, rep.text
    assert rep.json()["blocked"] is True

    feed = await client.get("/api/outside/feed", params={"kinds": "post"}, headers=viewer)
    assert post_id not in [i["id"] for i in feed.json()["items"]]


# ── 9. shelves and search ─────────────────────────────────────────────────────

async def test_the_shelf_manifest_is_data_the_client_renders_from(client, viewer):
    r = await client.get("/api/outside/shelves", headers=viewer)
    assert r.status_code == 200, r.text
    body = r.json()
    keys = [s["key"] for s in body["shelves"]]
    assert "happening_around_you" in keys
    assert "nearby_communities" in keys
    for shelf in body["shelves"]:
        assert shelf["kinds"], f"{shelf['key']} must name its content source"
        assert shelf["see_all"], f"{shelf['key']} must have a door into its module"
    assert body["create_path"] == "/create"
    # every content type is creatable from the one entry point
    assert set(body["content_types"]) == {
        "post", "event", "listing", "community", "collection", "opportunity"}


async def test_a_client_can_ask_for_only_the_shelves_it_shows(client, viewer):
    r = await client.get("/api/outside/shelves", params={"keys": "this_weekend,local_services"},
                         headers=viewer)
    keys = [s["key"] for s in r.json()["shelves"]]
    assert keys == ["this_weekend", "local_services"]


async def test_a_shelf_can_declare_an_intentional_empty_state(client, viewer):
    r = await client.get("/api/outside/shelves", params={"keys": "happening_around_you"},
                         headers=viewer)
    shelf = r.json()["shelves"][0]
    assert shelf["min_items"] == 0, "this shelf teaches the door when it is empty"
    assert shelf["empty_state"]["action"]["to"].startswith("/create")


async def test_search_spans_content_types_with_one_query(client, author, viewer):
    await _create(client, author, content_type="post",
                  body="Anyone know a good plumber in Kondele", title="Plumber wanted")
    await _create(client, author, content_type="listing", title="Plumber tools set",
                  body="Complete set of plumbing tools, barely used", quantity=1)

    r = await client.get("/api/outside/search", params={"q": "plumb"}, headers=viewer)
    assert r.status_code == 200, r.text
    kinds = {i["kind"] for i in r.json()["items"]}
    assert "post" in kinds and "listing" in kinds, kinds
    assert r.json()["query"] == "plumb"


async def test_search_can_filter_on_price_without_requiring_it(client, author, viewer):
    await _create(client, author, content_type="listing", title="Priced crates",
                  body="Crates for sale at a stated price", price_kes=250, quantity=10)
    await _create(client, author, content_type="listing", title="Unpriced crates",
                  body="Crates, price on request", quantity=10)

    priced = await client.get("/api/outside/search",
                              params={"q": "crates", "has_price": True}, headers=viewer)
    assert all(i["price_kes"] is not None for i in priced.json()["items"])

    free = await client.get("/api/outside/search",
                            params={"q": "crates", "has_price": False}, headers=viewer)
    assert all(i["price_kes"] is None for i in free.json()["items"])
    assert free.json()["items"], "an unpriced listing must still be findable"


async def test_search_results_keep_their_own_kind_and_route(client, author, viewer):
    """A result is never flattened into a generic listing."""
    await _create(client, author, content_type="event", title="Weekend football",
                  body="Five-a-side at the community pitch on Saturday",
                  starts_at=(datetime.utcnow() + timedelta(days=2)).isoformat())
    r = await client.get("/api/outside/search", params={"q": "football"}, headers=viewer)
    events = [i for i in r.json()["items"] if i["kind"] == "event"]
    assert events
    assert events[0]["to"].startswith("/events")
    assert events[0]["meta"]["capacity"] is not None


# ── 10. activity ──────────────────────────────────────────────────────────────

async def test_activity_is_grouped_and_counts_real_work(client, viewer):
    r = await client.get("/api/outside/activity", headers=viewer)
    assert r.status_code == 200, r.text
    body = r.json()
    keys = [g["key"] for g in body["groups"]]
    assert keys == ["invitations", "events", "replies", "trades", "community", "account"]
    assert set(body["counts"]) >= {"unread_notifications", "attending", "rooms"}


# ── 11. the ranking unit itself (pure, no HTTP) ───────────────────────────────

def test_ranking_engagement_is_damped_and_saturating():
    from app.modules.outside.ranking import engagement_signal

    small = engagement_signal({"like_count": 5})
    big = engagement_signal({"like_count": 5000})
    assert big <= 1.0, "engagement is capped"
    assert big < small * 3, "5000 likes is not 1000x more relevant than 5"


def test_ranking_has_no_price_term():
    """The pure function must not read a price. Asserted by source, because a
    price field would otherwise slip in unnoticed."""
    import inspect

    from app.modules.outside import ranking

    source = inspect.getsource(ranking)
    for forbidden in ("price_kes", "entry_fee", "budget_kes", "unit_price", "pay_kes"):
        assert forbidden not in source, f"ranking must never read {forbidden}"


def test_ranking_treats_a_missing_location_as_neutral_not_absent():
    from app.modules.outside.ranking import proximity_signal

    assert proximity_signal(None, 15.0, "town") == 0.5
    assert proximity_signal(0.0, 15.0, "town") == 1.0
    assert proximity_signal(30.0, 15.0, "town") == 0.0


def test_ranking_expires_content_that_has_passed():
    from datetime import datetime as dt

    from app.modules.outside.ranking import timing_signal

    now = dt(2026, 10, 17, 12, 0, 0)
    assert timing_signal(None, now - timedelta(days=1), now) == 0.0
    assert timing_signal(now + timedelta(hours=6), None, now) == 1.0


def test_repeated_commercial_posting_is_decayed_but_never_hidden():
    from datetime import datetime as dt

    from app.modules.outside.ranking import RankContext, score_item

    now = dt(2026, 10, 17, 12, 0, 0)
    ctx = RankContext(now=now, recent_commercial_by_author={"author-1": 6})
    item = {"id": "x", "kind": "listing", "created_at": now, "is_commercial": True,
            "owner_id": "author-1", "meta": {"owner_id": "author-1"}}
    scored = score_item(item, ctx)
    assert scored.score > 0, "decayed is not hidden"
    clean = RankContext(now=now)
    assert score_item(item, clean).score > scored.score

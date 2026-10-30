"""Caesar Park: the gate, the leash, and what a warden may not do.

A park is a nice idea that becomes a bad one at three specific moments, and
these tests are those moments:

1. **The boundary is visible before you knock.** ``kind``, ``bounded_by``,
   ``entry_rule`` and ``rules`` are on the listing route, not the member route.
2. **Off-leash means the business link is absent from the response**, not hidden
   by the client. And it is stamped per post, so changing your leash tomorrow
   does not reveal what you said yesterday.
3. **The leash belongs to the membership**, so the same person can be a
   shopkeeper in their market park and only a neighbour in their estate park.

Plus the two refusals that make it safe: no posting without joining, and no
warden removing somebody's words.

Everything runs against Postgres through the real HTTP stack.
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _account(client, suffix=""):
    handle = f"pk_{uuid.uuid4().hex[:8]}"
    r = await client.post(
        "/api/social/accounts",
        json={"handle": handle, "display_name": f"Park {suffix or handle[-4:]}", "city": "Kisumu", "locale": "en"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return {
        "handle": handle,
        "id": body["account"]["id"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


async def _vendor_account(client, suffix=""):
    handle = f"pv_{uuid.uuid4().hex[:8]}"
    r = await client.post(
        "/api/auth/register",
        json={
            "business_name": f"Park Vendor {suffix or handle[-4:]}",
            "vendor_handle": handle,
            "email": f"{handle}@example.com",
            "password": PASSWORD,
            "business_categories": ["tailoring"],
            "physical_location": "Kisumu, Kenya",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return {
        "handle": handle,
        "business_name": f"Park Vendor {suffix or handle[-4:]}",
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


async def _park(client, warden, **overrides):
    payload = {
        "name": overrides.pop("name", f"Kondele {uuid.uuid4().hex[:5]}"),
        "kind": "place",
        "city": "Kisumu",
        "area": "Kondele",
        "entry_rule": "open",
        "description": "The estate park.",
        "rules": ["Disagreement is not misconduct."],
    }
    payload.update(overrides)
    r = await client.post("/api/parks", json=payload, headers=warden["headers"])
    assert r.status_code == 201, r.text
    return r.json()


# ── 1 · the boundary is public ───────────────────────────────────────────────


async def test_the_listing_shows_the_boundary_the_gate_and_the_rules(client):
    warden = await _account(client, "warden")
    park = await _park(client, warden, name="Nyalenda", area="Nyalenda", entry_rule="ask")

    viewer = await _account(client, "viewer")
    r = await client.get("/api/parks", params={"city": "Kisumu"}, headers=viewer["headers"])
    assert r.status_code == 200, r.text
    listed = [p for p in r.json()["parks"] if p["slug"] == park["slug"]][0]

    assert listed["kind"] == "place"
    assert listed["bounded_by"] == "Nyalenda"
    assert listed["entry_rule"] == "ask"
    assert listed["rules"][0].startswith("Disagreement")


async def test_a_park_cannot_be_created_without_a_boundary(client):
    warden = await _account(client)
    r = await client.post(
        "/api/parks",
        json={"name": "Nowhere", "kind": "place"},
        headers=warden["headers"],
    )
    assert r.status_code == 422
    assert "bounds it" in r.json()["detail"]

    r = await client.post(
        "/api/parks",
        json={"name": "Anyone", "kind": "niche"},
        headers=warden["headers"],
    )
    assert r.status_code == 422
    assert "niche" in r.json()["detail"]


async def test_there_is_no_place_to_put_a_coordinate(client):
    """The schema has no latitude column, so the API cannot accept one."""
    warden = await _account(client)
    r = await client.post(
        "/api/parks",
        json={
            "name": f"Pin Test {uuid.uuid4().hex[:5]}",
            "kind": "place",
            "city": "Kisumu",
            "latitude": -0.0917,
            "longitude": 34.7680,
        },
        headers=warden["headers"],
    )
    # Either refused or ignored — never stored and echoed back.
    assert r.status_code == 201
    assert "latitude" not in r.json()
    assert "longitude" not in r.json()


# ── 2 · the gate ─────────────────────────────────────────────────────────────


async def test_an_open_park_lets_you_walk_in_and_an_asking_park_makes_you_knock(client):
    warden = await _account(client, "warden")
    open_park = await _park(client, warden, name=f"Open {uuid.uuid4().hex[:4]}", entry_rule="open")
    asked_park = await _park(client, warden, name=f"Asked {uuid.uuid4().hex[:4]}", entry_rule="ask")

    visitor = await _account(client, "visitor")
    walked = await client.post(f"/api/parks/{open_park['slug']}/join", headers=visitor["headers"])
    assert walked.json()["status"] == "member"

    knocked = await client.post(f"/api/parks/{asked_park['slug']}/join", headers=visitor["headers"])
    assert knocked.json()["status"] == "requested"
    assert "warden" in knocked.json()["detail"]


async def test_you_cannot_post_in_a_park_you_have_not_joined(client):
    warden = await _account(client, "warden")
    park = await _park(client, warden, name=f"Closed {uuid.uuid4().hex[:4]}")
    outsider = await _account(client, "outsider")

    r = await client.post(
        f"/api/parks/{park['slug']}/posts",
        json={"body": "Hello from the fence."},
        headers=outsider["headers"],
    )
    assert r.status_code == 403
    assert "Join this park" in r.json()["detail"]


async def test_knocking_does_not_let_you_in_before_the_warden_answers(client):
    warden = await _account(client, "warden")
    park = await _park(client, warden, name=f"Knock {uuid.uuid4().hex[:4]}", entry_rule="ask")
    visitor = await _account(client, "visitor")
    await client.post(f"/api/parks/{park['slug']}/join", headers=visitor["headers"])

    r = await client.post(
        f"/api/parks/{park['slug']}/posts", json={"body": "Trying anyway."}, headers=visitor["headers"]
    )
    assert r.status_code == 403


# ── 3 · the leash ────────────────────────────────────────────────────────────


async def test_off_leash_removes_the_business_link_from_the_payload(client):
    warden = await _vendor_account(client, "warden")
    park = await _park(client, warden, name=f"Offlead {uuid.uuid4().hex[:4]}")

    await client.post(f"/api/parks/{park['slug']}/join?leash=off", headers=warden["headers"])
    await client.post(
        f"/api/parks/{park['slug']}/posts", json={"body": "Just a neighbour here."}, headers=warden["headers"]
    )

    feed = await client.get(f"/api/parks/{park['slug']}/feed", headers=warden["headers"])
    post = feed.json()["posts"][0]
    assert post["leash"] == "off"
    # Absent, not blanked — a client cannot accidentally render it.
    assert post["author"]["business"] is None
    assert post["author"]["vendor_handle"] is None


async def test_on_leash_puts_the_shop_name_on_the_post(client):
    warden = await _vendor_account(client, "shop")
    park = await _park(client, warden, name=f"Onlead {uuid.uuid4().hex[:4]}")

    await client.post(f"/api/parks/{park['slug']}/join?leash=on", headers=warden["headers"])
    await client.post(
        f"/api/parks/{park['slug']}/posts", json={"body": "Open for fittings."}, headers=warden["headers"]
    )

    feed = await client.get(f"/api/parks/{park['slug']}/feed", headers=warden["headers"])
    post = feed.json()["posts"][0]
    assert post["leash"] == "on"
    assert post["author"]["business"] == warden["business_name"]
    assert post["author"]["vendor_handle"] == warden["handle"]


async def test_changing_the_leash_does_not_rewrite_what_was_already_said(client):
    """The whole reason ``leash_at_post`` is a column and not a lookup."""
    warden = await _vendor_account(client, "flip")
    park = await _park(client, warden, name=f"Flip {uuid.uuid4().hex[:4]}")

    await client.post(f"/api/parks/{park['slug']}/join?leash=on", headers=warden["headers"])
    await client.post(f"/api/parks/{park['slug']}/posts", json={"body": "Said as a shop."}, headers=warden["headers"])

    # Take the leash off afterwards.
    r = await client.patch(
        f"/api/parks/{park['slug']}/leash", json={"leash": "off"}, headers=warden["headers"]
    )
    assert r.status_code == 200
    assert "keep the name they were published under" in r.json()["note"]

    feed = await client.get(f"/api/parks/{park['slug']}/feed", headers=warden["headers"])
    assert feed.json()["posts"][0]["author"]["business"] == warden["business_name"]


async def test_the_leash_belongs_to_each_park_not_to_the_person(client):
    """A shopkeeper in their market, a neighbour in their estate."""
    trader = await _vendor_account(client, "trader")
    warden = await _account(client, "warden")
    market = await _park(
        client, warden, name=f"Market {uuid.uuid4().hex[:4]}", kind="niche", niche="tailors", area=None
    )
    estate = await _park(client, warden, name=f"Estate {uuid.uuid4().hex[:4]}")

    await client.post(f"/api/parks/{market['slug']}/join?leash=on", headers=trader["headers"])
    await client.post(f"/api/parks/{estate['slug']}/join?leash=off", headers=trader["headers"])

    await client.post(f"/api/parks/{market['slug']}/posts", json={"body": "Taking orders."}, headers=trader["headers"])
    await client.post(f"/api/parks/{estate['slug']}/posts", json={"body": "Water is off again."}, headers=trader["headers"])

    in_market = await client.get(f"/api/parks/{market['slug']}/feed", headers=trader["headers"])
    in_estate = await client.get(f"/api/parks/{estate['slug']}/feed", headers=trader["headers"])

    assert in_market.json()["posts"][0]["author"]["business"] == trader["business_name"]
    assert in_estate.json()["posts"][0]["author"]["business"] is None


# ── 4 · the warden owns the gate, not the floor ─────────────────────────────


async def test_only_the_warden_may_link_a_circle(client):
    warden = await _account(client, "warden")
    park = await _park(client, warden, name=f"Circles {uuid.uuid4().hex[:4]}")
    stranger = await _account(client, "stranger")

    r = await client.post(
        f"/api/parks/{park['slug']}/circles",
        params={"circle_id": str(uuid.uuid4())},
        headers=stranger["headers"],
    )
    assert r.status_code == 403
    assert "warden" in r.json()["detail"]


async def test_the_warden_cannot_delete_somebody_elses_words(client):
    """There is no such route. The warden's powers are the gate and the rules."""
    warden = await _account(client, "warden")
    park = await _park(client, warden, name=f"Floor {uuid.uuid4().hex[:4]}")
    member = await _account(client, "member")
    await client.post(f"/api/parks/{park['slug']}/join", headers=member["headers"])
    await client.post(f"/api/parks/{park['slug']}/posts", json={"body": "Unpopular but allowed."}, headers=member["headers"])

    feed = await client.get(f"/api/parks/{park['slug']}/feed", headers=warden["headers"])
    post_id = feed.json()["posts"][0]["id"]

    deleted = await client.delete(f"/api/parks/{park['slug']}/posts/{post_id}", headers=warden["headers"])
    assert deleted.status_code in (404, 405)

    still_there = await client.get(f"/api/parks/{park['slug']}/feed", headers=warden["headers"])
    assert still_there.json()["posts"][0]["body"] == "Unpopular but allowed."


async def test_leaving_keeps_what_you_said(client):
    warden = await _account(client, "warden")
    park = await _park(client, warden, name=f"Leave {uuid.uuid4().hex[:4]}")
    member = await _account(client, "member")
    await client.post(f"/api/parks/{park['slug']}/join", headers=member["headers"])
    await client.post(f"/api/parks/{park['slug']}/posts", json={"body": "I was here."}, headers=member["headers"])

    left = await client.post(f"/api/parks/{park['slug']}/leave", headers=member["headers"])
    assert left.json()["posts_kept"] is True

    feed = await client.get(f"/api/parks/{park['slug']}/feed", headers=warden["headers"])
    assert any(p["body"] == "I was here." for p in feed.json()["posts"])


async def test_a_block_carries_into_the_park(client):
    warden = await _account(client, "warden")
    park = await _park(client, warden, name=f"Block {uuid.uuid4().hex[:4]}")
    loud = await _account(client, "loud")
    quiet = await _account(client, "quiet")

    await client.post(f"/api/parks/{park['slug']}/join", headers=loud["headers"])
    await client.post(f"/api/parks/{park['slug']}/posts", json={"body": "Very loud opinion."}, headers=loud["headers"])

    await client.post(
        "/api/social/blocks", json={"target_id": loud["id"], "kind": "block"}, headers=quiet["headers"]
    )

    feed = await client.get(f"/api/parks/{park['slug']}/feed", headers=quiet["headers"])
    assert all(p["body"] != "Very loud opinion." for p in feed.json()["posts"])

    # And only for the person who chose it.
    other = await _account(client, "other")
    sees = await client.get(f"/api/parks/{park['slug']}/feed", headers=other["headers"])
    assert any(p["body"] == "Very loud opinion." for p in sees.json()["posts"])

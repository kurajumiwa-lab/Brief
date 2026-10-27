"""The social layer: permissions, reactions, reports, blocks, real rows.

The point of this file is not "the endpoints return 200". Four rules decide
whether the product is what it claims, and each has tests here:

1. **Participation does not require a business.** An account can be created and
   can post without any vendor row existing.
2. **A reaction cannot hide a post.** Fifty downvotes change the score and
   nothing else — the post is still returned by the feed, still ``published``.
3. **A report opens a case, not a deletion.** The case number is returned, the
   post stays up, and a second report of the same post is refused rather than
   silently duplicated.
4. **Blocking is the viewer's choice.** It removes posts from *your* feed and
   nobody else's, and it is reversible.

Everything runs against Postgres through the real HTTP stack, because the
interesting failures here are query shape and constraint behaviour, not Python.
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


# ── helpers ───────────────────────────────────────────────────────────────────


async def _social_account(client, suffix, **extra):
    """A participant with no business, no vendor row and no trade standing."""
    handle = f"caesar_{suffix}"
    r = await client.post(
        "/api/social/accounts",
        json={
            "handle": handle,
            "display_name": extra.get("display_name", f"Caesar {suffix}"),
            "city": extra.get("city", "Kisumu"),
            "locale": extra.get("locale", "en"),
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return {
        "handle": handle,
        "id": body["account"]["id"],
        "token": body["access_token"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


async def _vendor(client, suffix):
    handle = f"soc_{suffix}"
    r = await client.post(
        "/api/auth/register",
        json={
            "business_name": f"Social {suffix[:6]}",
            "vendor_handle": handle,
            "email": f"{handle}@example.com",
            "password": PASSWORD,
            "business_categories": ["groceries"],
            "physical_location": "Kisumu, Kenya",
        },
    )
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    return {"handle": handle, "headers": {"Authorization": f"Bearer {token}"}, "raw": r.json()}


async def _circle(client, vendor, *, public=True, name=None):
    payload = {
        "name": name or f"Circle {uuid.uuid4().hex[:6]}",
        "description": "A room for a neighbourhood.",
        "group_type": "regional",
        "region": "Kisumu",
        "is_public": public,
        "requires_approval": False,
        "rules": ["Real figures, not rumours."],
    }
    r = await client.post("/api/groups/create", json=payload, headers=vendor["headers"])
    assert r.status_code in (200, 201), r.text
    # The create route answers with the id under `group_id`, not `id`.
    return {"id": r.json()["group_id"], "name": payload["name"], **r.json()}


async def _post(client, account, body="Tomato prices dropped to KSh 60 a crate this morning.", **extra):
    payload = {"body": body, "lang": "en", **extra}
    r = await client.post("/api/social/posts", json=payload, headers=account["headers"])
    assert r.status_code == 201, r.text
    return r.json()


# ── 1. participation does not require a business ─────────────────────────────


async def test_a_person_can_join_and_speak_with_no_vendor_row(client):
    """The whole point of keeping social identity separate from trade identity."""
    account = await _social_account(client, uuid.uuid4().hex[:6])

    me = await client.get("/api/social/me", headers=account["headers"])
    assert me.status_code == 200
    assert me.json()["linked_to_vendor"] is False
    assert me.json()["account"]["vendor_id"] is None

    post = await _post(client, account)
    assert post["author"]["handle"] == account["handle"]
    assert post["status"] == "published"


async def test_a_vendor_is_given_a_social_identity_without_asking(client):
    """Traders should not have to sign up twice."""
    vendor = await _vendor(client, uuid.uuid4().hex[:6])

    me = await client.get("/api/social/me", headers=vendor["headers"])
    assert me.status_code == 200
    body = me.json()
    assert body["linked_to_vendor"] is True
    assert body["account"]["vendor_id"] is not None
    assert body["account"]["handle"] == vendor["handle"]

    # Asking twice returns the same identity, not a second one.
    again = await client.get("/api/social/me", headers=vendor["headers"])
    assert again.json()["account"]["id"] == body["account"]["id"]


async def test_two_vendors_do_not_collide_on_a_handle(client):
    a = await _vendor(client, uuid.uuid4().hex[:6])
    me_a = (await client.get("/api/social/me", headers=a["headers"])).json()

    # A standalone account that grabbed the second vendor's handle first.
    suffix = uuid.uuid4().hex[:6]
    b = await _vendor(client, suffix)
    squatter = await client.post(
        "/api/social/accounts",
        json={"handle": b["handle"], "display_name": "Squatter"},
    )
    # Registration is refused for a handle already claimed by a vendor's identity.
    if squatter.status_code == 201:
        me_b = (await client.get("/api/social/me", headers=b["headers"])).json()
        assert me_b["account"]["handle"] != b["handle"], "the vendor must get a free handle"
    else:
        assert squatter.status_code == 409
    assert me_a["account"]["id"]


async def test_the_social_token_is_not_a_vendor_token(client):
    """Scope has to cut both ways or a reader could act as a business."""
    account = await _social_account(client, uuid.uuid4().hex[:6])
    r = await client.get("/api/vendors/me", headers=account["headers"])
    assert r.status_code in (401, 403), f"social token opened a vendor route: {r.status_code}"
    r = await client.get("/api/social/me", headers=account["headers"])
    assert r.status_code == 200


async def test_the_feed_needs_a_signed_in_caller(client):
    assert (await client.get("/api/social/feed")).status_code == 401
    assert (await client.post("/api/social/posts", json={"body": "hello there"})).status_code == 401


# ── 2. reactions: one per account, and no power to hide ──────────────────────


async def test_one_reaction_per_account_however_many_times_you_tap(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    reader = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author)

    first = await client.post(
        f"/api/social/posts/{post['id']}/reactions", json={"value": "up"}, headers=reader["headers"]
    )
    assert first.status_code == 200
    assert first.json()["up"] == 1
    assert first.json()["down"] == 0

    # Same account, opposite opinion: the row is updated, not duplicated.
    changed = await client.post(
        f"/api/social/posts/{post['id']}/reactions", json={"value": "down"}, headers=reader["headers"]
    )
    assert changed.json()["up"] == 0
    assert changed.json()["down"] == 1
    assert changed.json()["participation"] == 1


async def test_a_reaction_can_be_withdrawn(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    reader = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author)

    await client.post(
        f"/api/social/posts/{post['id']}/reactions", json={"value": "up"}, headers=reader["headers"]
    )
    gone = await client.delete(f"/api/social/posts/{post['id']}/reactions", headers=reader["headers"])
    assert gone.status_code == 200
    assert gone.json()["participation"] == 0
    assert gone.json()["my_reaction"] is None


async def test_disagreement_lowers_reach_and_never_hides_a_post(client):
    """The product's central promise, exercised through the database."""
    author = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author, body="I think the market should move to the bypass road.")

    dissenters = [await _social_account(client, uuid.uuid4().hex[:6]) for _ in range(10)]
    for reader in dissenters:
        r = await client.post(
            f"/api/social/posts/{post['id']}/reactions", json={"value": "down"}, headers=reader["headers"]
        )
        assert r.status_code == 200

    viewer = await _social_account(client, uuid.uuid4().hex[:6])
    feed = await client.get("/api/social/feed", headers=viewer["headers"])
    assert feed.status_code == 200

    entries = {entry["post"]["id"]: entry for entry in feed.json()}
    assert post["id"] in entries, "ten downvotes removed a post from the feed"
    entry = entries[post["id"]]
    assert entry["post"]["status"] == "published"
    assert entry["verdict"]["down"] == 10
    assert entry["verdict"]["contested"] is True
    # The promise is a floor, not a promotion: it can never rank below it…
    from app.services.verdict import RANKING

    assert entry["score"] >= RANKING["contested_floor"]
    # …and a well-supported post still outranks it.
    assert entry["score"] < 0.6


async def test_nobody_may_vote_on_their_own_post(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author)
    r = await client.post(
        f"/api/social/posts/{post['id']}/reactions", json={"value": "up"}, headers=author["headers"]
    )
    assert r.status_code == 400


async def test_a_removed_post_cannot_be_reacted_to(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    reader = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author)

    await client.delete(f"/api/social/posts/{post['id']}", headers=author["headers"])
    r = await client.post(
        f"/api/social/posts/{post['id']}/reactions", json={"value": "up"}, headers=reader["headers"]
    )
    assert r.status_code == 404


async def test_only_the_author_can_remove_a_post(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    other = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author)

    denied = await client.delete(f"/api/social/posts/{post['id']}", headers=other["headers"])
    assert denied.status_code == 403
    still_there = await client.get("/api/social/feed", headers=other["headers"])
    assert post["id"] in {entry["post"]["id"] for entry in still_there.json()}


# ── 3. reports open a case, not a deletion ───────────────────────────────────


async def test_reporting_returns_a_case_and_leaves_the_post_standing(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    reporter = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author, body="A claim that needs a moderator's eyes.")

    r = await client.post(
        f"/api/social/posts/{post['id']}/reports",
        json={"reason": "misinformation", "detail": "The figure is wrong."},
        headers=reporter["headers"],
    )
    assert r.status_code == 201, r.text
    case = r.json()
    assert case["status"] == "received"
    assert case["case_number"].startswith("C-")

    feed = await client.get("/api/social/feed", headers=reporter["headers"])
    entry = {e["post"]["id"]: e for e in feed.json()}.get(post["id"])
    assert entry is not None, "reporting hid the post — that is moderation's job"
    assert entry["post"]["status"] == "published"


async def test_a_report_cannot_be_filed_twice(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    reporter = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author)

    first = await client.post(
        f"/api/social/posts/{post['id']}/reports", json={"reason": "spam"}, headers=reporter["headers"]
    )
    case = first.json()["case_number"]

    second = await client.post(
        f"/api/social/posts/{post['id']}/reports", json={"reason": "spam"}, headers=reporter["headers"]
    )
    assert second.status_code == 409
    assert case in second.json()["detail"]


async def test_you_cannot_report_yourself_and_find_your_cases(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    reporter = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author)

    own = await client.post(
        f"/api/social/posts/{post['id']}/reports", json={"reason": "other"}, headers=author["headers"]
    )
    assert own.status_code == 400

    await client.post(
        f"/api/social/posts/{post['id']}/reports", json={"reason": "harassment"}, headers=reporter["headers"]
    )
    mine = await client.get("/api/social/reports", headers=reporter["headers"])
    assert len(mine.json()) == 1
    assert mine.json()[0]["post_id"] == post["id"]

    # Other people's cases are not mine to read.
    theirs = await client.get("/api/social/reports", headers=author["headers"])
    assert theirs.json() == []


async def test_an_unknown_report_reason_is_refused(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    reporter = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author)
    r = await client.post(
        f"/api/social/posts/{post['id']}/reports",
        json={"reason": "i just do not like it"},
        headers=reporter["headers"],
    )
    assert r.status_code == 422


# ── 4. blocking and muting ───────────────────────────────────────────────────


async def test_blocking_removes_posts_from_your_feed_and_nobody_elses(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    blocker = await _social_account(client, uuid.uuid4().hex[:6])
    bystander = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author, body="A post the blocker would rather not see.")

    blocked = await client.post(
        "/api/social/blocks", json={"target_id": author["id"], "kind": "block"}, headers=blocker["headers"]
    )
    assert blocked.status_code == 201

    mine = await client.get("/api/social/feed", headers=blocker["headers"])
    assert post["id"] not in {entry["post"]["id"] for entry in mine.json()}

    theirs = await client.get("/api/social/feed", headers=bystander["headers"])
    assert post["id"] in {entry["post"]["id"] for entry in theirs.json()}, (
        "one viewer's block changed another viewer's feed"
    )

    # The block is the viewer's choice, not a verdict on the author.
    detail = await client.get(f"/api/social/feed", headers=bystander["headers"])
    entry = {e["post"]["id"]: e for e in detail.json()}[post["id"]]
    assert entry["post"]["status"] == "published"


async def test_a_block_can_be_lifted_in_both_directions(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    blocker = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author, body="A post that comes back when the block is lifted.")

    await client.post(
        "/api/social/blocks", json={"target_id": author["id"], "kind": "block"}, headers=blocker["headers"]
    )
    hidden = await client.get("/api/social/feed", headers=blocker["headers"])
    assert post["id"] not in {e["post"]["id"] for e in hidden.json()}

    lifted = await client.delete(f"/api/social/blocks/{author['id']}?kind=block", headers=blocker["headers"])
    assert lifted.status_code == 200

    back = await client.get("/api/social/feed", headers=blocker["headers"])
    assert post["id"] in {e["post"]["id"] for e in back.json()}


async def test_muting_is_a_separate_choice_from_blocking(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    muter = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author, body="A post that will be muted rather than blocked.")

    await client.post(
        "/api/social/blocks", json={"target_id": author["id"], "kind": "mute"}, headers=muter["headers"]
    )
    feed = await client.get("/api/social/feed", headers=muter["headers"])
    assert post["id"] not in {e["post"]["id"] for e in feed.json()}

    blocks = await client.get("/api/social/blocks?kind=mute", headers=muter["headers"])
    assert len(blocks.json()) == 1 and blocks.json()[0]["kind"] == "mute"

    # Lifting the mute must not silently lift a block that was never made.
    await client.delete(f"/api/social/blocks/{author['id']}?kind=mute", headers=muter["headers"])
    restored = await client.get("/api/social/feed", headers=muter["headers"])
    assert post["id"] in {e["post"]["id"] for e in restored.json()}


async def test_the_block_list_names_who_was_blocked_so_it_can_be_undone(client):
    """A block hides someone's posts, not their name.

    The safety screen has to offer "unblock Juma", and a row that carries only a
    UUID cannot be recognised by the person who did the blocking. So the list
    returns the target's handle and display name — and never their posts.
    """
    author = await _social_account(client, uuid.uuid4().hex[:6], display_name="Juma Odhiambo")
    blocker = await _social_account(client, uuid.uuid4().hex[:6])
    await _post(client, author, body="A post the blocker chose not to see again.")

    await client.post(
        "/api/social/blocks", json={"target_id": author["id"], "kind": "block"}, headers=blocker["headers"]
    )

    listed = await client.get("/api/social/blocks?kind=block", headers=blocker["headers"])
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) == 1
    target = rows[0]["target"]
    assert target["id"] == author["id"]
    assert target["handle"] == author["handle"]
    assert target["display_name"] == "Juma Odhiambo"

    # Still nobody else's business: another account sees an empty list.
    other = await _social_account(client, uuid.uuid4().hex[:6])
    theirs = await client.get("/api/social/blocks?kind=block", headers=other["headers"])
    assert theirs.json() == []


async def test_you_cannot_block_yourself_or_a_stranger(client):
    account = await _social_account(client, uuid.uuid4().hex[:6])
    me = await client.post(
        "/api/social/blocks", json={"target_id": account["id"], "kind": "block"}, headers=account["headers"]
    )
    assert me.status_code == 400

    ghost = await client.post(
        "/api/social/blocks", json={"target_id": str(uuid.uuid4()), "kind": "block"}, headers=account["headers"]
    )
    assert ghost.status_code == 404


# ── 5. ranking against real rows ────────────────────────────────────────────


async def test_the_feed_is_ordered_by_the_published_score_and_explains_itself(client):
    author = await _social_account(client, uuid.uuid4().hex[:6])
    quiet = await _post(client, author, body="A post nobody has reacted to yet, and that is fine.")

    popular = await _post(client, author, body="A post the community found useful this morning.")
    for _ in range(6):
        reader = await _social_account(client, uuid.uuid4().hex[:6])
        await client.post(
            f"/api/social/posts/{popular['id']}/reactions", json={"value": "up"}, headers=reader["headers"]
        )

    viewer = await _social_account(client, uuid.uuid4().hex[:6])
    feed = (await client.get("/api/social/feed", headers=viewer["headers"])).json()
    order = [entry["post"]["id"] for entry in feed]

    assert order.index(popular["id"]) < order.index(quiet["id"])
    entry = {e["post"]["id"]: e for e in feed}[popular["id"]]
    assert set(entry["parts"]) == {"confidence", "participation", "recency", "circle"}
    assert 0 <= entry["score"] <= 1
    assert entry["verdict"]["up"] == 6


async def test_following_a_circle_is_what_makes_it_yours(client):
    vendor = await _vendor(client, uuid.uuid4().hex[:6])
    circle = await _circle(client, vendor)

    author = await _social_account(client, uuid.uuid4().hex[:6])
    inside = await _post(client, author, circle_id=circle["id"], body="Posted into a circle, where it belongs.")

    viewer = await _social_account(client, uuid.uuid4().hex[:6])
    before = (await client.get("/api/social/feed", headers=viewer["headers"])).json()
    fit_before = {e["post"]["id"]: e["parts"]["circle"] for e in before}[inside["id"]]

    followed = await client.post(f"/api/social/circles/{circle['id']}/follow", headers=viewer["headers"])
    assert followed.status_code == 201

    after = (await client.get("/api/social/feed", headers=viewer["headers"])).json()
    fit_after = {e["post"]["id"]: e["parts"]["circle"] for e in after}[inside["id"]]

    assert fit_before < fit_after
    assert fit_after == 1

    await client.delete(f"/api/social/circles/{circle['id']}/follow", headers=viewer["headers"])
    unfollowed = (await client.get("/api/social/feed", headers=viewer["headers"])).json()
    assert {e["post"]["id"]: e["parts"]["circle"] for e in unfollowed}[inside["id"]] == fit_before


async def test_a_private_circle_refuses_strangers_but_not_members(client):
    vendor = await _vendor(client, uuid.uuid4().hex[:6])
    private = await _circle(client, vendor, public=False)

    stranger = await _social_account(client, uuid.uuid4().hex[:6])
    denied = await client.post(
        "/api/social/posts",
        json={"body": "Trying to write into a private circle.", "circle_id": private["id"]},
        headers=stranger["headers"],
    )
    assert denied.status_code == 403

    # A public circle is open to everyone — that is what public means here.
    public = await _circle(client, vendor, public=True)
    allowed = await client.post(
        "/api/social/posts",
        json={"body": "Writing into a public circle as a stranger.", "circle_id": public["id"]},
        headers=stranger["headers"],
    )
    assert allowed.status_code == 201


async def test_circle_feeds_stay_inside_their_circle(client):
    vendor = await _vendor(client, uuid.uuid4().hex[:6])
    circle = await _circle(client, vendor)
    author = await _social_account(client, uuid.uuid4().hex[:6])

    inside = await _post(client, author, circle_id=circle["id"], body="Only in this circle.")
    outside = await _post(client, author, body="Not in any circle at all.")

    viewer = await _social_account(client, uuid.uuid4().hex[:6])
    feed = (await client.get(f"/api/social/feed?circle_id={circle['id']}", headers=viewer["headers"])).json()
    ids = {entry["post"]["id"] for entry in feed}
    assert inside["id"] in ids
    assert outside["id"] not in ids


async def test_a_short_post_is_refused_by_the_shape_of_the_rule(client):
    account = await _social_account(client, uuid.uuid4().hex[:6])
    r = await client.post("/api/social/posts", json={"body": "hi"}, headers=account["headers"])
    assert r.status_code == 422


async def test_the_feed_tells_each_reader_their_own_reaction(client):
    """The card has to know which button is pressed for *this* reader, without
    shipping every reaction in the network to every client."""
    author = await _social_account(client, uuid.uuid4().hex[:6])
    reader = await _social_account(client, uuid.uuid4().hex[:6])
    other = await _social_account(client, uuid.uuid4().hex[:6])
    post = await _post(client, author, body="A post two people will react to differently.")

    await client.post(
        f"/api/social/posts/{post['id']}/reactions", json={"value": "up"}, headers=reader["headers"]
    )
    await client.post(
        f"/api/social/posts/{post['id']}/reactions", json={"value": "down"}, headers=other["headers"]
    )

    mine = {e["post"]["id"]: e for e in (await client.get("/api/social/feed", headers=reader["headers"])).json()}
    theirs = {e["post"]["id"]: e for e in (await client.get("/api/social/feed", headers=other["headers"])).json()}
    bystander = await _social_account(client, uuid.uuid4().hex[:6])
    none = {e["post"]["id"]: e for e in (await client.get("/api/social/feed", headers=bystander["headers"])).json()}

    assert mine[post["id"]]["my_reaction"] == "up"
    assert theirs[post["id"]]["my_reaction"] == "down"
    assert none[post["id"]]["my_reaction"] is None
    # …and both readers see the same community verdict.
    assert mine[post["id"]]["verdict"]["participation"] == 2
    assert theirs[post["id"]]["verdict"]["participation"] == 2

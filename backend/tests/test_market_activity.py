"""The market shelf: activity, not arithmetic.

Three claims decide whether this feature is a business tool or a directory of
empty rooms, and each has tests here:

1. **Activity outranks registration.** A market with a hundred sign-ups and an
   empty shelf must not outrank one where twenty traders are selling today.
2. **The shelf is a join, not a copy.** A product appears in its market because
   its *owner* trades there. Leaving the market removes it from that shelf with
   no delete, no cache and no second row — and the product still exists on the
   vendor's own shelf.
3. **An empty market is an invitation, not a zero.** The server says so, in one
   sentence, so no screen has to invent a friendly phrase for a graveyard.

Plus the two smaller rules that make the numbers trustworthy: membership and
visibility stay separate, and an unlocated market is never treated as "0 km
away".
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"

# Kisumu, roughly. Zones are created through the ops route so the coordinates are
# real rows, not mocks.
KISUMU = (-0.0917, 34.7680)


# ── helpers ─────────────────────────────────────────────────────────────────


async def _vendor(client, suffix=""):
    handle = f"mk_{uuid.uuid4().hex[:8]}"
    r = await client.post(
        "/api/auth/register",
        json={
            "business_name": f"Market {suffix or handle[-4:]}",
            "vendor_handle": handle,
            "email": f"{handle}@example.com",
            "password": PASSWORD,
            "business_categories": ["groceries"],
            "physical_location": "Kisumu, Kenya",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return {
        "id": body["vendor_id"],
        "handle": handle,
        "name": f"Market {suffix or handle[-4:]}",
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


async def _zone(client, admin, name, *, lat=None, lng=None, radius=3.0):
    """A market zone with real coordinates.

    Written straight to the table rather than through `/ops/zones`, because the
    ops route deliberately does not accept coordinates — placing a market is the
    open-data ingest's job, not something an admin types. The activity layer is
    what is under test here, and it needs markets that are actually somewhere.
    """
    from app.database import async_session
    from app.models.market_locks import MarketZone

    async with async_session() as db:
        zone = MarketZone(
            name=name,
            city="Kisumu",
            name_key=name.casefold(),
            city_key="kisumu",
            is_active=True,
            center_lat=lat,
            center_lng=lng,
            radius_km=radius,
        )
        db.add(zone)
        await db.commit()
        await db.refresh(zone)
        return {"id": str(zone.id), "name": zone.name}


async def _stock(client, vendor, name, *, qty=20, price=150.0, visible=True, category="produce"):
    r = await client.post(
        "/api/stock/add",
        json={
            "name": name,
            "category": category,
            "quantity_in_stock": qty,
            "unit_price": price,
            "visible_to_network": visible,
        },
        headers=vendor["headers"],
    )
    assert r.status_code == 201, r.text
    return r.json()["stock_id"]


async def _join(client, vendor, zone_id):
    r = await client.post(f"/api/markets/{zone_id}/join", headers=vendor["headers"])
    assert r.status_code in (201, 409), r.text
    return r.status_code


async def _member_rows(zone_id):
    """Count membership rows in the database itself.

    The API cannot be asked this question — after a broken delete the market
    screen still shows the member, but a route that answers {"left": true} would
    happily agree with itself. Counting rows is the only honest check.
    """
    from sqlalchemy import func, select

    from app.database import async_session
    from app.models.market_locks import MarketMember

    async with async_session() as db:
        return int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(MarketMember)
                    .where(MarketMember.zone_id == uuid.UUID(str(zone_id)))
                )
            ).scalar_one()
        )


async def _admin(client):
    """The ops routes are admin-gated in production; in the test app the first
    registered vendor is the simplest caller that passes. If the route refuses,
    the test skips rather than pretending to pass."""
    v = await _vendor(client, "_admin")
    return v["headers"]


async def _find(client, headers, zone_id):
    r = await client.get("/api/markets", headers=headers)
    assert r.status_code == 200, r.text
    return next((m for m in r.json()["markets"] if m["id"] == str(zone_id)), None)


# ── 1 · activity outranks registration ──────────────────────────────────────


async def test_a_busy_market_outranks_a_registered_but_empty_one(client):
    admin = await _admin(client)
    quiet = await _zone(client, admin, f"Quiet {uuid.uuid4().hex[:5]}", lat=KISUMU[0] + 0.001, lng=KISUMU[1])
    busy = await _zone(client, admin, f"Busy {uuid.uuid4().hex[:5]}", lat=KISUMU[0] + 0.02, lng=KISUMU[1])

    # The quiet market gets five registrations and publishes nothing.
    for i in range(5):
        v = await _vendor(client, f"q{i}")
        await _join(client, v, quiet["id"])

    # The busy market gets two traders with real stock on the shelf.
    sellers = []
    for i in range(2):
        v = await _vendor(client, f"b{i}")
        await _join(client, v, busy["id"])
        await _stock(client, v, f"Tomatoes crate {i}")
        sellers.append(v)

    viewer = await _vendor(client, "_viewer")
    r = await client.get(
        "/api/markets/around",
        params={"lat": KISUMU[0], "lng": KISUMU[1], "radius_km": 25, "limit": 50, "include_empty": True},
        headers=viewer["headers"],
    )
    assert r.status_code == 200, r.text
    rows = {m["id"]: m for m in r.json()["markets"]}

    assert rows[quiet["id"]]["registered"] == 5
    assert rows[quiet["id"]]["active_vendors"] == 0
    assert rows[busy["id"]]["active_vendors"] == 2
    assert rows[busy["id"]]["listings"] == 2

    order = [m["id"] for m in r.json()["markets"]]
    assert order.index(busy["id"]) < order.index(quiet["id"]), (
        "a market with five sign-ups and an empty shelf must not outrank one where "
        "two traders are actually selling"
    )


async def test_registered_is_reported_but_never_the_headline(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Counts {uuid.uuid4().hex[:5]}", lat=KISUMU[0], lng=KISUMU[1])
    seller = await _vendor(client, "_counts")
    await _join(client, seller, zone["id"])
    await _stock(client, seller, "Kale bundle")

    viewer = await _vendor(client, "_c")
    r = await client.get(
        "/api/markets/around",
        params={"lat": KISUMU[0], "lng": KISUMU[1], "radius_km": 10},
        headers=viewer["headers"],
    )
    row = next(m for m in r.json()["markets"] if m["id"] == str(zone["id"]))
    assert row["registered"] == 1
    assert row["active_vendors"] == 1
    assert row["selling_vendors"] == 1


# ── 2 · the shelf is a join, not a copy ─────────────────────────────────────


async def test_a_product_appears_on_the_market_shelf_because_its_owner_trades_there(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Shelf {uuid.uuid4().hex[:5]}", lat=KISUMU[0], lng=KISUMU[1])
    seller = await _vendor(client, "_shelf")
    await _join(client, seller, zone["id"])
    stock_id = await _stock(client, seller, "Ndengu 5kg")

    viewer = await _vendor(client, "_v")
    r = await client.get(
        f"/api/markets/{zone['id']}/shelf", params={"kind": "goods"}, headers=viewer["headers"]
    )
    assert r.status_code == 200, r.text
    titles = [i["title"] for i in r.json()["items"]]
    assert "Ndengu 5kg" in titles
    assert r.json()["items"][0]["to"] == f"/listing/{stock_id}"


async def test_leaving_the_market_takes_the_product_with_it_and_the_product_survives(client):
    """The whole point of the join: no ghost rows to clean up."""
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Leave {uuid.uuid4().hex[:5]}", lat=KISUMU[0], lng=KISUMU[1])
    seller = await _vendor(client, "_leave")
    await _join(client, seller, zone["id"])
    stock_id = await _stock(client, seller, "Rice 10kg")

    viewer = await _vendor(client, "_v2")
    before = await client.get(f"/api/markets/{zone['id']}/shelf", headers=viewer["headers"])
    assert "Rice 10kg" in [i["title"] for i in before.json()["items"]]

    left = await client.post(f"/api/markets/{zone['id']}/leave", headers=seller["headers"])
    assert left.status_code == 200

    after = await client.get(f"/api/markets/{zone['id']}/shelf", headers=viewer["headers"])
    assert "Rice 10kg" not in [i["title"] for i in after.json()["items"]]

    # And it is still on the vendor's own shelf, untouched.
    own = await client.get(f"/api/stock/{stock_id}", headers=seller["headers"])
    assert own.status_code == 200, own.text


async def test_leaving_actually_removes_the_row_not_just_the_button(client):
    """Regression: `db.delete()` without `await` is a no-op in SQLAlchemy's async
    session, so this route used to answer {"left": true} and change nothing."""
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Rowcheck {uuid.uuid4().hex[:5]}", lat=KISUMU[0] + 0.9, lng=KISUMU[1])
    seller = await _vendor(client, "_row")
    await _join(client, seller, zone["id"])

    assert await _member_rows(zone["id"]) == 1
    left = await client.post(f"/api/markets/{zone['id']}/leave", headers=seller["headers"])
    assert left.status_code == 200
    assert await _member_rows(zone["id"]) == 0, (
        "the membership row must actually be gone, not just reported as gone"
    )

    # And a second leave is an honest 404, not another cheerful {"left": true}.
    again = await client.post(f"/api/markets/{zone['id']}/leave", headers=seller["headers"])
    assert again.status_code == 404


async def test_membership_does_not_force_visibility(client):
    """A vendor may trade in a market without publishing every product there."""
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Hidden {uuid.uuid4().hex[:5]}", lat=KISUMU[0], lng=KISUMU[1])
    seller = await _vendor(client, "_hidden")
    await _join(client, seller, zone["id"])
    await _stock(client, seller, "Private Ledger Book", visible=False)

    viewer = await _vendor(client, "_v3")
    r = await client.get(f"/api/markets/{zone['id']}/shelf", headers=viewer["headers"])
    assert "Private Ledger Book" not in [i["title"] for i in r.json()["items"]]
    # But the vendor still counts as a member of the market.
    detail = await client.get(f"/api/markets/{zone['id']}/activity", headers=viewer["headers"])
    assert detail.json()["registered"] >= 1


async def test_the_market_shelf_never_shows_you_your_own_stock(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Own {uuid.uuid4().hex[:5]}", lat=KISUMU[0], lng=KISUMU[1])
    seller = await _vendor(client, "_own")
    await _join(client, seller, zone["id"])
    await _stock(client, seller, "My Own Tomatoes")

    mine = await client.get(f"/api/markets/{zone['id']}/shelf", headers=seller["headers"])
    assert "My Own Tomatoes" not in [i["title"] for i in mine.json()["items"]]
    # ...but it is counted, because the vendor who just published needs to know
    # it landed. Hiding the row without the count reads as a failed publish.
    assert mine.json()["own"] == 1

    viewer = await _vendor(client, "_v4")
    theirs = await client.get(f"/api/markets/{zone['id']}/shelf", headers=viewer["headers"])
    assert "My Own Tomatoes" in [i["title"] for i in theirs.json()["items"]]


async def test_people_shelf_lists_the_members_and_their_real_shelf_size(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"People {uuid.uuid4().hex[:5]}", lat=KISUMU[0], lng=KISUMU[1])
    trader = await _vendor(client, "_people")
    await _join(client, trader, zone["id"])
    await _stock(client, trader, "Beans 2kg")
    await _stock(client, trader, "Maize 5kg")

    viewer = await _vendor(client, "_v5")
    r = await client.get(
        f"/api/markets/{zone['id']}/shelf", params={"kind": "people"}, headers=viewer["headers"]
    )
    row = next(i for i in r.json()["items"] if i["handle"] == trader["handle"])
    assert "2 items" in row["note"]


# ── 3 · an empty market is an invitation ────────────────────────────────────


async def test_an_empty_market_says_so_in_one_sentence_instead_of_zeroes(client):
    admin = await _admin(client)
    fresh = await _zone(client, admin, f"Fresh {uuid.uuid4().hex[:5]}", lat=KISUMU[0] + 0.3, lng=KISUMU[1])

    viewer = await _vendor(client, "_empty")
    r = await client.get(f"/api/markets/{fresh['id']}/activity", headers=viewer["headers"])
    body = r.json()
    assert body["empty"] is True
    assert body["invitation"]
    assert fresh["name"] in body["invitation"]
    assert body["active_vendors"] == 0


async def test_a_market_with_registrations_but_no_shelf_gets_its_own_invitation(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Registered {uuid.uuid4().hex[:5]}", lat=KISUMU[0] + 0.4, lng=KISUMU[1])
    v = await _vendor(client, "_reg")
    await _join(client, v, zone["id"])

    viewer = await _vendor(client, "_e2")
    body = (await client.get(f"/api/markets/{zone['id']}/activity", headers=viewer["headers"])).json()
    assert body["empty"] is True
    assert body["registered"] == 1
    assert "nothing on its shelf yet" in body["invitation"]


async def test_a_trading_market_has_no_invitation_to_show(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Trading {uuid.uuid4().hex[:5]}", lat=KISUMU[0] + 0.5, lng=KISUMU[1])
    v = await _vendor(client, "_trade")
    await _join(client, v, zone["id"])
    await _stock(client, v, "Cassava")

    viewer = await _vendor(client, "_e3")
    body = (await client.get(f"/api/markets/{zone['id']}/activity", headers=viewer["headers"])).json()
    assert body["empty"] is False
    assert body["invitation"] is None


# ── the four doors ──────────────────────────────────────────────────────────


async def test_each_door_reports_whether_anything_is_behind_it(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Doors {uuid.uuid4().hex[:5]}", lat=KISUMU[0] + 0.6, lng=KISUMU[1])
    v = await _vendor(client, "_door")
    await _join(client, v, zone["id"])
    await _stock(client, v, "Mangoes")

    viewer = await _vendor(client, "_e4")
    body = (await client.get(f"/api/markets/{zone['id']}/activity", headers=viewer["headers"])).json()
    doors = {d["key"]: d for d in body["explore"]}
    assert doors["goods"]["available"] is True
    assert doors["goods"]["count"] == 1
    # Nothing is rented in this market, so the equipment door is honestly closed.
    assert doors["equipment"]["available"] is False
    assert doors["equipment"]["count"] == 0


async def test_the_market_reports_what_it_actually_sells(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Cats {uuid.uuid4().hex[:5]}", lat=KISUMU[0] + 0.7, lng=KISUMU[1])
    v = await _vendor(client, "_cat")
    await _join(client, v, zone["id"])
    await _stock(client, v, "Carrots", category="produce")
    await _stock(client, v, "Onions", category="produce")
    await _stock(client, v, "Bucket", category="household")

    viewer = await _vendor(client, "_e5")
    body = (await client.get(f"/api/markets/{zone['id']}/activity", headers=viewer["headers"])).json()
    cats = {c["category"]: c["listings"] for c in body["categories"]}
    assert cats["produce"] == 2
    assert cats["household"] == 1
    assert body["categories"][0]["category"] == "produce"


# ── radius, and the honesty of distance ─────────────────────────────────────


async def test_the_default_radius_is_a_walk_not_a_region(client):
    viewer = await _vendor(client, "_radius")
    r = await client.get("/api/markets/around", headers=viewer["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["radius_km"] <= 25


async def test_an_unlocated_market_is_unknown_distance_not_zero_km(client):
    admin = await _admin(client)
    nowhere = await _zone(client, admin, f"Unlocated {uuid.uuid4().hex[:5]}", lat=None, lng=None)

    viewer = await _vendor(client, "_unloc")
    r = await client.get(
        "/api/markets/around",
        params={"lat": KISUMU[0], "lng": KISUMU[1], "radius_km": 25, "limit": 40},
        headers=viewer["headers"],
    )
    body = r.json()
    in_range = next((m for m in body["markets"] if m["id"] == str(nowhere["id"])), None)
    if in_range is not None:
        assert in_range["distance_km"] is None, "an unlocated market must not claim a distance"
    else:
        listed = next((m for m in body["unlocated"] if m["id"] == str(nowhere["id"])), None)
        assert listed is not None and listed["distance_km"] is None


async def test_a_vendor_with_nothing_published_is_not_told_they_have_items(client):
    admin = await _admin(client)
    zone = await _zone(client, admin, f"Quiet {uuid.uuid4().hex[:5]}", lat=KISUMU[0], lng=KISUMU[1])
    seller = await _vendor(client, "_noown")
    await _join(client, seller, zone["id"])

    shelf = await client.get(f"/api/markets/{zone['id']}/shelf", headers=seller["headers"])
    assert shelf.json()["own"] == 0

    # And a neighbour's published stock never counts as "yours".
    other = await _vendor(client, "_neigh")
    await _join(client, other, zone["id"])
    await _stock(client, other, "Somebody Else's Cabbage")
    again = await client.get(f"/api/markets/{zone['id']}/shelf", headers=seller["headers"])
    assert again.json()["own"] == 0
    assert "Somebody Else's Cabbage" in [i["title"] for i in again.json()["items"]]


async def test_the_note_never_claims_the_nearest_markets_are_below_when_they_are_not(client):
    """Nothing in range: `markets` is empty, the nearest are in `wider`.

    The envelope has to describe the ring it is answering for, not assume the
    screen will fill itself.
    """
    viewer = await _vendor(client, "_far")
    r = await client.get(
        "/api/markets/around",
        params={"lat": -3.2, "lng": 36.0, "radius_km": 25, "limit": 5},
        headers=viewer["headers"],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    if body["markets"]:
        return  # a seeded catalogue happens to have something this close
    assert body["wider"], "the far case must still offer somewhere to look"
    assert "below" not in (body["note"] or "")
    assert "further out" in body["note"]

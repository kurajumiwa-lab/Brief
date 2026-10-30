"""The guide: suggestions, parsing, the shelf map and demand.

What is being tested is not "the endpoint answers". Three claims decide whether
this feature is honest, and each has tests here:

1. **It cannot invent.** Every item suggestion corresponds to a ``stock_items``
   row that exists, is visible to the network and has stock right now. Remove
   the row and the suggestion disappears.
2. **It says how it knows.** ``next`` always returns ``basis``: ``observed``
   when the counts in this database produced the answer, ``declared`` when the
   shelf map did. A young network must not pass its signage off as learning.
3. **It does not identify anybody.** ``/demand`` is floored at three searches;
   two people asking for the same missing thing returns nothing, so a single
   person's question can never be read back.

Plus the parser, which has to be right about what it understood and honest about
what it did not.
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _vendor(client, suffix="_guide"):
    handle = f"gd_{uuid.uuid4().hex[:8]}"
    r = await client.post(
        "/api/auth/register",
        json={
            "business_name": f"Guide {suffix}",
            "vendor_handle": handle,
            "email": f"{handle}@example.com",
            "password": PASSWORD,
            "business_categories": ["groceries"],
            "physical_location": "Kisumu, Kenya",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return {"id": body["vendor_id"], "headers": {"Authorization": f"Bearer {body['access_token']}"}}


async def _stock(client, vendor, name, *, qty=20, price=180.0, visible=True):
    r = await client.post(
        "/api/stock/add",
        json={
            "name": name,
            "category": "produce",
            "quantity_in_stock": qty,
            "quantity_available": qty,
            "unit_price": price,
            "visible_to_network": visible,
        },
        headers=vendor["headers"],
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


# ── 0 · typeahead ────────────────────────────────────────────────────────────


async def _member(client):
    v = await _vendor(client)
    return v["headers"]


async def test_suggest_offers_shelves_by_the_words_people_type(client):
    headers = await _member(client)
    r = await client.get("/api/guide/suggest", params={"q": "serv"}, headers=headers)
    assert r.status_code == 200, r.text
    kinds = [s["kind"] for s in r.json()["suggestions"]]
    assert "shelf" in kinds
    assert any(s.get("shelf") == "services" for s in r.json()["suggestions"])


async def test_suggest_offers_a_real_item_and_says_how_many_shelves_carry_it(client):
    owner = await _vendor(client)
    await _stock(client, owner, "Ripe Tomatoes Grade A", qty=40, price=150.0)

    buyer = await _vendor(client, "_buyer")
    r = await client.get("/api/guide/suggest", params={"q": "tomato"}, headers=buyer["headers"])
    assert r.status_code == 200, r.text
    items = [s for s in r.json()["suggestions"] if s["kind"] == "item"]
    assert items, r.json()
    assert items[0]["label"] == "Ripe Tomatoes Grade A"
    assert "1 shelf carries it" in items[0]["blurb"]
    assert "KSh 150" in items[0]["blurb"]


async def test_suggest_never_offers_a_name_it_cannot_deliver(client):
    """The row is there but invisible, or empty. Neither may be suggested."""
    owner = await _vendor(client)
    await _stock(client, owner, "Secret Habanero", qty=10, visible=False)
    await _stock(client, owner, "Sold Out Sukuma", qty=0)

    hidden = await client.get("/api/guide/suggest", params={"q": "habanero"}, headers=owner["headers"])
    assert not [s for s in hidden.json()["suggestions"] if s["kind"] == "item"]

    empty = await client.get("/api/guide/suggest", params={"q": "sukuma"}, headers=owner["headers"])
    assert not [s for s in empty.json()["suggestions"] if s["kind"] == "item"]


async def test_suggest_does_not_offer_the_viewers_own_shelf_back_to_them(client):
    owner = await _vendor(client)
    await _stock(client, owner, "Ndengu Green Grams", qty=30)

    mine = await client.get("/api/guide/suggest", params={"q": "ndengu"}, headers=owner["headers"])
    assert not [s for s in mine.json()["suggestions"] if s["kind"] == "item"]

    stranger = await client.get("/api/guide/suggest", params={"q": "ndengu"}, headers=(await _vendor(client))["headers"])
    assert [s for s in stranger.json()["suggestions"] if s["kind"] == "item"]


async def test_a_single_letter_is_not_a_suggestion(client):
    r = await client.get("/api/guide/suggest", params={"q": "t"}, headers=await _member(client))
    assert r.json()["suggestions"] == []
    assert "two letters" in r.json()["note"]


# ── 2 · a sentence becomes filters ───────────────────────────────────────────


async def test_parse_pulls_price_distance_and_shelf_out_of_a_sentence(client):
    owner = await _vendor(client, "_parse")
    await _stock(client, owner, "Tomatoes (crate)")

    r = await client.get(
        "/api/guide/parse",
        params={"q": "tomatoes under 200 bob within 5km"},
        headers=owner["headers"],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["filters"]["price_max"] == 200.0
    assert body["filters"]["within_km"] == 5.0
    # "tomatoes" names no shelf, so the catalogue answered instead of a guess.
    assert body["shelf"] == "stock"
    assert body["shelf_basis"] == "catalogue"
    assert "tomatoes" in body["keywords"]
    # The currency word is part of the price, not a search term.
    assert "bob" not in body["keywords"]
    assert any("price up to 200" in line for line in body["understood"])


async def test_parse_does_not_guess_a_shelf_it_has_no_evidence_for(client):
    r = await client.get(
        "/api/guide/parse",
        params={"q": "unobtainium under 900"},
        headers=await _member(client),
    )
    body = r.json()
    assert body["shelf"] is None
    assert body["shelf_basis"] == "none"
    assert body["filters"]["price_max"] == 900.0


async def test_parse_separates_filters_from_search_words(client):
    """"urgent fertiliser" is not a filter — it is what to look for. Only the
    price becomes a query parameter, and the response says which is which."""
    r = await client.get(
        "/api/guide/parse", params={"q": "urgent fertiliser under 1500"}, headers=await _member(client)
    )
    body = r.json()
    assert body["filters"]["price_max"] == 1500.0
    assert "urgent" in body["keywords"] and "fertiliser" in body["keywords"]
    assert "keywords" not in body["filters"]
    assert any("looking for" in line for line in body["understood"])


async def test_parse_takes_a_quantity_with_its_unit(client):
    r = await client.get("/api/guide/parse", params={"q": "need 50 kg of rice"}, headers=await _member(client))
    body = r.json()
    assert body["filters"]["quantity"] == 50
    assert body["filters"]["unit"] == "kg"
    assert any("50 kg" in line for line in body["understood"])


# ── 1 · the shelf map ────────────────────────────────────────────────────────


async def test_a_new_network_is_told_its_suggestions_are_the_shelf_map_not_learning(client):
    r = await client.get("/api/guide/next", params={"from": "stock"}, headers=await _member(client))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["basis"] == "declared"
    assert [s["shelf"] for s in body["suggestions"]][:1] == ["markets"]
    assert "shelf map" in body["why"]


async def test_observed_navigation_supersedes_the_map_once_there_is_evidence(client):
    """25 vendors' worth of visits, then the learned answer must win."""
    vendor = await _vendor(client, "_nav")
    # Direct rows: the beacon is the client's job, the learning is this test's.
    for _ in range(25):
        await client.post("/api/guide/visited", json={"shelf": "stock"}, headers=vendor["headers"])
        await client.post("/api/guide/visited", json={"shelf": "notices"}, headers=vendor["headers"])

    r = await client.get("/api/guide/next", params={"from": "stock"}, headers=vendor["headers"])
    body = r.json()
    assert body["basis"] == "observed", body
    assert body["suggestions"][0]["shelf"] == "notices"
    assert "next taps" in body["suggestions"][0]["blurb"]


async def test_an_unknown_shelf_gets_no_suggestion_rather_than_a_guess(client):
    r = await client.get("/api/guide/next", params={"from": "nonsense"}, headers=await _member(client))
    assert r.json()["basis"] == "none"
    assert r.json()["suggestions"] == []


# ── demand ───────────────────────────────────────────────────────────────────


async def test_a_missed_search_is_remembered_as_demand(client):
    u = uuid.uuid4().hex[:6]
    term = f"irrigation drippers {u}"
    for _ in range(3):
        r = await client.post(
            "/api/guide/searched", json={"query": term, "result_count": 0}, headers=await _member(client)
        )
        assert r.status_code == 202, r.text

    demand = await client.get("/api/guide/demand", params={"days": 30}, headers=await _member(client))
    entries = {e["query"]: e for e in demand.json()["wanted_and_missing"]}
    assert term in entries, demand.json()
    assert entries[term]["searches"] >= 3


async def test_two_people_are_not_enough_to_expose_what_was_asked(client):
    """The floor is the privacy rule: below three, return nothing."""
    term = f"one person only {uuid.uuid4().hex[:6]}"
    for _ in range(2):
        await client.post(
            "/api/guide/searched", json={"query": term, "result_count": 0}, headers=await _member(client)
        )

    demand = await client.get("/api/guide/demand", params={"days": 30}, headers=await _member(client))
    assert all(e["query"] != term for e in demand.json()["wanted_and_missing"])


async def test_a_search_that_found_something_is_not_demand(client):
    term = f"bread flour {uuid.uuid4().hex[:6]}"
    for _ in range(3):
        await client.post(
            "/api/guide/searched", json={"query": term, "result_count": 7}, headers=await _member(client)
        )

    demand = await client.get("/api/guide/demand", params={"days": 30}, headers=await _member(client))
    assert all(e["query"] != term for e in demand.json()["wanted_and_missing"])


async def test_the_demand_floor_cannot_be_lowered_below_three(client):
    r = await client.get("/api/guide/demand", params={"minimum": 1}, headers=await _member(client))
    assert r.status_code == 422


# ── the shelves are one list ────────────────────────────────────────────────


async def test_the_server_and_the_screen_agree_on_the_nine_shelves(client):
    r = await client.get("/api/guide/shelves", headers=await _member(client))
    keys = [s["key"] for s in r.json()["shelves"]]
    assert keys == [
        "stock",
        "services",
        "people",
        "equipment",
        "opportunities",
        "events",
        "community",
        "markets",
        "notices",
    ]

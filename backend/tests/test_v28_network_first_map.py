"""v2.8 — the network-first map.

The v2.7 contract (one screenful, clusters, no directory dumps) still holds.
This file adds the product rule on top of it: **a location on the map is not
automatically part of the marketplace.**

Every test here asserts on the tier system:

    network   — claimed places, vendors, markets with registered suppliers
    external  — unclaimed public-data rows the source still confirms
    stale     — rows the source stopped confirming: off the commercial map

… and on the ranking rule: suppliers are ranked by current offers
(availability → verification → network score → distance), never by distance
alone.
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.market_locks import MarketMember, MarketZone
from app.models.public_place import PublicPlace
from app.models.stock import StockItem
from app.models.vendor import Vendor
from app.services import map_viewport as mv

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"

CENTRE = (-1.2867, 36.8172)
ZOOMED_BBOX = "36.8100,-1.2920,36.8260,-1.2800"
REGION_BBOX = "32.0000,-2.0000,38.0000,1.0000"


# ── fixtures ───────────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _clear_map_caches():
    mv.viewport_cache.clear()
    mv.counts_cache.clear()
    yield
    mv.viewport_cache.clear()
    mv.counts_cache.clear()


@pytest.fixture
async def me(client):
    """The viewer: a vendor anchored in the Nairobi CBD."""
    suffix = uuid.uuid4().hex[:8]
    handle = f"nf_{suffix}"
    r = await client.post("/api/auth/register", json={
        "business_name": f"Network First {suffix[:4]}", "vendor_handle": handle,
        "email": f"{handle}@example.com", "password": PASSWORD,
        "business_categories": ["electronics"], "physical_location": "Nairobi",
    })
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    async with async_session() as db:
        vendor = (await db.execute(
            select(Vendor).where(Vendor.vendor_handle == handle))).scalars().first()
        vendor.geo_lat, vendor.geo_lng = CENTRE
        await db.commit()
    return headers


async def _me_vendor_id() -> str:
    async with async_session() as db:
        vendor = (await db.execute(
            select(Vendor).where(Vendor.vendor_handle.like("nf_%"))
            .order_by(Vendor.joined_at.desc()))).scalars().first()
        return str(vendor.id)


async def _seed_place(name="Place", lat=None, lng=None, claimed_by=None,
                      checked_days_ago=0):
    """One place row with an explicit tier story: who claimed it (if anyone)
    and how long ago the source last confirmed it."""
    days = checked_days_ago
    async with async_session() as db:
        row = PublicPlace(
            source="openstreetmap", external_id=f"way/{uuid.uuid4().hex[:10]}",
            name=name, category="shop:convenience", detail="convenience",
            address="1 Test Lane", lat=lat if lat is not None else CENTRE[0],
            lng=lng if lng is not None else CENTRE[1],
            first_seen_at=datetime.utcnow() - timedelta(days=days + 30),
            last_checked_at=datetime.utcnow() - timedelta(days=days),
            claimed_by_vendor_id=claimed_by,
            status="claimed" if claimed_by else "active",
        )
        db.add(row)
        await db.commit()
        return str(row.id)


async def _claim_place(place_id: str, vendor_id: str):
    async with async_session() as db:
        row = await db.get(PublicPlace, uuid.UUID(place_id))
        row.claimed_by_vendor_id = uuid.UUID(vendor_id)
        row.status = "claimed"
        await db.commit()


async def _seed_vendor_with_stock(name, lat, lng, in_stock=3, verified=False):
    """A network supplier with `in_stock` live lines on the shelf."""
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as db:
        v = Vendor(
            business_name=name, vendor_handle=f"{name.lower().replace(' ', '')}_{suffix}",
            email=f"{suffix}@example.com", password_hash="x",
            business_categories=["groceries"], geo_lat=lat, geo_lng=lng,
            is_verified=verified, network_score=10.0,
        )
        db.add(v)
        await db.flush()
        for i in range(in_stock):
            db.add(StockItem(
                vendor_id=v.id, name=f"{name} line {i}", category="grain",
                quantity_in_stock=50, quantity_available=50, visible_to_network=True,
            ))
        await db.commit()
        return str(v.id)


async def _seed_market(name, members=0, with_stock=0):
    async with async_session() as db:
        zone = MarketZone(
            name=name, city="Nairobi", country="Kenya",
            name_key=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
            city_key="nairobi", center_lat=CENTRE[0], center_lng=CENTRE[1],
            radius_km=3.0, is_active=True,
        )
        db.add(zone)
        await db.flush()
        for i in range(members):
            handle = f"mm_{uuid.uuid4().hex[:8]}"
            v = Vendor(
                business_name=f"Member {i} {name}", vendor_handle=handle,
                email=f"{handle}@example.com", password_hash="x",
                business_categories=["produce"], geo_lat=CENTRE[0], geo_lng=CENTRE[1],
            )
            db.add(v)
            await db.flush()
            db.add(MarketMember(vendor_id=v.id, zone_id=zone.id))
            if i < with_stock:
                db.add(StockItem(
                    vendor_id=v.id, name=f"stock {i}", category="produce",
                    quantity_in_stock=10, quantity_available=10, visible_to_network=True,
                ))
        await db.commit()
        return str(zone.id)


async def _view(client, headers, **params):
    r = await client.get("/api/map/viewport", headers=headers, params={
        "bbox": ZOOMED_BBOX, "zoom": 16, "kind": "places", **params})
    assert r.status_code == 200, r.text
    return r.json()


# ── the tier system on the wire ────────────────────────────────────────────────
async def test_every_place_pin_carries_its_tier(client, me):
    my_id = await _me_vendor_id()
    claimed_id = await _seed_place("Claimed corner shop", checked_days_ago=1,
                                   claimed_by=my_id)
    external_id = await _seed_place("Unclaimed corner shop", checked_days_ago=1)
    r = await _view(client, me, limit=50)
    rows = {p["id"]: p for p in r["points"]}
    assert rows[claimed_id]["network"] is True
    assert rows[external_id]["network"] is False
    # Every row states its tier — the client never has to guess.
    assert all(p["network"] == p["claimed"] for p in r["points"])


async def test_hide_shows_only_the_network_but_counts_what_it_hides(client, me):
    my_id = await _me_vendor_id()
    await _seed_place("Claimed corner shop", checked_days_ago=1, claimed_by=my_id)
    await _seed_place("Unclaimed corner shop", checked_days_ago=1)
    muted = await _view(client, me, external="muted", limit=50)
    assert muted["counts"]["external"] > 0
    hidden = await _view(client, me, external="hide", limit=50)
    assert hidden["points"], "the claimed row must survive a hide"
    assert all(p["network"] for p in hidden["points"])
    # The counts still tell the truth about what was hidden…
    assert hidden["counts"]["external"] == muted["counts"]["external"]
    assert hidden["counts"]["network"] == muted["counts"]["network"]
    assert hidden["query"]["external"] == "hide"


async def test_only_is_the_claim_sourcing_view(client, me):
    my_id = await _me_vendor_id()
    await _seed_place("Claimed corner shop", checked_days_ago=1, claimed_by=my_id)
    await _seed_place("Unclaimed corner shop", checked_days_ago=1)
    only = await _view(client, me, external="only", limit=50)
    assert only["points"]
    assert all(p["network"] is False for p in only["points"])
    assert only["counts"]["network"] >= 1          # counted, just not drawn


async def test_unknown_external_mode_is_refused(client, me):
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": ZOOMED_BBOX, "zoom": 16, "external": "loud"})
    assert r.status_code == 400


async def test_external_muted_ranks_network_places_first(client, me):
    """A network place and an external place: the member is the marketplace, so
    membership outranks proximity."""
    my_id = await _me_vendor_id()
    far_network = await _seed_place("Far network place", lat=CENTRE[0] + 0.005,
                                    lng=CENTRE[1], checked_days_ago=1)
    await _claim_place(far_network, my_id)
    near_external = await _seed_place("Near external shop", lat=CENTRE[0] + 0.001,
                                      lng=CENTRE[1], checked_days_ago=1)
    r = await _view(client, me, external="muted", limit=50)
    ids = [p["id"] for p in r["points"]]
    assert far_network in ids and near_external in ids
    # The network row — further out — is drawn before the nearer external row.
    assert ids.index(far_network) < ids.index(near_external)


async def test_clusters_carry_their_tier_split(client, me):
    my_id = await _me_vendor_id()
    await _seed_place("Claimed corner shop", checked_days_ago=1, claimed_by=my_id)
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": REGION_BBOX, "zoom": 8, "kind": "places",
                                 "external": "muted", "limit": 200})
    body = r.json()
    assert body["clusters"], "low zoom must cluster"
    assert all("network" in c and "network_count" in c for c in body["clusters"])
    # A cluster is a network cell only when at least one of its rows is claimed.
    assert all((c["network_count"] > 0) == c["network"] for c in body["clusters"])
    # Cluster counts still reconcile with the real count(*).
    assert sum(c["count"] for c in body["clusters"]) == body["counts"]["places"]
    # hide: only network cells survive, and they say so.
    r2 = await client.get("/api/map/viewport", headers=me,
                          params={"bbox": REGION_BBOX, "zoom": 8, "kind": "places",
                                  "external": "hide", "limit": 200})
    assert all(c["network"] is True for c in r2.json()["clusters"])


# ── staleness: off the map until revalidated ───────────────────────────────────
async def test_stale_places_leave_the_map_but_stay_counted(client, me):
    stale_id = await _seed_place(
        "Closed last year", checked_days_ago=settings.MAP_PLACE_STALE_DAYS + 10)
    r = await _view(client, me, external="muted", limit=50)
    assert stale_id not in [p["id"] for p in r["points"]]
    assert r["counts"]["stale"] >= 1
    # …and no external mode brings a stale row back: `only` is fresh-only.
    only = await _view(client, me, external="only", limit=50)
    assert stale_id not in [p["id"] for p in only["points"]]

    detail = await client.get(f"/api/map/places/{stale_id}", headers=me)
    body = detail.json()
    assert body["stale"] is True
    assert body["tier"] == "stale"
    assert body["checked_days_ago"] >= settings.MAP_PLACE_STALE_DAYS
    assert body["network"] is False


async def test_a_vendor_can_revalidate_a_stale_place_from_the_street(client, me):
    stale_id = await _seed_place(
        "Still standing", checked_days_ago=settings.MAP_PLACE_STALE_DAYS + 30)
    r = await client.post(f"/api/map/places/{stale_id}/report", headers=me,
                          json={"verdict": "confirmed"})
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == mv.EXTERNAL_TIER

    mv.viewport_cache.clear()
    back = await _view(client, me, external="muted", limit=50)
    assert stale_id in [p["id"] for p in back["points"]]


async def test_a_gone_report_archives_and_a_claimed_row_refuses(client, me):
    my_id = await _me_vendor_id()
    unclaimed = await _seed_place("Shuttered kiosk", checked_days_ago=2)
    claimed = await _seed_place("Someone's shop", checked_days_ago=2)
    await _claim_place(claimed, my_id)

    gone = await client.post(f"/api/map/places/{unclaimed}/report", headers=me,
                             json={"verdict": "gone"})
    assert gone.status_code == 200
    assert gone.json()["status"] == "archived"

    refused = await client.post(f"/api/map/places/{claimed}/report", headers=me,
                                json={"verdict": "gone"})
    assert refused.status_code == 409    # the owner manages their own listing

    missing = await client.post(f"/api/map/places/{uuid.uuid4()}/report", headers=me,
                                json={"verdict": "gone"})
    assert missing.status_code == 404

    bad = await client.post(f"/api/map/places/{unclaimed}/report", headers=me,
                            json={"verdict": "maybe"})
    assert bad.status_code == 422


async def test_the_sweep_reports_then_archives_the_directorys_dead_rows(client, me):
    fresh = await _seed_place("Fresh kiosk", checked_days_ago=1)
    stale = await _seed_place(
        "Quiet a year", checked_days_ago=settings.MAP_PLACE_ARCHIVE_DAYS + 40)
    mid = await _seed_place(
        "Quiet a season", checked_days_ago=settings.MAP_PLACE_STALE_DAYS + 5)

    report = (await client.get("/api/map/maintenance/sweep", headers=me)).json()
    assert report["stale_total"] >= 2
    assert report["archive_due"] >= 1
    assert report["stale_after_days"] == settings.MAP_PLACE_STALE_DAYS
    assert report["archive_after_days"] == settings.MAP_PLACE_ARCHIVE_DAYS
    assert len(report["samples"]) <= 20
    assert all("zone" in z and "stale" in z for z in report["by_zone"])

    dry = (await client.post("/api/map/maintenance/sweep", headers=me)).json()
    assert dry["archived"] == 0 and dry["due"] >= 1

    run = (await client.post("/api/map/maintenance/sweep", headers=me,
                             params={"archive": "true", "limit": 500})).json()
    assert run["archived"] >= 1
    assert run["remaining"] == 0     # everything past the archive window is retired

    for place_id, expect_gone in ((stale, True), (mid, False), (fresh, False)):
        async with async_session() as db:
            p = await db.get(PublicPlace, uuid.UUID(place_id))
            assert (p.status == "archived") is expect_gone, f"{p.name} → {p.status}"


# ── supplier-first ranking ─────────────────────────────────────────────────────
async def test_suppliers_rank_by_offers_before_distance(client, me):
    """A stocked supplier further away outranks an empty one next door."""
    await _seed_vendor_with_stock("Stocked Wholesaler", CENTRE[0] + 0.005, CENTRE[1],
                                  in_stock=4, verified=True)
    await _seed_vendor_with_stock("Empty Stall", CENTRE[0] + 0.001, CENTRE[1], in_stock=0)

    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": ZOOMED_BBOX, "zoom": 14, "kind": "vendors",
                                 "limit": 50})
    body = r.json()
    assert body["counts"]["vendors"] >= 2
    assert body["counts"]["vendors_with_offers"] >= 1
    stocked = next(p for p in body["points"] if p["name"] == "Stocked Wholesaler")
    empty = next(p for p in body["points"] if p["name"] == "Empty Stall")
    assert stocked["in_stock_lines"] == 4
    assert empty["in_stock_lines"] == 0
    assert stocked["network"] is True and empty["network"] is True
    assert body["points"].index(stocked) < body["points"].index(empty)


async def test_networked_markets_rank_first_and_are_flagged(client, me):
    working = await _seed_market("Gikomba Working", members=2, with_stock=1)
    quiet = await _seed_market("Toi Quiet", members=0)

    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": REGION_BBOX, "zoom": 13, "kind": "markets",
                                 "limit": 100})
    body = r.json()
    rows = {p["id"]: p for p in body["points"]}
    assert rows[working]["networked"] is True and rows[working]["network"] is True
    assert rows[working]["active_members"] == 1
    assert rows[quiet]["networked"] is False and rows[quiet]["members"] == 0
    assert body["counts"]["markets_networked"] >= 1
    assert body["points"].index(rows[working]) < body["points"].index(rows[quiet])

    detail = (await client.get(f"/api/map/markets/{working}", headers=me)).json()
    assert detail["networked"] is True
    assert detail["members"] == 2
    assert detail["active_members"] == 1


# ── the headline counters ──────────────────────────────────────────────────────
async def test_headline_counts_report_the_tier_split(client, me):
    r = await client.get("/api/map/counts", headers=me)
    assert r.status_code == 200
    body = r.json()
    for key in ("network_places", "external_places", "stale_places",
                "markets_networked", "vendors_with_offers", "claimed"):
        assert key in body, f"the counters must report {key}"
    assert body["places"] == (body["network_places"] + body["external_places"]
                              + body["stale_places"])
    assert body["claimed"] == body["network_places"]


async def test_the_same_view_in_two_tier_modes_is_two_cache_entries(client, me):
    await _seed_place("Cache shop", checked_days_ago=1)
    params = {"bbox": ZOOMED_BBOX, "zoom": 16, "kind": "places", "limit": 50}
    first = await client.get("/api/map/viewport", headers=me,
                             params={**params, "external": "muted"})
    assert first.headers["x-map-cache"] == "miss"
    repeat = await client.get("/api/map/viewport", headers=me,
                              params={**params, "external": "muted"})
    assert repeat.headers["x-map-cache"] == "hit"
    other = await client.get("/api/map/viewport", headers=me,
                             params={**params, "external": "hide"})
    assert other.headers["x-map-cache"] == "miss"   # a different question, a different answer


# ── the pure tier helper ───────────────────────────────────────────────────────
def test_place_tier_is_defined_once():
    now = datetime.utcnow()
    fresh = now - timedelta(days=1)
    old = now - timedelta(days=settings.MAP_PLACE_STALE_DAYS + 1)
    assert mv.place_tier(True, now) == mv.NETWORK_TIER        # claimed wins, however old
    assert mv.place_tier(False, fresh) == mv.EXTERNAL_TIER
    assert mv.place_tier(False, old) == mv.STALE_TIER
    assert mv.place_tier(False, None) == mv.STALE_TIER
    assert mv.fresh_cutoff(now) < now

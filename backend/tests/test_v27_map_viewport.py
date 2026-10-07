"""v2.7 — the map that does not download the directory.

The regression this file exists to prevent: an endpoint that answers a map
question by shipping every public place to the phone. Every test here asserts
on the *size and shape* of what crosses the wire, not only on its contents —
a viewport response that is correct but 7,640 rows long is still the bug.
"""

import math
import uuid
from datetime import datetime

import pytest

from app.config import settings
from app.database import async_session
from app.models.market_locks import MarketMember, MarketZone
from app.models.public_place import PublicPlace
from app.models.vendor import Vendor
from app.services import map_viewport as mv

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"

# Nairobi, roughly the CBD. The seeded directory lives inside a 0.6° box here.
CENTRE = (-1.2867, 36.8172)
KAMPALA = (0.3476, 32.5825)   # a second cluster, ~500 km away
ZOOMED_BBOX = "36.8100,-1.2920,36.8260,-1.2800"   # ~1.8 km × 1.3 km
REGION_BBOX = "32.0000,-2.0000,38.0000,1.0000"    # Kenya + Uganda
WIDE_BBOX = "-20.0000,-40.0000,60.0000,40.0000"   # half the planet


# ── fixtures ───────────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _clear_map_caches():
    """Viewport and counter caches are process-local; a stale entry would make a
    test pass against data it did not seed."""
    mv.viewport_cache.clear()
    mv.counts_cache.clear()
    yield
    mv.viewport_cache.clear()
    mv.counts_cache.clear()


@pytest.fixture
async def me(client):
    """A vendor with a location — distance on a pin needs an anchor."""
    suffix = uuid.uuid4().hex[:8]
    handle = f"maptest_{suffix}"
    r = await client.post("/api/auth/register", json={
        "business_name": f"Map Test {suffix[:4]}", "vendor_handle": handle,
        "email": f"{handle}@example.com", "password": PASSWORD,
        "business_categories": ["electronics"], "physical_location": "Nairobi",
    })
    assert r.status_code == 201, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    async with async_session() as db:
        vendor = (await db.execute(
            __import__("sqlalchemy").select(Vendor).where(Vendor.vendor_handle == handle)
        )).scalars().first()
        vendor.geo_lat, vendor.geo_lng = CENTRE
        await db.commit()
    return headers


async def _seed_places(count: int, centre=CENTRE, spread=0.30, categories=None, prefix="Seed"):
    """Insert `count` public places on a grid around `centre`."""
    categories = categories or ["shop:electronics", "shop:convenience", "amenity:pharmacy"]
    side = max(1, int(math.sqrt(count)) + 1)
    rows = []
    for i in range(count):
        lat = centre[0] + ((i // side) / side - 0.5) * spread
        lng = centre[1] + ((i % side) / side - 0.5) * spread
        rows.append(PublicPlace(
            source="openstreetmap", external_id=f"way/{uuid.uuid4().hex[:10]}",
            name=f"{prefix} place {i}", category=categories[i % len(categories)],
            detail=categories[i % len(categories)].split(":")[-1],
            phone=f"+2547{i:07d}"[:13], opening_hours="Mo-Sa 08:00-18:00",
            address=f"{i} Test Street", lat=round(lat, 6), lng=round(lng, 6),
            status="active", first_seen_at=datetime.utcnow(), last_checked_at=datetime.utcnow(),
        ))
    async with async_session() as db:
        db.add_all(rows)
        await db.commit()
    return len(rows)


async def _total_places(client, headers) -> int:
    """Places in the directory right now — tests share one database, so counts
    are asserted as deltas against this, never as absolutes."""
    mv.counts_cache.clear()
    total = (await client.get("/api/map/counts", headers=headers)).json()["places"]
    mv.counts_cache.clear()          # the baseline must not cache over the seed
    return total


async def _seed_market(name="Test Market", centre=CENTRE, members=0, zone_name=None):
    async with async_session() as db:
        zone = MarketZone(
            name=name, city="Nairobi", country="Kenya",
            name_key=name.lower().replace(" ", "-"), city_key="nairobi",
            center_lat=centre[0], center_lng=centre[1], radius_km=3.0, is_active=True,
        )
        db.add(zone)
        await db.flush()
        for i in range(members):
            handle = f"member{i}_{uuid.uuid4().hex[:6]}"
            v = Vendor(
                business_name=f"Member {handle}", vendor_handle=handle,
                email=f"{handle}@example.com", password_hash="x",
                business_categories=["produce"], geo_lat=centre[0], geo_lng=centre[1],
            )
            db.add(v)
            await db.flush()
            db.add(MarketMember(vendor_id=v.id, zone_id=zone.id))
        await db.commit()
        return str(zone.id)


# ── config & counters ──────────────────────────────────────────────────────────
async def test_config_serves_tiles_thresholds_and_limits(client, me):
    r = await client.get("/api/map/config", headers=me)
    assert r.status_code == 200
    body = r.json()
    assert body["tiles"]["url"].startswith("http")
    assert "OpenStreetMap" in body["tiles"]["attribution"]   # ODbL credit is served, not hardcoded
    assert body["thresholds"]["places"] >= 14                # pins only when zoomed in
    assert body["limits"]["points_per_layer"] <= 500
    assert body["default_center"] and len(body["default_center"]) == 2


async def test_headline_counts_are_totals_without_the_rows(client, me):
    before = await _total_places(client, me)
    await _seed_places(120, prefix="Count")
    r = await client.get("/api/map/counts", headers=me)
    assert r.status_code == 200
    body = r.json()
    assert body["places"] == before + 120
    assert isinstance(body["markets"], int)
    assert {f["value"] for f in body["facets"]} >= {"food", "electronics", "clothing"}
    # The counters must never carry the directory itself.
    assert not any(isinstance(v, list) and len(v) > 100 for v in body.values())


# ── clustering by zoom ─────────────────────────────────────────────────────────
async def test_low_zoom_returns_clusters_not_pins(client, me):
    await _seed_places(200, prefix="Region")
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": REGION_BBOX, "zoom": 6, "kind": "places"})
    assert r.status_code == 200
    body = r.json()
    assert body["points"] == []                    # no individual pins at z6
    assert len(body["clusters"]) > 0
    assert len(body["clusters"]) <= 400
    assert all("count" in c and "lat" in c for c in body["clusters"])
    # A cluster is an aggregate: it has a count, and it never leaks the rows.
    assert sum(c["count"] for c in body["clusters"]) <= body["counts"]["places"]


async def test_cluster_counts_match_what_is_really_in_the_box(client, me):
    """The label on a cluster ('1,240 places') is a real count(*), not a guess."""
    baseline = await client.get("/api/map/viewport", headers=me,
                                params={"bbox": REGION_BBOX, "zoom": 8, "kind": "places"})
    before = baseline.json()["counts"]["places"]
    mv.viewport_cache.clear()
    await _seed_places(90, centre=CENTRE, spread=0.20, prefix="Box")
    await _seed_places(30, centre=KAMPALA, spread=0.20, prefix="Kla")
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": REGION_BBOX, "zoom": 8, "kind": "places"})
    body = r.json()
    in_box = sum(c["count"] for c in body["clusters"])
    assert body["counts"]["places"] == before + 120  # the count is a real count(*)
    assert in_box == before + 120                    # every seeded place, none invented


async def test_high_zoom_returns_only_the_pins_inside_the_viewport(client, me):
    """320 places sit inside this screen. The phone gets 100 of them, and the
    response still reports that 320 are there."""
    await _seed_places(320, centre=CENTRE, spread=0.01, prefix="Zoomed")
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": ZOOMED_BBOX, "zoom": 17, "kind": "places",
                                 "limit": 100})
    body = r.json()
    assert body["clusters"] == []                   # zoomed in: real pins
    assert len(body["points"]) == 100               # the cap, not the directory
    assert body["counts"]["places"] >= 320          # …and the truth is reported
    assert body["truncated"] is True
    for p in body["points"]:
        assert -1.2920 <= p["lat"] <= -1.2800
        assert 36.8100 <= p["lng"] <= 36.8260
        assert "distance_km" in p                   # distance is computed server-side


async def test_the_pin_cap_holds_however_dense_the_area_is(client, me):
    """1,000 places inside one screen → at most `points_per_layer` pins, and the
    response says it was truncated rather than silently lying."""
    await _seed_places(400, centre=CENTRE, spread=0.01, prefix="Dense")
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": ZOOMED_BBOX, "zoom": 18, "kind": "places",
                                 "limit": 50})
    body = r.json()
    assert len(body["points"]) <= 50
    assert body["truncated"] is True
    assert body["counts"]["places"] > 50            # the truth is still reported


async def test_kind_filter_loads_one_dataset_at_a_time(client, me):
    await _seed_places(60, prefix="Kind")
    zone_id = await _seed_market(members=0)
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": REGION_BBOX, "zoom": 13, "kind": "markets"})
    body = r.json()
    assert body["kinds"] == ["markets"]
    assert all(p["kind"] == "markets" for p in body["points"])
    assert body["counts"]["places"] == 0            # the directory was not queried
    assert zone_id in [p["id"] for p in body["points"]]


async def test_quick_filter_narrows_places(client, me):
    await _seed_places(60, prefix="Any",
                       categories=["shop:electronics", "shop:convenience", "amenity:pharmacy"])
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": REGION_BBOX, "zoom": 16, "kind": "places",
                                 "filter": "electronics", "limit": 200})
    body = r.json()
    assert body["points"], "the filter should still find the electronics shops"
    assert all((p["category"] or "").startswith("shop:electronics") for p in body["points"])
    bad = await client.get("/api/map/viewport", headers=me,
                           params={"bbox": REGION_BBOX, "zoom": 16, "filter": "unicorns"})
    assert bad.status_code == 400


async def test_search_can_leave_the_viewport(client, me):
    await _seed_places(40, centre=CENTRE, spread=0.2, prefix="NairobiShop")
    await _seed_places(10, centre=KAMPALA, spread=0.2, prefix="KampalaShop")
    # A tiny viewport in Nairobi: the Kampala rows are outside it.
    r = await client.get("/api/map/viewport", headers=me,
                         params={"bbox": ZOOMED_BBOX, "zoom": 16, "q": "KampalaShop"})
    assert r.json()["counts"]["places"] == 0
    # …so search offers the whole network, explicitly.
    r = await client.get("/api/map/viewport", headers=me,
                         params={"scope": "network", "zoom": 16, "q": "KampalaShop",
                                 "kind": "places"})
    body = r.json()
    assert body["bbox"] is None
    assert body["counts"]["places"] == 10
    assert all("KampalaShop" in p["name"] for p in body["points"])
    # A whole-network request with no search term is the original bug: refused.
    refused = await client.get("/api/map/viewport", headers=me, params={"scope": "network"})
    assert refused.status_code == 400


# ── input validation ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("bbox", [WIDE_BBOX, "nonsense", "1,2,3", "", "200,-1,210,1"])
async def test_unusable_viewports_are_refused(client, me, bbox):
    r = await client.get("/api/map/viewport", headers=me, params={"bbox": bbox, "zoom": 6})
    assert r.status_code == 400


async def test_viewport_needs_a_bbox_or_a_search(client, me):
    r = await client.get("/api/map/viewport", headers=me, params={"zoom": 12})
    assert r.status_code == 400


# ── caching ────────────────────────────────────────────────────────────────────
async def test_repeat_viewport_is_cached_and_revalidated(client, me):
    await _seed_places(30, prefix="Cache")
    params = {"bbox": REGION_BBOX, "zoom": 9, "kind": "places", "limit": 120}
    first = await client.get("/api/map/viewport", headers=me, params=params)
    assert first.headers["x-map-cache"] == "miss"
    assert first.headers["cache-control"].startswith("private")
    etag = first.headers["etag"]

    second = await client.get("/api/map/viewport", headers=me, params=params)
    assert second.headers["x-map-cache"] == "hit"

    revalidated = await client.get(
        "/api/map/viewport", headers={**me, "If-None-Match": etag}, params=params)
    assert revalidated.status_code == 304          # the phone skips the body
    assert revalidated.content == b""


# ── lazy details ───────────────────────────────────────────────────────────────
async def test_place_detail_is_fetched_on_tap_and_answers_for_itself(client, me):
    await _seed_places(1, centre=CENTRE, spread=0.0, prefix="Detail")
    found = await client.get("/api/map/viewport", headers=me,
                             params={"scope": "network", "q": "Detail", "zoom": 16,
                                     "kind": "places"})
    place_id = found.json()["points"][0]["id"]
    detail = await client.get(f"/api/map/places/{place_id}", headers=me)
    assert detail.status_code == 200
    body = detail.json()
    assert body["name"].startswith("Detail")
    assert body["phone"] and body["opening_hours"]
    assert body["last_checked_at"]                  # freshness is stated, never hidden
    assert body["claimed"] is False
    assert "OpenStreetMap" in body["attribution"]   # ODbL credit travels with the row

    missing = await client.get(f"/api/map/places/{uuid.uuid4()}", headers=me)
    assert missing.status_code == 404


async def test_vendor_detail_counts_stock_without_listing_it(client, me):
    r = await client.get("/api/vendors/me", headers=me)
    vendor_id = r.json()["id"]
    d = await client.get(f"/api/map/vendors/{vendor_id}", headers=me)
    assert d.status_code == 200
    body = d.json()
    assert body["is_me"] is True
    assert body["stock"]["lines"] == 0
    assert body["distance_km"] == 0


async def test_market_detail_separates_mapped_places_from_members(client, me):
    zone_id = await _seed_market(name=f"Mapped {uuid.uuid4().hex[:4]}", members=2)
    d = await client.get(f"/api/map/markets/{zone_id}", headers=me)
    assert d.status_code == 200
    body = d.json()
    assert body["members"] == 2
    assert body["places"] == 0                       # mapped ≠ registered, on purpose
    assert body["distance_km"] is not None


# ── the legacy whole-directory endpoint is gone ────────────────────────────────
async def test_the_legacy_whole_directory_endpoint_is_retired(client, me):
    """`GET /api/surface/map` selected every place and shipped them to the
    phone. It is deleted, not capped: leaving it in place means someone calls it
    again in six months. The map uses /api/map/viewport."""
    await _seed_places(20, prefix="Legacy")
    gone = await client.get("/api/surface/map", headers=me)
    assert gone.status_code == 404
    # …and what replaced it still answers for the same area.
    here = await client.get("/api/map/viewport", headers=me,
                            params={"bbox": REGION_BBOX, "zoom": 6, "kind": "places"})
    assert here.status_code == 200
    assert here.json()["counts"]["places"] >= 20


# ── tile backend ───────────────────────────────────────────────────────────────
async def test_tile_config_serves_a_usable_backend_and_its_credit(client, me):
    body = (await client.get("/api/map/config", headers=me)).json()["tiles"]
    assert body["url"].startswith("http")
    assert "OpenStreetMap" in body["attribution"]        # the ODbL credit travels with it
    assert body["provider"] in {p["value"] for p in (await client.get("/api/map/config", headers=me)).json()["tile_providers"]}


def test_auto_picks_a_keyed_provider_only_when_the_key_exists(monkeypatch):
    from app.services import tile_providers as tp

    assert tp.resolve("auto", api_key="").key == "osm"
    assert tp.resolve("auto", api_key="").dev_only is True
    chosen = tp.resolve("auto", api_key="test-key")
    assert chosen.key == "maptiler"
    assert chosen.dev_only is False


def test_a_keyed_provider_without_a_key_falls_back_instead_of_401ing():
    from app.services import tile_providers as tp

    for name in ("maptiler", "stadia", "thunderforest"):
        cfg = tp.tile_config(name, api_key="")
        assert cfg["key_missing"] is True
        assert cfg["dev_only"] is True                   # fell back to the dev tiles
        assert cfg["warning"]
        assert cfg["url"].startswith("http")


def test_the_key_never_reaches_the_client_as_a_template_placeholder():
    from app.services import tile_providers as tp

    cfg = tp.tile_config("maptiler", api_key="secret-key")
    assert "{key}" not in cfg["url"]
    assert "secret-key" in cfg["url"]                    # it is a tile key, not a secret
    assert tp.PROVIDERS["stadia"].resolved_url("k").endswith(".png?api_key=k")
    assert "{r}" not in tp.PROVIDERS["stadia"].resolved_url("k")   # no retina tiles


def test_an_unknown_provider_label_degrades_to_a_working_map():
    from app.services import tile_providers as tp

    assert tp.resolve("nonsense").key == "osm"
    custom = tp.resolve("custom", url_override="https://tiles.example.com/{z}/{x}/{y}.png",
                        attribution_override="© Example")
    assert custom.url == "https://tiles.example.com/{z}/{x}/{y}.png"
    assert custom.attribution == "© Example"


# ── indexes ──────────────────────────────────────────────────────────────────
async def test_bbox_indexes_exist_after_the_migration():
    """A viewport query is two range scans, not a sequential scan. The planner
    can only do that with an index on (lat, lng)."""
    from sqlalchemy import create_engine, text

    engine = create_engine(settings.database_url_sync)
    try:
        with engine.connect() as conn:
            names = {row[0] for row in conn.execute(text(
                "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"))}
    finally:
        engine.dispose()
    # Created by `alembic upgrade head` (0011). Under AUTO_CREATE_TABLES the
    # suite has the tables but not the migrations, so assert the intent here and
    # let ops run the migration in every deployed environment.
    wanted = {"ix_public_places_lat_lng", "ix_vendors_geo_lat_lng", "ix_market_zones_center"}
    missing = wanted - names
    assert not missing, f"run `alembic upgrade head` — missing: {sorted(missing)}"


# ── pure helpers ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize("zoom,tier", [(4, "region"), (9, "city"), (13, "market"), (17, "shop")])
def test_zoom_tiers(zoom, tier):
    assert mv.tier_for(zoom) == tier


def test_cell_size_shrinks_as_you_zoom_in():
    near = mv.cell_size(15, 0.0)
    far = mv.cell_size(6, 0.0)
    assert near[0] < far[0]
    assert near[1] >= near[0]                       # longitude cells widen off the equator


def test_parse_bbox_normalises_and_rejects():
    box = mv.parse_bbox("36.7,-1.4,36.9,-1.2")
    assert (box.south, box.north) == (-1.4, -1.2)
    assert not box.wrapped
    with pytest.raises(mv.BBoxError):
        mv.parse_bbox("36.7,-1.4,36.9")             # three numbers
    with pytest.raises(mv.BBoxError):
        mv.parse_bbox("abc,def,ghi,jkl")            # not numbers


def test_grid_cluster_snaps_to_a_stable_grid():
    points = [{"lat": -1.28 + i * 0.001, "lng": 36.81 + i * 0.001, "name": f"p{i}"}
              for i in range(9)]
    clusters = mv.grid_cluster(points, (0.01, 0.01), 100)
    assert len(clusters) == 1
    assert clusters[0]["count"] == 9
    assert len(clusters[0]["sample"]) == 3
    fine = mv.grid_cluster(points, (0.0005, 0.0005), 100)
    assert len(fine) > 1                            # zooming in splits the cluster
    assert sum(c["count"] for c in fine) == 9       # …without losing anyone

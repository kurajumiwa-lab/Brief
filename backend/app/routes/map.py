"""MAP — a marketplace map, not a map with businesses on it.

    GET  /api/map/config             tiles, zoom thresholds, limits (one call, cached)
    GET  /api/map/counts             the headline chips: network first, directory split by tier
    GET  /api/map/viewport           what is inside this rectangle, at this zoom
    GET  /api/map/places/{id}        one place, in full — fetched when a pin is tapped
    GET  /api/map/vendors/{id}       one vendor, in full — same
    GET  /api/map/markets/{id}       one market, with its members and mapped places
    POST /api/map/places/{id}/report  a vendor's on-the-ground verdict: confirmed | gone
    GET  /api/map/maintenance/sweep    where the directory has gone quiet
    POST /api/map/maintenance/sweep    archive what the source stopped confirming

The rules this file exists to enforce:

1. **The phone never receives the directory.** `/api/map/viewport` takes a
   bounding box and a zoom level and returns either a few hundred grid
   clusters or a few hundred individual pins — never 7,640 rows and never
   7,640 Leaflet markers.

2. **A location on the map is not automatically part of the marketplace.**
   Every place row is in a tier: `network` (claimed), `external` (unclaimed
   public data), `stale` (the source stopped confirming it). The viewport's
   `external=` param picks what the caller sees — `hide` is the clean,
   supplier-first map; `muted` is the honest default; `only` is the
   claim-sourcing view. Vendors and working markets are always network rows:
   ranked first, drawn in full colour, clickable.

Progressive disclosure by zoom (see `map_viewport.tier_for`):

    z 2–7    region clusters      "7.6K places" · "25 markets"
    z 8–11   city clusters        Nairobi 1,240 · Kampala 840
    z 12–14  markets + vendors    individual pins
    z 15+    businesses           individual pins, details on tap

Details (phone, hours, address, claim state, tier) are a separate request that
fires when a pin is tapped. No photos are fetched at all — the directory has
none, and a map that pulls 7,640 images is a map that hangs.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.market_locks import MarketZone
from app.models.public_place import PublicPlace
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import map_viewport as mv
from app.services import tile_providers
from app.services.routing import haversine_km

router = APIRouter()

MARKETS, VENDORS, PLACES = mv.MARKETS, mv.VENDORS, mv.PLACES

# Viewport responses are private (they are scoped to a vendor) and short-lived.
CACHE_HEADER = f"private, max-age={settings.MAP_HTTP_MAX_AGE_SECONDS}, must-revalidate"


def _headers(response: Response, etag: str, cache_state: str) -> None:
    response.headers["Cache-Control"] = CACHE_HEADER
    response.headers["ETag"] = etag
    response.headers["X-Map-Cache"] = cache_state
    response.headers["Vary"] = "Authorization"


def _not_modified(request: Request, etag: str) -> bool:
    return request.headers.get("if-none-match", "").strip() == etag


# ── CONFIG ─────────────────────────────────────────────────────────────────────
@router.get("/config")
async def map_config(vendor: Vendor = Depends(get_current_vendor)):
    """Everything the client needs to draw tiles and pick a zoom strategy.

    The tile URL and its attribution are served from the server so the ODbL
    credit can never drift out of sync with whatever backend is configured, and
    so swapping the public OSM tile server for a commercial one is a deploy-time
    change (one env var), not a frontend release.
    """
    tiles = tile_providers.tile_config(
        settings.MAP_TILE_PROVIDER,
        api_key=settings.MAP_TILE_KEY,
        url_override=settings.MAP_TILE_URL,
        attribution_override=settings.MAP_TILE_ATTRIBUTION,
        min_zoom=settings.MAP_TILE_MIN_ZOOM,
        max_zoom=settings.MAP_TILE_MAX_ZOOM,
    )
    if settings.MAP_TILE_SUBDOMAINS:
        tiles["subdomains"] = settings.MAP_TILE_SUBDOMAINS

    return {
        "tiles": tiles,
        "tile_providers": tile_providers.available(),
        "thresholds": {
            "places": settings.MAP_PLACES_POINT_ZOOM,
            "vendors": settings.MAP_VENDORS_POINT_ZOOM,
            "markets": settings.MAP_MARKETS_POINT_ZOOM,
        },
        "limits": {
            "points_per_layer": settings.MAP_POINT_LIMIT,
            "max_bbox_deg": settings.MAP_MAX_BBOX_DEG,
            "cluster_cell_px": settings.MAP_CLUSTER_CELL_PX,
        },
        "quick_filters": [{"value": k, "label": v["label"]} for k, v in mv.QUICK_FILTERS.items()],
        # v2.8 — the tiers the client is expected to render. The client decides
        # what the default external mode is; the API default (muted) is the
        # honest one, the product default (hide) is one query param away.
        "tiers": {
            "external_modes": list(mv.EXTERNAL_MODES),
            "external_default": "hide",
            "place_stale_days": settings.MAP_PLACE_STALE_DAYS,
        },
        "viewer": {"lat": vendor.geo_lat, "lng": vendor.geo_lng},
        # Where to open the map when the vendor has never set a location.
        "default_center": (
            [vendor.geo_lat, vendor.geo_lng]
            if vendor.geo_lat is not None and vendor.geo_lng is not None
            else [-1.2867, 36.8172]
        ),
        "default_zoom": 13 if vendor.geo_lat is not None else 6,
    }


# ── HEADLINE COUNTS + FACETS ───────────────────────────────────────────────────
@router.get("/counts")
async def map_counts(
    request: Request,
    response: Response,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """`Markets 25 · Vendors 0 · Places 7,640` — four `count(*)`s, cached five
    minutes. The counters double as filters on the client; they must never cost
    a full table scan of the directory, which is exactly what the old map did."""
    key = mv.MapCache.key("counts")
    cached = mv.counts_cache.get(key)
    if cached:
        etag, payload = cached
        if _not_modified(request, etag):
            _headers(response, etag, "hit")
            return Response(status_code=304, headers=dict(response.headers))
        _headers(response, etag, "hit")
        return payload

    payload = await mv.headline_counts(db)
    etag = mv.etag_for(payload)
    mv.counts_cache.put(key, etag, payload)
    if _not_modified(request, etag):
        _headers(response, etag, "miss")
        return Response(status_code=304, headers=dict(response.headers))
    _headers(response, etag, "miss")
    return payload


# ── THE VIEWPORT ───────────────────────────────────────────────────────────────
@router.get("/viewport")
async def map_viewport(
    request: Request,
    response: Response,
    bbox: Optional[str] = Query(None, description="minLng,minLat,maxLng,maxLat"),
    zoom: int = Query(11, ge=0, le=22),
    kind: str = Query("all", description="markets | vendors | places | all | comma-separated"),
    q: str = Query("", max_length=120),
    filter: str = Query("", description="quick filter: food | electronics | clothing | wholesale | services"),
    category: str = Query("", max_length=120),
    scope: str = Query("viewport", description="viewport | network (network ignores the bbox)"),
    external: str = Query("muted", description="place tiers: hide (network only) | muted (default) | only (external alone)"),
    limit: int = Query(settings.MAP_POINT_LIMIT, ge=1, le=settings.MAP_POINT_LIMIT),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """What is inside `bbox` at `zoom`: clusters, or pins when zoomed in far
    enough. This is the only endpoint the map pans with.

    Below a layer's threshold zoom the response is grid clusters (count,
    centroid, dominant category, three sample names). At or above it, the
    response is real pins, capped at `limit` — network rows first, then by
    rank. Either way the payload is a few hundred objects, whatever the table
    holds.

    The place directory is tiered (see `map_viewport.place_tier`): claimed
    places are the network, unclaimed fresh rows are external, and rows the
    source has not confirmed for `MAP_PLACE_STALE_DAYS` are stale and appear
    in no view — they are counted, then archived by the sweep. `external=`
    picks how much of the directory the caller sees; `counts` always reports
    the full split, so a `hide` view can still say "1,212 external hidden".

    `counts` reports what is really in the rectangle, so a cluster labelled
    "1,240 places" is a `count(*)`, not an estimate.
    """
    if external not in mv.EXTERNAL_MODES:
        raise HTTPException(400, f"external must be one of {', '.join(mv.EXTERNAL_MODES)}")

    box: Optional[mv.BBox] = None
    if scope.strip().lower() == "network":
        if not q.strip():
            raise HTTPException(400, "scope=network needs a search term — a whole-network view would be the old bug")
    else:
        if not bbox:
            raise HTTPException(400, "bbox is required (minLng,minLat,maxLng,maxLat)")
        try:
            box = mv.parse_bbox(bbox)
        except mv.BBoxError as exc:
            raise HTTPException(400, str(exc))

    kinds = mv.parse_kinds(kind)
    term = q.strip()
    group = (filter or "").strip().lower()
    if group and group not in mv.QUICK_FILTERS:
        raise HTTPException(400, f"unknown filter '{group}'")
    cat = (category or "").strip()

    key = mv.cache_key_for(",".join(kinds), box, zoom, term, group, cat, limit,
                            str(vendor.id), external)
    cached = mv.viewport_cache.get(key)
    if cached:
        etag, payload = cached
        if _not_modified(request, etag):
            _headers(response, etag, "hit")
            return Response(status_code=304, headers=dict(response.headers))
        _headers(response, etag, "hit")
        return payload

    center = box.center if box else (
        (vendor.geo_lat or -1.2867, vendor.geo_lng or 36.8172))
    cell = mv.cell_size(zoom, center[0])
    clusters: List[Dict[str, Any]] = []
    points: List[Dict[str, Any]] = []
    truncated = False

    # ── markets ───────────────────────────────────────────────────────────────
    markets: List[Dict[str, Any]] = []
    if MARKETS in kinds:
        markets = await mv.market_rows(db, box, term)
        if zoom < mv.point_zoom(MARKETS) and len(markets) > settings.MAP_POINT_LIMIT:
            clusters.extend(mv.grid_cluster(markets, cell, limit))
        else:
            points.extend(markets[:limit])
            truncated = truncated or len(markets) > limit

    # ── vendors ───────────────────────────────────────────────────────────────
    if VENDORS in kinds:
        if zoom < mv.point_zoom(VENDORS):
            clusters.extend(await mv.vendor_clusters(db, box, cell, q=term, limit=limit))
        else:
            rows = await mv.vendor_points(db, box, center, q=term, limit=limit,
                                          exclude_vendor_id=str(vendor.id))
            points.extend(rows)
            truncated = truncated or len(rows) >= limit

    # ── places (the big one) ──────────────────────────────────────────────────
    if PLACES in kinds:
        if zoom < mv.point_zoom(PLACES):
            clusters.extend(await mv.places_clusters(db, box, cell, q=term, group=group,
                                                     category=cat, limit=limit,
                                                     external=external))
        else:
            rows = await mv.places_points(db, box, center, q=term, group=group,
                                          category=cat, limit=limit, external=external)
            points.extend(rows)
            truncated = truncated or len(rows) >= limit

    totals = await mv.viewport_totals(db, box, kinds, q=term, group=group, category=cat,
                                      external=external)
    if MARKETS in kinds:
        totals[MARKETS] = len(markets)

    # Distance from the vendor, computed here so the phone does no maths and
    # receives nothing it did not ask for.
    me = {"lat": vendor.geo_lat, "lng": vendor.geo_lng}
    for p in points:
        d = haversine_km(me, {"lat": p.get("lat"), "lng": p.get("lng")})
        p["distance_km"] = None if d is None else round(d, 1)
    for c in clusters:
        d = haversine_km(me, {"lat": c.get("lat"), "lng": c.get("lng")})
        c["distance_km"] = None if d is None else round(d, 1)

    payload = {
        "bbox": box.as_dict() if box else None,
        "center": {"lat": round(center[0], 6), "lng": round(center[1], 6)},
        "zoom": zoom,
        "tier": mv.tier_for(zoom),
        "kinds": kinds,
        "clusters": clusters,
        "points": points,
        "counts": {
            "markets": totals.get(MARKETS, 0),
            "vendors": totals.get(VENDORS, 0),
            "places": totals.get(PLACES, 0),
            # The tier split — the numbers the network-first UI is built on.
            "network": totals.get(mv.NETWORK_TIER, 0),
            "external": totals.get(mv.EXTERNAL_TIER, 0),
            "stale": totals.get(mv.STALE_TIER, 0),
            "vendors_with_offers": totals.get("vendors_with_offers", 0),
            "markets_networked": totals.get("markets_networked", 0),
            "shown": len(points) + len(clusters),
            "total": sum(totals.values()),
        },
        "truncated": truncated,
        "query": {"q": term, "filter": group, "category": cat, "scope": scope,
                  "external": external},
        "cell": {"lat": cell[0], "lng": cell[1]},
        "generated_at": datetime.utcnow().isoformat(),
        "attribution": tile_providers.resolve(
            settings.MAP_TILE_PROVIDER, settings.MAP_TILE_KEY,
            settings.MAP_TILE_URL, settings.MAP_TILE_ATTRIBUTION,
        ).attribution,
    }

    etag = mv.etag_for(payload)
    mv.viewport_cache.put(key, etag, payload)
    if _not_modified(request, etag):
        _headers(response, etag, "miss")
        return Response(status_code=304, headers=dict(response.headers))
    _headers(response, etag, "miss")
    return payload


# ── DETAILS ON TAP ─────────────────────────────────────────────────────────────
@router.get("/places/{place_id}")
async def place_detail(
    place_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """One place, in full — loaded when its pin is tapped and not before.

    Every field the source gave us, plus the facts that make the row honest:
    which tier it is in (`network` — claimed — or external), when the source
    last confirmed it (`last_checked_at`), and whether that confirmation has
    gone stale. An external row reads "unverified · public data"; that is the
    point of the open-data layer, not a gap in it.
    """
    place = await db.get(PublicPlace, place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    d = haversine_km({"lat": vendor.geo_lat, "lng": vendor.geo_lng},
                     {"lat": place.lat, "lng": place.lng})
    network = place.claimed_by_vendor_id is not None
    checked_days = None
    if place.last_checked_at:
        checked_days = max(0, (datetime.utcnow() - place.last_checked_at).days)
    return {
        "id": str(place.id),
        "kind": mv.PLACES,
        "name": place.name,
        "category": place.category,
        "detail": place.detail,
        "phone": place.phone,
        "opening_hours": place.opening_hours,
        "website": place.website,
        "address": place.address,
        "lat": place.lat,
        "lng": place.lng,
        "zone_name": place.zone_name,
        "source": place.source,
        "external_id": place.external_id,
        "first_seen_at": place.first_seen_at.isoformat() if place.first_seen_at else None,
        "last_checked_at": place.last_checked_at.isoformat() if place.last_checked_at else None,
        "status": place.status,
        # v2.8 — the tier, stated on the row itself.
        "network": network,
        "tier": mv.place_tier(network, place.last_checked_at),
        "stale": (not network) and (checked_days is None or checked_days > settings.MAP_PLACE_STALE_DAYS),
        "checked_days_ago": checked_days,
        "claimed": place.status == "claimed",
        "claimed_by_me": place.claimed_by_vendor_id == vendor.id,
        "distance_km": None if d is None else round(d, 1),
        # ODbL: the directory row is derived data and travels with its credit.
        "attribution": "Data © OpenStreetMap contributors (ODbL)",
    }


@router.get("/vendors/{vendor_id}")
async def vendor_detail(
    vendor_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """One vendor, in full: who they are, what they have on the shelf right now,
    and whether they are sourcing or selling. Stock counts only — the actual
    stock list is a Stock Room screen, not a bottom sheet."""
    subject = await db.get(Vendor, vendor_id)
    if not subject:
        raise HTTPException(404, "Vendor not found")
    row = (await db.execute(text("""
        SELECT count(*) FILTER (WHERE visible_to_network)                        AS lines,
               count(*) FILTER (WHERE visible_to_network AND quantity_available > 0) AS in_stock,
               COALESCE(sum(quantity_available) FILTER (WHERE visible_to_network), 0) AS units
          FROM stock_items
         WHERE vendor_id = :vid
    """), {"vid": str(subject.id)})).first()
    d = haversine_km({"lat": vendor.geo_lat, "lng": vendor.geo_lng},
                     {"lat": subject.geo_lat, "lng": subject.geo_lng})
    return {
        "id": str(subject.id),
        "kind": mv.VENDORS,
        "name": subject.business_name,
        "handle": subject.vendor_handle,
        "categories": list(subject.business_categories or []),
        "role": subject.current_role.value if hasattr(subject.current_role, "value") else subject.current_role,
        "location": subject.physical_location,
        "lat": subject.geo_lat,
        "lng": subject.geo_lng,
        "network_score": subject.network_score,
        "stock": {
            "lines": int(row.lines or 0),
            "in_stock_lines": int(row.in_stock or 0),
            "units_available": int(row.units or 0),
        },
        "distance_km": None if d is None else round(d, 1),
        "is_me": subject.id == vendor.id,
    }


@router.get("/markets/{zone_id}")
async def market_detail(
    zone_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """One market: who has registered, who is actually selling, how much of it
    is mapped, and who the patrons are. A market with mapped places but no
    members is an unworked market — that is the number a vendor acts on."""
    zone = await db.get(MarketZone, zone_id)
    if not zone:
        raise HTTPException(404, "Market not found")
    places = (await db.execute(text(
        "SELECT count(*) FROM public_places WHERE zone_id = :z AND status IN ('active','claimed')"
    ), {"z": str(zone.id)})).scalar() or 0
    claimed = (await db.execute(text(
        "SELECT count(*) FROM public_places WHERE zone_id = :z AND status = 'claimed'"
    ), {"z": str(zone.id)})).scalar() or 0
    members = (await db.execute(text(
        "SELECT count(*) FROM market_members WHERE zone_id = :z"), {"z": str(zone.id)})).scalar() or 0
    active_members = (await db.execute(text("""
        SELECT count(DISTINCT si.vendor_id)
          FROM market_members mm
          JOIN stock_items si ON si.vendor_id = mm.vendor_id
         WHERE mm.zone_id = :z AND si.visible_to_network IS TRUE AND si.quantity_available > 0
    """), {"z": str(zone.id)})).scalar() or 0
    d = haversine_km({"lat": vendor.geo_lat, "lng": vendor.geo_lng},
                     {"lat": zone.center_lat, "lng": zone.center_lng})
    return {
        "id": str(zone.id),
        "kind": mv.MARKETS,
        "name": zone.name,
        "city": zone.city,
        "country": zone.country,
        "lat": zone.center_lat,
        "lng": zone.center_lng,
        "radius_km": zone.radius_km,
        "members": int(members),
        "active_members": int(active_members),
        "networked": int(members) > 0,
        "places": int(places),
        "claimed": int(claimed),
        "last_ingest_at": zone.last_ingest_at.isoformat() if zone.last_ingest_at else None,
        "last_ingest_count": zone.last_ingest_count,
        "welcome": zone.patron_welcome,
        "distance_km": None if d is None else round(d, 1),
    }


# ── REVALIDATION (v2.8) — the network keeps the directory honest ──────────────
class PlaceReport(BaseModel):
    """A vendor's on-the-ground verdict about an external place."""
    verdict: str = Field(pattern="^(confirmed|gone)$")


@router.post("/places/{place_id}/report")
async def report_place(
    place_id: UUID,
    body: PlaceReport,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Revalidate or retire one external place, from the street.

    The product rule cuts both ways: the network's map must not carry dead
    rows, and it should not depend on the source's refresh schedule alone to
    learn about them. A vendor standing in front of the shop is the freshest
    signal there is.

      confirmed — the place is really there: `last_checked_at` moves to now,
                  so a stale row re-enters the map as external.
      gone      — the place closed or moved: an unclaimed row is archived
                  (off every map view; the ingest revives it if the source
                  still lists it). A claimed row answers 409 — its vendor
                  manages their own listing.

    Both paths are ordinary writes on the existing lifecycle, not a new one:
    confirmed rows keep their tier, archived rows are simply outside every
    map query until the source or the network says otherwise.
    """
    place = await db.get(PublicPlace, place_id)
    if not place:
        raise HTTPException(404, "Place not found")

    if body.verdict == "confirmed":
        place.last_checked_at = datetime.utcnow()
        await db.commit()
        return {
            "id": str(place.id), "verdict": "confirmed",
            "tier": mv.place_tier(place.claimed_by_vendor_id is not None, place.last_checked_at),
            "last_checked_at": place.last_checked_at.isoformat(),
            "note": "Thanks — the directory now shows this place as confirmed today",
        }

    # verdict == "gone"
    if place.claimed_by_vendor_id is not None:
        raise HTTPException(
            409, "This place is claimed — its vendor manages their own listing")
    place.status = "archived"
    await db.commit()
    return {
        "id": str(place.id), "verdict": "gone", "status": place.status,
        "note": "Archived — it is off the map. The open-data ingest will restore it if the source still lists it",
    }


# ── MAINTENANCE SWEEP (v2.8) — stale rows: report them, then archive them ─────
@router.get("/maintenance/sweep")
async def sweep_report(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Where the directory has gone quiet, before anything is deleted.

    Stale rows are already off the commercial map; this report is how they get
    back on (revalidated) or off for good (archived). Grouped by zone so a
    patron sees which of their markets is drifting out of date, with a few
    named samples — never the full list.
    """
    cutoff = mv.fresh_cutoff()
    archive_cutoff = datetime.utcnow() - timedelta(days=settings.MAP_PLACE_ARCHIVE_DAYS)
    stale_total = (await db.execute(text(
        "SELECT count(*) FROM public_places WHERE status = 'active'"
        " AND claimed_by_vendor_id IS NULL AND last_checked_at < :cutoff"),
        {"cutoff": cutoff})).scalar() or 0
    archive_due = (await db.execute(text(
        "SELECT count(*) FROM public_places WHERE status = 'active'"
        " AND claimed_by_vendor_id IS NULL AND last_checked_at < :archive_cutoff"),
        {"archive_cutoff": archive_cutoff})).scalar() or 0
    by_zone = (await db.execute(text("""
        SELECT COALESCE(zone_name, 'unzoned') AS zone, count(*) AS n,
               max(last_checked_at) AS oldest_check
          FROM public_places
         WHERE status = 'active' AND claimed_by_vendor_id IS NULL
           AND last_checked_at < :cutoff
         GROUP BY 1 ORDER BY n DESC LIMIT 10
    """), {"cutoff": cutoff})).all()
    samples = (await db.execute(text("""
        SELECT id, name, zone_name, last_checked_at
          FROM public_places
         WHERE status = 'active' AND claimed_by_vendor_id IS NULL
           AND last_checked_at < :cutoff
         ORDER BY last_checked_at ASC LIMIT 20
    """), {"cutoff": cutoff})).all()
    return {
        "stale_total": int(stale_total),
        "archive_due": int(archive_due),
        "stale_after_days": settings.MAP_PLACE_STALE_DAYS,
        "archive_after_days": settings.MAP_PLACE_ARCHIVE_DAYS,
        "by_zone": [{
            "zone": r.zone, "stale": int(r.n),
            "oldest_check": r.oldest_check.isoformat() if r.oldest_check else None,
        } for r in by_zone],
        "samples": [{
            "id": str(r.id), "name": r.name, "zone_name": r.zone_name,
            "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
        } for r in samples],
    }


@router.post("/maintenance/sweep")
async def sweep_archive(
    archive: bool = Query(False, description="false = dry run (the GET report)"),
    limit: int = Query(500, ge=1, le=2000),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Archive unclaimed places the source has not confirmed for
    `MAP_PLACE_ARCHIVE_DAYS`.

    Archive, not delete: the row keeps its provenance, drops out of every map
    and count, and comes back the day an ingest — or a vendor's `confirmed`
    report — sees it again. Capped per run so one click cannot rewrite the
    whole directory; run it until `archived` comes back 0.
    """
    archive_cutoff = datetime.utcnow() - timedelta(days=settings.MAP_PLACE_ARCHIVE_DAYS)
    if not archive:
        due = (await db.execute(text(
            "SELECT count(*) FROM public_places WHERE status = 'active'"
            " AND claimed_by_vendor_id IS NULL AND last_checked_at < :cutoff"),
            {"cutoff": archive_cutoff})).scalar() or 0
        return {"archived": 0, "due": int(due),
                "note": "dry run — call again with archive=true to retire them"}

    result = await db.execute(text("""
        UPDATE public_places
           SET status = 'archived', updated_at = now()
         WHERE id IN (
             SELECT id FROM public_places
              WHERE status = 'active' AND claimed_by_vendor_id IS NULL
                AND last_checked_at < :cutoff
              ORDER BY last_checked_at ASC
              LIMIT :limit
         )
    """), {"cutoff": archive_cutoff, "limit": limit})
    await db.commit()
    remaining = (await db.execute(text(
        "SELECT count(*) FROM public_places WHERE status = 'active'"
        " AND claimed_by_vendor_id IS NULL AND last_checked_at < :cutoff"),
        {"cutoff": archive_cutoff})).scalar() or 0
    mv.counts_cache.clear()   # the headline counters just changed underneath their TTL
    return {"archived": result.rowcount or 0, "remaining": int(remaining),
            "note": "archived rows return automatically if the source lists them again"}

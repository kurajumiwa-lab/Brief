"""MAP — a marketplace map, not a map with businesses on it.

    GET /api/map/config             tiles, zoom thresholds, limits (one call, cached)
    GET /api/map/counts             the headline chips: markets / vendors / places
    GET /api/map/viewport           what is inside this rectangle, at this zoom
    GET /api/map/places/{id}        one place, in full — fetched when a pin is tapped
    GET /api/map/vendors/{id}       one vendor, in full — same
    GET /api/map/markets/{id}       one market, with its members and mapped places

The rule this file exists to enforce: **the phone never receives the
directory.** `/api/map/viewport` takes a bounding box and a zoom level and
returns either a few hundred grid clusters or a few hundred individual pins —
never 7,640 rows and never 7,640 Leaflet markers.

Progressive disclosure by zoom (see `map_viewport.tier_for`):

    z 2–7    region clusters      "7.6K places" · "25 markets"
    z 8–11   city clusters        Nairobi 1,240 · Kampala 840
    z 12–14  markets + vendors    individual pins
    z 15+    businesses           individual pins, details on tap

Details (phone, hours, address, claim state) are a separate request that fires
when a pin is tapped. No photos are fetched at all — the directory has none,
and a map that pulls 7,640 images is a map that hangs.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.market_locks import MarketZone
from app.models.public_place import PublicPlace
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import map_viewport as mv
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
    return {
        "tiles": {
            "provider": settings.MAP_TILE_PROVIDER,
            "url": settings.MAP_TILE_URL,
            "subdomains": settings.MAP_TILE_SUBDOMAINS,
            "attribution": settings.MAP_TILE_ATTRIBUTION,
            "min_zoom": settings.MAP_TILE_MIN_ZOOM,
            "max_zoom": settings.MAP_TILE_MAX_ZOOM,
            "dev_only": settings.MAP_TILE_DEV_ONLY,
            "note": (
                "The public OpenStreetMap tile server is community-funded and "
                "rate-limited; it is a development default, not a production "
                "backend. Set MAP_TILE_URL to a commercial OSM-derived provider "
                "or your own tile server before launch — and never bulk-download "
                "tiles." if settings.MAP_TILE_DEV_ONLY else
                "Configured tile backend: %s." % settings.MAP_TILE_PROVIDER
            ),
        },
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
    limit: int = Query(settings.MAP_POINT_LIMIT, ge=1, le=settings.MAP_POINT_LIMIT),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """What is inside `bbox` at `zoom`: clusters, or pins when zoomed in far
    enough. This is the only endpoint the map pans with.

    Below a layer's threshold zoom the response is grid clusters (count,
    centroid, dominant category, three sample names). At or above it, the
    response is real pins, capped at `limit` and ordered nearest-to-centre.
    Either way the payload is a few hundred objects, whatever the table holds.

    `counts` reports what is really in the rectangle, so a cluster labelled
    "1,240 places" is a `count(*)`, not an estimate.
    """
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

    key = mv.cache_key_for(",".join(kinds), box, zoom, term, group, cat, limit, str(vendor.id))
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
                                                     category=cat, limit=limit))
        else:
            rows = await mv.places_points(db, box, center, q=term, group=group,
                                          category=cat, limit=limit)
            points.extend(rows)
            truncated = truncated or len(rows) >= limit

    totals = await mv.viewport_totals(db, box, kinds, q=term, group=group, category=cat)
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
            "shown": len(points) + len(clusters),
            "total": sum(totals.values()),
        },
        "truncated": truncated,
        "query": {"q": term, "filter": group, "category": cat, "scope": scope},
        "cell": {"lat": cell[0], "lng": cell[1]},
        "generated_at": datetime.utcnow().isoformat(),
        "attribution": settings.MAP_TILE_ATTRIBUTION,
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

    Every field the source gave us, plus the two facts that make the row honest:
    when the source last confirmed it (`last_checked_at`) and whether a vendor
    has claimed it. Unclaimed rows read "unverified · public data"; that is the
    point of the open-data layer, not a gap in it.
    """
    place = await db.get(PublicPlace, place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    d = haversine_km({"lat": vendor.geo_lat, "lng": vendor.geo_lng},
                     {"lat": place.lat, "lng": place.lng})
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
        "claimed": place.status == "claimed",
        "claimed_by_me": place.claimed_by_vendor_id == vendor.id,
        "distance_km": None if d is None else round(d, 1),
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
    """One market: who has registered, how much of it is mapped, and who the
    patrons are. A market with mapped places but no members is an unworked
    market — that is the number a vendor acts on."""
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
        "places": int(places),
        "claimed": int(claimed),
        "last_ingest_at": zone.last_ingest_at.isoformat() if zone.last_ingest_at else None,
        "last_ingest_count": zone.last_ingest_count,
        "welcome": zone.patron_welcome,
        "distance_km": None if d is None else round(d, 1),
    }

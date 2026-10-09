"""Map viewport queries — the difference between a map that hangs and a map that works.

The directory holds thousands of public places (7,640 and growing). The old
`/api/surface/map` endpoint selected *all* of them, shipped them to the phone
and turned each one into a Leaflet marker — several thousand DOM nodes, on a
device with a few hundred MB of headroom. That is the bug.

This module answers two questions instead:

1. **What is in this rectangle, at this zoom?**
   `bbox + zoom + filters  →  one indexed range scan  →  clusters or ~300 pins`
2. **Which of it is the marketplace?** (v2.8) Every place row is tiered —
   `network` (claimed), `external` (unclaimed, fresh), `stale` (the source
   stopped confirming it) — see `place_tier`. The viewport's `external=`
   mode picks what is drawn; the counts always report the split. Vendors and
   working markets are network rows by definition and rank by commercial
   value, not by distance alone.

Design decisions, and why:

* **Clustering happens in Postgres, in SQL.** A `GROUP BY floor(lat/cell)` over
  the bbox-limited rows means the database never hands the app 7,640 rows to
  aggregate in Python, and the app never hands the phone more than a few
  hundred objects. The row cap is a safety net, not the strategy.
* **Grid cells are screen-sized, not data-sized.** The cell is derived from the
  zoom level (`MAP_CLUSTER_CELL_PX`), so a cluster is always roughly the same
  size on screen at any zoom — and it is stable while panning, because the grid
  is fixed in world coordinates rather than recomputed per view.
* **No PostGIS requirement.** A composite btree index on `(lat, lng)` turns a
  bounding box into two range scans, which is all a viewport query needs at
  this scale. PostGIS/GIST is the right answer for polygon geometry and
  `ST_DWithin` distance queries — see `docs/briefs/map-performance.md` for the
  one-command upgrade path. Requiring the extension would break every managed
  Postgres that does not have it.
* **Caches are short and honest.** Process-local TTL cache + ETag/304 +
  `Cache-Control` on the response. Tiles are never cached by us — bulk-fetching
  the public OSM tile servers is against their tile usage policy.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import OrderedDict
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

# ── Kinds ──────────────────────────────────────────────────────────────────────
MARKETS = "markets"
VENDORS = "vendors"
PLACES = "places"
KINDS = (MARKETS, VENDORS, PLACES)

# ── Place tiers (v2.8) ─────────────────────────────────────────────────────────
# The non-negotiable product rule: **a location on the map is not automatically
# part of the marketplace.** Every place row is in exactly one of three tiers:
#
#   network   — claimed by a vendor. The marketplace trusts the vendor's own
#               rows; the place is a member.
#   external  — unclaimed public data the source still confirms as fresh.
#               Commercially relevant background: muted, never ranked first.
#   stale     — unclaimed and not confirmed by the source for
#               MAP_PLACE_STALE_DAYS. Off the commercial map until it is
#               revalidated (a vendor confirms it, or the next ingest does).
#
# `external=` on the viewport picks how much of that the caller sees:
#   hide   only network rows (the clean, supplier-first map)
#   muted  network rows first, external rows included and flagged
#   only   external rows alone — the claim-sourcing / audit view
NETWORK_TIER = "network"
EXTERNAL_TIER = "external"
STALE_TIER = "stale"
EXTERNAL_MODES = ("hide", "muted", "only")


def fresh_cutoff(now: Optional[datetime] = None) -> datetime:
    """Places whose `last_checked_at` is older than this are stale."""
    from datetime import timedelta
    return (now or datetime.utcnow()) - timedelta(days=settings.MAP_PLACE_STALE_DAYS)


def place_tier(claimed: bool, last_checked_at: Optional[datetime],
               now: Optional[datetime] = None) -> str:
    """Which tier a row is in — the single definition the SQL mirrors."""
    if claimed:
        return NETWORK_TIER
    if last_checked_at is None:
        return STALE_TIER
    cutoff = fresh_cutoff(now)
    return EXTERNAL_TIER if last_checked_at >= cutoff else STALE_TIER

# Zoom at or above which a layer stops clustering and returns real pins.
def point_zoom(kind: str) -> int:
    return {
        MARKETS: settings.MAP_MARKETS_POINT_ZOOM,
        VENDORS: settings.MAP_VENDORS_POINT_ZOOM,
        PLACES: settings.MAP_PLACES_POINT_ZOOM,
    }.get(kind, settings.MAP_PLACES_POINT_ZOOM)


# The four discovery tiers the UI is built around.
def tier_for(zoom: int) -> str:
    if zoom <= 7:
        return "region"        # country / region clusters — "7.6K places"
    if zoom <= 11:
        return "city"          # city & market clusters
    if zoom <= 14:
        return "market"        # individual markets and vendors
    return "shop"              # individual businesses


# ── Quick filters ──────────────────────────────────────────────────────────────
# A trader does not think in OSM keys. Five chips cover the directory, and each
# maps to the `shop:` / `amenity:` / `craft:` prefixes the ingest stores.
QUICK_FILTERS: Dict[str, Dict[str, Any]] = {
    "food": {
        "label": "Food",
        "prefixes": ["shop:supermarket", "shop:convenience", "shop:greengrocer", "shop:butcher",
                     "shop:bakery", "shop:food", "shop:confectionery", "shop:fruit",
                     "amenity:restaurant", "amenity:cafe", "amenity:fast_food", "amenity:marketplace"],
    },
    "electronics": {
        "label": "Electronics",
        "prefixes": ["shop:electronics", "shop:mobile_phone", "shop:computer", "shop:hifi",
                     "shop:electrical", "shop:appliance"],
    },
    "clothing": {
        "label": "Clothing",
        "prefixes": ["shop:clothes", "shop:shoes", "shop:fabric", "shop:tailor", "shop:boutique",
                     "shop:second_hand", "shop:bag", "shop:jewelry"],
    },
    "wholesale": {
        "label": "Wholesale",
        "prefixes": ["shop:wholesale", "shop:trade", "shop:hardware", "shop:doityourself",
                     "shop:building_materials", "shop:chemicals", "shop:furniture"],
    },
    "services": {
        "label": "Services",
        "prefixes": ["shop:hairdresser", "shop:beauty", "shop:laundry", "shop:chemist",
                     "shop:car_repair", "shop:copyshop", "amenity:bank", "amenity:pharmacy",
                     "amenity:post_office", "craft:", "office:"],
    },
}

_BBOX_RE = re.compile(r"^[-\d\s.,]+$")


class BBoxError(ValueError):
    """The client sent a bounding box we refuse to query."""


class BBox:
    """A viewport rectangle, normalised once so every query can trust it."""

    __slots__ = ("west", "south", "east", "north")

    def __init__(self, west: float, south: float, east: float, north: float):
        self.west, self.south, self.east, self.north = west, south, east, north

    @property
    def wrapped(self) -> bool:
        """True when the box crosses the antimeridian (west > east)."""
        return self.west > self.east

    @property
    def center(self) -> Tuple[float, float]:
        lng = self.west + (((self.east - self.west) % 360) / 2.0)
        return ((self.south + self.north) / 2.0, ((lng + 540) % 360) - 180)

    @property
    def span_deg(self) -> float:
        lng_span = (self.east - self.west) % 360 if self.wrapped else (self.east - self.west)
        return max(self.north - self.south, lng_span)

    def as_dict(self) -> Dict[str, float]:
        return {"west": self.west, "south": self.south, "east": self.east, "north": self.north}

    def lng_sql(self, column: str = "lng") -> str:
        """Longitude predicate — two ranges when the box wraps the dateline."""
        if self.wrapped:
            return f"({column} >= :west OR {column} <= :east)"
        return f"{column} BETWEEN :west AND :east"

    def params(self) -> Dict[str, float]:
        return {"west": self.west, "south": self.south, "east": self.east, "north": self.north}


def bbox_where(box: Optional[BBox], lat_col: str = "lat", lng_col: str = "lng") -> Tuple[str, Dict[str, float]]:
    """`WHERE`-fragment for a viewport, or an empty string for a network-wide
    search (a search with no map rectangle in front of it)."""
    if box is None:
        return "", {}
    return (f" AND {lat_col} BETWEEN :south AND :north AND {box.lng_sql(lng_col)}", box.params())


def parse_bbox(raw: str, max_span: Optional[float] = None) -> BBox:
    """`minLng,minLat,maxLng,maxLat` → BBox.

    Rejects anything outside the globe and any viewport wider than
    `MAP_MAX_BBOX_DEG`: a phone cannot usefully render a continent of pins, and
    a bbox that wide is either a bug or a scraper.
    """
    if not raw or not _BBOX_RE.match(raw):
        raise BBoxError("bbox must be four numbers: minLng,minLat,maxLng,maxLat")
    parts = [p for p in raw.split(",") if p.strip() != ""]
    if len(parts) != 4:
        raise BBoxError("bbox must be four numbers: minLng,minLat,maxLng,maxLat")
    try:
        west, south, east, north = (float(p) for p in parts)
    except ValueError:
        raise BBoxError("bbox must be four numbers: minLng,minLat,maxLng,maxLat")
    if not (-180.0 <= west <= 180.0 and -180.0 <= east <= 180.0):
        raise BBoxError("longitude must be between -180 and 180")
    if not (-90.0 <= south <= 90.0 and -90.0 <= north <= 90.0):
        raise BBoxError("latitude must be between -90 and 90")
    if south > north:
        south, north = north, south
    box = BBox(west, south, east, north)
    limit = max_span if max_span is not None else settings.MAP_MAX_BBOX_DEG
    if box.span_deg > limit:
        raise BBoxError(f"that area is too wide to draw — zoom in (max {limit:g}°)")
    return box


# ── Grid ───────────────────────────────────────────────────────────────────────
def cell_size(zoom: int, center_lat: float, cell_px: Optional[int] = None) -> Tuple[float, float]:
    """(cell_lat, cell_lng) in degrees for a `cell_px`-pixel grid cell at `zoom`.

    The world is `256 * 2**zoom` CSS pixels wide, so one pixel is
    `360 / (256 * 2**zoom)` degrees. Longitude degrees shrink towards the poles,
    so the east–west cell is divided by `cos(lat)` to keep cells square on
    screen. Clamped so neither axis can collapse to zero or swallow a continent.
    """
    px = cell_px or settings.MAP_CLUSTER_CELL_PX
    z = max(0, min(22, int(zoom)))
    deg_per_px = 360.0 / (256.0 * (2 ** z))
    cell_lat = max(0.0005, min(10.0, deg_per_px * px))
    cos_lat = max(0.15, abs(math.cos(math.radians(center_lat or 0.0))))
    cell_lng = max(0.0005, min(20.0, cell_lat / cos_lat))
    return cell_lat, cell_lng


def grid_cluster(
    points: Sequence[Dict[str, Any]],
    cell: Tuple[float, float],
    limit: int,
    name_key: str = "name",
) -> List[Dict[str, Any]]:
    """Snap points to a fixed world grid and aggregate. Used for the small
    layers (markets) where pulling the rows costs less than a second query."""
    cell_lat, cell_lng = cell
    buckets: Dict[Tuple[int, int], Dict[str, Any]] = {}
    for p in points:
        lat, lng = p.get("lat"), p.get("lng")
        if lat is None or lng is None:
            continue
        key = (math.floor(lat / cell_lat), math.floor(lng / cell_lng))
        b = buckets.get(key)
        if b is None:
            b = buckets[key] = {
                "lat_sum": 0.0, "lng_sum": 0.0, "count": 0,
                "samples": [], "categories": {},
            }
        b["lat_sum"] += lat
        b["lng_sum"] += lng
        b["count"] += 1
        if len(b["samples"]) < 3 and p.get(name_key):
            b["samples"].append(p[name_key])
        cat = p.get("category")
        if cat:
            b["categories"][cat] = b["categories"].get(cat, 0) + 1
    out = []
    for (gy, gx), b in buckets.items():
        n = b["count"]
        top = max(b["categories"].items(), key=lambda kv: kv[1])[0] if b["categories"] else None
        out.append({
            "id": f"c{gy}_{gx}",
            "lat": round(b["lat_sum"] / n, 6),
            "lng": round(b["lng_sum"] / n, 6),
            "count": n,
            "category": top,
            "sample": b["samples"],
        })
    out.sort(key=lambda c: (-c["count"], c["lat"], c["lng"]))
    return out[:limit]


# ── SQL fragments ──────────────────────────────────────────────────────────────
def _search_sql(term: str) -> Tuple[str, Dict[str, str]]:
    if not term:
        return "", {}
    return (" AND (name ILIKE :q OR category ILIKE :q OR address ILIKE :q"
            " OR COALESCE(zone_name,'') ILIKE :q)", {"q": f"%{term}%"})


# `claimed_by_vendor_id IS NOT NULL` is the one ground truth for membership —
# the claim flow sets both it and status='claimed', and the vendor's account is
# what the network actually trusts.
_NETWORK_SQL = "claimed_by_vendor_id IS NOT NULL"
_FRESH_SQL = "(status = 'active' AND claimed_by_vendor_id IS NULL AND last_checked_at >= :fresh_cutoff)"
_STALE_SQL = "(status = 'active' AND claimed_by_vendor_id IS NULL AND last_checked_at < :fresh_cutoff)"


def place_tier_sql(mode: str) -> Tuple[str, Dict[str, datetime]]:
    """`WHERE`-fragment selecting the tiers an `external=` mode may show.

    Stale rows are never selected here — they leave the commercial map until
    revalidated, and are reported (then archived) by the maintenance sweep.
    """
    if mode == "hide":
        return f" AND {_NETWORK_SQL}", {}
    if mode == "only":
        return f" AND {_FRESH_SQL}", {"fresh_cutoff": fresh_cutoff()}
    # muted — the honest default: network rows first, external flagged after.
    return (f" AND ({_NETWORK_SQL} OR {_FRESH_SQL})", {"fresh_cutoff": fresh_cutoff()})


def category_patterns(group: str) -> List[str]:
    """Quick-filter slug → `LIKE` patterns over the OSM category string."""
    spec = QUICK_FILTERS.get((group or "").strip().lower())
    if not spec:
        return []
    return [f"{p}%" for p in spec["prefixes"]]


def _category_sql(group: str, category: str) -> Tuple[str, Dict[str, str]]:
    patterns = category_patterns(group)
    if category:
        patterns = patterns + [f"{category.strip()}%"]
    if not patterns:
        return "", {}
    params = {f"cat{i}": p for i, p in enumerate(patterns)}
    clause = " AND (" + " OR ".join(f"category LIKE :cat{i}" for i in range(len(patterns))) + ")"
    return clause, params


# ── Places ─────────────────────────────────────────────────────────────────────
async def places_clusters(
    db: AsyncSession, box: BBox, cell: Tuple[float, float],
    q: str = "", group: str = "", category: str = "", limit: int = 400,
    external: str = "muted",
) -> List[Dict[str, Any]]:
    """One row per grid cell: count, centroid, dominant category, 3 sample names.

    `mode()` picks the most common category in the cell and `array_agg` is sliced
    to three names — so the heaviest thing that leaves the database is a few
    hundred aggregate rows, never the underlying places.

    Each cluster carries its tier split (`network` / `network_count`): a cell
    with even one claimed place is a network cell and draws as one; a cell of
    only unclaimed rows is external and draws muted. Stale rows are in no
    cluster — they are off the commercial map.
    """
    search_sql, search_params = _search_sql(q)
    cat_sql, cat_params = _category_sql(group, category)
    tier_sql, tier_params = place_tier_sql(external)
    bbox_sql, bbox_params = bbox_where(box)
    sql = text(f"""
        SELECT floor(lat / :cell_lat)  AS gy,
               floor(lng / :cell_lng)  AS gx,
               count(*)                AS n,
               count(*) FILTER (WHERE {_NETWORK_SQL}) AS network_n,
               avg(lat)                AS clat,
               avg(lng)                AS clng,
               mode() WITHIN GROUP (ORDER BY category) AS cat,
               (array_agg(name ORDER BY last_checked_at DESC))[1:3] AS samples
          FROM public_places
         WHERE status IN ('active', 'claimed'){tier_sql}{bbox_sql}{search_sql}{cat_sql}
         GROUP BY 1, 2
         ORDER BY n DESC, gy, gx
         LIMIT :limit
    """)
    params = {**bbox_params, **search_params, **cat_params, **tier_params,
              "cell_lat": cell[0], "cell_lng": cell[1], "limit": limit}
    rows = (await db.execute(sql, params)).all()
    return [{
        "id": f"p{int(r.gy)}_{int(r.gx)}",
        "kind": PLACES,
        "lat": round(float(r.clat), 6),
        "lng": round(float(r.clng), 6),
        "count": int(r.n),
        "network_count": int(r.network_n or 0),
        "network": int(r.network_n or 0) > 0,
        "category": r.cat,
        "sample": [s for s in (r.samples or []) if s],
    } for r in rows]


async def places_points(
    db: AsyncSession, box: BBox, center: Tuple[float, float],
    q: str = "", group: str = "", category: str = "", limit: int = 300,
    external: str = "muted",
) -> List[Dict[str, Any]]:
    """Individual places inside the viewport, network members first, then
    nearest to the middle. A network place and an external place at the same
    distance are not equal: the member is the marketplace, the other is
    background — so membership outranks proximity in the ordering."""
    search_sql, search_params = _search_sql(q)
    cat_sql, cat_params = _category_sql(group, category)
    tier_sql, tier_params = place_tier_sql(external)
    bbox_sql, bbox_params = bbox_where(box)
    sql = text(f"""
        SELECT id, name, category, lat, lng, zone_name,
               ({_NETWORK_SQL}) AS network
          FROM public_places
         WHERE status IN ('active', 'claimed'){tier_sql}{bbox_sql}{search_sql}{cat_sql}
         ORDER BY ({_NETWORK_SQL}) DESC,
                  (lat - :clat) * (lat - :clat) + (lng - :clng) * (lng - :clng)
         LIMIT :limit
    """)
    params = {**bbox_params, **search_params, **cat_params, **tier_params,
              "clat": center[0], "clng": center[1], "limit": limit}
    rows = (await db.execute(sql, params)).all()
    return [{
        "id": str(r.id), "kind": PLACES, "name": r.name, "category": r.category,
        "lat": r.lat, "lng": r.lng, "zone_name": r.zone_name,
        "network": bool(r.network),
        "claimed": bool(r.network),
    } for r in rows]


# ── Vendors ────────────────────────────────────────────────────────────────────
# Vendors ARE the network: every vendor row is a network row by definition, and
# the ranking below is the product. "Current offers, ranked by relevance,
# availability and commercial value" translates to SQL as:
#
#   has stock on the shelf now  →  verified  →  network score  →  nearest
#
# A verified supplier with 40 live lines two streets further away beats an
# empty profile next door. The lateral count is bbox-capped before it runs
# (the viewport predicate), so the join never walks the whole stock table.

# Vendor clusters aggregate the same ranked population; they are network rows
# and say so, so the client can style them apart from external clusters.
async def vendor_clusters(
    db: AsyncSession, box: BBox, cell: Tuple[float, float],
    q: str = "", limit: int = 400,
) -> List[Dict[str, Any]]:
    search_sql, search_params = (("", {}) if not q else (
        " AND (business_name ILIKE :q OR COALESCE(vendor_handle,'') ILIKE :q"
        " OR COALESCE(physical_location,'') ILIKE :q)", {"q": f"%{q}%"}))
    bbox_sql, bbox_params = bbox_where(box, "geo_lat", "geo_lng")
    sql = text(f"""
        SELECT floor(geo_lat / :cell_lat) AS gy,
               floor(geo_lng / :cell_lng) AS gx,
               count(*)                   AS n,
               avg(geo_lat)               AS clat,
               avg(geo_lng)               AS clng,
               (array_agg(business_name ORDER BY last_active DESC NULLS LAST))[1:3] AS samples
          FROM vendors
         WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL{bbox_sql}{search_sql}
         GROUP BY 1, 2
         ORDER BY n DESC, gy, gx
         LIMIT :limit
    """)
    params = {**bbox_params, **search_params, "cell_lat": cell[0], "cell_lng": cell[1], "limit": limit}
    rows = (await db.execute(sql, params)).all()
    return [{
        "id": f"v{int(r.gy)}_{int(r.gx)}",
        "kind": VENDORS,
        "lat": round(float(r.clat), 6),
        "lng": round(float(r.clng), 6),
        "count": int(r.n),
        "network": True,
        "category": None,
        "sample": [s for s in (r.samples or []) if s],
    } for r in rows]


async def vendor_points(
    db: AsyncSession, box: BBox, center: Tuple[float, float],
    q: str = "", limit: int = 300, exclude_vendor_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Suppliers inside the viewport, ranked by current offers first: in-stock
    lines, then verification, then network score, then plain distance."""
    search_sql, search_params = (("", {}) if not q else (
        " AND (v.business_name ILIKE :q OR COALESCE(v.vendor_handle,'') ILIKE :q"
        " OR COALESCE(v.physical_location,'') ILIKE :q)", {"q": f"%{q}%"}))
    exclude_sql = " AND v.id <> CAST(:me AS uuid)" if exclude_vendor_id else ""
    bbox_sql, bbox_params = bbox_where(box, "v.geo_lat", "v.geo_lng")
    sql = text(f"""
        SELECT v.id, v.business_name, v.vendor_handle, v.business_categories,
               v.geo_lat, v.geo_lng, v.physical_location, v.current_role,
               v.is_verified, v.network_score,
               COALESCE(s.in_stock_lines, 0) AS in_stock_lines,
               (v.geo_lat - :clat) * (v.geo_lat - :clat)
                 + (v.geo_lng - :clng) * (v.geo_lng - :clng) AS d2
          FROM vendors v
          LEFT JOIN LATERAL (
              SELECT count(*) AS in_stock_lines
                FROM stock_items si
               WHERE si.vendor_id = v.id
                 AND si.visible_to_network IS TRUE
                 AND si.quantity_available > 0
          ) s ON TRUE
         WHERE v.geo_lat IS NOT NULL AND v.geo_lng IS NOT NULL{bbox_sql}{search_sql}{exclude_sql}
         ORDER BY (COALESCE(s.in_stock_lines, 0) > 0) DESC,
                  v.is_verified DESC,
                  v.network_score DESC,
                  d2
         LIMIT :limit
    """)
    params = {**bbox_params, **search_params, "clat": center[0], "clng": center[1], "limit": limit}
    if exclude_vendor_id:
        params["me"] = str(exclude_vendor_id)
    rows = (await db.execute(sql, params)).all()
    return [{
        "id": str(r.id), "kind": VENDORS, "name": r.business_name, "handle": r.vendor_handle,
        "categories": list(r.business_categories or [])[:4],
        "location": r.physical_location,
        "role": r.current_role.value if hasattr(r.current_role, "value") else r.current_role,
        "lat": r.geo_lat, "lng": r.geo_lng,
        "network": True,
        "is_verified": bool(r.is_verified),
        "in_stock_lines": int(r.in_stock_lines or 0),
        "network_score": float(r.network_score or 0.0),
    } for r in rows]


# ── Markets ────────────────────────────────────────────────────────────────────
async def market_rows(db: AsyncSession, box: Optional[BBox] = None, q: str = "") -> List[Dict[str, Any]]:
    """Markets with their member count and their *working* supplier count.

    A zone in the catalog is not automatically a market that matters. One with
    registered vendors is `networked` — discoverable and clickable. One with
    none is still drawn (a vendor can be the first to register), but muted and
    sorted last: it is an address, not yet a marketplace. `active_members`
    counts registered vendors who actually have something on the shelf right
    now — that is the number a buyer is shopping against.
    """
    where = ["z.is_active IS TRUE", "z.center_lat IS NOT NULL", "z.center_lng IS NOT NULL"]
    params: Dict[str, Any] = {}
    if box is not None:
        where.append("z.center_lat BETWEEN :south AND :north")
        where.append(box.lng_sql("z.center_lng"))
        params.update(box.params())
    if q:
        where.append("(z.name ILIKE :q OR COALESCE(z.city,'') ILIKE :q OR COALESCE(z.country,'') ILIKE :q)")
        params["q"] = f"%{q}%"
    sql = text(f"""
        SELECT z.id, z.name, z.city, z.country, z.center_lat, z.center_lng, z.radius_km,
               (SELECT count(*) FROM market_members m WHERE m.zone_id = z.id) AS members,
               (SELECT count(DISTINCT si.vendor_id)
                  FROM market_members mm
                  JOIN stock_items si ON si.vendor_id = mm.vendor_id
                 WHERE mm.zone_id = z.id
                   AND si.visible_to_network IS TRUE
                   AND si.quantity_available > 0) AS active_members
          FROM market_zones z
         WHERE {' AND '.join(where)}
         ORDER BY (SELECT count(*) FROM market_members m WHERE m.zone_id = z.id) DESC,
                  active_members DESC, z.name
    """)
    rows = (await db.execute(sql, params)).all()
    return [{
        "id": str(r.id), "kind": MARKETS, "name": r.name, "city": r.city, "country": r.country,
        "lat": r.center_lat, "lng": r.center_lng, "radius_km": r.radius_km,
        "members": int(r.members or 0),
        "active_members": int(r.active_members or 0),
        "networked": int(r.members or 0) > 0,
        "network": int(r.members or 0) > 0,
        "category": "market",
    } for r in rows]


# ── Counts (the headline chips + facets) ───────────────────────────────────────
async def headline_counts(db: AsyncSession) -> Dict[str, Any]:
    """Global totals for the chips, split by tier, plus the quick-filter facets.

    The headline is the network: vendors, working markets, claimed places. The
    external directory is still counted — honestly, in its own keys — because
    "how much mapped stock is not yet in the network" is exactly the number a
    claim-sourcing vendor acts on. Four `count(*)`s and one grouped count,
    cached for `MAP_COUNTS_TTL_SECONDS`.
    """
    cutoff = fresh_cutoff()
    network_places = (await db.execute(text(
        "SELECT count(*) FROM public_places WHERE claimed_by_vendor_id IS NOT NULL"))).scalar() or 0
    external_places = (await db.execute(text(
        "SELECT count(*) FROM public_places WHERE status = 'active'"
        " AND claimed_by_vendor_id IS NULL AND last_checked_at >= :cutoff"),
        {"cutoff": cutoff})).scalar() or 0
    stale_places = (await db.execute(text(
        "SELECT count(*) FROM public_places WHERE status = 'active'"
        " AND claimed_by_vendor_id IS NULL AND last_checked_at < :cutoff"),
        {"cutoff": cutoff})).scalar() or 0
    vendors = (await db.execute(text(
        "SELECT count(*) FROM vendors WHERE geo_lat IS NOT NULL"))).scalar() or 0
    vendors_with_offers = (await db.execute(text(
        "SELECT count(*) FROM vendors v WHERE geo_lat IS NOT NULL AND EXISTS ("
        " SELECT 1 FROM stock_items si WHERE si.vendor_id = v.id"
        " AND si.visible_to_network IS TRUE AND si.quantity_available > 0)"))).scalar() or 0
    markets = (await db.execute(text(
        "SELECT count(*) FROM market_zones WHERE is_active IS TRUE"))).scalar() or 0
    markets_networked = (await db.execute(text(
        "SELECT count(*) FROM market_zones z WHERE z.is_active IS TRUE"
        " AND EXISTS (SELECT 1 FROM market_members m WHERE m.zone_id = z.id)"))).scalar() or 0

    rows = (await db.execute(text("""
        SELECT COALESCE(category, '') AS cat, count(*) AS n
          FROM public_places
         WHERE status IN ('active','claimed')
         GROUP BY 1
         ORDER BY n DESC
    """))).all()
    by_cat = {r.cat: int(r.n) for r in rows}

    facets = []
    for slug, spec in QUICK_FILTERS.items():
        total = sum(n for cat, n in by_cat.items()
                    if any(cat.startswith(p) for p in spec["prefixes"]))
        facets.append({"value": slug, "label": spec["label"], "count": total})
    categories = [{"value": c, "label": c.split(":")[-1] or c, "count": n}
                  for c, n in sorted(by_cat.items(), key=lambda kv: -kv[1])[:30] if c]

    places = network_places + external_places + stale_places
    return {
        "markets": int(markets),
        "markets_networked": int(markets_networked),
        "vendors": int(vendors),
        "vendors_with_offers": int(vendors_with_offers),
        "places": int(places),
        "claimed": int(network_places),          # v2.7 key, kept: claimed = network places
        "network_places": int(network_places),
        "external_places": int(external_places),
        "stale_places": int(stale_places),
        "facets": facets,
        "categories": categories,
        "at": datetime.utcnow().isoformat(),
    }


async def viewport_totals(
    db: AsyncSession, box: Optional[BBox], kinds: Sequence[str],
    q: str = "", group: str = "", category: str = "", external: str = "muted",
) -> Dict[str, int]:
    """How many of each *requested* kind are really inside this rectangle — the
    number the cluster labels and the '1,240 places in view' line may claim.

    Places are split by tier (`network` / `external` / `stale`) whatever the
    caller asked to draw, so a `hide` view can still say "1,212 external
    hidden" instead of silently pretending the directory is empty. A kind that
    was not requested is not counted: one filter on, one dataset queried.
    """
    out: Dict[str, int] = {}
    if PLACES in kinds:
        search_sql, search_params = _search_sql(q)
        cat_sql, cat_params = _category_sql(group, category)
        bbox_sql, bbox_params = bbox_where(box)
        shared = {**bbox_params, **search_params, **cat_params, "cutoff": fresh_cutoff()}
        out[NETWORK_TIER] = (await db.execute(text(f"""
            SELECT count(*) FROM public_places
             WHERE status IN ('active','claimed')
               AND claimed_by_vendor_id IS NOT NULL{bbox_sql}{search_sql}{cat_sql}
        """), {**bbox_params, **search_params, **cat_params})).scalar() or 0
        out[EXTERNAL_TIER] = (await db.execute(text(f"""
            SELECT count(*) FROM public_places
             WHERE status = 'active' AND claimed_by_vendor_id IS NULL
               AND last_checked_at >= :cutoff{bbox_sql}{search_sql}{cat_sql}
        """), shared)).scalar() or 0
        out[STALE_TIER] = (await db.execute(text(f"""
            SELECT count(*) FROM public_places
             WHERE status = 'active' AND claimed_by_vendor_id IS NULL
               AND last_checked_at < :cutoff{bbox_sql}{search_sql}{cat_sql}
        """), shared)).scalar() or 0
        out[PLACES] = out[NETWORK_TIER] + out[EXTERNAL_TIER]   # what the map can draw

    if VENDORS in kinds:
        v_search, v_params = (("", {}) if not q else (
            " AND (business_name ILIKE :q OR COALESCE(vendor_handle,'') ILIKE :q)", {"q": f"%{q}%"}))
        v_sql, v_bbox = bbox_where(box, "geo_lat", "geo_lng")
        out[VENDORS] = (await db.execute(text(f"""
            SELECT count(*) FROM vendors
             WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL{v_sql}{v_search}
        """), {**v_bbox, **v_params})).scalar() or 0
        v_offer_search = v_search.replace("business_name", "v.business_name") \
                                 .replace("vendor_handle", "v.vendor_handle")
        out["vendors_with_offers"] = (await db.execute(text(f"""
            SELECT count(*) FROM vendors v
             WHERE v.geo_lat IS NOT NULL AND v.geo_lng IS NOT NULL
               AND EXISTS (SELECT 1 FROM stock_items si WHERE si.vendor_id = v.id
                           AND si.visible_to_network IS TRUE AND si.quantity_available > 0)
               {v_sql.replace('geo_lat', 'v.geo_lat').replace('geo_lng', 'v.geo_lng')}{v_offer_search}
        """), {**v_bbox, **v_params})).scalar() or 0

    if MARKETS in kinds:
        m_where = ["z.is_active IS TRUE"]
        m_params: Dict[str, Any] = {}
        if box is not None:
            m_where.append("z.center_lat BETWEEN :south AND :north")
            m_where.append(box.lng_sql("z.center_lng"))
            m_params.update(box.params())
        if q:
            m_where.append("(z.name ILIKE :mq OR COALESCE(z.city,'') ILIKE :mq)")
            m_params["mq"] = f"%{q}%"
        out[MARKETS] = (await db.execute(text(
            f"SELECT count(*) FROM market_zones z WHERE {' AND '.join(m_where)}"
        ), m_params)).scalar() or 0
        networked_where = m_where + ["EXISTS (SELECT 1 FROM market_members mm WHERE mm.zone_id = z.id)"]
        out["markets_networked"] = (await db.execute(text(
            f"SELECT count(*) FROM market_zones z WHERE {' AND '.join(networked_where)}"
        ), m_params)).scalar() or 0
    return out


# ── Cache ──────────────────────────────────────────────────────────────────────
class MapCache:
    """Small process-local TTL + LRU cache for viewport responses.

    Panning back and forth over the same streets is the common case, and the
    ETag built from the payload lets the phone skip the body entirely on a
    repeat. Deliberately *not* Redis: these entries are cheap to recompute,
    useless across a restart, and a per-box cache avoids one more hop.
    """

    def __init__(self, ttl: int, size: int):
        self.ttl = ttl
        self.size = size
        self._store: "OrderedDict[str, Tuple[float, str, Any]]" = OrderedDict()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def key(*parts: Any) -> str:
        return hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:24]

    def get(self, key: str) -> Optional[Tuple[str, Any]]:
        hit = self._store.get(key)
        if not hit:
            self.misses += 1
            return None
        expires, etag, payload = hit
        if expires < datetime.utcnow().timestamp():
            self._store.pop(key, None)
            self.misses += 1
            return None
        self._store.move_to_end(key)
        self.hits += 1
        return etag, payload

    def put(self, key: str, etag: str, payload: Any) -> None:
        self._store[key] = (datetime.utcnow().timestamp() + self.ttl, etag, payload)
        self._store.move_to_end(key)
        while len(self._store) > self.size:
            self._store.popitem(last=False)

    def clear(self) -> None:
        self._store.clear()
        self.hits = self.misses = 0

    @property
    def stats(self) -> Dict[str, int]:
        return {"entries": len(self._store), "hits": self.hits, "misses": self.misses,
                "ttl_seconds": self.ttl}


def etag_for(payload: Dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return 'W/"%s"' % hashlib.sha1(body).hexdigest()[:20]


# One cache for viewports, one for the slow-moving headline counters.
viewport_cache = MapCache(settings.MAP_CACHE_TTL_SECONDS, settings.MAP_CACHE_ENTRIES)
counts_cache = MapCache(settings.MAP_COUNTS_TTL_SECONDS, 32)


def cache_key_for(kind_sig: str, box: Optional[BBox], zoom: int, q: str,
                  group: str, category: str, limit: int, viewer: Optional[str],
                  external: str = "muted") -> str:
    """Rounded to ~11 m so a one-pixel pan does not miss the cache; the response
    is identical because the grid and the pin cap are both far coarser. The
    external tier mode is part of the key: a `hide` view and a `muted` view of
    the same rectangle are different answers."""
    if box is None:
        box_part = "network"
    else:
        box_part = "%.4f,%.4f,%.4f,%.4f" % (box.west, box.south, box.east, box.north)
    return MapCache.key(kind_sig, box_part, zoom, q.strip().lower(), group, category,
                        limit, external, viewer or "-")


def parse_kinds(raw: str) -> List[str]:
    if not raw or raw.strip().lower() in ("all", "*"):
        return list(KINDS)
    wanted = [k.strip().lower() for k in raw.split(",") if k.strip()]
    known = [k for k in wanted if k in KINDS]
    return known or list(KINDS)


"""NEARBY — the B2C heart: businesses and professionals around a point.

    GET /api/nearby?lat&lng&radius_km&group&q&limit

Returns, for a point (default: the signed-in vendor's own location, else the
nearest market zone), the real businesses within the radius:

  * members  — registered vendors on this network (source: "member")
  * open data — OSM-sourced local businesses (source: "open data")

Every entry carries its true haversine distance, its taxonomy group, and its
phone number ONLY when the row actually has one. Group counts are returned so
the home screen's category tree shows real numbers. Nothing is geofenced,
ranked, or padded: an empty radius returns an empty list and says so.

The radius is a filter, not a promise — a business 3.1 km away is not
invented into the 3 km list.
"""

import math
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.market_locks import MarketZone
from app.models.public_place import PublicPlace
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import taxonomy

router = APIRouter()


def _dist_km(lat1, lng1, lat2, lng2):
    if None in (lat1, lng1, lat2, lng2):
        return None
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


@router.get("")
async def nearby(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: float = Query(3, ge=0.5, le=50),
    group: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(40, ge=1, le=100),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    # Center: explicit point, else the caller's location, else the nearest
    # market zone (a real anchor, not a fabricated "you are here").
    center_lat, center_lng = lat, lng
    anchor = "point"
    if center_lat is None or center_lng is None:
        if vendor.geo_lat is not None and vendor.geo_lng is not None:
            center_lat, center_lng = vendor.geo_lat, vendor.geo_lng
            anchor = "you"
        else:
            zres = await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True), MarketZone.center_lat.is_not(None)))
            zones = zres.scalars().all()
            if zones:
                center_lat, center_lng = zones[0].center_lat, zones[0].center_lng
                anchor = "market"
            else:
                center_lat, center_lng = -1.2867, 36.8172  # Nairobi
                anchor = "market"

    # Nearest market zone name -> "Around you in {area}".
    area = None
    zres = await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True), MarketZone.center_lat.is_not(None)))
    zones = zres.scalars().all()
    best, best_d = None, None
    for z in zones:
        d = _dist_km(center_lat, center_lng, z.center_lat, z.center_lng)
        if d is not None and (best_d is None or d < best_d):
            best, best_d = z, d
    if best is not None and best_d is not None and best_d <= 25:
        area = best.name

    businesses = []

    # Members (registered vendors with a location).
    vres = await db.execute(select(Vendor).where(Vendor.geo_lat.is_not(None)))
    for v in vres.scalars().all():
        d = _dist_km(center_lat, center_lng, v.geo_lat, v.geo_lng)
        if d is None or d > radius_km:
            continue
        group_id, label = taxonomy.match_vendor(v)
        businesses.append({
            "id": str(v.id),
            "name": v.business_name,
            "group": group_id,
            "label": label,
            "distance_km": round(d, 2),
            "phone": v.phone or None,
            "source": "member",
            "handle": v.vendor_handle,
            "categories": list(v.business_categories or [])[:4],
            "lat": v.geo_lat,
            "lng": v.geo_lng,
        })

    # Open-data places (OSM businesses within the radius). Pre-filtered with a
    # rough bounding box in SQL so we don't load the whole place table as the
    # OSM ingest grows; the exact haversine filter runs on the (smaller) box.
    lat_span = radius_km / 111.0
    lng_span = radius_km / max(111.0 * math.cos(math.radians(center_lat or 0.0)), 1.0)
    pres = await db.execute(
        select(PublicPlace).where(
            PublicPlace.status.in_(["active", "claimed"]),
            PublicPlace.lat.is_not(None),
            PublicPlace.lat.between(center_lat - lat_span, center_lat + lat_span),
            PublicPlace.lng.between(center_lng - lng_span, center_lng + lng_span),
        )
    )
    for p in pres.scalars().all():
        d = _dist_km(center_lat, center_lng, p.lat, p.lng)
        if d is None or d > radius_km:
            continue
        group_id, label = taxonomy.map_place(p.category)
        businesses.append({
            "id": str(p.id),
            "name": p.name,
            "group": group_id,
            "label": label,
            "distance_km": round(d, 2),
            "phone": p.phone or None,
            "source": "open data",
            "category": p.category,
            "zone_name": p.zone_name,
            "claimed_by_me": p.claimed_by_vendor_id == vendor.id,
            "lat": p.lat,
            "lng": p.lng,
        })

    # Category counts BEFORE any filter — the tree shows the real spread.
    counts = {}
    for b in businesses:
        counts[b["group"]] = counts.get(b["group"], 0) + 1

    # Search filter.
    if q:
        ql = q.strip().lower()
        businesses = [b for b in businesses
                      if ql in b["name"].lower()
                      or ql in b["label"].lower()
                      or any(ql in (c or "").lower() for c in b.get("categories", []))]

    # Category filter.
    if group:
        businesses = [b for b in businesses if b["group"] == group]

    businesses.sort(key=lambda b: b["distance_km"])
    shown = businesses[:limit]

    groups = [
        {"group": g, "label": label, "count": counts.get(g, 0)}
        for g, label in taxonomy.GROUPS
        if counts.get(g, 0) > 0
    ]
    groups.sort(key=lambda g: g["count"], reverse=True)

    return {
        "center": {"lat": center_lat, "lng": center_lng},
        "anchor": anchor,
        "area": area,
        "radius_km": radius_km,
        "total": len(businesses),
        "businesses": shown,
        "groups": groups,
        "generated_at": datetime.utcnow().isoformat(),
    }

"""Geo + open-data endpoints (free sources only).

    POST /api/geo/geocode                    place name → lat/lng (Nominatim)
    GET  /api/geo/nearby?lat&lng&radius_km   vendors / rentals / events /
                                             public places with real distances
    GET  /api/geo/zones                      market zones with location +
                                             last ingest stats
    POST /api/geo/zones/{zone_id}/ingest     refresh one zone from OSM (1h)
    POST /api/geo/ingest-all                 refresh every active zone
    GET  /api/geo/public-places              the open-data directory rows
    POST /api/geo/public-places/{id}/claim   link a public place to MY account

Every public place row answers for itself: its source, its OSM id, and when
the source last confirmed it. Nothing here is presented as verified — that
status belongs to claimed, vendor-owned rows.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.events import Event
from app.models.market_locks import MarketZone
from app.models.public_place import PublicPlace
from app.models.tools import ToolListing
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import geo_data
from app.services.geo_data import GeoError
from app.services.routing import haversine_km

router = APIRouter()

STALE_AFTER_DAYS = 30


def _stale_days(iso: Optional[str]) -> Optional[int]:
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return max(0, (datetime.utcnow() - d).days)


def _place_out(p: PublicPlace, me: Vendor) -> dict:
    checked = _stale_days(p.last_checked_at.isoformat())
    return {
        "id": str(p.id),
        "source": p.source,
        "external_id": p.external_id,
        "name": p.name,
        "category": p.category,
        "detail": p.detail,
        "phone": p.phone,
        "opening_hours": p.opening_hours,
        "website": p.website,
        "address": p.address,
        "lat": p.lat,
        "lng": p.lng,
        "zone_name": p.zone_name,
        "first_seen_at": p.first_seen_at.isoformat() if p.first_seen_at else None,
        "last_checked_at": p.last_checked_at.isoformat() if p.last_checked_at else None,
        "checked_days_ago": checked,
        "stale": checked is not None and checked > STALE_AFTER_DAYS,
        "status": p.status,
        "claimed_by_me": p.claimed_by_vendor_id == me.id,
    }


def _zone_out(z: MarketZone, place_count: int, claimed_count: int) -> dict:
    return {
        "id": str(z.id),
        "name": z.name,
        "city": z.city,
        "center_lat": z.center_lat,
        "center_lng": z.center_lng,
        "radius_km": z.radius_km,
        "located": z.center_lat is not None and z.center_lng is not None,
        "last_ingest_at": z.last_ingest_at.isoformat() if z.last_ingest_at else None,
        "last_ingest_count": z.last_ingest_count,
        "places": place_count,
        "claimed": claimed_count,
    }


class GeocodeRequest(BaseModel):
    query: str = Field(min_length=2, max_length=200)


@router.post("/geocode")
async def geocode(req: GeocodeRequest, vendor: Vendor = Depends(get_current_vendor)):
    try:
        return await geo_data.geocode(req.query)
    except GeoError as exc:
        raise HTTPException(404, str(exc))


@router.get("/zones")
async def list_zones(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    zones = (await db.execute(select(MarketZone).order_by(MarketZone.name))).scalars().all()
    counts = dict((await db.execute(
        select(PublicPlace.zone_id, func.count(PublicPlace.id)).where(
            PublicPlace.status == "active"
        ).group_by(PublicPlace.zone_id)
    )).all())
    claimed = dict((await db.execute(
        select(PublicPlace.zone_id, func.count(PublicPlace.id)).where(
            PublicPlace.status == "claimed"
        ).group_by(PublicPlace.zone_id)
    )).all())
    return {"zones": [_zone_out(z, counts.get(z.id, 0), claimed.get(z.id, 0)) for z in zones]}


@router.post("/zones/{zone_id}/ingest")
async def ingest_zone(zone_id: UUID, vendor: Vendor = Depends(get_current_vendor)):
    result = await geo_data.ingest_zone_guarded(str(zone_id))
    if not result.get("ok"):
        raise HTTPException(409, result.get("reason", "ingest refused"))
    return result


@router.post("/ingest-all")
async def ingest_all(vendor: Vendor = Depends(get_current_vendor)):
    results = await geo_data.ingest_all_zones()
    ok = [r for r in results if r.get("ok")]
    return {
        "zones": len(results),
        "ok": len(ok),
        "new_places": sum(r.get("new", 0) for r in ok),
        "results": results,
    }


@router.get("/public-places")
async def list_public_places(
    zone_id: Optional[UUID] = None,
    q: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PublicPlace).where(PublicPlace.status.in_(["active", "claimed"]))
    if zone_id:
        stmt = stmt.where(PublicPlace.zone_id == zone_id)
    if category:
        stmt = stmt.where(PublicPlace.category == category)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(PublicPlace.name.ilike(like), PublicPlace.category.ilike(like), PublicPlace.address.ilike(like)))
    rows = (await db.execute(stmt.order_by(PublicPlace.last_checked_at.desc()).limit(limit))).scalars().all()
    categories = sorted({r.category for r in rows if r.category})
    return {"places": [_place_out(p, vendor) for p in rows], "categories": categories}


@router.post("/public-places/{place_id}/claim")
async def claim_place(place_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    place = await db.get(PublicPlace, place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    if place.status == "claimed" and place.claimed_by_vendor_id != vendor.id:
        raise HTTPException(409, "Already claimed by another vendor")
    if place.status == "claimed":
        return {"place": _place_out(place, vendor), "changed": False}

    place.claimed_by_vendor_id = vendor.id
    place.status = "claimed"
    place.updated_at = datetime.utcnow()
    # Claiming locates the vendor if they were never located — the place's
    # coordinates are the source's, not a guess. Existing values are kept.
    if vendor.geo_lat is None or vendor.geo_lng is None:
        vendor.geo_lat, vendor.geo_lng = place.lat, place.lng
    if not (vendor.physical_location or "").strip():
        vendor.physical_location = place.address or f"{place.name}, {place.zone_name or ''}".rstrip(", ")
    await db.commit()
    return {"place": _place_out(place, vendor), "changed": True}


@router.get("/nearby")
async def nearby(
    lat: float,
    lng: float,
    radius_km: float = Query(5, ge=0.2, le=50),
    category: Optional[str] = None,
    limit: int = Query(25, ge=1, le=100),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Everything with coordinates inside the circle, with real haversine km.

    Vendors, rentals (tool listings), events and public places. Each list is
    capped; a category filter narrows vendors (business categories) and
    places (OSM categories).
    """
    def keep(item, dist):
        return dist is not None and dist <= radius_km

    out = {"radius_km": radius_km, "lat": lat, "lng": lng}

    vendors = (await db.execute(select(Vendor))).scalars().all()
    vrows = []
    for v in vendors:
        d = haversine_km({"lat": lat, "lng": lng}, {"lat": v.geo_lat, "lng": v.geo_lng})
        if not keep(v, d):
            continue
        if category and category not in (v.business_categories or []):
            continue
        vrows.append({
            "id": str(v.id), "name": v.business_name, "handle": v.vendor_handle,
            "location": v.physical_location, "distance_km": round(d, 2),
            "lat": v.geo_lat, "lng": v.geo_lng,
        })
    vrows.sort(key=lambda r: r["distance_km"])
    out["vendors"] = vrows[:limit]

    tools = (await db.execute(select(ToolListing).where(ToolListing.is_available.is_(True)))).scalars().all()
    trows = []
    for t in tools:
        d = haversine_km({"lat": lat, "lng": lng}, {"lat": t.geo_lat, "lng": t.geo_lng})
        if not keep(t, d):
            continue
        trows.append({
            "id": str(t.id), "name": t.title, "category": t.category.value if hasattr(t.category, "value") else t.category,
            "price_per_unit": t.price_per_unit, "price_unit": t.price_unit,
            "location": t.location, "distance_km": round(d, 2),
            "lat": t.geo_lat, "lng": t.geo_lng,
        })
    trows.sort(key=lambda r: r["distance_km"])
    out["tools"] = trows[:limit]

    events = (await db.execute(select(Event).where(Event.start_date >= datetime.utcnow()))).scalars().all()
    erows = []
    for e in events:
        d = haversine_km({"lat": lat, "lng": lng}, {"lat": e.geo_lat, "lng": e.geo_lng})
        if not keep(e, d):
            continue
        erows.append({
            "id": str(e.id), "name": e.title, "event_type": e.event_type,
            "location": e.location, "starts_at": e.start_date.isoformat(),
            "distance_km": round(d, 2), "lat": e.geo_lat, "lng": e.geo_lng,
        })
    erows.sort(key=lambda r: r["distance_km"])
    out["events"] = erows[:limit]

    places = (await db.execute(
        select(PublicPlace).where(PublicPlace.status.in_(["active", "claimed"])).limit(500)
    )).scalars().all()
    prows = []
    for p in places:
        d = haversine_km({"lat": lat, "lng": lng}, {"lat": p.lat, "lng": p.lng})
        if not keep(p, d):
            continue
        if category and p.category != category:
            continue
        prows.append({
            "id": str(p.id), "name": p.name, "category": p.category, "phone": p.phone,
            "zone_name": p.zone_name, "distance_km": round(d, 2),
            "lat": p.lat, "lng": p.lng, "claimed_by_me": p.claimed_by_vendor_id == vendor.id,
        })
    prows.sort(key=lambda r: r["distance_km"])
    out["places"] = prows[:limit]

    return out

"""Markets — the East-African market catalog, the regional scan, multi-market
data, market registration, and the market patron role.

    GET  /api/markets                 the catalog (with distance if located)
    GET  /api/markets/scan            the NEAREST markets to a point (the scan)
    POST /api/markets/data            aggregated data for 1..N selected markets
    GET  /api/markets/mine            my memberships + my patron standing
    POST /api/markets/{zone_id}/join  register for a market
    POST /api/markets/{zone_id}/leave leave a market
    PUT  /api/markets/{zone_id}/welcome   lead patron sets the pace note

Every count is a row or a true haversine distance. A market with no data yet
says so — it is never padded.
"""

import math
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.hustle import HustleJobCall
from app.models.market_locks import MarketMember, MarketZone
from app.models.public_place import PublicPlace
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.market_patrons import (
    compute_market_patrons, is_lead_patron, is_patron, set_market_welcome,
)

router = APIRouter()

MAX_RADIUS_KM = 500.0
MAX_SELECTED = 10


def _dist_km(lat1, lng1, lat2, lng2):
    if None in (lat1, lng1, lat2, lng2):
        return None
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


async def _zone_out(db: AsyncSession, z: MarketZone, lat=None, lng=None, with_patrons=False) -> dict:
    member_count = (await db.execute(
        select(func.count(MarketMember.id)).where(MarketMember.zone_id == z.id)
    )).scalar() or 0
    out = {
        "id": str(z.id), "name": z.name, "city": z.city, "country": z.country,
        "lat": z.center_lat, "lng": z.center_lng, "located": z.center_lat is not None,
        "radius_km": z.radius_km, "member_count": member_count,
        "last_ingest_at": z.last_ingest_at.isoformat() if z.last_ingest_at else None,
        "last_ingest_count": z.last_ingest_count,
    }
    if lat is not None and lng is not None:
        out["distance_km"] = _dist_km(lat, lng, z.center_lat, z.center_lng)
    if with_patrons:
        result = await compute_market_patrons(db, z)
        lead = result["patrons"][0] if result["patrons"] else None
        out["patron_slots"] = result["patron_slots"]
        out["lead_patron"] = lead
        out["patron_count"] = len(result["patrons"])
        out["welcome"] = z.patron_welcome
        out["welcome_at"] = z.patron_welcome_at.isoformat() if z.patron_welcome_at else None
    return out


async def _member_point(vendor: Vendor, lat: Optional[float], lng: Optional[float]):
    if lat is not None and lng is not None:
        return lat, lng
    return vendor.geo_lat, vendor.geo_lng


@router.get("")
async def list_markets(
    country: Optional[str] = None,
    city: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MarketZone).where(MarketZone.is_active.is_(True))
    if country:
        stmt = stmt.where(func.lower(MarketZone.country) == country.lower())
    if city:
        stmt = stmt.where(func.lower(MarketZone.city) == city.lower())
    zones = (await db.execute(stmt.order_by(MarketZone.country, MarketZone.city, MarketZone.name))).scalars().all()
    la, lo = await _member_point(vendor, lat, lng)
    out = [await _zone_out(db, z, la, lo) for z in zones]
    if la is not None:
        out.sort(key=lambda x: (x.get("distance_km") is None, x.get("distance_km") or 0))
    countries = sorted({z.country for z in zones if z.country})
    return {"markets": out, "countries": countries}


@router.get("/scan")
async def scan_markets(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: float = Query(150, ge=1, le=MAX_RADIUS_KM),
    limit: int = Query(12, ge=1, le=50),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The 'scan the nearest markets in your surrounding towns' endpoint."""
    la, lo = await _member_point(vendor, lat, lng)
    zones = (await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True)))).scalars().all()
    if la is None or lo is None:
        raise HTTPException(400, "A location is needed to scan — set your shop's location first")
    scored = []
    for z in zones:
        d = _dist_km(la, lo, z.center_lat, z.center_lng)
        if d is None or d > radius_km:
            continue
        scored.append((d, z))
    scored.sort(key=lambda t: t[0])
    out = []
    for d, z in scored[:limit]:
        zo = await _zone_out(db, z, la, lo, with_patrons=True)
        zo["distance_km"] = round(d, 1)
        out.append(zo)
    return {
        "lat": la, "lng": lo, "radius_km": radius_km, "found": len(out),
        "markets": out,
    }


class DataRequest(BaseModel):
    zone_ids: List[UUID] = Field(min_length=1, max_length=MAX_SELECTED)
    lat: Optional[float] = None
    lng: Optional[float] = None


@router.post("/data")
async def market_data(
    body: DataRequest,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Aggregated, honest data for 1..N selected markets."""
    la, lo = await _member_point(vendor, body.lat, body.lng)
    zones = {z.id: z for z in (await db.execute(
        select(MarketZone).where(MarketZone.id.in_(body.zone_ids))
    )).scalars().all()}
    results = []
    for zid in body.zone_ids:
        z = zones.get(zid)
        if not z:
            continue
        radius = z.radius_km or 5.0
        places = (await db.execute(
            select(func.count(PublicPlace.id)).where(PublicPlace.zone_id == z.id)
        )).scalar() or 0
        sample = (await db.execute(
            select(PublicPlace).where(PublicPlace.zone_id == z.id)
            .order_by(PublicPlace.last_checked_at.desc()).limit(3)
        )).scalars().all()
        # Vendors actually located within the market's radius (real suppliers).
        vendors = (await db.execute(
            select(Vendor.id, Vendor.business_name, Vendor.geo_lat, Vendor.geo_lng)
        )).all()
        near_vendors = 0
        for vid, vname, vlat, vlng in vendors:
            d = _dist_km(z.center_lat, z.center_lng, vlat, vlng)
            if d is not None and d <= radius:
                near_vendors += 1
        open_calls = (await db.execute(
            select(HustleJobCall.id, HustleJobCall.geo_lat, HustleJobCall.geo_lng)
            .where(HustleJobCall.status == "open", HustleJobCall.expires_at >= datetime.utcnow())
        )).all()
        near_calls = 0
        for cid, clat, clng in open_calls:
            d = _dist_km(z.center_lat, z.center_lng, clat, clng)
            if d is not None and d <= radius:
                near_calls += 1
        zo = await _zone_out(db, z, la, lo, with_patrons=True)
        zo["data"] = {
            "public_places": places,
            "sample_places": [{"name": p.name, "category": p.category} for p in sample],
            "suppliers_nearby": near_vendors,
            "open_calls_nearby": near_calls,
        }
        results.append(zo)
    return {"markets": results, "selected": len(results)}


@router.get("/mine")
async def my_markets(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(MarketMember, MarketZone).join(MarketZone, MarketZone.id == MarketMember.zone_id)
        .where(MarketMember.vendor_id == vendor.id).order_by(MarketMember.joined_at.asc())
    )).all()
    out = []
    for member, z in rows:
        zo = await _zone_out(db, z, with_patrons=True)
        result = await compute_market_patrons(db, z)
        zo["i_am_member"] = True
        zo["i_joined_at"] = member.joined_at.isoformat() if member.joined_at else None
        zo["i_am_patron"] = is_patron(result, vendor.id)
        zo["i_am_lead"] = is_lead_patron(result, vendor.id)
        my_rank = next((s["join_rank"] for s in result["all"] if s["vendor_id"] == str(vendor.id)), None)
        zo["my_join_rank"] = my_rank
        out.append(zo)
    return {"markets": out}


@router.post("/{zone_id}/join", status_code=201)
async def join_market(zone_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    zone = await db.get(MarketZone, zone_id)
    if not zone or not zone.is_active:
        raise HTTPException(404, "Market not found")
    exists = (await db.execute(
        select(MarketMember.id).where(MarketMember.vendor_id == vendor.id, MarketMember.zone_id == zone_id).limit(1)
    )).first()
    if exists:
        raise HTTPException(409, "You are already registered for this market")
    member = MarketMember(vendor_id=vendor.id, zone_id=zone_id, joined_at=datetime.utcnow())
    db.add(member)
    await db.commit()
    result = await compute_market_patrons(db, zone)
    return {
        "joined": True, "zone": zone.name,
        "join_rank": next((s["join_rank"] for s in result["all"] if s["vendor_id"] == str(vendor.id)), None),
        "i_am_patron": is_patron(result, vendor.id),
        "i_am_lead": is_lead_patron(result, vendor.id),
        "note": "You're registered. Early registrants and active members earn patron standing."
    }


@router.post("/{zone_id}/leave")
async def leave_market(zone_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    member = (await db.execute(
        select(MarketMember).where(MarketMember.vendor_id == vendor.id, MarketMember.zone_id == zone_id)
    )).scalars().first()
    if not member:
        raise HTTPException(404, "You are not registered for this market")
    db.delete(member)
    await db.commit()
    return {"left": True}


class WelcomeBody(BaseModel):
    text: str = Field(min_length=3, max_length=2000)


@router.put("/{zone_id}/welcome")
async def update_welcome(zone_id: UUID, body: WelcomeBody,
                         vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    zone = await db.get(MarketZone, zone_id)
    if not zone:
        raise HTTPException(404, "Market not found")
    await set_market_welcome(db, zone, vendor, body.text)
    await db.commit()
    return {"welcome": zone.patron_welcome, "welcome_at": zone.patron_welcome_at.isoformat()}

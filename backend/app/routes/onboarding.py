"""Onboarding — your shop page (MySpace) + your market (the radar).

Two ideas, both built on real rows only:

  * MySpace: your profile IS your public page — a handle others can open,
    a completeness bar computed from the fields that actually exist, and a
    top-connections list from real connection rows. No "profile power" that
    a badge could fake.
  * Pokémon GO: the app shows what is REAL within 3 km of your shop — named
    suppliers, public places, open call-ups, rentals, events — each with its
    true distance. Onboarding is walking that list and doing one real thing
    per item: connect, claim, or accept. "Found" means a row was written.

    GET /api/onboarding   steps + my page + the nearby radar, one call.
"""

from datetime import datetime
from typing import Optional
from math import asin, cos, radians, sin, sqrt

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.hustle import HustleContract, HustleJobCall, HustleSquad, HustleSquadMember
from app.models.public_place import PublicPlace
from app.models.stock import StockItem
from app.models.tools import ToolListing
from app.models.events import Event
from app.models.vendor import Vendor, vendor_connections
from app.routes.auth import get_current_vendor

router = APIRouter()

RADAR_RADIUS_KM = 3.0


def _dist_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 6371 * 2 * asin(sqrt(a))


def _masked(phone: Optional[str]) -> Optional[str]:
    """+254712345678 -> +25471•••••78 — enough to recognize, not to misuse."""
    if not phone:
        return None
    p = phone.strip()
    if len(p) <= 6:
        return p[:2] + "•••"
    return p[:5] + "•" * (len(p) - 7) + p[-2:]


@router.get("")
async def onboarding(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    # ── My page: the fields that exist, and who is connected to you ────────
    conn_rows = (await db.execute(
        select(vendor_connections.c.vendor_b_id, vendor_connections.c.created_at)
        .where(vendor_connections.c.vendor_a_id == vendor.id)
    )).all()
    conn_rows += (await db.execute(
        select(vendor_connections.c.vendor_a_id, vendor_connections.c.created_at)
        .where(vendor_connections.c.vendor_b_id == vendor.id)
    )).all()
    other_ids = [r[0] for r in conn_rows]
    top = []
    if other_ids:
        others = (await db.execute(select(Vendor).where(Vendor.id.in_(other_ids)))).scalars().all()
        by_id = {v.id: v for v in others}
        for other_id, created in sorted(conn_rows, key=lambda r: r[1] or datetime.min, reverse=True)[:5]:
            v = by_id.get(other_id)
            if v:
                top.append({"name": v.business_name, "handle": v.vendor_handle,
                            "since": created.isoformat() if created else None})

    stock_lines = (await db.execute(
        select(func.count(StockItem.id)).where(StockItem.vendor_id == vendor.id, StockItem.status != "archived")
    )).scalar() or 0
    places_claimed = (await db.execute(
        select(func.count(PublicPlace.id)).where(PublicPlace.claimed_by_vendor_id == vendor.id)
    )).scalar() or 0
    squad_row = (await db.execute(
        select(HustleSquad.name).join(HustleSquadMember, HustleSquadMember.squad_id == HustleSquad.id)
        .where(HustleSquadMember.vendor_id == vendor.id, HustleSquad.status == "active")
    )).first()
    first_match = (await db.execute(
        select(func.count(HustleContract.id)).where(HustleContract.status == "completed",
            (HustleContract.player_vendor_id == vendor.id)
        )).scalar() or 0) + (await db.execute(
        select(func.count(HustleJobCall.id)).join(HustleContract, HustleContract.job_call_id == HustleJobCall.id)
        .where(HustleJobCall.vendor_id == vendor.id, HustleContract.status == "completed")
    )).scalar() or 0

    # ── Steps — every one is a query over rows, so a step can't be faked ───
    steps = [
        {"key": "located", "label": "Put your shop on the map",
         "done": vendor.geo_lat is not None and vendor.geo_lng is not None,
         "hint": "Your address, geocoded. The radar and 'near you' need it."},
        {"key": "page", "label": "Complete your shop page",
         "done": bool(vendor.business_categories) and bool((vendor.physical_location or "").strip()),
         "hint": "What you trade, and where you trade it. Others open your page by handle."},
        {"key": "neighbors", "label": "Connect with 3 suppliers",
         "done": len(other_ids) >= 3, "have": len(other_ids), "target": 3,
         "hint": "Connections make your stock — and theirs — easier to find."},
        {"key": "shelf", "label": "Put stock on your shelf or claim a place",
         "done": stock_lines > 0 or places_claimed > 0,
         "have": stock_lines + places_claimed,
         "hint": "One real line on your shelf, or claim a nearby public place as yours."},
        {"key": "first_match", "label": "Finish your first job",
         "done": first_match > 0,
         "hint": "Accept a call-up or post one and settle it. The league starts at the first completed match."},
    ]
    completion = round(sum(1 for s in steps if s["done"]) / len(steps), 2)

    # ── The radar: what is REAL within the radius, each with true distance ─
    nearby = None
    if vendor.geo_lat is not None and vendor.geo_lng is not None:
        lat, lng = vendor.geo_lat, vendor.geo_lng

        def keep(items, lat_attr="geo_lat", lng_attr="geo_lng"):
            out = []
            for it in items:
                a, b = getattr(it, lat_attr), getattr(it, lng_attr)
                if a is None or b is None:
                    continue
                d = _dist_km(lat, lng, a, b)
                if d <= RADAR_RADIUS_KM:
                    out.append((d, it))
            out.sort(key=lambda t: t[0])
            return out

        vs = (await db.execute(select(Vendor).where(Vendor.id != vendor.id))).scalars().all()
        ps = (await db.execute(
            select(PublicPlace).where(PublicPlace.status.in_(["active", "claimed"]))
        )).scalars().all()
        calls = (await db.execute(
            select(HustleJobCall).where(HustleJobCall.status == "open", HustleJobCall.expires_at >= datetime.utcnow())
        )).scalars().all()
        tools = (await db.execute(select(ToolListing).where(ToolListing.is_available.is_(True)))).scalars().all()
        events = (await db.execute(select(Event).where(Event.start_date >= datetime.utcnow()))).scalars().all()

        nearby = {
            "lat": lat, "lng": lng, "radius_km": RADAR_RADIUS_KM,
            "vendors": [
                {"id": str(v.id), "name": v.business_name, "handle": v.vendor_handle,
                 "location": v.physical_location, "categories": v.business_categories or [],
                 "distance_km": round(d, 2)}
                for d, v in keep(vs)[:20]
            ],
            "places": [
                {"id": str(p.id), "name": p.name, "category": p.category, "zone_name": p.zone_name,
                 "distance_km": round(d, 2), "claimed_by_me": p.claimed_by_vendor_id == vendor.id}
                for d, p in keep(ps, "lat", "lng")[:20]
            ],
            "calls": [
                {"id": str(c.id), "title": c.title, "skill": c.skill, "pay_kes": c.pay_kes,
                 "location": c.location, "distance_km": round(d, 2), "squad": bool(c.squad_id)}
                for d, c in keep(calls)[:10]
            ],
            "tools": [
                {"id": str(t.id), "name": t.title,
                 "category": t.category.value if hasattr(t.category, "value") else t.category,
                 "price_per_unit": t.price_per_unit, "price_unit": t.price_unit,
                 "distance_km": round(d, 2)}
                for d, t in keep(tools)[:10]
            ],
            "events": [
                {"id": str(e.id), "name": e.title, "location": e.location,
                 "starts_at": e.start_date.isoformat(), "distance_km": round(d, 2)}
                for d, e in keep(events)[:10]
            ],
        }

    return {
        "completion": completion,
        "steps": steps,
        "my_page": {
            "handle": vendor.vendor_handle,
            "name": vendor.business_name,
            "categories": vendor.business_categories or [],
            "location": vendor.physical_location,
            "description": vendor.business_description,
            "phone": _masked(vendor.phone),
            "top_connections": top,
            "connection_count": len(other_ids),
            "stock_lines": stock_lines,
            "places_claimed": places_claimed,
            "squad": squad_row[0] if squad_row else None,
        },
        "nearby": nearby,
    }

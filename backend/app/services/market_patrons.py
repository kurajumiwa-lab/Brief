"""Market Patron — derived, never stored.

A market's patron standing is computed from rows on every read, the same rule
as every other number in this app: nothing is written as a rank that a bug or
a grant could inflate.

Who is a patron of a market:
  * Pioneer weight — the EARLIEST registrations are favoured. Being first to
    register for a market is real: it is the onboarding admin / pace-setter
    role. The join order in market_members is what encodes it.
  * Activity — points from a member's REAL rows: public places claimed in the
    market, completed jobs near it, call-ups posted near it, connections, and
    stock lines.
  * Slots that GROW with the market — a market of 5 has one patron seat; at 60
    it has two; at 250 it has three; beyond 1,000 it has six. So as the number
    of registered accounts improves, more of the ACTIVE members are promoted
    into the seats — exactly the mechanic requested. The top scorers fill the
    seats; the first is the Lead Patron.

Benefits are real and non-gamable: a Lead Patron may set the market's
onboarding / pace note (read by every member), and patrons' call-ups surface
first in that market's data feed. No fake rewards, no invented counts.
"""

import math
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.hustle import HustleContract, HustleJobCall
from app.models.public_place import PublicPlace
from app.models.stock import StockItem
from app.models.market_locks import MarketMember, MarketZone
from app.models.vendor import Vendor, vendor_connections

# Points per unit of a member's real activity.
W_CLAIMED_PLACE = 10
W_COMPLETED_JOB = 5
W_POSTED_CALL = 5
W_CONNECTION = 1
W_STOCK_LINE = 1

# Pioneer weight by join rank (1 = first to register).
_PIONEER = [(1, 30), (2, 20), (3, 15), (5, 10), (10, 5)]
_PIONEER_FLOOR = 2


def pioneer_bonus(rank: int) -> int:
    for up_to, bonus in _PIONEER:
        if rank <= up_to:
            return bonus
    return _PIONEER_FLOOR


def patron_slots(member_count: int) -> int:
    """Seats grow as the market grows — more active members get promoted in."""
    if member_count < 15:
        return 1
    if member_count < 60:
        return 2
    if member_count < 250:
        return 3
    if member_count < 1000:
        return 4
    return 6


def _dist_km(lat1, lng1, lat2, lng2) -> Optional[float]:
    if None in (lat1, lng1, lat2, lng2):
        return None
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


async def compute_market_patrons(db: AsyncSession, zone: MarketZone) -> dict:
    """Full patron picture for one market, derived from rows."""
    radius = zone.radius_km or 5.0
    members = (await db.execute(
        select(MarketMember, Vendor).join(Vendor, Vendor.id == MarketMember.vendor_id)
        .where(MarketMember.zone_id == zone.id)
        .order_by(MarketMember.joined_at.asc(), MarketMember.id.asc())
    )).all()
    member_ids = [m[0].vendor_id for m in members]

    claimed, completed, posted, conn, stock = {}, {}, {}, {}, {}

    if member_ids:
        # Public places claimed IN this market.
        rows = (await db.execute(
            select(PublicPlace.claimed_by_vendor_id, func.count(PublicPlace.id))
            .where(PublicPlace.zone_id == zone.id,
                   PublicPlace.claimed_by_vendor_id.in_(member_ids))
            .group_by(PublicPlace.claimed_by_vendor_id)
        )).all()
        claimed = {r[0]: r[1] for r in rows}

        # Completed jobs NEAR this market (the job's location within radius).
        rows = (await db.execute(
            select(HustleContract.player_vendor_id, HustleJobCall.geo_lat, HustleJobCall.geo_lng)
            .join(HustleJobCall, HustleJobCall.id == HustleContract.job_call_id)
            .where(HustleContract.status == "completed",
                   HustleContract.player_vendor_id.in_(member_ids))
        )).all()
        for vid, la, lo in rows:
            if _dist_km(zone.center_lat, zone.center_lng, la, lo) is not None and \
               _dist_km(zone.center_lat, zone.center_lng, la, lo) <= radius:
                completed[vid] = completed.get(vid, 0) + 1

        # Call-ups posted NEAR this market.
        rows = (await db.execute(
            select(HustleJobCall.vendor_id, HustleJobCall.geo_lat, HustleJobCall.geo_lng)
            .where(HustleJobCall.vendor_id.in_(member_ids))
        )).all()
        for vid, la, lo in rows:
            d = _dist_km(zone.center_lat, zone.center_lng, la, lo)
            if d is not None and d <= radius:
                posted[vid] = posted.get(vid, 0) + 1

        # Connections (global).
        for side in (vendor_connections.c.vendor_a_id, vendor_connections.c.vendor_b_id):
            rows = (await db.execute(
                select(side, func.count()).where(side.in_(member_ids)).group_by(side)
            )).all()
            for vid, n in rows:
                conn[vid] = conn.get(vid, 0) + n

        # Stock lines (global).
        rows = (await db.execute(
            select(StockItem.vendor_id, func.count(StockItem.id))
            .where(StockItem.vendor_id.in_(member_ids), StockItem.status != "archived")
            .group_by(StockItem.vendor_id)
        )).all()
        stock = {r[0]: r[1] for r in rows}

    scored = []
    for rank, (member, vendor) in enumerate(members, start=1):
        vid = vendor.id
        pts = (
            claimed.get(vid, 0) * W_CLAIMED_PLACE
            + completed.get(vid, 0) * W_COMPLETED_JOB
            + posted.get(vid, 0) * W_POSTED_CALL
            + conn.get(vid, 0) * W_CONNECTION
            + stock.get(vid, 0) * W_STOCK_LINE
            + pioneer_bonus(rank)
        )
        scored.append({
            "vendor_id": str(vid),
            "name": vendor.business_name,
            "handle": vendor.vendor_handle,
            "points": pts,
            "join_rank": rank,
            "pioneer_bonus": pioneer_bonus(rank),
            "joined_at": member.joined_at.isoformat() if member.joined_at else None,
        })
    # Highest points first; ties broken by join order (earlier first).
    scored.sort(key=lambda s: (-s["points"], s["join_rank"]))

    slots = patron_slots(len(members))
    for i, s in enumerate(scored):
        s["is_patron"] = i < slots
        s["is_lead"] = i == 0 and len(members) > 0

    return {
        "zone_id": str(zone.id),
        "zone_name": zone.name,
        "member_count": len(members),
        "patron_slots": slots,
        "welcome": zone.patron_welcome,
        "welcome_at": zone.patron_welcome_at.isoformat() if zone.patron_welcome_at else None,
        "patrons": scored[:slots],
        "all": scored,
    }


def is_lead_patron(result: dict, vendor_id) -> bool:
    for p in result.get("patrons", []):
        if p["vendor_id"] == str(vendor_id):
            return p["is_lead"]
    return False


def is_patron(result: dict, vendor_id) -> bool:
    return any(p["vendor_id"] == str(vendor_id) for p in result.get("patrons", []))


async def set_market_welcome(db: AsyncSession, zone: MarketZone, vendor: Vendor, text: str) -> MarketZone:
    """Only the lead patron writes the market's onboarding / pace note."""
    result = await compute_market_patrons(db, zone)
    if not is_lead_patron(result, vendor.id):
        from fastapi import HTTPException
        raise HTTPException(403, "Only the lead patron of this market can set its welcome note")
    zone.patron_welcome = text.strip()[:2000]
    zone.patron_welcome_by = vendor.id
    zone.patron_welcome_at = datetime.utcnow()
    await db.flush()
    return zone

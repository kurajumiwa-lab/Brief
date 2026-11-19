"""Pulse windows, tier ladders and flash-drop claims.

The windows are a calendar rule, not a promotion switch. The flash drop is an
atomic quantity claim: the UPDATE only decrements a live, in-window, non-empty
drop, so two taps can never create a third unit.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.pulse.models import FlashDrop, FlashDropClaim
from app.services.notification_service import create_notification

NAIROBI = timezone(timedelta(hours=3))
RAIL_COLOR = "#E65100"

PAYDAY = {
    "key": "payday", "label": "Payday",
    "hint": "Fresh money moves first. Big-ticket sourcing and full-service bookings.",
    "categories": ["food", "decor", "supplies", "services"],
}
MID_MONTH = {
    "key": "mid_month", "label": "Mid-Month Clearance",
    "hint": "Quiet shelf space, marked down. Small quantities move fast.",
    "categories": ["stock", "household", "produce"],
}
WEEKEND = {
    "key": "weekend", "label": "Weekend Pulse",
    "hint": "Friday evening to Sunday. Social, family and last-minute plans.",
    "categories": ["events", "food", "entertainment", "repairs"],
}


def _local(now: Optional[datetime] = None) -> datetime:
    moment = now or datetime.utcnow()
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(NAIROBI)


def _month_shift(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def _at(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=NAIROBI)


def _window_for(now: Optional[datetime] = None) -> Optional[dict]:
    local = _local(now)
    day = local.day
    # Payday wins an overlap: it is the strongest intent signal.
    if day >= 25:
        year, month = _month_shift(local.year, local.month, 1)
        start = _at(local.year, local.month, 25)
        end = _at(year, month, 3, 23, 59)
        meta = PAYDAY
    elif day <= 3:
        year, month = _month_shift(local.year, local.month, -1)
        start = _at(year, month, 25)
        end = _at(local.year, local.month, 3, 23, 59)
        meta = PAYDAY
    elif 14 <= day <= 16:
        start = _at(local.year, local.month, 14)
        end = _at(local.year, local.month, 16, 23, 59)
        meta = MID_MONTH
    else:
        # Friday 12:00 → Sunday 18:00.
        weekday = local.weekday()
        if weekday == 4 and local.hour >= 12:
            start = _at(local.year, local.month, local.day, 12)
            end = start + timedelta(days=2, hours=6)
            meta = WEEKEND
        elif weekday == 5:
            start = _at(local.year, local.month, local.day, 12) - timedelta(days=1)
            end = _at(local.year, local.month, local.day, 18) + timedelta(days=1)
            meta = WEEKEND
        elif weekday == 6 and local.hour < 18:
            start = _at(local.year, local.month, local.day, 12) - timedelta(days=2)
            end = _at(local.year, local.month, local.day, 18)
            meta = WEEKEND
        else:
            return None
    if not (start <= local <= end):
        return None
    return {
        **meta,
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "rail_color": RAIL_COLOR,
    }


def _next_window(now: Optional[datetime] = None) -> dict:
    local = _local(now)
    candidates: dict[str, dict] = {}
    for days in range(0, 40):
        probe = local + timedelta(days=days)
        window = _window_for(probe.replace(hour=12, minute=0, second=0, microsecond=0))
        if window and datetime.fromisoformat(window["starts_at"]) > local:
            candidates.setdefault(window["key"], window)
    if candidates:
        return min(candidates.values(), key=lambda w: w["starts_at"])
    year, month = _month_shift(local.year, local.month, 1)
    return {
        **PAYDAY,
        "starts_at": _at(year, month, 25).isoformat(),
        "ends_at": _at(year, month, 25).isoformat(),
        "rail_color": RAIL_COLOR,
    }


def pulse(now: Optional[datetime] = None) -> dict:
    active = _window_for(now)
    local = _local(now)
    return {
        "now": local.isoformat(),
        "active": active,
        "next": _next_window(now),
        "rail": {"color": RAIL_COLOR, "class": "pulse-rail"},
        "tiers": COLLECTIVE_TIERS,
        "note": "A window shifts the feed's skin and order. It never changes a price.",
    }


# ── tier ladder for group rounds ─────────────────────────────────────────────

COLLECTIVE_TIERS = [
    {"key": "starter", "min": 1, "max": 4, "label": "Starter round", "multiplier": 1.15},
    {"key": "group", "min": 5, "max": 14, "label": "Group rate", "multiplier": 1.0},
    {"key": "best", "min": 15, "max": 20, "label": "Best rate", "multiplier": 0.85},
]


def round_tiers(pledged: int, unit_price: Optional[float]) -> dict:
    pledged = max(0, int(pledged or 0))
    tiers = []
    for tier in COLLECTIVE_TIERS:
        price = round(float(unit_price) * tier["multiplier"], 2) if unit_price else None
        tiers.append({**tier, "price_per_unit": price, "unlocked": pledged >= tier["min"]})
    unlocked = [t for t in tiers if t["unlocked"]]
    current = unlocked[-1] if unlocked else None
    upcoming = next((t for t in tiers if not t["unlocked"]), None)
    return {
        "tiers": tiers,
        "current_tier": current,
        "next_tier": upcoming,
        "units_to_next_tier": max(0, upcoming["min"] - pledged) if upcoming else 0,
    }


# ── flash drops ──────────────────────────────────────────────────────────────

def _drop_out(drop: FlashDrop, seller: Optional[Vendor] = None,
              viewer_id: Optional[uuid.UUID] = None) -> dict:
    now = datetime.utcnow()
    remaining = max(0, int(drop.capacity or 0) - int(drop.claimed_count or 0))
    minutes_left = max(0, int((drop.ends_at - now).total_seconds() // 60)) if drop.ends_at else 0
    return {
        "id": str(drop.id),
        "label": drop.label,
        "description": drop.description,
        "price_kes": int(drop.price_kes or 0),
        "capacity": int(drop.capacity or 0),
        "claimed_count": int(drop.claimed_count or 0),
        "remaining": remaining,
        "minutes_left": minutes_left,
        "starts_at": drop.starts_at.isoformat() if drop.starts_at else None,
        "ends_at": drop.ends_at.isoformat() if drop.ends_at else None,
        "status": drop.status,
        "seller": ({"handle": seller.vendor_handle, "business": seller.business_name}
                   if seller else None),
        "is_mine": bool(viewer_id and drop.vendor_id == viewer_id),
        "can_claim": remaining > 0 and drop.status == "live" and drop.ends_at > now,
    }


async def active_drops(db: AsyncSession, viewer: Optional[Vendor] = None) -> dict:
    from sqlalchemy.orm import aliased
    seller = aliased(Vendor)
    rows = (await db.execute(
        select(FlashDrop, seller).join(seller, seller.id == FlashDrop.vendor_id)
        .where(
            FlashDrop.status == "live",
            FlashDrop.starts_at <= datetime.utcnow(),
            FlashDrop.ends_at > datetime.utcnow(),
            FlashDrop.claimed_count < FlashDrop.capacity,
        )
        .order_by(FlashDrop.ends_at.asc()).limit(24)
    )).all()
    return {
        "drops": [_drop_out(drop, vendor, viewer.id if viewer else None) for drop, vendor in rows],
        "note": "A claim reserves one unit for direct payment. Brief holds no stock or money.",
    }


async def create_drop(db: AsyncSession, vendor: Vendor, *, label: str, description: Optional[str],
                      price_kes: int, capacity: int, duration_minutes: int) -> dict:
    label = (label or "").strip()
    if len(label) < 2:
        raise HTTPException(422, "Give the drop a name.")
    if price_kes < 0:
        raise HTTPException(422, "A drop price cannot be negative.")
    if not 1 <= capacity <= 1000:
        raise HTTPException(422, "A drop holds between 1 and 1,000 units.")
    if not 1 <= duration_minutes <= 60:
        raise HTTPException(422, "A flash drop lasts at most 60 minutes.")
    now = datetime.utcnow()
    drop = FlashDrop(
        vendor_id=vendor.id, label=label[:160], description=(description or "").strip()[:2000] or None,
        price_kes=price_kes, capacity=capacity, claimed_count=0,
        starts_at=now, ends_at=now + timedelta(minutes=duration_minutes),
        status="live", created_at=now,
    )
    db.add(drop)
    await db.flush()
    return _drop_out(drop, vendor, vendor.id)


async def claim_drop(db: AsyncSession, vendor: Vendor, drop_id: uuid.UUID) -> dict:
    drop = await db.get(FlashDrop, drop_id)
    if drop is None:
        raise HTTPException(404, "That drop was not found.")
    if drop.vendor_id == vendor.id:
        raise HTTPException(409, "You cannot claim your own drop.")
    now = datetime.utcnow()
    if drop.status != "live" or drop.starts_at > now or drop.ends_at <= now:
        raise HTTPException(409, "This drop is not live.")
    if int(drop.claimed_count or 0) >= int(drop.capacity or 0):
        raise HTTPException(409, "This drop is sold out. The next drop is listed below.")

    # Insert the person's claim first: the unique key is what stops one account
    # from taking two units even if it taps twice at once.
    claim_id = (await db.execute(
        pg_insert(FlashDropClaim).values(id=uuid.uuid4(), drop_id=drop.id, vendor_id=vendor.id,
                                         created_at=now)
        .on_conflict_do_nothing(constraint="uq_flash_drop_claims_person")
        .returning(FlashDropClaim.id)
    )).scalar_one_or_none()
    if claim_id is None:
        existing = (await db.execute(
            select(FlashDropClaim).where(FlashDropClaim.drop_id == drop.id,
                                         FlashDropClaim.vendor_id == vendor.id)
        )).scalar_one()
        return {
            "claimed": False,
            "message": "You already claimed this drop.",
            "claim_id": str(existing.id),
            "drop": _drop_out(drop),
        }

    row = (await db.execute(
        update(FlashDrop)
        .where(
            FlashDrop.id == drop.id,
            FlashDrop.status == "live",
            FlashDrop.ends_at > now,
            FlashDrop.claimed_count < FlashDrop.capacity,
        )
        .values(claimed_count=FlashDrop.claimed_count + 1)
        .returning(FlashDrop.id, FlashDrop.claimed_count, FlashDrop.capacity)
    )).first()
    if row is None:
        await db.execute(
            FlashDropClaim.__table__.delete().where(FlashDropClaim.id == claim_id)
        )
        return {
            "claimed": False,
            "message": "This drop just sold out. Watch for the next one.",
            "drop": _drop_out(drop),
        }

    await db.refresh(drop)
    next_rows = (await db.execute(
        select(FlashDrop).where(
            FlashDrop.status == "live",
            FlashDrop.ends_at > now,
            FlashDrop.id != drop.id,
        ).order_by(FlashDrop.starts_at.asc()).limit(3)
    )).scalars().all()
    await create_notification(
        db, drop.vendor_id, NotificationType.FLASH_DROP_CLAIM,
        f"Drop claimed: {drop.label}",
        f"{vendor.business_name} claimed one unit at {int(drop.price_kes or 0):,} KES. "
        "Settle directly; Brief holds no money.",
        sender_id=vendor.id,
        data={"drop_id": str(drop.id), "claim_id": str(claim_id)},
    )
    return {
        "claimed": True,
        "message": "Claimed — next drop is below. Pay the seller directly.",
        "claim_id": str(claim_id),
        "drop": _drop_out(drop, viewer_id=vendor.id),
        "next_drops": [_drop_out(x) for x in next_rows],
    }


async def my_drops(db: AsyncSession, vendor: Vendor) -> dict:
    drops = (await db.execute(
        select(FlashDrop).where(FlashDrop.vendor_id == vendor.id)
        .order_by(FlashDrop.created_at.desc()).limit(50)
    )).scalars().all()
    claimed = (await db.execute(
        select(FlashDropClaim, FlashDrop).join(FlashDrop, FlashDrop.id == FlashDropClaim.drop_id)
        .where(FlashDropClaim.vendor_id == vendor.id)
        .order_by(FlashDropClaim.created_at.desc()).limit(50)
    )).all()
    return {
        "drops": [_drop_out(drop, vendor, vendor.id) for drop in drops],
        "claims": [{"claim_id": str(claim.id), "drop": _drop_out(drop)}
                   for claim, drop in claimed],
    }

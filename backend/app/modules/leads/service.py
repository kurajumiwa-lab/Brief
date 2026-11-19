"""Lead capture, dedupe and the monthly statement.

The client may say *which* target and action, but never who the beneficiary is,
what it costs, or what the fingerprint is. Those are derived here from the
signed-in account and the target row. A second tap by the same buyer on the same
target returns the first row instead of billing twice.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.events import Event
from app.models.stock import StockItem
from app.models.vendor import Vendor
from app.modules.ledger.models import LocalActivity
from app.modules.leads.models import LEAD_ACTIONS, LEAD_TARGETS, LeadEvent
from app.modules.referrals.models import ReferralLink
from app.modules.town.audit import audit

LEAD_FEE_KES = 5
SCOUT_BOUNTY_KES = 1
_MONTH = re.compile(r"^\d{4}-\d{2}$")


def _now() -> datetime:
    return datetime.utcnow()


def _fingerprint(buyer_id: uuid.UUID, target_kind: str, target_id: uuid.UUID) -> str:
    token = f"lead:{buyer_id}:{target_kind}:{target_id}"
    return hmac.new(settings.SECRET_KEY.encode(), token.encode(), hashlib.sha256).hexdigest()


def _details(value: Optional[dict]) -> dict:
    if not isinstance(value, dict):
        return {}
    safe: dict[str, Any] = {}
    for key, item in list(value.items())[:20]:
        if isinstance(item, (str, int, float, bool)) or item is None:
            safe[str(key)[:40]] = item[:200] if isinstance(item, str) else item
    return safe


async def _target(db: AsyncSession, kind: str, target_id: uuid.UUID) -> tuple[uuid.UUID, str]:
    if kind not in LEAD_TARGETS:
        raise HTTPException(422, "Choose a valid lead target.")
    if kind == "event":
        row = await db.get(Event, target_id)
        if row is None:
            raise HTTPException(404, "That event was not found.")
        return row.organizer_id, row.title
    if kind == "vendor":
        row = await db.get(Vendor, target_id)
        if row is None:
            raise HTTPException(404, "That business was not found.")
        return row.id, row.business_name
    if kind == "stock":
        row = await db.get(StockItem, target_id)
        if row is None:
            raise HTTPException(404, "That stock item was not found.")
        return row.vendor_id, row.name
    row = await db.get(LocalActivity, target_id)
    if row is None:
        raise HTTPException(404, "That activity was not found.")
    return row.organizer_vendor_id, row.title


async def _scout(db: AsyncSession, code: Optional[str], vendor_id: uuid.UUID,
                 buyer_id: uuid.UUID) -> tuple[Optional[Vendor], Optional[ReferralLink]]:
    code = (code or "").strip()
    if not code:
        return None, None
    link = (await db.execute(
        select(ReferralLink).where(func.upper(ReferralLink.code) == code.upper(),
                                   ReferralLink.active.is_(True))
    )).scalar_one_or_none()
    if link is None:
        return None, None
    # A merchant cannot farm its own bounty, and neither can the buyer.
    if link.referrer_vendor_id in (vendor_id, buyer_id):
        return None, None
    scout = await db.get(Vendor, link.referrer_vendor_id)
    return scout, link


def _lead_out(row: LeadEvent, scout: Optional[Vendor] = None,
              viewer_id: Optional[uuid.UUID] = None) -> dict:
    return {
        "id": str(row.id),
        "target_kind": row.target_kind,
        "target_id": str(row.target_id),
        "target_label": row.target_label,
        "action": row.action,
        "fee_kes": int(row.fee_kes or 0),
        "bounty_kes": int(row.bounty_kes or 0),
        "status": row.status,
        "scout": ({"handle": scout.vendor_handle, "business": scout.business_name}
                  if scout else None),
        "is_mine": bool(viewer_id and row.scout_id == viewer_id),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def record(db: AsyncSession, buyer: Vendor, *, target_kind: str, target_id: uuid.UUID,
                 action: str, scout_code: Optional[str] = None,
                 details: Optional[dict] = None) -> dict:
    if action not in LEAD_ACTIONS:
        raise HTTPException(422, "Choose a valid lead action.")
    vendor_id, label = await _target(db, target_kind, target_id)
    if vendor_id == buyer.id:
        raise HTTPException(409, "You cannot record a handshake with your own business.")

    fingerprint = _fingerprint(buyer.id, target_kind, target_id)
    scout, link = await _scout(db, scout_code, vendor_id, buyer.id)
    values = {
        "id": uuid.uuid4(),
        "vendor_id": vendor_id,
        "buyer_id": buyer.id,
        "scout_id": scout.id if scout else None,
        "target_kind": target_kind,
        "target_id": target_id,
        "target_label": label[:200],
        "action": action,
        "fingerprint_hash": fingerprint,
        "scout_code": link.code if link else None,
        "fee_kes": LEAD_FEE_KES,
        "bounty_kes": SCOUT_BOUNTY_KES if scout else 0,
        "status": "verified",
        "details": _details(details),
        "created_at": _now(),
    }
    # ON CONFLICT is the dedupe lock: concurrent taps produce one row, not an
    # IntegrityError that rolls the caller's transaction back.
    inserted = (await db.execute(
        pg_insert(LeadEvent).values(**values)
        .on_conflict_do_nothing(constraint="uq_lead_events_fingerprint")
        .returning(LeadEvent.id)
    )).scalar_one_or_none()
    if inserted is None:
        existing = (await db.execute(
            select(LeadEvent).where(
                LeadEvent.target_kind == target_kind,
                LeadEvent.target_id == target_id,
                LeadEvent.fingerprint_hash == fingerprint,
            )
        )).scalar_one()
        return {
            "recorded": False,
            "message": "This handshake is already on the ledger.",
            "lead": _lead_out(existing),
        }

    row = await db.get(LeadEvent, inserted)
    audit(db, action="lead_recorded", entity_type=target_kind[:40], entity_id=target_id,
          actor_vendor_id=buyer.id,
          payload={"lead_id": str(row.id), "vendor_id": str(vendor_id), "fee_kes": LEAD_FEE_KES,
                   "scout_id": str(scout.id) if scout else None})
    return {
        "recorded": True,
        "message": ("Handshake recorded." if scout is None
                    else "Handshake recorded — the scout is credited directly."),
        "lead": _lead_out(row, scout, buyer.id),
        "scout_credited": bool(scout),
    }


def _month_range(month: Optional[str]) -> tuple[str, datetime, datetime]:
    if month is None:
        now = _now()
        month = f"{now.year:04d}-{now.month:02d}"
    if not _MONTH.match(month):
        raise HTTPException(422, "Use a month in YYYY-MM form.")
    year, mon = int(month[:4]), int(month[5:])
    if mon < 1 or mon > 12:
        raise HTTPException(422, "Use a month in YYYY-MM form.")
    start = datetime(year, mon, 1)
    end = datetime(year + 1, 1, 1) if mon == 12 else datetime(year, mon + 1, 1)
    return month, start, end


async def statement(db: AsyncSession, vendor: Vendor, month: Optional[str] = None) -> dict:
    month, start, end = _month_range(month)
    rows = (await db.execute(
        select(LeadEvent).where(
            LeadEvent.vendor_id == vendor.id,
            LeadEvent.status == "verified",
            LeadEvent.created_at >= start,
            LeadEvent.created_at < end,
        ).order_by(LeadEvent.created_at.desc()).limit(1000)
    )).scalars().all()
    scout_ids = {row.scout_id for row in rows if row.scout_id}
    scouts = {}
    if scout_ids:
        scouts = {v.id: v for v in (await db.execute(
            select(Vendor).where(Vendor.id.in_(scout_ids))
        )).scalars().all()}
    by_kind: dict[str, int] = {}
    for row in rows:
        by_kind[row.target_kind] = by_kind.get(row.target_kind, 0) + 1
    fees = sum(int(row.fee_kes or 0) for row in rows)
    bounties = sum(int(row.bounty_kes or 0) for row in rows)
    unique_buyers = len({row.buyer_id for row in rows if row.buyer_id})
    return {
        "month": month,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "verified_leads": len(rows),
        "unique_people": unique_buyers,
        "by_target_kind": by_kind,
        "fee_per_lead_kes": LEAD_FEE_KES,
        "due_kes": fees,
        "scout_bounty_kes": bounties,
        "scouts_credited": len(scout_ids),
        "statement": [
            _lead_out(row, scouts.get(row.scout_id), vendor.id) for row in rows[:50]
        ],
        "note": ("A verified handshake is 5 KES. Scout bounties are 1 KES each and are paid "
                 "by you directly to the scout. Brief never holds either amount."),
    }


async def mine(db: AsyncSession, vendor: Vendor, month: Optional[str] = None) -> dict:
    current = await statement(db, vendor, month)
    recent = (await db.execute(
        select(LeadEvent).where(LeadEvent.vendor_id == vendor.id)
        .order_by(LeadEvent.created_at.desc()).limit(20)
    )).scalars().all()
    scout_ids = {row.scout_id for row in recent if row.scout_id}
    scouts = {}
    if scout_ids:
        scouts = {v.id: v for v in (await db.execute(
            select(Vendor).where(Vendor.id.in_(scout_ids))
        )).scalars().all()}
    return {
        **current,
        "recent": [_lead_out(row, scouts.get(row.scout_id), vendor.id) for row in recent],
    }


async def scouted(db: AsyncSession, vendor: Vendor, month: Optional[str] = None) -> dict:
    month, start, end = _month_range(month)
    rows = (await db.execute(
        select(LeadEvent).where(
            LeadEvent.scout_id == vendor.id,
            LeadEvent.status == "verified",
            LeadEvent.created_at >= start,
            LeadEvent.created_at < end,
        ).order_by(LeadEvent.created_at.desc()).limit(1000)
    )).scalars().all()
    bounty = sum(int(row.bounty_kes or 0) for row in rows)
    return {
        "month": month,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "leads": len(rows),
        "earned_kes": bounty,
        "statement": [_lead_out(row, vendor, vendor.id) for row in rows],
        "note": "Your bounty is paid by the business directly. Brief does not hold it.",
    }

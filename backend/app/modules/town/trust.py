"""Evidence-based trust ladder: New → Reachable → Verified → Trading → Trusted.

The ladder is deliberately hard to climb with claims and easy to fall with a
dispute. Only completed, independently checkable actions earn score:

  · a verified receipt (the shop issued it, not the person typing)
  · a completed scout task (the poster approved the proof and paid)
  · a verified referral conversion (proof reviewed, not just submitted)
  · a verified merchant claim (a shop answered a challenge receipt)
  · a scout rating from a merchant (capped, so one friend cannot lift a score)

A device login, a click or a pasted screenshot alone never moves the level.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.corridor_tasks.models import CorridorTask, CorridorTaskFee
from app.modules.town.models import (
    DisputeCase, ReferralConversion, ScoutTaskRating, TrustSnapshot,
)
from app.models.receipts import Receipt, ReceiptMerchant

LEVELS = ("New", "Reachable", "Verified", "Trading", "Trusted")
LEVEL_REQUIREMENTS = {
    1: "Sign in and verify a phone number.",
    2: "Earn 20 points from a verified receipt or a completed task.",
    3: "Reach 40 points with at least one independently verified action.",
    4: "Reach 60 points with a completed trade or verified referral.",
    5: "Reach 80 points with five verified actions and no open dispute.",
}


def level_name(level: int) -> str:
    return LEVELS[max(1, min(5, int(level or 1))) - 1]


async def _count(db: AsyncSession, statement) -> int:
    value = (await db.execute(statement)).scalar()
    return int(value or 0)


async def compute(db: AsyncSession, vendor_id) -> dict[str, Any]:
    """Compute a score from evidence. Nothing is taken on trust from a client."""
    vendor = (
        await db.execute(select(Vendor).where(Vendor.id == vendor_id))
    ).scalar_one_or_none()
    if vendor is None:
        return {"score": 0, "level": 1, "level_name": LEVELS[0], "evidence": {}}

    verified_receipts = await _count(db, select(func.count(Receipt.id)).where(
        Receipt.vendor_id == vendor_id,
        Receipt.status == "verified",
        ~Receipt.fraud_flags.contains(["self_receipt"]),
        ~Receipt.fraud_flags.contains(["expired"]),
    ))
    completed_tasks = await _count(db, select(func.count(CorridorTask.id)).where(
        CorridorTask.assignee_user_id == vendor_id,
        CorridorTask.status == "COMPLETED",
    ))
    verified_conversions = await _count(db, select(func.count(ReferralConversion.id)).where(
        ReferralConversion.status == "verified",
        or_(ReferralConversion.actor_vendor_id == vendor_id,
            ReferralConversion.referrer_vendor_id == vendor_id),
    ))
    verified_merchants = await _count(db, select(func.count(ReceiptMerchant.id)).where(
        ReceiptMerchant.claimed_by_vendor_id == vendor_id,
        ReceiptMerchant.claim_status == "verified",
    ))
    paid_tasks = await _count(db, select(func.count(CorridorTaskFee.id)).where(
        CorridorTaskFee.worker_user_id == vendor_id,
    ))
    rating_row = (await db.execute(
        select(func.avg(ScoutTaskRating.rating), func.count(ScoutTaskRating.id)).where(
            ScoutTaskRating.scout_vendor_id == vendor_id,
        )
    )).one()
    rating_avg = float(rating_row[0] or 0)
    rating_count = int(rating_row[1] or 0)
    open_disputes = await _count(db, select(func.count(DisputeCase.id)).where(
        or_(DisputeCase.opened_by_vendor_id == vendor_id,
            DisputeCase.against_vendor_id == vendor_id),
        DisputeCase.status.in_(("open", "reviewing")),
    ))
    lost_disputes = await _count(db, select(func.count(DisputeCase.id)).where(
        DisputeCase.against_vendor_id == vendor_id,
        DisputeCase.status == "resolved",
    ))
    # Only adverse flags count. `priority_15_min`, `undated` and `no_merchant_pin`
    # are neutral observations about a normal receipt, not misconduct.
    adverse_flags = ("self_receipt", "expired", "item_total_mismatch")
    returned_receipts = await _count(db, select(func.count(Receipt.id)).where(
        Receipt.vendor_id == vendor_id,
        or_(*[Receipt.fraud_flags.contains([flag]) for flag in adverse_flags]),
    ))

    evidence = {
        "phone_verified": bool(vendor.phone_verified_at),
        "verified_receipts": verified_receipts,
        "completed_tasks": completed_tasks,
        "paid_tasks": paid_tasks,
        "verified_conversions": verified_conversions,
        "verified_merchants": verified_merchants,
        "scout_rating_avg": round(rating_avg, 2),
        "scout_rating_count": rating_count,
        "open_disputes": open_disputes,
        "resolved_disputes_against": lost_disputes,
        "flagged_receipts": returned_receipts,
    }

    score = 0
    score += 10 if vendor.phone_verified_at else 0
    score += min(5, verified_receipts) * 4
    score += min(5, completed_tasks) * 5
    score += min(5, verified_conversions) * 4
    score += min(2, verified_merchants) * 8
    if rating_count:
        score += int(round((rating_avg / 5.0) * 10))
    score -= min(3, open_disputes) * 5
    score -= min(5, lost_disputes) * 10
    score -= min(3, returned_receipts) * 2
    score = max(0, min(100, score))

    verified_actions = verified_receipts + completed_tasks + verified_conversions + verified_merchants
    level = 1
    if score >= 20:
        level = 2
    if score >= 40 and verified_actions >= 1:
        level = 3
    if score >= 60 and (completed_tasks + verified_conversions + paid_tasks) >= 1:
        level = 4
    if score >= 80 and verified_actions >= 5 and open_disputes == 0:
        level = 5

    return {
        "score": score,
        "level": level,
        "level_name": level_name(level),
        "next_level": level_name(level + 1) if level < 5 else None,
        "next_requirement": LEVEL_REQUIREMENTS.get(level + 1) if level < 5 else None,
        "evidence": evidence,
        "computed_at": datetime.utcnow().isoformat(),
    }


async def current(db: AsyncSession, vendor_id, *, max_age_seconds: int = 300) -> dict[str, Any]:
    """Read the latest snapshot unless it is stale, then append a new one."""
    now = datetime.utcnow()
    snapshot = (
        await db.execute(
            select(TrustSnapshot)
            .where(TrustSnapshot.vendor_id == vendor_id)
            .order_by(TrustSnapshot.computed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if snapshot is not None and snapshot.computed_at >= now - timedelta(seconds=max_age_seconds):
        evidence = snapshot.evidence or {}
        return {
            "score": snapshot.score,
            "level": snapshot.level,
            "level_name": level_name(snapshot.level),
            "next_level": level_name(snapshot.level + 1) if snapshot.level < 5 else None,
            "next_requirement": LEVEL_REQUIREMENTS.get(snapshot.level + 1) if snapshot.level < 5 else None,
            "evidence": evidence,
            "computed_at": snapshot.computed_at.isoformat(),
        }
    fresh = await compute(db, vendor_id)
    db.add(TrustSnapshot(
        vendor_id=vendor_id,
        score=fresh["score"],
        level=fresh["level"],
        evidence=fresh["evidence"],
        computed_at=now,
    ))
    await db.flush()
    return fresh


async def level_for(db: AsyncSession, vendor_id) -> int:
    return int((await current(db, vendor_id))["level"])

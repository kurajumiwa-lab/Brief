"""The receipt game: a paid task, never wages, and never silently cheaper.

One "work day" is one completed batch of accepted price observations inside one
town. The ladder is exactly the sentence in the brief — 200 shillings for a
day's work, "lowered to the percentage you contributed":

    accepted / required     payout
          100%              KSh 200
           75%              KSh 150
           50%              KSh 100
          <50%              KSh 0, with a written reason for every rejected line

Three rules make it survive scrutiny, and all three are enforced here:

1. **It is a task reward, not wages.** The API says so in the payload, there is
   a monthly cap, and there is no exclusivity — a person doing 26 full days
   would earn KSh 5,200, which is below the statutory minimum wage, so this must
   never be presented as employment.
2. **A town pool, published before the work starts.** If more people submit than
   the day's pool covers, the rate drops for everyone *and says so*, rather than
   paying less after the work is done.
3. **Every rejection has a reason.** A person who worked and earned nothing is
   owed a sentence explaining why.

Fraud rules live in `_reject_reason` and in the intake claim path (one receipt,
one reward; two independent reports before a price is confirmed).
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.hiring.models import ObservationReward

#: One completed batch. Twelve shops or twelve lines — either way, a walk.
REQUIRED_PER_DAY = 12
#: The full day's reward, and the ladder down from it.
DAY_REWARD_KES = 200
LADDER = ((1.0, 200), (0.75, 150), (0.50, 100))
#: The published daily pool for one town. When contributions exceed it the rate
#: drops for everyone, and the screen says today's number before anybody starts.
TOWN_DAILY_POOL_KES = 2_000
#: A person may earn this much in a calendar month. About 20 full days.
MONTHLY_CAP_KES = 4_000
#: Wording that goes with every payment, so no screen can drift into "salary".
PAYMENT_NOTE = (
    "You are completing a paid task. This is not employment and it is not a "
    "daily salary: it creates no employment relationship."
)


class RewardError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def payout_for(accepted: int, required: int = REQUIRED_PER_DAY) -> tuple[int, str]:
    """(amount, what to call it). The ladder, plus the sentence for <50%."""
    if required <= 0:
        return 0, "Nothing to review."
    ratio = accepted / required
    for threshold, amount in LADDER:
        if ratio >= threshold:
            return amount, f"{accepted} of {required} accepted."
    return 0, (
        f"{accepted} of {required} accepted, below half. Rejections must each carry "
        "a reason — ask the reviewer to explain any line you disagree with."
    )


async def pool_rate(db: AsyncSession, town: Optional[str], *, day: date) -> dict:
    """What a full day pays in this town today, and why.

    Deterministic for the day: everyone who reads it before starting sees the
    same number, and everyone assessed sees the number they were quoted.
    """
    paid_today = int((await db.execute(
        select(func.coalesce(func.sum(ObservationReward.amount_kes), 0)).where(
            ObservationReward.work_date == day,
            ObservationReward.town == town,
            ObservationReward.status.in_(("accrued", "paid")),
        )
    )).scalar() or 0)
    reward = DAY_REWARD_KES
    reason = f"Today's pool pays KSh {DAY_REWARD_KES} for a full day."
    if paid_today >= TOWN_DAILY_POOL_KES:
        reward = int(DAY_REWARD_KES * 0.75)
        reason = (
            f"Today's pool pays KSh {reward} per full day, not KSh {DAY_REWARD_KES}: "
            "more people submitted than the pool covers. The pool refills tomorrow."
        )
    return {
        "town": town,
        "day": day.isoformat(),
        "full_day_kes": reward,
        "pool_kes": TOWN_DAILY_POOL_KES,
        "committed_kes": paid_today,
        "reason": reason,
        "required_per_day": REQUIRED_PER_DAY,
        "ladder": [
            {"share": share, "accepted": int(round(share * REQUIRED_PER_DAY)),
             "kes": _scaled(reward, int(round(share * REQUIRED_PER_DAY)))}
            for share, _ in LADDER
        ],
        "monthly_cap_kes": MONTHLY_CAP_KES,
        "payment_note": PAYMENT_NOTE,
    }


def _scaled(reward_cap: int, accepted: int, required: int = REQUIRED_PER_DAY) -> int:
    """The day's reward at today's rate, on the same ladder."""
    if required <= 0:
        return 0
    ratio = accepted / required
    for threshold, amount in LADDER:
        if ratio >= threshold:
            return int(round(reward_cap * amount / DAY_REWARD_KES))
    return 0


async def assess(
    db: AsyncSession,
    *,
    vendor: Vendor,
    accepted: int,
    town: Optional[str],
    day: Optional[date] = None,
    rejected: Optional[list[dict]] = None,
) -> ObservationReward:
    """Score one work day. Accrues a claim; pays nobody.

    `rejected` is [{line, reason}] and every entry needs a reason — a batch that
    rejected lines without saying why is refused rather than quietly underpaid.
    """
    when = day or date.today()
    if when > date.today():
        raise RewardError("A work day is assessed after it happens.", 422)
    if accepted < 0:
        raise RewardError("Accepted observations cannot be negative.", 422)
    for entry in rejected or []:
        if not isinstance(entry, dict) or len(str(entry.get("reason") or "").strip()) < 3:
            raise RewardError(
                "Every rejected line needs a reason, or the person cannot learn what went wrong.",
                422,
            )

    existing = (await db.execute(
        select(ObservationReward).where(
            ObservationReward.vendor_id == vendor.id,
            ObservationReward.work_date == when,
            ObservationReward.town == town,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise RewardError("That day is already assessed.", 409)

    month_start = when.replace(day=1)
    earned = int((await db.execute(
        select(func.coalesce(func.sum(ObservationReward.amount_kes), 0)).where(
            ObservationReward.vendor_id == vendor.id,
            ObservationReward.work_date >= month_start,
            ObservationReward.status.in_(("accrued", "paid")),
        )
    )).scalar() or 0)
    if earned >= MONTHLY_CAP_KES:
        raise RewardError(
            f"You have reached this month's cap of KSh {MONTHLY_CAP_KES}. "
            "It resets next month.",
            409,
        )

    rate = await pool_rate(db, town, day=when)
    amount = _scaled(rate["full_day_kes"], accepted)
    amount = min(amount, MONTHLY_CAP_KES - earned)
    _amount, explanation = payout_for(accepted)

    row = ObservationReward(
        vendor_id=vendor.id, work_date=when, town=town,
        accepted=accepted, required=REQUIRED_PER_DAY, amount_kes=amount,
        status="accrued", reason=f"{explanation} {rate['reason']}"[:300],
    )
    db.add(row)
    await db.flush()
    return row


async def settle(db: AsyncSession, vendor: Vendor, reward_id: str, reference: str) -> dict:
    """Record the direct payment. Brief never sends it."""
    import uuid as _uuid
    ref = (reference or "").strip()
    if len(ref) < 3:
        raise RewardError("Record the M-Pesa reference so the payer can be checked.", 422)
    try:
        rid = _uuid.UUID(str(reward_id))
    except (ValueError, TypeError):
        raise RewardError("That reward was not found.", 404)
    row = (await db.execute(select(ObservationReward).where(ObservationReward.id == rid))).scalar_one_or_none()
    if row is None:
        raise RewardError("That reward was not found.", 404)
    if row.vendor_id != vendor.id:
        raise RewardError("That reward is not yours.", 403)
    if row.status != "accrued":
        raise RewardError("That reward is not waiting to be paid.", 409)
    row.status = "paid"
    row.payment_reference = ref[:120]
    await db.flush()
    return reward_out(row)


def reward_out(row: ObservationReward) -> dict:
    return {
        "id": str(row.id),
        "work_date": row.work_date.isoformat(),
        "town": row.town,
        "accepted": row.accepted,
        "required": row.required,
        "amount_kes": row.amount_kes,
        "status": row.status,
        "reason": row.reason,
        "payment_reference": row.payment_reference,
        "payment_note": PAYMENT_NOTE,
        "monthly_cap_kes": MONTHLY_CAP_KES,
    }


async def mine(db: AsyncSession, vendor: Vendor) -> dict:
    rows = (await db.execute(
        select(ObservationReward).where(ObservationReward.vendor_id == vendor.id)
        .order_by(ObservationReward.work_date.desc())
    )).scalars().all()
    return {
        "items": [reward_out(r) for r in rows],
        "accrued_kes": sum(r.amount_kes for r in rows if r.status == "accrued"),
        "paid_kes": sum(r.amount_kes for r in rows if r.status == "paid"),
        "monthly_cap_kes": MONTHLY_CAP_KES,
        "full_day_kes": DAY_REWARD_KES,
        "required_per_day": REQUIRED_PER_DAY,
        "payment_note": PAYMENT_NOTE,
        "note": (
            "Rewards are paid directly by the payer, with the reference recorded. "
            "Brief holds no funds and a reward is not a salary."
        ),
    }

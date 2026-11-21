"""Merit service: gather facts, compute, snapshot, export.

The rule this module keeps: **it computes, it never decides.** Every fact comes
from a table that records something that happened, and `rules.compute()` turns
those facts into a number. Nothing here reads a plan, a subscription, a payment
or an operator's opinion, and nothing here can raise a score directly — the only
ways to move it are to deliver an order, get a document checked, keep receipts,
collect prices, be vouched for, or mentor somebody.

Money: this module has no ledger, no balance and no payout. `_snapshot()` writes
a score; it never writes an amount.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.receipts import Receipt
from app.models.stock import MovementStatus, StockMovement
from app.models.vendor import Vendor
from app.modules.intake.models import MarketObservation
from app.modules.merit import rules
from app.modules.merit.models import (
    MENTORSHIP_MILESTONES, Mentorship, MeritSnapshot, TrustEndorsement,
)
from app.modules.merit.rules import Facts, MeritError
from app.modules.routine.models import RoutineCompletion
from app.modules.standing.models import BusinessClaim, ClaimStatus
from app.modules.trust.models import TrustBranch

#: Endorsements are weighted on the endorser's score band, not their raw number,
#: so a single point of difference does not change what a word is worth.
RECENT_DAYS = 90


# ── reading the record ───────────────────────────────────────────────────────

async def _fulfilment(db: AsyncSession, vendor_id) -> dict:
    """What this business actually delivered, as a supplier and as a buyer."""
    row = (await db.execute(
        select(
            func.count().filter(StockMovement.status == MovementStatus.RECEIVED.value),
            func.count().filter(StockMovement.status == MovementStatus.CANCELLED.value),
            func.max(StockMovement.created_at),
        ).where(StockMovement.from_vendor_id == vendor_id)
    )).one()
    delivered, cancelled, latest = int(row[0] or 0), int(row[1] or 0), row[2]

    buyer_cancellations = int((await db.execute(
        select(func.count()).where(
            StockMovement.to_vendor_id == vendor_id,
            StockMovement.status == MovementStatus.CANCELLED.value,
        )
    )).scalar() or 0)

    first = (await db.execute(
        select(func.min(StockMovement.created_at)).where(
            StockMovement.from_vendor_id == vendor_id
        )
    )).scalar()

    return {
        "movements_completed": delivered,
        "movements_cancelled": cancelled,
        "buyer_cancellations": buyer_cancellations,
        "latest": latest,
        "first": first,
    }


async def _verification(db: AsyncSession, vendor_id) -> dict:
    """Only a human check counts. A declared document is not evidence."""
    claims = int((await db.execute(
        select(func.count()).select_from(BusinessClaim).where(
            BusinessClaim.vendor_id == vendor_id,
            BusinessClaim.status == ClaimStatus.VERIFIED,
        )
    )).scalar() or 0)
    branches = int((await db.execute(
        select(func.count()).select_from(TrustBranch).where(
            TrustBranch.vendor_id == vendor_id,
            TrustBranch.status == "active",
            TrustBranch.verification_level > 0,
        )
    )).scalar() or 0)
    latest = (await db.execute(
        select(func.max(BusinessClaim.verified_at)).where(
            BusinessClaim.vendor_id == vendor_id,
            BusinessClaim.status == ClaimStatus.VERIFIED,
        )
    )).scalar()
    return {"verified_claims": claims, "verified_branches": branches, "latest": latest}


async def _receipts(db: AsyncSession, vendor_id) -> dict:
    """Distinct *days* with a verified receipt. Ten receipts in one afternoon
    is a shopping trip; ten days is a business."""
    rows = (await db.execute(
        select(func.count(func.distinct(func.date(Receipt.scanned_at))),
               func.count(),
               func.max(Receipt.scanned_at))
        .where(Receipt.vendor_id == vendor_id, Receipt.status == "verified")
    )).one()
    return {
        "receipt_days": int(rows[0] or 0),
        "receipt_verified": int(rows[1] or 0),
        "latest": rows[2],
    }


async def _price_work(db: AsyncSession, vendor_id) -> dict:
    cutoff = datetime.utcnow() - timedelta(days=RECENT_DAYS)
    accepted = int((await db.execute(
        select(func.count()).select_from(MarketObservation).where(
            MarketObservation.reported_by == vendor_id,
            MarketObservation.status == "confirmed",
            MarketObservation.created_at >= cutoff,
        )
    )).scalar() or 0)
    return {"price_accepted": accepted}


async def _mentoring(db: AsyncSession, vendor_id) -> dict:
    as_mentor = (await db.execute(
        select(Mentorship).where(
            Mentorship.mentor_vendor_id == vendor_id,
            Mentorship.status.in_(("active", "completed")),
        )
    )).scalars().all()
    awards = sum(
        1 for m in as_mentor
        for key in (m.milestones or {})
        if key in MENTORSHIP_MILESTONES
    )
    as_mentee = (await db.execute(
        select(Mentorship).where(
            Mentorship.mentee_vendor_id == vendor_id,
            Mentorship.status.in_(("active", "completed")),
        )
    )).scalars().all()
    uplift = sum(float(m.uplift_granted or 0) for m in as_mentee)
    return {"mentoring_awards": awards, "mentor_uplift": min(uplift, rules.MENTOR_UPLIFT_CAP)}


async def _endorsements(db: AsyncSession, vendor_id) -> dict:
    rows = (await db.execute(
        select(TrustEndorsement).where(
            TrustEndorsement.subject_vendor_id == vendor_id,
            TrustEndorsement.status == "active",
        )
    )).scalars().all()
    # Sum of stored weights, then damped: the eleventh endorsement should not
    # be worth what the second was.
    total = sum(float(r.weight or 0) for r in rows)
    return {
        "endorsements": rules.damp_weight(total, rules.MAX_ENDORSEMENTS),
        "endorsers": len(rows),
        "latest": max((r.created_at for r in rows), default=None),
    }


async def _streak(db: AsyncSession, vendor_id, *, as_of: date) -> int:
    """Consecutive weeks with at least one recorded routine day.

    A streak is a fact, not a score. It unlocks perks; it does not add points,
    because "opened the app" is the easiest thing in the world to fake.
    """
    since = as_of - timedelta(days=7 * 14)
    days = [d for (d,) in (await db.execute(
        select(RoutineCompletion.day).where(
            RoutineCompletion.vendor_id == vendor_id, RoutineCompletion.day >= since
        ).distinct()
    )).all()]
    return rules.streak_weeks(days, as_of=as_of)


def _as_date(value) -> Optional[date]:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


async def facts_for(db: AsyncSession, vendor: Vendor, *, as_of: date) -> Facts:
    """Every fact the score may read, gathered in one pass."""
    fulfilment = await _fulfilment(db, vendor.id)
    verification = await _verification(db, vendor.id)
    receipts = await _receipts(db, vendor.id)
    prices = await _price_work(db, vendor.id)
    mentoring = await _mentoring(db, vendor.id)
    endorsements = await _endorsements(db, vendor.id)

    stamps = [fulfilment["latest"], fulfilment["first"], verification["latest"],
              receipts["latest"], endorsements["latest"]]
    stamps = [s for s in stamps if s is not None]

    return Facts(
        movements_completed=fulfilment["movements_completed"],
        movements_cancelled=fulfilment["movements_cancelled"],
        buyer_cancellations=fulfilment["buyer_cancellations"],
        verified_claims=verification["verified_claims"],
        verified_branches=verification["verified_branches"],
        receipt_days=receipts["receipt_days"],
        receipt_verified=receipts["receipt_verified"],
        price_accepted=prices["price_accepted"],
        endorsements=endorsements["endorsements"],
        endorsers=endorsements["endorsers"],
        mentoring_awards=mentoring["mentoring_awards"],
        mentor_uplift=mentoring["mentor_uplift"],
        last_activity=_as_date(max(stamps)) if stamps else None,
        first_activity=_as_date(min(stamps)) if stamps else None,
        active_week_streak=await _streak(db, vendor.id, as_of=as_of),
    )


# ── computing and recording ──────────────────────────────────────────────────

async def score(db: AsyncSession, vendor: Vendor, *, as_of: Optional[date] = None,
                record: bool = True) -> rules.Merit:
    """The current score. `record=True` writes today's snapshot (idempotent)."""
    day = as_of or date.today()
    facts = await facts_for(db, vendor, as_of=day)
    merit = rules.compute(facts, as_of=day)
    if record:
        await _snapshot(db, vendor.id, day, merit)
    return merit


async def _snapshot(db: AsyncSession, vendor_id, day: date, merit: rules.Merit) -> MeritSnapshot:
    """One row per business per day. Recomputing updates it, never duplicates."""
    row = (await db.execute(
        select(MeritSnapshot).where(
            MeritSnapshot.vendor_id == vendor_id, MeritSnapshot.as_of == day
        )
    )).scalar_one_or_none()
    payload = merit.as_dict()
    if row is None:
        row = MeritSnapshot(
            vendor_id=vendor_id, as_of=day, score=round(merit.score, 2),
            score_earned=round(merit.score_earned, 2), tier=merit.tier,
            families=merit.families, decay=round(merit.decay, 3),
            breakdown=payload, version=merit.version, input_hash=merit.input_hash,
        )
        db.add(row)
    else:
        row.score = round(merit.score, 2)
        row.score_earned = round(merit.score_earned, 2)
        row.tier = merit.tier
        row.families = merit.families
        row.decay = round(merit.decay, 3)
        row.breakdown = payload
        row.input_hash = merit.input_hash
    await db.flush()
    return row


async def card(db: AsyncSession, vendor: Vendor, *, as_of: Optional[date] = None) -> dict:
    """What the public page and the owner's card both render."""
    day = as_of or date.today()
    merit = await score(db, vendor, as_of=day)
    streak = (await facts_for(db, vendor, as_of=day)).active_week_streak
    return {
        **merit.as_dict(),
        "streak_weeks": streak,
        "streak_perks": rules.streak_perks(streak),
        "discovery_weight": rules.discovery_weight(merit.score),
        "tiers": [
            {"key": key, "label": rules.TIER_LABELS[key], "unlocks": list(rules.UNLOCKS[key])}
            for key in rules.TIERS
        ],
        "how_to_move_up": _next_steps(merit),
    }


def _next_steps(merit: rules.Merit) -> list[str]:
    """The cheapest honest road up, in the business's own words."""
    steps = []
    weakest = sorted(
        (c for c in merit.components if c.key in rules.FAMILIES),
        key=lambda c: c.points / max(c.max_points, 1),
    )
    for component in weakest[:2]:
        if component.max_points and component.points >= component.max_points * 0.9:
            continue
        steps.append(f"{component.label}: {component.reason}")
    if merit.decay < 1.0:
        steps.append(
            "Record one thing this week and the score returns to what you earned — "
            "nothing was lost, it is only hidden while the business is quiet."
        )
    return steps


# ── the ticker: a short public history ───────────────────────────────────────

async def ticker(db: AsyncSession, vendor_id, *, days: int = 30) -> dict:
    """Score over time, for the public page's sparkline.

    Deliberately sparse and rate-limited at write time (one row a day), so this
    is a record of what was true, not a livestream of a number changing.
    """
    since = date.today() - timedelta(days=max(1, min(days, 180)))
    rows = (await db.execute(
        select(MeritSnapshot).where(
            MeritSnapshot.vendor_id == vendor_id, MeritSnapshot.as_of >= since
        ).order_by(MeritSnapshot.as_of)
    )).scalars().all()
    return {
        "points": [
            {"as_of": r.as_of.isoformat(), "score": r.score, "tier": r.tier}
            for r in rows
        ],
        "note": "One reading a day at most. A score is a record, not a live price.",
    }


# ── endorsements ─────────────────────────────────────────────────────────────

async def endorse(db: AsyncSession, endorser: Vendor, *, handle: str, reason: str,
                  context: Optional[str] = None) -> TrustEndorsement:
    """One business vouches for another, in writing and in its own name."""
    reason = (reason or "").strip()
    if len(reason) < 10:
        raise MeritError("Say what they did. An endorsement without a reason is a rating.",
                         status=422)
    subject = (await db.execute(
        select(Vendor).where(Vendor.vendor_handle == handle.lstrip("@").lower())
    )).scalar_one_or_none()
    if subject is None:
        raise MeritError("No business with that handle.", status=404)
    if subject.id == endorser.id:
        raise MeritError("You cannot vouch for yourself.", status=422)

    existing = (await db.execute(
        select(TrustEndorsement).where(
            TrustEndorsement.endorser_vendor_id == endorser.id,
            TrustEndorsement.subject_vendor_id == subject.id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise MeritError("You have already vouched for this business.", status=409)

    mine = await score(db, endorser, record=False)
    row = TrustEndorsement(
        endorser_vendor_id=endorser.id,
        subject_vendor_id=subject.id,
        endorser_score=round(mine.score, 2),
        weight=rules.weighted_endorsement(mine.score),
        reason=reason[:2000],
        context=(context or None),
        status="active",
    )
    db.add(row)
    await db.flush()
    return row


async def withdraw_endorsement(db: AsyncSession, endorser: Vendor,
                               endorsement_id: str) -> TrustEndorsement:
    row = (await db.execute(
        select(TrustEndorsement).where(TrustEndorsement.id == _uuid(endorsement_id))
    )).scalar_one_or_none()
    if row is None or row.endorser_vendor_id != endorser.id:
        raise MeritError("No endorsement of yours with that id.", status=404)
    if row.status == "withdrawn":
        return row
    row.status = "withdrawn"
    row.withdrawn_at = datetime.utcnow()
    await db.flush()
    return row


async def endorsements_for(db: AsyncSession, vendor_id) -> dict:
    given = (await db.execute(
        select(TrustEndorsement, Vendor).join(
            Vendor, Vendor.id == TrustEndorsement.endorser_vendor_id
        ).where(TrustEndorsement.subject_vendor_id == vendor_id,
                TrustEndorsement.status == "active")
        .order_by(TrustEndorsement.created_at.desc())
    )).all()
    return {
        "endorsements": [
            {"id": str(row.id), "reason": row.reason, "context": row.context,
             "weight": row.weight, "created_at": row.created_at.isoformat(),
             "from": {"handle": v.vendor_handle, "name": v.business_name}}
            for row, v in given
        ],
        "note": ("An endorsement is a named business saying what it saw. It is worth "
                 "what that business's own record is worth, and it is never money."),
    }


# ── mentorship ───────────────────────────────────────────────────────────────

async def start_mentorship(db: AsyncSession, mentor: Vendor, *, handle: str,
                           note: Optional[str] = None) -> Mentorship:
    """A Blue Chip business takes a newcomer on. The asymmetry is the point."""
    mine = await score(db, mentor, record=False)
    if mine.tier != rules.TIER_BLUE_CHIP:
        raise MeritError(
            "Mentoring is for Blue Chip businesses. It opens at a score of "
            f"{rules.BLUE_CHIP_AT:g} with evidence in at least "
            f"{rules.BLUE_CHIP_MIN_FAMILIES} areas — you are at {round(mine.score, 1)}.",
            status=403,
        )
    mentee = (await db.execute(
        select(Vendor).where(Vendor.vendor_handle == handle.lstrip("@").lower())
    )).scalar_one_or_none()
    if mentee is None:
        raise MeritError("No business with that handle.", status=404)
    if mentee.id == mentor.id:
        raise MeritError("You cannot mentor yourself.", status=422)

    theirs = await score(db, mentee, record=False)
    if theirs.tier == rules.TIER_BLUE_CHIP:
        raise MeritError("That business is already Blue Chip; it does not need a mentor.",
                         status=422)

    open_ones = int((await db.execute(
        select(func.count()).select_from(Mentorship).where(
            Mentorship.mentor_vendor_id == mentor.id, Mentorship.status == "active"
        )
    )).scalar() or 0)
    if open_ones >= 2:
        raise MeritError(
            "Two mentees at a time, no more. A mentor with a list is recruiting, "
            "not mentoring.", status=409,
        )

    existing = (await db.execute(
        select(Mentorship).where(
            Mentorship.mentor_vendor_id == mentor.id,
            Mentorship.mentee_vendor_id == mentee.id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise MeritError("You already mentor that business.", status=409)

    row = Mentorship(
        mentor_vendor_id=mentor.id, mentee_vendor_id=mentee.id,
        status="active", milestones={}, uplift_granted=0.0,
        note=(note or None),
    )
    db.add(row)
    await db.flush()
    return row


async def record_milestone(db: AsyncSession, mentor: Vendor, mentorship_id: str,
                           milestone: str) -> dict:
    """A mentee hit something real. It pays the mentor and lifts the mentee.

    Both sides are capped: the mentor by `MAX_MENTORING_AWARDS`, the mentee by
    `MENTOR_UPLIFT_CAP`. A mentor cannot mint a score for a friend, and a
    newcomer cannot buy their way into looking verified.
    """
    if milestone not in MENTORSHIP_MILESTONES:
        raise MeritError(f"Milestones are: {', '.join(MENTORSHIP_MILESTONES)}.", status=422)
    row = (await db.execute(
        select(Mentorship).where(Mentorship.id == _uuid(mentorship_id))
    )).scalar_one_or_none()
    if row is None or row.mentor_vendor_id != mentor.id:
        raise MeritError("No mentorship of yours with that id.", status=404)
    if row.status != "active":
        raise MeritError("That mentorship has ended.", status=409)
    if milestone in (row.milestones or {}):
        raise MeritError("That milestone is already recorded.", status=409)

    milestones = dict(row.milestones or {})
    milestones[milestone] = datetime.utcnow().isoformat()
    row.milestones = milestones

    # The mentee's uplift: a slice of one milestone's worth, and never above the
    # published cap for its whole life.
    uplift = min(rules.MENTOR_AWARD_PER_MILESTONE * 0.6,
                 max(rules.MENTOR_UPLIFT_CAP - float(row.uplift_granted or 0), 0.0))
    row.uplift_granted = float(row.uplift_granted or 0) + uplift

    if all(m in milestones for m in MENTORSHIP_MILESTONES):
        row.status = "completed"

    await db.flush()
    return {
        "id": str(row.id),
        "milestone": milestone,
        "milestones": list(milestones),
        "status": row.status,
        "mentee_uplift_granted": round(row.uplift_granted, 2),
        "mentee_uplift_cap": rules.MENTOR_UPLIFT_CAP,
        "mentor_award": rules.MENTOR_AWARD_PER_MILESTONE,
        "note": ("Both sides are capped on purpose. Mentoring can lift a newcomer "
                 "toward the first tier; it can never carry them to Blue Chip."),
    }


async def my_mentorships(db: AsyncSession, vendor: Vendor) -> dict:
    as_mentor = (await db.execute(
        select(Mentorship, Vendor).join(Vendor, Vendor.id == Mentorship.mentee_vendor_id)
        .where(Mentorship.mentor_vendor_id == vendor.id)
        .order_by(Mentorship.created_at.desc())
    )).all()
    as_mentee = (await db.execute(
        select(Mentorship, Vendor).join(Vendor, Vendor.id == Mentorship.mentor_vendor_id)
        .where(Mentorship.mentee_vendor_id == vendor.id)
        .order_by(Mentorship.created_at.desc())
    )).all()
    return {
        "mentoring": [
            {"id": str(m.id), "status": m.status, "milestones": sorted((m.milestones or {})),
             "mentee_uplift_granted": round(float(m.uplift_granted or 0), 2),
             "mentee": {"handle": v.vendor_handle, "name": v.business_name}}
            for m, v in as_mentor
        ],
        "mentored_by": [
            {"id": str(m.id), "status": m.status, "milestones": sorted((m.milestones or {})),
             "uplift_granted": round(float(m.uplift_granted or 0), 2),
             "mentor": {"handle": v.vendor_handle, "name": v.business_name}}
            for m, v in as_mentee
        ],
        "milestones_available": list(MENTORSHIP_MILESTONES),
        "cap_note": (
            f"A mentee's combined uplift is capped at {rules.MENTOR_UPLIFT_CAP:g} points — "
            "below the second tier, by design."
        ),
    }


# ── the concierge and the pattern report ─────────────────────────────────────

async def concierge(db: AsyncSession, vendor: Vendor) -> dict:
    """What a Blue Chip business can actually reach, from what already exists.

    Every introduction here is to something the platform already has — live
    requests from bulk buyers, published event briefs, verified suppliers in the
    directory. Nothing is invented, and nothing is a promise about trade
    volume: it is a queue position, not a contract.
    """
    merit = await score(db, vendor)
    if merit.tier != rules.TIER_BLUE_CHIP:
        return {
            "tier": merit.tier,
            "available": False,
            "why": (
                f"Concierge opens at Blue Chip ({rules.BLUE_CHIP_AT:g} points with evidence "
                f"in {rules.BLUE_CHIP_MIN_FAMILIES} areas). You are at {round(merit.score, 1)}."
            ),
            "to_open": [
                f"{c.label}: {c.reason}" for c in merit.components
                if c.key in rules.FAMILIES and c.points < c.max_points
            ][:3],
        }
    return {
        "tier": merit.tier,
        "available": True,
        "places": 3,
        "note": ("Three live introductions at a time, refreshed weekly. A queue "
                 "position, not a promise of trade."),
        "how_it_works": (
            "Brief puts your name in front of bulk buyers and event organisers it "
            "already has on file. They contact you directly; Brief takes no part in "
            "the deal and no share of it."
        ),
    }


async def pattern_report(db: AsyncSession, vendor: Vendor) -> dict:
    """The exportable record, for a bank or a SACCO to read.

    This is the mechanism that keeps Brief out of lending. We do not score
    creditworthiness, we do not opine on repayment, and we do not carry the
    number to anyone: we hand the business a document about its own history and
    the business decides who sees it. Whatever a bank then decides, it decides
    under its own licence with its own money.
    """
    merit = await score(db, vendor)
    facts = await facts_for(db, vendor, as_of=date.today())
    return {
        "subject": {
            "handle": vendor.vendor_handle,
            "name": vendor.business_name,
            "account_kind": vendor.account_kind,
            "location": getattr(vendor, "physical_location", None),
        },
        "period": {
            "from": facts.first_activity.isoformat() if facts.first_activity else None,
            "to": facts.last_activity.isoformat() if facts.last_activity else None,
        },
        "facts": {
            "supplier_orders_delivered": facts.movements_completed,
            "supplier_orders_cancelled": facts.movements_cancelled,
            "buyer_orders_cancelled": facts.buyer_cancellations,
            "documents_verified": facts.verified_claims,
            "shops_verified": facts.verified_branches,
            "days_with_verified_receipts": facts.receipt_days,
            "accepted_price_observations_90d": facts.price_accepted,
            "endorsements": facts.endorsers,
            "mentees_brought_along": facts.mentoring_awards,
        },
        "score": merit.as_dict(),
        "notes": rules.report_notes(facts, merit),
        "disclaimer": rules.REPORT_DISCLAIMER,
        "exported_at": datetime.utcnow().isoformat(),
        "is_credit_score": False,
        "is_credit_report": False,
    }


async def scores_for(db: AsyncSession, vendor_ids) -> dict:
    """{vendor_id: latest score} for the feed's trust term, in one query.

    The latest snapshot per business, not a fresh computation: ranking a page
    of forty items must not trigger forty fact-gathering passes. A business with
    no snapshot yet is simply absent, and `ranking.trust_signal` reads that as
    zero — no record, no nudge, no penalty.
    """
    ids = [i for i in vendor_ids if i]
    if not ids:
        return {}
    from sqlalchemy import func as _func
    newest = (
        select(MeritSnapshot.vendor_id, _func.max(MeritSnapshot.as_of).label("day"))
        .where(MeritSnapshot.vendor_id.in_(ids))
        .group_by(MeritSnapshot.vendor_id)
        .subquery()
    )
    rows = (await db.execute(
        select(MeritSnapshot.vendor_id, MeritSnapshot.score).join(
            newest,
            (MeritSnapshot.vendor_id == newest.c.vendor_id)
            & (MeritSnapshot.as_of == newest.c.day),
        )
    )).all()
    return {str(vid): float(score) for vid, score in rows}


async def leaderboard(db: AsyncSession, *, limit: int = 10) -> dict:
    """The best records in the network — published, and deliberately narrow.

    Only the latest snapshot per business, only businesses above the first
    tier, and names only. No shillings, because a league table of money is how
    a merit system becomes a debt market.
    """
    latest = (await db.execute(
        select(MeritSnapshot).where(MeritSnapshot.tier != "seed")
        .order_by(MeritSnapshot.score.desc()).limit(max(1, min(limit, 50)))
    )).scalars().all()
    rows = []
    seen = set()
    for snap in latest:
        if snap.vendor_id in seen:
            continue
        seen.add(snap.vendor_id)
        vendor = await db.get(Vendor, snap.vendor_id)
        if vendor is None:
            continue
        rows.append({
            "handle": vendor.vendor_handle,
            "name": vendor.business_name,
            "score": snap.score,
            "tier": snap.tier,
            "tier_label": rules.TIER_LABELS.get(snap.tier, snap.tier),
        })
    return {
        "items": rows[:limit],
        "note": "Names and records only. This is never a list of who has the most money.",
    }


def _uuid(value: str):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise MeritError("No record with that id.", status=404)

"""Deterministic, auditable governance and benefit calculations (no AI, no money movement)."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.governance import (
    CouncilTerm, GovernanceAuditEvent, GovernanceProposal, GovernanceVote, VendorActivityDay,
)
from app.models.vendor import Vendor

MARKET_TZ = ZoneInfo("Africa/Nairobi")


def add_audit_event(
    db: AsyncSession, *, actor_type: str, actor_id, action: str, entity_type: str,
    entity_id, previous_state: dict | None = None, new_state: dict | None = None,
    reason_code: str | None = None, explanation: str | None = None,
) -> GovernanceAuditEvent:
    event = GovernanceAuditEvent(
        actor_type=actor_type, actor_id=actor_id, action=action,
        entity_type=entity_type, entity_id=entity_id, previous_state=previous_state,
        new_state=new_state, reason_code=reason_code, explanation=explanation,
    )
    db.add(event)
    return event


async def vote_eligibility(db: AsyncSession, vendor: Vendor, *, scope: str, zone_id=None, now: datetime | None = None) -> dict:
    """Return explicit reasons; voting never relies on score, volume or voice activity."""
    now = now or datetime.utcnow()
    local_today = now.replace(tzinfo=ZoneInfo("UTC")).astimezone(MARKET_TZ).date()
    first_day = local_today - timedelta(days=59)
    active_days = int((await db.execute(
        select(func.count(VendorActivityDay.id)).where(
            VendorActivityDay.vendor_id == vendor.id,
            VendorActivityDay.local_day >= first_day,
            VendorActivityDay.local_day <= local_today,
        )
    )).scalar_one())
    reasons = []
    if vendor.phone_verified_at is None:
        reasons.append("Verify your phone number before voting.")
    if not vendor.joined_at or vendor.joined_at > now - timedelta(days=30):
        reasons.append("Your account must be at least 30 days old.")
    if active_days < 5:
        reasons.append("Be active on five distinct days in the last 60 days.")
    if vendor.fraud_suspended_at is not None:
        reasons.append("Voting is paused during a reviewed fraud suspension.")
    if scope == "zone" and (vendor.market_zone_id is None or vendor.market_zone_id != zone_id):
        reasons.append("You must be assigned to this market zone to vote on its proposals.")
    return {
        "eligible": not reasons, "reasons": reasons, "phone_verified": vendor.phone_verified_at is not None,
        "account_age_days": max(0, (now - vendor.joined_at).days) if vendor.joined_at else 0,
        "active_days_last_60": active_days, "zone_match": scope != "zone" or vendor.market_zone_id == zone_id,
    }


async def _eligible_count(db: AsyncSession, proposal: GovernanceProposal, now: datetime) -> int:
    local_today = now.replace(tzinfo=ZoneInfo("UTC")).astimezone(MARKET_TZ).date()
    active_vendor_ids = (
        select(VendorActivityDay.vendor_id)
        .where(VendorActivityDay.local_day >= local_today - timedelta(days=59), VendorActivityDay.local_day <= local_today)
        .group_by(VendorActivityDay.vendor_id)
        .having(func.count(VendorActivityDay.id) >= 5)
    )
    query = select(func.count(Vendor.id)).where(
        Vendor.phone_verified_at.is_not(None),
        Vendor.fraud_suspended_at.is_(None),
        Vendor.joined_at <= now - timedelta(days=30),
        Vendor.id.in_(active_vendor_ids),
    )
    if proposal.scope == "zone":
        query = query.where(Vendor.market_zone_id == proposal.zone_id)
    return int((await db.execute(query)).scalar_one() or 0)


async def proposal_results(db: AsyncSession, proposal: GovernanceProposal, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    eligible = await _eligible_count(db, proposal, now)
    counts = {choice: int((await db.execute(
        select(func.count(GovernanceVote.id)).where(
            GovernanceVote.proposal_id == proposal.id, GovernanceVote.vote == choice,
        )
    )).scalar_one() or 0) for choice in ("yes", "no", "abstain")}
    participants = sum(counts.values())
    quorum = participants / eligible if eligible else 0.0
    approval_denominator = counts["yes"] + counts["no"]
    approval = counts["yes"] / approval_denominator if approval_denominator else 0.0
    quorum_met = eligible > 0 and quorum >= proposal.quorum_required
    approval_met = approval_denominator > 0 and approval >= proposal.approval_required
    return {
        "eligible_voters": eligible, "participants": participants, "quorum_met": quorum_met,
        "yes": counts["yes"], "no": counts["no"], "abstain": counts["abstain"],
        "approval_rate": round(approval, 4), "quorum_rate": round(quorum, 4),
        "approval_required": proposal.approval_required, "quorum_required": proposal.quorum_required,
        "result": ("passed" if quorum_met and approval_met else "rejected") if now >= proposal.closes_at else "open",
        "implementation_status": "pending" if now >= proposal.closes_at and quorum_met and approval_met else "not_authorized",
    }


async def advance_proposal(db: AsyncSession, proposal: GovernanceProposal, now: datetime | None = None) -> dict:
    """Open scheduled proposals and finalize at close; no proposal auto-executes its JSON payload."""
    now = now or datetime.utcnow()
    if proposal.status == "draft" and proposal.opens_at <= now:
        proposal.status = "open"
        add_audit_event(
            db, actor_type="system", actor_id=None, action="proposal_opened",
            entity_type="governance_proposal", entity_id=proposal.id,
            previous_state={"status": "draft"}, new_state={"status": "open"},
            reason_code="SCHEDULED_OPEN", explanation="Proposal opened at its published start time.",
        )
    if proposal.status == "open" and proposal.closes_at <= now:
        result = await proposal_results(db, proposal, now)
        proposal.status = result["result"]
        add_audit_event(
            db, actor_type="system", actor_id=None, action="proposal_finalized",
            entity_type="governance_proposal", entity_id=proposal.id,
            previous_state={"status": "open"}, new_state={"status": proposal.status, "result": result},
            reason_code="VOTING_CLOSED", explanation="Result calculated from one-vendor-one-vote ballots and the published quorum.",
        )
        return result
    return await proposal_results(db, proposal, now)


async def process_due_proposals(db: AsyncSession, now: datetime | None = None) -> int:
    now = now or datetime.utcnow()
    rows = (await db.execute(select(GovernanceProposal).where(
        ((GovernanceProposal.status == "draft") & (GovernanceProposal.opens_at <= now))
        | ((GovernanceProposal.status == "open") & (GovernanceProposal.closes_at <= now))
    ).with_for_update(skip_locked=True))).scalars().all()
    for proposal in rows:
        await advance_proposal(db, proposal, now)
    terms = (await db.execute(select(CouncilTerm).where(
        ((CouncilTerm.status == "scheduled") & (CouncilTerm.starts_at <= now))
        | ((CouncilTerm.status == "active") & (CouncilTerm.ends_at <= now))
    ).with_for_update(skip_locked=True))).scalars().all()
    for term in terms:
        previous = {"status": term.status}
        term.status = "active" if term.starts_at <= now < term.ends_at else "completed"
        add_audit_event(
            db, actor_type="system", actor_id=None,
            action="council_term_activated" if term.status == "active" else "council_term_completed",
            entity_type="council_term", entity_id=term.id, previous_state=previous,
            new_state={"status": term.status}, reason_code="PUBLISHED_TERM_DATES",
            explanation="Council status advanced according to the elected term's published dates.",
        )
    return len(rows) + len(terms)


def cap_monthly_governance_participation(monthly_counts: dict[tuple[str, int, int], Decimal | int | float], monthly_cap: int = 4) -> dict[str, Decimal]:
    """Cap valid governance participation separately in each calendar month."""
    capped: dict[str, Decimal] = {}
    for (vendor_id, _year, _month), amount in monthly_counts.items():
        value = min(max(Decimal(str(amount)), Decimal(0)), Decimal(monthly_cap))
        capped[vendor_id] = capped.get(vendor_id, Decimal(0)) + value
    return capped


def calculate_vendor_weights(metrics: dict[str, dict[str, Decimal | int | float]]) -> dict[str, dict[str, float]]:
    """Normalize verified period signals, then apply the published 50/20/15/15 weights."""
    kinds = ("fulfilled_purchase", "verified_peer_help", "governance_participation", "reliability")
    normalized: dict[str, dict[str, Decimal]] = {}
    for vendor_id, values in metrics.items():
        normalized[vendor_id] = {kind: Decimal(str(values.get(kind, 0) or 0)) for kind in kinds}
    totals = {kind: sum((values[kind] for values in normalized.values()), Decimal(0)) for kind in kinds}
    weights = {"fulfilled_purchase": Decimal("0.50"), "verified_peer_help": Decimal("0.20"), "governance_participation": Decimal("0.15"), "reliability": Decimal("0.15")}
    result = {}
    for vendor_id, values in normalized.items():
        shares = {kind: (values[kind] / totals[kind] if totals[kind] else Decimal(0)) for kind in kinds}
        final = sum((weights[kind] * shares[kind] for kind in kinds), Decimal(0))
        result[vendor_id] = {
            "fulfilled_purchase_share": float(shares["fulfilled_purchase"]),
            "verified_peer_help_share": float(shares["verified_peer_help"]),
            "governance_participation_share": float(shares["governance_participation"]),
            "reliability_share": float(shares["reliability"]),
            "final_weight": float(final),
        }
    return result

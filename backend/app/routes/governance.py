"""Vendor proposals, voting, published rules, appeals and benefit statements.

The module records evidence and governance outcomes. It never holds funds, sends
payments, determines loan eligibility, or automatically applies proposal JSON.
"""

import calendar
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
from typing import Literal, Optional
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.governance import (
    AllocationPolicy, BenefitPeriod, BiasharaScoreEvent, CouncilTerm, DualApprovalRequest,
    GovernanceAuditEvent, GovernanceProposal, GovernanceVote, NetworkBenefitEvent,
    RevenueEvent, RuleVersion, VendorAppeal, VendorBenefitAllocation,
    VendorCreditLedger, VendorDataConsent, VendorActivityDay,
)
from app.models.market_locks import MarketZone
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.governance import (
    add_audit_event, advance_proposal, calculate_vendor_weights, cap_monthly_governance_participation,
    proposal_results, vote_eligibility,
)

router = APIRouter()
MARKET_TZ = ZoneInfo("Africa/Nairobi")
PURPOSE_CLASSES = {
    "lender_profile_sharing": "financial_restricted",
    "aggregate_market_research": "aggregated_anonymous",
    "voice_reuse": "voice_private",
    "promotional_story": "public",
}
REVENUE_TYPES = {"supplier_facilitation_fee", "logistics_fee", "subscription", "sponsored_placement", "financial_referral", "market_report"}
BENEFIT_METRICS = {"fulfilled_purchase", "verified_peer_help", "reliability"}  # governance is recorded from eligible votes


def require_governance_ops(*roles: str):
    async def dependency(vendor: Vendor = Depends(get_current_vendor)) -> Vendor:
        role = settings.market_ops_role(vendor.vendor_handle)
        if role not in roles:
            raise HTTPException(403, "This governance operations action is not available to your account")
        return vendor
    return dependency


class ProposalCreate(BaseModel):
    title: str = Field(min_length=8, max_length=200)
    summary: str = Field(min_length=20, max_length=3000)
    scope: Literal["zone", "platform"] = "zone"
    authority: Literal["advisory", "operationally_binding", "board_recommendation", "cooperative_member_vote"] = "advisory"
    zone_id: Optional[UUID] = None
    proposed_changes: dict = Field(default_factory=dict)
    opens_at: Optional[datetime] = None
    closes_at: datetime
    quorum_required: float = Field(default=0.20, ge=0, le=1)
    approval_required: float = Field(default=0.60, ge=0, le=1)
    legal_entity_id: Optional[UUID] = None
    legal_basis: Optional[str] = Field(None, max_length=500)

    @field_validator("opens_at", "closes_at", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value


class VoteInput(BaseModel):
    vote: Literal["yes", "no", "abstain"]


class ConsentInput(BaseModel):
    granted: bool
    expires_at: Optional[datetime] = None
    consent_reference: Optional[str] = Field(None, min_length=4, max_length=100)

    @field_validator("expires_at", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value


class AppealCreate(BaseModel):
    subject_type: Literal["account_suspension", "score_event", "no_show", "moderation", "benefit", "supplier_quality", "other"]
    subject_id: Optional[UUID] = None
    appeal_text: str = Field(min_length=20, max_length=4000)


class AppealResolution(BaseModel):
    status: Literal["acknowledged", "under_review", "upheld", "partially_reversed", "reversed"]
    reason_code: str = Field(min_length=3, max_length=80)
    resolution_note: str = Field(min_length=10, max_length=3000)


class CouncilTermCreate(BaseModel):
    zone_id: UUID
    representative_id: UUID
    alternate_id: Optional[UUID] = None
    starts_at: datetime
    ends_at: datetime
    election_proposal_id: UUID
    conflict_disclosure: str = Field(min_length=10, max_length=2000)

    @field_validator("starts_at", "ends_at", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value


class CouncilRecall(BaseModel):
    proposal_id: UUID
    reason_code: str = Field(min_length=3, max_length=80)
    explanation: str = Field(min_length=20, max_length=2000)


class RevenueInput(BaseModel):
    source_type: Literal["supplier_facilitation_fee", "logistics_fee", "subscription", "sponsored_placement", "financial_referral", "market_report"]
    source_reference: str = Field(min_length=4, max_length=200)
    gross_amount_ksh: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    payment_fees_ksh: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    recognized_at: datetime
    evidence_note: str = Field(min_length=10, max_length=2000)

    @field_validator("recognized_at", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    @model_validator(mode="after")
    def validate_net(self):
        if self.payment_fees_ksh > self.gross_amount_ksh:
            raise ValueError("Payment fees cannot exceed gross realized revenue")
        return self


class AllocationPolicyInput(BaseModel):
    operations_rate: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)
    vendor_pool_rate: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)
    local_ops_rate: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)
    dispute_reserve_rate: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)
    training_fund_rate: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)
    effective_from: datetime
    governance_proposal_id: UUID
    reason_code: str = Field(min_length=3, max_length=80)
    explanation: str = Field(min_length=20, max_length=2000)

    @field_validator("effective_from", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    @model_validator(mode="after")
    def rates_sum_to_one(self):
        rates = (self.operations_rate, self.vendor_pool_rate, self.local_ops_rate, self.dispute_reserve_rate, self.training_fund_rate)
        if sum(rates, Decimal(0)) != Decimal(1):
            raise ValueError("Allocation policy rates must sum exactly to 1.0000")
        return self


class BenefitEventInput(BaseModel):
    vendor_id: UUID
    metric_type: Literal["fulfilled_purchase", "verified_peer_help", "reliability"]
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    source_type: str = Field(min_length=3, max_length=80)
    source_reference: str = Field(min_length=4, max_length=200)
    evidence_note: str = Field(min_length=10, max_length=2000)
    event_at: datetime

    @field_validator("event_at", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    @model_validator(mode="after")
    def validate_metric(self):
        if self.metric_type == "reliability" and self.amount > 1:
            raise ValueError("Reliability evidence is normalized to a value from 0 to 1")
        if self.metric_type == "verified_peer_help" and self.amount != self.amount.to_integral_value():
            raise ValueError("Verified peer-help evidence must be a whole count")
        return self


class BenefitPeriodInput(BaseModel):
    starts_at: datetime
    ends_at: datetime
    distribution_method: Literal["group_buy_credit", "logistics_credit", "training_credit"] = "group_buy_credit"

    @field_validator("starts_at", "ends_at", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value


class RuleVersionInput(BaseModel):
    configuration: dict
    effective_from: datetime
    governance_proposal_id: UUID
    reason_code: str = Field(min_length=3, max_length=80)
    explanation: str = Field(min_length=20, max_length=2000)

    @field_validator("effective_from", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    @model_validator(mode="after")
    def validate_configuration(self):
        events = self.configuration.get("events") if isinstance(self.configuration, dict) else None
        required = {"pick_completed", "verified_stock_save", "accepted_peer_answer", "vendor_no_show", "confirmed_spam"}
        if not isinstance(events, dict) or not required.issubset(events):
            raise ValueError("Score rules must include the published event set")
        if any(not isinstance(value, int) for value in events.values()):
            raise ValueError("Score event values must be whole-number points")
        if self.configuration.get("decay_days") != 180:
            raise ValueError("The current score window is 180 days; changes require a separate reviewed rule design")
        tiers = self.configuration.get("tiers", {})
        if any(tiers.get(key) != value for key, value in {"listener": 0, "poster": 20, "organizer": 60, "lender_eligible": 120}.items()):
            raise ValueError("Current score tiers must remain explicit: 0, 20, 60 and 120")
        dimensions = self.configuration.get("dimension_weights", {})
        if set(dimensions) != {"fulfillment", "peer_help", "conduct", "activity"} or sum(Decimal(str(value)) for value in dimensions.values()) != Decimal(1):
            raise ValueError("Dimension weights must cover the four published dimensions and sum to one")
        if self.configuration.get("uses_ai") or self.configuration.get("predictive_model"):
            raise ValueError("Score rules cannot enable AI or predictive decisions")
        if set(self.configuration.get("penalizable_vendor_failures", [])) - {"VENDOR_NO_SHOW"}:
            raise ValueError("Only a verified VENDOR_NO_SHOW may be score-penalizable")
        return self


class DualApprovalDecision(BaseModel):
    approve: bool
    reason_code: str = Field(min_length=3, max_length=80)
    explanation: str = Field(min_length=10, max_length=2000)


def _utc_naive(value: datetime | None, default: datetime | None = None) -> datetime | None:
    if value is None:
        return default
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def _proposal_out(proposal: GovernanceProposal, eligibility: dict | None = None, own_vote: str | None = None) -> dict:
    return {
        "id": str(proposal.id), "title": proposal.title, "summary": proposal.summary,
        "scope": proposal.scope, "authority": proposal.authority, "zone_id": str(proposal.zone_id) if proposal.zone_id else None,
        "created_by_vendor_id": str(proposal.created_by_vendor_id) if proposal.created_by_vendor_id else None,
        "rule_version_before": proposal.rule_version_before, "proposed_changes": proposal.proposed_changes,
        "opens_at": _iso(proposal.opens_at), "closes_at": _iso(proposal.closes_at),
        "quorum_required": proposal.quorum_required, "approval_required": proposal.approval_required,
        "status": proposal.status, "implementation_note": proposal.implementation_note,
        "implemented_at": _iso(proposal.implemented_at), "legal_basis": proposal.legal_basis,
        "eligibility": eligibility, "vendor_vote": own_vote,
    }


async def _proposal_access(db: AsyncSession, vendor: Vendor, proposal: GovernanceProposal) -> None:
    if proposal.scope == "zone" and proposal.zone_id != vendor.market_zone_id:
        if settings.market_ops_role(vendor.vendor_handle) not in {"admin", "clerk"}:
            raise HTTPException(404, "Proposal not found")


def _proposal_counts(results: dict) -> dict:
    return {key: results[key] for key in (
        "eligible_voters", "participants", "quorum_met", "yes", "no", "abstain",
        "approval_rate", "quorum_rate", "approval_required", "quorum_required", "result", "implementation_status",
    )}


@router.get("/proposals")
async def list_proposals(
    scope: Optional[Literal["zone", "platform"]] = None,
    status: Optional[str] = Query(None, pattern="^(draft|open|passed|rejected|implemented|expired|cancelled)$"),
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    query = select(GovernanceProposal)
    if scope:
        query = query.where(GovernanceProposal.scope == scope)
    if vendor.market_zone_id is None or settings.market_ops_role(vendor.vendor_handle) not in {"admin", "clerk"}:
        query = query.where((GovernanceProposal.scope == "platform") | (GovernanceProposal.zone_id == vendor.market_zone_id))
        query = query.where(GovernanceProposal.status != "draft")
    if status:
        query = query.where(GovernanceProposal.status == status)
    proposals = (await db.execute(query.order_by(GovernanceProposal.closes_at).limit(100))).scalars().all()
    response = []
    for proposal in proposals:
        await advance_proposal(db, proposal)
        eligibility = await vote_eligibility(db, vendor, scope=proposal.scope, zone_id=proposal.zone_id)
        own_vote = (await db.execute(select(GovernanceVote.vote).where(
            GovernanceVote.proposal_id == proposal.id, GovernanceVote.vendor_id == vendor.id,
        ))).scalar_one_or_none()
        response.append(_proposal_out(proposal, eligibility, own_vote))
    await db.commit()
    return response


@router.post("/proposals", status_code=201)
async def create_proposal(data: ProposalCreate, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    opens_at = _utc_naive(data.opens_at, now)
    closes_at = _utc_naive(data.closes_at)
    if closes_at is None or closes_at <= now or opens_at >= closes_at:
        raise HTTPException(400, "Proposal close time must be in the future and after its open time")
    role = settings.market_ops_role(vendor.vendor_handle)
    if data.scope == "zone":
        zone_id = data.zone_id or vendor.market_zone_id
        if zone_id is None or zone_id != vendor.market_zone_id:
            raise HTTPException(403, "Zone proposals must be for your assigned market zone")
        zone = await db.get(MarketZone, zone_id)
        if not zone or not zone.is_active:
            raise HTTPException(404, "Active market zone not found")
    else:
        if role != "admin":
            raise HTTPException(403, "Only an authorized platform admin may open a platform proposal")
        zone_id = None
    if data.authority in {"operationally_binding", "board_recommendation"} and role != "admin":
        raise HTTPException(403, "Only an authorized admin may label a proposal binding or a board recommendation")
    if data.authority in {"operationally_binding", "board_recommendation"} and not data.legal_basis:
        raise HTTPException(400, "State the legal/operational basis before using this authority label")
    if data.authority == "cooperative_member_vote":
        if not settings.GOVERNANCE_COOPERATIVE_ENABLED or not settings.GOVERNANCE_LEGAL_BASIS or not data.legal_basis:
            raise HTTPException(400, "Cooperative member votes are disabled until a registered entity and legal basis are configured")
    proposal = GovernanceProposal(
        title=data.title.strip(), summary=data.summary.strip(), scope=data.scope,
        authority=data.authority, zone_id=zone_id, created_by_vendor_id=vendor.id,
        proposed_changes=data.proposed_changes, opens_at=opens_at, closes_at=closes_at,
        quorum_required=data.quorum_required, approval_required=data.approval_required,
        status="open" if opens_at <= now else "draft", legal_entity_id=data.legal_entity_id,
        legal_basis=data.legal_basis.strip() if data.legal_basis else None,
    )
    db.add(proposal)
    await db.flush()
    add_audit_event(db, actor_type="vendor" if role is None else "admin", actor_id=vendor.id,
                    action="proposal_created", entity_type="governance_proposal", entity_id=proposal.id,
                    new_state={"scope": proposal.scope, "authority": proposal.authority, "status": proposal.status},
                    reason_code="VENDOR_PROPOSAL", explanation="Proposal submitted; proposed JSON is not automatically executed.")
    await db.commit()
    return _proposal_out(proposal)


@router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    proposal = await db.get(GovernanceProposal, proposal_id, with_for_update=True)
    if not proposal:
        raise HTTPException(404, "Proposal not found")
    await _proposal_access(db, vendor, proposal)
    await advance_proposal(db, proposal)
    eligibility = await vote_eligibility(db, vendor, scope=proposal.scope, zone_id=proposal.zone_id)
    own_vote = (await db.execute(select(GovernanceVote.vote).where(
        GovernanceVote.proposal_id == proposal.id, GovernanceVote.vendor_id == vendor.id,
    ))).scalar_one_or_none()
    await db.commit()
    return _proposal_out(proposal, eligibility, own_vote)


@router.post("/proposals/{proposal_id}/votes")
async def cast_vote(proposal_id: UUID, data: VoteInput, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    proposal = await db.get(GovernanceProposal, proposal_id, with_for_update=True)
    if not proposal:
        raise HTTPException(404, "Proposal not found")
    await _proposal_access(db, vendor, proposal)
    now = datetime.utcnow()
    if proposal.status != "open" or proposal.opens_at > now or proposal.closes_at <= now:
        raise HTTPException(409, "This proposal is not currently accepting votes")
    eligibility = await vote_eligibility(db, vendor, scope=proposal.scope, zone_id=proposal.zone_id, now=now)
    if not eligibility["eligible"]:
        raise HTTPException(403, {"message": "You are not eligible to vote yet", "reasons": eligibility["reasons"]})
    vote = (await db.execute(select(GovernanceVote).where(
        GovernanceVote.proposal_id == proposal.id, GovernanceVote.vendor_id == vendor.id,
    ).with_for_update())).scalar_one_or_none()
    previous = {"vote": vote.vote} if vote else None
    first_vote = vote is None
    if vote:
        vote.vote = data.vote
        vote.eligibility_snapshot = eligibility
        vote.updated_at = now
    else:
        vote = GovernanceVote(
            proposal_id=proposal.id, vendor_id=vendor.id, vote=data.vote, voting_weight=1,
            eligibility_snapshot=eligibility,
        )
        db.add(vote)
        await db.flush()
        db.add(NetworkBenefitEvent(
            vendor_id=vendor.id, metric_type="governance_participation", amount=1,
            source_type="valid_governance_vote", source_reference=str(proposal.id),
            evidence_note="Eligible, one-vendor-one-vote ballot recorded.",
            verified_by_vendor_id=vendor.id, event_at=now,
        ))
    add_audit_event(db, actor_type="vendor", actor_id=vendor.id,
                    action="vote_created" if first_vote else "vote_changed", entity_type="governance_vote",
                    entity_id=vote.id, previous_state=previous, new_state={"vote": data.vote, "weight": 1},
                    reason_code="ELIGIBLE_VENDOR_BALLOT", explanation="Ballot is one vendor, one vote; changes remain auditable.")
    await db.commit()
    return {"proposal_id": str(proposal.id), "vote": data.vote, "voting_weight": 1, "changed_until": _iso(proposal.closes_at)}


@router.get("/proposals/{proposal_id}/results")
async def get_results(proposal_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    proposal = await db.get(GovernanceProposal, proposal_id, with_for_update=True)
    if not proposal:
        raise HTTPException(404, "Proposal not found")
    await _proposal_access(db, vendor, proposal)
    result = await advance_proposal(db, proposal)
    await db.commit()
    return {"proposal_id": str(proposal.id), **_proposal_counts(result), "status": proposal.status}


@router.get("/council")
async def list_council_terms(zone_id: Optional[UUID] = None, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    target_zone = zone_id or vendor.market_zone_id
    if target_zone is None:
        return []
    if target_zone != vendor.market_zone_id and settings.market_ops_role(vendor.vendor_handle) not in {"admin", "clerk"}:
        raise HTTPException(403, "Council terms are zone-visible only")
    rows = (await db.execute(select(CouncilTerm).where(CouncilTerm.zone_id == target_zone).order_by(CouncilTerm.starts_at.desc()).limit(20))).scalars().all()
    out = []
    for row in rows:
        representative = await db.get(Vendor, row.representative_id)
        alternate = await db.get(Vendor, row.alternate_id) if row.alternate_id else None
        out.append({
            "id": str(row.id), "zone_id": str(row.zone_id), "representative_handle": representative.vendor_handle if representative else None,
            "representative_name": representative.business_name if representative else None,
            "alternate_handle": alternate.vendor_handle if alternate else None,
            "starts_at": _iso(row.starts_at), "ends_at": _iso(row.ends_at), "status": row.status,
            "conflict_disclosure": row.conflict_disclosure, "election_proposal_id": str(row.election_proposal_id) if row.election_proposal_id else None,
            "consecutive_term_number": row.consecutive_term_number,
        })
    return out


def _add_calendar_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


@router.post("/ops/council-terms", status_code=201)
async def create_council_term(data: CouncilTermCreate, staff: Vendor = Depends(require_governance_ops("admin")), db: AsyncSession = Depends(get_db)):
    zone = await db.get(MarketZone, data.zone_id)
    representative = await db.get(Vendor, data.representative_id)
    alternate = await db.get(Vendor, data.alternate_id) if data.alternate_id else None
    election = await db.get(GovernanceProposal, data.election_proposal_id)
    starts_at, ends_at = _utc_naive(data.starts_at), _utc_naive(data.ends_at)
    if not zone or not zone.is_active or not representative or representative.market_zone_id != zone.id or representative.phone_verified_at is None:
        raise HTTPException(400, "Representative must be phone-verified and assigned to the active zone")
    if data.alternate_id and (not alternate or alternate.market_zone_id != zone.id or alternate.phone_verified_at is None):
        raise HTTPException(400, "Alternate must be phone-verified and assigned to the active zone")
    if data.alternate_id == data.representative_id:
        raise HTTPException(400, "Representative and alternate must be different vendors")
    if not election or election.scope != "zone" or election.zone_id != zone.id or election.status not in {"passed", "implemented"}:
        raise HTTPException(400, "A passed zone election proposal is required before creating a council term")
    changes = election.proposed_changes or {}
    if str(changes.get("representative_id")) != str(representative.id) or str(changes.get("alternate_id") or "") != str(data.alternate_id or ""):
        raise HTTPException(400, "The term slate must match the passed election proposal")
    if ends_at <= starts_at or ends_at <= datetime.utcnow() or starts_at < datetime.utcnow() - timedelta(minutes=1) or ends_at > _add_calendar_months(starts_at, 6):
        raise HTTPException(400, "Council terms must be current/future and cannot exceed six months")
    overlap = (await db.execute(select(CouncilTerm.id).where(
        CouncilTerm.zone_id == zone.id, CouncilTerm.status.in_(("scheduled", "active")),
        CouncilTerm.starts_at < ends_at, CouncilTerm.ends_at > starts_at,
    ).limit(1))).scalar_one_or_none()
    if overlap:
        raise HTTPException(409, "Another council term overlaps this zone and time window")
    previous = (await db.execute(select(CouncilTerm).where(
        CouncilTerm.zone_id == zone.id, CouncilTerm.representative_id == representative.id,
        CouncilTerm.status.in_(("scheduled", "active", "completed")),
    ).order_by(CouncilTerm.ends_at.desc()).limit(1))).scalar_one_or_none()
    term_number = 1
    if previous and abs((starts_at - previous.ends_at).total_seconds()) <= 86400:
        term_number = previous.consecutive_term_number + 1
        if term_number > 2:
            raise HTTPException(409, "A representative cannot serve more than two consecutive terms")
    status = "active" if starts_at <= datetime.utcnow() else "scheduled"
    term = CouncilTerm(
        zone_id=zone.id, representative_id=representative.id, alternate_id=alternate.id if alternate else None,
        starts_at=starts_at, ends_at=ends_at, status=status, conflict_disclosure=data.conflict_disclosure.strip(),
        election_proposal_id=election.id, consecutive_term_number=term_number,
    )
    db.add(term)
    await db.flush()
    add_audit_event(db, actor_type="admin", actor_id=staff.id, action="council_term_created",
                    entity_type="council_term", entity_id=term.id,
                    new_state={"zone_id": str(zone.id), "representative_id": str(representative.id), "status": status},
                    reason_code="PASSED_ZONE_ELECTION", explanation="Term created from a passed public zone election proposal.")
    await db.commit()
    return {"id": str(term.id), "status": term.status, "starts_at": _iso(term.starts_at), "ends_at": _iso(term.ends_at)}


@router.post("/ops/council-terms/{term_id}/recall")
async def recall_council_term(term_id: UUID, data: CouncilRecall, staff: Vendor = Depends(require_governance_ops("admin")), db: AsyncSession = Depends(get_db)):
    term = await db.get(CouncilTerm, term_id, with_for_update=True)
    proposal = await db.get(GovernanceProposal, data.proposal_id)
    if not term or term.status != "active":
        raise HTTPException(404, "Active council term not found")
    if not proposal or proposal.scope != "zone" or proposal.zone_id != term.zone_id or proposal.status not in {"passed", "implemented"}:
        raise HTTPException(409, "A passed recall proposal from the representative's zone is required")
    changes = proposal.proposed_changes or {}
    if changes.get("action") != "recall_council" or str(changes.get("council_term_id")) != str(term.id):
        raise HTTPException(409, "Recall proposal does not match this council term")
    previous = {"status": term.status}
    term.status = "recalled"
    add_audit_event(db, actor_type="admin", actor_id=staff.id, action="council_term_recalled",
                    entity_type="council_term", entity_id=term.id, previous_state=previous,
                    new_state={"status": term.status, "proposal_id": str(proposal.id)},
                    reason_code=data.reason_code, explanation=data.explanation.strip())
    await db.commit()
    return {"id": str(term.id), "status": term.status}


@router.get("/rules/biashara-score")
async def published_score_rules(db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    rule = (await db.execute(select(RuleVersion).where(
        RuleVersion.rule_group == "biashara_score", RuleVersion.effective_from <= now,
        (RuleVersion.effective_until.is_(None) | (RuleVersion.effective_until > now)),
    ).order_by(RuleVersion.version.desc()).limit(1))).scalar_one_or_none()
    if not rule:
        return {"active": False, "message": "No score rule is active."}
    return {"active": True, "rule_group": rule.rule_group, "version": rule.version,
            "configuration": rule.configuration, "effective_from": _iso(rule.effective_from)}


@router.get("/score/me")
async def my_score(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    events = (await db.execute(select(BiasharaScoreEvent).where(
        BiasharaScoreEvent.vendor_id == vendor.id,
        BiasharaScoreEvent.created_at >= now - timedelta(days=180),
    ).order_by(BiasharaScoreEvent.created_at.desc()).limit(200))).scalars().all()
    rules = await published_score_rules(db)
    return {
        "score": sum(event.points for event in events), "window_days": 180,
        "dimensions": {"fulfillment": None, "peer_help": None, "conduct": None, "activity": None},
        "dimension_note": "Dimension scores remain unpopulated until the related verified event sources are connected.",
        "events": [{"id": str(event.id), "event_type": event.event_type, "points": event.points,
                    "failure_cause": event.failure_cause, "explanation": event.explanation,
                    "created_at": _iso(event.created_at)} for event in events],
        "rules": rules,
    }


@router.get("/benefits/me")
async def my_benefits(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    ledger_rows = (await db.execute(select(VendorCreditLedger.transaction_type, VendorCreditLedger.amount_ksh).where(
        VendorCreditLedger.vendor_id == vendor.id,
    ))).all()
    signed = sum((Decimal(amount) if kind == "credit_issued" else -Decimal(amount) for kind, amount in ledger_rows), Decimal(0))
    allocations = (await db.execute(
        select(VendorBenefitAllocation, BenefitPeriod)
        .join(BenefitPeriod, BenefitPeriod.id == VendorBenefitAllocation.benefit_period_id)
        .where(VendorBenefitAllocation.vendor_id == vendor.id,
               BenefitPeriod.status.in_(("review", "approved", "distributed")),
               VendorBenefitAllocation.status.in_(("calculated", "approved", "issued")))
        .order_by(BenefitPeriod.ends_at.desc()).limit(12)
    )).all()
    pending = sum((Decimal(allocation.allocated_amount_ksh) for allocation, period in allocations if period.status == "review"), Decimal(0))
    latest = allocations[0][0] if allocations else None
    components = None if not latest else {
        "fulfilled_purchases": float(latest.fulfilled_purchase_score),
        "verified_peer_help": float(latest.verified_help_score),
        "governance_participation": float(latest.governance_score),
        "reliability": float(latest.reliability_score),
    }
    return {
        "available_credit_ksh": str(max(signed, Decimal(0)).quantize(Decimal("0.01"))),
        "pending_estimate_ksh": str(pending.quantize(Decimal("0.01"))),
        "components": components,
        "period": str(allocations[0][1].id) if allocations else None,
        "pool_status": allocations[0][1].status if allocations else "not_configured",
        "disclaimer": "Credits are not cash, deposits, savings, dividends, shares, or investments. Estimates are not spendable until a legally reviewed credit programme exists.",
    }


@router.get("/benefits/allocation-policy")
async def public_allocation_policy(db: AsyncSession = Depends(get_db)):
    policy = (await db.execute(select(AllocationPolicy).where(
        AllocationPolicy.status == "approved", AllocationPolicy.effective_from <= datetime.utcnow(),
        (AllocationPolicy.effective_until.is_(None) | (AllocationPolicy.effective_until > datetime.utcnow())),
    ).order_by(AllocationPolicy.version.desc()).limit(1))).scalar_one_or_none()
    if not policy:
        return {"active": False, "message": "No allocation policy is active; example percentages are not a promise."}
    return {"active": True, "version": policy.version, "rates": {
        "operations": str(policy.operations_rate), "vendor_pool": str(policy.vendor_pool_rate),
        "local_ops": str(policy.local_ops_rate), "dispute_reserve": str(policy.dispute_reserve_rate),
        "training_fund": str(policy.training_fund_rate),
    }, "effective_from": _iso(policy.effective_from), "status": policy.status}


@router.get("/consents")
async def list_consents(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    records = (await db.execute(select(VendorDataConsent).where(VendorDataConsent.vendor_id == vendor.id).order_by(VendorDataConsent.purpose))).scalars().all()
    by_purpose = {row.purpose: row for row in records}
    return [{"purpose": purpose, "data_class": data_class,
             "granted": by_purpose[purpose].granted if purpose in by_purpose else False,
             "expires_at": _iso(by_purpose[purpose].expires_at) if purpose in by_purpose else None}
            for purpose, data_class in PURPOSE_CLASSES.items()]


@router.put("/consents/{purpose}")
async def set_consent(purpose: str, data: ConsentInput, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    if purpose not in PURPOSE_CLASSES:
        raise HTTPException(404, "Consent purpose not found")
    now = datetime.utcnow()
    expires_at = _utc_naive(data.expires_at)
    if data.granted and (expires_at is None or expires_at <= now or expires_at > now + timedelta(days=90)):
        raise HTTPException(400, "Consent must have an expiry within 90 days")
    consent = (await db.execute(select(VendorDataConsent).where(
        VendorDataConsent.vendor_id == vendor.id, VendorDataConsent.purpose == purpose,
    ).with_for_update())).scalar_one_or_none()
    previous = {"granted": consent.granted, "expires_at": _iso(consent.expires_at)} if consent else {"granted": False}
    if consent is None:
        consent = VendorDataConsent(vendor_id=vendor.id, purpose=purpose, data_class=PURPOSE_CLASSES[purpose],
                                    granted=data.granted, granted_at=now if data.granted else None,
                                    revoked_at=None if data.granted else now, expires_at=expires_at if data.granted else None,
                                    consent_reference=data.consent_reference or str(uuid4()))
        db.add(consent)
    else:
        consent.granted = data.granted
        consent.data_class = PURPOSE_CLASSES[purpose]
        consent.granted_at = now if data.granted else consent.granted_at
        consent.revoked_at = None if data.granted else now
        consent.expires_at = expires_at if data.granted else None
        consent.consent_reference = data.consent_reference or str(uuid4())
        consent.updated_at = now
    await db.flush()
    add_audit_event(db, actor_type="vendor", actor_id=vendor.id, action="data_consent_changed",
                    entity_type="vendor_data_consent", entity_id=consent.id, previous_state=previous,
                    new_state={"purpose": purpose, "data_class": consent.data_class, "granted": consent.granted, "expires_at": _iso(consent.expires_at)},
                    reason_code="SEPARATE_EXPLICIT_CONSENT", explanation="Consent is purpose-specific, time-limited and independently revocable.")
    await db.commit()
    return {"purpose": purpose, "data_class": consent.data_class, "granted": consent.granted,
            "expires_at": _iso(consent.expires_at), "consent_reference": consent.consent_reference}


@router.post("/appeals", status_code=201)
async def submit_appeal(data: AppealCreate, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    appeal = VendorAppeal(vendor_id=vendor.id, subject_type=data.subject_type,
                          subject_id=data.subject_id, appeal_text=data.appeal_text.strip(), status="submitted")
    db.add(appeal)
    await db.flush()
    add_audit_event(db, actor_type="vendor", actor_id=vendor.id, action="appeal_submitted",
                    entity_type="vendor_appeal", entity_id=appeal.id, new_state={"status": appeal.status, "subject_type": appeal.subject_type},
                    reason_code="VENDOR_APPEAL", explanation="Appeal entered the human review queue.")
    await db.commit()
    return {"id": str(appeal.id), "status": appeal.status, "created_at": _iso(appeal.created_at)}


@router.get("/appeals/me")
async def my_appeals(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(VendorAppeal).where(VendorAppeal.vendor_id == vendor.id).order_by(VendorAppeal.created_at.desc()).limit(50))).scalars().all()
    return [{"id": str(row.id), "subject_type": row.subject_type, "subject_id": str(row.subject_id) if row.subject_id else None,
             "appeal_text": row.appeal_text, "status": row.status, "resolution_note": row.resolution_note,
             "created_at": _iso(row.created_at), "resolved_at": _iso(row.resolved_at)} for row in rows]


@router.get("/ops/appeals")
async def ops_appeals(status: Optional[str] = Query(None), staff: Vendor = Depends(require_governance_ops("admin", "clerk")), db: AsyncSession = Depends(get_db)):
    query = select(VendorAppeal).order_by(VendorAppeal.created_at).limit(200)
    if status:
        query = query.where(VendorAppeal.status == status)
    rows = (await db.execute(query)).scalars().all()
    return [{"id": str(row.id), "vendor_id": str(row.vendor_id), "subject_type": row.subject_type,
             "subject_id": str(row.subject_id) if row.subject_id else None, "appeal_text": row.appeal_text,
             "status": row.status, "created_at": _iso(row.created_at)} for row in rows]


@router.post("/ops/appeals/{appeal_id}/resolve")
async def resolve_appeal(appeal_id: UUID, data: AppealResolution, staff: Vendor = Depends(require_governance_ops("admin", "clerk")), db: AsyncSession = Depends(get_db)):
    appeal = await db.get(VendorAppeal, appeal_id, with_for_update=True)
    if not appeal:
        raise HTTPException(404, "Appeal not found")
    if appeal.vendor_id == staff.id:
        raise HTTPException(403, "An operator cannot resolve their own appeal")
    allowed = {
        "submitted": {"acknowledged", "under_review"}, "acknowledged": {"under_review", "upheld", "partially_reversed", "reversed"},
        "under_review": {"upheld", "partially_reversed", "reversed"},
    }
    if data.status not in allowed.get(appeal.status, set()):
        raise HTTPException(409, "Invalid appeal state transition")
    previous = {"status": appeal.status}
    appeal.status = data.status
    appeal.assigned_to_vendor_id = staff.id
    appeal.resolution_note = data.resolution_note.strip()
    appeal.updated_at = datetime.utcnow()
    if data.status in {"upheld", "partially_reversed", "reversed"}:
        appeal.resolved_at = datetime.utcnow()
    await db.flush()
    add_audit_event(db, actor_type="operator" if settings.market_ops_role(staff.vendor_handle) == "clerk" else "admin",
                    actor_id=staff.id, action="appeal_state_changed", entity_type="vendor_appeal", entity_id=appeal.id,
                    previous_state=previous, new_state={"status": appeal.status}, reason_code=data.reason_code,
                    explanation=appeal.resolution_note)
    await db.commit()
    return {"id": str(appeal.id), "status": appeal.status, "resolution_note": appeal.resolution_note}


@router.post("/ops/revenue-events", status_code=201)
async def record_realized_revenue(data: RevenueInput, staff: Vendor = Depends(require_governance_ops("admin")), db: AsyncSession = Depends(get_db)):
    recognized_at = _utc_naive(data.recognized_at)
    if recognized_at > datetime.utcnow() + timedelta(minutes=5):
        raise HTTPException(400, "Revenue recognition time cannot be in the future")
    net = data.gross_amount_ksh - data.payment_fees_ksh
    event = RevenueEvent(
        source_type=data.source_type, source_reference=data.source_reference.strip(),
        gross_amount_ksh=data.gross_amount_ksh, payment_fees_ksh=data.payment_fees_ksh,
        net_amount_ksh=net, recognized_at=recognized_at, evidence_note=data.evidence_note.strip(),
        created_by_vendor_id=staff.id,
    )
    db.add(event)
    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(409, "This realized-revenue reference was already recorded or failed validation") from exc
    add_audit_event(db, actor_type="admin", actor_id=staff.id, action="realized_revenue_recorded",
                    entity_type="revenue_event", entity_id=event.id,
                    new_state={"source_type": event.source_type, "net_amount_ksh": str(net)},
                    reason_code="EXTERNAL_RECEIPT_RECONCILED", explanation=event.evidence_note)
    await db.commit()
    return {"id": str(event.id), "net_amount_ksh": str(event.net_amount_ksh), "recorded": True,
            "payment_processed": False}


@router.post("/ops/benefit-events", status_code=201)
async def record_verified_benefit_event(data: BenefitEventInput, staff: Vendor = Depends(require_governance_ops("admin", "clerk")), db: AsyncSession = Depends(get_db)):
    recipient = await db.get(Vendor, data.vendor_id)
    if not recipient:
        raise HTTPException(404, "Vendor not found")
    event_at = _utc_naive(data.event_at)
    if event_at > datetime.utcnow() + timedelta(minutes=5):
        raise HTTPException(400, "Evidence date cannot be in the future")
    event = NetworkBenefitEvent(
        vendor_id=recipient.id, metric_type=data.metric_type, amount=data.amount,
        source_type=data.source_type.strip(), source_reference=data.source_reference.strip(),
        evidence_note=data.evidence_note.strip(), verified_by_vendor_id=staff.id, event_at=event_at,
    )
    db.add(event)
    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(409, "This evidence reference was already recorded or failed validation") from exc
    add_audit_event(db, actor_type="admin" if settings.market_ops_role(staff.vendor_handle) == "admin" else "operator",
                    actor_id=staff.id, action="benefit_evidence_verified", entity_type="network_benefit_event",
                    entity_id=event.id, new_state={"vendor_id": str(recipient.id), "metric_type": event.metric_type, "amount": str(event.amount)},
                    reason_code="SOURCE_EVIDENCE_REVIEWED", explanation=event.evidence_note)
    await db.commit()
    return {"id": str(event.id), "metric_type": event.metric_type, "status": "verified_evidence_recorded"}


@router.post("/ops/benefit-periods/calculate", status_code=201)
async def calculate_benefit_period(data: BenefitPeriodInput, staff: Vendor = Depends(require_governance_ops("admin")), db: AsyncSession = Depends(get_db)):
    starts_at, ends_at = _utc_naive(data.starts_at), _utc_naive(data.ends_at)
    if ends_at <= starts_at or ends_at > datetime.utcnow():
        raise HTTPException(400, "Benefit period must be a closed, non-empty period")
    policy = (await db.execute(select(AllocationPolicy).where(
        AllocationPolicy.status == "approved", AllocationPolicy.effective_from <= starts_at,
        (AllocationPolicy.effective_until.is_(None) | (AllocationPolicy.effective_until >= ends_at)),
    ).order_by(AllocationPolicy.version.desc()).limit(1))).scalar_one_or_none()
    if not policy:
        raise HTTPException(409, "No approved allocation policy was effective for this period")
    duplicate = (await db.execute(select(BenefitPeriod).where(
        BenefitPeriod.starts_at == starts_at, BenefitPeriod.ends_at == ends_at,
        BenefitPeriod.policy_version == policy.version,
    ))).scalar_one_or_none()
    if duplicate:
        raise HTTPException(409, "This benefit period has already been calculated")
    revenue = (await db.execute(select(func.coalesce(func.sum(RevenueEvent.net_amount_ksh), 0)).where(
        RevenueEvent.recognized_at >= starts_at, RevenueEvent.recognized_at < ends_at,
    ))).scalar_one()
    revenue = Decimal(revenue or 0)
    pool = (revenue * Decimal(policy.vendor_pool_rate)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    evidence = (await db.execute(select(NetworkBenefitEvent).where(
        NetworkBenefitEvent.event_at >= starts_at, NetworkBenefitEvent.event_at < ends_at,
    ))).scalars().all()
    metrics: dict[str, dict[str, Decimal]] = {}
    governance_months: dict[tuple[str, int, int], Decimal] = {}
    for item in evidence:
        vendor_id = str(item.vendor_id)
        if item.metric_type == "governance_participation":
            month_key = (vendor_id, item.event_at.year, item.event_at.month)
            governance_months[month_key] = governance_months.get(month_key, Decimal(0)) + Decimal(item.amount)
            continue
        vendor_metrics = metrics.setdefault(vendor_id, {})
        vendor_metrics[item.metric_type] = vendor_metrics.get(item.metric_type, Decimal(0)) + Decimal(item.amount)
    for vendor_id, amount in cap_monthly_governance_participation(governance_months).items():
        metrics.setdefault(vendor_id, {})["governance_participation"] = amount
    weights = calculate_vendor_weights(metrics)
    positive = {vendor_id: values for vendor_id, values in weights.items() if values["final_weight"] > 0}
    total_weight = sum((Decimal(str(values["final_weight"])) for values in positive.values()), Decimal(0))
    if not revenue or not pool or not positive or not total_weight:
        raise HTTPException(409, "Cannot calculate a benefit estimate: missing realized revenue, approved vendor-pool share, or verified participation evidence")
    period = BenefitPeriod(
        starts_at=starts_at, ends_at=ends_at, policy_version=policy.version,
        eligible_revenue_ksh=revenue, distributable_pool_ksh=pool, status="review",
    )
    db.add(period)
    await db.flush()
    cents = Decimal("0.01")
    created_allocations = []
    vendor_ids = sorted(positive)
    exact_amounts = {vendor_id: pool * Decimal(str(positive[vendor_id]["final_weight"])) / total_weight for vendor_id in vendor_ids}
    allocated_amounts = {vendor_id: exact.quantize(cents, rounding=ROUND_DOWN) for vendor_id, exact in exact_amounts.items()}
    remaining_cents = int((pool - sum(allocated_amounts.values(), Decimal(0))) / cents)
    cent_remainders = sorted(vendor_ids, key=lambda vendor_id: (-(exact_amounts[vendor_id] - allocated_amounts[vendor_id]), vendor_id))
    for vendor_id in cent_remainders[:remaining_cents]:
        allocated_amounts[vendor_id] += cents
    for vendor_id in vendor_ids:
        values = positive[vendor_id]
        amount = allocated_amounts[vendor_id]
        row = VendorBenefitAllocation(
            benefit_period_id=period.id, vendor_id=UUID(vendor_id),
            fulfilled_purchase_score=values["fulfilled_purchase_share"],
            verified_help_score=values["verified_peer_help_share"],
            governance_score=values["governance_participation_share"],
            reliability_score=values["reliability_share"], final_weight=values["final_weight"],
            allocated_amount_ksh=amount, distribution_method=data.distribution_method, status="calculated",
        )
        db.add(row)
        created_allocations.append({"vendor_id": vendor_id, "weight": values["final_weight"], "amount": str(amount)})
    snapshot = {"period": str(period.id), "policy_version": policy.version, "revenue": str(revenue), "pool": str(pool), "allocations": created_allocations}
    period.calculation_hash = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    await db.flush()
    add_audit_event(db, actor_type="admin", actor_id=staff.id, action="benefit_period_calculated",
                    entity_type="benefit_period", entity_id=period.id,
                    new_state={"status": "review", "eligible_revenue_ksh": str(revenue), "pool_ksh": str(pool), "allocation_count": len(created_allocations), "hash": period.calculation_hash},
                    reason_code="ESTIMATE_FOR_HUMAN_REVIEW", explanation="Estimate only; no credits or cash were issued.")
    await db.commit()
    return {"id": str(period.id), "status": period.status, "eligible_revenue_ksh": str(revenue),
            "distributable_pool_ksh": str(pool), "allocation_count": len(created_allocations),
            "calculation_hash": period.calculation_hash, "credits_issued": False}


@router.get("/ops/audit")
async def list_governance_audit(limit: int = Query(100, ge=1, le=500), staff: Vendor = Depends(require_governance_ops("admin", "clerk")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(GovernanceAuditEvent).order_by(GovernanceAuditEvent.created_at.desc()).limit(limit))).scalars().all()
    return [{"id": str(row.id), "actor_type": row.actor_type, "actor_id": str(row.actor_id) if row.actor_id else None,
             "action": row.action, "entity_type": row.entity_type, "entity_id": str(row.entity_id),
             "previous_state": row.previous_state, "new_state": row.new_state, "reason_code": row.reason_code,
             "explanation": row.explanation, "created_at": _iso(row.created_at)} for row in rows]


@router.get("/ops/approvals")
async def list_pending_approvals(staff: Vendor = Depends(require_governance_ops("admin")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(DualApprovalRequest).where(DualApprovalRequest.status == "pending").order_by(DualApprovalRequest.created_at))).scalars().all()
    return [{"id": str(row.id), "action_type": row.action_type, "payload": row.payload,
             "reason_code": row.reason_code, "explanation": row.explanation,
             "requested_by_vendor_id": str(row.requested_by_vendor_id), "created_at": _iso(row.created_at)} for row in rows]


@router.post("/ops/allocation-policy-requests", status_code=201)
async def request_allocation_policy(data: AllocationPolicyInput, staff: Vendor = Depends(require_governance_ops("admin")), db: AsyncSession = Depends(get_db)):
    proposal = await db.get(GovernanceProposal, data.governance_proposal_id)
    if not proposal or proposal.status not in {"passed", "implemented"} or proposal.authority not in {"operationally_binding", "cooperative_member_vote"}:
        raise HTTPException(409, "A passed binding governance proposal is required before changing allocation percentages")
    if not proposal.legal_basis:
        raise HTTPException(409, "The proposal has no recorded legal/operational basis")
    effective_policy_start = _utc_naive(data.effective_from)
    if effective_policy_start is None or effective_policy_start <= datetime.utcnow():
        raise HTTPException(400, "Allocation policy changes must take effect prospectively")
    values = {field: str(getattr(data, field)) for field in (
        "operations_rate", "vendor_pool_rate", "local_ops_rate", "dispute_reserve_rate", "training_fund_rate",
    )}
    payload = {**values, "effective_from": _iso(_utc_naive(data.effective_from)), "governance_proposal_id": str(proposal.id)}
    request = DualApprovalRequest(action_type="allocation_policy", payload=payload,
                                  reason_code=data.reason_code, explanation=data.explanation.strip(),
                                  requested_by_vendor_id=staff.id, status="pending")
    db.add(request)
    await db.flush()
    add_audit_event(db, actor_type="admin", actor_id=staff.id, action="allocation_policy_requested",
                    entity_type="dual_approval_request", entity_id=request.id,
                    new_state={"status": "pending", "proposal_id": str(proposal.id), "rates": values},
                    reason_code=data.reason_code, explanation=data.explanation.strip())
    await db.commit()
    return {"id": str(request.id), "status": request.status, "requires_second_admin": True}


@router.post("/ops/rule-version-requests", status_code=201)
async def request_rule_version(data: RuleVersionInput, staff: Vendor = Depends(require_governance_ops("admin")), db: AsyncSession = Depends(get_db)):
    proposal = await db.get(GovernanceProposal, data.governance_proposal_id)
    if not proposal or proposal.status not in {"passed", "implemented"} or proposal.authority not in {"operationally_binding", "cooperative_member_vote"}:
        raise HTTPException(409, "A passed binding governance proposal is required before changing score rules")
    if not proposal.legal_basis or (proposal.proposed_changes or {}).get("configuration") != data.configuration:
        raise HTTPException(409, "The submitted rule configuration must exactly match the passed proposal and its legal basis")
    effective = _utc_naive(data.effective_from)
    if effective is None or effective <= datetime.utcnow():
        raise HTTPException(400, "Score-rule changes must take effect prospectively")
    payload = {"rule_group": "biashara_score", "configuration": data.configuration,
               "effective_from": _iso(effective), "governance_proposal_id": str(proposal.id)}
    request = DualApprovalRequest(action_type="rule_version", payload=payload,
                                  reason_code=data.reason_code, explanation=data.explanation.strip(),
                                  requested_by_vendor_id=staff.id, status="pending")
    db.add(request)
    await db.flush()
    add_audit_event(db, actor_type="admin", actor_id=staff.id, action="score_rule_change_requested",
                    entity_type="dual_approval_request", entity_id=request.id,
                    new_state={"status": "pending", "proposal_id": str(proposal.id)},
                    reason_code=data.reason_code, explanation=data.explanation.strip())
    await db.commit()
    return {"id": str(request.id), "status": request.status, "requires_second_admin": True}


@router.post("/ops/approvals/{request_id}/decision")
async def decide_approval(request_id: UUID, data: DualApprovalDecision, staff: Vendor = Depends(require_governance_ops("admin")), db: AsyncSession = Depends(get_db)):
    request = await db.get(DualApprovalRequest, request_id, with_for_update=True)
    if not request or request.status != "pending":
        raise HTTPException(404, "Pending approval request not found")
    if request.requested_by_vendor_id == staff.id:
        raise HTTPException(403, "A second, different authorized administrator must review this request")
    request.approved_by_vendor_id = staff.id
    request.reviewed_at = datetime.utcnow()
    previous = {"status": request.status}
    if not data.approve:
        request.status = "rejected"
    elif request.action_type == "allocation_policy":
        payload = request.payload
        effective = datetime.fromisoformat(payload["effective_from"].replace("Z", "+00:00"))
        effective = _utc_naive(effective)
        if effective <= datetime.utcnow():
            raise HTTPException(409, "The proposed effective time passed before the second approval")
        previous_policy = (await db.execute(select(AllocationPolicy).where(
            AllocationPolicy.status == "approved", AllocationPolicy.effective_until.is_(None),
        ).with_for_update())).scalar_one_or_none()
        version = int((await db.execute(select(func.coalesce(func.max(AllocationPolicy.version), 0)))).scalar_one()) + 1
        if previous_policy:
            if effective <= previous_policy.effective_from:
                raise HTTPException(400, "A new allocation policy must take effect after the current one began")
            previous_policy.effective_until = effective
        policy = AllocationPolicy(
            version=version, operations_rate=payload["operations_rate"], vendor_pool_rate=payload["vendor_pool_rate"],
            local_ops_rate=payload["local_ops_rate"], dispute_reserve_rate=payload["dispute_reserve_rate"],
            training_fund_rate=payload["training_fund_rate"], effective_from=effective,
            governance_proposal_id=UUID(payload["governance_proposal_id"]), status="approved",
            created_by_vendor_id=request.requested_by_vendor_id, approved_by_vendor_id=staff.id,
        )
        db.add(policy)
        await db.flush()
        request.status = "applied"
        request.applied_at = datetime.utcnow()
        request.payload = {**payload, "created_policy_id": str(policy.id), "version": version}
    elif request.action_type == "rule_version":
        payload = request.payload
        effective = _utc_naive(datetime.fromisoformat(payload["effective_from"].replace("Z", "+00:00")))
        current_rule = (await db.execute(select(RuleVersion).where(
            RuleVersion.rule_group == "biashara_score", RuleVersion.effective_until.is_(None),
        ).with_for_update())).scalar_one_or_none()
        if effective <= datetime.utcnow() or (current_rule and effective <= current_rule.effective_from):
            raise HTTPException(400, "A score-rule change must take effect prospectively")
        version = int((await db.execute(select(func.coalesce(func.max(RuleVersion.version), 0)).where(RuleVersion.rule_group == "biashara_score"))).scalar_one()) + 1
        if current_rule:
            current_rule.effective_until = effective
        rule = RuleVersion(rule_group="biashara_score", version=version, configuration=payload["configuration"],
                           approved_by_type="dual_admin", approved_by_id=staff.id,
                           effective_from=effective, effective_until=None)
        db.add(rule)
        await db.flush()
        request.status = "applied"
        request.applied_at = datetime.utcnow()
        request.payload = {**payload, "rule_version_id": str(rule.id), "version": version}
    else:
        raise HTTPException(400, "Unsupported dual-approval action")
    add_audit_event(db, actor_type="admin", actor_id=staff.id, action="dual_approval_decided",
                    entity_type="dual_approval_request", entity_id=request.id, previous_state=previous,
                    new_state={"status": request.status, "approved_by_vendor_id": str(staff.id)},
                    reason_code=data.reason_code, explanation=data.explanation.strip())
    await db.commit()
    return {"id": str(request.id), "status": request.status, "applied": request.status == "applied"}

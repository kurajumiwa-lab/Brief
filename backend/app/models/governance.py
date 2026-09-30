"""Transparent vendor governance, rule histories and non-cash benefit accounting.

Timestamps use the app's naive-UTC convention. Nothing here moves or holds money.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Index,
    Integer, Numeric, String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base


class VendorActivityDay(Base):
    """One activity marker per vendor per Nairobi calendar day; requests cannot farm it."""
    __tablename__ = "vendor_activity_days"
    __table_args__ = (UniqueConstraint("vendor_id", "local_day", name="uq_vendor_activity_local_day"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    local_day = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GovernanceProposal(Base):
    __tablename__ = "governance_proposals"
    __table_args__ = (
        CheckConstraint("scope IN ('zone', 'platform')", name="ck_governance_proposal_scope"),
        CheckConstraint("authority IN ('advisory', 'operationally_binding', 'board_recommendation', 'cooperative_member_vote')", name="ck_governance_proposal_authority"),
        CheckConstraint("status IN ('draft', 'open', 'passed', 'rejected', 'implemented', 'expired', 'cancelled')", name="ck_governance_proposal_status"),
        CheckConstraint("(scope = 'zone' AND zone_id IS NOT NULL) OR scope = 'platform'", name="ck_governance_proposal_zone"),
        CheckConstraint("closes_at > opens_at", name="ck_governance_proposal_dates"),
        CheckConstraint("quorum_required >= 0 AND quorum_required <= 1", name="ck_governance_proposal_quorum"),
        CheckConstraint("approval_required >= 0 AND approval_required <= 1", name="ck_governance_proposal_approval"),
        Index("ix_governance_proposals_scope_status", "scope", "zone_id", "status", "closes_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(200), nullable=False)
    summary = Column(Text, nullable=False)
    scope = Column(String(20), nullable=False)
    authority = Column(String(40), nullable=False, default="advisory")
    zone_id = Column(UUID(as_uuid=True), ForeignKey("market_zones.id", ondelete="RESTRICT"), nullable=True, index=True)
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    rule_version_before = Column(String(80), nullable=True)
    proposed_changes = Column(JSONB, nullable=False, default=dict)
    opens_at = Column(DateTime, nullable=False)
    closes_at = Column(DateTime, nullable=False)
    quorum_required = Column(Float, nullable=False, default=0.20)
    approval_required = Column(Float, nullable=False, default=0.60)
    status = Column(String(20), nullable=False, default="draft", server_default="draft")
    implementation_note = Column(Text, nullable=True)
    implemented_at = Column(DateTime, nullable=True)
    legal_entity_id = Column(UUID(as_uuid=True), nullable=True)
    legal_basis = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GovernanceVote(Base):
    __tablename__ = "governance_votes"
    __table_args__ = (
        UniqueConstraint("proposal_id", "vendor_id", name="uq_governance_vote_vendor"),
        CheckConstraint("vote IN ('yes', 'no', 'abstain')", name="ck_governance_vote_choice"),
        CheckConstraint("voting_weight = 1", name="ck_governance_one_vendor_one_vote"),
        Index("ix_governance_votes_proposal_vote", "proposal_id", "vote"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proposal_id = Column(UUID(as_uuid=True), ForeignKey("governance_proposals.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    vote = Column(String(10), nullable=False)
    voting_weight = Column(Numeric(6, 3), nullable=False, default=1)
    eligibility_snapshot = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class CouncilTerm(Base):
    __tablename__ = "council_terms"
    __table_args__ = (
        CheckConstraint("status IN ('scheduled', 'active', 'completed', 'recalled')", name="ck_council_term_status"),
        CheckConstraint("ends_at > starts_at", name="ck_council_term_dates"),
        Index("uq_council_active_zone", "zone_id", unique=True, postgresql_where=text("status = 'active'")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zone_id = Column(UUID(as_uuid=True), ForeignKey("market_zones.id", ondelete="RESTRICT"), nullable=False, index=True)
    representative_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False)
    alternate_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=True)
    starts_at = Column(DateTime, nullable=False)
    ends_at = Column(DateTime, nullable=False)
    status = Column(String(20), nullable=False, default="scheduled")
    conflict_disclosure = Column(Text, nullable=False)
    election_proposal_id = Column(UUID(as_uuid=True), ForeignKey("governance_proposals.id", ondelete="SET NULL"), nullable=True)
    consecutive_term_number = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class RuleVersion(Base):
    __tablename__ = "rule_versions"
    __table_args__ = (UniqueConstraint("rule_group", "version", name="uq_rule_group_version"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_group = Column(String(80), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    configuration = Column(JSONB, nullable=False)
    approved_by_type = Column(String(30), nullable=False)
    approved_by_id = Column(UUID(as_uuid=True), nullable=True)
    effective_from = Column(DateTime, nullable=False)
    effective_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class BiasharaScoreEvent(Base):
    """Append-only score event. Corrections are new reversing/replacement events."""
    __tablename__ = "biashara_score_events"
    __table_args__ = (
        CheckConstraint("points <> 0", name="ck_biashara_score_event_nonzero"),
        UniqueConstraint("vendor_id", "event_type", "reference", name="uq_biashara_score_reference"),
        Index("ix_biashara_score_vendor_date", "vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(60), nullable=False)
    points = Column(Integer, nullable=False)
    reference = Column(String(200), nullable=False)
    rule_version_id = Column(UUID(as_uuid=True), ForeignKey("rule_versions.id", ondelete="RESTRICT"), nullable=False)
    failure_cause = Column(String(50), nullable=True)
    reversed_event_id = Column(UUID(as_uuid=True), ForeignKey("biashara_score_events.id", ondelete="RESTRICT"), nullable=True)
    explanation = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GovernanceAuditEvent(Base):
    """Append-only ledger of governance, operator, consent and benefit actions."""
    __tablename__ = "governance_audit_events"
    __table_args__ = (CheckConstraint("actor_type IN ('vendor', 'operator', 'admin', 'system')", name="ck_governance_audit_actor"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_type = Column(String(20), nullable=False)
    actor_id = Column(UUID(as_uuid=True), nullable=True)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(80), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    previous_state = Column(JSONB, nullable=True)
    new_state = Column(JSONB, nullable=True)
    reason_code = Column(String(80), nullable=True)
    explanation = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


class DualApprovalRequest(Base):
    __tablename__ = "dual_approval_requests"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'approved', 'rejected', 'applied', 'expired')", name="ck_dual_approval_status"),
        Index("ix_dual_approval_status_created", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    action_type = Column(String(80), nullable=False)
    payload = Column(JSONB, nullable=False)
    reason_code = Column(String(80), nullable=False)
    explanation = Column(Text, nullable=False)
    requested_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False)
    approved_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)
    applied_at = Column(DateTime, nullable=True)


class RevenueEvent(Base):
    """Bookkeeping for externally settled platform revenue; not a payment rail."""
    __tablename__ = "revenue_events"
    __table_args__ = (
        UniqueConstraint("source_type", "source_reference", name="uq_revenue_source_reference"),
        CheckConstraint("source_type IN ('supplier_facilitation_fee', 'logistics_fee', 'subscription', 'sponsored_placement', 'financial_referral', 'market_report')", name="ck_revenue_source_type"),
        CheckConstraint("gross_amount_ksh >= 0 AND payment_fees_ksh >= 0 AND net_amount_ksh >= 0", name="ck_revenue_amounts_nonnegative"),
        CheckConstraint("net_amount_ksh = gross_amount_ksh - payment_fees_ksh", name="ck_revenue_net_math"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type = Column(String(40), nullable=False)
    source_reference = Column(String(200), nullable=False)
    gross_amount_ksh = Column(Numeric(14, 2), nullable=False)
    payment_fees_ksh = Column(Numeric(14, 2), nullable=False, default=0)
    net_amount_ksh = Column(Numeric(14, 2), nullable=False)
    recognized_at = Column(DateTime, nullable=False)
    evidence_note = Column(Text, nullable=False)
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class AllocationPolicy(Base):
    __tablename__ = "allocation_policies"
    __table_args__ = (
        UniqueConstraint("version", name="uq_allocation_policy_version"),
        CheckConstraint("operations_rate >= 0 AND vendor_pool_rate >= 0 AND local_ops_rate >= 0 AND dispute_reserve_rate >= 0 AND training_fund_rate >= 0", name="ck_allocation_rates_nonnegative"),
        CheckConstraint("operations_rate + vendor_pool_rate + local_ops_rate + dispute_reserve_rate + training_fund_rate = 1", name="ck_allocation_rates_sum_one"),
        CheckConstraint("status IN ('draft', 'pending', 'approved', 'retired')", name="ck_allocation_policy_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version = Column(Integer, nullable=False)
    operations_rate = Column(Numeric(5, 4), nullable=False)
    vendor_pool_rate = Column(Numeric(5, 4), nullable=False)
    local_ops_rate = Column(Numeric(5, 4), nullable=False)
    dispute_reserve_rate = Column(Numeric(5, 4), nullable=False)
    training_fund_rate = Column(Numeric(5, 4), nullable=False)
    effective_from = Column(DateTime, nullable=False)
    effective_until = Column(DateTime, nullable=True)
    governance_proposal_id = Column(UUID(as_uuid=True), ForeignKey("governance_proposals.id", ondelete="RESTRICT"), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False)
    approved_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class BenefitPeriod(Base):
    __tablename__ = "benefit_periods"
    __table_args__ = (
        UniqueConstraint("starts_at", "ends_at", "policy_version", name="uq_benefit_period_policy_window"),
        CheckConstraint("ends_at > starts_at", name="ck_benefit_period_dates"),
        CheckConstraint("status IN ('open', 'calculating', 'review', 'approved', 'distributed', 'cancelled')", name="ck_benefit_period_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    starts_at = Column(DateTime, nullable=False)
    ends_at = Column(DateTime, nullable=False)
    policy_version = Column(Integer, ForeignKey("allocation_policies.version", ondelete="RESTRICT"), nullable=False)
    eligible_revenue_ksh = Column(Numeric(14, 2), nullable=False, default=0)
    distributable_pool_ksh = Column(Numeric(14, 2), nullable=False, default=0)
    status = Column(String(20), nullable=False, default="open")
    calculation_hash = Column(String(128), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class NetworkBenefitEvent(Base):
    """Human/source-verified participation evidence used by the period calculator."""
    __tablename__ = "network_benefit_events"
    __table_args__ = (
        UniqueConstraint("vendor_id", "metric_type", "source_type", "source_reference", name="uq_network_benefit_evidence"),
        CheckConstraint("metric_type IN ('fulfilled_purchase', 'verified_peer_help', 'governance_participation', 'reliability')", name="ck_network_benefit_metric"),
        CheckConstraint("amount >= 0", name="ck_network_benefit_amount_nonnegative"),
        Index("ix_network_benefit_vendor_date", "vendor_id", "event_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    metric_type = Column(String(30), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    source_type = Column(String(80), nullable=False)
    source_reference = Column(String(200), nullable=False)
    evidence_note = Column(Text, nullable=False)
    verified_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False)
    event_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class VendorBenefitAllocation(Base):
    __tablename__ = "vendor_benefit_allocations"
    __table_args__ = (
        UniqueConstraint("benefit_period_id", "vendor_id", name="uq_benefit_period_vendor"),
        CheckConstraint("fulfilled_purchase_score >= 0 AND verified_help_score >= 0 AND governance_score >= 0 AND reliability_score >= 0 AND final_weight >= 0 AND allocated_amount_ksh >= 0", name="ck_benefit_allocation_nonnegative"),
        CheckConstraint("distribution_method IN ('group_buy_credit', 'logistics_credit', 'training_credit', 'cash_if_permitted')", name="ck_benefit_distribution_method"),
        CheckConstraint("status IN ('calculated', 'approved', 'issued', 'reversed')", name="ck_benefit_allocation_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    benefit_period_id = Column(UUID(as_uuid=True), ForeignKey("benefit_periods.id", ondelete="CASCADE"), nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False)
    fulfilled_purchase_score = Column(Numeric(12, 6), nullable=False, default=0)
    verified_help_score = Column(Numeric(12, 6), nullable=False, default=0)
    governance_score = Column(Numeric(12, 6), nullable=False, default=0)
    reliability_score = Column(Numeric(12, 6), nullable=False, default=0)
    final_weight = Column(Numeric(12, 6), nullable=False)
    allocated_amount_ksh = Column(Numeric(14, 2), nullable=False)
    distribution_method = Column(String(30), nullable=False, default="group_buy_credit")
    status = Column(String(20), nullable=False, default="calculated")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class VendorCreditLedger(Base):
    __tablename__ = "vendor_credit_ledger"
    __table_args__ = (
        CheckConstraint("transaction_type IN ('credit_issued', 'credit_redeemed', 'credit_expired', 'credit_reversed')", name="ck_vendor_credit_transaction_type"),
        CheckConstraint("amount_ksh > 0", name="ck_vendor_credit_amount_positive"),
        Index("ix_vendor_credit_vendor_created", "vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False)
    benefit_period_id = Column(UUID(as_uuid=True), ForeignKey("benefit_periods.id", ondelete="RESTRICT"), nullable=True)
    transaction_type = Column(String(20), nullable=False)
    amount_ksh = Column(Numeric(14, 2), nullable=False)
    reference_type = Column(String(80), nullable=False)
    reference_id = Column(UUID(as_uuid=True), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class VendorAppeal(Base):
    __tablename__ = "vendor_appeals"
    __table_args__ = (
        CheckConstraint("status IN ('submitted', 'acknowledged', 'under_review', 'upheld', 'partially_reversed', 'reversed')", name="ck_vendor_appeal_status"),
        Index("ix_vendor_appeals_status_created", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_type = Column(String(80), nullable=False)
    subject_id = Column(UUID(as_uuid=True), nullable=True)
    appeal_text = Column(Text, nullable=False)
    status = Column(String(30), nullable=False, default="submitted")
    assigned_to_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    resolution_note = Column(Text, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class VendorDataConsent(Base):
    __tablename__ = "vendor_data_consents"
    __table_args__ = (
        UniqueConstraint("vendor_id", "purpose", name="uq_vendor_consent_purpose"),
        CheckConstraint("data_class IN ('public', 'network_only', 'zone_only', 'operator_restricted', 'financial_restricted', 'voice_private', 'aggregated_anonymous')", name="ck_vendor_consent_data_class"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    purpose = Column(String(80), nullable=False)
    data_class = Column(String(30), nullable=False)
    granted = Column(Boolean, nullable=False, default=False)
    granted_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    consent_reference = Column(String(100), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

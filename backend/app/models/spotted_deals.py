"""Dormant schema foundation for community-spotted sales.

Receipt records are parsed QR data, not independent KRA verification. This
schema does not itself expose a deal board or confer standing or verification.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base


class SpottedDeal(Base):
    __tablename__ = "spotted_deals"
    __table_args__ = (
        CheckConstraint("status IN ('LIVE_UNVERIFIED','RECEIPT_LINKED','PAUSED_FLAGGED','PAUSED_OPT_OUT','DISPUTED_REVIEW','OPTED_OUT','EXPIRED')", name="ck_spotted_deals_status"),
        CheckConstraint("confirmed_by_user_id IS NULL OR confirmed_by_user_id <> poster_user_id", name="ck_spotted_distinct_confirmer"),
        CheckConstraint("seen_in_store_count >= 0", name="ck_spotted_seen_nonnegative"),
        CheckConstraint("status <> 'RECEIPT_LINKED' OR (confirmed_receipt_id IS NOT NULL AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)", name="ck_spotted_confirmation_evidence"),
        Index("idx_spotted_deals_public_feed", "region_slug", "status", "expires_at", postgresql_where=text("status IN ('LIVE_UNVERIFIED', 'RECEIPT_LINKED')")),
        Index("idx_spotted_deals_poster_strikes", "poster_user_id", "strike_at", postgresql_where=text("strike_counted = true")),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    merchant_id = Column(UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False)
    poster_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False)
    region_slug = Column(String(64), nullable=False)
    town = Column(String(64), nullable=False)
    title = Column(String(140), nullable=False)
    discount_summary = Column(String(80))
    image_url = Column(Text, nullable=False)
    status = Column(String(24), nullable=False, default="LIVE_UNVERIFIED", server_default="LIVE_UNVERIFIED")
    confirmed_receipt_id = Column(UUID(as_uuid=True), ForeignKey("receipts.id"), unique=True)
    confirmed_by_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"))
    confirmed_at = Column(DateTime)
    opt_out_requested_at = Column(DateTime)
    opt_out_deadline = Column(DateTime)
    opt_out_requester_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"))
    opt_out_subnet_hash = Column(String(64))
    dispute_receipt_id = Column(UUID(as_uuid=True), ForeignKey("receipts.id"), unique=True)
    disputed_at = Column(DateTime)
    jury_review_deadline = Column(DateTime)
    seen_in_store_count = Column(Integer, nullable=False, default=0, server_default="0")
    capture_signals = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    strike_counted = Column(Boolean, nullable=False, default=False, server_default="false")
    # Strikes are counted from the time of the flag decision, not deal creation.
    strike_at = Column(DateTime)
    expires_at = Column(DateTime, nullable=False, server_default=text("now() + interval '72 hours'"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SpottedDealFlag(Base):
    __tablename__ = "spotted_deal_flags"
    __table_args__ = (
        CheckConstraint("flag_type IN ('DEAL_ENDED','FALSE_PRICE','WRONG_SHOP','SPAM')", name="ck_spotted_flag_type"),
        CheckConstraint("weight > 0 AND weight <= 3", name="ck_spotted_flag_weight"),
        UniqueConstraint("deal_id", "flagger_user_id", name="uq_spotted_deal_flagger"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    deal_id = Column(UUID(as_uuid=True), ForeignKey("spotted_deals.id", ondelete="CASCADE"), nullable=False)
    flagger_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False)
    flag_type = Column(String(24), nullable=False)
    weight = Column(Numeric(3, 2), nullable=False)
    ip_subnet_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SpottedDealSeenTap(Base):
    __tablename__ = "spotted_deal_seen_taps"
    deal_id = Column(UUID(as_uuid=True), ForeignKey("spotted_deals.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), primary_key=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SpottedDealCooldown(Base):
    __tablename__ = "spotted_deal_cooldowns"
    user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), primary_key=True)
    strike_count_60d = Column(Integer, nullable=False, default=0, server_default="0")
    locked_until = Column(DateTime)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SpottedDealJuryAssignment(Base):
    __tablename__ = "spotted_deal_jury_assignments"
    __table_args__ = (
        CheckConstraint("decision IS NULL OR decision IN ('UPHOLD_OPT_OUT','UPHOLD_DEAL')", name="ck_jury_decision"),
        UniqueConstraint("deal_id", "juror_user_id", name="uq_spotted_jury_assignment"),
        Index("idx_jury_assignments_pending", "juror_user_id", "expires_at", postgresql_where=text("decision IS NULL")),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    deal_id = Column(UUID(as_uuid=True), ForeignKey("spotted_deals.id", ondelete="CASCADE"), nullable=False)
    juror_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False)
    decision = Column(String(24))
    decided_at = Column(DateTime)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SpottedOptOutAttempt(Base):
    __tablename__ = "spotted_opt_out_attempts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    subnet_hash = Column(String(64), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"), index=True)

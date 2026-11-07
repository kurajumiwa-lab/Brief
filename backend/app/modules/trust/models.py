"""MarketTrust core: branches, verification, transaction tokens, branch reviews,
audit and the points ledger.

Money: none. Points are not money and have no cash value. The platform holds no
funds, so nothing here is a balance in shillings, birr or shillings of Uganda.

Append-only tables (`branch_verifications`, `audit_events`, `points_ledger`) are
guarded by Postgres triggers installed from `app.db_triggers`.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger,
    String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

COUNTRY_CODES = ("KE", "ET", "UG")


def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class TrustBranch(Base):
    """A physical shop of a business. Public only when `status = 'active'`."""
    __tablename__ = "business_branches"
    __table_args__ = (
        UniqueConstraint("vendor_id", "branch_name", name="uq_business_branch_name"),
        CheckConstraint(_in("country_code", COUNTRY_CODES), name="ck_business_branch_country"),
        CheckConstraint(_in("status", ("pending", "active", "removed")), name="ck_business_branch_status"),
        CheckConstraint("verification_level BETWEEN 0 AND 4", name="ck_business_branch_level"),
        CheckConstraint("latitude IS NULL OR (latitude BETWEEN -90 AND 90)", name="ck_business_branch_lat"),
        CheckConstraint("longitude IS NULL OR (longitude BETWEEN -180 AND 180)", name="ck_business_branch_lng"),
        Index("ix_business_branches_location", "latitude", "longitude"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    country_code = Column(String(2), nullable=False, default="KE", server_default="KE")
    branch_name = Column(String(120), nullable=False)
    address_text = Column(String(300), nullable=False)
    latitude = Column(Numeric(9, 6), nullable=True)
    longitude = Column(Numeric(9, 6), nullable=True)
    status = Column(String(12), nullable=False, default="pending", server_default="pending")
    verification_level = Column(SmallInteger, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class BranchVerification(Base):
    """Append-only record of a staff decision about a branch."""
    __tablename__ = "branch_verifications"
    __table_args__ = (
        CheckConstraint(_in("result", ("approved", "rejected")), name="ck_branch_verif_result"),
        CheckConstraint("result = 'approved' OR length(note) >= 10", name="ck_branch_verif_reason"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id = Column(UUID(as_uuid=True), ForeignKey("business_branches.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    method = Column(String(30), nullable=False)
    result = Column(String(12), nullable=False)
    verifier_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ReviewIdentity(Base):
    """A customer's device identity for reviews. No login. Only a hash of the device key is stored.

    Lets a customer build a review history over time without a full account.
    """
    __tablename__ = "review_identities"
    __table_args__ = (
        CheckConstraint(_in("status", ("active", "blocked")), name="ck_review_identity_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key_hash = Column(String(64), nullable=False, unique=True)
    display_name = Column(String(40), nullable=True)
    status = Column(String(12), nullable=False, default="active", server_default="active")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class TransactionToken(Base):
    """A one-time code a branch shows at the till. Only its hash is stored."""
    __tablename__ = "transaction_tokens"
    __table_args__ = (
        Index("ix_transaction_tokens_branch", "branch_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id = Column(UUID(as_uuid=True), ForeignKey("business_branches.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    receipt_ref = Column(String(40), nullable=True)  # the shop's sale or receipt reference
    issued_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    expires_at = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime, nullable=True)
    consumed_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class BusinessReview(Base):
    """A branch rating. Edits create a new version; old rows are kept."""
    __tablename__ = "business_reviews"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_business_review_rating"),
        CheckConstraint("service_rating IS NULL OR service_rating BETWEEN 1 AND 5", name="ck_business_review_service"),
        CheckConstraint("product_rating IS NULL OR product_rating BETWEEN 1 AND 5", name="ck_business_review_product"),
        CheckConstraint("(reviewer_vendor_id IS NULL) <> (review_identity_id IS NULL)", name="ck_business_review_one_reviewer"),
        CheckConstraint(_in("status", ("published", "hidden_pending_review", "removed")),
                        name="ck_business_review_status"),
        CheckConstraint(_in("evidence_tier", ("confirmed_token", "unverified")),
                        name="ck_business_review_tier"),
        CheckConstraint("evidence_weight >= 0 AND evidence_weight <= 1", name="ck_business_review_weight"),
        # One current review per business reviewer, and per customer identity, per branch.
        Index("uq_business_review_current_vendor", "branch_id", "reviewer_vendor_id", unique=True,
              postgresql_where=text("is_current AND reviewer_vendor_id IS NOT NULL")),
        Index("uq_business_review_current_customer", "branch_id", "review_identity_id", unique=True,
              postgresql_where=text("is_current AND review_identity_id IS NOT NULL")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id = Column(UUID(as_uuid=True), ForeignKey("business_branches.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    reviewer_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                                nullable=True, index=True)
    review_identity_id = Column(UUID(as_uuid=True), ForeignKey("review_identities.id", ondelete="CASCADE"),
                                nullable=True, index=True)
    token_id = Column(UUID(as_uuid=True), ForeignKey("transaction_tokens.id", ondelete="SET NULL"), nullable=True)
    stage = Column(String(10), nullable=False, default="quick", server_default="quick")
    rating = Column(SmallInteger, nullable=False)  # overall experience
    service_rating = Column(SmallInteger, nullable=True)
    product_rating = Column(SmallInteger, nullable=True)
    comment = Column(Text, nullable=True)
    evidence_tier = Column(String(24), nullable=False)
    evidence_weight = Column(Numeric(3, 2), nullable=False)
    status = Column(String(24), nullable=False, default="published", server_default="published")
    version = Column(Integer, nullable=False, default=1, server_default="1")
    is_current = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    supersedes_id = Column(UUID(as_uuid=True), ForeignKey("business_reviews.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class AuditEvent(Base):
    """Append-only record of every trust action. Nothing here is ever edited."""
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_entity", "entity_type", "entity_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(60), nullable=False)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    country_code = Column(String(2), nullable=True)
    payload = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class PointsEntry(Base):
    """Append-only points ledger. Points are a non-cash exchange unit."""
    __tablename__ = "points_ledger"
    __table_args__ = (
        CheckConstraint("(entry_type = 'earn' AND points > 0) OR (entry_type = 'redeem' AND points < 0)",
                        name="ck_points_ledger_sign"),
        CheckConstraint(_in("entry_type", ("earn", "redeem")), name="ck_points_ledger_type"),
        CheckConstraint(_in("country_code", COUNTRY_CODES), name="ck_points_ledger_country"),
        UniqueConstraint("reference_type", "reference_id", "entry_type", name="uq_points_ledger_reference"),
        Index("ix_points_ledger_vendor", "vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    country_code = Column(String(2), nullable=False)
    entry_type = Column(String(10), nullable=False)
    points = Column(Integer, nullable=False)  # + for earn, - for redeem
    reason_key = Column(String(60), nullable=False)
    reference_type = Column(String(30), nullable=False)
    reference_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ReviewFlag(Base):
    """Append-only. Why a review was held back from the public rating."""
    __tablename__ = "review_flags"
    __table_args__ = (
        Index("ix_review_flags_review", "review_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_id = Column(UUID(as_uuid=True), ForeignKey("business_reviews.id", ondelete="CASCADE"), nullable=False)
    reason_key = Column(String(40), nullable=False)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ReviewModeration(Base):
    """Append-only. Every staff decision on a held review."""
    __tablename__ = "review_moderations"
    __table_args__ = (
        CheckConstraint(_in("action", ("publish", "remove")), name="ck_review_moderation_action"),
        CheckConstraint("length(reason) >= 10", name="ck_review_moderation_reason"),
        Index("ix_review_moderations_review", "review_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_id = Column(UUID(as_uuid=True), ForeignKey("business_reviews.id", ondelete="CASCADE"), nullable=False)
    staff_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(12), nullable=False)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

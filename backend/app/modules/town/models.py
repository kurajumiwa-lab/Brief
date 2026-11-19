"""Commercial tables for the town-wide network.

The ledgers here are append-only. A balance row is a projection of the ledger,
never the source of truth, so a bug cannot quietly rewrite history.

Three boundaries are encoded in the schema itself:

  · credits are promotional credit, not withdrawable cash;
  · a referral conversion is pending until a human or supported API verifies it;
  · a scout payment confirmation is a note about a direct M-Pesa payment, not a
    movement of platform money.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer,
    Numeric, String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

CATEGORIES = ("ride_hailing", "transport", "betting", "retail", "services", "other")
LISTING_STATUSES = ("draft", "active", "paused", "expired")
VERIFICATION_STATUSES = ("unverified", "pending", "verified", "rejected")
CONVERSION_STATUSES = ("pending", "verified", "rejected", "disputed")
DISPUTE_DOMAINS = ("receipt", "referral", "task", "redemption")
CREDIT_ENTRY_TYPES = ("purchase", "spend", "expire", "outstanding", "adjustment")
PURCHASE_STATUSES = ("pending", "confirmed", "rejected")
FEE_STATUSES = ("accrued", "invoiced", "paid", "waived")


def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class ReceiptItem(Base):
    """One line the OCR actually read. Nothing is inferred from a total."""

    __tablename__ = "receipt_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_receipt_items_quantity"),
        CheckConstraint("unit_price_kes >= 0", name="ck_receipt_items_unit_nonneg"),
        CheckConstraint("total_price_kes >= 0", name="ck_receipt_items_total_nonneg"),
        CheckConstraint("confidence BETWEEN 0 AND 100", name="ck_receipt_items_confidence"),
        UniqueConstraint("receipt_id", "line_no", name="uq_receipt_items_line"),
        Index("ix_receipt_items_receipt", "receipt_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_id = Column(UUID(as_uuid=True), ForeignKey("receipts.id", ondelete="CASCADE"), nullable=False)
    line_no = Column(Integer, nullable=False)
    description = Column(String(200), nullable=False)
    quantity = Column(Numeric(10, 2), nullable=False, default=1, server_default="1")
    unit_price_kes = Column(Integer, nullable=False, default=0, server_default="0")
    total_price_kes = Column(Integer, nullable=False, default=0, server_default="0")
    confidence = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class MerchantRewardPolicy(Base):
    """How a shop prices its own points. The platform does not fund them."""

    __tablename__ = "merchant_reward_policies"
    __table_args__ = (
        CheckConstraint("points_per_100_kes BETWEEN 1 AND 100", name="ck_reward_policy_rate"),
        CheckConstraint("max_points_per_receipt BETWEEN 0 AND 1000000", name="ck_reward_policy_cap"),
        CheckConstraint("priority_bonus_pct BETWEEN 0 AND 100", name="ck_reward_policy_bonus"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"),
        nullable=False, unique=True,
    )
    points_per_100_kes = Column(Integer, nullable=False, default=2, server_default="2")
    max_points_per_receipt = Column(Integer, nullable=False, default=500, server_default="500")
    priority_bonus_pct = Column(Integer, nullable=False, default=0, server_default="0")
    updated_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class MerchantCreditAccount(Base):
    """Projection of prepaid promotional credit. Never a wallet for payouts."""

    __tablename__ = "merchant_credit_accounts"
    __table_args__ = (
        CheckConstraint("purchased_kes >= 0 AND available_kes >= 0", name="ck_credit_account_purchased"),
        CheckConstraint("spent_kes >= 0 AND expired_kes >= 0 AND outstanding_kes >= 0",
                        name="ck_credit_account_nonnegative"),
        CheckConstraint(
            "available_kes <= purchased_kes", name="ck_credit_account_available_cap",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"),
        nullable=False, unique=True,
    )
    purchased_kes = Column(Integer, nullable=False, default=0, server_default="0")
    available_kes = Column(Integer, nullable=False, default=0, server_default="0")
    spent_kes = Column(Integer, nullable=False, default=0, server_default="0")
    expired_kes = Column(Integer, nullable=False, default=0, server_default="0")
    outstanding_kes = Column(Integer, nullable=False, default=0, server_default="0")
    # Credit is valid for a disclosed period from the latest purchase. Expiry is
    # a separate column from spend so unredeemed credit is never mistaken for
    # earned profit.
    expires_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class MerchantCreditEntry(Base):
    """Append-only credit ledger. `idempotency_key` is the replay guard."""

    __tablename__ = "merchant_credit_entries"
    __table_args__ = (
        CheckConstraint(_in("entry_type", CREDIT_ENTRY_TYPES), name="ck_credit_entry_type"),
        CheckConstraint("amount_kes > 0", name="ck_credit_entry_positive"),
        UniqueConstraint("merchant_id", "idempotency_key", name="uq_credit_entry_idempotency"),
        Index("ix_credit_entries_merchant", "merchant_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False,
    )
    entry_type = Column(String(20), nullable=False)
    amount_kes = Column(Integer, nullable=False)
    idempotency_key = Column(String(120), nullable=False)
    reference_type = Column(String(40), nullable=True)
    reference_id = Column(UUID(as_uuid=True), nullable=True)
    note = Column(String(300), nullable=True)
    created_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class MerchantCreditPurchase(Base):
    """A prepaid credit purchase awaiting an externally settled payment.

    The merchant pays through a licensed rail and records the reference. An
    operator confirms it; only then is credit posted. This avoids a self-service
    "I paid" button minting promotional money.
    """

    __tablename__ = "merchant_credit_purchases"
    __table_args__ = (
        CheckConstraint("amount_kes > 0", name="ck_credit_purchase_positive"),
        CheckConstraint(_in("status", PURCHASE_STATUSES), name="ck_credit_purchase_status"),
        UniqueConstraint("merchant_id", "idempotency_key", name="uq_credit_purchase_idempotency"),
        Index("ix_credit_purchases_status", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False,
    )
    amount_kes = Column(Integer, nullable=False)
    payment_reference = Column(String(120), nullable=False)
    payment_method = Column(String(30), nullable=False, default="direct_mpesa", server_default="direct_mpesa")
    idempotency_key = Column(String(120), nullable=False)
    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    requested_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    confirmed_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    confirmed_at = Column(DateTime, nullable=True)
    note = Column(String(300), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ReceiptRedemption(Base):
    """Immutable redemption record. The voucher status is the current state."""

    __tablename__ = "receipt_redemptions"
    __table_args__ = (
        CheckConstraint("value_kes > 0", name="ck_receipt_redemption_value_positive"),
        UniqueConstraint("voucher_id", name="uq_receipt_redemption_voucher"),
        Index("ix_receipt_redemptions_merchant", "merchant_id", "created_at"),
        Index("ix_receipt_redemptions_vendor", "vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    voucher_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_vouchers.id", ondelete="CASCADE"), nullable=False,
    )
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False,
    )
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    value_kes = Column(Integer, nullable=False)
    code_hash = Column(String(64), nullable=False)
    redeemed_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    receipt_id = Column(UUID(as_uuid=True), ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ReferralListing(Base):
    """A searchable referral offer. Unverified listings say so; they do not hide it."""

    __tablename__ = "referral_listings"
    __table_args__ = (
        CheckConstraint(_in("category", CATEGORIES), name="ck_referral_listing_category"),
        CheckConstraint(_in("status", LISTING_STATUSES), name="ck_referral_listing_status"),
        CheckConstraint(_in("verification_status", VERIFICATION_STATUSES),
                        name="ck_referral_listing_verification"),
        CheckConstraint("bounty_kes >= 0 AND bounty_points >= 0", name="ck_referral_listing_bounty"),
        CheckConstraint("budget_kes >= 0", name="ck_referral_listing_budget"),
        CheckConstraint("trust_level_required BETWEEN 1 AND 5", name="ck_referral_listing_trust"),
        CheckConstraint("sponsored_bid_kes >= 0", name="ck_referral_listing_sponsor"),
        Index("ix_referral_listings_region_category", "region_slug", "category", "status"),
        Index("ix_referral_listings_sponsored", "sponsored_bid_kes", "sponsored_until"),
        Index("ix_referral_listings_owner", "owner_vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String(80), nullable=False)
    category = Column(String(24), nullable=False)
    title = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    referral_code = Column(String(80), nullable=True)
    referral_url = Column(String(1000), nullable=True)
    offer_terms = Column(Text, nullable=True)
    region_slug = Column(String(60), nullable=False, default="nyanza", server_default="nyanza")
    country_code = Column(String(2), nullable=False, default="KE", server_default="KE")
    bounty_kes = Column(Integer, nullable=False, default=0, server_default="0")
    bounty_points = Column(Integer, nullable=False, default=0, server_default="0")
    budget_kes = Column(Integer, nullable=False, default=0, server_default="0")
    verification_method = Column(String(20), nullable=False, default="manual", server_default="manual")
    verification_status = Column(String(16), nullable=False, default="unverified", server_default="unverified")
    verification_note = Column(String(500), nullable=True)
    verification_url = Column(String(1000), nullable=True)
    trust_level_required = Column(Integer, nullable=False, default=1, server_default="1")
    sponsored_bid_kes = Column(Integer, nullable=False, default=0, server_default="0")
    sponsored_until = Column(DateTime, nullable=True)
    status = Column(String(16), nullable=False, default="active", server_default="active")
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReferralShareLink(Base):
    """A seeder's code for one listing. Clicks are attributed to this row."""

    __tablename__ = "referral_share_links"
    __table_args__ = (
        UniqueConstraint("listing_id", "referrer_vendor_id", name="uq_referral_share_person"),
        Index("ix_referral_share_referrer", "referrer_vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_listings.id", ondelete="CASCADE"), nullable=False,
    )
    referrer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
    )
    code = Column(String(20), nullable=False, unique=True, index=True)
    active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ReferralClick(Base):
    """A click is a signal. It never creates a conversion on its own."""

    __tablename__ = "referral_clicks"
    __table_args__ = (
        UniqueConstraint("token", name="uq_referral_click_token"),
        Index("ix_referral_clicks_listing", "listing_id", "created_at"),
        Index("ix_referral_clicks_share", "share_link_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_listings.id", ondelete="CASCADE"), nullable=False,
    )
    share_link_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_share_links.id", ondelete="SET NULL"), nullable=True,
    )
    viewer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    token = Column(String(40), nullable=False)
    source = Column(String(40), nullable=False, default="link", server_default="link")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ReferralBounty(Base):
    """A funder's ceiling for one listing. Paid directly; never held here."""

    __tablename__ = "referral_bounties"
    __table_args__ = (
        CheckConstraint("amount_kes >= 0 AND committed_kes >= 0 AND paid_kes >= 0",
                        name="ck_referral_bounty_nonnegative"),
        CheckConstraint("committed_kes <= amount_kes", name="ck_referral_bounty_committed_cap"),
        CheckConstraint("paid_kes <= committed_kes", name="ck_referral_bounty_paid_cap"),
        CheckConstraint(_in("status", ("draft", "active", "exhausted", "closed")),
                        name="ck_referral_bounty_status"),
        UniqueConstraint("listing_id", name="uq_referral_bounty_listing"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_listings.id", ondelete="CASCADE"), nullable=False,
    )
    funder_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
    )
    amount_kes = Column(Integer, nullable=False, default=0, server_default="0")
    committed_kes = Column(Integer, nullable=False, default=0, server_default="0")
    paid_kes = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(String(16), nullable=False, default="draft", server_default="draft")
    # A funder settles directly and records the reference. The platform does not
    # hold the bounty; this is evidence for the audit trail, not custody.
    funding_reference = Column(String(120), nullable=True)
    funded_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReferralConversion(Base):
    """A claimed successful referral. Pending until independently verified."""

    __tablename__ = "referral_conversions"
    __table_args__ = (
        CheckConstraint(_in("status", CONVERSION_STATUSES), name="ck_referral_conversion_status"),
        CheckConstraint("bounty_kes >= 0 AND reward_points >= 0", name="ck_referral_conversion_reward"),
        CheckConstraint(_in("bounty_status", ("not_due", "due", "paid")),
                        name="ck_referral_conversion_bounty_status"),
        UniqueConstraint("listing_id", "actor_vendor_id", name="uq_referral_conversion_actor"),
        Index("ix_referral_conversions_referrer", "referrer_vendor_id", "created_at"),
        Index("ix_referral_conversions_status", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_listings.id", ondelete="CASCADE"), nullable=False,
    )
    share_link_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_share_links.id", ondelete="SET NULL"), nullable=True,
    )
    click_id = Column(UUID(as_uuid=True), ForeignKey("referral_clicks.id", ondelete="SET NULL"), nullable=True)
    actor_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
    )
    referrer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    proof_type = Column(String(24), nullable=False, default="transaction_ref", server_default="transaction_ref")
    proof_reference = Column(String(200), nullable=True)
    proof_payload = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    review_note = Column(String(500), nullable=True)
    reviewer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    bounty_kes = Column(Integer, nullable=False, default=0, server_default="0")
    bounty_status = Column(String(12), nullable=False, default="not_due", server_default="not_due")
    reward_points = Column(Integer, nullable=False, default=0, server_default="0")
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class DisputeCase(Base):
    """One dispute across any commercial surface. Evidence, not a verdict."""

    __tablename__ = "dispute_cases"
    __table_args__ = (
        CheckConstraint(_in("domain", DISPUTE_DOMAINS), name="ck_dispute_domain"),
        CheckConstraint(_in("status", ("open", "reviewing", "resolved", "rejected")),
                        name="ck_dispute_status"),
        Index("ix_dispute_cases_subject", "domain", "subject_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    domain = Column(String(16), nullable=False)
    subject_id = Column(UUID(as_uuid=True), nullable=False)
    opened_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    against_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    reason = Column(Text, nullable=False)
    evidence = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    status = Column(String(16), nullable=False, default="open", server_default="open")
    resolution = Column(Text, nullable=True)
    resolved_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)


class TrustSnapshot(Base):
    """Evidence-backed trust level at a point in time. Append-only."""

    __tablename__ = "trust_snapshots"
    __table_args__ = (
        CheckConstraint("score BETWEEN 0 AND 100", name="ck_trust_snapshot_score"),
        CheckConstraint("level BETWEEN 1 AND 5", name="ck_trust_snapshot_level"),
        Index("ix_trust_snapshots_vendor", "vendor_id", "computed_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    score = Column(Integer, nullable=False, default=0, server_default="0")
    level = Column(Integer, nullable=False, default=1, server_default="1")
    evidence = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    computed_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ScoutTaskRating(Base):
    """A merchant's rating of one completed scout task."""

    __tablename__ = "scout_task_ratings"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_scout_rating_range"),
        UniqueConstraint("task_id", name="uq_scout_rating_task"),
        Index("ix_scout_ratings_scout", "scout_vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(
        UUID(as_uuid=True), ForeignKey("corridor_tasks.id", ondelete="CASCADE"), nullable=False,
    )
    scout_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    merchant_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
    )
    rating = Column(Integer, nullable=False)
    note = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class TaskPaymentConfirmation(Base):
    """The scout says the direct payment arrived. A note, not a platform payout."""

    __tablename__ = "task_payment_confirmations"
    __table_args__ = (
        CheckConstraint("amount_kes > 0", name="ck_task_payment_positive"),
        CheckConstraint("length(payment_reference) >= 3", name="ck_task_payment_reference"),
        UniqueConstraint("task_id", name="uq_task_payment_task"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(
        UUID(as_uuid=True), ForeignKey("corridor_tasks.id", ondelete="CASCADE"), nullable=False,
    )
    payer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    scout_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    amount_kes = Column(Numeric(10, 2), nullable=False)
    payment_method = Column(String(30), nullable=False, default="direct_mpesa", server_default="direct_mpesa")
    payment_reference = Column(String(120), nullable=False)
    confirmed_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class CommerceSetting(Base):
    """Runtime commercial configuration (fee percentages, credit expiry).

    Kept in the database rather than the environment so an operator can change
    a disclosed rate without a deploy. Values are small JSON objects and every
    change is audited through the ops router.
    """

    __tablename__ = "commerce_settings"

    key = Column(String(60), primary_key=True)
    value = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    description = Column(String(300), nullable=True)
    updated_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class MerchantAnalyticsSubscription(Base):
    """Premium analytics is merchant-funded and confirmed externally.

    While `free_for_now` is on, the premium surface is readable in preview but
    no subscription is charged. A pending row never unlocks the paid view.
    """

    __tablename__ = "merchant_analytics_subscriptions"
    __table_args__ = (
        CheckConstraint("price_kes >= 0", name="ck_analytics_sub_price"),
        CheckConstraint("months BETWEEN 1 AND 12", name="ck_analytics_sub_months"),
        CheckConstraint(_in("status", ("pending", "active", "expired", "rejected", "waived")),
                        name="ck_analytics_sub_status"),
        Index("ix_analytics_sub_status", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"),
        nullable=False, unique=True,
    )
    plan = Column(String(20), nullable=False, default="premium", server_default="premium")
    price_kes = Column(Integer, nullable=False, default=0, server_default="0")
    months = Column(Integer, nullable=False, default=1, server_default="1")
    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    payment_reference = Column(String(120), nullable=True)
    requested_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    confirmed_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    started_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class PlatformFeeEntry(Base):
    """Accrued platform revenue. `paid` only after an external settlement."""

    __tablename__ = "platform_fee_entries"
    __table_args__ = (
        CheckConstraint(_in("source_type", ("referral_campaign", "referral_conversion",
                                             "sponsorship", "subscription")),
                        name="ck_platform_fee_source"),
        CheckConstraint(_in("status", FEE_STATUSES), name="ck_platform_fee_status"),
        CheckConstraint("base_amount_kes >= 0 AND fee_kes >= 0", name="ck_platform_fee_nonnegative"),
        CheckConstraint("fee_pct >= 0 AND fee_pct <= 100", name="ck_platform_fee_pct"),
        UniqueConstraint("idempotency_key", name="uq_platform_fee_idempotency"),
        Index("ix_platform_fee_status", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type = Column(String(30), nullable=False)
    source_id = Column(UUID(as_uuid=True), nullable=False)
    payer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    base_amount_kes = Column(Integer, nullable=False, default=0, server_default="0")
    fee_pct = Column(Numeric(5, 2), nullable=False)
    fee_kes = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(String(16), nullable=False, default="accrued", server_default="accrued")
    idempotency_key = Column(String(120), nullable=False)
    note = Column(String(300), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    paid_at = Column(DateTime, nullable=True)

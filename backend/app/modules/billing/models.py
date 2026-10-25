"""Subscription and invoice tables (v2.15, Track 2).

Two tables, on purpose:

* ``subscriptions`` — one row per attempt to buy a plan. History is kept: an
  expired subscription stays, so the vendor's billing history is not rewritten
  when they upgrade, downgrade or lapse.
* ``subscription_invoices`` — one row per charge attempt, keyed by the provider
  reference so a duplicated webhook cannot charge twice or extend a period twice.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

SUBSCRIPTION_STATUSES = ("trialing", "active", "past_due", "cancelled", "expired")
INVOICE_STATUSES = ("pending", "paid", "failed", "refunded")
BILLING_PERIODS = ("monthly", "annual")


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('trialing','active','past_due','cancelled','expired')",
            name="ck_subscriptions_status",
        ),
        CheckConstraint(
            "billing_period IN ('monthly','annual')", name="ck_subscriptions_period"
        ),
        CheckConstraint("price_kes >= 0", name="ck_subscriptions_price_nonnegative"),
        CheckConstraint(
            "current_period_end >= current_period_start", name="ck_subscriptions_period_order"
        ),
        # At most one live subscription per vendor. History rows (cancelled,
        # expired) are excluded so a vendor can subscribe again later.
        Index(
            "uq_subscriptions_one_live_per_vendor", "vendor_id", unique=True,
            postgresql_where=Column("status").in_(("trialing", "active", "past_due")),
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    plan_tier = Column(String(24), nullable=False)
    billing_period = Column(String(10), nullable=False, default="monthly", server_default="monthly")
    price_kes = Column(Integer, nullable=False)
    status = Column(String(16), nullable=False, default="trialing", server_default="trialing", index=True)
    provider = Column(String(20), nullable=False, default="mock", server_default="mock")
    psp_sub_account = Column(String(80), nullable=True)

    trial_ends_at = Column(DateTime, nullable=True)
    current_period_start = Column(DateTime, nullable=False, default=datetime.utcnow)
    current_period_end = Column(DateTime, nullable=False, default=datetime.utcnow)
    grace_until = Column(DateTime, nullable=True)
    cancel_at_period_end = Column(Boolean, nullable=False, default=False, server_default="false")
    cancelled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class SubscriptionInvoice(Base):
    __tablename__ = "subscription_invoices"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','paid','failed','refunded')", name="ck_subscription_invoices_status"
        ),
        CheckConstraint("amount_kes > 0", name="ck_subscription_invoices_amount_positive"),
        # The idempotency key. A replayed webhook looks up this row, finds it
        # already paid, and returns success without moving anything.
        UniqueConstraint("psp_reference", name="uq_subscription_invoices_psp_reference"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subscription_id = Column(
        UUID(as_uuid=True), ForeignKey("subscriptions.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False, index=True)
    amount_kes = Column(Integer, nullable=False)
    status = Column(String(12), nullable=False, default="pending", server_default="pending", index=True)
    provider = Column(String(20), nullable=False, default="mock", server_default="mock")
    psp_reference = Column(String(80), nullable=False)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    issued_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    paid_at = Column(DateTime, nullable=True)
    failed_at = Column(DateTime, nullable=True)
    failure_reason = Column(Text, nullable=True)
    attempt = Column(Integer, nullable=False, default=1, server_default="1")

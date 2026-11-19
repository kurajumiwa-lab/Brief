"""Referral tables.

The money rule is structural, not a comment: there is no wallet, no balance and
no payout instruction on any row. `bounty_kes` is what the merchant promised;
`bounty_status` records whether the merchant says they paid it directly.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

CAMPAIGN_STATUSES = ("active", "paused", "ended")
REFERRAL_STATUSES = ("pending", "qualified", "rejected")
BOUNTY_STATUSES = ("not_due", "due", "paid")
REFERRAL_COUNTRY_CODES = ("KE", "UG", "ET")


def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class ReferralCampaign(Base):
    """A merchant-funded bounty for bringing a *new paying customer*.

    `reward_points` are platform points, not cash. `reward_kes` is a bounty the
    merchant pays directly. At least one must be positive so a campaign can never
    ask people to work for nothing.
    """

    __tablename__ = "referral_campaigns"
    __table_args__ = (
        CheckConstraint(_in("status", CAMPAIGN_STATUSES), name="ck_referral_campaigns_status"),
        CheckConstraint(_in("country_code", REFERRAL_COUNTRY_CODES), name="ck_referral_campaigns_country"),
        CheckConstraint("reward_points >= 0", name="ck_referral_campaigns_points_nonneg"),
        CheckConstraint("reward_kes >= 0", name="ck_referral_campaigns_kes_nonneg"),
        CheckConstraint("reward_points > 0 OR reward_kes > 0", name="ck_referral_campaigns_reward"),
        CheckConstraint("max_referrals BETWEEN 1 AND 500", name="ck_referral_campaigns_max"),
        Index("ix_referral_campaigns_region_status", "region_slug", "status"),
        Index("ix_referral_campaigns_merchant", "merchant_vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
    )
    receipt_merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False,
    )
    title = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    region_slug = Column(String(60), nullable=False, default="nyanza", server_default="nyanza")
    country_code = Column(String(2), nullable=False, default="KE", server_default="KE")
    reward_points = Column(Integer, nullable=False, default=0, server_default="0")
    reward_kes = Column(Integer, nullable=False, default=0, server_default="0")
    max_referrals = Column(Integer, nullable=False, default=10, server_default="10")
    status = Column(String(12), nullable=False, default="active", server_default="active")
    starts_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=func.now())
    ends_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, server_default=func.now(), onupdate=datetime.utcnow,
    )


class ReferralLink(Base):
    """A person's shareable code for one campaign. A code never proves a sale."""

    __tablename__ = "referral_links"
    __table_args__ = (
        UniqueConstraint("campaign_id", "referrer_vendor_id", name="uq_referral_links_person_campaign"),
        Index("ix_referral_links_referrer", "referrer_vendor_id"),
        Index("ix_referral_links_campaign", "campaign_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_campaigns.id", ondelete="CASCADE"), nullable=False,
    )
    referrer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
    )
    code = Column(String(16), nullable=False, unique=True, index=True)
    active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=func.now())


class Referral(Base):
    """One invited person and the evidence that decides whether it counts.

    It begins `pending`. Only a verified receipt at the campaign's shop can move
    it to `qualified`, and a person who was already a customer before the invite
    is rejected rather than rewarded.
    """

    __tablename__ = "referrals"
    __table_args__ = (
        CheckConstraint(_in("status", REFERRAL_STATUSES), name="ck_referrals_status"),
        CheckConstraint(_in("bounty_status", BOUNTY_STATUSES), name="ck_referrals_bounty_status"),
        CheckConstraint("reward_points >= 0", name="ck_referrals_points_nonneg"),
        CheckConstraint("bounty_kes >= 0", name="ck_referrals_kes_nonneg"),
        CheckConstraint(
            "referrer_vendor_id <> referred_vendor_id", name="ck_referrals_not_self",
        ),
        UniqueConstraint("campaign_id", "referred_vendor_id", name="uq_referrals_campaign_person"),
        UniqueConstraint("receipt_id", name="uq_referrals_receipt"),
        Index("ix_referrals_referrer_status", "referrer_vendor_id", "status"),
        Index("ix_referrals_campaign_status", "campaign_id", "status"),
        Index("ix_referrals_referred", "referred_vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_campaigns.id", ondelete="CASCADE"), nullable=False,
    )
    link_id = Column(
        UUID(as_uuid=True), ForeignKey("referral_links.id", ondelete="SET NULL"), nullable=True,
    )
    referrer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
    )
    referred_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
    )
    status = Column(String(12), nullable=False, default="pending", server_default="pending")
    qualified_at = Column(DateTime, nullable=True)
    receipt_id = Column(
        UUID(as_uuid=True), ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True,
    )
    receipt_merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="SET NULL"), nullable=True,
    )
    receipt_total = Column(Integer, nullable=True)
    reward_points = Column(Integer, nullable=False, default=0, server_default="0")
    bounty_kes = Column(Integer, nullable=False, default=0, server_default="0")
    bounty_status = Column(String(12), nullable=False, default="not_due", server_default="not_due")
    bounty_marked_at = Column(DateTime, nullable=True)
    bounty_note = Column(String(255), nullable=True)
    rejected_reason = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, server_default=func.now(), onupdate=datetime.utcnow,
    )

"""Referral engine: merchant-funded campaigns and verified acquisitions.

Revision ID: 0071_referral_engine
Revises: 0070_event_cash_payment
Create Date: 2026-11-17

What this schema deliberately does *not* store:

  · a wallet, a balance or a payout instruction — the merchant pays bounties
    directly through a licensed rail, and the platform never custodies money;
  · a phone number, email or M-Pesa message for an invited person — the evidence
    that counts is a verified receipt, already minimised by the receipt engine;
  · a "completed" flag a client can set. A referral starts pending and only the
    receipt engine can qualify it.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0071_referral_engine"
down_revision = "0070_event_cash_payment"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "referral_campaigns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("merchant_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("receipt_merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("region_slug", sa.String(60), nullable=False, server_default="nyanza"),
        sa.Column("country_code", sa.String(2), nullable=False, server_default="KE"),
        sa.Column("reward_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reward_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_referrals", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("starts_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('active','paused','ended')",
                           name="ck_referral_campaigns_status"),
        sa.CheckConstraint("country_code IN ('KE','UG','ET')",
                           name="ck_referral_campaigns_country"),
        sa.CheckConstraint("reward_points >= 0", name="ck_referral_campaigns_points_nonneg"),
        sa.CheckConstraint("reward_kes >= 0", name="ck_referral_campaigns_kes_nonneg"),
        sa.CheckConstraint("reward_points > 0 OR reward_kes > 0",
                           name="ck_referral_campaigns_reward"),
        sa.CheckConstraint("max_referrals BETWEEN 1 AND 500", name="ck_referral_campaigns_max"),
    )
    op.create_index("ix_referral_campaigns_region_status", "referral_campaigns",
                    ["region_slug", "status"])
    op.create_index("ix_referral_campaigns_merchant", "referral_campaigns",
                    ["merchant_vendor_id"])

    op.create_table(
        "referral_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("referrer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(16), nullable=False, unique=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("campaign_id", "referrer_vendor_id",
                            name="uq_referral_links_person_campaign"),
    )
    op.create_index("ix_referral_links_referrer", "referral_links", ["referrer_vendor_id"])
    op.create_index("ix_referral_links_campaign", "referral_links", ["campaign_id"])

    op.create_table(
        "referrals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("link_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_links.id", ondelete="SET NULL"), nullable=True),
        sa.Column("referrer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("referred_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("qualified_at", sa.DateTime(), nullable=True),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("receipt_merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("receipt_total", sa.Integer(), nullable=True),
        sa.Column("reward_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bounty_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bounty_status", sa.String(12), nullable=False, server_default="not_due"),
        sa.Column("bounty_marked_at", sa.DateTime(), nullable=True),
        sa.Column("bounty_note", sa.String(255), nullable=True),
        sa.Column("rejected_reason", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('pending','qualified','rejected')",
                           name="ck_referrals_status"),
        sa.CheckConstraint("bounty_status IN ('not_due','due','paid')",
                           name="ck_referrals_bounty_status"),
        sa.CheckConstraint("reward_points >= 0", name="ck_referrals_points_nonneg"),
        sa.CheckConstraint("bounty_kes >= 0", name="ck_referrals_kes_nonneg"),
        sa.CheckConstraint("referrer_vendor_id <> referred_vendor_id",
                           name="ck_referrals_not_self"),
        sa.UniqueConstraint("campaign_id", "referred_vendor_id",
                            name="uq_referrals_campaign_person"),
        sa.UniqueConstraint("receipt_id", name="uq_referrals_receipt"),
    )
    op.create_index("ix_referrals_referrer_status", "referrals",
                    ["referrer_vendor_id", "status"])
    op.create_index("ix_referrals_campaign_status", "referrals",
                    ["campaign_id", "status"])
    op.create_index("ix_referrals_referred", "referrals", ["referred_vendor_id"])


def downgrade():
    op.drop_table("referrals")
    op.drop_table("referral_links")
    op.drop_table("referral_campaigns")

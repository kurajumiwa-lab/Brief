"""Receipt rewards: receipts, merchants, merchant-funded offers and vouchers.

Additive. Creates four tables and changes nothing that already exists.

The boundaries are in the schema: a receipt carries the evidence the QR had
(PIN, invoice, total, token) and a global dedupe key, not a device-local flag.
A voucher has `redeemed_at` and no payout column; the reward is a discount, not
cash. A merchant claim is reviewed before it can publish an offer.

Revision ID: 0058_receipt_rewards
Revises: 0057_public_page_settings
Create Date: 2026-11-19
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0058_receipt_rewards"
down_revision: str = "0057_public_page_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "receipt_merchants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("pin", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False, server_default="Local merchant"),
        sa.Column("region", sa.String(length=80), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("claimed_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("claim_status", sa.String(length=16), nullable=False, server_default="unclaimed"),
        sa.Column("claim_note", sa.Text(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "claim_status IN ('unclaimed','pending','verified','rejected')",
            name="ck_receipt_merchants_claim_status",
        ),
        sa.UniqueConstraint("pin", name="uq_receipt_merchants_pin"),
    )
    op.create_index("ix_receipt_merchants_pin", "receipt_merchants", ["pin"])
    op.create_index("ix_receipt_merchants_region", "receipt_merchants", ["region"])
    op.create_index("ix_receipt_merchants_claimed_by_vendor_id", "receipt_merchants",
                    ["claimed_by_vendor_id"])
    op.create_index("ix_receipt_merchants_region_claim", "receipt_merchants",
                    ["region", "claim_status"])

    op.create_table(
        "receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("merchant_pin", sa.String(length=20), nullable=True),
        sa.Column("merchant_name", sa.String(length=200), nullable=False,
                  server_default="Local merchant"),
        sa.Column("invoice_no", sa.String(length=100), nullable=True),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("tax", sa.Integer(), nullable=True),
        sa.Column("issued_at", sa.DateTime(), nullable=True),
        sa.Column("scanned_at", sa.DateTime(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="qr"),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("freshness_key", sa.String(length=20), nullable=False),
        sa.Column("base_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("token", sa.String(length=500), nullable=True),
        sa.Column("verification_url", sa.String(length=1000), nullable=True),
        sa.Column("raw_payload", sa.Text(), nullable=True),
        sa.Column("dedupe_key", sa.String(length=300), nullable=False),
        sa.Column("region", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("total > 0", name="ck_receipts_total_positive"),
        sa.CheckConstraint("points >= 0", name="ck_receipts_points_nonnegative"),
        sa.CheckConstraint("status IN ('verified','partial','manual')", name="ck_receipts_status"),
        sa.UniqueConstraint("dedupe_key", name="uq_receipts_dedupe_key"),
    )
    op.create_index("ix_receipts_vendor_id", "receipts", ["vendor_id"])
    op.create_index("ix_receipts_scanned_at", "receipts", ["scanned_at"])
    op.create_index("ix_receipts_vendor_scanned", "receipts", ["vendor_id", "scanned_at"])
    op.create_index("ix_receipts_merchant_scanned", "receipts", ["merchant_id", "scanned_at"])
    op.create_index("ix_receipts_region_scanned", "receipts", ["region", "scanned_at"])

    op.create_table(
        "receipt_offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("discount_kes", sa.Integer(), nullable=False),
        sa.Column("min_spend_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("points_cost", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("discount_kes > 0", name="ck_receipt_offers_discount_positive"),
        sa.CheckConstraint("min_spend_kes >= 0", name="ck_receipt_offers_min_spend_nonnegative"),
        sa.CheckConstraint("points_cost >= 0", name="ck_receipt_offers_points_cost_nonnegative"),
    )
    op.create_index("ix_receipt_offers_merchant_id", "receipt_offers", ["merchant_id"])
    op.create_index("ix_receipt_offers_active_merchant", "receipt_offers",
                    ["is_active", "merchant_id"])

    op.create_table(
        "receipt_vouchers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("offer_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_offers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("value_kes", sa.Integer(), nullable=False),
        sa.Column("points_cost", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("code_seed", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="issued"),
        sa.Column("issued_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(), nullable=True),
        sa.Column("redeemed_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("used_on_receipt_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("value_kes > 0", name="ck_receipt_vouchers_value_positive"),
        sa.CheckConstraint("points_cost >= 0", name="ck_receipt_vouchers_points_nonnegative"),
        sa.CheckConstraint(
            "status IN ('issued','redeemed','expired','cancelled')",
            name="ck_receipt_vouchers_status",
        ),
        sa.UniqueConstraint("code_seed", name="uq_receipt_vouchers_code_seed"),
    )
    op.create_index("ix_receipt_vouchers_vendor_id", "receipt_vouchers", ["vendor_id"])
    op.create_index("ix_receipt_vouchers_vendor_status", "receipt_vouchers",
                    ["vendor_id", "status"])
    op.create_index("ix_receipt_vouchers_merchant_status", "receipt_vouchers",
                    ["merchant_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_receipt_vouchers_merchant_status", table_name="receipt_vouchers")
    op.drop_index("ix_receipt_vouchers_vendor_status", table_name="receipt_vouchers")
    op.drop_index("ix_receipt_vouchers_vendor_id", table_name="receipt_vouchers")
    op.drop_table("receipt_vouchers")

    op.drop_index("ix_receipt_offers_active_merchant", table_name="receipt_offers")
    op.drop_index("ix_receipt_offers_merchant_id", table_name="receipt_offers")
    op.drop_table("receipt_offers")

    op.drop_index("ix_receipts_region_scanned", table_name="receipts")
    op.drop_index("ix_receipts_merchant_scanned", table_name="receipts")
    op.drop_index("ix_receipts_vendor_scanned", table_name="receipts")
    op.drop_index("ix_receipts_scanned_at", table_name="receipts")
    op.drop_index("ix_receipts_vendor_id", table_name="receipts")
    op.drop_table("receipts")

    op.drop_index("ix_receipt_merchants_region_claim", table_name="receipt_merchants")
    op.drop_index("ix_receipt_merchants_claimed_by_vendor_id", table_name="receipt_merchants")
    op.drop_index("ix_receipt_merchants_region", table_name="receipt_merchants")
    op.drop_index("ix_receipt_merchants_pin", table_name="receipt_merchants")
    op.drop_table("receipt_merchants")

"""Town-wide commerce: receipt funding, referral exchange and scout records.

Revision ID: 0072_town_commerce
Revises: 0071_referral_engine
Create Date: 2026-11-17

This migration adds the commercial layer without changing the trust rule:

  · a receipt item is what OCR read, never a guess from the total;
  · merchant credit is prepaid promotional credit, not withdrawable money;
  · a referral click is a signal and a conversion is pending until verified;
  · a scout payment confirmation describes a direct M-Pesa payment, not one
    made by the platform.

All financial ledgers are append-only. Balance tables are projections.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0072_town_commerce"
down_revision = "0071_referral_engine"
branch_labels = None
depends_on = None


def upgrade():
    # ── receipt evidence ──────────────────────────────────────────────────
    op.add_column("receipts", sa.Column("photo_url", sa.String(1000), nullable=True))
    op.add_column("receipts", sa.Column("ocr_engine", sa.String(32), nullable=True))
    op.add_column("receipts", sa.Column("extraction", postgresql.JSONB(), nullable=False,
                                        server_default=sa.text("'{}'::jsonb")))
    op.add_column("receipts", sa.Column("items_total_kes", sa.Integer(), nullable=True))
    op.add_column("receipts", sa.Column("fraud_flags", postgresql.JSONB(), nullable=False,
                                        server_default=sa.text("'[]'::jsonb")))
    op.add_column("receipts", sa.Column("reward_funded_kes", sa.Integer(), nullable=False,
                                        server_default="0"))

    # The scout board grew two merchant-job types. Existing rows keep their
    # commission; only the allowed range widens so a configured percentage can
    # be used without a hardcoded 5–8% ceiling.
    op.drop_constraint("ck_corridor_task_type", "corridor_tasks", type_="check")
    op.create_check_constraint(
        "ck_corridor_task_type", "corridor_tasks",
        "task_type IN ('DELIVERY_HANDOFF','DEAL_SPOT_CHECK','MERCHANT_ONBOARD',"
        "'ERRAND_PICKUP','QR_DISTRIBUTION','CUSTOMER_ACQUISITION')",
    )
    op.drop_constraint("ck_corridor_task_fee_pct", "corridor_tasks", type_="check")
    op.create_check_constraint(
        "ck_corridor_task_fee_pct", "corridor_tasks", "fee_pct >= 0 AND fee_pct <= 25",
    )

    op.create_table(
        "receipt_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False, server_default="1"),
        sa.Column("unit_price_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_price_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("confidence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("quantity > 0", name="ck_receipt_items_quantity"),
        sa.CheckConstraint("unit_price_kes >= 0", name="ck_receipt_items_unit_nonneg"),
        sa.CheckConstraint("total_price_kes >= 0", name="ck_receipt_items_total_nonneg"),
        sa.CheckConstraint("confidence BETWEEN 0 AND 100", name="ck_receipt_items_confidence"),
        sa.UniqueConstraint("receipt_id", "line_no", name="uq_receipt_items_line"),
    )
    op.create_index("ix_receipt_items_receipt", "receipt_items", ["receipt_id"])

    op.create_table(
        "merchant_reward_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("points_per_100_kes", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("max_points_per_receipt", sa.Integer(), nullable=False, server_default="500"),
        sa.Column("priority_bonus_pct", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("points_per_100_kes BETWEEN 1 AND 100", name="ck_reward_policy_rate"),
        sa.CheckConstraint("max_points_per_receipt BETWEEN 0 AND 1000000", name="ck_reward_policy_cap"),
        sa.CheckConstraint("priority_bonus_pct BETWEEN 0 AND 100", name="ck_reward_policy_bonus"),
    )

    op.create_table(
        "merchant_credit_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("purchased_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("spent_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expired_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("outstanding_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("purchased_kes >= 0 AND available_kes >= 0", name="ck_credit_account_purchased"),
        sa.CheckConstraint("spent_kes >= 0 AND expired_kes >= 0 AND outstanding_kes >= 0",
                           name="ck_credit_account_nonnegative"),
        sa.CheckConstraint("available_kes <= purchased_kes", name="ck_credit_account_available_cap"),
    )

    op.create_table(
        "merchant_credit_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_type", sa.String(20), nullable=False),
        sa.Column("amount_kes", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("reference_type", sa.String(40), nullable=True),
        sa.Column("reference_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("created_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("entry_type IN ('purchase','spend','expire','outstanding','adjustment')",
                           name="ck_credit_entry_type"),
        sa.CheckConstraint("amount_kes > 0", name="ck_credit_entry_positive"),
        sa.UniqueConstraint("merchant_id", "idempotency_key", name="uq_credit_entry_idempotency"),
    )
    op.create_index("ix_credit_entries_merchant", "merchant_credit_entries",
                    ["merchant_id", "created_at"])

    op.create_table(
        "merchant_credit_purchases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount_kes", sa.Integer(), nullable=False),
        sa.Column("payment_reference", sa.String(120), nullable=False),
        sa.Column("payment_method", sa.String(30), nullable=False, server_default="direct_mpesa"),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("requested_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("confirmed_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("amount_kes > 0", name="ck_credit_purchase_positive"),
        sa.CheckConstraint("status IN ('pending','confirmed','rejected')",
                           name="ck_credit_purchase_status"),
        sa.UniqueConstraint("merchant_id", "idempotency_key", name="uq_credit_purchase_idempotency"),
    )
    op.create_index("ix_credit_purchases_status", "merchant_credit_purchases", ["status", "created_at"])

    op.create_table(
        "receipt_redemptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("voucher_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_vouchers.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("value_kes", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("redeemed_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("value_kes > 0", name="ck_receipt_redemption_value_positive"),
    )
    op.create_index("ix_receipt_redemptions_merchant", "receipt_redemptions",
                    ["merchant_id", "created_at"])
    op.create_index("ix_receipt_redemptions_vendor", "receipt_redemptions",
                    ["vendor_id", "created_at"])

    # ── referral exchange ─────────────────────────────────────────────────
    op.create_table(
        "referral_listings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("owner_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("referral_code", sa.String(80), nullable=True),
        sa.Column("referral_url", sa.String(1000), nullable=True),
        sa.Column("offer_terms", sa.Text(), nullable=True),
        sa.Column("region_slug", sa.String(60), nullable=False, server_default="nyanza"),
        sa.Column("country_code", sa.String(2), nullable=False, server_default="KE"),
        sa.Column("bounty_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bounty_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("budget_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verification_method", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("verification_status", sa.String(16), nullable=False, server_default="unverified"),
        sa.Column("verification_note", sa.String(500), nullable=True),
        sa.Column("verification_url", sa.String(1000), nullable=True),
        sa.Column("trust_level_required", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("sponsored_bid_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sponsored_until", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("category IN ('ride_hailing','transport','betting','retail','services','other')",
                           name="ck_referral_listing_category"),
        sa.CheckConstraint("status IN ('draft','active','paused','expired')",
                           name="ck_referral_listing_status"),
        sa.CheckConstraint("verification_status IN ('unverified','pending','verified','rejected')",
                           name="ck_referral_listing_verification"),
        sa.CheckConstraint("bounty_kes >= 0 AND bounty_points >= 0", name="ck_referral_listing_bounty"),
        sa.CheckConstraint("budget_kes >= 0", name="ck_referral_listing_budget"),
        sa.CheckConstraint("trust_level_required BETWEEN 1 AND 5", name="ck_referral_listing_trust"),
        sa.CheckConstraint("sponsored_bid_kes >= 0", name="ck_referral_listing_sponsor"),
    )
    op.create_index("ix_referral_listings_region_category", "referral_listings",
                    ["region_slug", "category", "status"])
    op.create_index("ix_referral_listings_sponsored", "referral_listings",
                    ["sponsored_bid_kes", "sponsored_until"])
    op.create_index("ix_referral_listings_owner", "referral_listings",
                    ["owner_vendor_id", "created_at"])

    op.create_table(
        "referral_share_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_listings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("referrer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(20), nullable=False, unique=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("listing_id", "referrer_vendor_id", name="uq_referral_share_person"),
    )
    op.create_index("ix_referral_share_referrer", "referral_share_links",
                    ["referrer_vendor_id", "created_at"])

    op.create_table(
        "referral_clicks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_listings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("share_link_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_share_links.id", ondelete="SET NULL"), nullable=True),
        sa.Column("viewer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("token", sa.String(40), nullable=False, unique=True),
        sa.Column("source", sa.String(40), nullable=False, server_default="link"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("token", name="uq_referral_click_token"),
    )
    op.create_index("ix_referral_clicks_listing", "referral_clicks", ["listing_id", "created_at"])
    op.create_index("ix_referral_clicks_share", "referral_clicks", ["share_link_id", "created_at"])

    op.create_table(
        "referral_bounties",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_listings.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("funder_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("committed_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paid_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("funding_reference", sa.String(120), nullable=True),
        sa.Column("funded_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("amount_kes >= 0 AND committed_kes >= 0 AND paid_kes >= 0",
                           name="ck_referral_bounty_nonnegative"),
        sa.CheckConstraint("committed_kes <= amount_kes", name="ck_referral_bounty_committed_cap"),
        sa.CheckConstraint("paid_kes <= committed_kes", name="ck_referral_bounty_paid_cap"),
        sa.CheckConstraint("status IN ('draft','active','exhausted','closed')",
                           name="ck_referral_bounty_status"),
    )

    op.create_table(
        "referral_conversions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_listings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("share_link_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_share_links.id", ondelete="SET NULL"), nullable=True),
        sa.Column("click_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("referral_clicks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("referrer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("proof_type", sa.String(24), nullable=False, server_default="transaction_ref"),
        sa.Column("proof_reference", sa.String(200), nullable=True),
        sa.Column("proof_payload", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("review_note", sa.String(500), nullable=True),
        sa.Column("reviewer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("bounty_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bounty_status", sa.String(12), nullable=False, server_default="not_due"),
        sa.Column("reward_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('pending','verified','rejected','disputed')",
                           name="ck_referral_conversion_status"),
        sa.CheckConstraint("bounty_kes >= 0 AND reward_points >= 0", name="ck_referral_conversion_reward"),
        sa.CheckConstraint("bounty_status IN ('not_due','due','paid')",
                           name="ck_referral_conversion_bounty_status"),
        sa.UniqueConstraint("listing_id", "actor_vendor_id", name="uq_referral_conversion_actor"),
    )
    op.create_index("ix_referral_conversions_referrer", "referral_conversions",
                    ["referrer_vendor_id", "created_at"])
    op.create_index("ix_referral_conversions_status", "referral_conversions",
                    ["status", "created_at"])

    # ── disputes, trust, scout and platform fees ──────────────────────────
    op.create_table(
        "dispute_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("domain", sa.String(16), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("opened_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("against_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("evidence", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("resolved_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("domain IN ('receipt','referral','task','redemption')",
                           name="ck_dispute_domain"),
        sa.CheckConstraint("status IN ('open','reviewing','resolved','rejected')",
                           name="ck_dispute_status"),
    )
    op.create_index("ix_dispute_cases_subject", "dispute_cases", ["domain", "subject_id"])

    op.create_table(
        "trust_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("evidence", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("computed_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("score BETWEEN 0 AND 100", name="ck_trust_snapshot_score"),
        sa.CheckConstraint("level BETWEEN 1 AND 5", name="ck_trust_snapshot_level"),
    )
    op.create_index("ix_trust_snapshots_vendor", "trust_snapshots", ["vendor_id", "computed_at"])

    op.create_table(
        "scout_task_ratings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("task_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("corridor_tasks.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("scout_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("merchant_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_scout_rating_range"),
    )
    op.create_index("ix_scout_ratings_scout", "scout_task_ratings", ["scout_vendor_id", "created_at"])

    op.create_table(
        "task_payment_confirmations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("task_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("corridor_tasks.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("payer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("scout_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("payment_method", sa.String(30), nullable=False, server_default="direct_mpesa"),
        sa.Column("payment_reference", sa.String(120), nullable=False),
        sa.Column("confirmed_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("amount_kes > 0", name="ck_task_payment_positive"),
        sa.CheckConstraint("length(payment_reference) >= 3", name="ck_task_payment_reference"),
    )

    op.create_table(
        "commerce_settings",
        sa.Column("key", sa.String(60), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("description", sa.String(300), nullable=True),
        sa.Column("updated_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "merchant_analytics_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("plan", sa.String(20), nullable=False, server_default="premium"),
        sa.Column("price_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("months", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("payment_reference", sa.String(120), nullable=True),
        sa.Column("requested_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("confirmed_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("price_kes >= 0", name="ck_analytics_sub_price"),
        sa.CheckConstraint("months BETWEEN 1 AND 12", name="ck_analytics_sub_months"),
        sa.CheckConstraint("status IN ('pending','active','expired','rejected','waived')",
                           name="ck_analytics_sub_status"),
    )
    op.create_index("ix_analytics_sub_status", "merchant_analytics_subscriptions",
                    ["status", "created_at"])

    op.create_table(
        "platform_fee_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("source_type", sa.String(30), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("base_amount_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fee_pct", sa.Numeric(5, 2), nullable=False),
        sa.Column("fee_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="accrued"),
        sa.Column("idempotency_key", sa.String(120), nullable=False, unique=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("source_type IN ('referral_campaign','referral_conversion',"
                           "'sponsorship','subscription')",
                           name="ck_platform_fee_source"),
        sa.CheckConstraint("status IN ('accrued','invoiced','paid','waived')",
                           name="ck_platform_fee_status"),
        sa.CheckConstraint("base_amount_kes >= 0 AND fee_kes >= 0",
                           name="ck_platform_fee_nonnegative"),
        sa.CheckConstraint("fee_pct >= 0 AND fee_pct <= 100", name="ck_platform_fee_pct"),
    )
    op.create_index("ix_platform_fee_status", "platform_fee_entries", ["status", "created_at"])


def downgrade():
    op.drop_constraint("ck_corridor_task_fee_pct", "corridor_tasks", type_="check")
    op.create_check_constraint(
        "ck_corridor_task_fee_pct", "corridor_tasks", "fee_pct >= 5 AND fee_pct <= 8",
    )
    op.drop_constraint("ck_corridor_task_type", "corridor_tasks", type_="check")
    op.create_check_constraint(
        "ck_corridor_task_type", "corridor_tasks",
        "task_type IN ('DELIVERY_HANDOFF','DEAL_SPOT_CHECK','MERCHANT_ONBOARD','ERRAND_PICKUP')",
    )
    op.drop_table("platform_fee_entries")
    op.drop_table("merchant_analytics_subscriptions")
    op.drop_table("commerce_settings")
    op.drop_table("task_payment_confirmations")
    op.drop_table("scout_task_ratings")
    op.drop_table("trust_snapshots")
    op.drop_table("dispute_cases")
    op.drop_table("referral_conversions")
    op.drop_table("referral_bounties")
    op.drop_table("referral_clicks")
    op.drop_table("referral_share_links")
    op.drop_table("referral_listings")
    op.drop_table("receipt_redemptions")
    op.drop_table("merchant_credit_purchases")
    op.drop_table("merchant_credit_entries")
    op.drop_table("merchant_credit_accounts")
    op.drop_table("merchant_reward_policies")
    op.drop_table("receipt_items")
    op.drop_column("receipts", "reward_funded_kes")
    op.drop_column("receipts", "fraud_flags")
    op.drop_column("receipts", "items_total_kes")
    op.drop_column("receipts", "extraction")
    op.drop_column("receipts", "ocr_engine")
    op.drop_column("receipts", "photo_url")

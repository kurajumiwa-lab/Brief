"""Add dormant spotted-deal ledger and jury tables.

Revision ID: 0062_spotted_deals
Revises: 0061_event_payments

The application uses vendors as accounts and naive UTC timestamps. No routes
are enabled by this schema migration; receipt QR parsing is not KRA validation.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0062_spotted_deals"
down_revision = "0061_event_payments"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("receipt_merchants", sa.Column("allow_spotted_deals", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("receipt_merchants", sa.Column("spotted_opt_out_at", sa.DateTime()))
    op.add_column("receipt_merchants", sa.Column("spotted_opt_out_by", postgresql.UUID(as_uuid=True)))
    op.create_foreign_key("fk_receipt_merchants_spotted_opt_out_by", "receipt_merchants", "vendors", ["spotted_opt_out_by"], ["id"], ondelete="SET NULL")
    op.create_table("spotted_deals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("merchant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("poster_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("region_slug", sa.String(64), nullable=False), sa.Column("town", sa.String(64), nullable=False),
        sa.Column("title", sa.String(140), nullable=False), sa.Column("discount_summary", sa.String(80)), sa.Column("image_url", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="LIVE_UNVERIFIED"),
        sa.Column("confirmed_receipt_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("receipts.id"), unique=True),
        sa.Column("confirmed_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id")), sa.Column("confirmed_at", sa.DateTime()),
        sa.Column("opt_out_requested_at", sa.DateTime()), sa.Column("opt_out_deadline", sa.DateTime()),
        sa.Column("opt_out_requester_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id")), sa.Column("opt_out_subnet_hash", sa.String(64)),
        sa.Column("dispute_receipt_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("receipts.id"), unique=True), sa.Column("disputed_at", sa.DateTime()),
        sa.Column("jury_review_deadline", sa.DateTime()), sa.Column("seen_in_store_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("capture_signals", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("strike_counted", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("strike_at", sa.DateTime()),
        sa.Column("expires_at", sa.DateTime(), nullable=False, server_default=sa.text("now() + interval '72 hours'")), sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('LIVE_UNVERIFIED','RECEIPT_CONFIRMED','PAUSED_FLAGGED','PAUSED_OPT_OUT','DISPUTED_REVIEW','OPTED_OUT','EXPIRED')", name="ck_spotted_deals_status"),
        sa.CheckConstraint("confirmed_by_user_id IS NULL OR confirmed_by_user_id <> poster_user_id", name="ck_spotted_distinct_confirmer"),
        sa.CheckConstraint("seen_in_store_count >= 0", name="ck_spotted_seen_nonnegative"),
        sa.CheckConstraint("status <> 'RECEIPT_CONFIRMED' OR (confirmed_receipt_id IS NOT NULL AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)", name="ck_spotted_confirmation_evidence"),
    )
    op.create_index("idx_spotted_deals_public_feed", "spotted_deals", ["region_slug", "status", "expires_at"], postgresql_where=sa.text("status IN ('LIVE_UNVERIFIED', 'RECEIPT_CONFIRMED')"))
    op.create_index("idx_spotted_deals_poster_strikes", "spotted_deals", ["poster_user_id", "strike_at"], postgresql_where=sa.text("strike_counted = true"))
    op.create_table("spotted_deal_flags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("deal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spotted_deals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("flagger_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("flag_type", sa.String(24), nullable=False), sa.Column("weight", sa.Numeric(3, 2), nullable=False),
        sa.Column("ip_subnet_hash", sa.String(64), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("flag_type IN ('DEAL_ENDED','FALSE_PRICE','WRONG_SHOP','SPAM')", name="ck_spotted_flag_type"),
        sa.CheckConstraint("weight > 0 AND weight <= 3", name="ck_spotted_flag_weight"),
        sa.UniqueConstraint("deal_id", "flagger_user_id", name="uq_spotted_deal_flagger"),
    )
    op.create_table("spotted_deal_seen_taps",
        sa.Column("deal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spotted_deals.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")))
    op.create_table("spotted_deal_cooldowns",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("strike_count_60d", sa.Integer(), nullable=False, server_default="0"), sa.Column("locked_until", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")))
    op.create_table("spotted_deal_jury_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("deal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spotted_deals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("juror_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("decision", sa.String(24)), sa.Column("decided_at", sa.DateTime()), sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("decision IS NULL OR decision IN ('UPHOLD_OPT_OUT','UPHOLD_DEAL')", name="ck_jury_decision"),
        sa.UniqueConstraint("deal_id", "juror_user_id", name="uq_spotted_jury_assignment"))
    op.create_index("idx_jury_assignments_pending", "spotted_deal_jury_assignments", ["juror_user_id", "expires_at"], postgresql_where=sa.text("decision IS NULL"))


def downgrade():
    op.drop_table("spotted_deal_jury_assignments")
    op.drop_table("spotted_deal_cooldowns")
    op.drop_table("spotted_deal_seen_taps")
    op.drop_table("spotted_deal_flags")
    op.drop_table("spotted_deals")
    op.drop_constraint("fk_receipt_merchants_spotted_opt_out_by", "receipt_merchants", type_="foreignkey")
    op.drop_column("receipt_merchants", "spotted_opt_out_by")
    op.drop_column("receipt_merchants", "spotted_opt_out_at")
    op.drop_column("receipt_merchants", "allow_spotted_deals")

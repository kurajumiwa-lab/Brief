"""Social seller bio-link verification and stock-in-hand proof.

Revision ID: 0068_social_trust
Revises: 0067_recurring_routines

Everything here is a *signal*, not a verification of the business. A bio-link
match proves a URL contains a handle at the moment it was fetched. A
stock-in-hand photo proves a photograph was uploaded beside a daily code. A
non-delivery report proves a buyer says a delivery did not arrive. None of it
awards standing credit, and none of it is described as KRA- or bank-verified.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0068_social_trust"
down_revision = "0067_recurring_routines"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("vendors", sa.Column("social_links", postgresql.JSONB(), nullable=False,
                                       server_default=sa.text("'[]'::jsonb")))

    op.create_table(
        "social_bio_checks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("profile_url", sa.Text(), nullable=False),
        sa.Column("expected_path", sa.String(120), nullable=False),
        sa.Column("matched", sa.Boolean(), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("failure_reason", sa.String(120), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("platform IN ('tiktok','instagram','facebook')",
                           name="ck_social_bio_platform"),
    )
    op.create_index("idx_social_bio_checks_user", "social_bio_checks",
                    ["user_id", "platform", "checked_at"])

    op.create_table(
        "stock_in_hand_proofs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("challenge_code", sa.String(10), nullable=False),
        sa.Column("challenge_date", sa.Date(), nullable=False),
        sa.Column("item_title", sa.String(120), nullable=False),
        sa.Column("price_kes", sa.Numeric(10, 2), nullable=True),
        sa.Column("proof_image_url", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="ACTIVE"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('ACTIVE','EXPIRED','FLAGGED')",
                           name="ck_stock_proof_status"),
        sa.CheckConstraint("price_kes IS NULL OR price_kes >= 0",
                           name="ck_stock_proof_price_nonnegative"),
    )
    op.create_index("idx_stock_proofs_user", "stock_in_hand_proofs",
                    ["user_id", "status", "expires_at"])
    # A seller has one current photograph. Publishing a new one retires the old.
    op.create_index("uq_stock_proof_active", "stock_in_hand_proofs", ["user_id"],
                    unique=True, postgresql_where=sa.text("status = 'ACTIVE'"))

    op.create_table(
        "seller_delivery_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("seller_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reporter_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        # The report must point at a trade that actually exists between the two
        # accounts. This is what stops drive-by reporting from a stranger.
        sa.Column("trade_proof_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("trade_proofs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("stock_movement_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("stock_movements.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="OPEN"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.CheckConstraint("status IN ('OPEN','RESOLVED','DISMISSED')",
                           name="ck_delivery_report_status"),
        sa.CheckConstraint("reporter_user_id <> seller_user_id",
                           name="ck_delivery_report_not_self"),
        sa.CheckConstraint("trade_proof_id IS NOT NULL OR stock_movement_id IS NOT NULL",
                           name="ck_delivery_report_has_evidence"),
    )
    op.create_index("idx_delivery_reports_seller", "seller_delivery_reports",
                    ["seller_user_id", "status", "created_at"])
    op.create_index("uq_delivery_report_open_pair", "seller_delivery_reports",
                    ["seller_user_id", "reporter_user_id"], unique=True,
                    postgresql_where=sa.text("status = 'OPEN'"))


def downgrade():
    op.drop_index("uq_delivery_report_open_pair", table_name="seller_delivery_reports")
    op.drop_index("idx_delivery_reports_seller", table_name="seller_delivery_reports")
    op.drop_table("seller_delivery_reports")
    op.drop_index("uq_stock_proof_active", table_name="stock_in_hand_proofs")
    op.drop_index("idx_stock_proofs_user", table_name="stock_in_hand_proofs")
    op.drop_table("stock_in_hand_proofs")
    op.drop_index("idx_social_bio_checks_user", table_name="social_bio_checks")
    op.drop_table("social_bio_checks")
    op.drop_column("vendors", "social_links")

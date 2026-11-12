"""Post-trade ratings (Phase 7, PR 102).

Additive: one new table. Nothing existing is altered. Downgrade drops only this table.

Revision ID: 0049_post_trade_ratings
Revises: 0048_add_booking_service_domain
Create Date: 2026-11-13
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0049_post_trade_ratings"
down_revision: str = "0048_add_booking_service_domain"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "post_trade_ratings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("subject_kind", sa.String(length=16), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("supplier_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=True),
        sa.Column("rater_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rater_role", sa.String(length=8), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("stars", sa.SmallInteger(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("subject_kind IN ('appointment', 'movement')", name="ck_post_trade_ratings_kind"),
        sa.CheckConstraint("rater_role IN ('client', 'supplier')", name="ck_post_trade_ratings_role"),
        sa.CheckConstraint("outcome IN ('completed', 'failed', 'fraud')", name="ck_post_trade_ratings_outcome"),
        sa.CheckConstraint("stars IS NULL OR (stars >= 1 AND stars <= 5)", name="ck_post_trade_ratings_stars"),
    )
    op.create_index("uq_post_trade_ratings_subject_role", "post_trade_ratings",
                    ["subject_kind", "subject_id", "rater_role"], unique=True)
    op.create_index("ix_post_trade_ratings_supplier_created", "post_trade_ratings",
                    ["supplier_vendor_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_post_trade_ratings_supplier_created", table_name="post_trade_ratings")
    op.drop_index("uq_post_trade_ratings_subject_role", table_name="post_trade_ratings")
    op.drop_table("post_trade_ratings")

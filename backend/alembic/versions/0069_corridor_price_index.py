"""Live corridor price index.

Revision ID: 0069_corridor_price_index
Revises: 0068_social_trust

A derived, hourly snapshot of the 45-day interquartile price range for a
(region, town, category). It is not a price list and not a valuation: rows are
only written when at least five independent local transactions exist, so the
absence of a row is a deliberate statement rather than a missing feature.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0069_corridor_price_index"
down_revision = "0068_social_trust"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "corridor_price_indices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("region_slug", sa.String(64), nullable=False),
        sa.Column("town", sa.String(64), nullable=False, server_default=sa.text("'ALL'")),
        sa.Column("category_slug", sa.String(64), nullable=False),
        # At least five independent local points — the table refuses a guess.
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("p25_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("median_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("p75_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("sample_count >= 5", name="ck_corridor_price_min_sample"),
        sa.CheckConstraint(
            "p25_kes >= 0 AND median_kes >= 0 AND p75_kes >= 0",
            name="ck_corridor_price_nonnegative",
        ),
        sa.UniqueConstraint("region_slug", "town", "category_slug",
                            name="uq_corridor_price_scope"),
    )
    op.create_index("ix_corridor_price_lookup", "corridor_price_indices",
                    ["region_slug", "category_slug", "town"])


def downgrade():
    op.drop_index("ix_corridor_price_lookup", table_name="corridor_price_indices")
    op.drop_table("corridor_price_indices")

"""Seller-reported market opportunities.

Revision ID: 0084_market_opportunities
Revises: 0083_merit
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0084_market_opportunities"
down_revision = "0083_merit"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("market_opportunities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("location", sa.String(160), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 2), nullable=False),
        sa.Column("unit", sa.String(100), nullable=False),
        sa.Column("price_kes", sa.Numeric(12, 2), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_market_opportunity_quantity"),
        sa.CheckConstraint("price_kes > 0", name="ck_market_opportunity_price"),
    )
    op.create_index("ix_market_opportunities_seller_id", "market_opportunities", ["seller_id"])
    op.create_index("ix_market_opportunities_active_updated", "market_opportunities", ["active", "updated_at"])


def downgrade():
    op.drop_table("market_opportunities")

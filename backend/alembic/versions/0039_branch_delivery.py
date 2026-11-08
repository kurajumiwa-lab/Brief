"""MarketTrust: how a shop delivers. Pick-up is always there; a rider the buyer knows is optional.

Additive only: four nullable or defaulted columns on business_branches. No money columns,
no fee columns, no link to sales or payments. The rider agrees the fee with the buyer directly.

Revision ID: 0039_branch_delivery
Revises: 0038_customer_reviews
Create Date: 2026-11-09
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0039_branch_delivery"
down_revision: str = "0038_customer_reviews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("business_branches", sa.Column(
        "delivery_options", postgresql.JSONB, nullable=False,
        server_default=sa.text("'[\"pickup\"]'::jsonb")))
    op.add_column("business_branches", sa.Column("delivery_area", sa.String(120), nullable=True))
    op.add_column("business_branches", sa.Column("rider_name", sa.String(60), nullable=True))
    op.add_column("business_branches", sa.Column("rider_phone", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("business_branches", "rider_phone")
    op.drop_column("business_branches", "rider_name")
    op.drop_column("business_branches", "delivery_area")
    op.drop_column("business_branches", "delivery_options")

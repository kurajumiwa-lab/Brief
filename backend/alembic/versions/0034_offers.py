"""Verified offer shelf: the manual confirmation record.

Additive only: one new table. Downgrade drops only that table.

Revision ID: 0034_offers
Revises: 0033_calendar
Create Date: 2026-11-05
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0034_offers"
down_revision: str = "0033_calendar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "offer_confirmations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("stock_item_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("stock_items.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("confirmed_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("length(reason) >= 10", name="ck_offer_confirmations_reason"),
    )


def downgrade() -> None:
    op.drop_table("offer_confirmations")

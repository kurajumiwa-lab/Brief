"""Fluid Teams: partner teams between home offices (Phase 7, PR 3).

Additive: one new table. Nothing existing is altered. Downgrade drops only this table.

Revision ID: 0050_office_partners
Revises: 0049_post_trade_ratings
Create Date: 2026-11-13
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0050_office_partners"
down_revision: str = "0049_post_trade_ratings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "office_partners",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("office_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("partner_office_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="invited"),
        sa.Column("invited_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("responded_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('invited', 'active', 'declined', 'removed')",
                           name="ck_office_partners_status"),
        sa.CheckConstraint("office_id <> partner_office_id", name="ck_office_partners_not_self"),
    )
    op.create_index("uq_office_partners_pair", "office_partners", ["office_id", "partner_office_id"], unique=True)
    op.create_index("ix_office_partners_partner", "office_partners", ["partner_office_id"])


def downgrade() -> None:
    op.drop_index("ix_office_partners_partner", table_name="office_partners")
    op.drop_index("uq_office_partners_pair", table_name="office_partners")
    op.drop_table("office_partners")

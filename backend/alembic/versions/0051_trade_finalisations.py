"""Stranded trades: a rating window that closes with no rating (Phase 7, PR 4).

Additive: one new table. Nothing existing is altered. Downgrade drops only this table.

Revision ID: 0051_trade_finalisations
Revises: 0050_office_partners
Create Date: 2026-11-13
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0051_trade_finalisations"
down_revision: str = "0050_office_partners"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trade_finalisations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("subject_kind", sa.String(length=16), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("finalised_at", sa.DateTime(), nullable=False),
        sa.Column("reason", sa.String(length=24), nullable=False),
        sa.CheckConstraint("subject_kind IN ('appointment', 'movement')", name="ck_trade_finalisations_kind"),
    )
    op.create_index("uq_trade_finalisations_subject", "trade_finalisations",
                    ["subject_kind", "subject_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_trade_finalisations_subject", table_name="trade_finalisations")
    op.drop_table("trade_finalisations")

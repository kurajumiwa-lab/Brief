"""Home office noticeboard (Fluid Teams, PR 4).

Additive: one new table. Nothing existing is altered. Downgrade drops only this table.

Revision ID: 0052_office_notices
Revises: 0051_trade_finalisations
Create Date: 2026-11-13
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0052_office_notices"
down_revision: str = "0051_trade_finalisations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "office_notices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("office_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body", sa.String(length=4000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(btrim(title)) > 0", name="ck_office_notices_title_nonblank"),
        sa.CheckConstraint("length(btrim(body)) > 0", name="ck_office_notices_body_nonblank"),
    )
    op.create_index("ix_office_notices_office_created", "office_notices", ["office_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_office_notices_office_created", table_name="office_notices")
    op.drop_table("office_notices")

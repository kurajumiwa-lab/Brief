"""Ecosystem integrations (P4): provenance for facts that come from outside systems.

Additive. Creates external_facts only. Nothing existing is changed.

Revision ID: 0056_external_facts
Revises: 0055_service_mode_prices
Create Date: 2026-11-17
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0056_external_facts"
down_revision: str = "0055_service_mode_prices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "external_facts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fact_kind", sa.String(length=40), nullable=False),
        sa.Column("state", sa.String(length=12), nullable=False),
        sa.Column("method", sa.String(length=20), nullable=False),
        sa.Column("source_system", sa.String(length=120), nullable=False),
        sa.Column("reference", sa.String(length=200), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("reviewer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("next_review_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("state IN ('declared', 'verified', 'failed')", name="ck_external_fact_state"),
        sa.CheckConstraint("method IN ('api', 'export', 'attested_upload', 'manual')",
                           name="ck_external_fact_method"),
    )
    op.create_index("ix_external_facts_vendor_id", "external_facts", ["vendor_id"])
    op.create_index("ix_external_facts_vendor_kind", "external_facts", ["vendor_id", "fact_kind"])


def downgrade() -> None:
    op.drop_index("ix_external_facts_vendor_kind", table_name="external_facts")
    op.drop_index("ix_external_facts_vendor_id", table_name="external_facts")
    op.drop_table("external_facts")

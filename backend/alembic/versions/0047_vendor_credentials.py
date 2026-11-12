"""Credentials and licences (service-providers plan, Phase 4).

Additive: one new table, vendor_credentials. Nothing existing is altered or dropped.

A credential is a claim a provider makes about a professional registration (for example a
nursing council number). It starts as self_declared. Only an operator can move it to
verified or rejected, and the verifier is recorded. A credential never changes a vendor's
visibility. Downgrade drops only this table.

Revision ID: 0047_vendor_credentials
Revises: 0046_service_delivery_units
Create Date: 2026-11-12
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0047_vendor_credentials"
down_revision: str = "0046_service_delivery_units"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vendor_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issuing_body", sa.String(length=150), nullable=False),
        sa.Column("registration_number", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="self_declared"),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("verified_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('self_declared', 'pending_review', 'verified', 'rejected')",
                           name="ck_vendor_credentials_status"),
    )
    op.create_index("ix_vendor_credentials_vendor_id", "vendor_credentials", ["vendor_id"])
    op.create_index("ix_vendor_credentials_status", "vendor_credentials", ["status"])


def downgrade() -> None:
    op.drop_index("ix_vendor_credentials_status", table_name="vendor_credentials")
    op.drop_index("ix_vendor_credentials_vendor_id", table_name="vendor_credentials")
    op.drop_table("vendor_credentials")

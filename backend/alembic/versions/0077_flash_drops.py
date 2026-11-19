"""Inventory-capped 60-minute flash drops.

Revision ID: 0077_flash_drops
Revises: 0076_lead_ledger
Create Date: 2026-11-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0077_flash_drops"
down_revision = "0076_lead_ledger"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "flash_drops",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("claimed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("starts_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="live"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("capacity BETWEEN 1 AND 1000", name="ck_flash_drops_capacity"),
        sa.CheckConstraint("claimed_count >= 0 AND claimed_count <= capacity",
                           name="ck_flash_drops_claimed"),
        sa.CheckConstraint("price_kes >= 0", name="ck_flash_drops_price"),
        sa.CheckConstraint("ends_at > starts_at", name="ck_flash_drops_window"),
        sa.CheckConstraint("status IN ('live','closed','cancelled')",
                           name="ck_flash_drops_status"),
    )
    op.create_index("ix_flash_drops_live_window", "flash_drops",
                    ["status", "starts_at", "ends_at"])
    op.create_index("ix_flash_drops_vendor", "flash_drops", ["vendor_id", "created_at"])
    op.create_table(
        "flash_drop_claims",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("drop_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("flash_drops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("drop_id", "vendor_id", name="uq_flash_drop_claims_person"),
    )
    op.create_index("ix_flash_drop_claims_vendor", "flash_drop_claims",
                    ["vendor_id", "created_at"])


def downgrade():
    op.drop_table("flash_drop_claims")
    op.drop_table("flash_drops")

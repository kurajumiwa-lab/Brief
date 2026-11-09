"""Home office (S1): offices, members, and calendar events.

Additive only. No money columns. Links are single-use and stored only as hashes.

Revision ID: 0040_home_office
Revises: 0039_branch_delivery
Create Date: 2026-11-10
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0040_home_office"
down_revision: str = "0039_branch_delivery"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "offices",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("owner_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("nature", sa.String(120), nullable=False),
        sa.Column("area", sa.String(120), nullable=False),
        sa.Column("hours_text", sa.String(200)),
        sa.Column("contact_mode", sa.String(8), nullable=False, server_default="none"),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("contact_mode IN ('none', 'phone', 'email')", name="ck_offices_contact_mode"),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_offices_status"),
    )
    op.create_index("ix_offices_owner_vendor_id", "offices", ["owner_vendor_id"])

    op.create_table(
        "office_members",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("office_id", UUID, sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="CASCADE")),
        sa.Column("display_name", sa.String(60)),
        sa.Column("function_label", sa.String(80)),
        sa.Column("role", sa.String(12), nullable=False, server_default="staff"),
        sa.Column("status", sa.String(12), nullable=False, server_default="invited"),
        sa.Column("invite_token_hash", sa.String(64), unique=True),
        sa.Column("invite_expires_at", sa.DateTime),
        sa.Column("invited_by_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("responded_at", sa.DateTime),
        sa.CheckConstraint("role IN ('owner', 'editor', 'approver', 'member', 'partner', 'staff')",
                           name="ck_office_members_role"),
        sa.CheckConstraint("status IN ('invited', 'active', 'removed')", name="ck_office_members_status"),
        sa.CheckConstraint("NOT (vendor_id IS NOT NULL AND display_name IS NOT NULL)", name="ck_office_members_identity"),
    )
    op.create_index("ix_office_members_office_id", "office_members", ["office_id"])
    op.create_index("uq_office_member_account", "office_members", ["office_id", "vendor_id"], unique=True,
                    postgresql_where=text("vendor_id IS NOT NULL"))

    op.create_table(
        "office_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("office_id", UUID, sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity", sa.String(80), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("starts_at", sa.DateTime, nullable=False),
        sa.Column("ends_at", sa.DateTime, nullable=False),
        sa.Column("location_text", sa.String(200)),
        sa.Column("created_by_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ck_office_events_order"),
    )
    op.create_index("ix_office_events_office_id", "office_events", ["office_id"])
    op.create_index("ix_office_events_starts_at", "office_events", ["starts_at"])


def downgrade() -> None:
    op.drop_table("office_events")
    op.drop_table("office_members")
    op.drop_table("offices")

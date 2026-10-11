"""Growth motion, plan entitlements and team seats (v2.12).

Adds subscription tier and server-side entitlement columns to `vendors`, plus
`vendor_team_members` and the append-only `plan_entitlement_events` table.

Revision ID: 0016_growth_motion_entitlements
Revises: 0015_business_standing
Create Date: 2026-10-12
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "0016_growth_motion_entitlements"
down_revision: str = "0015_business_standing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendors",
        sa.Column("plan_tier", sa.String(24), nullable=False, server_default="starter"),
    )
    op.add_column(
        "vendors",
        sa.Column("plan_seats_limit", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "vendors",
        sa.Column("plan_watches_limit", sa.Integer(), nullable=False, server_default="10"),
    )
    op.add_column(
        "vendors",
        sa.Column("plan_updated_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "vendor_team_members",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_email", sa.String(255), nullable=False),
        sa.Column("member_handle", sa.String(100), nullable=True),
        sa.Column("role", sa.String(24), nullable=False, server_default="clerk"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("added_by_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("role IN ('owner','finance','clerk')", name="ck_vendor_team_member_role"),
        sa.CheckConstraint("status IN ('active','revoked')", name="ck_vendor_team_member_status"),
        sa.UniqueConstraint("vendor_id", "member_email", name="uq_vendor_team_member_email"),
    )
    op.create_index("ix_vendor_team_members_vendor_id", "vendor_team_members", ["vendor_id"])
    op.create_index("ix_vendor_team_members_vendor_status", "vendor_team_members", ["vendor_id", "status"])

    op.create_table(
        "plan_entitlement_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("previous_tier", sa.String(24), nullable=True),
        sa.Column("new_tier", sa.String(24), nullable=True),
        sa.Column("actor_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_plan_entitlement_events_vendor_id", "plan_entitlement_events", ["vendor_id"])
    op.create_index(
        "ix_plan_entitlement_events_vendor_created",
        "plan_entitlement_events",
        ["vendor_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_plan_entitlement_events_vendor_created", table_name="plan_entitlement_events")
    op.drop_index("ix_plan_entitlement_events_vendor_id", table_name="plan_entitlement_events")
    op.drop_table("plan_entitlement_events")

    op.drop_index("ix_vendor_team_members_vendor_status", table_name="vendor_team_members")
    op.drop_index("ix_vendor_team_members_vendor_id", table_name="vendor_team_members")
    op.drop_table("vendor_team_members")

    op.drop_column("vendors", "plan_updated_at")
    op.drop_column("vendors", "plan_watches_limit")
    op.drop_column("vendors", "plan_seats_limit")
    op.drop_column("vendors", "plan_tier")

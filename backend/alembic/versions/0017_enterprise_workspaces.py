"""Enterprise workspaces, memberships and managed devices (v2.13).

Adds the paid, private side of the dual model on top of the existing
vendor network: `enterprise_workspaces`, `enterprise_memberships`,
`managed_devices` and the append-only `device_commands` audit trail.
No existing table is altered — a workspace wraps ordinary vendors.

Revision ID: 0017_enterprise_workspaces
Revises: 0016_growth_motion_entitlements
Create Date: 2026-10-14
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "0017_enterprise_workspaces"
down_revision: str = "0016_growth_motion_entitlements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "enterprise_workspaces",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("org_type", sa.String(32), nullable=False, server_default="trade_association"),
        sa.Column("region", sa.String(120), nullable=False, server_default="Kisumu"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("branding", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("owner_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("plan_key", sa.String(24), nullable=False, server_default="pilot"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("android_enterprise_id", sa.String(200), nullable=True),
        sa.Column("emm_provider", sa.String(80), nullable=False, server_default="none"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "org_type IN ('trade_association','cooperative','business','employer','county_org','other')",
            name="ck_enterprise_workspace_org_type"),
        sa.CheckConstraint("status IN ('active','suspended')", name="ck_enterprise_workspace_status"),
    )
    op.create_index("ix_enterprise_workspaces_slug", "enterprise_workspaces", ["slug"], unique=True)
    op.create_index("ix_enterprise_workspaces_owner", "enterprise_workspaces", ["owner_vendor_id"])
    op.create_index("ix_enterprise_workspaces_public", "enterprise_workspaces", ["is_public", "status"])

    op.create_table(
        "enterprise_memberships",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("enterprise_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(24), nullable=False, server_default="member"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("registered_by_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "role IN ('owner','admin','field_officer','member','viewer')",
            name="ck_enterprise_membership_role"),
        sa.CheckConstraint("status IN ('active','revoked')", name="ck_enterprise_membership_status"),
        sa.UniqueConstraint("workspace_id", "vendor_id", name="uq_enterprise_membership_vendor"),
    )
    op.create_index("ix_enterprise_memberships_workspace_id", "enterprise_memberships", ["workspace_id"])
    op.create_index("ix_enterprise_memberships_vendor_id", "enterprise_memberships", ["vendor_id"])
    op.create_index("ix_enterprise_memberships_workspace_status",
                    "enterprise_memberships", ["workspace_id", "status"])
    op.create_index("ix_enterprise_memberships_vendor_status",
                    "enterprise_memberships", ["vendor_id", "status"])
    op.create_index("ix_enterprise_memberships_registered_by",
                    "enterprise_memberships", ["registered_by_vendor_id"])

    op.create_table(
        "managed_devices",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("enterprise_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assigned_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("enrolled_by_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("device_ref", sa.String(120), nullable=True),
        sa.Column("emm_device_id", sa.String(200), nullable=True),
        sa.Column("enrolment_mode", sa.String(24), nullable=False, server_default="work_profile"),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("policy_name", sa.String(200), nullable=True),
        sa.Column("enrolled_at", sa.DateTime(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "enrolment_mode IN ('fully_managed','work_profile','dedicated')",
            name="ck_managed_device_enrolment_mode"),
        sa.CheckConstraint(
            "status IN ('pending','enrolled','active','locked','suspended','retired')",
            name="ck_managed_device_status"),
    )
    op.create_index("ix_managed_devices_workspace_id", "managed_devices", ["workspace_id"])
    op.create_index("ix_managed_devices_workspace_status", "managed_devices", ["workspace_id", "status"])
    op.create_index("ix_managed_devices_assigned", "managed_devices", ["assigned_vendor_id"])

    op.create_table(
        "device_commands",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("enterprise_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("managed_devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("command_type", sa.String(24), nullable=False),
        sa.Column("enrolment_mode", sa.String(24), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("requested_by_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="requested"),
        sa.Column("dispatched", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("result_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "command_type IN ('lock','wipe_work_data','wipe_device','lost_mode')",
            name="ck_device_command_type"),
        sa.CheckConstraint(
            "status IN ('requested','dispatched','acknowledged','failed','rejected','cancelled')",
            name="ck_device_command_status"),
        sa.CheckConstraint(
            "enrolment_mode IN ('fully_managed','work_profile','dedicated')",
            name="ck_device_command_enrolment_mode"),
    )
    op.create_index("ix_device_commands_workspace_id", "device_commands", ["workspace_id"])
    op.create_index("ix_device_commands_device_id", "device_commands", ["device_id"])
    op.create_index("ix_device_commands_workspace_created", "device_commands", ["workspace_id", "created_at"])
    op.create_index("ix_device_commands_device_created", "device_commands", ["device_id", "created_at"])


def downgrade() -> None:
    op.drop_table("device_commands")
    op.drop_table("managed_devices")
    op.drop_table("enterprise_memberships")
    op.drop_table("enterprise_workspaces")

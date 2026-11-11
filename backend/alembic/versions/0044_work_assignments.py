"""Workers (Phase 4): work assigned to an active member of a home office.

Additive: one new table, with named CHECKs and indexes. Nothing existing is changed. Workers
are existing office members (office_members, roles and function labels), so no new identity or
membership table is created. History is written to the existing audit_events table.

Revision ID: 0044_work_assignments
Revises: 0043_offering_lifecycle
Create Date: 2026-11-11
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0044_work_assignments"
down_revision: str = "0043_offering_lifecycle"
branch_labels = None
depends_on = None

STATUSES = "('assigned', 'in_progress', 'done', 'cancelled')"


def upgrade() -> None:
    op.create_table(
        "work_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("office_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignee_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("assigned_by_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="assigned"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"status IN {STATUSES}", name="ck_work_assignments_status"),
        sa.CheckConstraint("char_length(btrim(title)) > 0", name="ck_work_assignments_title_nonblank"),
        sa.CheckConstraint("status <> 'done' OR completed_at IS NOT NULL",
                           name="ck_work_assignments_done_has_time"),
    )
    op.create_index("ix_work_assignments_assignee_status", "work_assignments",
                    ["assignee_vendor_id", "status"])
    op.create_index("ix_work_assignments_office_status", "work_assignments", ["office_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_work_assignments_office_status", table_name="work_assignments")
    op.drop_index("ix_work_assignments_assignee_status", table_name="work_assignments")
    op.drop_table("work_assignments")

"""Recurring hustle routines and their generated weekly instances.

Revision ID: 0067_recurring_routines
Revises: 0066_wfh_tasks

A routine is a template plus a weekly slot. The hourly sweep turns it into an
ordinary `local_activities` listing, so discovery, expiry (0064) and sharing
work unchanged. `recurring_routine_instances` is the idempotency guard: a
unique (routine_id, occurrence_date) row means two overlapping sweeps can
never publish the same market day twice.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0067_recurring_routines"
down_revision = "0066_wfh_tasks"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("local_activities", sa.Column("recurring_routine_id",
                                                postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("local_activities", sa.Column("recurrence_label", sa.String(64), nullable=True))
    op.create_index("idx_local_activities_routine", "local_activities",
                    ["recurring_routine_id", "starts_at"],
                    postgresql_where=sa.text("recurring_routine_id IS NOT NULL"))

    op.create_table(
        "recurring_routines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("region_slug", sa.String(64), nullable=False),
        sa.Column("town", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("title", sa.String(140), nullable=False),
        sa.Column("template_payload", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("day_of_week", sa.SmallInteger(), nullable=False),
        sa.Column("start_time_local", sa.Time(), nullable=False),
        sa.Column("duration_hours", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("publish_lead_hours", sa.Integer(), nullable=False, server_default="48"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_generated_for_date", sa.Date(), nullable=True),
        sa.Column("last_generated_activity_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("local_activities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('scheduled','event','offer')", name="ck_routines_kind"),
        sa.CheckConstraint("day_of_week BETWEEN 0 AND 6", name="ck_routines_day_of_week"),
        sa.CheckConstraint("duration_hours BETWEEN 1 AND 72", name="ck_routines_duration"),
        sa.CheckConstraint("publish_lead_hours BETWEEN 0 AND 336", name="ck_routines_lead"),
    )
    op.create_index("idx_routines_owner", "recurring_routines", ["owner_user_id", "is_active"])
    op.create_index("idx_routines_due", "recurring_routines",
                    ["day_of_week", "publish_lead_hours"], postgresql_where=sa.text("is_active"))

    op.create_foreign_key("fk_local_activities_routine", "local_activities",
                          "recurring_routines", ["recurring_routine_id"], ["id"],
                          ondelete="SET NULL")

    op.create_table(
        "recurring_routine_instances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("routine_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("recurring_routines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("local_activities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("whatsapp_shared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("routine_id", "occurrence_date",
                            name="uq_routine_instance_occurrence"),
    )
    op.create_index("idx_routine_instances_recent", "recurring_routine_instances",
                    ["routine_id", "created_at"])


def downgrade():
    op.drop_index("idx_routine_instances_recent", table_name="recurring_routine_instances")
    op.drop_table("recurring_routine_instances")
    op.drop_constraint("fk_local_activities_routine", "local_activities", type_="foreignkey")
    op.drop_index("idx_routines_due", table_name="recurring_routines")
    op.drop_index("idx_routines_owner", table_name="recurring_routines")
    op.drop_table("recurring_routines")
    op.drop_index("idx_local_activities_routine", table_name="local_activities")
    op.drop_column("local_activities", "recurrence_label")
    op.drop_column("local_activities", "recurring_routine_id")

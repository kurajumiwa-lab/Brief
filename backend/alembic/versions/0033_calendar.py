"""Brief calendar: plans, bookable services, opening hours and appointments.

Additive only: four new tables, nothing existing is altered. The downgrade drops
only these tables.

Revision ID: 0033_calendar
Revises: 0032_free_for_now_modules
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0033_calendar"
down_revision: str = "0032_free_for_now_modules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schedule_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False, server_default="plan"),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("location", sa.String(300)),
        sa.Column("notes", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ck_schedule_entries_dates"),
        sa.CheckConstraint("kind IN ('plan', 'task', 'meeting', 'reminder')", name="ck_schedule_entries_kind"),
        sa.CheckConstraint("status IN ('planned', 'done', 'cancelled')", name="ck_schedule_entries_status"),
    )
    op.create_index("ix_schedule_entries_owner_start", "schedule_entries", ["vendor_id", "starts_at"])

    op.create_table(
        "booking_services",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("buffer_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("price_kes", sa.Integer()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("duration_minutes > 0 AND duration_minutes <= 480", name="ck_booking_services_duration"),
        sa.CheckConstraint("buffer_minutes >= 0 AND buffer_minutes <= 120", name="ck_booking_services_buffer"),
        sa.CheckConstraint("price_kes IS NULL OR price_kes >= 0", name="ck_booking_services_price"),
    )
    op.create_index("ix_booking_services_vendor_id", "booking_services", ["vendor_id"])

    op.create_table(
        "availability_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_minute", sa.Integer(), nullable=False),
        sa.Column("end_minute", sa.Integer(), nullable=False),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_availability_weekday"),
        sa.CheckConstraint("start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute",
                           name="ck_availability_window"),
    )
    op.create_index("ix_availability_rules_vendor", "availability_rules", ["vendor_id", "weekday"])

    op.create_table(
        "appointments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("booking_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("client_name", sa.String(200), nullable=False),
        sa.Column("client_phone", sa.String(40)),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="requested"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ck_appointments_dates"),
        sa.CheckConstraint(
            "status IN ('requested', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show')",
            name="ck_appointments_status",
        ),
    )
    op.create_index("ix_appointments_host_start", "appointments", ["vendor_id", "starts_at"])
    op.create_index("ix_appointments_client_start", "appointments", ["client_vendor_id", "starts_at"])


def downgrade() -> None:
    op.drop_index("ix_appointments_client_start", table_name="appointments")
    op.drop_index("ix_appointments_host_start", table_name="appointments")
    op.drop_table("appointments")
    op.drop_index("ix_availability_rules_vendor", table_name="availability_rules")
    op.drop_table("availability_rules")
    op.drop_index("ix_booking_services_vendor_id", table_name="booking_services")
    op.drop_table("booking_services")
    op.drop_index("ix_schedule_entries_owner_start", table_name="schedule_entries")
    op.drop_table("schedule_entries")

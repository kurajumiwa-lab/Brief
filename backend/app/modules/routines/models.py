"""Recurring hustle routines (migration 0067).

A vendor who runs the same Saturday delivery or Friday clinic should not retype
it every week. A routine stores the weekly slot and a template; an hourly sweep
publishes an ordinary `local_activities` row when the lead window opens.

Idempotency is structural: `recurring_routine_instances` has a unique
(routine_id, occurrence_date), so two sweeps — or two servers — can never
publish the same market day twice.
"""

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer,
    SmallInteger, String, Time, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

KINDS = ("scheduled", "event", "offer")
KIND_LABELS = {"scheduled": "Scheduled round", "event": "Pop-up", "offer": "Weekly offer"}
DAY_NAMES = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")


def weekly_label(day_of_week: int) -> str:
    """The exact pill shown on cards: `Weekly • Every Sat`."""
    if not 0 <= int(day_of_week) <= 6:
        return ""
    return f"Weekly • Every {DAY_NAMES[int(day_of_week)]}"


class RecurringRoutine(Base):
    __tablename__ = "recurring_routines"
    __table_args__ = (
        CheckConstraint("kind IN ('scheduled','event','offer')", name="ck_routines_kind"),
        CheckConstraint("day_of_week BETWEEN 0 AND 6", name="ck_routines_day_of_week"),
        CheckConstraint("duration_hours BETWEEN 1 AND 72", name="ck_routines_duration"),
        CheckConstraint("publish_lead_hours BETWEEN 0 AND 336", name="ck_routines_lead"),
        Index("idx_routines_owner", "owner_user_id", "is_active"),
        Index("idx_routines_due", "day_of_week", "publish_lead_hours",
              postgresql_where=text("is_active")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                           nullable=False)
    region_slug = Column(String(64), nullable=False)
    town = Column(String(64), nullable=False)
    kind = Column(String(24), nullable=False)
    title = Column(String(140), nullable=False)
    template_payload = Column(JSONB, nullable=False, default=dict,
                              server_default=text("'{}'::jsonb"))
    day_of_week = Column(SmallInteger, nullable=False)
    start_time_local = Column(Time(), nullable=False)
    duration_hours = Column(Integer, nullable=False, default=6, server_default="6")
    publish_lead_hours = Column(Integer, nullable=False, default=48, server_default="48")
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    last_generated_for_date = Column(Date, nullable=True)
    last_generated_activity_id = Column(
        UUID(as_uuid=True), ForeignKey("local_activities.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))


class RecurringRoutineInstance(Base):
    """The idempotency guard: one row per routine per calendar occurrence."""

    __tablename__ = "recurring_routine_instances"
    __table_args__ = (
        UniqueConstraint("routine_id", "occurrence_date", name="uq_routine_instance_occurrence"),
        Index("idx_routine_instances_recent", "routine_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    routine_id = Column(UUID(as_uuid=True), ForeignKey("recurring_routines.id", ondelete="CASCADE"),
                        nullable=False)
    occurrence_date = Column(Date, nullable=False)
    activity_id = Column(UUID(as_uuid=True), ForeignKey("local_activities.id", ondelete="SET NULL"),
                         nullable=True)
    whatsapp_shared_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))

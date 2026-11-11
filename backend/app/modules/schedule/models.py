"""Brief calendar: personal plans, bookable services and appointments.

Times are stored as local Nairobi wall-clock time (naive). Kenya has no daylight
saving, and events and tool bookings use the same plain times, so no conversion
happens anywhere in this module.

Four tables, all additive:
- schedule_entries      a vendor's own plans, tasks, meetings and reminders (private)
- booking_services      what a vendor offers to be booked for (name, length, buffer, price)
- availability_rules    weekly opening windows for a vendor's services
- appointments          a booking from a client vendor to a host vendor (needs confirmation)
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base

ENTRY_KINDS = ("plan", "task", "meeting", "reminder")
ENTRY_STATUSES = ("planned", "done", "cancelled")

APPOINTMENT_STATUSES = ("requested", "confirmed", "declined", "cancelled", "completed", "no_show")
# Statuses that hold a time slot (so nobody else can take it).
HOLDING_STATUSES = ("requested", "confirmed", "completed")


class ScheduleEntry(Base):
    __tablename__ = "schedule_entries"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ck_schedule_entries_dates"),
        CheckConstraint(f"kind IN {ENTRY_KINDS}", name="ck_schedule_entries_kind"),
        CheckConstraint(f"status IN {ENTRY_STATUSES}", name="ck_schedule_entries_status"),
        Index("ix_schedule_entries_owner_start", "vendor_id", "starts_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    kind = Column(String(30), nullable=False, default="plan")
    starts_at = Column(DateTime, nullable=False)
    ends_at = Column(DateTime, nullable=False)
    location = Column(String(300))
    notes = Column(Text)
    status = Column(String(20), nullable=False, default="planned")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class BookableService(Base):
    __tablename__ = "booking_services"
    __table_args__ = (
        CheckConstraint("price_mode IN ('fixed', 'negotiable', 'ask_me')", name="ck_booking_services_price_mode"),
        CheckConstraint("service_radius_km IS NULL OR (service_radius_km > 0 AND service_radius_km <= 500)", name="ck_booking_services_radius"),
        CheckConstraint("duration_minutes > 0 AND duration_minutes <= 480", name="ck_booking_services_duration"),
        CheckConstraint("buffer_minutes >= 0 AND buffer_minutes <= 120", name="ck_booking_services_buffer"),
        CheckConstraint("price_kes IS NULL OR price_kes >= 0", name="ck_booking_services_price"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    duration_minutes = Column(Integer, nullable=False, default=30)
    buffer_minutes = Column(Integer, nullable=False, default=0)
    price_kes = Column(Integer)  # shown to clients only; no payment is taken here
    is_active = Column(Boolean, nullable=False, default=True)
    price_mode = Column(String(12), nullable=False, default="fixed", server_default="fixed")  # fixed | negotiable | ask_me
    # Phase 1 (service providers): where the service is given, and what the price is per.
    delivery_clinic = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    delivery_home = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    delivery_remote = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    price_unit = Column(String(30), nullable=True)  # visit | hour | shift | ...; NULL = not stated
    archived_at = Column(DateTime, nullable=True)  # set = archived (kept, hidden from lists)
    service_radius_km = Column(Integer, nullable=True)  # how far the offer reaches, 1..500
    images = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AvailabilityRule(Base):
    __tablename__ = "availability_rules"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_availability_weekday"),
        CheckConstraint("start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute",
                        name="ck_availability_window"),
        Index("ix_availability_rules_vendor", "vendor_id", "weekday"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    weekday = Column(Integer, nullable=False)       # 0 = Monday … 6 = Sunday
    start_minute = Column(Integer, nullable=False)  # minutes after local midnight
    end_minute = Column(Integer, nullable=False)


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ck_appointments_dates"),
        CheckConstraint(f"status IN {APPOINTMENT_STATUSES}", name="ck_appointments_status"),
        Index("ix_appointments_host_start", "vendor_id", "starts_at"),
        Index("ix_appointments_client_start", "client_vendor_id", "starts_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    service_id = Column(UUID(as_uuid=True), ForeignKey("booking_services.id", ondelete="CASCADE"), nullable=False)
    client_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"))
    client_name = Column(String(200), nullable=False)
    client_phone = Column(String(40))
    starts_at = Column(DateTime, nullable=False)
    ends_at = Column(DateTime, nullable=False)
    status = Column(String(20), nullable=False, default="requested")
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    service = relationship("BookableService")

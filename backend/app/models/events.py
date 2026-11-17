import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base

# Event payment rails (spec §1A). FREE means no M-Pesa tag is shown and a
# booking is confirmed at once; the other four all render the 1-tap copyable
# tag. POCHI/SEND_MONEY are phone-number rails, TILL/PAYBILL are business
# numbers — the distinction only changes the label the client shows.
PAYMENT_METHODS = ("TILL", "PAYBILL", "POCHI", "SEND_MONEY", "FREE")

# Paid vs. waitlist state machine (spec §3). `booking_status` is the payment
# state; the legacy `status` column stays as the attendance state so every
# existing reader (agenda, event hub, reminders, check-in) keeps working:
#
#   booking_status    status        occupies a seat?
#   PENDING_PAYMENT   registered    yes (hold until hold_expires_at)
#   PAYMENT_SUBMITTED registered    yes (hold extended, awaiting host)
#   CONFIRMED         confirmed     yes (pass unlocked)
#   WAITLISTED        waitlisted    no
#   EXPIRED           expired       no (hold lapsed, seat freed)
#   CANCELLED         cancelled     no
#
# Free events skip the payment states: booking_status is CONFIRMED at once
# while status stays "registered", which is what the pre-payment client and
# the agenda already understand.
BOOKING_STATUSES = (
    "PENDING_PAYMENT", "PAYMENT_SUBMITTED", "CONFIRMED",
    "WAITLISTED", "EXPIRED", "CANCELLED",
)


class Event(Base):
    """
    Events organized by patrons or groups for vendor networking.
    Trade shows, sourcing trips, popup markets, etc.
    """
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint(
            "payment_method IS NULL OR payment_method IN ('TILL','PAYBILL','POCHI','SEND_MONEY','FREE')",
            name="ck_events_payment_method",
        ),
        CheckConstraint(
            "hold_ttl_minutes IS NULL OR hold_ttl_minutes BETWEEN 5 AND 10080",
            name="ck_events_hold_ttl_minutes",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizer_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)
    patron_id = Column(UUID(as_uuid=True), ForeignKey('patrons.id'), nullable=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey('vendor_groups.id'), nullable=True)
    vendor_list_id = Column(UUID(as_uuid=True), ForeignKey('vendor_lists.id'), nullable=True)

    title = Column(String(300), nullable=False)
    description = Column(Text)
    event_type = Column(String(100), default="networking", nullable=False)  # trade_show, sourcing_trip, popup_market, networking, workshop

    # When & Where
    start_date = Column(DateTime, nullable=False, index=True)
    end_date = Column(DateTime, nullable=False)
    location = Column(String(500))
    geo_lat = Column(Float)
    geo_lng = Column(Float)
    is_virtual = Column(Boolean, default=False, nullable=False)
    virtual_link = Column(String(500))

    # Capacity
    max_vendors = Column(Integer, default=50, nullable=False)
    registered_count = Column(Integer, default=0, nullable=False)
    entry_fee = Column(Float, default=0, nullable=False)

    # Structured logistics (spec §1A) — first-class fields so nobody has to
    # squint at a flyer image for where to meet or what to bring.
    meeting_point = Column(Text)  # e.g. "Kencom / Jeevanjee Gardens"
    departure_time = Column(String(32))  # e.g. "06:30 AM"
    inclusions = Column(JSONB, default=list)  # e.g. ["Transport", "Park Entry", "Water"]
    checklist = Column(JSONB, default=list)  # e.g. ["ID / Passport", "Hiking shoes"]

    # 1-tap copyable M-Pesa tag (spec §1A). payment_number is the Till/Paybill/
    # phone number; payment_account is the Paybill account reference only.
    payment_method = Column(String(24))  # TILL | PAYBILL | POCHI | SEND_MONEY | FREE
    payment_number = Column(String(32))  # e.g. "1897219"
    payment_account = Column(String(64))  # e.g. "HIKE26" (Paybill only)
    payment_recipient_name = Column(String(120))  # e.g. "Wallace Chege"
    hold_ttl_minutes = Column(Integer, default=120, nullable=False)  # spot hold before release

    # Public share slug for /e/<slug> (WhatsApp roster + OG card). Nullable
    # unique: old rows backfill in 0061, new rows always set one.
    slug = Column(String(120), unique=True, index=True)

    # Requirements
    vendor_requirements = Column(JSONB, default=dict)
    # e.g. {"min_stock_value": 5000, "categories": ["electronics"]}

    images = Column(JSONB, default=list)
    status = Column(String(50), default="upcoming", nullable=False)  # upcoming, active, completed, cancelled
    reminder_sent_at = Column(DateTime)  # EVENT_REMINDER dispatched (v2.1 §1.3)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    organizer = relationship("Vendor", back_populates="created_events")
    registrations = relationship("EventRegistration", back_populates="event")


class EventRegistration(Base):
    __tablename__ = "event_registrations"
    __table_args__ = (
        UniqueConstraint("event_id", "vendor_id", name="uq_event_vendor"),
        CheckConstraint(
            "booking_status IN ('PENDING_PAYMENT','PAYMENT_SUBMITTED','CONFIRMED','WAITLISTED','EXPIRED','CANCELLED')",
            name="ck_event_registrations_booking_status",
        ),
        # One M-Pesa confirmation code can only ever back one booking, on any
        # event. NULLs (not yet submitted / rejected) never collide.
        UniqueConstraint("mpesa_code", name="uq_event_registrations_mpesa_code"),
        Index("ix_event_registrations_event_booking", "event_id", "booking_status"),
        Index("ix_event_registrations_hold_expiry", "booking_status", "hold_expires_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey('events.id'), nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)

    status = Column(String(50), default="registered", nullable=False)  # registered, confirmed, attended, no_show, waitlisted, expired, cancelled
    booth_assignment = Column(String(100))
    registered_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    checked_in_at = Column(DateTime)  # set by check-in (v2.1 §4.4)
    notes = Column(Text)

    # Paid vs. waitlist state machine (spec §1B).
    booking_status = Column(String(24), nullable=False, default="PENDING_PAYMENT", server_default="PENDING_PAYMENT")
    hold_expires_at = Column(DateTime)  # TIMESTAMPTZ in spec; naive UTC here like every other timestamp
    waitlist_position = Column(Integer)
    # User-declared M-Pesa evidence (spec §2). mpesa_raw_note is the pasted
    # SMS text as the user declared it — it is NOT Daraja proof and is only
    # ever shown to the organiser deciding whether to confirm.
    mpesa_code = Column(String(16))
    mpesa_amount = Column(Numeric(10, 2))
    mpesa_raw_note = Column(Text)
    mpesa_submitted_at = Column(DateTime)
    mpesa_recipient_matched = Column(Boolean)

    event = relationship("Event", back_populates="registrations")
    vendor = relationship("Vendor")


class EventMpesaCode(Base):
    __tablename__ = "event_mpesa_codes"
    code = Column(String(16), primary_key=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base

# One booking table for the three "book a place / a space / a bed" tool flows
# (v2.1 §5.2 warehouse calendar, §5.3 popup shop booking, §5.4 hotel sourcing
# for travelling vendors). They differ only in what `details` carries and in
# how capacity is counted, so they share the calendar, the status machine and
# the notification path.
BOOKING_KINDS = ("warehouse", "popup_shop", "hotel_sourcing")
BOOKING_STATUSES = ("requested", "confirmed", "declined", "cancelled", "completed")

KIND_FROM_CATEGORY = {
    "warehouse": "warehouse",
    "cold_storage": "warehouse",
    "popup_shop": "popup_shop",
    "hotel_sourcing": "hotel_sourcing",
}


class ToolBooking(Base):
    """A dated hold on a tool listing — warehouse space, a popup pitch or a
    hotel bed for a sourcing trip.

    `quantity` is interpreted per kind: m² / pallets for a warehouse, floor
    spaces for a popup, rooms for a hotel. Availability is `capacity - Σ
    overlapping live bookings`, which is what `/tools/{id}/availability-calendar`
    renders day by day.
    """

    __tablename__ = "tool_bookings"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_tool_bookings_quantity"),
        CheckConstraint("end_date > start_date", name="ck_tool_bookings_dates"),
        Index("ix_tool_bookings_calendar", "tool_listing_id", "status", "start_date", "end_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tool_listing_id = Column(UUID(as_uuid=True), ForeignKey('tool_listings.id', ondelete='CASCADE'), nullable=False, index=True)
    booker_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False, index=True)

    kind = Column(String(50), nullable=False, index=True)
    status = Column(String(50), default="requested", nullable=False, index=True)
    # requested → confirmed → completed | declined | cancelled

    start_date = Column(DateTime, nullable=False, index=True)
    end_date = Column(DateTime, nullable=False, index=True)
    quantity = Column(Integer, default=1, nullable=False)
    unit = Column(String(50))           # sqm, pallets, spaces, rooms
    rate = Column(Float)                # price per unit at booking time
    estimated_cost = Column(Float)

    details = Column(JSONB, default=dict)
    # warehouse → {"section": "A3", "pallet_type": "standard"}
    # popup     → {"shared_with": 2, "needs_power": true, "display_tables": 3}
    # hotel     → {"rooms": 2, "guests": 3, "includes_storage": true, "trip": "Mombasa sourcing"}
    notes = Column(Text)
    decision_note = Column(Text)

    requested_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    decided_at = Column(DateTime)
    cancelled_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    listing = relationship("ToolListing")
    booker = relationship("Vendor", foreign_keys=[booker_vendor_id])

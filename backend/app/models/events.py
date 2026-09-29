import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class Event(Base):
    """
    Events organized by patrons or groups for vendor networking.
    Trade shows, sourcing trips, popup markets, etc.
    """
    __tablename__ = "events"

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

    # Requirements
    vendor_requirements = Column(JSONB, default=dict)
    # e.g. {"min_stock_value": 5000, "categories": ["electronics"]}

    images = Column(JSONB, default=list)
    status = Column(String(50), default="upcoming", nullable=False)  # upcoming, active, completed, cancelled

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    organizer = relationship("Vendor", back_populates="created_events")
    registrations = relationship("EventRegistration", back_populates="event")


class EventRegistration(Base):
    __tablename__ = "event_registrations"
    __table_args__ = (UniqueConstraint("event_id", "vendor_id", name="uq_event_vendor"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey('events.id'), nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)

    status = Column(String(50), default="registered", nullable=False)  # registered, confirmed, attended, no_show
    booth_assignment = Column(String(100))
    registered_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    notes = Column(Text)

    event = relationship("Event", back_populates="registrations")
    vendor = relationship("Vendor")

"""
Group collective sourcing (v2.1 §5.3).

Groups of vendors pool buying power: ten electronics vendors collectively
source 10,000 phone cases instead of each buying 1,000. A request gathers
pledges until the target quantity is met, then the organiser negotiates and
orders on the group's behalf.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base

COLLECTIVE_STATUSES = ("gathering", "quota_met", "negotiating", "ordered", "fulfilled", "cancelled")


class CollectiveSourcingRequest(Base):
    __tablename__ = "collective_sourcing"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey('vendor_groups.id'), nullable=False, index=True)
    organizer_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)

    # What the group wants to buy
    item_name = Column(String(300), nullable=False)
    item_category = Column(String(100))
    target_quantity = Column(Integer, nullable=False)
    target_price_per_unit = Column(Float)
    unit_of_measure = Column(String(50), default="units", nullable=False)
    specifications = Column(JSONB, default=dict)
    description = Column(Text)

    # Status
    status = Column(String(50), default="gathering", nullable=False, index=True)
    # gathering → quota_met → negotiating → ordered → fulfilled → cancelled

    current_pledged_quantity = Column(Integer, default=0, nullable=False)
    pledge_count = Column(Integer, default=0, nullable=False)
    deadline = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    pledges = relationship("CollectivePledge", back_populates="request")


class CollectivePledge(Base):
    """One vendor's pledge to a collective sourcing request."""
    __tablename__ = "collective_pledges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(UUID(as_uuid=True), ForeignKey('collective_sourcing.id'), nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False, index=True)

    pledged_quantity = Column(Integer, nullable=False)
    max_price_per_unit = Column(Float)
    status = Column(String(50), default="pledged", nullable=False)  # pledged, confirmed, withdrawn
    notes = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    request = relationship("CollectiveSourcingRequest", back_populates="pledges")
    vendor = relationship("Vendor")

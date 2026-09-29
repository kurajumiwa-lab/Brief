import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class PatronTier(str, PyEnum):
    STARTER = "starter"       # Can create 1 vendor list, up to 20 vendors
    ESTABLISHED = "established"  # Up to 5 lists, 100 vendors each
    MOGUL = "mogul"           # Unlimited lists, arranges events
    LEGEND = "legend"         # Platform governance, revenue share (v2.1 §5.1)


class Patron(Base):
    """
    Patrons organize vendor lists and events.
    They're the community leaders/organizers.
    """
    __tablename__ = "patrons"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), unique=True, nullable=False)
    tier = Column(Enum(PatronTier), default=PatronTier.STARTER, nullable=False)

    # Patron stats
    total_vendors_managed = Column(Integer, default=0, nullable=False)
    total_events_organized = Column(Integer, default=0, nullable=False)
    reputation_score = Column(Float, default=0.0, nullable=False)

    # Patron details
    specialization = Column(JSONB, default=list)  # What kind of vendors they organize
    regions_active = Column(JSONB, default=list)
    bio = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    vendor = relationship("Vendor")
    vendor_lists = relationship("VendorList", back_populates="patron")


class VendorList(Base):
    """
    A curated list of vendors under a patron.
    Vendors register to join. Patron arranges events for them.
    Groups of vendors can also create their own lists.
    """
    __tablename__ = "vendor_lists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patron_id = Column(UUID(as_uuid=True), ForeignKey('patrons.id'), nullable=True)

    name = Column(String(200), nullable=False)
    slug = Column(String(200), unique=True, nullable=False)
    description = Column(Text)
    category = Column(String(100))  # electronics, food, textiles, mixed
    region = Column(String(200))

    # List settings
    is_open = Column(Boolean, default=True, nullable=False)  # Open for new vendor registration
    max_vendors = Column(Integer, default=100, nullable=False)
    requires_approval = Column(Boolean, default=True, nullable=False)
    entry_criteria = Column(JSONB, default=dict)
    # e.g. {"min_stock_value": 1000, "business_categories": ["electronics"]}

    # Group-created list (not patron-created)
    is_group_created = Column(Boolean, default=False, nullable=False)
    creating_group_id = Column(UUID(as_uuid=True), ForeignKey('vendor_groups.id'), nullable=True)

    # Stats
    member_count = Column(Integer, default=0, nullable=False)
    total_stock_value = Column(Float, default=0, nullable=False)
    # Reviews (v2.1 §4.2) — denormalised so browse can rank and filter on them.
    avg_rating = Column(Float, default=0.0, nullable=False, server_default="0")
    review_count = Column(Integer, default=0, nullable=False, server_default="0")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    patron = relationship("Patron", back_populates="vendor_lists")
    memberships = relationship("VendorListMembership", back_populates="vendor_list")
    reviews = relationship("VendorListReview", back_populates="vendor_list", cascade="all, delete-orphan")


class VendorListMembership(Base):
    __tablename__ = "vendor_list_memberships"
    __table_args__ = (UniqueConstraint("vendor_id", "vendor_list_id", name="uq_vendor_list_member"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)
    vendor_list_id = Column(UUID(as_uuid=True), ForeignKey('vendor_lists.id'), nullable=False)

    status = Column(String(50), default="pending", nullable=False)  # pending, approved, rejected, removed
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    approved_at = Column(DateTime)
    role_in_list = Column(String(50), default="member", nullable=False)  # member, co-organizer

    vendor = relationship("Vendor")
    vendor_list = relationship("VendorList", back_populates="memberships")

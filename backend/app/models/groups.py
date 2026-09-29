import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class GroupType(str, PyEnum):
    NICHE = "niche"           # Topic-specific (e.g., "Nairobi Electronics Vendors")
    REGIONAL = "regional"     # Location-based
    TRADE = "trade"           # Specific trade/industry
    SOURCING = "sourcing"     # Formed to source together (buying power)
    EVENT = "event"           # Formed around an event
    OPEN = "open"             # General open group


class VendorGroup(Base):
    """
    Vendors join groups. Groups can:
    - Chat (general and niche topics)
    - Create their own vendor lists
    - Organize events
    - Source together (collective buying power)
    - Share tools/resources
    """
    __tablename__ = "vendor_groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    slug = Column(String(200), unique=True, nullable=False)
    description = Column(Text)
    group_type = Column(Enum(GroupType), default=GroupType.OPEN, nullable=False)

    # Group identity
    category = Column(String(100))
    tags = Column(JSONB, default=list)
    region = Column(String(200))
    logo_url = Column(String(500))

    # Settings
    is_public = Column(Boolean, default=True, nullable=False)
    requires_approval = Column(Boolean, default=False, nullable=False)
    max_members = Column(Integer, default=500, nullable=False)
    rules = Column(JSONB, default=list)

    # Creator
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)

    # Stats
    member_count = Column(Integer, default=0, nullable=False)
    message_count = Column(Integer, default=0, nullable=False)
    collective_stock_value = Column(Float, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    creator = relationship("Vendor", foreign_keys=[created_by_vendor_id])
    memberships = relationship("GroupMembership", back_populates="group")
    chat_room = relationship("ChatRoom", back_populates="group", uselist=False)
    vendor_lists = relationship("VendorList", backref="creating_group",
                                foreign_keys="VendorList.creating_group_id")


class GroupMembership(Base):
    __tablename__ = "group_memberships"
    __table_args__ = (UniqueConstraint("vendor_id", "group_id", name="uq_group_member"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)
    group_id = Column(UUID(as_uuid=True), ForeignKey('vendor_groups.id'), nullable=False)

    role = Column(String(50), default="member", nullable=False)  # admin, moderator, member
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Contribution tracking
    messages_sent = Column(Integer, default=0, nullable=False)
    deals_made_in_group = Column(Integer, default=0, nullable=False)

    vendor = relationship("Vendor")
    group = relationship("VendorGroup", back_populates="memberships")

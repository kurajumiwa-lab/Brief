import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Table, Text
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class VendorRole(str, PyEnum):
    """Every user is a vendor. This tracks their CURRENT mode."""
    SOURCING = "sourcing"       # Currently looking to buy/source
    SELLING = "selling"         # Currently selling/distributing
    BOTH = "both"               # Doing both simultaneously
    DORMANT = "dormant"         # Inactive but still in network


# Vendor-to-vendor relationship (parasitism connections)
vendor_connections = Table(
    'vendor_connections',
    Base.metadata,
    Column('vendor_a_id', UUID(as_uuid=True), ForeignKey('vendors.id'), primary_key=True),
    Column('vendor_b_id', UUID(as_uuid=True), ForeignKey('vendors.id'), primary_key=True),
    Column('connection_type', String(50), default='mutual'),  # mutual, supplier, buyer
    Column('created_at', DateTime, default=datetime.utcnow),
    Column('parasitism_score', Float, default=0.0),  # How much they benefit each other
)


class Vendor(Base):
    """
    NO CONSUMER MODEL EXISTS. Everyone is a Vendor.
    You source today, you sell tomorrow. Fluid roles.
    """
    __tablename__ = "vendors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Identity
    business_name = Column(String(200), nullable=False)
    vendor_handle = Column(String(100), unique=True, nullable=False, index=True)  # @handle
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(20))
    password_hash = Column(String(255), nullable=False)

    # Vendor Nature
    current_role = Column(Enum(VendorRole), default=VendorRole.BOTH, nullable=False)
    business_categories = Column(JSONB, default=list)  # ["electronics", "textiles"]
    business_description = Column(Text)
    physical_location = Column(String(500))
    geo_lat = Column(Float)
    geo_lng = Column(Float)

    # Network Stats
    network_score = Column(Float, default=0.0, nullable=False)  # How active/valuable in network
    total_stock_moved = Column(Integer, default=0, nullable=False)
    total_sourced = Column(Integer, default=0, nullable=False)
    total_supplied = Column(Integer, default=0, nullable=False)
    # SRM-lite (v2.1 §3.4): how reliably this vendor fulfils what it confirms.
    movements_completed = Column(Integer, default=0, nullable=False, server_default="0")
    movements_cancelled = Column(Integer, default=0, nullable=False, server_default="0")
    parasitism_index = Column(Float, default=0.0, nullable=False)  # Mutual benefit score

    # POS Integration
    has_pos_connected = Column(Boolean, default=False, nullable=False)
    pos_system_type = Column(String(50))  # square, shopify, custom

    # Status
    is_verified = Column(Boolean, default=False, nullable=False)
    is_patron = Column(Boolean, default=False, nullable=False)  # Can create vendor lists
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_active = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    profile = relationship("VendorProfile", back_populates="vendor", uselist=False)
    stock_items = relationship("StockItem", back_populates="vendor", foreign_keys="StockItem.vendor_id")
    pos_connections = relationship("POSConnection", back_populates="vendor")
    created_events = relationship("Event", back_populates="organizer")
    tool_listings = relationship("ToolListing", back_populates="vendor")

    # Vendor connections (parasitism network). Rows are written directly through
    # `vendor_connections` (see routes/vendors.py) so the extra columns are kept.
    connections = relationship(
        "Vendor",
        secondary=vendor_connections,
        primaryjoin=id == vendor_connections.c.vendor_a_id,
        secondaryjoin=id == vendor_connections.c.vendor_b_id,
        backref="connected_by",
        viewonly=True,
    )


class VendorProfile(Base):
    __tablename__ = "vendor_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), unique=True, nullable=False)

    # What they typically deal in
    primary_goods = Column(JSONB, default=list)  # What they usually stock
    sourcing_interests = Column(JSONB, default=list)  # What they look to buy
    supply_capacity = Column(JSONB, default=dict)  # Volume capabilities

    # Business details
    business_registration = Column(String(100))
    tax_id = Column(String(100))
    warehouse_address = Column(Text)
    operating_hours = Column(JSONB)

    # Network preferences
    preferred_regions = Column(JSONB, default=list)
    min_order_value = Column(Float, default=0)
    accepts_bulk = Column(Boolean, default=True)
    offers_credit = Column(Boolean, default=False)

    # Display
    logo_url = Column(String(500))
    banner_url = Column(String(500))
    portfolio_images = Column(JSONB, default=list)

    vendor = relationship("Vendor", back_populates="profile")

import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class ToolCategory(str, PyEnum):
    WAREHOUSE = "warehouse"
    TRANSPORT = "transport"
    COURIER = "courier"
    POPUP_SHOP = "popup_shop"
    HOTEL_SOURCING = "hotel_sourcing"
    EQUIPMENT = "equipment"
    PACKAGING = "packaging"
    COLD_STORAGE = "cold_storage"


class ToolListing(Base):
    """
    Vendor tools and services. Not consumer products.
    Things vendors need to do business:
    - Warehouse space
    - Transport/logistics
    - Registered couriers
    - Popup shop spaces
    - Hotel sourcing for traveling vendors
    - Equipment rental
    """
    __tablename__ = "tool_listings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)  # Who's offering
    category = Column(Enum(ToolCategory), nullable=False, index=True)

    title = Column(String(300), nullable=False)
    description = Column(Text)
    location = Column(String(500))
    geo_lat = Column(Float)
    geo_lng = Column(Float)

    # Pricing
    price_per_unit = Column(Float)
    price_unit = Column(String(50))  # per_day, per_kg, per_trip, per_sqm
    min_booking = Column(Integer, default=1, nullable=False)
    deposit_required = Column(Float, default=0)

    # Availability
    is_available = Column(Boolean, default=True, nullable=False)
    available_from = Column(DateTime)
    available_until = Column(DateTime)
    capacity = Column(JSONB, default=dict)
    # e.g. {"sqm": 500, "pallets": 50} for warehouse

    # Details
    images = Column(JSONB, default=list)
    features = Column(JSONB, default=list)
    terms = Column(Text)
    contact_info = Column(JSONB, default=dict)

    # Stats
    times_booked = Column(Integer, default=0, nullable=False)
    avg_rating = Column(Float, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    vendor = relationship("Vendor", back_populates="tool_listings")


class WarehouseRental(Base):
    __tablename__ = "warehouse_rentals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tool_listing_id = Column(UUID(as_uuid=True), ForeignKey('tool_listings.id'), nullable=False)
    renter_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)

    space_allocated = Column(JSONB)  # {"sqm": 100, "section": "A3"}
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    monthly_rate = Column(Float)
    status = Column(String(50), default="active", nullable=False)

    renter = relationship("Vendor")
    listing = relationship("ToolListing")


class TransportService(Base):
    __tablename__ = "transport_services"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tool_listing_id = Column(UUID(as_uuid=True), ForeignKey('tool_listings.id'), nullable=False)

    vehicle_type = Column(String(100))
    max_weight_kg = Column(Float)
    max_volume_cbm = Column(Float)
    routes = Column(JSONB, default=list)  # Typical routes covered
    insurance_covered = Column(Boolean, default=False, nullable=False)

    listing = relationship("ToolListing")


class CourierRegistration(Base):
    __tablename__ = "courier_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)

    courier_name = Column(String(200), nullable=False)
    registration_number = Column(String(100))
    coverage_areas = Column(JSONB, default=list)
    service_types = Column(JSONB, default=list)  # same_day, next_day, standard, fragile
    price_per_kg = Column(Float)
    base_rate = Column(Float)
    is_verified = Column(Boolean, default=False, nullable=False)
    rating = Column(Float, default=0, nullable=False)
    total_deliveries = Column(Integer, default=0, nullable=False)

    vendor = relationship("Vendor")


class PopupShop(Base):
    __tablename__ = "popup_shops"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tool_listing_id = Column(UUID(as_uuid=True), ForeignKey('tool_listings.id'), nullable=False)

    venue_name = Column(String(200))
    venue_type = Column(String(100))  # mall, market, street, event_space
    foot_traffic_estimate = Column(Integer)
    amenities = Column(JSONB, default=list)  # power, wifi, display_tables
    shared_spaces_available = Column(Integer, default=0, nullable=False)  # Multiple vendors can share

    listing = relationship("ToolListing")


class HotelSourcing(Base):
    """For vendors traveling to source goods - find accommodation"""
    __tablename__ = "hotel_sourcing"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tool_listing_id = Column(UUID(as_uuid=True), ForeignKey('tool_listings.id'), nullable=False)

    hotel_name = Column(String(200))
    proximity_to = Column(JSONB, default=list)  # ["main market", "industrial area"]
    vendor_rate = Column(Float)  # Special rate for network vendors
    includes_storage = Column(Boolean, default=False, nullable=False)  # Can store goods at hotel
    meeting_room = Column(Boolean, default=False, nullable=False)

    listing = relationship("ToolListing")


SHIPMENT_STATUSES = ("picked_up", "in_transit", "out_for_delivery", "delivered", "failed")


class CourierShipment(Base):
    """A parcel moving between two vendors through a registered courier
    (v2.1 §6.1). Tracked by status, rated by the receiver once delivered."""
    __tablename__ = "courier_shipments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    courier_id = Column(UUID(as_uuid=True), ForeignKey('courier_registrations.id'), nullable=False, index=True)
    sender_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False, index=True)
    receiver_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False, index=True)
    movement_id = Column(UUID(as_uuid=True), ForeignKey('stock_movements.id'))  # optional: the deal it carries

    tracking_number = Column(String(100), unique=True, nullable=False)
    status = Column(String(50), default="picked_up", nullable=False, index=True)
    # picked_up → in_transit → out_for_delivery → delivered → failed

    origin = Column(String(500))
    destination = Column(String(500))
    weight_kg = Column(Float)
    cost = Column(Float)
    notes = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    picked_up_at = Column(DateTime)
    delivered_at = Column(DateTime)
    status_history = Column(JSONB, default=list)  # [{status, at, note}]

    # Rating after delivery (by the receiver)
    rating = Column(Integer)  # 1-5
    review = Column(Text)
    rated_at = Column(DateTime)

    sender = relationship("Vendor", foreign_keys=[sender_vendor_id])
    receiver = relationship("Vendor", foreign_keys=[receiver_vendor_id])
    courier = relationship("CourierRegistration")

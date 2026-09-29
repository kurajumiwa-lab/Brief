import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class StockSource(str, PyEnum):
    """How stock entered the system"""
    POS_SYNC = "pos_sync"           # Pulled from connected POS
    MANUAL_ENTRY = "manual_entry"   # Vendor typed it in
    BULK_IMPORT = "bulk_import"     # CSV/file upload
    NETWORK_TRANSFER = "network_transfer"  # From another vendor


class QualityStatus(str, PyEnum):
    """Who vouches for this stock (v2.1 §3.1). Vendors self-declare a batch or
    attach a lab certificate; only a patron whose list the vendor is on can
    mark it patron-verified, and that verification is tied to the batch."""
    UNVERIFIED = "unverified"
    SELF_DECLARED = "self_declared"      # vendor filled in batch / origin / spec sheet
    PATRON_VERIFIED = "patron_verified"  # a patron inspected this batch
    LAB_CERTIFIED = "lab_certified"      # third-party certificate attached (spec_sheet_url)


# Kept for callers written against the research doc's name.
QualityVerificationStatus = QualityStatus


class MovementStatus(str, PyEnum):
    """Lifecycle of a vendor-to-vendor movement. Reservations are held from
    `pending` until the movement is `received` or `cancelled`."""
    PENDING = "pending"        # Buyer asked; stock reserved
    CONFIRMED = "confirmed"    # Supplier agreed
    SHIPPED = "shipped"        # Left the supplier's shelf
    RECEIVED = "received"      # On the buyer's shelf — the only state that scores
    CANCELLED = "cancelled"    # Reservation released


class StockItem(Base):
    """
    NOT A LISTING. This is STOCK.
    Think of it as what's on your shelf right now.
    It syncs from your POS or you enter it manually.
    Other vendors see what you have and can source from you.
    """
    __tablename__ = "stock_items"
    __table_args__ = (
        Index("ix_stock_items_vendor_pos_item", "vendor_id", "pos_item_id"),
        Index("ix_stock_items_vendor_sku", "vendor_id", "sku"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False, index=True)

    # Product identity
    sku = Column(String(100))  # From POS system
    name = Column(String(300), nullable=False)
    category = Column(String(100), index=True)
    subcategory = Column(String(100))
    description = Column(Text)

    # Stock levels (THE POINT - this isn't a listing, it's inventory)
    quantity_in_stock = Column(Integer, default=0, nullable=False)
    quantity_reserved = Column(Integer, default=0, nullable=False)  # Held for pending deals
    quantity_available = Column(Integer, default=0, nullable=False)  # in_stock - reserved
    unit_of_measure = Column(String(50), default="units", nullable=False)  # units, kg, boxes

    # Pricing (vendor-to-vendor pricing)
    cost_price = Column(Float)  # What vendor paid
    wholesale_price = Column(Float)  # Price for bulk
    unit_price = Column(Float)  # Single unit price
    min_order_quantity = Column(Integer, default=1, nullable=False)
    bulk_discount_tiers = Column(JSONB, default=list)
    # e.g. [{"qty": 100, "discount": 10}, {"qty": 500, "discount": 20}]

    # Source tracking
    source = Column(Enum(StockSource), default=StockSource.MANUAL_ENTRY, nullable=False)
    pos_item_id = Column(String(100))  # Reference ID in POS system
    last_pos_sync = Column(DateTime)

    # Visibility in network
    visible_to_network = Column(Boolean, default=True, nullable=False)
    visible_to_groups = Column(JSONB, default=list)  # Specific group IDs

    # Quality verification (v2.1 §3.1)
    quality_status = Column(Enum(QualityStatus), default=QualityStatus.UNVERIFIED,
                            nullable=False, server_default="UNVERIFIED")
    spec_sheet_url = Column(String(500), nullable=True)   # certificate / spec sheet (see /api/files/upload)
    batch_number = Column(String(100), nullable=True)
    origin_country = Column(String(100), nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    verified_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=True)  # the patron
    verified_at = Column(DateTime, nullable=True)

    # Metadata
    images = Column(JSONB, default=list)
    specifications = Column(JSONB, default=dict)
    tags = Column(JSONB, default=list)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    vendor = relationship("Vendor", back_populates="stock_items", foreign_keys=[vendor_id])
    verified_by = relationship("Vendor", foreign_keys=[verified_by_vendor_id])
    movements = relationship("StockMovement", back_populates="stock_item")


class StockMovement(Base):
    """Track every stock movement between vendors"""
    __tablename__ = "stock_movements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_item_id = Column(UUID(as_uuid=True), ForeignKey('stock_items.id'), nullable=False, index=True)

    from_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False, index=True)
    to_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False, index=True)

    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float)
    total_value = Column(Float)

    movement_type = Column(String(50), default="sourcing", nullable=False)  # sale, transfer, return, sourcing
    status = Column(String(50), default=MovementStatus.PENDING.value, nullable=False, index=True)

    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    confirmed_at = Column(DateTime)   # supplier accepted (response time)
    shipped_at = Column(DateTime)     # left the supplier's shelf (fulfilment time)
    completed_at = Column(DateTime)   # received or cancelled
    cancelled_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'))

    stock_item = relationship("StockItem", back_populates="movements")
    from_vendor = relationship("Vendor", foreign_keys=[from_vendor_id])
    to_vendor = relationship("Vendor", foreign_keys=[to_vendor_id])


class PriceNegotiation(Base):
    """Vendor-to-vendor price negotiation on a stock line (v2.1 §3.3). Opened
    by a deal proposal in chat; every counter-offer flips the roles until one
    side accepts, at which point a movement is created at `accepted_price`."""
    __tablename__ = "price_negotiations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_item_id = Column(UUID(as_uuid=True), ForeignKey('stock_items.id'), index=True)
    buyer_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), index=True)
    seller_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), index=True)

    # Negotiation state
    original_price = Column(Float, nullable=False)   # the shelf price when the talk started
    counter_offer = Column(Float, nullable=False)    # the price currently on the table
    accepted_price = Column(Float, nullable=True)
    quantity = Column(Integer, nullable=False)

    status = Column(String(50), default="pending", nullable=False, index=True)
    # pending → counter_offered → accepted | rejected | expired
    rounds = Column(Integer, default=1, nullable=False)
    last_offer_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'))

    buyer_notes = Column(Text)
    seller_notes = Column(Text)
    chat_room_id = Column(UUID(as_uuid=True), ForeignKey('chat_rooms.id'))
    message_id = Column(UUID(as_uuid=True))          # the latest proposal message
    movement_id = Column(UUID(as_uuid=True), ForeignKey('stock_movements.id'))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime)
    resolved_at = Column(DateTime)


class StockReservation(Base):
    """Holds stock for a pending deal between vendors (v2.1 §3.4). One hold per
    movement: `held` from the sourcing request until the goods are received
    (`fulfilled`), the movement is cancelled (`released`) or the hold lapses
    unconfirmed (`expired`, which also cancels the movement)."""
    __tablename__ = "stock_reservations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_item_id = Column(UUID(as_uuid=True), ForeignKey('stock_items.id'), index=True)
    reserving_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), index=True)
    movement_id = Column(UUID(as_uuid=True), ForeignKey('stock_movements.id'), index=True)

    quantity = Column(Integer, nullable=False)
    agreed_price = Column(Float)
    status = Column(String(50), default="held", nullable=False, index=True)
    # held → released | fulfilled | expired

    hold_expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    resolved_at = Column(DateTime)

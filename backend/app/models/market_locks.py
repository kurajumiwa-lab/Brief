"""Market zones, supplier MOQs and daily vendor Lock windows (no AI)."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class MarketZone(Base):
    __tablename__ = "market_zones"
    __table_args__ = (UniqueConstraint("city_key", "name_key", name="uq_market_zone_city_name"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False)
    city = Column(String(120), nullable=False, default="Nairobi")
    name_key = Column(String(120), nullable=False)
    city_key = Column(String(120), nullable=False)
    walkable_ring = Column(String(240), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    # Where the zone actually is. NULL = not located yet: the open-data ingest
    # geocodes the zone name on first run and fills these in, so a zone never
    # gets a guessed position.
    center_lat = Column(Float, nullable=True)
    center_lng = Column(Float, nullable=True)
    radius_km = Column(Float, nullable=True)
    last_ingest_at = Column(DateTime, nullable=True)
    last_ingest_count = Column(Integer, nullable=True)


class LockProduct(Base):
    __tablename__ = "lock_products"
    __table_args__ = (UniqueConstraint("name_key", "unit_of_measure", name="uq_lock_product_name_unit"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(160), nullable=False)
    name_key = Column(String(160), nullable=False)
    category = Column(String(100), nullable=True)
    unit_of_measure = Column(String(50), nullable=False, default="units")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class SupplierMOQ(Base):
    """A spotter-entered supplier price-sheet line for one product and zone."""
    __tablename__ = "supplier_moqs"
    __table_args__ = (
        UniqueConstraint("supplier_vendor_id", "zone_id", "product_id", name="uq_supplier_moq_line"),
        CheckConstraint("minimum_order_quantity > 0", name="ck_supplier_moq_positive"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supplier_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    zone_id = Column(UUID(as_uuid=True), ForeignKey("market_zones.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("lock_products.id", ondelete="CASCADE"), nullable=False, index=True)
    minimum_order_quantity = Column(Integer, nullable=False)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    supplier = relationship("Vendor")
    zone = relationship("MarketZone")
    product = relationship("LockProduct")


class LockWindow(Base):
    """Daily Flash window; timestamps are naive UTC and local_date is Nairobi time."""
    __tablename__ = "lock_windows"
    __table_args__ = (
        UniqueConstraint("zone_id", "local_date", name="uq_lock_window_zone_date"),
        CheckConstraint("closes_at > opens_at", name="ck_lock_window_times"),
        CheckConstraint("delivery_at >= closes_at", name="ck_lock_window_delivery_after_close"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zone_id = Column(UUID(as_uuid=True), ForeignKey("market_zones.id", ondelete="CASCADE"), nullable=False, index=True)
    local_date = Column(Date, nullable=False)
    opens_at = Column(DateTime, nullable=False)
    closes_at = Column(DateTime, nullable=False)
    delivery_at = Column(DateTime, nullable=False)
    status = Column(String(30), nullable=False, default="open", server_default="open")  # open, rolling, closed
    roll_count = Column(Integer, nullable=False, default=0, server_default="0")  # one extension; then dissolve
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    zone = relationship("MarketZone")
    created_by = relationship("Vendor")
    clusters = relationship("LockCluster", back_populates="window", cascade="all, delete-orphan")


class LockCluster(Base):
    """One product's pooled demand inside a single zone/window."""
    __tablename__ = "lock_clusters"
    __table_args__ = (
        UniqueConstraint("window_id", "product_id", name="uq_lock_cluster_window_product"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    window_id = Column(UUID(as_uuid=True), ForeignKey("lock_windows.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("lock_products.id", ondelete="RESTRICT"), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="collecting", server_default="collecting")  # collecting, bidding, locked, dissolved
    bid_quantity = Column(Integer, nullable=True)
    selected_quote_id = Column(UUID(as_uuid=True), nullable=True)
    locked_quantity = Column(Integer, nullable=True)
    locked_unit_price = Column(Float, nullable=True)
    locked_at = Column(DateTime, nullable=True)
    dissolved_reason = Column(String(240), nullable=True)
    evaluated_at = Column(DateTime, nullable=True)
    # v2.5 escrow settlement state (see app/services/lock_settlement.py):
    #   not_required → collecting → funded → settled
    funds_status = Column(String(20), nullable=False, default="not_required", server_default="not_required")
    paid_total_ksh = Column(Integer, nullable=False, default=0, server_default="0")
    settled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    window = relationship("LockWindow", back_populates="clusters")
    product = relationship("LockProduct")
    picks = relationship("LockPick", back_populates="cluster", cascade="all, delete-orphan")
    quotes = relationship("SupplierQuote", back_populates="cluster", cascade="all, delete-orphan")


class LockPick(Base):
    """A vendor's current quantity request; one live request per cluster."""
    __tablename__ = "lock_picks"
    __table_args__ = (
        UniqueConstraint("cluster_id", "vendor_id", name="uq_lock_pick_vendor"),
        CheckConstraint("quantity > 0", name="ck_lock_pick_positive_quantity"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("lock_clusters.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    status = Column(String(30), nullable=False, default="submitted", server_default="submitted")  # submitted, withdrawn
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    cluster = relationship("LockCluster", back_populates="picks")
    vendor = relationship("Vendor")


class SupplierQuote(Base):
    """Manual supplier quote, always entered against the cluster's actual bid volume."""
    __tablename__ = "supplier_quotes"
    __table_args__ = (
        CheckConstraint("quoted_quantity > 0", name="ck_supplier_quote_positive_quantity"),
        CheckConstraint("unit_price >= 0", name="ck_supplier_quote_nonnegative_price"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("lock_clusters.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_moq_id = Column(UUID(as_uuid=True), ForeignKey("supplier_moqs.id", ondelete="RESTRICT"), nullable=False, index=True)
    quoted_quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)
    notes = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="offered", server_default="offered")  # offered, selected, passed
    entered_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    cluster = relationship("LockCluster", back_populates="quotes")
    supplier_moq = relationship("SupplierMOQ")
    entered_by = relationship("Vendor")

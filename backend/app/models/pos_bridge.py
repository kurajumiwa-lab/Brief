import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class POSConnection(Base):
    """
    Bridge to vendor's existing POS/inventory system.
    This is what makes Brief_ an EXTENSION of their business,
    not a replacement.
    """
    __tablename__ = "pos_connections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False, index=True)

    pos_type = Column(String(50), nullable=False)  # square, shopify, csv, manual, custom_api
    connection_name = Column(String(200))

    # API credentials. Stored encrypted at rest — see services/pos_sync.py.
    api_key = Column(String(1000))
    api_secret = Column(String(1000))
    store_id = Column(String(200))
    webhook_url = Column(String(500))

    # Sync settings
    auto_sync = Column(Boolean, default=True, nullable=False)
    sync_interval_minutes = Column(Integer, default=15, nullable=False)
    last_sync_at = Column(DateTime)
    items_synced = Column(Integer, default=0, nullable=False)

    # What to sync
    sync_config = Column(JSONB, default=dict)
    # e.g. {"categories": ["all"], "min_stock": 10, "exclude_sku": []}

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    vendor = relationship("Vendor", back_populates="pos_connections")
    sync_logs = relationship("POSSyncLog", back_populates="connection")


class POSSyncLog(Base):
    __tablename__ = "pos_sync_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connection_id = Column(UUID(as_uuid=True), ForeignKey('pos_connections.id'), nullable=False, index=True)

    sync_type = Column(String(50), default="manual", nullable=False)  # full, incremental, manual, push, scheduled
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime)
    status = Column(String(50), default="running", nullable=False)  # running, success, failed, partial

    items_processed = Column(Integer, default=0, nullable=False)
    items_added = Column(Integer, default=0, nullable=False)
    items_updated = Column(Integer, default=0, nullable=False)
    items_removed = Column(Integer, default=0, nullable=False)
    errors = Column(JSONB, default=list)

    connection = relationship("POSConnection", back_populates="sync_logs")

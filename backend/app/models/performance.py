"""
Vendor performance — lightweight Supplier Relationship Management (v2.1 §4.4).

Auto-calculated from trade history by `performance_service.recalculate()`
after every movement transition. One row per vendor; never edited by hand.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class VendorPerformance(Base):
    __tablename__ = "vendor_performance"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), unique=True, nullable=False)

    # Fulfillment (as supplier)
    on_time_delivery_rate = Column(Float, default=0, nullable=False)   # % shipped within PERFORMANCE_ON_TIME_HOURS of confirming
    order_fulfillment_rate = Column(Float, default=0, nullable=False)  # % of confirmed orders that were received
    avg_fulfillment_hours = Column(Float, default=0, nullable=False)   # request → received

    # Quality (no returns/disputes flow yet; kept at 0 so the shape is stable)
    return_rate = Column(Float, default=0, nullable=False)
    dispute_rate = Column(Float, default=0, nullable=False)

    # Responsiveness
    avg_response_hours = Column(Float, default=0, nullable=False)       # request → confirmed
    sourcing_acceptance_rate = Column(Float, default=0, nullable=False)  # % of requests the supplier confirmed

    # Volume
    total_deals_completed = Column(Integer, default=0, nullable=False)
    total_trade_value = Column(Float, default=0, nullable=False)

    # Composite 0-100
    reliability_score = Column(Float, default=0, nullable=False)

    calculated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    vendor = relationship("Vendor")

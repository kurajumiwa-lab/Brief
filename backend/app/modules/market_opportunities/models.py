"""Seller-reported market opportunities, not verified price observations."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class MarketOpportunity(Base):
    __tablename__ = "market_opportunities"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_market_opportunity_quantity"),
        CheckConstraint("price_kes > 0", name="ck_market_opportunity_price"),
        Index("ix_market_opportunities_active_updated", "active", "updated_at"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(160), nullable=False)
    location = Column(String(160), nullable=False)
    quantity = Column(Numeric(12, 2), nullable=False)
    unit = Column(String(100), nullable=False)
    price_kes = Column(Numeric(12, 2), nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

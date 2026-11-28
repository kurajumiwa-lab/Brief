"""Non-event marketing briefs and offers. No payment or reach guarantees."""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, UniqueConstraint, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Campaign(Base):
    __tablename__ = 'marketing_campaigns'
    __table_args__ = (CheckConstraint("budget_kes > 0", name='ck_campaign_budget'),
                      CheckConstraint("status IN ('open','closed','awarded')", name='ck_campaign_status'),
                      Index('ix_campaigns_status_created', 'status', 'created_at'))
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False)
    title = Column(String(160), nullable=False)
    brief = Column(Text, nullable=False)
    location = Column(String(160), nullable=False)
    budget_kes = Column(Integer, nullable=False)
    status = Column(String(16), nullable=False, default='open')
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class CampaignOffer(Base):
    __tablename__ = 'marketing_campaign_offers'
    __table_args__ = (UniqueConstraint('campaign_id', 'vendor_id', name='uq_campaign_offer_vendor'),
                      CheckConstraint('price_kes > 0', name='ck_campaign_offer_price'),
                      CheckConstraint("status IN ('submitted','withdrawn','accepted')", name='ck_campaign_offer_status'))
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(UUID(as_uuid=True), ForeignKey('marketing_campaigns.id', ondelete='CASCADE'), nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False)
    message = Column(Text, nullable=False)
    price_kes = Column(Integer, nullable=False)
    status = Column(String(16), nullable=False, default='submitted')
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

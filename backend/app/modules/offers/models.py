"""Offers: the manual confirmation record.

A stock item becomes a *confirmed offer* automatically when a different verified
business has completed a deal for it (see service.py). Until enough deals exist,
the Brief team may confirm an item by hand. Each hand confirmation is one row
that records who did it, why, and when.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class OfferConfirmation(Base):
    __tablename__ = "offer_confirmations"
    __table_args__ = (
        CheckConstraint("length(reason) >= 10", name="ck_offer_confirmations_reason"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_item_id = Column(UUID(as_uuid=True), ForeignKey("stock_items.id", ondelete="CASCADE"),
                           nullable=False, unique=True)
    confirmed_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"),
                                    nullable=True)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

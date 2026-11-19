"""Rhythm: short, inventory-capped flash drops.

A drop is a time box and a quantity, not a discount engine. A claim reserves one
unit for direct payment to the seller; Brief holds neither the stock nor money.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class FlashDrop(Base):
    __tablename__ = "flash_drops"
    __table_args__ = (
        CheckConstraint("capacity BETWEEN 1 AND 1000", name="ck_flash_drops_capacity"),
        CheckConstraint("claimed_count >= 0 AND claimed_count <= capacity",
                        name="ck_flash_drops_claimed"),
        CheckConstraint("price_kes >= 0", name="ck_flash_drops_price"),
        CheckConstraint("ends_at > starts_at", name="ck_flash_drops_window"),
        CheckConstraint("status IN ('live','closed','cancelled')", name="ck_flash_drops_status"),
        Index("ix_flash_drops_live_window", "status", "starts_at", "ends_at"),
        Index("ix_flash_drops_vendor", "vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       nullable=False)
    label = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    price_kes = Column(Integer, nullable=False, default=0, server_default="0")
    capacity = Column(Integer, nullable=False, default=1, server_default="1")
    claimed_count = Column(Integer, nullable=False, default=0, server_default="0")
    starts_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ends_at = Column(DateTime, nullable=False)
    status = Column(String(12), nullable=False, default="live", server_default="live")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class FlashDropClaim(Base):
    __tablename__ = "flash_drop_claims"
    __table_args__ = (
        UniqueConstraint("drop_id", "vendor_id", name="uq_flash_drop_claims_person"),
        Index("ix_flash_drop_claims_vendor", "vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    drop_id = Column(UUID(as_uuid=True), ForeignKey("flash_drops.id", ondelete="CASCADE"),
                     nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

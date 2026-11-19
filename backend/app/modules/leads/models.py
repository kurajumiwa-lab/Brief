"""Verified commercial handshakes.

A lead is one person reaching a business through Brief. It is not an
impression, and it is not money: `fee_kes` is the business's monthly fair
contribution and `bounty_kes` is what the business owes a scout directly.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

LEAD_ACTIONS = ("call", "whatsapp", "visit", "book", "claim", "quote", "join")
LEAD_TARGETS = ("event", "vendor", "stock", "activity")
LEAD_STATUSES = ("verified", "reversed")


class LeadEvent(Base):
    __tablename__ = "lead_events"
    __table_args__ = (
        CheckConstraint(
            "action IN ('call','whatsapp','visit','book','claim','quote','join')",
            name="ck_lead_events_action",
        ),
        CheckConstraint(
            "target_kind IN ('event','vendor','stock','activity')",
            name="ck_lead_events_target_kind",
        ),
        CheckConstraint("status IN ('verified','reversed')", name="ck_lead_events_status"),
        CheckConstraint("fee_kes >= 0 AND bounty_kes >= 0", name="ck_lead_events_kes"),
        # The fingerprint is derived server-side from the signed-in buyer and the
        # target. A bot cannot mint a second handshake for the same buyer/entity.
        UniqueConstraint("target_kind", "target_id", "fingerprint_hash",
                         name="uq_lead_events_fingerprint"),
        Index("ix_lead_events_vendor_created", "vendor_id", "created_at"),
        Index("ix_lead_events_scout_created", "scout_id", "created_at"),
        Index("ix_lead_events_target", "target_kind", "target_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       nullable=False)
    buyer_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"),
                      nullable=True)
    scout_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"),
                      nullable=True)
    target_kind = Column(String(16), nullable=False)
    target_id = Column(UUID(as_uuid=True), nullable=False)
    target_label = Column(String(200), nullable=False)
    action = Column(String(16), nullable=False, default="call", server_default="call")
    fingerprint_hash = Column(String(64), nullable=False)
    scout_code = Column(String(16), nullable=True)
    fee_kes = Column(Integer, nullable=False, default=5, server_default="5")
    bounty_kes = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(String(12), nullable=False, default="verified", server_default="verified")
    details = Column(JSON, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

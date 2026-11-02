"""Group logistics records.

These tables deliberately have NO foreign keys to product orders, stock or
payments. Coordinating a shared delivery is a separate record from the sale
itself, so the two can change, be reported and be priced independently.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

ORDER_STATUSES = ("open", "locked", "scheduled", "in_transit", "delivered", "cancelled")


class LogisticsProvider(Base):
    """A third-party or community delivery provider. Integration-ready, not wired to any API yet."""

    __tablename__ = "logistics_providers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(160), nullable=False)
    contact = Column(String(200), nullable=True)
    service_area = Column(String(200), nullable=True)
    active = Column(Boolean, nullable=False, default=True, server_default="true")
    # Reserved for a future provider API. Stored, never used to call out.
    external_ref = Column(String(120), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GroupOrder(Base):
    __tablename__ = "group_orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open','locked','scheduled','in_transit','delivered','cancelled')",
            name="ck_group_orders_status",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organiser_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    title = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    item_summary = Column(Text, nullable=True)
    status = Column(String(16), nullable=False, default="open", server_default="open")
    closes_at = Column(DateTime, nullable=True)
    delivery_point = Column(String(300), nullable=True)
    window_start = Column(DateTime, nullable=True)
    window_end = Column(DateTime, nullable=True)
    provider_id = Column(UUID(as_uuid=True), ForeignKey("logistics_providers.id", ondelete="SET NULL"),
                         nullable=True)
    # Ordered stops, as optimised by the shared routing service.
    route = Column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GroupOrderParticipant(Base):
    __tablename__ = "group_order_participants"
    __table_args__ = (UniqueConstraint("order_id", "vendor_id", name="uq_group_order_participant"),
                      CheckConstraint("status IN ('joined','left')", name="ck_group_order_participant_status"))

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("group_orders.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    quantity_note = Column(String(300), nullable=True)
    status = Column(String(8), nullable=False, default="joined", server_default="joined")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class LogisticsEvent(Base):
    """Append-only activity record for one group order (status changes, joins, leaves)."""

    __tablename__ = "logistics_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("group_orders.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    actor = Column(String(100), nullable=False)
    action = Column(String(48), nullable=False)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

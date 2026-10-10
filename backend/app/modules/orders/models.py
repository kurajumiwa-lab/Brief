"""Persistent transaction details for vendor stock movements.

A StockMovement remains the canonical order and inventory record. These rows
add the terms the movement does not own: delivery quotes, explicit payment and
settlement context, receipt proof, and an append-only customer-visible history.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy import text as sa_text

from app.database import Base


class OrderTransaction(Base):
    __tablename__ = "order_transactions"
    __table_args__ = (
        CheckConstraint("product_amount_ksh >= 0", name="ck_order_transaction_products_nonnegative"),
        CheckConstraint("platform_fee_ksh >= 0", name="ck_order_transaction_fee_nonnegative"),
        CheckConstraint(
            "settlement_status IN ('not_started','pending','pending_approval','settled',"
            "'blocked_by_dispute','refund_pending','refunded','failed','unavailable','not_applicable')",
            name="ck_order_transaction_settlement_status",
        ),
        UniqueConstraint("movement_id", name="uq_order_transaction_movement"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    movement_id = Column(
        UUID(as_uuid=True), ForeignKey("stock_movements.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # Immutable KES snapshots. These are captured when the stock movement is
    # created so later edits to a catalogue line never rewrite an agreement.
    product_amount_ksh = Column(Integer, nullable=False)
    platform_fee_ksh = Column(Integer, nullable=False, default=0, server_default="0")

    selected_quote_id = Column(
        UUID(as_uuid=True), ForeignKey("delivery_quotes.id", ondelete="SET NULL"), nullable=True,
    )
    destination_address = Column(Text, nullable=True)
    delivery_mode = Column(String(24), nullable=True)

    # The supplier confirms this exact location before a buyer sets out.
    pickup_address = Column(Text, nullable=True)
    pickup_instructions = Column(Text, nullable=True)
    pickup_hours = Column(String(300), nullable=True)
    ready_for_collection = Column(Boolean, nullable=False, default=False, server_default="false")
    pickup_ready_at = Column(DateTime, nullable=True)

    # Receipt codes are stored as a one-way hash and are only ever returned to
    # the buyer at generation time. A code is required for selected delivery.
    receipt_code_hash = Column(String(128), nullable=True)
    receipt_code_expires_at = Column(DateTime, nullable=True)

    settlement_status = Column(String(24), nullable=False, default="not_started", server_default="not_started")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class DeliveryQuoteRequest(Base):
    __tablename__ = "delivery_quote_requests"
    __table_args__ = (
        CheckConstraint(
            "provider_type IN ('supplier_delivery','courier','errand','scheduled')",
            name="ck_delivery_quote_request_provider_type",
        ),
        CheckConstraint("status IN ('open','quoted','cancelled')", name="ck_delivery_quote_request_status"),
        Index("ix_delivery_quote_requests_status", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    movement_id = Column(
        UUID(as_uuid=True), ForeignKey("stock_movements.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    requester_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    courier_registration_id = Column(
        UUID(as_uuid=True), ForeignKey("courier_registrations.id", ondelete="CASCADE"), nullable=True,
    )
    provider_type = Column(String(24), nullable=False)
    destination_address = Column(String(500), nullable=False)
    scheduled_start = Column(DateTime, nullable=True)
    scheduled_end = Column(DateTime, nullable=True)
    customer_note = Column(String(1000), nullable=True)
    status = Column(String(16), nullable=False, default="open", server_default="open")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class DeliveryQuote(Base):
    __tablename__ = "delivery_quotes"
    __table_args__ = (
        CheckConstraint(
            "provider_type IN ('self_pickup','supplier_delivery','courier','errand','scheduled')",
            name="ck_delivery_quote_provider_type",
        ),
        CheckConstraint("price_ksh >= 0", name="ck_delivery_quote_price_nonnegative"),
        CheckConstraint("status IN ('offered','selected','withdrawn','expired')", name="ck_delivery_quote_status"),
        Index("ix_delivery_quotes_movement_status", "movement_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    movement_id = Column(
        UUID(as_uuid=True), ForeignKey("stock_movements.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    request_id = Column(
        UUID(as_uuid=True), ForeignKey("delivery_quote_requests.id", ondelete="SET NULL"), nullable=True,
    )
    provider_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    provider_type = Column(String(24), nullable=False)
    provider_name = Column(String(200), nullable=False)
    price_ksh = Column(Integer, nullable=False)
    eta_text = Column(String(160), nullable=True)
    pickup_address = Column(String(500), nullable=True)
    destination_address = Column(String(500), nullable=True)
    ready_for_collection = Column(Boolean, nullable=False, default=False, server_default="false")
    collection_instructions = Column(String(1000), nullable=True)
    scheduled_start = Column(DateTime, nullable=True)
    scheduled_end = Column(DateTime, nullable=True)
    note = Column(String(1000), nullable=True)
    status = Column(String(16), nullable=False, default="offered", server_default="offered")
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class MovementEvent(Base):
    """Append-only, auditable activity for one stock movement."""
    __tablename__ = "movement_events"
    __table_args__ = (
        Index("ix_movement_events_movement_created", "movement_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    movement_id = Column(
        UUID(as_uuid=True), ForeignKey("stock_movements.id", ondelete="CASCADE"), nullable=False,
    )
    event_type = Column(String(48), nullable=False)
    actor_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    payload = Column(JSONB, nullable=False, server_default=sa_text("'{}'::jsonb"), default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class OrderDispute(Base):
    __tablename__ = "order_disputes"
    __table_args__ = (
        CheckConstraint(
            "category IN ('missing_goods','incorrect_quantity','damaged_goods','cancellation',"
            "'payment_problem','delivery_failure','other')",
            name="ck_order_dispute_category",
        ),
        CheckConstraint("status IN ('open','in_review','resolved')", name="ck_order_dispute_status"),
        Index("ix_order_disputes_movement_status", "movement_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    movement_id = Column(
        UUID(as_uuid=True), ForeignKey("stock_movements.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    opened_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    category = Column(String(32), nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String(16), nullable=False, default="open", server_default="open")
    outcome = Column(String(24), nullable=True)
    resolution_note = Column(Text, nullable=True)
    resolved_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

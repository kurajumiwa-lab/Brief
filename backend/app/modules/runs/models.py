"""Market Runs — scheduled buying runs with a per-run order ledger (v2.15).

A Market Run generalises the Daily Flash Lock into the way traders already
work: a designated buyer goes to a named market (Ruiru Fresh Market,
Githurai, Daraja Mbili), buys confirmed quantities in the morning, and
goods are allocated back to the shops and families who ordered them.

Three separations the schema is built to keep:

    request ≠ confirmed order ≠ supplier purchase
        `run_orders.status` walks requested → confirmed → purchased →
        allocated → ready → collected/delivered. Only *confirmed* demand
        counts toward the buying list; a purchase is recorded per product
        (`run_purchases`) with its receipt reference.

    where demand is collected ≠ where goods are received
        an order carries its own fulfilment: collect at the hub, collect
        at a participating shop, or delivery to an area outside the
        market's walkable ring. A customer's registered market zone is
        never consulted — ordering into a run is open to any vendor
        account, wherever they receive goods.

    who chose to pay how ≠ who carries the risk
        the customer picks the payment method (advance, on delivery,
        shop-backed) and every order names `money_responsibility`. The
        platform records payments; it does not hold the money (recorded,
        not custodied — the PSP custody path stays with Lock settlement).

Quantities are Float: fish and chicken move in kilograms, sugar in whole
bags *and* repacked retail quantities, and a 2 kg family order must never
be rounded into a wholesale bag.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

RUN_KINDS = ("fresh_market", "bulk_dry_goods", "consolidated_supply")
RUN_STATUSES = ("open", "buying", "allocating", "delivering", "completed", "cancelled")
FUNDING_MODELS = ("customer_advance", "buyer_capital", "supplier_credit", "shop_consolidated", "pooled", "mixed_open")
PARTICIPANT_TYPES = ("family", "shop")
PAYMENT_METHODS = ("advance_mpesa", "advance_cash", "cash_on_delivery", "mpesa_on_delivery", "shop_backed_collection")
MONEY_RESPONSIBILITIES = ("customer", "shop", "buyer", "platform")
FUNDING_SOURCES = ("customer_advance", "buyer_capital", "supplier_credit", "shop_funded", "pooled")
DELIVERY_MODES = ("collect_at_hub", "collect_at_shop", "home_delivery")
ORDER_STATUSES = (
    "requested", "confirmed", "purchased", "allocated", "ready",
    "collected", "delivered", "cancelled", "refused",
)
PAYMENT_STATUSES = ("unpaid", "deposit_paid", "paid", "refunded")


class MarketRun(Base):
    __tablename__ = "market_runs"
    __table_args__ = (
        CheckConstraint(
            "run_kind IN ('fresh_market','bulk_dry_goods','consolidated_supply')",
            name="ck_market_run_kind"),
        CheckConstraint(
            "status IN ('open','buying','allocating','delivering','completed','cancelled')",
            name="ck_market_run_status"),
        CheckConstraint(
            "funding_model IN ('customer_advance','buyer_capital','supplier_credit','shop_consolidated','pooled','mixed_open')",
            name="ck_market_run_funding_model"),
        Index("ix_market_runs_status_date", "status", "run_date"),
        Index("ix_market_runs_zone_date", "zone_id", "run_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zone_id = Column(UUID(as_uuid=True), ForeignKey("market_zones.id", ondelete="SET NULL"), nullable=True)
    # Snapshot names: a run is named for a real market (Ruiru Fresh Market,
    # Githurai Sukari Run, Daraja Mbili) even before that market exists as a
    # formal Lock zone.
    market_name = Column(String(200), nullable=False)
    market_city = Column(String(120), nullable=False, default="Nairobi", server_default="Nairobi")
    title = Column(String(240), nullable=False)
    run_kind = Column(String(32), nullable=False, default="consolidated_supply", server_default="consolidated_supply")
    run_date = Column(Date, nullable=False)
    order_deadline = Column(DateTime, nullable=False)
    status = Column(String(24), nullable=False, default="open", server_default="open")
    buyer_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    funding_model = Column(String(32), nullable=False, default="mixed_open", server_default="mixed_open")
    cold_chain_required = Column(Boolean, nullable=False, default=False, server_default="false")
    cold_chain_plan = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class RunOrder(Base):
    __tablename__ = "run_orders"
    __table_args__ = (
        CheckConstraint("participant_type IN ('family','shop')", name="ck_run_order_participant_type"),
        CheckConstraint("quantity > 0", name="ck_run_order_quantity_positive"),
        CheckConstraint(
            "payment_method IN ('advance_mpesa','advance_cash','cash_on_delivery','mpesa_on_delivery','shop_backed_collection')",
            name="ck_run_order_payment_method"),
        CheckConstraint(
            "money_responsibility IN ('customer','shop','buyer','platform')",
            name="ck_run_order_money_responsibility"),
        CheckConstraint(
            "funding_source IN ('customer_advance','buyer_capital','supplier_credit','shop_funded','pooled')",
            name="ck_run_order_funding_source"),
        CheckConstraint(
            "delivery_mode IN ('collect_at_hub','collect_at_shop','home_delivery')",
            name="ck_run_order_delivery_mode"),
        CheckConstraint(
            "status IN ('requested','confirmed','purchased','allocated','ready','collected','delivered','cancelled','refused')",
            name="ck_run_order_status"),
        CheckConstraint(
            "payment_status IN ('unpaid','deposit_paid','paid','refunded')",
            name="ck_run_order_payment_status"),
        Index("ix_run_orders_run_status", "run_id", "status"),
        Index("ix_run_orders_vendor_created", "vendor_id", "created_at"),
        Index("ix_run_orders_collection_point", "collection_point_vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("market_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("lock_products.id", ondelete="SET NULL"), nullable=True)
    # Snapshot so a family can order "Sugar — 2 kg retail packet" without
    # waiting for an ops clerk to create a formal Lock product first.
    product_name = Column(String(200), nullable=False)
    unit_of_measure = Column(String(50), nullable=False, default="units", server_default="units")
    package_size = Column(String(120), nullable=True)      # "50 kg bag", "2 kg packet", "whole chicken"
    wholesale_package = Column(Boolean, nullable=False, default=False, server_default="false")
    repack_required = Column(Boolean, nullable=False, default=False, server_default="false")
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_type = Column(String(16), nullable=False, default="shop", server_default="shop")
    quantity = Column(Float, nullable=False)
    quantity_allocated = Column(Float, nullable=True)
    status = Column(String(24), nullable=False, default="requested", server_default="requested")
    # The customer decides how to pay. Nothing here is forced by the
    # platform; fees for the chosen route are shown, not hidden.
    payment_method = Column(String(32), nullable=False, default="cash_on_delivery", server_default="cash_on_delivery")
    money_responsibility = Column(String(16), nullable=False, default="customer", server_default="customer")
    funding_source = Column(String(24), nullable=False, default="customer_advance", server_default="customer_advance")
    delivery_mode = Column(String(24), nullable=False, default="collect_at_hub", server_default="collect_at_hub")
    collection_point_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    delivery_area = Column(String(240), nullable=True)     # outside the walkable ring is fine
    estimated_unit_price = Column(Float, nullable=True)
    actual_unit_price = Column(Float, nullable=True)
    delivery_fee_kes = Column(Integer, nullable=False, default=0, server_default="0")
    handling_fee_kes = Column(Integer, nullable=False, default=0, server_default="0")
    repack_fee_kes = Column(Integer, nullable=False, default=0, server_default="0")
    amount_paid_kes = Column(Integer, nullable=False, default=0, server_default="0")
    payment_status = Column(String(24), nullable=False, default="unpaid", server_default="unpaid")
    payment_note = Column(Text, nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    collected_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class RunPurchase(Base):
    __tablename__ = "run_purchases"
    __table_args__ = (
        UniqueConstraint("run_id", "product_name_key", name="uq_run_purchase_product"),
        CheckConstraint("quantity_purchased > 0", name="ck_run_purchase_quantity_positive"),
        CheckConstraint("actual_unit_price >= 0", name="ck_run_purchase_price_nonnegative"),
        Index("ix_run_purchases_run", "run_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("market_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("lock_products.id", ondelete="SET NULL"), nullable=True)
    product_name = Column(String(200), nullable=False)
    product_name_key = Column(String(200), nullable=False)
    unit_of_measure = Column(String(50), nullable=False, default="units", server_default="units")
    supplier_name = Column(String(200), nullable=True)
    supplier_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    quantity_purchased = Column(Float, nullable=False)
    actual_unit_price = Column(Float, nullable=False)
    receipt_ref = Column(Text, nullable=True)          # receipt photo URL / book + page reference
    weight_loss_quantity = Column(Float, nullable=False, default=0, server_default="0")
    rejected_quantity = Column(Float, nullable=False, default=0, server_default="0")
    notes = Column(Text, nullable=True)
    purchased_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class RunExpense(Base):
    __tablename__ = "run_expenses"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('transport','handling','repacking','cold_chain','market_fees','other')",
            name="ck_run_expense_kind"),
        CheckConstraint("amount_kes >= 0", name="ck_run_expense_amount_nonnegative"),
        Index("ix_run_expenses_run", "run_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("market_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(24), nullable=False)
    amount_kes = Column(Integer, nullable=False)
    receipt_ref = Column(Text, nullable=True)
    note = Column(Text, nullable=True)
    recorded_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

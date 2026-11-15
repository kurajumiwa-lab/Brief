"""Receipt rewards — the server side of a receipt that becomes data.

A receipt is submitted as the raw QR payload, not as a set of fields the client
has already blessed. The server parses the code, decides freshness and points,
and refuses a duplicate by its evidence rather than by a device's memory. That
is the difference between a local ledger and a network: the second person to
scan the same invoice is told no.

Two boundaries are deliberate:

  · There is no KRA verification call here. A QR can carry a merchant PIN,
    invoice number and total, and still be fabricated. The schema records what
    the code said; it does not claim the tax authority confirmed it.
  · There is no cash. A voucher is a discount a merchant chose to fund, issued
    against points, and redeemed by a rotating code on the merchant's phone.
    `receipt_vouchers` has a `redeemed_at` and no payout field, on purpose.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base

MERCHANT_CLAIM_STATUSES = ("unclaimed", "pending", "verified", "rejected")
TRADE_PROOF_STATUSES = ("pending", "confirmed", "disputed", "unmatched")
RECEIPT_STATUSES = ("verified", "partial", "manual")
VOUCHER_STATUSES = ("issued", "redeemed", "expired", "cancelled")


class ReceiptMerchant(Base):
    """A shop inferred from receipts, or claimed by the person who runs it.

    A merchant is keyed by KRA PIN because that is the one identifier printed on
    every eTIMS receipt and in every QR. It is not a Vendor: a chemist does not
    need an account to be in the network, only a till that prints the code.
    """
    __tablename__ = "receipt_merchants"
    __table_args__ = (
        CheckConstraint(
            "claim_status IN ('unclaimed','pending','verified','rejected')",
            name="ck_receipt_merchants_claim_status",
        ),
        Index("ix_receipt_merchants_region_claim", "region", "claim_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pin = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False, default="Local merchant", server_default="Local merchant")
    region = Column(String(80), nullable=True, index=True)
    phone = Column(String(20), nullable=True)
    # A PIN is public (it is printed on the paper). Ownership is a separate
    # fact: a claim is reviewed before the claimer can publish offers or redeem
    # vouchers at that shop.
    claimed_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    claim_status = Column(String(16), nullable=False, default="unclaimed", server_default="unclaimed")
    claim_note = Column(Text, nullable=True)
    claimed_at = Column(DateTime, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    receipts = relationship("Receipt", back_populates="merchant")
    offers = relationship("ReceiptOffer", back_populates="merchant")


class Receipt(Base):
    """One row per scanned proof. The dedupe key is global, not per device."""
    __tablename__ = "receipts"
    __table_args__ = (
        CheckConstraint("total > 0", name="ck_receipts_total_positive"),
        CheckConstraint("points >= 0", name="ck_receipts_points_nonnegative"),
        CheckConstraint(
            "status IN ('verified','partial','manual')",
            name="ck_receipts_status",
        ),
        UniqueConstraint("dedupe_key", name="uq_receipts_dedupe_key"),
        Index("ix_receipts_vendor_scanned", "vendor_id", "scanned_at"),
        Index("ix_receipts_merchant_scanned", "merchant_id", "scanned_at"),
        Index("ix_receipts_region_scanned", "region", "scanned_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="SET NULL"), nullable=True,
    )
    merchant_pin = Column(String(20), nullable=True)
    merchant_name = Column(String(200), nullable=False, default="Local merchant", server_default="Local merchant")
    invoice_no = Column(String(100), nullable=True)
    total = Column(Integer, nullable=False)
    tax = Column(Integer, nullable=True)
    issued_at = Column(DateTime, nullable=True)
    scanned_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    source = Column(String(20), nullable=False, default="qr", server_default="qr")
    status = Column(String(16), nullable=False)
    freshness_key = Column(String(20), nullable=False)
    base_points = Column(Integer, nullable=False, default=0)
    points = Column(Integer, nullable=False, default=0)
    token = Column(String(500), nullable=True)
    verification_url = Column(String(1000), nullable=True)
    # Kept for dispute handling; never returned by the API.
    raw_payload = Column(Text, nullable=True)
    dedupe_key = Column(String(300), nullable=False)
    region = Column(String(80), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    merchant = relationship("ReceiptMerchant", back_populates="receipts")
    vouchers = relationship("ReceiptVoucher", back_populates="used_on_receipt")
    trade_proof = relationship("TradeProof", back_populates="receipt", uselist=False)


class ReceiptOffer(Base):
    """A merchant-funded discount. The platform never funds the difference."""
    __tablename__ = "receipt_offers"
    __table_args__ = (
        CheckConstraint("discount_kes > 0", name="ck_receipt_offers_discount_positive"),
        CheckConstraint("min_spend_kes >= 0", name="ck_receipt_offers_min_spend_nonnegative"),
        CheckConstraint("points_cost >= 0", name="ck_receipt_offers_points_cost_nonnegative"),
        Index("ix_receipt_offers_active_merchant", "is_active", "merchant_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    title = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    discount_kes = Column(Integer, nullable=False)
    min_spend_kes = Column(Integer, nullable=False, default=0, server_default="0")
    points_cost = Column(Integer, nullable=False)
    starts_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ends_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    merchant = relationship("ReceiptMerchant", back_populates="offers")
    vouchers = relationship("ReceiptVoucher", back_populates="offer")


class TradeProof(Base):
    """A receipt-backed trade, waiting for the other side.

    The buyer scans the paper; this row is the question the seller answers. It
    is deliberately not a StockMovement: there is no stock, no delivery and no
    delivery quote. It is proof that money changed hands at a named shop, and
    it only becomes a completed trade when the shop confirms it.

    `confirmed_trade_proofs` on each Vendor is incremented once, inside the
    same transaction as the status change. No cash moves here.
    """
    __tablename__ = "trade_proofs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','confirmed','disputed','unmatched')",
            name="ck_trade_proofs_status",
        ),
        CheckConstraint("amount > 0", name="ck_trade_proofs_amount_positive"),
        UniqueConstraint("receipt_id", name="uq_trade_proofs_receipt"),
        Index("ix_trade_proofs_seller_status", "seller_vendor_id", "status", "created_at"),
        Index("ix_trade_proofs_buyer_status", "buyer_vendor_id", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_id = Column(
        UUID(as_uuid=True), ForeignKey("receipts.id", ondelete="CASCADE"), nullable=False,
    )
    buyer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    seller_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    merchant_pin = Column(String(20), nullable=True)
    merchant_name = Column(String(200), nullable=False)
    amount = Column(Integer, nullable=False)
    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    confirmed_at = Column(DateTime, nullable=True)
    disputed_at = Column(DateTime, nullable=True)
    dispute_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    receipt = relationship("Receipt", back_populates="trade_proof")
    buyer = relationship("Vendor", foreign_keys=[buyer_vendor_id])
    seller = relationship("Vendor", foreign_keys=[seller_vendor_id])


class ReceiptVoucher(Base):
    """A discount held by a person and checked at the counter.

    `code_seed` is server-side only. The four-digit code is derived from it and
    a one-minute window, so a screenshot is not a permanent coupon. The merchant
    phone asks the server; nothing is paid out in cash.
    """
    __tablename__ = "receipt_vouchers"
    __table_args__ = (
        CheckConstraint("value_kes > 0", name="ck_receipt_vouchers_value_positive"),
        CheckConstraint("points_cost >= 0", name="ck_receipt_vouchers_points_nonnegative"),
        CheckConstraint(
            "status IN ('issued','redeemed','expired','cancelled')",
            name="ck_receipt_vouchers_status",
        ),
        Index("ix_receipt_vouchers_vendor_status", "vendor_id", "status"),
        Index("ix_receipt_vouchers_merchant_status", "merchant_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    offer_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_offers.id", ondelete="SET NULL"), nullable=True,
    )
    merchant_id = Column(
        UUID(as_uuid=True), ForeignKey("receipt_merchants.id", ondelete="CASCADE"), nullable=False,
    )
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    value_kes = Column(Integer, nullable=False)
    points_cost = Column(Integer, nullable=False, default=0, server_default="0")
    code_seed = Column(String(64), nullable=False, unique=True)
    status = Column(String(16), nullable=False, default="issued", server_default="issued")
    issued_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    redeemed_at = Column(DateTime, nullable=True)
    redeemed_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    used_on_receipt_id = Column(
        UUID(as_uuid=True), ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    offer = relationship("ReceiptOffer", back_populates="vouchers")
    used_on_receipt = relationship("Receipt", back_populates="vouchers")

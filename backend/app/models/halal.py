"""Halal finance (v2.6, halal-trade brief).

Murabaha (cost-plus) inventory advances: the Sacco/window buys physical
stock from a supplier at a known cost and sells it to the vendor at a fixed,
disclosed markup — payable in full by an agreed date. No interest accrues;
the margin is agreed before the contract exists (the Sharia requirement for
Murabaha: cost and profit are both fixed and known at signing).

The vendor's repayment is a normal PSP collection into the SACCO_ADVANCES
sub-account, so the custody ledger stays the single source of truth for
money. The Sacco's purchase from the supplier is an out-of-band physical
trade (Layer 3 operations); only the vendor-side cash flows are on-platform.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class MurabahaContract(Base):
    """One cost-plus stock advance. Statuses:

    pending_approval → active (staff signed; vendor owes total_selling_ksh
    by payment_due_date) → settled (PSP collection landed) | defaulted
    (grace period passed) ; or declined (staff refused the margin/stock).
    """

    __tablename__ = "murabaha_contracts"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_murabaha_quantity_positive"),
        CheckConstraint("cost_price_ksh > 0", name="ck_murabaha_cost_positive"),
        CheckConstraint("markup_ksh >= 0", name="ck_murabaha_markup_non_negative"),
        CheckConstraint(
            "total_selling_ksh = cost_price_ksh + markup_ksh",
            name="ck_murabaha_total_math",
        ),
        CheckConstraint(
            "status IN ('pending_approval','active','declined','settled','defaulted')",
            name="ck_murabaha_status",
        ),
        Index("ix_murabaha_vendor", "vendor_id"),
        Index("ix_murabaha_status_due", "status", "payment_due_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    # The wholesaler the Sacco window buys from (a vendor in this network);
    # None when the stock source is outside the platform.
    supplier_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    product = Column(String(200), nullable=False)
    quantity = Column(Integer, nullable=False)
    cost_price_ksh = Column(Integer, nullable=False)
    markup_ksh = Column(Integer, nullable=False)
    total_selling_ksh = Column(Integer, nullable=False)
    payment_due_date = Column(DateTime, nullable=False)

    status = Column(String(20), nullable=False, default="pending_approval", server_default="pending_approval")
    note = Column(Text, nullable=True)
    repayment_intent_id = Column(UUID(as_uuid=True), ForeignKey("payment_intents.id"), nullable=True)
    approved_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    settled_at = Column(DateTime, nullable=True)
    failure_reason = Column(String(400), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    vendor = relationship("Vendor", foreign_keys=[vendor_id])
    supplier = relationship("Vendor", foreign_keys=[supplier_vendor_id])

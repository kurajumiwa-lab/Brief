"""Payments & custody (v2.5) — the money layer.

PSP-as-abstraction model: a licensed PSP (IntaSend / Flutterwave / …) holds all
float in segregated sub-accounts and owns the telco integration. This app holds
the single append-only ledger of record and routes funds between sub-accounts
by instruction. Funds never touch the operating account.

The ledger is the source of truth for *member-facing* balances; the PSP's
wallet balances are reconciled against it daily. The one rule that prevents
catastrophe: no ledger entry is written until a confirmed PSP reference exists.

Timestamps follow the app's naive-UTC convention.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


# --- Sub-accounts (PSP-side) ----------------------------------------------
# Static sub-accounts. Chama pools add one dynamic sub-account per active
# chama (id "CHAMA_<uuid>"); SACCO_SAVINGS / SACCO_LENDING / NETWORK_BENEFIT_POOL
# are reserved for Layer 3 / benefits.
ESCROW_PICK_HEDGING = "ESCROW_PICK_HEDGING"
DISPUTE_HOLD = "DISPUTE_HOLD"
PLATFORM_FEES = "PLATFORM_FEES"
NETWORK_BENEFIT_POOL = "NETWORK_BENEFIT_POOL"
SACCO_SAVINGS = "SACCO_SAVINGS"
SACCO_LENDING = "SACCO_LENDING"
SACCO_ADVANCES = "SACCO_ADVANCES"  # v2.6: murabaha (cost-plus) stock advances


class PaymentIntent(Base):
    """Created BEFORE money moves. One row per attempted collection.

    In the PSP-abstraction model the telco states collapse into:
    pending (sent to PSP) → completed | failed | refunded | expired.
    """
    __tablename__ = "payment_intents"
    __table_args__ = (
        CheckConstraint(
            "entity_type IN ('pick_deposit','pick_full_payment','chama_deposit',"
            "'chama_loan_repayment','sacco_savings','sacco_loan_repayment','pool_ride_share',"
            "'murabaha_repayment','musharakah_profit')",
            name="ck_payment_intent_entity_type",
        ),
        CheckConstraint("amount_ksh > 0", name="ck_payment_intent_amount_positive"),
        CheckConstraint(
            "provider IN ('MPESA','AIRTEL','TKASH','CARD','BANK')",
            name="ck_payment_intent_provider",
        ),
        CheckConstraint(
            "status IN ('pending','completed','failed','refunded','expired')",
            name="ck_payment_intent_status",
        ),
        Index("idx_payment_intents_entity", "entity_type", "entity_id"),
        Index("idx_payment_intents_status_created", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False, index=True)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    amount_ksh = Column(Integer, nullable=False)
    provider = Column(String(10), nullable=False, default="MPESA", server_default="MPESA")
    phone = Column(String(20), nullable=False)
    target_psp_sub = Column(String(80), nullable=False)

    # Your reference sent to the PSP (unique, idempotency key on webhooks).
    psp_api_ref = Column(String(80), unique=True, nullable=False)
    # PSP's internal ids / telco receipt, filled in from the webhook.
    psp_payment_id = Column(String(80), nullable=True)
    mpesa_receipt = Column(String(40), nullable=True)

    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    failure_reason = Column(String(400), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    ledger_entries = relationship("CustodyLedgerEntry", back_populates="intent")


class CustodyLedgerEntry(Base):
    """Append-only ledger — the single source of truth for custody balances.

    Each row records a change to ONE sub-account. `amount_ksh` is always
    positive; `direction` (credit/debit) plus `transaction_type` say what
    happened. `running_balance_ksh` is the sub-account balance after this row.

    No UPDATE or DELETE is permitted (Postgres trigger
    `trg_custody_ledger_append_only`, plus the app only ever INSERTs).
    """
    __tablename__ = "custody_ledger"
    __table_args__ = (
        CheckConstraint("amount_ksh > 0", name="ck_custody_ledger_amount_positive"),
        CheckConstraint(
            "transaction_type IN ("
            "'collection_in','escrow_lock','escrow_release','escrow_refund',"
            "'chama_pool_in','chama_loan_out','chama_repayment_in','chama_dividend_out',"
            "'sacco_deposit_in','sacco_loan_out','sacco_repayment_in','sacco_dividend_out',"
            "'fee_deducted','dispute_freeze','dispute_release','reversal')",
            name="ck_custody_ledger_transaction_type",
        ),
        CheckConstraint("direction IN ('credit','debit')", name="ck_custody_ledger_direction"),
        Index("idx_custody_ledger_psp_sub", "psp_sub_account", "ledger_date"),
        Index("idx_custody_ledger_vendor", "vendor_id", "ledger_date"),
        Index("idx_custody_ledger_entity", "entity_type", "entity_id"),
        Index("idx_custody_ledger_created", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_date = Column(Date, nullable=False, default=datetime.utcnow)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=True)
    psp_sub_account = Column(String(80), nullable=False)
    transaction_type = Column(String(30), nullable=False)
    amount_ksh = Column(Integer, nullable=False)
    direction = Column(String(8), nullable=False)
    running_balance_ksh = Column(Integer, nullable=False, default=0)

    psp_reference = Column(String(80), nullable=False)   # the confirmed PSP id
    mpesa_receipt = Column(String(40), nullable=True)
    provider = Column(String(10), nullable=True)
    entity_type = Column(String(40), nullable=True)
    entity_id = Column(UUID(as_uuid=True), nullable=True)
    # Optional link back to the payment intent that caused this entry.
    intent_id = Column(UUID(as_uuid=True), ForeignKey("payment_intents.id"), nullable=True)

    approved_by = Column(UUID(as_uuid=True), nullable=True)
    approved_by_2 = Column(UUID(as_uuid=True), nullable=True)
    reversal_of = Column(UUID(as_uuid=True), ForeignKey("custody_ledger.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    intent = relationship("PaymentIntent", back_populates="ledger_entries")
    reversal = relationship("CustodyLedgerEntry", remote_side=[id])


class Disbursement(Base):
    """Money OUT to a vendor/supplier M-Pesa wallet from a sub-account."""
    __tablename__ = "disbursements"
    __table_args__ = (
        CheckConstraint(
            "entity_type IN ("
            "'pick_settlement','pick_refund','chama_loan','chama_dividend',"
            "'sacco_loan','sacco_dividend','sacco_withdrawal','price_shield_credit',"
            "'network_benefit','pool_ride_transporter')",
            name="ck_disbursement_entity_type",
        ),
        CheckConstraint("amount_ksh > 0", name="ck_disbursement_amount_positive"),
        CheckConstraint(
            "status IN ('pending_approval','approved','queued','completed','failed','reversed')",
            name="ck_disbursement_status",
        ),
        Index("idx_disbursements_status_created", "status", "created_at"),
        Index("idx_disbursements_entity", "entity_type", "entity_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type = Column(String(30), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    recipient_phone = Column(String(20), nullable=False)
    recipient_provider = Column(String(10), nullable=False, default="MPESA", server_default="MPESA")
    recipient_name = Column(String(200), nullable=True)
    amount_ksh = Column(Integer, nullable=False)
    source_psp_sub = Column(String(80), nullable=False)

    psp_api_ref = Column(String(80), unique=True, nullable=False)
    psp_payout_id = Column(String(80), nullable=True)

    status = Column(String(20), nullable=False, default="pending_approval", server_default="pending_approval")
    requested_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    approver_1 = Column(UUID(as_uuid=True), nullable=True)
    approver_1_at = Column(DateTime, nullable=True)
    approver_2 = Column(UUID(as_uuid=True), nullable=True)   # required if amount > threshold
    approver_2_at = Column(DateTime, nullable=True)
    failure_reason = Column(String(400), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class ReconciliationRun(Base):
    """Daily PSP ↔ ledger matching, one row per sub-account per run date."""
    __tablename__ = "reconciliation_runs"
    __table_args__ = (
        UniqueConstraint("run_date", "psp_sub_account", name="uq_recon_run_date_sub"),
        CheckConstraint(
            "status IN ('pending','matched','variance_found','resolved')",
            name="ck_reconciliation_status",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_date = Column(Date, nullable=False)
    psp_sub_account = Column(String(80), nullable=False)
    psp_reported_balance = Column(Integer, nullable=False)
    ledger_balance = Column(Integer, nullable=False)
    variance_ksh = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    variance_explanation = Column(String(400), nullable=True)
    resolved_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class DisputeHold(Base):
    """Frozen funds while a dispute is open (held in the DISPUTE_HOLD sub)."""
    __tablename__ = "dispute_holds"
    __table_args__ = (
        CheckConstraint("amount_ksh > 0", name="ck_dispute_hold_amount_positive"),
        CheckConstraint(
            "status IN ('frozen','released_to_vendor','released_to_supplier','escalated')",
            name="ck_dispute_hold_status",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    original_ledger_id = Column(UUID(as_uuid=True), ForeignKey("custody_ledger.id"), nullable=True)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=True)
    amount_ksh = Column(Integer, nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(24), nullable=False, default="frozen", server_default="frozen")
    resolved_by = Column(UUID(as_uuid=True), nullable=True)
    resolution_note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

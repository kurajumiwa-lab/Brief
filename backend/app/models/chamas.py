"""Digital chamas (v2.5, Layer 2 — table banking).

A chama is a small group of vendors who pool deposits into a PSP-held sub-account
and lend to each other by peer vote. The platform provides the ledger, the
coordination and the trust infrastructure — not the capital. Members deposit
into their own group account; members lend to each other. This is the
Cooperative Societies Act (Cap 490) self-help-group pattern: no banking
license is required for the pool itself.

Money never has its own table: every deposit, loan, repayment and dividend is a
`CustodyLedgerEntry` on the chama's PSP sub-account (one source of truth for
money, per the custody spec). These tables record the *business* facts —
membership, deposits, loans, votes, dividends.

Timestamps follow the app's naive-UTC convention.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Integer, Numeric,
    String, Text, UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class Chama(Base):
    __tablename__ = "chamas"
    __table_args__ = (
        CheckConstraint("min_deposit_ksh > 0", name="ck_chama_min_deposit_positive"),
        CheckConstraint("max_loan_ksh > 0", name="ck_chama_max_loan_positive"),
        CheckConstraint("cycle_days > 0", name="ck_chama_cycle_positive"),
        CheckConstraint("interest_rate >= 0 AND interest_rate <= 0.50", name="ck_chama_interest_rate"),
        CheckConstraint("approval_rate > 0 AND approval_rate <= 1", name="ck_chama_approval_rate"),
        CheckConstraint(
            "status IN ('forming','active','suspended','dissolved')",
            name="ck_chama_status",
        ),
        CheckConstraint(
            "(scope = 'group' AND group_id IS NOT NULL) OR scope = 'open'",
            name="ck_chama_scope_group",
        ),
        CheckConstraint(
            "model_type IN ('conventional_interest','qard_hasan','musharakah_trade','murabaha_credit')",
            name="ck_chama_model_type",
        ),
        Index("ix_chamas_group", "group_id"),
        Index("ix_chamas_status", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(160), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    # 'group' chamas form from a group-buy cluster: only members of the linked
    # vendor group may join. 'open' chamas accept any vendor.
    scope = Column(String(10), nullable=False, default="group", server_default="group")
    group_id = Column(UUID(as_uuid=True), ForeignKey("vendor_groups.id", ondelete="CASCADE"), nullable=True)
    zone_id = Column(UUID(as_uuid=True), ForeignKey("market_zones.id", ondelete="SET NULL"), nullable=True)
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)

    # Terms. model_type (v2.6 halal-trade brief): conventional_interest keeps
    # the v2.5 interest engine; the three Halal pool models lend at cost —
    # qard_hasan (zero-interest peer loans, flat admin fee), musharakah_trade
    # (joint-venture advances, profit remitted to the pool), murabaha_credit
    # (cost-plus advances).
    model_type = Column(String(24), nullable=False, default="conventional_interest",
                        server_default="conventional_interest")
    min_deposit_ksh = Column(Integer, nullable=False, default=500)
    max_loan_ksh = Column(Integer, nullable=False, default=10_000)
    interest_rate = Column(Numeric(5, 4), nullable=False, default="0.0500")  # per cycle
    cycle_days = Column(Integer, nullable=False, default=7)
    approval_rate = Column(Numeric(4, 3), nullable=False, default="0.700")    # peer-vote quorum
    min_members = Column(Integer, nullable=False, default=5)
    max_members = Column(Integer, nullable=False, default=30)

    # Custody: one segregated PSP sub-account per active chama.
    psp_sub_account = Column(String(80), nullable=True, unique=True)

    status = Column(String(12), nullable=False, default="forming", server_default="forming")
    active_at = Column(DateTime, nullable=True)
    # Cycle of the last dividend distribution (None = never).
    last_dividend_cycle = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    members = relationship("ChamaMember", back_populates="chama", cascade="all, delete-orphan")
    deposits = relationship("ChamaDeposit", back_populates="chama", cascade="all, delete-orphan")
    loans = relationship("ChamaLoan", back_populates="chama", cascade="all, delete-orphan")


class ChamaMember(Base):
    __tablename__ = "chama_members"
    __table_args__ = (
        UniqueConstraint("chama_id", "vendor_id", name="uq_chama_member"),
        CheckConstraint("role IN ('member','chair','treasurer')", name="ck_chama_member_role"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chama_id = Column(UUID(as_uuid=True), ForeignKey("chamas.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(12), nullable=False, default="member", server_default="member")
    joined_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    chama = relationship("Chama", back_populates="members")
    vendor = relationship("Vendor")


class ChamaDeposit(Base):
    """One member's deposit into the pool (money is in the custody ledger)."""
    __tablename__ = "chama_deposits"
    __table_args__ = (
        CheckConstraint("amount_ksh > 0", name="ck_chama_deposit_positive"),
        CheckConstraint("cycle_number > 0", name="ck_chama_deposit_cycle_positive"),
        Index("ix_chama_deposits_member", "chama_id", "vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chama_id = Column(UUID(as_uuid=True), ForeignKey("chamas.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    amount_ksh = Column(Integer, nullable=False)
    cycle_number = Column(Integer, nullable=False)
    intent_id = Column(UUID(as_uuid=True), ForeignKey("payment_intents.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    chama = relationship("Chama", back_populates="deposits")
    vendor = relationship("Vendor")
    intent = relationship("PaymentIntent")


class ChamaLoan(Base):
    """A member's loan from the pool. Disbursed to their M-Pesa; repaid with
    one cycle of interest back into the pool."""
    __tablename__ = "chama_loans"
    __table_args__ = (
        CheckConstraint("amount_ksh > 0", name="ck_chama_loan_amount_positive"),
        CheckConstraint("fee_ksh >= 0", name="ck_chama_loan_fee_non_negative"),
        CheckConstraint(
            "total_due_ksh = amount_ksh + interest_ksh", name="ck_chama_loan_total_math",
        ),
        CheckConstraint(
            "status IN ('pending_vote','approved','declined','disbursing','disbursed','repaid','defaulted')",
            name="ck_chama_loan_status",
        ),
        Index("ix_chama_loans_status", "status"),
        Index("ix_chama_loans_borrower", "borrower_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chama_id = Column(UUID(as_uuid=True), ForeignKey("chamas.id", ondelete="CASCADE"), nullable=False, index=True)
    borrower_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    amount_ksh = Column(Integer, nullable=False)
    interest_ksh = Column(Integer, nullable=False, default=0)
    # Halal pools only (v2.6): flat admin fee netted from the payout (the
    # borrower still repays the full principal — the fee covers PSP costs).
    fee_ksh = Column(Integer, nullable=False, default=0, server_default="0")
    total_due_ksh = Column(Integer, nullable=False)
    purpose = Column(String(400), nullable=True)
    cycle_issued = Column(Integer, nullable=False)
    cycle_due = Column(Integer, nullable=False)

    status = Column(String(16), nullable=False, default="pending_vote", server_default="pending_vote")
    disbursement_id = Column(UUID(as_uuid=True), ForeignKey("disbursements.id"), nullable=True)
    repayment_intent_id = Column(UUID(as_uuid=True), ForeignKey("payment_intents.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)
    disbursed_at = Column(DateTime, nullable=True)
    repaid_at = Column(DateTime, nullable=True)

    chama = relationship("Chama", back_populates="loans")
    borrower = relationship("Vendor")
    votes = relationship("ChamaLoanVote", back_populates="loan", cascade="all, delete-orphan")
    disbursement = relationship("Disbursement")
    repayment_intent = relationship("PaymentIntent", foreign_keys=[repayment_intent_id])


class ChamaLoanVote(Base):
    """Peer vote on a loan. The borrower cannot vote their own loan."""
    __tablename__ = "chama_loan_votes"
    __table_args__ = (
        UniqueConstraint("loan_id", "voter_id", name="uq_chama_loan_vote"),
        CheckConstraint("vote IN ('approve','decline')", name="ck_chama_loan_vote_choice"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    loan_id = Column(UUID(as_uuid=True), ForeignKey("chama_loans.id", ondelete="CASCADE"), nullable=False, index=True)
    voter_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    vote = Column(String(10), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    loan = relationship("ChamaLoan", back_populates="votes")
    voter = relationship("Vendor")


class ChamaDividend(Base):
    """One member's share of a pool-interest distribution."""
    __tablename__ = "chama_dividends"
    __table_args__ = (
        CheckConstraint("amount_ksh > 0", name="ck_chama_dividend_positive"),
        CheckConstraint(
            "status IN ('declared','paid','failed')", name="ck_chama_dividend_status",
        ),
        Index("ix_chama_dividends_member", "chama_id", "vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chama_id = Column(UUID(as_uuid=True), ForeignKey("chamas.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    period_cycle_from = Column(Integer, nullable=False)
    period_cycle_to = Column(Integer, nullable=False)
    amount_ksh = Column(Integer, nullable=False)
    disbursement_id = Column(UUID(as_uuid=True), ForeignKey("disbursements.id"), nullable=True)
    status = Column(String(10), nullable=False, default="declared", server_default="declared")
    declared_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    paid_at = Column(DateTime, nullable=True)
    failure_reason = Column(String(400), nullable=True)

    chama = relationship("Chama")
    vendor = relationship("Vendor")
    disbursement = relationship("Disbursement")

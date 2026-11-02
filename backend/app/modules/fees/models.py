"""Configurable fee rules and an append-only fee record ledger."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class FeeRule(Base):
    __tablename__ = "fee_rules"
    __table_args__ = (
        CheckConstraint("basis IN ('flat','bps')", name="ck_fee_rules_basis"),
        CheckConstraint("amount_kes >= 0 AND rate_bps >= 0 AND rate_bps <= 2000",
                        name="ck_fee_rules_amounts"),
    )

    key = Column(String(48), primary_key=True)
    label = Column(String(120), nullable=False)
    description = Column(Text, nullable=False, server_default="")
    basis = Column(String(8), nullable=False)
    amount_kes = Column(BigInteger, nullable=False, default=0, server_default="0")
    rate_bps = Column(Integer, nullable=False, default=0, server_default="0")
    enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_by = Column(String(100), nullable=True)


class FeeRecord(Base):
    """One row per fee actually calculated. Only written when fees are live."""

    __tablename__ = "fee_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_key = Column(String(48), nullable=False, index=True)
    subject_type = Column(String(48), nullable=False)
    subject_id = Column(String(64), nullable=False)
    base_amount_kes = Column(BigInteger, nullable=False, default=0)
    fee_kes = Column(BigInteger, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

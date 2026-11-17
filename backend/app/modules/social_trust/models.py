"""Social-seller trust signals (migration 0068).

Three independent records:

  * `social_bio_checks` — the result of one server fetch: did the public bio
    HTML contain `/p/<handle>` at that moment? History is kept; a later failed
    check never rewrites an earlier success.
  * `stock_in_hand_proofs` — a photograph beside a daily server-derived code,
    published for 48 hours. It proves a photo was taken with the code; it does
    not prove ownership, authenticity or stock quantity.
  * `seller_delivery_reports` — a Level 2+ buyer who actually traded with the
    seller says a delivery did not arrive. Two unrelated open reports raise the
    warning banner; a seller resolution clears it.

None of these awards `standing_level`.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer,
    Numeric, String, Text, text,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

PLATFORMS = ("tiktok", "instagram", "facebook")
PLATFORM_LABELS = {"tiktok": "TikTok", "instagram": "Instagram", "facebook": "Facebook Marketplace"}
PROOF_STATUSES = ("ACTIVE", "EXPIRED", "FLAGGED")
REPORT_STATUSES = ("OPEN", "RESOLVED", "DISMISSED")

# Shown under every signal, in one line, so the UI cannot overstate it.
SIGNAL_NOTE = "A signal — it does not award standing credit."


class SocialBioCheck(Base):
    __tablename__ = "social_bio_checks"
    __table_args__ = (
        CheckConstraint("platform IN ('tiktok','instagram','facebook')",
                        name="ck_social_bio_platform"),
        Index("idx_social_bio_checks_user", "user_id", "platform", "checked_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                     nullable=False)
    platform = Column(String(16), nullable=False)
    profile_url = Column(Text, nullable=False)
    expected_path = Column(String(120), nullable=False)
    matched = Column(Boolean, nullable=False)
    http_status = Column(Integer, nullable=True)
    failure_reason = Column(String(120), nullable=True)
    checked_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))


class StockInHandProof(Base):
    __tablename__ = "stock_in_hand_proofs"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','EXPIRED','FLAGGED')",
                        name="ck_stock_proof_status"),
        CheckConstraint("price_kes IS NULL OR price_kes >= 0",
                        name="ck_stock_proof_price_nonnegative"),
        Index("idx_stock_proofs_user", "user_id", "status", "expires_at"),
        Index("uq_stock_proof_active", "user_id", unique=True,
              postgresql_where=text("status = 'ACTIVE'")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                     nullable=False)
    challenge_code = Column(String(10), nullable=False)
    challenge_date = Column(Date, nullable=False)
    item_title = Column(String(120), nullable=False)
    price_kes = Column(Numeric(10, 2), nullable=True)
    proof_image_url = Column(Text, nullable=False)
    status = Column(String(24), nullable=False, default="ACTIVE", server_default="ACTIVE")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))


class SellerDeliveryReport(Base):
    __tablename__ = "seller_delivery_reports"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN','RESOLVED','DISMISSED')",
                        name="ck_delivery_report_status"),
        CheckConstraint("reporter_user_id <> seller_user_id",
                        name="ck_delivery_report_not_self"),
        CheckConstraint("trade_proof_id IS NOT NULL OR stock_movement_id IS NOT NULL",
                        name="ck_delivery_report_has_evidence"),
        Index("idx_delivery_reports_seller", "seller_user_id", "status", "created_at"),
        Index("uq_delivery_report_open_pair", "seller_user_id", "reporter_user_id",
              unique=True, postgresql_where=text("status = 'OPEN'")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    seller_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                            nullable=False)
    reporter_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                              nullable=False)
    trade_proof_id = Column(UUID(as_uuid=True), ForeignKey("trade_proofs.id", ondelete="SET NULL"),
                            nullable=True)
    stock_movement_id = Column(UUID(as_uuid=True),
                               ForeignKey("stock_movements.id", ondelete="SET NULL"),
                               nullable=True)
    note = Column(Text, nullable=False)
    status = Column(String(16), nullable=False, default="OPEN", server_default="OPEN")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_note = Column(Text, nullable=True)

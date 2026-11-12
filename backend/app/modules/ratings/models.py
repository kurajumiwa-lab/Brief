"""Post-trade ratings (Phase 7, PR 102).

One row per party per subject. A subject is a completed appointment or a received stock
movement. A client rates the supplier after a completed trade (1-5 stars). A supplier records
an outcome only when the trade failed or was fraudulent. Ratings measure exposure to the
market. They move no money and never change the trade's own status.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

SUBJECT_KINDS = ("appointment", "movement")
RATER_ROLES = ("client", "supplier")
OUTCOMES = ("completed", "failed", "fraud")


class PostTradeRating(Base):
    __tablename__ = "post_trade_ratings"
    __table_args__ = (
        CheckConstraint(f"subject_kind IN {SUBJECT_KINDS}", name="ck_post_trade_ratings_kind"),
        CheckConstraint(f"rater_role IN {RATER_ROLES}", name="ck_post_trade_ratings_role"),
        CheckConstraint(f"outcome IN {OUTCOMES}", name="ck_post_trade_ratings_outcome"),
        CheckConstraint("stars IS NULL OR (stars >= 1 AND stars <= 5)", name="ck_post_trade_ratings_stars"),
        Index("uq_post_trade_ratings_subject_role", "subject_kind", "subject_id", "rater_role", unique=True),
        Index("ix_post_trade_ratings_supplier_created", "supplier_vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_kind = Column(String(16), nullable=False)
    subject_id = Column(UUID(as_uuid=True), nullable=False)
    supplier_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    client_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=True)
    rater_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    rater_role = Column(String(8), nullable=False)
    outcome = Column(String(16), nullable=False)
    stars = Column(SmallInteger, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class TradeFinalisation(Base):
    """A trade whose rating window closed with no rating. Written only by the housekeeping job.

    Final is a fact about the rating window, not a trade status. Nothing here changes the trade,
    its completed count, or its ranking. Mirrors migration 0051_trade_finalisations.
    """
    __tablename__ = "trade_finalisations"
    __table_args__ = (
        CheckConstraint(f"subject_kind IN {SUBJECT_KINDS}", name="ck_trade_finalisations_kind"),
        Index("uq_trade_finalisations_subject", "subject_kind", "subject_id", unique=True),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_kind = Column(String(16), nullable=False)
    subject_id = Column(UUID(as_uuid=True), nullable=False)
    finalised_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    reason = Column(String(24), nullable=False, default="window_expired")

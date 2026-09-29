import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class VendorListReview(Base):
    """A vendor's review of a vendor list (v2.1 §4.2).

    Only vendors who are actually on the list may review it — the review carries
    `verified_member` so the reader knows the difference between a member's
    experience and an outsider's opinion. One review per vendor per list;
    `helpful_count` lets the network sort what was useful.
    """

    __tablename__ = "vendor_list_reviews"
    __table_args__ = (
        UniqueConstraint("vendor_list_id", "reviewer_vendor_id", name="uq_vendor_list_review"),
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_vendor_list_review_rating"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_list_id = Column(UUID(as_uuid=True), ForeignKey('vendor_lists.id', ondelete='CASCADE'), nullable=False, index=True)
    reviewer_vendor_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False, index=True)

    rating = Column(Integer, nullable=False)          # 1-5
    title = Column(String(160))
    body = Column(Text)
    verified_member = Column(Boolean, default=False, nullable=False)
    helpful_count = Column(Integer, default=0, nullable=False)
    helpful_voters = Column(JSONB, default=list)  # vendor ids that marked it useful (one vote each)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    reviewer = relationship("Vendor", foreign_keys=[reviewer_vendor_id])
    vendor_list = relationship("VendorList", back_populates="reviews")

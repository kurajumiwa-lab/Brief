"""Knowledge directory: seminars, courses and mentor sessions, with a record.

A listing states what it promises before it runs. After the event date the
organiser must write what was actually delivered. Reviews are only accepted
from people who were checked in, so a review means someone attended.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class KnowledgeListing(Base):
    __tablename__ = "knowledge_listings"
    __table_args__ = (
        CheckConstraint("kind IN ('seminar', 'course', 'mentor_session')", name="ck_knowledge_listings_kind"),
        CheckConstraint("status IN ('draft', 'published', 'completed', 'cancelled')",
                        name="ck_knowledge_listings_status"),
        CheckConstraint("price_kes IS NULL OR price_kes >= 0", name="ck_knowledge_listings_price"),
        CheckConstraint("capacity IS NULL OR capacity >= 1", name="ck_knowledge_listings_capacity"),
        Index("ix_knowledge_listings_browse", "status", "sector", "starts_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organiser_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                                 nullable=False, index=True)
    kind = Column(String(20), nullable=False)
    title = Column(String(200), nullable=False)
    sector = Column(String(40), nullable=False)
    summary = Column(Text)
    price_kes = Column(Integer)
    starts_at = Column(DateTime)
    location = Column(String(300))
    capacity = Column(Integer)
    promised_outcomes = Column(Text, nullable=False)
    delivered_outcomes = Column(Text)
    delivered_at = Column(DateTime)
    status = Column(String(20), nullable=False, default="draft")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class KnowledgeRegistration(Base):
    __tablename__ = "knowledge_registrations"
    __table_args__ = (UniqueConstraint("listing_id", "vendor_id", name="uq_knowledge_registration"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_listings.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    registered_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    checked_in_at = Column(DateTime)


class KnowledgeReview(Base):
    __tablename__ = "knowledge_reviews"
    __table_args__ = (
        UniqueConstraint("listing_id", "vendor_id", name="uq_knowledge_review"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_knowledge_reviews_rating"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_listings.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    rating = Column(Integer, nullable=False)
    comment = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

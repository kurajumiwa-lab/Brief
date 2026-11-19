"""Tables for the event vendor desk.

Four rows tell the whole story:

  vendor_rate_cards        one public card per vendor
  rate_card_packages       what a vendor sells, at what unit price
  event_vendor_requests    an organiser's structured brief for one event
  event_vendor_quotes      one vendor's answer to one brief

There is no payment table here on purpose. The platform records the commitment;
the money moves directly between the organiser and the vendor.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base


RATE_UNITS = ("per_event", "per_day", "per_person", "per_hour", "per_item", "custom")
REQUEST_STATUSES = ("open", "closed", "awarded", "cancelled")
QUOTE_STATUSES = ("submitted", "shortlisted", "accepted", "declined", "withdrawn")
PAYERS = ("organizer", "vendor", "split", "undecided")

EVENT_VENDOR_CATEGORIES = (
    "catering", "decor", "photography", "sound_lighting", "venue", "transport",
    "security", "mc", "makeup", "staffing", "other",
)


def _quoted(values) -> str:
    return ", ".join(f"'{value}'" for value in values)


class VendorRateCard(Base):
    __tablename__ = "vendor_rate_cards"
    __table_args__ = (
        UniqueConstraint("vendor_id", name="uq_vendor_rate_cards_vendor"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       nullable=False)
    headline = Column(String(200), nullable=False, default="")
    summary = Column(Text, nullable=False, default="")
    event_categories = Column(JSONB, nullable=False, default=list)
    proof_links = Column(JSONB, nullable=False, default=list)
    reach_claims = Column(JSONB, nullable=False, default=list)
    is_public = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class RateCardPackage(Base):
    __tablename__ = "rate_card_packages"
    __table_args__ = (
        CheckConstraint("price_kes >= 0", name="ck_rate_card_packages_price_nonneg"),
        CheckConstraint(f"price_unit IN ({_quoted(RATE_UNITS)})",
                        name="ck_rate_card_packages_unit"),
        Index("ix_rate_card_packages_card_active", "rate_card_id", "is_active"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True)
    rate_card_id = Column(UUID(as_uuid=True), ForeignKey("vendor_rate_cards.id", ondelete="CASCADE"),
                          nullable=False)
    name = Column(String(160), nullable=False)
    description = Column(Text, nullable=False, default="")
    price_kes = Column(Integer, nullable=False, default=0)
    price_unit = Column(String(24), nullable=False, default="per_event")
    inclusions = Column(JSONB, nullable=False, default=list)
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventVendorRequest(Base):
    __tablename__ = "event_vendor_requests"
    __table_args__ = (
        CheckConstraint(f"status IN ({_quoted(REQUEST_STATUSES)})",
                        name="ck_event_vendor_requests_status"),
        CheckConstraint(f"payer IN ({_quoted(PAYERS)})",
                        name="ck_event_vendor_requests_payer"),
        CheckConstraint("budget_min_kes >= 0 AND budget_max_kes >= 0",
                        name="ck_event_vendor_requests_budget_nonneg"),
        CheckConstraint("budget_max_kes = 0 OR budget_max_kes >= budget_min_kes",
                        name="ck_event_vendor_requests_budget_band"),
        Index("ix_event_vendor_requests_open", "status", "category", "created_at"),
        Index("ix_event_vendor_requests_event", "event_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    organizer_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    category = Column(String(40), nullable=False)
    brief = Column(Text, nullable=False, default="")
    budget_min_kes = Column(Integer, nullable=False, default=0)
    budget_max_kes = Column(Integer, nullable=False, default=0)
    payer = Column(String(16), nullable=False, default="organizer")
    requirements = Column(JSONB, nullable=False, default=dict)
    response_deadline = Column(DateTime, nullable=False)
    status = Column(String(16), nullable=False, default="open")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class EventVendorQuote(Base):
    __tablename__ = "event_vendor_quotes"
    __table_args__ = (
        UniqueConstraint("request_id", "vendor_id", name="uq_event_vendor_quotes_vendor"),
        CheckConstraint(f"status IN ({_quoted(QUOTE_STATUSES)})",
                        name="ck_event_vendor_quotes_status"),
        CheckConstraint("amount_kes > 0", name="ck_event_vendor_quotes_amount_positive"),
        Index("ix_event_vendor_quotes_request_status", "request_id", "status"),
        Index("ix_event_vendor_quotes_vendor", "vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("event_vendor_requests.id", ondelete="CASCADE"),
                        nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    package_id = Column(UUID(as_uuid=True), ForeignKey("rate_card_packages.id", ondelete="SET NULL"),
                        nullable=True)
    amount_kes = Column(Integer, nullable=False)
    message = Column(Text, nullable=False, default="")
    inclusions = Column(JSONB, nullable=False, default=list)
    valid_until = Column(DateTime, nullable=True)
    status = Column(String(16), nullable=False, default="submitted")
    accepted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

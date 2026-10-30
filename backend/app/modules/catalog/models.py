"""Storefront enquiries (v2.14).

One table: the purchase/enquiry route for every catalogue offer. Selling
tomorrow means an enquiry can be invoiced manually and delivered by
people — it does not wait for automated checkout. An enquiry is a lead
with the offer's fixed scope attached, never a payment: `status` walks
new → contacted → quoted → won/lost by a human, and the catalogue's
scope (deliverables/exclusions) is what gets quoted.

Trial requests are enquiries with `kind='trial'`. They record the exact
first-charge disclosure the customer acknowledged (amount from the
tier's test price, date = request date + trial days) — while the trial
itself stays `not_yet_live` until a payment provider verifies recurring
billing for the merchant account.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

# The first four predate the business desk; the rest are the actions the desk's
# readiness table is allowed to produce. Kept in the same order as
# `catalog.ENQUIRY_KINDS` so the two never drift.
ENQUIRY_KINDS = ("purchase", "trial", "quotation", "discovery_call",
                 "pilot", "requirements", "interest")
ENQUIRY_STATUSES = ("new", "contacted", "quoted", "won", "lost")


class CatalogEnquiry(Base):
    __tablename__ = "catalog_enquiries"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('purchase','trial','quotation','discovery_call',"
            "'pilot','requirements','interest')",
            name="ck_catalog_enquiry_kind",
        ),
        CheckConstraint(
            "status IN ('new','contacted','quoted','won','lost')",
            name="ck_catalog_enquiry_status",
        ),
        Index("ix_catalog_enquiries_vendor_created", "vendor_id", "created_at"),
        Index("ix_catalog_enquiries_status_created", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    offer_key = Column(String(64), nullable=True)
    tier_key = Column(String(24), nullable=True)
    kind = Column(String(24), nullable=False, default="purchase", server_default="purchase")
    # Which of the five buying needs this arrived through. Recorded so an
    # operator can route the request without decoding the offer key — and so a
    # "custom business solutions" enquiry (no offer at all) is still routable.
    desk_key = Column(String(32), nullable=True, index=True)
    organisation_name = Column(String(200), nullable=True)
    contact_name = Column(String(200), nullable=True)
    contact_phone = Column(String(40), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(24), nullable=False, default="new", server_default="new")
    # Trial disclosure snapshot (kind='trial' only): what the customer was
    # shown and acknowledged before any future charge could exist.
    acknowledged_first_charge = Column(Boolean, nullable=False, default=False, server_default="false")
    first_charge_amount_kes = Column(Integer, nullable=True)
    first_charge_date = Column(Date, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

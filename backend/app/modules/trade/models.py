"""Business requests — the reusable way to express a need (v2.9).

The network's four jobs — source stock, find workers, arrange delivery, rent
equipment — each have a screen. What they never had is one object for the
moment a business cannot find what it needs in the directory: a request.

One row, one lifecycle, every type:

    stock     "20 bags of maize flour, Kisumu, by tomorrow"
    worker    "3 loaders, tomorrow morning, near the market"
    delivery  "pick up a parcel at Kibuye, deliver to Kondele today"
    rental    "concrete mixer, two days, this week"
    errand    / service   — everything else a business asks another business

Lifecycle:
    open       — visible to relevant businesses, collecting offers
    fulfilled  — the requester accepted one offer (it stays readable: completed
                 trade is the trust record the critique asks for)
    cancelled  — the requester withdrew it

Offers are the counter-half: a business answers with a price, a note and how
fast it can deliver. One offer per responder per request; the requester
accepts exactly one. Requests and offers are ordinary rows — no AI, no black
box — and every count on the wire is a real count(*).
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import (
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


def _enum_values(enum_class):
    """PG enum labels = the *values* ("open"), not the member names ("OPEN") —
    the API, the raw-SQL feed and the wire all speak the same lowercase words."""
    return [m.value for m in enum_class]


class RequestType(str, enum.Enum):
    STOCK = "stock"
    WORKER = "worker"
    DELIVERY = "delivery"
    RENTAL = "rental"
    ERRAND = "errand"
    SERVICE = "service"


class RequestUrgency(str, enum.Enum):
    """When it is needed. A trader thinks in days, not timestamps."""
    TODAY = "today"
    TOMORROW = "tomorrow"
    THIS_WEEK = "this_week"
    FLEXIBLE = "flexible"


class RequestStatus(str, enum.Enum):
    OPEN = "open"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"


class OfferStatus(str, enum.Enum):
    OFFERED = "offered"
    ACCEPTED = "accepted"
    DECLINED = "declined"


class BusinessRequest(Base):
    __tablename__ = "business_requests"
    __table_args__ = (
        CheckConstraint("char_length(description) >= 8", name="ck_request_description_real"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    request_type = Column(Enum(RequestType, values_callable=_enum_values), nullable=False, index=True)
    description = Column(Text, nullable=False)
    # Where the work or delivery happens — a place name first, coordinates when
    # the client has them. Text is the honest floor: every trader knows their
    # market; not every trader wants to pin their shop on a map.
    location = Column(String(300), nullable=False)
    zone_id = Column(UUID(as_uuid=True), ForeignKey("market_zones.id", ondelete="SET NULL"), nullable=True, index=True)
    geo_lat = Column(Float, nullable=True)
    geo_lng = Column(Float, nullable=True)

    needed_by = Column(Enum(RequestUrgency, values_callable=_enum_values), nullable=False, default=RequestUrgency.FLEXIBLE)
    budget_kes = Column(Integer, nullable=True)   # optional; "open to quotes" is a real answer

    status = Column(Enum(RequestStatus, values_callable=_enum_values), nullable=False, default=RequestStatus.OPEN, index=True)
    # The accepted offer, denormalised so a fulfilled request shows what closed
    # the loop without a second query.
    accepted_offer_id = Column(UUID(as_uuid=True), nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)

    requester = relationship("Vendor", foreign_keys=[requester_vendor_id])
    offers = relationship(
        "RequestOffer", back_populates="request",
        cascade="all, delete-orphan", foreign_keys="RequestOffer.request_id",
    )


class RequestOffer(Base):
    """One business's answer to a request: what it costs and how fast."""
    __tablename__ = "request_offers"
    __table_args__ = (
        UniqueConstraint("request_id", "responder_vendor_id", name="uq_request_offer_responder"),
        CheckConstraint("price_kes IS NULL OR price_kes >= 0", name="ck_request_offer_price"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(UUID(as_uuid=True), ForeignKey("business_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    responder_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)

    price_kes = Column(Integer, nullable=True)    # a quote; "call me" is allowed
    note = Column(Text, nullable=False)           # what exactly is being offered
    lead_time = Column(String(120), nullable=True)  # "ready now", "tomorrow 7am"

    status = Column(Enum(OfferStatus, values_callable=_enum_values), nullable=False, default=OfferStatus.OFFERED, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    request = relationship("BusinessRequest", back_populates="offers", foreign_keys=[request_id])
    responder = relationship("Vendor", foreign_keys=[responder_vendor_id])


class RequestEvent(Base):
    """The auditable history of one request — an append-only record of what
    happened and when (locked decision: the trade lifecycle is an explicit
    state machine with auditable history). Written by trade.service inside
    the same transaction as the state change it describes; never updated.

    The payload deliberately carries NO prices and NO offer notes: event
    history is for ordering and rebuilding, negotiation content lives on the
    offer row where its privacy rules already apply.
    """

    __tablename__ = "request_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("business_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(40), nullable=False)   # posted | offer_received | offer_updated
                                                      # | offer_accepted | rival_offers_declined
                                                      # | request_fulfilled | request_cancelled
    actor_vendor_id = Column(UUID(as_uuid=True), nullable=True)
    offer_id = Column(UUID(as_uuid=True), nullable=True)
    payload = Column(JSONB, nullable=False, server_default=sa_text("'{}'::jsonb"), default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

"""Public places — rows sourced from public open data (OpenStreetMap, ODbL).

A public place is NOT a vendor account. It is an external fact the network
ingested on a schedule: a name, a category, a phone number, hours and
coordinates, plus the source's own id and the time the source last confirmed
the place still exists.

Lifecycle:
    active   — ingested, shown with an "unverified · public data" badge
    claimed  — a vendor linked the place to their account; the vendor's own
               rows (stock, profile) are what the network now trusts
    removed  — the place no longer appears in the source data

The ODbL licence (which is why we can store these at all) requires the
attribution "Data © OpenStreetMap contributors" wherever the data is shown.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class PublicPlace(Base):
    __tablename__ = "public_places"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_public_place_source_external"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Provenance — the only two things that make this row honest.
    source = Column(String(40), nullable=False)          # "openstreetmap"
    external_id = Column(String(80), nullable=False)     # e.g. "way/12345678"

    # What the source says.
    name = Column(String(300), nullable=False)
    category = Column(String(100))                       # "shop:convenience" etc.
    detail = Column(String(200))                         # shop/amenity/craft value
    phone = Column(String(80))
    opening_hours = Column(String(300))
    website = Column(String(500))
    address = Column(String(500))

    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)

    # Which market zone the ingest found it in (denormalised name for display).
    zone_id = Column(UUID(as_uuid=True), ForeignKey("market_zones.id", ondelete="SET NULL"), nullable=True, index=True)
    zone_name = Column(String(120), nullable=True)

    # Freshness — last_checked_at goes stale the day the source stops
    # confirming the place; the UI shows it, it is not hidden.
    first_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_checked_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    claimed_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(30), nullable=False, default="active")

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

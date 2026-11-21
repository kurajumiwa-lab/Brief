"""Street tables: time-boxed matchmaking tables (migration 0078) and the
official script stamp (migration 0079).

A table is an introduction with an expiry, not a booking and not a payment.
The host says what they need, where, and for how long; the row carries a
verification code and a contact target that is only released to a person who
joins. Brief sends no message and holds no money.

`joined_count` starts at 1 because the host is already at the table. The
capacity check lives in the UPDATE that increments it, so two taps cannot put
two extra people into the last seat.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

INTENTS = ("co_buy", "source", "delivery", "gig", "meetup")
INTENT_LABELS = {
    "co_buy": "Co-buy",
    "source": "Source",
    "delivery": "Delivery",
    "gig": "Quick job",
    "meetup": "Meet-up",
}
HANDOFF_CHANNELS = ("whatsapp", "telegram")
STATUSES = ("open", "closed", "expired")


class StreetLobby(Base):
    __tablename__ = "street_lobbies"
    __table_args__ = (
        CheckConstraint("intent IN ('co_buy','source','delivery','gig','meetup')",
                        name="ck_street_lobbies_intent"),
        CheckConstraint("handoff_channel IN ('whatsapp','telegram')",
                        name="ck_street_lobbies_channel"),
        CheckConstraint("status IN ('open','closed','expired')",
                        name="ck_street_lobbies_status"),
        CheckConstraint("seats BETWEEN 2 AND 50", name="ck_street_lobbies_seats"),
        CheckConstraint("joined_count >= 1 AND joined_count <= seats",
                        name="ck_street_lobbies_joined"),
        CheckConstraint("expires_at > opens_at", name="ck_street_lobbies_window"),
        Index("ix_street_lobbies_live", "status", "expires_at"),
        Index("ix_street_lobbies_zone_intent", "zone", "intent", "created_at"),
        Index("ix_street_lobbies_h3_r9", "h3_r9", "status", "expires_at"),
        Index("ix_street_lobbies_h3_r8", "h3_r8", "status", "expires_at"),
        Index("ix_street_lobbies_h3_r7", "h3_r7", "status", "expires_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    host_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    title = Column(String(140), nullable=False)
    intent = Column(String(24), nullable=False)
    details = Column(Text, nullable=True)
    zone = Column(String(80), nullable=False)
    # A table's own pin. Public cards expose distance, never these coordinates.
    # The three H3 strings make nearby matching an indexed string comparison.
    geo_lat = Column(Float, nullable=True)
    geo_lng = Column(Float, nullable=True)
    h3_r9 = Column(String(20), nullable=True)
    h3_r8 = Column(String(20), nullable=True)
    h3_r7 = Column(String(20), nullable=True)
    tags = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    seats = Column(Integer, nullable=False, default=2, server_default="2")
    joined_count = Column(Integer, nullable=False, default=1, server_default="1")
    status = Column(String(12), nullable=False, default="open", server_default="open")
    handoff_channel = Column(String(16), nullable=False)
    # A phone number or a Telegram handle. Never returned by the list endpoint;
    # only a person who joins receives the URL built from it.
    handoff_target = Column(String(120), nullable=False)
    verification_code = Column(String(12), nullable=False, unique=True)
    opens_at = Column(DateTime(timezone=True), nullable=False,
                      default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        default=lambda: datetime.now(timezone.utc), server_default=text("now()"))


class StreetLobbyMember(Base):
    __tablename__ = "street_lobby_members"
    __table_args__ = (
        UniqueConstraint("lobby_id", "vendor_id", name="uq_street_lobby_member"),
        Index("ix_street_lobby_members_vendor", "vendor_id", "joined_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    lobby_id = Column(UUID(as_uuid=True), ForeignKey("street_lobbies.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       nullable=False)
    joined_at = Column(DateTime(timezone=True), nullable=False,
                       default=lambda: datetime.now(timezone.utc), server_default=text("now()"))


class StreetBroadcast(Base):
    """One official script publication, stamped by the scheduler.

    The calendar rule stays deterministic: a missed sweep never hides the
    weekday prompt. This row is the public proof that the scheduled broadcast
    actually ran, and it lets the UI separate an official slot from a live
    table someone opened. One row per script per local day.
    """
    __tablename__ = "street_broadcasts"
    __table_args__ = (
        UniqueConstraint("script_key", "run_date", name="uq_street_broadcast_day"),
        Index("ix_street_broadcasts_day", "run_date", "published_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    script_key = Column(String(40), nullable=False)
    run_date = Column(Date, nullable=False)
    season_key = Column(String(40), nullable=False)
    title = Column(String(180), nullable=False)
    detail = Column(Text, nullable=False)
    href = Column(String(180), nullable=False)
    published_at = Column(DateTime(timezone=True), nullable=False,
                          default=lambda: datetime.now(timezone.utc),
                          server_default=text("now()"))

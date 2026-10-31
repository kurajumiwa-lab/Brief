"""Market intake — what sellers advertise in public, turned into a table.

Three tables, and one rule that keeps them honest:

  · **`market_intake_batches`** — one upload of up to twelve photographs (or one
    pasted block of text), with the OCR engine that read it and the seller
    banner it guessed. The batch is the audit trail: every row below can be
    traced back to the picture it came from.

  · **`market_observations`** — one price statement: "Maya diapers bale,
    2,100". These are *suggestions* until a human confirms them. A rejected
    row is kept, not deleted, because "we read this and decided it was wrong"
    is the only way the extraction rules ever improve.

  · **`market_presences`** — a seller who has no account here. They get a
    virtual ID (`~khetia-4f2a`) so their prices can belong to *someone* without
    inventing an account, sending them an email or asking them to sign up.
    Nothing about a presence can authenticate: it is a label on a fact, and
    when the seller does join, `claimed_vendor_id` links the label to their
    real account — their history arrives with them.

Why no foreign key from an observation to a vendor: most of the market is not
registered yet. That is the entire point of the module. Forcing a vendor row
would either drop the data or manufacture fake accounts.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

OBSERVATION_STATUSES = ("suggested", "confirmed", "rejected")
BATCH_STATUSES = ("parsed", "empty", "failed")


class MarketIntakeBatch(Base):
    __tablename__ = "market_intake_batches"
    __table_args__ = (
        CheckConstraint(
            "status IN ('parsed','empty','failed')", name="ck_market_intake_batch_status"
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Who ran the intake. Operators only, but nullable so a batch can be created
    # by a scheduled import that has no user behind it.
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    source = Column(String(16), nullable=False, default="screenshots", server_default="screenshots")
    image_count = Column(Integer, nullable=False, default=0, server_default="0")
    image_urls = Column(JSONB, nullable=False, default=list, server_default="[]")
    ocr_engine = Column(String(32), nullable=True)
    raw_text = Column(Text, nullable=True)
    seller_hint = Column(String(160), nullable=True)
    phone_hint = Column(String(24), nullable=True)
    market = Column(String(80), nullable=True)
    note = Column(Text, nullable=True)
    status = Column(String(16), nullable=False, default="parsed", server_default="parsed")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class MarketPresence(Base):
    """A seller we can name but who has no account. Costs nothing to create."""

    __tablename__ = "market_presences"
    __table_args__ = (Index("ix_market_presences_phone", "phone"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Handle-shaped and prefixed with "~" so it can never be mistaken for a
    # real @handle, and can never be used to sign in.
    virtual_id = Column(String(32), nullable=False, unique=True, index=True)
    display_name = Column(String(160), nullable=False)
    phone = Column(String(24), nullable=True)
    market = Column(String(80), nullable=True)
    categories = Column(JSONB, nullable=False, default=list, server_default="[]")
    observation_count = Column(Integer, nullable=False, default=0, server_default="0")
    first_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    claimed_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    claimed_at = Column(DateTime, nullable=True)


class MarketObservation(Base):
    __tablename__ = "market_observations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('suggested','confirmed','rejected')",
            name="ck_market_observation_status",
        ),
        Index("ix_market_observations_status_created", "status", "created_at"),
        Index("ix_market_observations_category", "category"),
        Index("ix_market_observations_market", "market"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(
        UUID(as_uuid=True),
        ForeignKey("market_intake_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    presence_id = Column(
        UUID(as_uuid=True), ForeignKey("market_presences.id", ondelete="SET NULL"), nullable=True
    )

    # What the photograph said. `product` is the seller's words, not ours: it is
    # never matched to a catalogue item here, because that is a human's call.
    product = Column(String(160), nullable=False)
    price_kes = Column(Integer, nullable=False)
    quantity = Column(Float, nullable=True)
    unit = Column(String(16), nullable=True)
    category = Column(String(60), nullable=True)
    market = Column(String(80), nullable=True)
    seller_label = Column(String(160), nullable=True)
    phone = Column(String(24), nullable=True)
    wholesale = Column(Boolean, nullable=False, default=False, server_default="false")
    confidence = Column(Float, nullable=False, default=0.5, server_default="0.5")
    raw_line = Column(Text, nullable=True)

    status = Column(String(16), nullable=False, default="suggested", server_default="suggested")
    decided_by = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    decided_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

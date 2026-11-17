"""Corridor price index — one row per (corridor, town, category) benchmark.

The table is a derived snapshot, not a source of truth. It is rebuilt from
confirmed trades, completed bookings and linked receipts, and a missing row is
the honest answer when the sample is too small.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class CorridorPriceIndex(Base):
    __tablename__ = "corridor_price_indices"
    __table_args__ = (
        UniqueConstraint("region_slug", "town", "category_slug",
                         name="uq_corridor_price_scope"),
        CheckConstraint("sample_count >= 5", name="ck_corridor_price_min_sample"),
        CheckConstraint(
            "p25_kes >= 0 AND median_kes >= 0 AND p75_kes >= 0",
            name="ck_corridor_price_nonnegative",
        ),
        Index("ix_corridor_price_lookup", "region_slug", "category_slug", "town"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    region_slug = Column(String(64), nullable=False)
    # A specific town ("kisumu") or "ALL" for the corridor-wide fallback.
    town = Column(String(64), nullable=False, default="ALL", server_default="ALL")
    category_slug = Column(String(64), nullable=False)
    sample_count = Column(Integer, nullable=False)
    p25_kes = Column(Numeric(10, 2), nullable=False)
    median_kes = Column(Numeric(10, 2), nullable=False)
    p75_kes = Column(Numeric(10, 2), nullable=False)
    computed_at = Column(DateTime(timezone=True), nullable=False,
                         default=datetime.utcnow, server_default="now()")

"""What the guide remembers, and nothing more.

Two tables, both logs. Neither is a profile of a person:

  · ``guide_searches`` records the *words* and whether the network could answer
    them. It never records who searched, except when the searcher is already a
    signed-in vendor — and even then the only use is de-duplication. Aggregated
    answers are floored at three searches (see ``services/guide.py``) so no
    single person's question can be read back off the API.
  · ``guide_shelf_visits`` records which shelf was opened, once, with no query
    and no content. It exists so the guide can learn "after stock people look at
    markets" from actual behaviour instead of from a guess.

Both are append-only and both are safe to truncate: the product degrades to the
declared shelf map, which is what it ships with anyway.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class GuideSearch(Base):
    """One thing somebody asked for, and whether the shelves could answer."""

    __tablename__ = "guide_searches"
    __table_args__ = (
        # The demand query: "zero-result searches, grouped, last N days".
        Index("ix_guide_searches_miss", "result_count", "created_at"),
        Index("ix_guide_searches_query", "query", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Nullable on purpose: most searching is done by people who are not signed
    # in, and the guide must work for them. ``SET NULL`` means closing a
    # business does not rewrite the network's memory of what was missing.
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    query = Column(String(200), nullable=False)
    shelf = Column(String(40), nullable=True)
    result_count = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class GuideShelfVisit(Base):
    """A shelf was opened. No query, no content, no page views beyond this."""

    __tablename__ = "guide_shelf_visits"
    __table_args__ = (
        # The next-shelf query joins this table to itself on
        # (vendor_id, created_at) — so that is the index it needs.
        Index("ix_guide_visits_vendor_time", "vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=True, index=True
    )
    shelf = Column(String(40), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))

"""Cached H3 cells for the free open-data context layer.

One row is one street-block cell (resolution 9). The fixtures are a snapshot of
named OSM anchors — stages, markets, schools, shops, clinics — so the second
person who opens the same block gets an instant local read with no Overpass
call. The row also records a failed attempt, which is what stops a quiet area
from hammering a free endpoint on every screen open.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, DateTime, Float, Index, Integer, String, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base


class GeoHexCell(Base):
    __tablename__ = "geo_hex_cells"
    __table_args__ = (
        UniqueConstraint("h3_index", name="uq_geo_hex_cells_h3_index"),
        Index("ix_geo_hex_cells_h3_index", "h3_index"),
        Index("ix_geo_hex_cells_refreshed", "refreshed_at"),
        Index("ix_geo_hex_cells_attempted", "attempted_at"),
    )

    # The res-9 H3 string is the natural key: one block, one cached snapshot.
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    h3_index = Column(String(20), nullable=False)
    resolution = Column(Integer, nullable=False, default=9, server_default="9")
    center_lat = Column(Float, nullable=False)
    center_lng = Column(Float, nullable=False)
    label = Column(String(200), nullable=True)

    fixtures = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    fixture_count = Column(Integer, nullable=False, default=0, server_default="0")
    source = Column(String(24), nullable=False, default="none", server_default="none")
    last_error = Column(String(300), nullable=True)

    refreshed_at = Column(DateTime(timezone=True), nullable=True)
    attempted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        default=lambda: datetime.now(timezone.utc),
                        server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False,
                        default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc),
                        server_default=text("now()"))

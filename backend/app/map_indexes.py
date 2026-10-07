"""The map's spatial indexes — one source of truth, two installation paths.

A viewport query is:

    WHERE lat BETWEEN :south AND :north AND lng BETWEEN :west AND :east

Without an index that is a sequential scan of the whole directory on every pan.
With a composite btree on `(lat, lng)` it is two range scans, which is all a
rectangular viewport needs. This module holds the DDL once so `init_db()` (dev,
`AUTO_CREATE_TABLES=true`) and `alembic upgrade head` (production) install
exactly the same indexes — the pattern `app/db_triggers.py` already established.

Why btree and not GIST
----------------------
PostGIS/GIST is the stronger tool for polygon geometry and radius searches, and
it is a one-command switch (see `docs/briefs/map-performance.md`):

    CREATE EXTENSION IF NOT EXISTS postgis;
    ALTER TABLE public_places ADD COLUMN location geometry(Point, 4326);
    UPDATE public_places SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326);
    CREATE INDEX places_location_idx ON public_places USING GIST (location);

We do not *require* it: many managed Postgres instances have no PostGIS, and a
marketplace should not need an extension to draw a rectangle. These indexes
need no extension and work on every Postgres the app supports.
"""

from sqlalchemy import text

# Only rows that can be drawn are indexed. `removed` rows (dropped by the source)
# stay out, which keeps the index small and the planner honest.
MAPPABLE = "status IN ('active', 'claimed')"

INDEX_STATEMENTS = [
    # The directory — the 7,640-row table every pan hits.
    "CREATE INDEX IF NOT EXISTS ix_public_places_lat_lng ON public_places (lat, lng)",
    f"CREATE INDEX IF NOT EXISTS ix_public_places_mappable_lat_lng ON public_places (lat, lng) WHERE {MAPPABLE}",
    # "How much of this market is mapped?" — the market bottom sheet and cards.
    f"CREATE INDEX IF NOT EXISTS ix_public_places_zone_mappable ON public_places (zone_id) WHERE {MAPPABLE}",
    # Quick filters (food / electronics / …) and the category facets.
    f"CREATE INDEX IF NOT EXISTS ix_public_places_category ON public_places (category) WHERE {MAPPABLE}",
    # Vendor pins.
    "CREATE INDEX IF NOT EXISTS ix_vendors_geo_lat_lng ON vendors (geo_lat, geo_lng)",
    # Market pins.
    "CREATE INDEX IF NOT EXISTS ix_market_zones_center ON market_zones (center_lat, center_lng)",
    # The vendor bottom sheet counts what is visible to the network.
    "CREATE INDEX IF NOT EXISTS ix_stock_items_vendor_visible ON stock_items (vendor_id) WHERE visible_to_network IS TRUE",
]

# Statistics, so the planner knows the new indexes are worth using.
ANALYZE_STATEMENTS = [
    "ANALYZE public_places",
    "ANALYZE vendors",
]

DROP_STATEMENTS = [
    "DROP INDEX IF EXISTS ix_stock_items_vendor_visible",
    "DROP INDEX IF EXISTS ix_market_zones_center",
    "DROP INDEX IF EXISTS ix_vendors_geo_lat_lng",
    "DROP INDEX IF EXISTS ix_public_places_category",
    "DROP INDEX IF EXISTS ix_public_places_zone_mappable",
    "DROP INDEX IF EXISTS ix_public_places_mappable_lat_lng",
    "DROP INDEX IF EXISTS ix_public_places_lat_lng",
]


async def ensure_map_indexes(conn) -> None:
    """Install every map index on a raw connection (idempotent)."""
    for statement in INDEX_STATEMENTS:
        await conn.execute(text(statement))
    for statement in ANALYZE_STATEMENTS:
        await conn.execute(text(statement))

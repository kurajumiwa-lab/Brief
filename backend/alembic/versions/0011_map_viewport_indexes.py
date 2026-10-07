"""Map viewport performance: indexes that make a bounding-box query a range scan.

Revision ID: 0011_map_viewport_indexes
Revises: 0010_market_patrons
Create Date: 2026-10-07

Why this migration exists
-------------------------
The map used to `SELECT *` the whole public-places directory, ship every row to
the phone and build a Leaflet marker per row. The phone did not hang because of
Leaflet; it hung because it was handed 7,640 places at once.

The fix is viewport queries (`GET /api/map/viewport`):

    WHERE lat BETWEEN :south AND :north AND lng BETWEEN :west AND :east

An unindexed `(lat, lng)` pair turns that into a sequential scan of every row
on every pan — fine at 7,640 rows in dev, fatal at 700,000. A composite btree
index on `(lat, lng)` turns it into two range scans, which is all a rectangular
viewport needs. Postgres can use the leading column alone (latitude band) and
combine it with a filter on the second, so the same index serves the box.

Why not PostGIS / GIST
----------------------
PostGIS is the right answer for polygon geometry, `ST_DWithin` radius searches
and real projection handling, and it is a one-command switch if you run it:

    CREATE EXTENSION IF NOT EXISTS postgis;
    ALTER TABLE public_places ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);
    UPDATE public_places SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326);
    CREATE INDEX places_location_idx ON public_places USING GIST (location);
    -- then: WHERE ST_Intersects(location, ST_MakeEnvelope(:w,:s,:e,:n, 4326))

We do not require it: plenty of managed Postgres instances (including the
cheapest tiers) have no PostGIS, and a marketplace tile service should not have
a hard extension dependency to draw a rectangle. The btree pair below is
portable, needs no extension, and is what the query planner uses here.

Indexes added
-------------
* public_places (lat, lng)                    — the directory viewport scan
* public_places (lat, lng) WHERE status …     — partial: only mappable rows
* public_places (zone_id) WHERE status …      — "places in this market"
* public_places (category)                    — quick-filter facets
* vendors (geo_lat, geo_lng)                  — vendor pins
* market_zones (center_lat, center_lng)       — market pins
* stock_items (vendor_id) WHERE visible       — the vendor bottom sheet
"""

from alembic import op

from app.map_indexes import ANALYZE_STATEMENTS, DROP_STATEMENTS, INDEX_STATEMENTS

# revision identifiers, used by Alembic.
revision: str = '0011_map_viewport_indexes'
down_revision: str = '0010_market_patrons'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # The DDL lives in app/map_indexes.py so `init_db()` (dev) and this
    # migration (production) install exactly the same indexes.
    for statement in INDEX_STATEMENTS:
        op.execute(statement)
    # Fresh statistics on the columns the planner now has to choose with.
    for statement in ANALYZE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    for statement in DROP_STATEMENTS:
        op.execute(statement)

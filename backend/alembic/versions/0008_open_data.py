"""Open data: public places (OSM ingest) + market zone coordinates.

Revision ID: 0008_open_data
Revises: 0007_halal_finance
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0008_open_data'
down_revision: str = '0007_halal_finance'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Market zones get a real location ----------------------------------
    # Without center + radius a zone can never be drawn, searched or ingested
    # from a public source. NULL means "not located yet" — the ingest geocodes
    # the zone name on first run and fills these in.
    op.add_column('market_zones', sa.Column('center_lat', sa.Float(), nullable=True))
    op.add_column('market_zones', sa.Column('center_lng', sa.Float(), nullable=True))
    op.add_column('market_zones', sa.Column('radius_km', sa.Float(), nullable=True))
    op.add_column('market_zones', sa.Column('last_ingest_at', sa.DateTime(), nullable=True))
    op.add_column('market_zones', sa.Column('last_ingest_count', sa.Integer(), nullable=True))

    # --- Public places: rows sourced from OpenStreetMap, ODbL ---------------
    # These are NOT vendor accounts. They are external facts (name, category,
    # phone, hours, coordinates) with their source id and last-checked time,
    # shown with an "unverified · public data" badge until a vendor claims the
    # place and it becomes their real row.
    op.create_table(
        'public_places',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('source', sa.String(length=40), nullable=False),
        sa.Column('external_id', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=300), nullable=False),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('detail', sa.String(length=200), nullable=True),
        sa.Column('phone', sa.String(length=80), nullable=True),
        sa.Column('opening_hours', sa.String(length=300), nullable=True),
        sa.Column('website', sa.String(length=500), nullable=True),
        sa.Column('address', sa.String(length=500), nullable=True),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lng', sa.Float(), nullable=False),
        sa.Column('zone_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('market_zones.id', ondelete='SET NULL'), nullable=True),
        sa.Column('zone_name', sa.String(length=120), nullable=True),
        sa.Column('first_seen_at', sa.DateTime(), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('last_checked_at', sa.DateTime(), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('claimed_by_vendor_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vendors.id', ondelete='SET NULL'), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False,
                  server_default='active'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('source', 'external_id', name='uq_public_place_source_external'),
    )
    op.create_index('ix_public_places_zone', 'public_places', ['zone_id'])
    op.create_index('ix_public_places_status', 'public_places', ['status'])


def downgrade() -> None:
    op.drop_index('ix_public_places_status', table_name='public_places')
    op.drop_index('ix_public_places_zone', table_name='public_places')
    op.drop_table('public_places')
    for col in ('last_ingest_count', 'last_ingest_at', 'radius_km', 'center_lng', 'center_lat'):
        op.drop_column('market_zones', col)

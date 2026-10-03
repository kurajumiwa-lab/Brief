"""East-African market catalog + market membership + market patron welcome.

Revision ID: 0010_market_patrons
Revises: 0009_hustle_league
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0010_market_patrons'
down_revision: str = '0009_hustle_league'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A market's country, so the regional scan can group and filter by country.
    op.add_column('market_zones', sa.Column('country', sa.String(length=80), nullable=True))

    # The lead patron's onboarding / pace note for the market. Written by the
    # lead patron, read by every member. NULL until a patron sets it.
    op.add_column('market_zones', sa.Column('patron_welcome', sa.Text(), nullable=True))
    op.add_column('market_zones', sa.Column('patron_welcome_by',
                  postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('market_zones', sa.Column('patron_welcome_at', sa.DateTime(), nullable=True))

    # Market membership — the "register for a market" row. Patron standing is
    # DERIVED from these rows plus a member's real activity; nothing is stored
    # as a rank that a bug or a grant could inflate.
    op.create_table(
        'market_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('vendor_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('zone_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('market_zones.id', ondelete='CASCADE'), nullable=False),
        sa.Column('joined_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('vendor_id', 'zone_id', name='uq_market_member'),
    )
    op.create_index('ix_market_members_zone', 'market_members', ['zone_id'])
    op.create_index('ix_market_members_vendor', 'market_members', ['vendor_id'])


def downgrade() -> None:
    op.drop_index('ix_market_members_vendor', table_name='market_members')
    op.drop_index('ix_market_members_zone', table_name='market_members')
    op.drop_table('market_members')
    for col in ('patron_welcome_at', 'patron_welcome_by', 'patron_welcome', 'country'):
        op.drop_column('market_zones', col)

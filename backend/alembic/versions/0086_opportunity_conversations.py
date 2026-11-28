"""Opportunity-specific conversations and participant-reported outcomes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0086_opportunity_conversations'
down_revision = '0085_market_reservation'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('opportunity_conversations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('opportunity_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('market_opportunities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('buyer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('seller_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('room_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('chat_rooms.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('title_snapshot', sa.String(160), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('first_enquiry_at', sa.DateTime()), sa.Column('first_reply_at', sa.DateTime()),
        sa.Column('buyer_messages', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('seller_messages', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('buyer_confirmed_at', sa.DateTime()), sa.Column('seller_confirmed_at', sa.DateTime()),
        sa.UniqueConstraint('opportunity_id', 'buyer_id', name='uq_opportunity_buyer'))
    # Supabase grants API roles access to public-schema tables by default.
    # The app uses its server-side database role; deny direct API access.
    op.execute('ALTER TABLE opportunity_conversations ENABLE ROW LEVEL SECURITY')
    op.create_index('ix_opportunity_conversations_opportunity_id', 'opportunity_conversations', ['opportunity_id'])
    op.create_index('ix_opportunity_conversations_seller_id', 'opportunity_conversations', ['seller_id'])


def downgrade():
    op.drop_table('opportunity_conversations')

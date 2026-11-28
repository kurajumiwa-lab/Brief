"""General marketing briefs and private creator offers."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0087_marketing_campaigns'
down_revision = '0086_opportunity_conversations'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('marketing_campaigns',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(160), nullable=False), sa.Column('brief', sa.Text(), nullable=False),
        sa.Column('location', sa.String(160), nullable=False), sa.Column('budget_kes', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('budget_kes > 0', name='ck_campaign_budget'),
        sa.CheckConstraint("status IN ('open','closed','awarded')", name='ck_campaign_status'))
    op.create_index('ix_campaigns_status_created', 'marketing_campaigns', ['status', 'created_at'])
    op.create_table('marketing_campaign_offers',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('campaign_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('marketing_campaigns.id', ondelete='CASCADE'), nullable=False),
        sa.Column('vendor_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('message', sa.Text(), nullable=False), sa.Column('price_kes', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('campaign_id', 'vendor_id', name='uq_campaign_offer_vendor'),
        sa.CheckConstraint('price_kes > 0', name='ck_campaign_offer_price'),
        sa.CheckConstraint("status IN ('submitted','withdrawn','accepted')", name='ck_campaign_offer_status'))
    op.create_index('ix_marketing_campaign_offers_campaign_id', 'marketing_campaign_offers', ['campaign_id'])
    op.execute('ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE marketing_campaign_offers ENABLE ROW LEVEL SECURITY')


def downgrade():
    op.drop_table('marketing_campaign_offers')
    op.drop_table('marketing_campaigns')

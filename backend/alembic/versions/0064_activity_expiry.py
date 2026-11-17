"""Add independent discovery expiry to local activities.

Revision ID: 0064_activity_expiry
Revises: 0063_spotted_receipt_link
"""
from alembic import op
import sqlalchemy as sa
revision = '0064_activity_expiry'
down_revision = '0063_spotted_receipt_link'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('local_activities', sa.Column('expires_at', sa.DateTime(), nullable=True))
    op.execute("UPDATE local_activities SET expires_at = starts_at + interval '6 hours' WHERE posting_type = 'scheduled' AND starts_at IS NOT NULL")


def downgrade():
    op.drop_column('local_activities', 'expires_at')

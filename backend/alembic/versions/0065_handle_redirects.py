"""Reserve old profile handles and track changes.

Revision ID: 0065_handle_redirects
Revises: 0064_activity_expiry
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
revision = '0065_handle_redirects'
down_revision = '0064_activity_expiry'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('vendors', sa.Column('handle_changed_at', sa.DateTime(), nullable=True))
    # Legacy handles can be 100 characters, so aliases must accommodate them.
    op.create_table('profile_handle_redirects',
        sa.Column('old_handle', sa.String(100), primary_key=True),
        sa.Column('vendor_id', UUID(as_uuid=True), sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')))
    op.create_index('idx_profile_handle_redirects_vendor', 'profile_handle_redirects', ['vendor_id'])


def downgrade():
    op.drop_index('idx_profile_handle_redirects_vendor', table_name='profile_handle_redirects')
    op.drop_table('profile_handle_redirects')
    op.drop_column('vendors', 'handle_changed_at')

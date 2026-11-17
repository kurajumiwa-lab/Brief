"""Rename parsed receipt status and add rolling opt-out rate-limit ledger.

Revision ID: 0063_spotted_receipt_link
Revises: 0062_spotted_deals
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
revision = '0063_spotted_receipt_link'
down_revision = '0062_spotted_deals'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index('idx_spotted_deals_public_feed', table_name='spotted_deals')
    op.drop_constraint('ck_spotted_deals_status', 'spotted_deals', type_='check')
    op.drop_constraint('ck_spotted_confirmation_evidence', 'spotted_deals', type_='check')
    op.execute("UPDATE spotted_deals SET status='RECEIPT_LINKED' WHERE status='RECEIPT_CONFIRMED'")
    op.create_check_constraint('ck_spotted_deals_status', 'spotted_deals', "status IN ('LIVE_UNVERIFIED','RECEIPT_LINKED','PAUSED_FLAGGED','PAUSED_OPT_OUT','DISPUTED_REVIEW','OPTED_OUT','EXPIRED')")
    op.create_check_constraint('ck_spotted_confirmation_evidence', 'spotted_deals', "status <> 'RECEIPT_LINKED' OR (confirmed_receipt_id IS NOT NULL AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)")
    op.create_index('idx_spotted_deals_public_feed','spotted_deals',['region_slug','status','expires_at'],postgresql_where=sa.text("status IN ('LIVE_UNVERIFIED', 'RECEIPT_LINKED')"))
    op.alter_column('spotted_deal_flags','ip_subnet_hash',existing_type=sa.String(64),nullable=True)
    op.create_table('spotted_opt_out_attempts',sa.Column('id',UUID(as_uuid=True),primary_key=True,server_default=sa.text('gen_random_uuid()')),sa.Column('subnet_hash',sa.String(64),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False,server_default=sa.text('now()')))
    op.create_index('ix_spotted_opt_out_attempts_subnet_hash','spotted_opt_out_attempts',['subnet_hash'])
    op.create_index('ix_spotted_opt_out_attempts_created_at','spotted_opt_out_attempts',['created_at'])


def downgrade():
    op.drop_table('spotted_opt_out_attempts')
    op.execute("UPDATE spotted_deal_flags SET ip_subnet_hash = repeat('0',64) WHERE ip_subnet_hash IS NULL")
    op.alter_column('spotted_deal_flags','ip_subnet_hash',existing_type=sa.String(64),nullable=False)
    op.drop_index('idx_spotted_deals_public_feed',table_name='spotted_deals')
    op.drop_constraint('ck_spotted_confirmation_evidence','spotted_deals',type_='check')
    op.drop_constraint('ck_spotted_deals_status','spotted_deals',type_='check')
    op.execute("UPDATE spotted_deals SET status='RECEIPT_CONFIRMED' WHERE status='RECEIPT_LINKED'")
    op.create_check_constraint('ck_spotted_deals_status','spotted_deals',"status IN ('LIVE_UNVERIFIED','RECEIPT_CONFIRMED','PAUSED_FLAGGED','PAUSED_OPT_OUT','DISPUTED_REVIEW','OPTED_OUT','EXPIRED')")
    op.create_check_constraint('ck_spotted_confirmation_evidence','spotted_deals',"status <> 'RECEIPT_CONFIRMED' OR (confirmed_receipt_id IS NOT NULL AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)")
    op.create_index('idx_spotted_deals_public_feed','spotted_deals',['region_slug','status','expires_at'],postgresql_where=sa.text("status IN ('LIVE_UNVERIFIED', 'RECEIPT_CONFIRMED')"))

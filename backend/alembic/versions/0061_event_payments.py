"""Event logistics, booking holds and declared payment notes.

Revision ID: 0061_event_payments
Revises: 0060_merchant_claim_evidence
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0061_event_payments'
down_revision = '0060_merchant_claim_evidence'
branch_labels = None
depends_on = None


def upgrade():
    for col in [sa.Column('meeting_point', sa.Text()), sa.Column('departure_time', sa.String(32)),
                sa.Column('inclusions', postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
                sa.Column('checklist', postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
                sa.Column('payment_method', sa.String(24)), sa.Column('payment_number', sa.String(32)),
                sa.Column('payment_account', sa.String(64)), sa.Column('payment_recipient_name', sa.String(120)),
                sa.Column('hold_ttl_minutes', sa.Integer(), nullable=False, server_default='120'),
                sa.Column('slug', sa.String(120))]:
        op.add_column('events', col)
    op.execute("UPDATE events SET slug = id::text WHERE slug IS NULL")
    op.create_index('ix_events_slug', 'events', ['slug'], unique=True)
    op.create_check_constraint('ck_events_payment_method', 'events', "payment_method IS NULL OR payment_method IN ('TILL','PAYBILL','POCHI','SEND_MONEY','FREE')")
    op.create_check_constraint('ck_events_hold_ttl_minutes', 'events', 'hold_ttl_minutes BETWEEN 5 AND 10080')
    for col in [sa.Column('booking_status', sa.String(24), nullable=False, server_default='PENDING_PAYMENT'),
                sa.Column('hold_expires_at', sa.DateTime()), sa.Column('waitlist_position', sa.Integer()),
                sa.Column('mpesa_code', sa.String(16)), sa.Column('mpesa_amount', sa.Numeric(10, 2)),
                sa.Column('mpesa_raw_note', sa.Text()), sa.Column('mpesa_submitted_at', sa.DateTime()),
                sa.Column('mpesa_recipient_matched', sa.Boolean())]:
        op.add_column('event_registrations', col)
    # Existing registrations were already accepted under the legacy flow.
    op.execute("UPDATE event_registrations SET booking_status = 'CONFIRMED'")
    op.create_check_constraint('ck_event_registrations_booking_status', 'event_registrations', "booking_status IN ('PENDING_PAYMENT','PAYMENT_SUBMITTED','CONFIRMED','WAITLISTED','EXPIRED','CANCELLED')")
    op.create_unique_constraint('uq_event_registrations_mpesa_code', 'event_registrations', ['mpesa_code'])
    op.create_index('ix_event_registrations_event_booking', 'event_registrations', ['event_id', 'booking_status'])
    op.create_index('ix_event_registrations_hold_expiry', 'event_registrations', ['booking_status', 'hold_expires_at'])
    op.create_table("event_mpesa_codes", sa.Column("code", sa.String(16), primary_key=True), sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")))
    for name in ('EVENT_PAYMENT_SUBMITTED', 'EVENT_PAYMENT_CONFIRMED', 'EVENT_PAYMENT_REJECTED', 'EVENT_WAITLIST_PROMOTED', 'EVENT_HOLD_EXPIRED'):
        op.execute(f"ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS '{name}'")


def downgrade():
    op.drop_table("event_mpesa_codes")
    op.drop_index('ix_event_registrations_hold_expiry', table_name='event_registrations')
    op.drop_index('ix_event_registrations_event_booking', table_name='event_registrations')
    op.drop_constraint('uq_event_registrations_mpesa_code', 'event_registrations', type_='unique')
    op.drop_constraint('ck_event_registrations_booking_status', 'event_registrations', type_='check')
    for name in ('mpesa_recipient_matched', 'mpesa_submitted_at', 'mpesa_raw_note', 'mpesa_amount', 'mpesa_code', 'waitlist_position', 'hold_expires_at', 'booking_status'):
        op.drop_column('event_registrations', name)
    op.drop_index('ix_events_slug', table_name='events')
    op.drop_constraint('ck_events_hold_ttl_minutes', 'events', type_='check')
    op.drop_constraint('ck_events_payment_method', 'events', type_='check')
    for name in ('slug', 'hold_ttl_minutes', 'payment_recipient_name', 'payment_account', 'payment_number', 'payment_method', 'checklist', 'inclusions', 'departure_time', 'meeting_point'):
        op.drop_column('events', name)

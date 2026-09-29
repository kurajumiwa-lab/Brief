"""v2.2 — vendor-list reviews, tool bookings & calendars, courier route plans

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-29 18:00:00+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# New NotificationType members. Members are stored as the enum *names*.
NEW_NOTIFICATION_TYPES = ('LIST_REVIEW', 'BOOKING_REQUEST', 'BOOKING_UPDATE', 'ROUTE_UPDATE')


def upgrade() -> None:
    # --- notifications: four new moments -----------------------------------------------
    # ADD VALUE cannot be rolled back and must not be used in this same
    # transaction; this migration never reads them, the app does later.
    for value in NEW_NOTIFICATION_TYPES:
        op.execute(f"ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS '{value}'")

    # --- vendor-list reviews (§4.2) ------------------------------------------------------
    op.create_table(
        'vendor_list_reviews',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('vendor_list_id', sa.UUID(), nullable=False),
        sa.Column('reviewer_vendor_id', sa.UUID(), nullable=False),
        sa.Column('rating', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=160), nullable=True),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('verified_member', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('helpful_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('helpful_voters', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('rating >= 1 AND rating <= 5', name='ck_vendor_list_review_rating'),
        sa.ForeignKeyConstraint(['vendor_list_id'], ['vendor_lists.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewer_vendor_id'], ['vendors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('vendor_list_id', 'reviewer_vendor_id', name='uq_vendor_list_review'),
    )
    op.create_index(op.f('ix_vendor_list_reviews_vendor_list_id'), 'vendor_list_reviews', ['vendor_list_id'], unique=False)
    op.create_index(op.f('ix_vendor_list_reviews_reviewer_vendor_id'), 'vendor_list_reviews', ['reviewer_vendor_id'], unique=False)
    op.create_index(op.f('ix_vendor_list_reviews_created_at'), 'vendor_list_reviews', ['created_at'], unique=False)

    op.add_column('vendor_lists', sa.Column('avg_rating', sa.Float(), nullable=False, server_default='0'))
    op.add_column('vendor_lists', sa.Column('review_count', sa.Integer(), nullable=False, server_default='0'))

    # --- tool bookings: warehouse calendar, popup pitches, hotel rooms (§5.2–5.4) --------
    op.create_table(
        'tool_bookings',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tool_listing_id', sa.UUID(), nullable=False),
        sa.Column('booker_vendor_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='requested'),
        sa.Column('start_date', sa.DateTime(), nullable=False),
        sa.Column('end_date', sa.DateTime(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('unit', sa.String(length=50), nullable=True),
        sa.Column('rate', sa.Float(), nullable=True),
        sa.Column('estimated_cost', sa.Float(), nullable=True),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('decision_note', sa.Text(), nullable=True),
        sa.Column('requested_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('decided_at', sa.DateTime(), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('quantity > 0', name='ck_tool_bookings_quantity'),
        sa.CheckConstraint('end_date > start_date', name='ck_tool_bookings_dates'),
        sa.ForeignKeyConstraint(['tool_listing_id'], ['tool_listings.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['booker_vendor_id'], ['vendors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_tool_bookings_tool_listing_id'), 'tool_bookings', ['tool_listing_id'], unique=False)
    op.create_index(op.f('ix_tool_bookings_booker_vendor_id'), 'tool_bookings', ['booker_vendor_id'], unique=False)
    op.create_index(op.f('ix_tool_bookings_kind'), 'tool_bookings', ['kind'], unique=False)
    op.create_index(op.f('ix_tool_bookings_status'), 'tool_bookings', ['status'], unique=False)
    op.create_index(op.f('ix_tool_bookings_start_date'), 'tool_bookings', ['start_date'], unique=False)
    op.create_index(op.f('ix_tool_bookings_end_date'), 'tool_bookings', ['end_date'], unique=False)
    op.create_index('ix_tool_bookings_calendar', 'tool_bookings',
                    ['tool_listing_id', 'status', 'start_date', 'end_date'], unique=False)

    # --- courier route plans (§5.5) ------------------------------------------------------
    op.create_table(
        'route_plans',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('courier_id', sa.UUID(), nullable=False),
        sa.Column('vendor_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=True),
        sa.Column('planned_for', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='planned'),
        sa.Column('total_stops', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_distance_km', sa.Float(), nullable=False, server_default='0'),
        sa.Column('baseline_distance_km', sa.Float(), nullable=False, server_default='0'),
        sa.Column('saved_km', sa.Float(), nullable=False, server_default='0'),
        sa.Column('estimated_minutes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('average_speed_kmh', sa.Float(), nullable=False, server_default='25'),
        sa.Column('return_to_start', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('algorithm', sa.String(length=50), nullable=False, server_default='nearest_neighbour+2opt'),
        sa.Column('start_label', sa.String(length=300), nullable=True),
        sa.Column('start_lat', sa.Float(), nullable=True),
        sa.Column('start_lng', sa.Float(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('stops_meta', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['courier_id'], ['courier_registrations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_route_plans_courier_id'), 'route_plans', ['courier_id'], unique=False)
    op.create_index(op.f('ix_route_plans_vendor_id'), 'route_plans', ['vendor_id'], unique=False)
    op.create_index(op.f('ix_route_plans_status'), 'route_plans', ['status'], unique=False)

    op.create_table(
        'route_stops',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('route_plan_id', sa.UUID(), nullable=False),
        sa.Column('shipment_id', sa.UUID(), nullable=True),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(length=300), nullable=False),
        sa.Column('address', sa.String(length=500), nullable=True),
        sa.Column('contact_phone', sa.String(length=40), nullable=True),
        sa.Column('geo_lat', sa.Float(), nullable=True),
        sa.Column('geo_lng', sa.Float(), nullable=True),
        sa.Column('weight_kg', sa.Float(), nullable=True),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('distance_from_prev_km', sa.Float(), nullable=True),
        sa.Column('cumulative_km', sa.Float(), nullable=True),
        sa.Column('eta_minutes', sa.Integer(), nullable=True),
        sa.Column('solved', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(['route_plan_id'], ['route_plans.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shipment_id'], ['courier_shipments.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_route_stops_route_plan_id'), 'route_stops', ['route_plan_id'], unique=False)
    op.create_index(op.f('ix_route_stops_shipment_id'), 'route_stops', ['shipment_id'], unique=False)


def downgrade() -> None:
    op.drop_table('route_stops')
    op.drop_table('route_plans')
    op.drop_index('ix_tool_bookings_calendar', table_name='tool_bookings')
    op.drop_table('tool_bookings')
    op.drop_column('vendor_lists', 'review_count')
    op.drop_column('vendor_lists', 'avg_rating')
    op.drop_table('vendor_list_reviews')
    # PostgreSQL cannot remove values from an enum type; the four
    # notificationtype members added above stay on the type.

"""v2.1 upgrade — notifications, stock quality verification, holds & negotiations,
SRM-lite performance, collective sourcing, courier shipments, event check-in

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-29 15:00:00+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NOTIFICATION_TYPES = (
    'SOURCE_REQUEST', 'SOURCE_ACCEPTED', 'SOURCE_SHIPPED', 'SOURCE_RECEIVED', 'SOURCE_CANCELLED',
    'DEAL_PROPOSAL', 'DEAL_ACCEPTED', 'DEAL_COUNTERED', 'DEAL_DECLINED',
    'GROUP_INVITE', 'GROUP_JOIN_REQUEST', 'GROUP_APPROVED', 'LIST_REGISTRATION', 'LIST_APPROVED', 'LIST_REJECTED',
    'COLLECTIVE_UPDATE', 'EVENT_REGISTRATION', 'EVENT_REMINDER',
    'STOCK_LOW', 'STOCK_VERIFIED', 'PARASITISM_MILESTONE', 'PATRON_PROMOTION', 'SHIPMENT_UPDATE', 'SYSTEM',
)
QUALITY_STATUSES = ('UNVERIFIED', 'SELF_DECLARED', 'PATRON_VERIFIED', 'LAB_CERTIFIED')


def upgrade() -> None:
    # --- enums --------------------------------------------------------------------------
    notification_type = postgresql.ENUM(*NOTIFICATION_TYPES, name='notificationtype', create_type=False)
    notification_type.create(op.get_bind(), checkfirst=True)
    quality_status = postgresql.ENUM(*QUALITY_STATUSES, name='qualitystatus', create_type=False)
    quality_status.create(op.get_bind(), checkfirst=True)
    # New patron tier. ADD VALUE is fine inside a transaction on PostgreSQL ≥ 12
    # as long as this migration does not use the value itself.
    op.execute("ALTER TYPE patrontier ADD VALUE IF NOT EXISTS 'LEGEND'")

    # --- notifications (§2.3) -----------------------------------------------------------
    op.create_table(
        'notifications',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('recipient_id', sa.UUID(), nullable=False),
        sa.Column('sender_id', sa.UUID(), nullable=True),
        sa.Column('notification_type', notification_type, nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('body', sa.String(length=500), nullable=True),
        sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['recipient_id'], ['vendors.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sender_id'], ['vendors.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_notifications_recipient_id'), 'notifications', ['recipient_id'], unique=False)
    op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'], unique=False)
    op.create_index('ix_notifications_recipient_unread', 'notifications', ['recipient_id', 'is_read', 'created_at'], unique=False)

    # --- stock quality verification (§3.1) --------------------------------------------
    op.add_column('stock_items', sa.Column('quality_status', quality_status, nullable=False, server_default='UNVERIFIED'))
    op.add_column('stock_items', sa.Column('spec_sheet_url', sa.String(length=500), nullable=True))
    op.add_column('stock_items', sa.Column('batch_number', sa.String(length=100), nullable=True))
    op.add_column('stock_items', sa.Column('origin_country', sa.String(length=100), nullable=True))
    op.add_column('stock_items', sa.Column('expiry_date', sa.DateTime(), nullable=True))
    op.add_column('stock_items', sa.Column('verified_by_vendor_id', sa.UUID(), nullable=True))
    op.add_column('stock_items', sa.Column('verified_at', sa.DateTime(), nullable=True))
    op.create_foreign_key('fk_stock_items_verified_by_vendor', 'stock_items', 'vendors', ['verified_by_vendor_id'], ['id'])

    # --- movements: timestamps for SRM-lite (§4.4) -------------------------------------
    op.add_column('stock_movements', sa.Column('confirmed_at', sa.DateTime(), nullable=True))
    op.add_column('stock_movements', sa.Column('shipped_at', sa.DateTime(), nullable=True))
    op.add_column('stock_movements', sa.Column('cancelled_by_vendor_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_stock_movements_cancelled_by', 'stock_movements', 'vendors', ['cancelled_by_vendor_id'], ['id'])

    # --- vendors: fulfilment counters --------------------------------------------------
    op.add_column('vendors', sa.Column('movements_completed', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('vendors', sa.Column('movements_cancelled', sa.Integer(), nullable=False, server_default='0'))

    # --- events: reminders + check-in (§2.3, §4.4) ------------------------------------
    op.add_column('events', sa.Column('reminder_sent_at', sa.DateTime(), nullable=True))
    op.add_column('event_registrations', sa.Column('checked_in_at', sa.DateTime(), nullable=True))

    # --- price negotiations (§3.3) -----------------------------------------------------
    op.create_table(
        'price_negotiations',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('stock_item_id', sa.UUID(), nullable=True),
        sa.Column('buyer_vendor_id', sa.UUID(), nullable=True),
        sa.Column('seller_vendor_id', sa.UUID(), nullable=True),
        sa.Column('original_price', sa.Float(), nullable=False),
        sa.Column('counter_offer', sa.Float(), nullable=False),
        sa.Column('accepted_price', sa.Float(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('rounds', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('last_offer_by_vendor_id', sa.UUID(), nullable=True),
        sa.Column('buyer_notes', sa.Text(), nullable=True),
        sa.Column('seller_notes', sa.Text(), nullable=True),
        sa.Column('chat_room_id', sa.UUID(), nullable=True),
        sa.Column('message_id', sa.UUID(), nullable=True),
        sa.Column('movement_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['stock_item_id'], ['stock_items.id']),
        sa.ForeignKeyConstraint(['buyer_vendor_id'], ['vendors.id']),
        sa.ForeignKeyConstraint(['seller_vendor_id'], ['vendors.id']),
        sa.ForeignKeyConstraint(['last_offer_by_vendor_id'], ['vendors.id']),
        sa.ForeignKeyConstraint(['chat_room_id'], ['chat_rooms.id']),
        sa.ForeignKeyConstraint(['movement_id'], ['stock_movements.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_price_negotiations_stock_item_id'), 'price_negotiations', ['stock_item_id'], unique=False)
    op.create_index(op.f('ix_price_negotiations_buyer_vendor_id'), 'price_negotiations', ['buyer_vendor_id'], unique=False)
    op.create_index(op.f('ix_price_negotiations_seller_vendor_id'), 'price_negotiations', ['seller_vendor_id'], unique=False)
    op.create_index(op.f('ix_price_negotiations_status'), 'price_negotiations', ['status'], unique=False)

    # --- stock reservations / holds (§3.4) ---------------------------------------------
    op.create_table(
        'stock_reservations',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('stock_item_id', sa.UUID(), nullable=True),
        sa.Column('reserving_vendor_id', sa.UUID(), nullable=True),
        sa.Column('movement_id', sa.UUID(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('agreed_price', sa.Float(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='held'),
        sa.Column('hold_expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['stock_item_id'], ['stock_items.id']),
        sa.ForeignKeyConstraint(['reserving_vendor_id'], ['vendors.id']),
        sa.ForeignKeyConstraint(['movement_id'], ['stock_movements.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_stock_reservations_stock_item_id'), 'stock_reservations', ['stock_item_id'], unique=False)
    op.create_index(op.f('ix_stock_reservations_reserving_vendor_id'), 'stock_reservations', ['reserving_vendor_id'], unique=False)
    op.create_index(op.f('ix_stock_reservations_movement_id'), 'stock_reservations', ['movement_id'], unique=False)
    op.create_index(op.f('ix_stock_reservations_status'), 'stock_reservations', ['status'], unique=False)

    # --- vendor performance (§4.4) -----------------------------------------------------
    op.create_table(
        'vendor_performance',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('vendor_id', sa.UUID(), nullable=False),
        sa.Column('on_time_delivery_rate', sa.Float(), nullable=False, server_default='0'),
        sa.Column('order_fulfillment_rate', sa.Float(), nullable=False, server_default='0'),
        sa.Column('avg_fulfillment_hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('return_rate', sa.Float(), nullable=False, server_default='0'),
        sa.Column('dispute_rate', sa.Float(), nullable=False, server_default='0'),
        sa.Column('avg_response_hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('sourcing_acceptance_rate', sa.Float(), nullable=False, server_default='0'),
        sa.Column('total_deals_completed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_trade_value', sa.Float(), nullable=False, server_default='0'),
        sa.Column('reliability_score', sa.Float(), nullable=False, server_default='0'),
        sa.Column('calculated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('vendor_id'),
    )

    # --- collective sourcing (§5.3) ----------------------------------------------------
    op.create_table(
        'collective_sourcing',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('group_id', sa.UUID(), nullable=False),
        sa.Column('organizer_vendor_id', sa.UUID(), nullable=False),
        sa.Column('item_name', sa.String(length=300), nullable=False),
        sa.Column('item_category', sa.String(length=100), nullable=True),
        sa.Column('target_quantity', sa.Integer(), nullable=False),
        sa.Column('target_price_per_unit', sa.Float(), nullable=True),
        sa.Column('unit_of_measure', sa.String(length=50), nullable=False, server_default='units'),
        sa.Column('specifications', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='gathering'),
        sa.Column('current_pledged_quantity', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('pledge_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('deadline', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['group_id'], ['vendor_groups.id']),
        sa.ForeignKeyConstraint(['organizer_vendor_id'], ['vendors.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_collective_sourcing_group_id'), 'collective_sourcing', ['group_id'], unique=False)
    op.create_index(op.f('ix_collective_sourcing_status'), 'collective_sourcing', ['status'], unique=False)
    op.create_table(
        'collective_pledges',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('request_id', sa.UUID(), nullable=False),
        sa.Column('vendor_id', sa.UUID(), nullable=False),
        sa.Column('pledged_quantity', sa.Integer(), nullable=False),
        sa.Column('max_price_per_unit', sa.Float(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pledged'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['request_id'], ['collective_sourcing.id']),
        sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_collective_pledges_request_id'), 'collective_pledges', ['request_id'], unique=False)
    op.create_index(op.f('ix_collective_pledges_vendor_id'), 'collective_pledges', ['vendor_id'], unique=False)

    # --- courier shipments (§6.1) ------------------------------------------------------
    op.create_table(
        'courier_shipments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('courier_id', sa.UUID(), nullable=False),
        sa.Column('sender_vendor_id', sa.UUID(), nullable=False),
        sa.Column('receiver_vendor_id', sa.UUID(), nullable=False),
        sa.Column('movement_id', sa.UUID(), nullable=True),
        sa.Column('tracking_number', sa.String(length=100), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='picked_up'),
        sa.Column('origin', sa.String(length=500), nullable=True),
        sa.Column('destination', sa.String(length=500), nullable=True),
        sa.Column('weight_kg', sa.Float(), nullable=True),
        sa.Column('cost', sa.Float(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('picked_up_at', sa.DateTime(), nullable=True),
        sa.Column('delivered_at', sa.DateTime(), nullable=True),
        sa.Column('status_history', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('rating', sa.Integer(), nullable=True),
        sa.Column('review', sa.Text(), nullable=True),
        sa.Column('rated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['courier_id'], ['courier_registrations.id']),
        sa.ForeignKeyConstraint(['sender_vendor_id'], ['vendors.id']),
        sa.ForeignKeyConstraint(['receiver_vendor_id'], ['vendors.id']),
        sa.ForeignKeyConstraint(['movement_id'], ['stock_movements.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tracking_number'),
    )
    op.create_index(op.f('ix_courier_shipments_courier_id'), 'courier_shipments', ['courier_id'], unique=False)
    op.create_index(op.f('ix_courier_shipments_sender_vendor_id'), 'courier_shipments', ['sender_vendor_id'], unique=False)
    op.create_index(op.f('ix_courier_shipments_receiver_vendor_id'), 'courier_shipments', ['receiver_vendor_id'], unique=False)
    op.create_index(op.f('ix_courier_shipments_status'), 'courier_shipments', ['status'], unique=False)


def downgrade() -> None:
    op.drop_table('courier_shipments')
    op.drop_table('collective_pledges')
    op.drop_table('collective_sourcing')
    op.drop_table('vendor_performance')
    op.drop_table('stock_reservations')
    op.drop_table('price_negotiations')
    op.drop_column('event_registrations', 'checked_in_at')
    op.drop_column('events', 'reminder_sent_at')
    op.drop_column('vendors', 'movements_cancelled')
    op.drop_column('vendors', 'movements_completed')
    op.drop_constraint('fk_stock_movements_cancelled_by', 'stock_movements', type_='foreignkey')
    op.drop_column('stock_movements', 'cancelled_by_vendor_id')
    op.drop_column('stock_movements', 'shipped_at')
    op.drop_column('stock_movements', 'confirmed_at')
    op.drop_constraint('fk_stock_items_verified_by_vendor', 'stock_items', type_='foreignkey')
    for col in ('verified_at', 'verified_by_vendor_id', 'expiry_date', 'origin_country', 'batch_number', 'spec_sheet_url', 'quality_status'):
        op.drop_column('stock_items', col)
    op.drop_table('notifications')
    postgresql.ENUM(name='qualitystatus').drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name='notificationtype').drop(op.get_bind(), checkfirst=True)
    # PostgreSQL cannot remove a value from an enum; 'LEGEND' stays on patrontier.

"""Offers step 1: a service can be delivered in several ways, each with its own price and unit.

Additive. Creates service_mode_prices and copies each existing service's single price into one
row per delivery mode it already has on (clinic -> in_shop, home -> home_visit, remote -> remote).
Nothing existing is changed or removed; the legacy columns stay as they are.

Revision ID: 0055_service_mode_prices
Revises: 0054_event_host_notifications
Create Date: 2026-11-16
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0055_service_mode_prices"
down_revision: str = "0054_event_host_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "service_mode_prices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("service_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("booking_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("price_mode", sa.String(length=12), nullable=False, server_default="fixed"),
        sa.Column("price_kes", sa.Integer(), nullable=True),
        sa.Column("price_unit", sa.String(length=30), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("service_id", "mode", name="uq_service_mode_price"),
        sa.CheckConstraint("mode IN ('in_shop', 'home_visit', 'remote', 'drop_off', 'pickup_delivery')",
                           name="ck_service_mode_price_mode"),
        sa.CheckConstraint("price_mode IN ('fixed', 'negotiable', 'ask_me')",
                           name="ck_service_mode_price_price_mode"),
        sa.CheckConstraint("price_kes IS NULL OR price_kes >= 0", name="ck_service_mode_price_amount"),
        sa.CheckConstraint("price_mode <> 'ask_me' OR price_kes IS NULL", name="ck_service_mode_price_ask_me"),
    )
    op.create_index("ix_service_mode_prices_service_id", "service_mode_prices", ["service_id"])
    # Backfill: one row per delivery flag that is on. Ask-me services keep no amount.
    op.execute("""
        INSERT INTO service_mode_prices (id, service_id, mode, price_mode, price_kes, price_unit, created_at)
        SELECT gen_random_uuid(), s.id, m.mode, s.price_mode,
               CASE WHEN s.price_mode = 'ask_me' THEN NULL ELSE s.price_kes END,
               s.price_unit, now()
        FROM booking_services s
        CROSS JOIN LATERAL (VALUES ('in_shop', s.delivery_clinic),
                                   ('home_visit', s.delivery_home),
                                   ('remote', s.delivery_remote)) AS m(mode, is_on)
        WHERE m.is_on IS TRUE
    """)


def downgrade() -> None:
    op.drop_index("ix_service_mode_prices_service_id", table_name="service_mode_prices")
    op.drop_table("service_mode_prices")

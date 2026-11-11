"""Offerings lifecycle (Phase 3): pricing mode, archive, service radius, photos.

Additive only. Columns are added with safe defaults; no row is deleted or rewritten.
Pause and resume reuse the existing flags (visible_to_network, is_active, is_available), so
they add no column. Archive is a timestamp, so an archived offering is kept, not deleted.

Revision ID: 0043_offering_lifecycle
Revises: 0042_onboarding_activities
Create Date: 2026-11-11
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0043_offering_lifecycle"
down_revision: str = "0042_onboarding_activities"
branch_labels = None
depends_on = None

PRICE_MODES = "('fixed', 'negotiable', 'ask_me')"


def upgrade() -> None:
    # goods (stock_items)
    op.add_column("stock_items", sa.Column("price_mode", sa.String(12), nullable=False,
                                           server_default="fixed"))
    op.add_column("stock_items", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.create_check_constraint("ck_stock_items_price_mode", "stock_items", f"price_mode IN {PRICE_MODES}")

    # services (booking_services)
    op.add_column("booking_services", sa.Column("price_mode", sa.String(12), nullable=False,
                                                server_default="fixed"))
    op.add_column("booking_services", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.add_column("booking_services", sa.Column("service_radius_km", sa.Integer(), nullable=True))
    op.add_column("booking_services", sa.Column("images", postgresql.JSONB(), nullable=False,
                                                server_default=sa.text("'[]'::jsonb")))
    op.create_check_constraint("ck_booking_services_price_mode", "booking_services", f"price_mode IN {PRICE_MODES}")
    op.create_check_constraint("ck_booking_services_radius", "booking_services",
                               "service_radius_km IS NULL OR (service_radius_km > 0 AND service_radius_km <= 500)")

    # tools (tool_listings)
    op.add_column("tool_listings", sa.Column("price_mode", sa.String(12), nullable=False,
                                             server_default="fixed"))
    op.add_column("tool_listings", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.add_column("tool_listings", sa.Column("service_radius_km", sa.Integer(), nullable=True))
    op.create_check_constraint("ck_tool_listings_price_mode", "tool_listings", f"price_mode IN {PRICE_MODES}")
    op.create_check_constraint("ck_tool_listings_radius", "tool_listings",
                               "service_radius_km IS NULL OR (service_radius_km > 0 AND service_radius_km <= 500)")


def downgrade() -> None:
    op.drop_constraint("ck_tool_listings_radius", "tool_listings", type_="check")
    op.drop_constraint("ck_tool_listings_price_mode", "tool_listings", type_="check")
    op.drop_column("tool_listings", "service_radius_km")
    op.drop_column("tool_listings", "archived_at")
    op.drop_column("tool_listings", "price_mode")

    op.drop_constraint("ck_booking_services_radius", "booking_services", type_="check")
    op.drop_constraint("ck_booking_services_price_mode", "booking_services", type_="check")
    op.drop_column("booking_services", "images")
    op.drop_column("booking_services", "service_radius_km")
    op.drop_column("booking_services", "archived_at")
    op.drop_column("booking_services", "price_mode")

    op.drop_constraint("ck_stock_items_price_mode", "stock_items", type_="check")
    op.drop_column("stock_items", "archived_at")
    op.drop_column("stock_items", "price_mode")

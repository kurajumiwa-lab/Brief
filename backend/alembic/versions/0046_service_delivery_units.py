"""Service delivery modes and price unit (service-providers plan, Phase 1).

Additive only. Four columns on booking_services:
- delivery_clinic (bool, NOT NULL, server default true): where the service is given at the
  provider's base. Existing rows were all implicitly clinic/on-site, so they become true.
- delivery_home (bool, NOT NULL, server default false): home visits.
- delivery_remote (bool, NOT NULL, server default false): remote or online.
- price_unit (varchar 30, nullable): e.g. visit, hour, shift. NULL means not stated.

The server defaults backfill existing rows in the same statement. Downgrade drops only these
four columns; no data outside them is touched.

Revision ID: 0046_service_delivery_units
Revises: 0045_front_door_visibility
Create Date: 2026-11-11
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0046_service_delivery_units"
down_revision: str = "0045_front_door_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("booking_services", sa.Column(
        "delivery_clinic", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("booking_services", sa.Column(
        "delivery_home", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("booking_services", sa.Column(
        "delivery_remote", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("booking_services", sa.Column("price_unit", sa.String(length=30), nullable=True))


def downgrade() -> None:
    op.drop_column("booking_services", "price_unit")
    op.drop_column("booking_services", "delivery_remote")
    op.drop_column("booking_services", "delivery_home")
    op.drop_column("booking_services", "delivery_clinic")

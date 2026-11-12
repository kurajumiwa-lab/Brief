"""Service domain on booking_services (service-providers plan, Phase 6).

Additive: one nullable column. Existing rows get NULL, which means no domain stated.
Downgrade drops only this column.

Revision ID: 0048_add_booking_service_domain
Revises: 0047_vendor_credentials
Create Date: 2026-11-12
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0048_add_booking_service_domain"
down_revision: str = "0047_vendor_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("booking_services", sa.Column("domain", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("booking_services", "domain")

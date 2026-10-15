"""Storefront catalogue enquiries (v2.14).

Adds `catalog_enquiries` — the purchase/trial/quotation route for the
storefront catalogue. No existing table is altered; the catalogue itself
is static data in `app/modules/catalog/catalog.py`.

Revision ID: 0018_catalog_enquiries
Revises: 0017_enterprise_workspaces
Create Date: 2026-10-14
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "0018_catalog_enquiries"
down_revision: str = "0017_enterprise_workspaces"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_enquiries",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("offer_key", sa.String(64), nullable=True),
        sa.Column("tier_key", sa.String(24), nullable=True),
        sa.Column("kind", sa.String(24), nullable=False, server_default="purchase"),
        sa.Column("organisation_name", sa.String(200), nullable=True),
        sa.Column("contact_name", sa.String(200), nullable=True),
        sa.Column("contact_phone", sa.String(40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="new"),
        sa.Column("acknowledged_first_charge", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("first_charge_amount_kes", sa.Integer(), nullable=True),
        sa.Column("first_charge_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('purchase','trial','quotation','discovery_call')",
            name="ck_catalog_enquiry_kind"),
        sa.CheckConstraint(
            "status IN ('new','contacted','quoted','won','lost')",
            name="ck_catalog_enquiry_status"),
    )
    op.create_index("ix_catalog_enquiries_vendor_id", "catalog_enquiries", ["vendor_id"])
    op.create_index("ix_catalog_enquiries_vendor_created", "catalog_enquiries", ["vendor_id", "created_at"])
    op.create_index("ix_catalog_enquiries_status_created", "catalog_enquiries", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("catalog_enquiries")

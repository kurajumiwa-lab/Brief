"""Free for now: membership, future fee architecture and group logistics.

Additive only. Creates member profiles and their audit trail, the fee rules
(all seeded DISABLED with a zero amount) and its record ledger, and the group
logistics tables. Nothing existing is altered. The downgrade drops only these
new tables.

Revision ID: 0032_free_for_now_modules
Revises: 0031_feature_entitlements
Create Date: 2026-11-02
"""

from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0032_free_for_now_modules"
down_revision: str = "0031_feature_entitlements"
branch_labels = None
depends_on = None

FEE_SEED = (
    ("membership_monthly", "Flat monthly membership", "Monthly membership fee.", "flat"),
    ("membership_verification", "Verified membership service", "Fee for the verification service.", "flat"),
    ("logistics_coordination", "Logistics coordination", "Fee on a coordinated delivery.", "bps"),
    ("bulk_pool", "Bulk-order pooling", "Fee on a pooled group order.", "bps"),
    ("route_optimisation", "Shared route optimisation", "Fee per optimised shared route.", "flat"),
    ("community_event", "Community event coordination", "Fee per coordinated event.", "flat"),
    ("template_pack", "Professional templates and documents", "Price of a template or document pack.", "flat"),
)


def upgrade() -> None:
    op.create_table(
        "member_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("display_name", sa.String(120), nullable=True),
        sa.Column("category", sa.String(32), nullable=True),
        sa.Column("professional_class", sa.String(120), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("membership_status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("verification_status", sa.String(16), nullable=False, server_default="unverified"),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("verified_by", sa.String(100), nullable=True),
        sa.Column("directory_visible", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("show_contact", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("membership_status IN ('active','suspended')", name="ck_member_profiles_status"),
        sa.CheckConstraint("verification_status IN ('unverified','pending','verified','rejected')",
                           name="ck_member_profiles_verification"),
    )
    op.create_index("ix_member_profiles_directory", "member_profiles",
                    ["directory_visible", "membership_status"])

    op.create_table(
        "membership_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor", sa.String(100), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_membership_events_vendor_id", "membership_events", ["vendor_id"])
    op.create_index("ix_membership_events_created_at", "membership_events", ["created_at"])

    op.create_table(
        "fee_rules",
        sa.Column("key", sa.String(48), primary_key=True),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("basis", sa.String(8), nullable=False),
        sa.Column("amount_kes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("rate_bps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("updated_by", sa.String(100), nullable=True),
        sa.CheckConstraint("basis IN ('flat','bps')", name="ck_fee_rules_basis"),
        sa.CheckConstraint("amount_kes >= 0 AND rate_bps >= 0 AND rate_bps <= 2000",
                           name="ck_fee_rules_amounts"),
    )
    op.bulk_insert(
        sa.table("fee_rules",
                 sa.column("key", sa.String), sa.column("label", sa.String),
                 sa.column("description", sa.Text), sa.column("basis", sa.String),
                 sa.column("amount_kes", sa.BigInteger), sa.column("rate_bps", sa.Integer),
                 sa.column("enabled", sa.Boolean), sa.column("updated_at", sa.DateTime)),
        [{"key": k, "label": l, "description": d, "basis": b, "amount_kes": 0,
          "rate_bps": 0, "enabled": False, "updated_at": datetime.utcnow()}
         for k, l, d, b in FEE_SEED],
    )

    op.create_table(
        "fee_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("rule_key", sa.String(48), nullable=False),
        sa.Column("subject_type", sa.String(48), nullable=False),
        sa.Column("subject_id", sa.String(64), nullable=False),
        sa.Column("base_amount_kes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("fee_kes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_fee_records_rule_key", "fee_records", ["rule_key"])
    op.create_index("ix_fee_records_created_at", "fee_records", ["created_at"])

    op.create_table(
        "logistics_providers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("contact", sa.String(200), nullable=True),
        sa.Column("service_area", sa.String(200), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("external_ref", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "group_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organiser_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("item_summary", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("closes_at", sa.DateTime(), nullable=True),
        sa.Column("delivery_point", sa.String(300), nullable=True),
        sa.Column("window_start", sa.DateTime(), nullable=True),
        sa.Column("window_end", sa.DateTime(), nullable=True),
        sa.Column("provider_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("logistics_providers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("route", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('open','locked','scheduled','in_transit','delivered','cancelled')",
            name="ck_group_orders_status",
        ),
    )
    op.create_index("ix_group_orders_organiser_id", "group_orders", ["organiser_id"])

    op.create_table(
        "group_order_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("group_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantity_note", sa.String(300), nullable=True),
        sa.Column("status", sa.String(8), nullable=False, server_default="joined"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("order_id", "vendor_id", name="uq_group_order_participant"),
        sa.CheckConstraint("status IN ('joined','left')", name="ck_group_order_participant_status"),
    )
    op.create_index("ix_group_order_participants_order_id", "group_order_participants", ["order_id"])
    op.create_index("ix_group_order_participants_vendor_id", "group_order_participants", ["vendor_id"])

    op.create_table(
        "logistics_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("group_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor", sa.String(100), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_logistics_events_order_id", "logistics_events", ["order_id"])
    op.create_index("ix_logistics_events_created_at", "logistics_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("logistics_events")
    op.drop_table("group_order_participants")
    op.drop_table("group_orders")
    op.drop_table("logistics_providers")
    op.drop_table("fee_records")
    op.drop_table("fee_rules")
    op.drop_table("membership_events")
    op.drop_table("member_profiles")

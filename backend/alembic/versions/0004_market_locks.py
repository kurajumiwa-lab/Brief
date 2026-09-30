"""Daily Flash market zones, supplier MOQs and clustered vendor locks.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_zones",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=False, server_default="Nairobi"),
        sa.Column("name_key", sa.String(length=120), nullable=False),
        sa.Column("city_key", sa.String(length=120), nullable=False),
        sa.Column("walkable_ring", sa.String(length=240), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("city_key", "name_key", name="uq_market_zone_city_name"),
    )
    op.create_table(
        "lock_products",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("name_key", sa.String(length=160), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("unit_of_measure", sa.String(length=50), nullable=False, server_default="units"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name_key", "unit_of_measure", name="uq_lock_product_name_unit"),
    )
    op.create_table(
        "supplier_moqs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("supplier_vendor_id", sa.UUID(), nullable=False),
        sa.Column("zone_id", sa.UUID(), nullable=False),
        sa.Column("product_id", sa.UUID(), nullable=False),
        sa.Column("minimum_order_quantity", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["supplier_vendor_id"], ["vendors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["zone_id"], ["market_zones.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["lock_products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("supplier_vendor_id", "zone_id", "product_id", name="uq_supplier_moq_line"),
        sa.CheckConstraint("minimum_order_quantity > 0", name="ck_supplier_moq_positive"),
    )
    op.create_index(op.f("ix_supplier_moqs_supplier_vendor_id"), "supplier_moqs", ["supplier_vendor_id"])
    op.create_index(op.f("ix_supplier_moqs_zone_id"), "supplier_moqs", ["zone_id"])
    op.create_index(op.f("ix_supplier_moqs_product_id"), "supplier_moqs", ["product_id"])

    op.create_table(
        "lock_windows",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("zone_id", sa.UUID(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("opens_at", sa.DateTime(), nullable=False),
        sa.Column("closes_at", sa.DateTime(), nullable=False),
        sa.Column("delivery_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="open"),
        sa.Column("roll_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_vendor_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["zone_id"], ["market_zones.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_vendor_id"], ["vendors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("zone_id", "local_date", name="uq_lock_window_zone_date"),
        sa.CheckConstraint("closes_at > opens_at", name="ck_lock_window_times"),
        sa.CheckConstraint("delivery_at >= closes_at", name="ck_lock_window_delivery_after_close"),
    )
    op.create_index(op.f("ix_lock_windows_zone_id"), "lock_windows", ["zone_id"])

    op.create_table(
        "lock_clusters",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("window_id", sa.UUID(), nullable=False),
        sa.Column("product_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="collecting"),
        sa.Column("bid_quantity", sa.Integer(), nullable=True),
        sa.Column("selected_quote_id", sa.UUID(), nullable=True),
        sa.Column("locked_quantity", sa.Integer(), nullable=True),
        sa.Column("locked_unit_price", sa.Float(), nullable=True),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("dissolved_reason", sa.String(length=240), nullable=True),
        sa.Column("evaluated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["window_id"], ["lock_windows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["lock_products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("window_id", "product_id", name="uq_lock_cluster_window_product"),
    )
    op.create_index(op.f("ix_lock_clusters_window_id"), "lock_clusters", ["window_id"])
    op.create_index(op.f("ix_lock_clusters_product_id"), "lock_clusters", ["product_id"])

    op.create_table(
        "lock_picks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("cluster_id", sa.UUID(), nullable=False),
        sa.Column("vendor_id", sa.UUID(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="submitted"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["cluster_id"], ["lock_clusters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vendor_id"], ["vendors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cluster_id", "vendor_id", name="uq_lock_pick_vendor"),
        sa.CheckConstraint("quantity > 0", name="ck_lock_pick_positive_quantity"),
    )
    op.create_index(op.f("ix_lock_picks_cluster_id"), "lock_picks", ["cluster_id"])
    op.create_index(op.f("ix_lock_picks_vendor_id"), "lock_picks", ["vendor_id"])

    op.create_table(
        "supplier_quotes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("cluster_id", sa.UUID(), nullable=False),
        sa.Column("supplier_moq_id", sa.UUID(), nullable=False),
        sa.Column("quoted_quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Float(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="offered"),
        sa.Column("entered_by_vendor_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["cluster_id"], ["lock_clusters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_moq_id"], ["supplier_moqs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["entered_by_vendor_id"], ["vendors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("quoted_quantity > 0", name="ck_supplier_quote_positive_quantity"),
        sa.CheckConstraint("unit_price >= 0", name="ck_supplier_quote_nonnegative_price"),
    )
    op.create_index(op.f("ix_supplier_quotes_cluster_id"), "supplier_quotes", ["cluster_id"])
    op.create_index(op.f("ix_supplier_quotes_supplier_moq_id"), "supplier_quotes", ["supplier_moq_id"])

    op.add_column("vendors", sa.Column("market_zone_id", sa.UUID(), nullable=True))
    op.add_column("vendors", sa.Column("market_zone_changed_at", sa.DateTime(), nullable=True))
    op.create_foreign_key("fk_vendors_market_zone", "vendors", "market_zones", ["market_zone_id"], ["id"], ondelete="SET NULL")
    op.create_index(op.f("ix_vendors_market_zone_id"), "vendors", ["market_zone_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_vendors_market_zone_id"), table_name="vendors")
    op.drop_constraint("fk_vendors_market_zone", "vendors", type_="foreignkey")
    op.drop_column("vendors", "market_zone_changed_at")
    op.drop_column("vendors", "market_zone_id")

    op.drop_table("supplier_quotes")
    op.drop_table("lock_picks")
    op.drop_table("lock_clusters")
    op.drop_table("lock_windows")
    op.drop_table("supplier_moqs")
    op.drop_table("lock_products")
    op.drop_table("market_zones")

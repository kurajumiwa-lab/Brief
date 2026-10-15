"""Market Runs and the per-run order ledger (v2.15).

Adds `market_runs`, `run_orders`, `run_purchases` and `run_expenses` on
top of Market Locks. No Lock table is altered: a run references zones and
products when they exist, and snapshots names so ordering is never
blocked on ops setup.

Revision ID: 0019_market_runs
Revises: 0018_catalog_enquiries
Create Date: 2026-10-14
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "0019_market_runs"
down_revision: str = "0018_catalog_enquiries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "market_runs",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("zone_id", PGUUID(as_uuid=True), sa.ForeignKey("market_zones.id", ondelete="SET NULL"), nullable=True),
        sa.Column("market_name", sa.String(200), nullable=False),
        sa.Column("market_city", sa.String(120), nullable=False, server_default="Nairobi"),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("run_kind", sa.String(32), nullable=False, server_default="consolidated_supply"),
        sa.Column("run_date", sa.Date(), nullable=False),
        sa.Column("order_deadline", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="open"),
        sa.Column("buyer_vendor_id", PGUUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_vendor_id", PGUUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("funding_model", sa.String(32), nullable=False, server_default="mixed_open"),
        sa.Column("cold_chain_required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("cold_chain_plan", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("run_kind IN ('fresh_market','bulk_dry_goods','consolidated_supply')", name="ck_market_run_kind"),
        sa.CheckConstraint("status IN ('open','buying','allocating','delivering','completed','cancelled')", name="ck_market_run_status"),
        sa.CheckConstraint(
            "funding_model IN ('customer_advance','buyer_capital','supplier_credit','shop_consolidated','pooled','mixed_open')",
            name="ck_market_run_funding_model"),
    )
    op.create_index("ix_market_runs_status_date", "market_runs", ["status", "run_date"])
    op.create_index("ix_market_runs_zone_date", "market_runs", ["zone_id", "run_date"])

    op.create_table(
        "run_orders",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", PGUUID(as_uuid=True), sa.ForeignKey("market_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", PGUUID(as_uuid=True), sa.ForeignKey("lock_products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_name", sa.String(200), nullable=False),
        sa.Column("unit_of_measure", sa.String(50), nullable=False, server_default="units"),
        sa.Column("package_size", sa.String(120), nullable=True),
        sa.Column("wholesale_package", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("repack_required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("vendor_id", PGUUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("participant_type", sa.String(16), nullable=False, server_default="shop"),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("quantity_allocated", sa.Float(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="requested"),
        sa.Column("payment_method", sa.String(32), nullable=False, server_default="cash_on_delivery"),
        sa.Column("money_responsibility", sa.String(16), nullable=False, server_default="customer"),
        sa.Column("funding_source", sa.String(24), nullable=False, server_default="customer_advance"),
        sa.Column("delivery_mode", sa.String(24), nullable=False, server_default="collect_at_hub"),
        sa.Column("collection_point_vendor_id", PGUUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("delivery_area", sa.String(240), nullable=True),
        sa.Column("estimated_unit_price", sa.Float(), nullable=True),
        sa.Column("actual_unit_price", sa.Float(), nullable=True),
        sa.Column("delivery_fee_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("handling_fee_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("repack_fee_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("amount_paid_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payment_status", sa.String(24), nullable=False, server_default="unpaid"),
        sa.Column("payment_note", sa.Text(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("collected_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("participant_type IN ('family','shop')", name="ck_run_order_participant_type"),
        sa.CheckConstraint("quantity > 0", name="ck_run_order_quantity_positive"),
        sa.CheckConstraint(
            "payment_method IN ('advance_mpesa','advance_cash','cash_on_delivery','mpesa_on_delivery','shop_backed_collection')",
            name="ck_run_order_payment_method"),
        sa.CheckConstraint("money_responsibility IN ('customer','shop','buyer','platform')", name="ck_run_order_money_responsibility"),
        sa.CheckConstraint(
            "funding_source IN ('customer_advance','buyer_capital','supplier_credit','shop_funded','pooled')",
            name="ck_run_order_funding_source"),
        sa.CheckConstraint("delivery_mode IN ('collect_at_hub','collect_at_shop','home_delivery')", name="ck_run_order_delivery_mode"),
        sa.CheckConstraint(
            "status IN ('requested','confirmed','purchased','allocated','ready','collected','delivered','cancelled','refused')",
            name="ck_run_order_status"),
        sa.CheckConstraint("payment_status IN ('unpaid','deposit_paid','paid','refunded')", name="ck_run_order_payment_status"),
    )
    op.create_index("ix_run_orders_run_id", "run_orders", ["run_id"])
    op.create_index("ix_run_orders_vendor_id", "run_orders", ["vendor_id"])
    op.create_index("ix_run_orders_run_status", "run_orders", ["run_id", "status"])
    op.create_index("ix_run_orders_vendor_created", "run_orders", ["vendor_id", "created_at"])
    op.create_index("ix_run_orders_collection_point", "run_orders", ["collection_point_vendor_id"])

    op.create_table(
        "run_purchases",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", PGUUID(as_uuid=True), sa.ForeignKey("market_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", PGUUID(as_uuid=True), sa.ForeignKey("lock_products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_name", sa.String(200), nullable=False),
        sa.Column("product_name_key", sa.String(200), nullable=False),
        sa.Column("unit_of_measure", sa.String(50), nullable=False, server_default="units"),
        sa.Column("supplier_name", sa.String(200), nullable=True),
        sa.Column("supplier_vendor_id", PGUUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("quantity_purchased", sa.Float(), nullable=False),
        sa.Column("actual_unit_price", sa.Float(), nullable=False),
        sa.Column("receipt_ref", sa.Text(), nullable=True),
        sa.Column("weight_loss_quantity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("rejected_quantity", sa.Float(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("purchased_by_vendor_id", PGUUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "product_name_key", name="uq_run_purchase_product"),
        sa.CheckConstraint("quantity_purchased > 0", name="ck_run_purchase_quantity_positive"),
        sa.CheckConstraint("actual_unit_price >= 0", name="ck_run_purchase_price_nonnegative"),
    )
    op.create_index("ix_run_purchases_run_id", "run_purchases", ["run_id"])
    op.create_index("ix_run_purchases_run", "run_purchases", ["run_id"])

    op.create_table(
        "run_expenses",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", PGUUID(as_uuid=True), sa.ForeignKey("market_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("amount_kes", sa.Integer(), nullable=False),
        sa.Column("receipt_ref", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("recorded_by_vendor_id", PGUUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('transport','handling','repacking','cold_chain','market_fees','other')", name="ck_run_expense_kind"),
        sa.CheckConstraint("amount_kes >= 0", name="ck_run_expense_amount_nonnegative"),
    )
    op.create_index("ix_run_expenses_run_id", "run_expenses", ["run_id"])
    op.create_index("ix_run_expenses_run", "run_expenses", ["run_id"])


def downgrade() -> None:
    op.drop_table("run_expenses")
    op.drop_table("run_purchases")
    op.drop_table("run_orders")
    op.drop_table("market_runs")

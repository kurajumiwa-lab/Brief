"""Durable, buyer-scoped idempotency for repeat orders (no new order table).

Revision ID: 0020_reorder_key
Revises: 0019_market_runs
Create Date: 2026-10-15
"""

import sqlalchemy as sa
from alembic import op

revision = "0020_reorder_key"
down_revision = "0019_market_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stock_movements", sa.Column("reorder_key_hash", sa.String(64), nullable=True))
    op.add_column("stock_movements", sa.Column("reorder_request_hash", sa.String(64), nullable=True))
    op.create_index(
        "uq_stock_movements_buyer_reorder_key", "stock_movements",
        ["to_vendor_id", "reorder_key_hash"], unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_stock_movements_buyer_reorder_key", table_name="stock_movements")
    op.drop_column("stock_movements", "reorder_request_hash")
    op.drop_column("stock_movements", "reorder_key_hash")

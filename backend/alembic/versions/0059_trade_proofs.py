"""Receipt-backed trades: a scanned receipt becomes a two-sided fact.

Additive. Adds vendors.confirmed_trade_proofs, three notification types and the
trade_proofs table. No existing table is rewritten.

A proof is separate from a stock movement. It records that a buyer scanned a
receipt at a named shop and that the shop confirmed it; on confirmation both
profiles' counters move. No money, stock or delivery is involved.

Revision ID: 0059_trade_proofs
Revises: 0058_receipt_rewards
Create Date: 2026-11-20
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0059_trade_proofs"
down_revision: str = "0058_receipt_rewards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendors",
        sa.Column("confirmed_trade_proofs", sa.Integer(), nullable=False, server_default="0"),
    )
    for value in ("TRADE_PROOF_REQUEST", "TRADE_PROOF_CONFIRMED", "TRADE_PROOF_DISPUTED"):
        op.execute(f"ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS '{value}'")

    op.create_table(
        "trade_proofs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("receipts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("buyer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seller_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("merchant_pin", sa.String(length=20), nullable=True),
        sa.Column("merchant_name", sa.String(length=200), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("disputed_at", sa.DateTime(), nullable=True),
        sa.Column("dispute_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending','confirmed','disputed','unmatched')",
            name="ck_trade_proofs_status",
        ),
        sa.CheckConstraint("amount > 0", name="ck_trade_proofs_amount_positive"),
        sa.UniqueConstraint("receipt_id", name="uq_trade_proofs_receipt"),
    )
    op.create_index("ix_trade_proofs_buyer_vendor_id", "trade_proofs", ["buyer_vendor_id"])
    op.create_index("ix_trade_proofs_seller_vendor_id", "trade_proofs", ["seller_vendor_id"])
    op.create_index("ix_trade_proofs_seller_status", "trade_proofs",
                    ["seller_vendor_id", "status", "created_at"])
    op.create_index("ix_trade_proofs_buyer_status", "trade_proofs",
                    ["buyer_vendor_id", "status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_trade_proofs_buyer_status", table_name="trade_proofs")
    op.drop_index("ix_trade_proofs_seller_status", table_name="trade_proofs")
    op.drop_index("ix_trade_proofs_seller_vendor_id", table_name="trade_proofs")
    op.drop_index("ix_trade_proofs_buyer_vendor_id", table_name="trade_proofs")
    op.drop_table("trade_proofs")
    op.drop_column("vendors", "confirmed_trade_proofs")
    # PostgreSQL cannot remove a value from an enum. The three notification
    # types stay on the type, harmless and unused by this revision's code.

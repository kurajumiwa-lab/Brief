"""Merchant claims: a probationary state, challenge evidence and contest freeze.

Additive. A shop can now claim itself with a fresh challenge sale and operate
immediately in the capped `probationary` state. `verified` still requires a
high-trust check or 14 days of real redemptions. The columns hold only hashed
receipt evidence and server timestamps; no raw SMS and no client score.

Revision ID: 0060_merchant_claim_evidence
Revises: 0059_trade_proofs
Create Date: 2026-11-24
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0060_merchant_claim_evidence"
down_revision: str = "0059_trade_proofs"
branch_labels = None
depends_on = None

_OLD_STATUSES = "('unclaimed','pending','verified','rejected')"
_NEW_STATUSES = (
    "('unclaimed','pending','probationary','verified','contested','suspended','rejected')"
)


def upgrade() -> None:
    op.add_column(
        "receipt_merchants",
        sa.Column("claim_path", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "receipt_merchants",
        sa.Column("claim_confidence", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "receipt_merchants",
        sa.Column("claim_evidence", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "receipt_merchants",
        sa.Column("claim_receipt_key", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "receipt_merchants",
        sa.Column("probation_until", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "receipt_merchants",
        sa.Column("contest_deadline", sa.DateTime(), nullable=True),
    )
    op.create_unique_constraint(
        "uq_receipt_merchants_claim_receipt_key",
        "receipt_merchants",
        ["claim_receipt_key"],
    )
    op.drop_constraint(
        "ck_receipt_merchants_claim_status", "receipt_merchants", type_="check",
    )
    op.create_check_constraint(
        "ck_receipt_merchants_claim_status",
        "receipt_merchants",
        f"claim_status IN {_NEW_STATUSES}",
    )


def downgrade() -> None:
    # Any row in the new states becomes pending: the old constraint cannot hold
    # it, and a downgrade must not delete a shop. Evidence columns are dropped.
    op.execute(
        "UPDATE receipt_merchants SET claim_status = 'pending' "
        "WHERE claim_status IN ('probationary','contested','suspended')"
    )
    op.drop_constraint(
        "ck_receipt_merchants_claim_status", "receipt_merchants", type_="check",
    )
    op.create_check_constraint(
        "ck_receipt_merchants_claim_status",
        "receipt_merchants",
        f"claim_status IN {_OLD_STATUSES}",
    )
    op.drop_constraint(
        "uq_receipt_merchants_claim_receipt_key", "receipt_merchants", type_="unique",
    )
    op.drop_column("receipt_merchants", "contest_deadline")
    op.drop_column("receipt_merchants", "probation_until")
    op.drop_column("receipt_merchants", "claim_receipt_key")
    op.drop_column("receipt_merchants", "claim_evidence")
    op.drop_column("receipt_merchants", "claim_confidence")
    op.drop_column("receipt_merchants", "claim_path")

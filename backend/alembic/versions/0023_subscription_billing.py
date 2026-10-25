"""Subscription billing (Track 2).

Purely additive: creates `subscriptions` and `subscription_invoices`. No existing
table, column or constraint is touched, so it is safe to deploy before the
application code that uses it.

Two details that matter:

* `uq_subscriptions_one_live_per_vendor` is a **partial** unique index over
  trialing/active/past_due. A vendor may accumulate cancelled and expired rows
  (their billing history) but cannot run two live subscriptions.
* `uq_subscription_invoices_psp_reference` is the idempotency key. A replayed
  webhook hits this constraint instead of charging twice.

Revision ID: 0023_subscription_billing
Revises: 0022_local_activity_ledger
Create Date: 2026-10-25
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "0023_subscription_billing"
down_revision: str = "0022_local_activity_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "vendor_id", PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("plan_tier", sa.String(24), nullable=False),
        sa.Column("billing_period", sa.String(10), nullable=False, server_default="monthly"),
        sa.Column("price_kes", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="trialing"),
        sa.Column("provider", sa.String(20), nullable=False, server_default="mock"),
        sa.Column("psp_sub_account", sa.String(80), nullable=True),
        sa.Column("trial_ends_at", sa.DateTime(), nullable=True),
        sa.Column("current_period_start", sa.DateTime(), nullable=False),
        sa.Column("current_period_end", sa.DateTime(), nullable=False),
        sa.Column("grace_until", sa.DateTime(), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('trialing','active','past_due','cancelled','expired')",
            name="ck_subscriptions_status",
        ),
        sa.CheckConstraint(
            "billing_period IN ('monthly','annual')", name="ck_subscriptions_period"
        ),
        sa.CheckConstraint("price_kes >= 0", name="ck_subscriptions_price_nonnegative"),
        sa.CheckConstraint(
            "current_period_end >= current_period_start", name="ck_subscriptions_period_order"
        ),
    )
    op.create_index("ix_subscriptions_vendor_id", "subscriptions", ["vendor_id"])
    op.create_index("ix_subscriptions_status", "subscriptions", ["status"])
    op.create_index(
        "uq_subscriptions_one_live_per_vendor",
        "subscriptions",
        ["vendor_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('trialing','active','past_due')"),
    )

    op.create_table(
        "subscription_invoices",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "subscription_id", PGUUID(as_uuid=True),
            sa.ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "vendor_id", PGUUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=False
        ),
        sa.Column("amount_kes", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("provider", sa.String(20), nullable=False, server_default="mock"),
        sa.Column("psp_reference", sa.String(80), nullable=False),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("issued_at", sa.DateTime(), nullable=False),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.Column("failed_at", sa.DateTime(), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint(
            "status IN ('pending','paid','failed','refunded')",
            name="ck_subscription_invoices_status",
        ),
        sa.CheckConstraint("amount_kes > 0", name="ck_subscription_invoices_amount_positive"),
        sa.UniqueConstraint("psp_reference", name="uq_subscription_invoices_psp_reference"),
    )
    op.create_index("ix_subscription_invoices_subscription_id", "subscription_invoices", ["subscription_id"])
    op.create_index("ix_subscription_invoices_vendor_id", "subscription_invoices", ["vendor_id"])
    op.create_index("ix_subscription_invoices_status", "subscription_invoices", ["status"])


def downgrade() -> None:
    op.drop_table("subscription_invoices")
    op.drop_table("subscriptions")

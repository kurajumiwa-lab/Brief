"""Feature entitlements: one row per premium feature, editable without a deploy.

Additive. Creates ``feature_entitlements`` and seeds the eight features of the
Free / Growth / Business Pro plans. The downgrade drops only this table.

Revision ID: 0031_feature_entitlements
Revises: 0030_market_intake
Create Date: 2026-11-01
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0031_feature_entitlements"
down_revision: str = "0030_market_intake"
branch_labels = None
depends_on = None

SEED = (
    ("storefront", "Storefront", "Your shop front. Always free.", "free"),
    ("messaging", "Messaging", "Chat with buyers and sellers. Always free.", "free"),
    ("voice_notes", "Voice notes", "Short voice notes in chat. Always free.", "free"),
    ("search_activities", "Search activities", "Search and post local activities. Always free.", "free"),
    ("advanced_analytics", "Advanced analytics", "Price position against the network and counterparty history.", "growth"),
    ("inventory_automation", "Inventory automation", "Automatic stock updates from your point-of-sale system.", "growth"),
    ("broadcast_tools", "Broadcast tools", "Send one message to many contacts.", "business_pro"),
    ("staff_accounts", "Staff accounts", "Extra logins for your team.", "business_pro"),
    ("advanced_reporting", "Advanced reporting", "Exportable reports for your records and your accountant.", "business_pro"),
)


def upgrade() -> None:
    op.create_table(
        "feature_entitlements",
        sa.Column("feature_key", sa.String(48), primary_key=True),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("min_tier", sa.String(16), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_by", sa.String(100), nullable=True),
        sa.CheckConstraint(
            "min_tier IN ('free','growth','business_pro')",
            name="ck_feature_entitlements_min_tier",
        ),
    )
    op.bulk_insert(
        sa.table(
            "feature_entitlements",
            sa.column("feature_key", sa.String),
            sa.column("label", sa.String),
            sa.column("description", sa.Text),
            sa.column("min_tier", sa.String),
        ),
        [
            {"feature_key": k, "label": l, "description": d, "min_tier": t}
            for k, l, d, t in SEED
        ],
    )


def downgrade() -> None:
    op.drop_table("feature_entitlements")

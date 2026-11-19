"""Verified lead ledger and scout bounty rows.

Revision ID: 0076_lead_ledger
Revises: 0075_event_pass_resale
Create Date: 2026-11-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0076_lead_ledger"
down_revision = "0075_event_pass_resale"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "lead_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("buyer_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("scout_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("target_kind", sa.String(16), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_label", sa.String(200), nullable=False),
        sa.Column("action", sa.String(16), nullable=False, server_default="call"),
        sa.Column("fingerprint_hash", sa.String(64), nullable=False),
        sa.Column("scout_code", sa.String(16), nullable=True),
        sa.Column("fee_kes", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("bounty_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(12), nullable=False, server_default="verified"),
        sa.Column("details", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "action IN ('call','whatsapp','visit','book','claim','quote','join')",
            name="ck_lead_events_action",
        ),
        sa.CheckConstraint(
            "target_kind IN ('event','vendor','stock','activity')",
            name="ck_lead_events_target_kind",
        ),
        sa.CheckConstraint("status IN ('verified','reversed')", name="ck_lead_events_status"),
        sa.CheckConstraint("fee_kes >= 0 AND bounty_kes >= 0", name="ck_lead_events_kes"),
        sa.UniqueConstraint("target_kind", "target_id", "fingerprint_hash",
                            name="uq_lead_events_fingerprint"),
    )
    op.create_index("ix_lead_events_vendor_created", "lead_events", ["vendor_id", "created_at"])
    op.create_index("ix_lead_events_scout_created", "lead_events", ["scout_id", "created_at"])
    op.create_index("ix_lead_events_target", "lead_events", ["target_kind", "target_id"])


def downgrade():
    op.drop_table("lead_events")

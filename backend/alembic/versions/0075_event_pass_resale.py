"""Second-hand event passes: rotation and one resale row per registration.

Revision ID: 0075_event_pass_resale
Revises: 0074_office_saved_items
Create Date: 2026-11-17

The unique registration id is the double-listing lock. `pass_rotation` is bumped
in the same transaction that changes ownership, invalidating the seller's code.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0075_event_pass_resale"
down_revision = "0074_office_saved_items"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("event_registrations", sa.Column(
        "pass_rotation", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("vendors", sa.Column(
        "resale_trades", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "event_pass_resales",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("event_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("registration_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("event_registrations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("buyer_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("price_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="listed"),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("seller_confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("buyer_confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('listed','claimed','completed','cancelled')",
                           name="ck_event_pass_resales_status"),
        sa.CheckConstraint("price_kes >= 0", name="ck_event_pass_resales_price"),
        sa.UniqueConstraint("registration_id", name="uq_event_pass_resales_registration"),
    )
    op.create_index("ix_event_pass_resales_event_status", "event_pass_resales",
                    ["event_id", "status"])
    op.create_index("ix_event_pass_resales_seller", "event_pass_resales",
                    ["seller_id", "status"])
    op.create_index("ix_event_pass_resales_buyer", "event_pass_resales",
                    ["buyer_id", "status"])


def downgrade():
    op.drop_table("event_pass_resales")
    op.drop_column("vendors", "resale_trades")
    op.drop_column("event_registrations", "pass_rotation")

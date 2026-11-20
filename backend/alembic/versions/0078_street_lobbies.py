"""Time-boxed matchmaking tables and their members (0078).

Revision ID: 0078_street_lobbies
Revises: 0077_flash_drops
Create Date: 2026-11-20

A table is a TTL row: title, intent, zone, tags, seats, an expiry, a handoff
target and a verification code. Contact is not a public column; the API builds
a wa.me / t.me URL only for a person who joins. No money or message broker is
introduced.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0078_street_lobbies"
down_revision = "0077_flash_drops"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "street_lobbies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("host_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(140), nullable=False),
        sa.Column("intent", sa.String(24), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("zone", sa.String(80), nullable=False),
        sa.Column("tags", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("seats", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("joined_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(12), nullable=False, server_default="open"),
        sa.Column("handoff_channel", sa.String(16), nullable=False),
        sa.Column("handoff_target", sa.String(120), nullable=False),
        sa.Column("verification_code", sa.String(12), nullable=False, unique=True),
        sa.Column("opens_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("intent IN ('co_buy','source','delivery','gig','meetup')",
                           name="ck_street_lobbies_intent"),
        sa.CheckConstraint("handoff_channel IN ('whatsapp','telegram')",
                           name="ck_street_lobbies_channel"),
        sa.CheckConstraint("status IN ('open','closed','expired')",
                           name="ck_street_lobbies_status"),
        sa.CheckConstraint("seats BETWEEN 2 AND 50", name="ck_street_lobbies_seats"),
        sa.CheckConstraint("joined_count >= 1 AND joined_count <= seats",
                           name="ck_street_lobbies_joined"),
        sa.CheckConstraint("expires_at > opens_at", name="ck_street_lobbies_window"),
    )
    op.create_index("ix_street_lobbies_live", "street_lobbies",
                    ["status", "expires_at"])
    op.create_index("ix_street_lobbies_zone_intent", "street_lobbies",
                    ["zone", "intent", "created_at"])
    op.create_table(
        "street_lobby_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("lobby_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("street_lobbies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("lobby_id", "vendor_id", name="uq_street_lobby_member"),
    )
    op.create_index("ix_street_lobby_members_vendor", "street_lobby_members",
                    ["vendor_id", "joined_at"])


def downgrade():
    op.drop_index("ix_street_lobby_members_vendor", table_name="street_lobby_members")
    op.drop_table("street_lobby_members")
    op.drop_index("ix_street_lobbies_zone_intent", table_name="street_lobbies")
    op.drop_index("ix_street_lobbies_live", table_name="street_lobbies")
    op.drop_table("street_lobbies")

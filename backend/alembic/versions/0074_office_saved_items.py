"""Home Office saved items with three privacy zones.

Revision ID: 0074_office_saved_items
Revises: 0073_event_vendor_desk
Create Date: 2026-11-17

The default is `vault_private`, not public. Server-side checks keep a vault row
visible only to the person who saved it; family-shared and public rows are
readable by active office members. The public endpoint returns only
`public_showcase` rows and never the private note.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0074_office_saved_items"
down_revision = "0073_event_vendor_desk"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "office_saved_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("office_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("saved_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_kind", sa.String(20), nullable=False, server_default="external"),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_label", sa.String(160), nullable=False),
        sa.Column("target_url", sa.String(500), nullable=True),
        sa.Column("privacy", sa.String(20), nullable=False, server_default="vault_private"),
        sa.Column("private_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "privacy IN ('public_showcase','family_shared','vault_private')",
            name="ck_office_saved_items_privacy",
        ),
        sa.CheckConstraint(
            "target_kind IN ('vendor','listing','event','offer','service','external')",
            name="ck_office_saved_items_kind",
        ),
        sa.CheckConstraint("length(btrim(target_label)) > 0", name="ck_office_saved_items_label"),
        sa.CheckConstraint(
            "target_url IS NULL OR target_url LIKE '/%' OR target_url LIKE 'https://%'",
            name="ck_office_saved_items_url",
        ),
    )
    op.create_index("ix_office_saved_items_office_id", "office_saved_items", ["office_id"])
    op.create_index("ix_office_saved_items_office_privacy", "office_saved_items",
                    ["office_id", "privacy"])
    op.create_index("ix_office_saved_items_saved_by", "office_saved_items",
                    ["saved_by", "created_at"])
    op.create_index("ix_office_saved_items_target", "office_saved_items",
                    ["target_kind", "target_id"])


def downgrade():
    op.drop_table("office_saved_items")

"""Event hub: meeting point, host gallery and host–attendee messages (Phase 8).

Additive: three new tables that point at existing events. Nothing existing is altered.
Downgrade drops only these tables.

Revision ID: 0053_event_hub
Revises: 0052_office_notices
Create Date: 2026-11-14
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0053_event_hub"
down_revision: str = "0052_office_notices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_meeting_points",
        sa.Column("event_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("events.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("maps_url", sa.String(length=500), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("char_length(btrim(label)) > 0", name="ck_event_meeting_points_label"),
    )
    op.create_table(
        "event_gallery_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("image_url", sa.String(length=500), nullable=False),
        sa.Column("caption", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_event_gallery_items_event_created", "event_gallery_items", ["event_id", "created_at"])
    op.create_table(
        "event_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("char_length(btrim(body)) > 0", name="ck_event_messages_body"),
    )
    op.create_index("ix_event_messages_event_created", "event_messages", ["event_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_event_messages_event_created", table_name="event_messages")
    op.drop_table("event_messages")
    op.drop_index("ix_event_gallery_items_event_created", table_name="event_gallery_items")
    op.drop_table("event_gallery_items")
    op.drop_table("event_meeting_points")

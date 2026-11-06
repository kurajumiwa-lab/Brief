"""Business follows, 24-hour statuses and status views.

Additive only: three new tables and one new notification type. Nothing
existing is altered. Downgrade drops only these tables. The enum value cannot
be removed in PostgreSQL, so downgrade leaves it in place (harmless).

Revision ID: 0036_statuses
Revises: 0035_directory_routines
Create Date: 2026-11-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0036_statuses"
down_revision: str = "0035_directory_routines"
branch_labels = None
depends_on = None


def _vendor_fk(name: str):
    return sa.Column(name, postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="CASCADE"),
                     nullable=False)


def upgrade() -> None:
    # Adding an enum value must run outside any use of it in this migration.
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'BUSINESS_FOLLOW'")

    op.create_table(
        "business_follows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _vendor_fk("follower_id"),
        _vendor_fk("followed_id"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("follower_id", "followed_id", name="uq_business_follow_pair"),
        sa.CheckConstraint("follower_id <> followed_id", name="ck_business_follow_not_self"),
    )
    op.create_index("ix_business_follows_follower", "business_follows", ["follower_id"])
    op.create_index("ix_business_follows_followed", "business_follows", ["followed_id"])

    op.create_table(
        "business_statuses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _vendor_fk("vendor_id"),
        sa.Column("kind", sa.String(10), nullable=False, server_default="text"),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("media_url", sa.String(600), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("kind IN ('text', 'photo', 'video')", name="ck_business_status_kind"),
        sa.CheckConstraint("body IS NULL OR char_length(body) <= 500", name="ck_business_status_body"),
    )
    op.create_index("ix_business_statuses_vendor", "business_statuses", ["vendor_id"])
    op.create_index("ix_business_statuses_vendor_created", "business_statuses", ["vendor_id", "created_at"])
    op.create_index("ix_business_statuses_expires", "business_statuses", ["expires_at"])

    op.create_table(
        "status_views",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("status_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("business_statuses.id", ondelete="CASCADE"), nullable=False),
        _vendor_fk("viewer_id"),
        sa.Column("viewed_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("status_id", "viewer_id", name="uq_status_view_pair"),
    )
    op.create_index("ix_status_views_status", "status_views", ["status_id"])
    op.create_index("ix_status_views_viewer", "status_views", ["viewer_id"])


def downgrade() -> None:
    op.drop_index("ix_status_views_viewer", table_name="status_views")
    op.drop_index("ix_status_views_status", table_name="status_views")
    op.drop_table("status_views")
    op.drop_index("ix_business_statuses_expires", table_name="business_statuses")
    op.drop_index("ix_business_statuses_vendor_created", table_name="business_statuses")
    op.drop_index("ix_business_statuses_vendor", table_name="business_statuses")
    op.drop_table("business_statuses")
    op.drop_index("ix_business_follows_followed", table_name="business_follows")
    op.drop_index("ix_business_follows_follower", table_name="business_follows")
    op.drop_table("business_follows")

"""The social layer: accounts, posts, reactions, blocks, reports.

Purely additive. One new identity table and five new tables; no existing table,
column, constraint or index is touched. Safe to deploy before the application
code that uses it, and safe to roll back without stranding a vendor.

``social_accounts.vendor_id`` is nullable on purpose: participation must not
require a Brief vendor account. The foreign key is ``ON DELETE SET NULL`` so a
closed business leaves the conversation standing.

Revision ID: 0025_social_layer
Revises: 0024_media_objects
Create Date: 2026-10-27
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0025_social_layer"
down_revision: str = "0024_media_objects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "social_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("handle", sa.String(60), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("locale", sa.String(8), nullable=False, server_default="en"),
        sa.Column(
            "vendor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('active','suspended','closed')", name="ck_social_account_status"),
    )
    op.create_index("ix_social_accounts_handle", "social_accounts", ["handle"], unique=True)
    op.create_index("ix_social_accounts_vendor_id", "social_accounts", ["vendor_id"])
    op.create_index(
        "uq_social_account_vendor",
        "social_accounts",
        ["vendor_id"],
        unique=True,
        postgresql_where=sa.text("vendor_id IS NOT NULL"),
    )

    op.create_table(
        "social_circle_follows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "circle_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendor_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("account_id", "circle_id", name="uq_social_circle_follow"),
    )
    op.create_index("ix_social_circle_follows_account_id", "social_circle_follows", ["account_id"])
    op.create_index("ix_social_circle_follows_circle_id", "social_circle_follows", ["circle_id"])

    op.create_table(
        "social_posts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "circle_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendor_groups.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("lang", sa.String(8), nullable=False, server_default="en"),
        sa.Column("image_url", sa.String(600), nullable=True),
        sa.Column("data_kb", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(20), nullable=False, server_default="published"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('published','hidden','removed')", name="ck_social_post_status"),
        sa.CheckConstraint("length(btrim(body)) > 0", name="ck_social_post_body_not_blank"),
    )
    op.create_index("ix_social_posts_author_id", "social_posts", ["author_id"])
    op.create_index("ix_social_posts_circle_id", "social_posts", ["circle_id"])
    op.create_index("ix_social_posts_circle_created", "social_posts", ["circle_id", "created_at"])
    op.create_index("ix_social_posts_status_created", "social_posts", ["status", "created_at"])

    op.create_table(
        "social_reactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("value", sa.String(4), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("post_id", "account_id", name="uq_social_reaction_post_account"),
        sa.CheckConstraint("value IN ('up','down')", name="ck_social_reaction_value"),
    )
    op.create_index("ix_social_reactions_post_id", "social_reactions", ["post_id"])
    op.create_index("ix_social_reactions_account_id", "social_reactions", ["account_id"])
    op.create_index("ix_social_reactions_post_created", "social_reactions", ["post_id", "created_at"])

    op.create_table(
        "social_blocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("account_id", "target_id", "kind", name="uq_social_block"),
        sa.CheckConstraint("kind IN ('block','mute')", name="ck_social_block_kind"),
        sa.CheckConstraint("account_id <> target_id", name="ck_social_block_not_self"),
    )
    op.create_index("ix_social_blocks_account_id", "social_blocks", ["account_id"])
    op.create_index("ix_social_blocks_target_id", "social_blocks", ["target_id"])

    op.create_table(
        "social_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.String(30), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="received"),
        sa.Column("case_number", sa.String(20), nullable=False),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("post_id", "reporter_id", name="uq_social_report_post_reporter"),
        sa.CheckConstraint("status IN ('received','upheld','dismissed')", name="ck_social_report_status"),
        sa.CheckConstraint(
            "reason IN ('harassment','hate','spam','misinformation','privacy','violence','other')",
            name="ck_social_report_reason",
        ),
    )
    op.create_index("ix_social_reports_post_id", "social_reports", ["post_id"])
    op.create_index("ix_social_reports_reporter_id", "social_reports", ["reporter_id"])
    op.create_index("ix_social_reports_case_number", "social_reports", ["case_number"], unique=True)
    op.create_index("ix_social_reports_status_created", "social_reports", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("social_reports")
    op.drop_table("social_blocks")
    op.drop_table("social_reactions")
    op.drop_table("social_posts")
    op.drop_table("social_circle_follows")
    op.drop_table("social_accounts")

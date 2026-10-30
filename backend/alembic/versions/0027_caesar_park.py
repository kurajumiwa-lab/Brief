"""Caesar Park: bounded places with a gate, and the leash.

Four new tables. No existing table is altered, so this deploys safely before the
code that reads it and rolls back without stranding a vendor.

Two decisions are encoded in the schema rather than left to convention, because
they are the product:

  · **There is no latitude or longitude column.** A park is bounded by an area
    name and, at most, a radius in kilometres. A migration cannot add a tracking
    feature by accident if the column does not exist.
  · **The leash is stamped onto each post** (``caesar_park_posts.leash_at_post``)
    instead of being read live from the membership. Changing your leash changes
    what you say next; it never retrospectively reveals or conceals what you have
    already said.

``caesar_park_posts`` is its own table rather than a ``park_id`` column on
``social_posts`` — for the same reason 0025 is additive: the public conversation
is not a table this feature gets to alter.

Revision ID: 0027_caesar_park
Revises: 0026_caesar_guide
Create Date: 2026-10-30
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0027_caesar_park"
down_revision: str = "0026_caesar_guide"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "caesar_parks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default="place"),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("area", sa.String(120), nullable=True),
        sa.Column("radius_km", sa.Float(), nullable=True),
        sa.Column("niche", sa.String(80), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("rules", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("entry_rule", sa.String(10), nullable=False, server_default="open"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('place','niche')", name="ck_park_kind"),
        sa.CheckConstraint("entry_rule IN ('open','ask')", name="ck_park_entry_rule"),
        sa.CheckConstraint("length(btrim(name)) > 0", name="ck_park_name_not_blank"),
        sa.UniqueConstraint("slug", name="uq_park_slug"),
    )
    op.create_index("ix_parks_city_kind", "caesar_parks", ["city", "kind"])

    op.create_table(
        "caesar_park_circles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "park_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("caesar_parks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "circle_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendor_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("off_leash", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("park_id", "circle_id", name="uq_park_circle"),
    )
    op.create_index("ix_park_circles_park", "caesar_park_circles", ["park_id"])

    op.create_table(
        "caesar_park_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "park_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("caesar_parks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(12), nullable=False, server_default="member"),
        sa.Column("leash", sa.String(6), nullable=False, server_default="off"),
        sa.Column("joined_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("note", sa.String(280), nullable=True),
        sa.UniqueConstraint("park_id", "account_id", name="uq_park_membership"),
        sa.CheckConstraint(
            "status IN ('member','requested','left','removed')", name="ck_park_membership_status"
        ),
        sa.CheckConstraint("leash IN ('on','off')", name="ck_park_membership_leash"),
    )
    op.create_index("ix_park_memberships_account", "caesar_park_memberships", ["account_id"])

    op.create_table(
        "caesar_park_posts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "park_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("caesar_parks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "circle_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("caesar_park_circles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("lang", sa.String(8), nullable=False, server_default="en"),
        sa.Column("leash_at_post", sa.String(6), nullable=False, server_default="off"),
        sa.Column("status", sa.String(20), nullable=False, server_default="published"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("length(btrim(body)) > 0", name="ck_park_post_body_not_blank"),
        sa.CheckConstraint("status IN ('published','hidden','removed')", name="ck_park_post_status"),
    )
    op.create_index("ix_park_posts_park_created", "caesar_park_posts", ["park_id", "created_at"])
    op.create_index("ix_caesar_park_posts_author_id", "caesar_park_posts", ["author_id"])


def downgrade() -> None:
    op.drop_table("caesar_park_posts")
    op.drop_table("caesar_park_memberships")
    op.drop_table("caesar_park_circles")
    op.drop_table("caesar_parks")

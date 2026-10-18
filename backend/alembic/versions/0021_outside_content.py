"""Outside — social content, reactions, discovery prefs, reports.

Four new tables, all additive. No existing column is altered, renamed or
dropped, so `alembic upgrade head` on a live database is a pure addition and
`downgrade -1` removes exactly what this revision created.

Historical trade-value data is deliberately untouched: the columns that store
it keep their values and keep being returned by the analytics endpoints. What
changed is where those numbers are *shown*, which is a frontend concern and
needs no migration.

Revision ID: 0021_outside_content
Revises: 0020_reorder_key
Create Date: 2026-10-17
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

from alembic import op

revision: str = "0021_outside_content"
down_revision: str = "0020_reorder_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── social content ─────────────────────────────────────────────────────
    op.create_table(
        "outside_posts",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("author_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type", sa.String(24), nullable=False, server_default="post"),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("media", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("location", sa.String(300), nullable=True),
        sa.Column("geo_lat", sa.Float(), nullable=True),
        sa.Column("geo_lng", sa.Float(), nullable=True),
        sa.Column("geo_precision", sa.String(16), nullable=False, server_default="approximate"),
        sa.Column("location_layer", sa.String(20), nullable=False, server_default="town"),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("visibility", sa.String(16), nullable=False, server_default="public"),
        sa.Column("audience", sa.String(16), nullable=False, server_default="everyone"),
        sa.Column("response_kind", sa.String(20), nullable=False, server_default="reply"),
        # Optional by construction: NULL is the normal case, not an omission.
        sa.Column("price_kes", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(8), nullable=False, server_default="KES"),
        sa.Column("is_commercial", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", sa.String(20), nullable=False, server_default="published"),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("save_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("interest_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("report_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("moderation_status", sa.String(20), nullable=False, server_default="approved"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("char_length(body) >= 8", name="ck_outside_post_body_real"),
        sa.CheckConstraint(
            "content_type IN ('post','question','recommendation','opportunity','notice')",
            name="ck_outside_post_type"),
        sa.CheckConstraint(
            "visibility IN ('public','community','private')",
            name="ck_outside_post_visibility"),
        sa.CheckConstraint(
            "geo_precision IN ('exact','approximate','none')",
            name="ck_outside_post_geo_precision"),
    )
    op.create_index("ix_outside_posts_author_vendor_id", "outside_posts", ["author_vendor_id"])
    op.create_index("ix_outside_posts_content_type", "outside_posts", ["content_type"])
    op.create_index("ix_outside_posts_category", "outside_posts", ["category"])
    op.create_index("ix_outside_posts_visibility", "outside_posts", ["visibility"])
    op.create_index("ix_outside_posts_status", "outside_posts", ["status"])
    op.create_index("ix_outside_posts_created_at", "outside_posts", ["created_at"])
    op.create_index("ix_outside_posts_status_created", "outside_posts", ["status", "created_at"])
    op.create_index("ix_outside_posts_geo", "outside_posts", ["geo_lat", "geo_lng"])
    op.create_index("ix_outside_posts_vendor_created", "outside_posts",
                    ["author_vendor_id", "created_at"])

    # ── interactions, polymorphic across every content type ────────────────
    op.create_table(
        "outside_reactions",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_kind", sa.String(24), nullable=False),
        sa.Column("content_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("reaction", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("vendor_id", "content_kind", "content_id", "reaction",
                            name="uq_outside_reaction"),
        sa.CheckConstraint(
            "reaction IN ('like','save','interest','attending')",
            name="ck_outside_reaction_kind"),
    )
    op.create_index("ix_outside_reactions_vendor", "outside_reactions",
                    ["vendor_id", "reaction", "created_at"])
    op.create_index("ix_outside_reactions_content", "outside_reactions",
                    ["content_kind", "content_id", "reaction"])

    # ── where this person is looking ───────────────────────────────────────
    op.create_table(
        "outside_discovery_prefs",
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("geo_lat", sa.Float(), nullable=True),
        sa.Column("geo_lng", sa.Float(), nullable=True),
        sa.Column("source", sa.String(24), nullable=False, server_default="unset"),
        sa.Column("radius_km", sa.Float(), nullable=False, server_default="15"),
        sa.Column("layer", sa.String(20), nullable=False, server_default="town"),
        sa.Column("interests", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("share_location", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "source IN ('gps','manual','vendor_profile','market_zone','unset')",
            name="ck_outside_pref_source"),
        sa.CheckConstraint("radius_km >= 0.5 AND radius_km <= 200", name="ck_outside_pref_radius"),
        sa.CheckConstraint(
            "layer IN ('neighbourhood','town','region','country','global')",
            name="ck_outside_pref_layer"),
    )

    # ── safety ─────────────────────────────────────────────────────────────
    op.create_table(
        "outside_content_reports",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("reporter_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_kind", sa.String(24), nullable=False),
        sa.Column("content_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.String(40), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("is_block", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("target_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("resolved_by_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('open','actioned','dismissed')",
                           name="ck_outside_report_status"),
    )
    op.create_index("ix_outside_content_reports_reporter_vendor_id",
                    "outside_content_reports", ["reporter_vendor_id"])
    op.create_index("ix_outside_reports_status_created", "outside_content_reports",
                    ["status", "created_at"])
    op.create_index("ix_outside_reports_content", "outside_content_reports",
                    ["content_kind", "content_id"])


def downgrade() -> None:
    op.drop_table("outside_content_reports")
    op.drop_table("outside_discovery_prefs")
    op.drop_table("outside_reactions")
    op.drop_table("outside_posts")

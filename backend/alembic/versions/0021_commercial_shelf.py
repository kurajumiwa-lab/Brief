"""Commercial shelf — social commerce layer with offers, savings, group-buying.

Revision ID: 0021_commercial_shelf
Revises: 0020_reorder_key
Create Date: 2026-10-16

This harnesses existing services without replacing them:
- Commercial posts can link to stock_items, collective_sourcing, vendor_groups
- Salesperson distribution moat via shares and referrals
- Group-demand aggregation
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0021_commercial_shelf"
down_revision = "0020_reorder_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enums — create_type=False + checkfirst prevents duplicate when models already created them via init_db
    commercial_post_type = postgresql.ENUM(
        "regular", "commercial", "group_buy", "deal", "savings",
        name="commercialposttype",
        create_type=False,
    )
    commercial_post_type.create(op.get_bind(), checkfirst=True)

    commercial_post_status = postgresql.ENUM(
        "active", "expired", "fulfilled", "cancelled", "draft",
        name="commercialpoststatus",
        create_type=False,
    )
    commercial_post_status.create(op.get_bind(), checkfirst=True)

    interest_status = postgresql.ENUM(
        "interested", "joined", "confirmed", "cancelled",
        name="intereststatus",
        create_type=False,
    )
    interest_status.create(op.get_bind(), checkfirst=True)

    # commercial_posts — use the enum variables, not sa.Enum strings, so SQLAlchemy doesn't try to CREATE TYPE again
    op.create_table(
        "commercial_posts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("post_type", commercial_post_type, nullable=False, server_default="regular"),
        sa.Column("is_commercial", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", commercial_post_status, nullable=False, server_default="active"),
        sa.Column("individual_price", sa.Float(), nullable=True),
        sa.Column("group_price", sa.Float(), nullable=True),
        sa.Column("savings_amount", sa.Float(), nullable=True),
        sa.Column("savings_percentage", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(10), nullable=False, server_default="KES"),
        sa.Column("target_quantity", sa.Integer(), nullable=True),
        sa.Column("min_group_size", sa.Integer(), nullable=True),
        sa.Column("current_interested", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_quantity_pledged", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stock_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("stock_items.id"), nullable=True),
        sa.Column("collective_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("collective_sourcing.id"), nullable=True),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendor_groups.id"), nullable=True),
        sa.Column("images", postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default="[]"),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default="[]"),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("location", sa.String(300), nullable=True),
        sa.Column("commission_rate", sa.Float(), nullable=True),
        sa.Column("commission_fixed", sa.Float(), nullable=True),
        sa.Column("allow_resale", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("save_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("share_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("interest_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("visible_to_groups", postgresql.JSONB(astext_type=sa.Text()), nullable=True, server_default="[]"),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_commercial_posts_vendor", "commercial_posts", ["vendor_id"])
    op.create_index("ix_commercial_posts_type", "commercial_posts", ["post_type"])
    op.create_index("ix_commercial_posts_status", "commercial_posts", ["status"])
    op.create_index("ix_commercial_posts_created", "commercial_posts", ["created_at"])
    op.create_index("ix_commercial_posts_commercial", "commercial_posts", ["is_commercial"])
    op.create_index("ix_commercial_posts_location", "commercial_posts", ["location"])

    # commercial_interests
    op.create_table(
        "commercial_interests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("commercial_posts.id"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", interest_status, nullable=False, server_default="interested"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("referred_by_vendor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_commercial_interests_post", "commercial_interests", ["post_id"])
    op.create_index("ix_commercial_interests_vendor", "commercial_interests", ["vendor_id"])
    op.create_unique_constraint("uq_commercial_interest", "commercial_interests", ["post_id", "vendor_id"])

    # commercial_saves
    op.create_table(
        "commercial_saves",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("commercial_posts.id"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_commercial_saves_post", "commercial_saves", ["post_id"])
    op.create_index("ix_commercial_saves_vendor", "commercial_saves", ["vendor_id"])
    op.create_unique_constraint("uq_commercial_save", "commercial_saves", ["post_id", "vendor_id"])

    # commercial_shares
    op.create_table(
        "commercial_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("commercial_posts.id"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("share_channel", sa.String(50), nullable=False, server_default="copy_link"),
        sa.Column("share_target", sa.String(300), nullable=True),
        sa.Column("referred_vendor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id"), nullable=True),
        sa.Column("commission_earned", sa.Float(), nullable=False, server_default="0"),
        sa.Column("commission_status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("click_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("conversion_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_commercial_shares_post", "commercial_shares", ["post_id"])
    op.create_index("ix_commercial_shares_vendor", "commercial_shares", ["vendor_id"])
    op.create_index("ix_commercial_shares_created", "commercial_shares", ["created_at"])


def downgrade() -> None:
    op.drop_table("commercial_shares")
    op.drop_table("commercial_saves")
    op.drop_table("commercial_interests")
    op.drop_table("commercial_posts")

    op.execute("DROP TYPE IF EXISTS intereststatus")
    op.execute("DROP TYPE IF EXISTS commercialpoststatus")
    op.execute("DROP TYPE IF EXISTS commercialposttype")

"""Knowledge directory, daily routine and free blueprints.

Additive only: seven new tables. Nothing existing is altered. Downgrade drops
only these tables.

Revision ID: 0035_directory_routine_blueprints
Revises: 0034_offers
Create Date: 2026-11-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0035_directory_routines"
down_revision: str = "0034_offers"
branch_labels = None
depends_on = None


def _vendor_fk(name: str = "vendor_id"):
    return sa.Column(name, postgresql.UUID(as_uuid=True), sa.ForeignKey("vendors.id", ondelete="CASCADE"),
                     nullable=False, index=True)


def upgrade() -> None:
    op.create_table(
        "knowledge_listings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _vendor_fk("organiser_vendor_id"),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("sector", sa.String(40), nullable=False),
        sa.Column("summary", sa.Text()),
        sa.Column("price_kes", sa.Integer()),
        sa.Column("starts_at", sa.DateTime()),
        sa.Column("location", sa.String(300)),
        sa.Column("capacity", sa.Integer()),
        sa.Column("promised_outcomes", sa.Text(), nullable=False),
        sa.Column("delivered_outcomes", sa.Text()),
        sa.Column("delivered_at", sa.DateTime()),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('seminar', 'course', 'mentor_session')", name="ck_knowledge_listings_kind"),
        sa.CheckConstraint("status IN ('draft', 'published', 'completed', 'cancelled')",
                           name="ck_knowledge_listings_status"),
        sa.CheckConstraint("price_kes IS NULL OR price_kes >= 0", name="ck_knowledge_listings_price"),
        sa.CheckConstraint("capacity IS NULL OR capacity >= 1", name="ck_knowledge_listings_capacity"),
    )
    op.create_index("ix_knowledge_listings_browse", "knowledge_listings", ["status", "sector", "starts_at"])

    op.create_table(
        "knowledge_registrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("knowledge_listings.id", ondelete="CASCADE"), nullable=False, index=True),
        _vendor_fk(),
        sa.Column("registered_at", sa.DateTime(), nullable=False),
        sa.Column("checked_in_at", sa.DateTime()),
        sa.UniqueConstraint("listing_id", "vendor_id", name="uq_knowledge_registration"),
    )

    op.create_table(
        "knowledge_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("knowledge_listings.id", ondelete="CASCADE"), nullable=False, index=True),
        _vendor_fk(),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("listing_id", "vendor_id", name="uq_knowledge_review"),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_knowledge_reviews_rating"),
    )

    op.create_table(
        "routine_preferences",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _vendor_fk(),
        sa.Column("check_key", sa.String(64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("vendor_id", "check_key", name="uq_routine_preference"),
    )

    op.create_table(
        "routine_completions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _vendor_fk(),
        sa.Column("check_key", sa.String(64), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("done_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("vendor_id", "check_key", "day", name="uq_routine_completion"),
    )

    op.create_table(
        "blueprint_starts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _vendor_fk(),
        sa.Column("blueprint_key", sa.String(64), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("vendor_id", "blueprint_key", name="uq_blueprint_start"),
    )

    op.create_table(
        "blueprint_step_done",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _vendor_fk(),
        sa.Column("blueprint_key", sa.String(64), nullable=False),
        sa.Column("step_key", sa.String(64), nullable=False),
        sa.Column("done_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("vendor_id", "blueprint_key", "step_key", name="uq_blueprint_step_done"),
    )


def downgrade() -> None:
    op.drop_table("blueprint_step_done")
    op.drop_table("blueprint_starts")
    op.drop_table("routine_completions")
    op.drop_table("routine_preferences")
    op.drop_table("knowledge_reviews")
    op.drop_table("knowledge_registrations")
    op.drop_index("ix_knowledge_listings_browse", table_name="knowledge_listings")
    op.drop_table("knowledge_listings")

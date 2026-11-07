"""MarketTrust: customer reviews through till codes.

Additive, with one controlled change: business_reviews.reviewer_vendor_id becomes
nullable so a review can come from a customer identity instead. A check constraint
keeps exactly one reviewer per review.

Adds: review_identities (device identities, no login), transaction_tokens.receipt_ref,
service and product ratings, review_flags and review_moderations (both append-only).

Revision ID: 0038_customer_reviews
Revises: 0037_market_trust
Create Date: 2026-11-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.db_triggers import trust_guard_statements

revision: str = "0038_customer_reviews"
down_revision: str = "0037_market_trust"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "review_identities",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("display_name", sa.String(40)),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("status IN ('active', 'blocked')", name="ck_review_identity_status"),
    )

    op.add_column("transaction_tokens", sa.Column("receipt_ref", sa.String(40)))

    op.drop_index("uq_business_review_current", table_name="business_reviews")
    op.alter_column("business_reviews", "reviewer_vendor_id", existing_type=UUID, nullable=True)
    op.add_column("business_reviews", sa.Column(
        "review_identity_id", UUID,
        sa.ForeignKey("review_identities.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_business_reviews_review_identity_id", "business_reviews", ["review_identity_id"])
    op.add_column("business_reviews", sa.Column("service_rating", sa.SmallInteger))
    op.add_column("business_reviews", sa.Column("product_rating", sa.SmallInteger))
    op.create_check_constraint("ck_business_review_service", "business_reviews",
                               "service_rating IS NULL OR service_rating BETWEEN 1 AND 5")
    op.create_check_constraint("ck_business_review_product", "business_reviews",
                               "product_rating IS NULL OR product_rating BETWEEN 1 AND 5")
    op.create_check_constraint("ck_business_review_one_reviewer", "business_reviews",
                               "(reviewer_vendor_id IS NULL) <> (review_identity_id IS NULL)")
    op.create_index("uq_business_review_current_vendor", "business_reviews", ["branch_id", "reviewer_vendor_id"],
                    unique=True, postgresql_where=text("is_current AND reviewer_vendor_id IS NOT NULL"))
    op.create_index("uq_business_review_current_customer", "business_reviews", ["branch_id", "review_identity_id"],
                    unique=True, postgresql_where=text("is_current AND review_identity_id IS NOT NULL"))

    op.create_table(
        "review_flags",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("review_id", UUID, sa.ForeignKey("business_reviews.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason_key", sa.String(40), nullable=False),
        sa.Column("detail", sa.Text),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_review_flags_review", "review_flags", ["review_id"])

    op.create_table(
        "review_moderations",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("review_id", UUID, sa.ForeignKey("business_reviews.id", ondelete="CASCADE"), nullable=False),
        sa.Column("staff_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("action", sa.String(12), nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("action IN ('publish', 'remove')", name="ck_review_moderation_action"),
        sa.CheckConstraint("length(reason) >= 10", name="ck_review_moderation_reason"),
    )
    op.create_index("ix_review_moderations_review", "review_moderations", ["review_id"])

    # Guards for the two new append-only tables (0037 already guarded the earlier three).
    for stmt in trust_guard_statements(("review_flags", "review_moderations")):
        op.execute(stmt)


def downgrade() -> None:
    # Customer-reviewed rows cannot exist once the reviewer column is NOT NULL again.
    op.execute("DELETE FROM review_moderations WHERE review_id IN "
               "(SELECT id FROM business_reviews WHERE reviewer_vendor_id IS NULL)")
    op.execute("DELETE FROM review_flags WHERE review_id IN "
               "(SELECT id FROM business_reviews WHERE reviewer_vendor_id IS NULL)")
    op.execute("DELETE FROM business_reviews WHERE reviewer_vendor_id IS NULL")

    for table in ("review_moderations", "review_flags"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_append_only ON {table}")
    op.drop_table("review_moderations")
    op.drop_table("review_flags")

    op.drop_index("uq_business_review_current_customer", table_name="business_reviews")
    op.drop_index("uq_business_review_current_vendor", table_name="business_reviews")
    op.drop_constraint("ck_business_review_one_reviewer", "business_reviews", type_="check")
    op.drop_constraint("ck_business_review_product", "business_reviews", type_="check")
    op.drop_constraint("ck_business_review_service", "business_reviews", type_="check")
    op.drop_column("business_reviews", "product_rating")
    op.drop_column("business_reviews", "service_rating")
    op.drop_index("ix_business_reviews_review_identity_id", table_name="business_reviews")
    op.drop_column("business_reviews", "review_identity_id")
    op.alter_column("business_reviews", "reviewer_vendor_id", existing_type=UUID, nullable=False)
    op.create_index("uq_business_review_current", "business_reviews", ["branch_id", "reviewer_vendor_id"],
                    unique=True, postgresql_where=text("is_current"))

    op.drop_column("transaction_tokens", "receipt_ref")
    op.drop_table("review_identities")

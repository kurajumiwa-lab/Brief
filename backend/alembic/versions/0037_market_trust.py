"""MarketTrust core: branches, verification, transaction tokens, branch reviews,
audit events and the points ledger (points are not money).

Additive only. Creates six tables and installs append-only guards on three of
them. Nothing existing is altered. Downgrade drops only these tables and the
guard function.

Revision ID: 0037_market_trust
Revises: 0036_statuses
Create Date: 2026-11-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.db_triggers import trust_guard_statements

revision: str = "0037_market_trust"
down_revision: str = "0036_statuses"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def _in(column, values):
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


COUNTRIES = ("KE", "ET", "UG")


def upgrade() -> None:
    op.create_table(
        "business_branches",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False, server_default="KE"),
        sa.Column("branch_name", sa.String(120), nullable=False),
        sa.Column("address_text", sa.String(300), nullable=False),
        sa.Column("latitude", sa.Numeric(9, 6)),
        sa.Column("longitude", sa.Numeric(9, 6)),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("verification_level", sa.SmallInteger, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("vendor_id", "branch_name", name="uq_business_branch_name"),
        sa.CheckConstraint(_in("country_code", COUNTRIES), name="ck_business_branch_country"),
        sa.CheckConstraint(_in("status", ("pending", "active", "removed")), name="ck_business_branch_status"),
        sa.CheckConstraint("verification_level BETWEEN 0 AND 4", name="ck_business_branch_level"),
        sa.CheckConstraint("latitude IS NULL OR (latitude BETWEEN -90 AND 90)", name="ck_business_branch_lat"),
        sa.CheckConstraint("longitude IS NULL OR (longitude BETWEEN -180 AND 180)", name="ck_business_branch_lng"),
    )
    op.create_index("ix_business_branches_vendor_id", "business_branches", ["vendor_id"])
    op.create_index("ix_business_branches_location", "business_branches", ["latitude", "longitude"])

    op.create_table(
        "branch_verifications",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("branch_id", UUID, sa.ForeignKey("business_branches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("method", sa.String(30), nullable=False),
        sa.Column("result", sa.String(12), nullable=False),
        sa.Column("verifier_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("note", sa.Text),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.CheckConstraint(_in("result", ("approved", "rejected")), name="ck_branch_verif_result"),
        sa.CheckConstraint("result = 'approved' OR length(note) >= 10", name="ck_branch_verif_reason"),
    )
    op.create_index("ix_branch_verifications_branch_id", "branch_verifications", ["branch_id"])

    op.create_table(
        "transaction_tokens",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("branch_id", UUID, sa.ForeignKey("business_branches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("issued_by_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.Column("consumed_at", sa.DateTime),
        sa.Column("consumed_by_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_transaction_tokens_branch", "transaction_tokens", ["branch_id"])

    op.create_table(
        "business_reviews",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("branch_id", UUID, sa.ForeignKey("business_branches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reviewer_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_id", UUID, sa.ForeignKey("transaction_tokens.id", ondelete="SET NULL")),
        sa.Column("stage", sa.String(10), nullable=False, server_default="quick"),
        sa.Column("rating", sa.SmallInteger, nullable=False),
        sa.Column("comment", sa.Text),
        sa.Column("evidence_tier", sa.String(24), nullable=False),
        sa.Column("evidence_weight", sa.Numeric(3, 2), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="published"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("is_current", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("supersedes_id", UUID, sa.ForeignKey("business_reviews.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_business_review_rating"),
        sa.CheckConstraint(_in("status", ("published", "hidden_pending_review", "removed")),
                           name="ck_business_review_status"),
        sa.CheckConstraint(_in("evidence_tier", ("confirmed_token", "unverified")), name="ck_business_review_tier"),
        sa.CheckConstraint("evidence_weight >= 0 AND evidence_weight <= 1", name="ck_business_review_weight"),
    )
    op.create_index("ix_business_reviews_branch_id", "business_reviews", ["branch_id"])
    op.create_index("ix_business_reviews_reviewer_vendor_id", "business_reviews", ["reviewer_vendor_id"])
    op.create_index("uq_business_review_current", "business_reviews", ["branch_id", "reviewer_vendor_id"],
                    unique=True, postgresql_where=text("is_current"))

    op.create_table(
        "audit_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("actor_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("action", sa.String(60), nullable=False),
        sa.Column("entity_type", sa.String(40), nullable=False),
        sa.Column("entity_id", UUID, nullable=False),
        sa.Column("country_code", sa.String(2)),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default=text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_audit_events_entity", "audit_events", ["entity_type", "entity_id"])

    op.create_table(
        "points_ledger",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=False),
        sa.Column("entry_type", sa.String(10), nullable=False),
        sa.Column("points", sa.Integer, nullable=False),
        sa.Column("reason_key", sa.String(60), nullable=False),
        sa.Column("reference_type", sa.String(30), nullable=False),
        sa.Column("reference_id", UUID, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("reference_type", "reference_id", "entry_type", name="uq_points_ledger_reference"),
        sa.CheckConstraint("(entry_type = 'earn' AND points > 0) OR (entry_type = 'redeem' AND points < 0)",
                           name="ck_points_ledger_sign"),
        sa.CheckConstraint(_in("entry_type", ("earn", "redeem")), name="ck_points_ledger_type"),
        sa.CheckConstraint(_in("country_code", COUNTRIES), name="ck_points_ledger_country"),
    )
    op.create_index("ix_points_ledger_vendor", "points_ledger", ["vendor_id"])

    # The same guard statements the dev path installs (app.db_triggers).
    for stmt in trust_guard_statements():
        op.execute(stmt)


def downgrade() -> None:
    for table in ("points_ledger", "audit_events"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_append_only ON {table}")
    op.execute("DROP TRIGGER IF EXISTS trg_branch_verifications_append_only ON branch_verifications")
    op.drop_table("points_ledger")
    op.drop_table("audit_events")
    op.drop_index("uq_business_review_current", table_name="business_reviews")
    op.drop_table("business_reviews")
    op.drop_table("transaction_tokens")
    op.drop_table("branch_verifications")
    op.drop_table("business_branches")
    op.execute("DROP FUNCTION IF EXISTS brief_trust_append_only()")

"""Business standing: verified claims, the passport, and opportunity watches (v2.11).

Four tables and one column, all additive — the previous revision's data and
screens are untouched:

    business_claims    one row per fact per business (BRS registration, TCC,
                       county permit …) with evidence, dates and the named
                       human who checked it.
    claim_events       append-only history: created, evidence_attached,
                       verification_requested, verified, rejected, expired.
    standing_profiles  the owner's headline and the checklists they publish.
    request_watches    a standing question about opportunities ("packaging
                       jobs around Kisumu, 20K and up").
    business_requests.requirements   what the buyer asks a supplier to
                       evidence, as claim keys or the buyer's own words.

Notification types are added for the two loops the release introduces: a
verifier checked or refused a document, a document is about to lapse, the
verifier desk has work, and a posted request matches a watch or a business's
verified documents.

Revision ID: 0015_business_standing
Revises: 0014_live_order_journey
Create Date: 2026-10-11
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "0015_business_standing"
down_revision: str = "0014_live_order_journey"
branch_labels = None
depends_on = None

CLAIM_STATUS = ("declared", "documented", "verified", "rejected", "expired", "withdrawn")
CLAIM_METHOD = ("self_declared", "document_upload", "document_reference",
                "registry_check", "counterparty_confirmed")

NEW_NOTIFICATION_TYPES = (
    "CLAIM_VERIFIED",
    "CLAIM_REJECTED",
    "CLAIM_EXPIRING",
    "CLAIM_VERIFICATION_REQUESTED",
    "OPPORTUNITY_MATCH",
)

# The four types 0012 creates. That revision shipped with snake_case names
# (`request_type`, …) while the ORM declares them by lower-cased class name
# (`requesttype`, …), so a database migrated before the fix does not have the
# type `request_watches` is about to reference and this upgrade died with
# `type "requesttype" does not exist`. Renaming is the repair: Postgres carries
# every column that uses the type along with it, so no data moves and the
# tables 0012 built keep working — they just end up with the name the ORM uses.
_ENUM_RENAMES = (
    ("request_type", "requesttype"),
    ("request_urgency", "requesturgency"),
    ("request_status", "requeststatus"),
    ("offer_status", "offerstatus"),
)


def _enum(values, name):
    """Create the type if this database has never seen it.

    Auto-create dev databases already hold every enum the models declare, so a
    blind CREATE TYPE would fail there; `checkfirst=True` keeps both paths
    (alembic and AUTO_CREATE_TABLES) honest.
    """
    enum = PG_ENUM(*values, name=name)
    enum.create(op.get_bind(), checkfirst=True)
    return postgresql.ENUM(*values, name=name, create_type=False)


def _repair_request_enum_names() -> None:
    """Rename the 0012 enums still carrying their original snake_case names.

    A no-op on a database created after 0012 was corrected, and on any database
    where the target name already exists — so it is safe to run twice and safe
    on a fresh install.
    """
    bind = op.get_bind()
    present = {row[0] for row in bind.execute(sa.text(
        "SELECT t.typname FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid"))}
    for old, new in _ENUM_RENAMES:
        if old in present and new not in present:
            op.execute(f'ALTER TYPE "{old}" RENAME TO "{new}"')


def upgrade() -> None:
    for value in NEW_NOTIFICATION_TYPES:
        op.execute(f"ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS '{value}'")

    # Before anything references them: a database already carrying 0012 has the
    # wrong names, and `request_watches` below cannot be created without this.
    _repair_request_enum_names()

    claim_status = _enum(CLAIM_STATUS, "claimstatus")
    claim_method = _enum(CLAIM_METHOD, "claimmethod")

    op.create_table(
        "business_claims",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("claim_key", sa.String(60), nullable=False),
        sa.Column("status", claim_status, nullable=False, server_default="declared"),
        sa.Column("method", claim_method, nullable=False, server_default="self_declared"),
        sa.Column("reference", sa.String(120), nullable=True),
        sa.Column("issued_on", sa.Date(), nullable=True),
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("evidence_url", sa.String(500), nullable=True),
        sa.Column("evidence_name", sa.String(255), nullable=True),
        sa.Column("share_reference", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("verified_by_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("verification_note", sa.Text(), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("verification_requested_at", sa.DateTime(), nullable=True),
        sa.Column("reminded_windows", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("vendor_id", "claim_key", name="uq_claim_vendor_key"),
    )
    op.create_index("ix_business_claims_vendor_id", "business_claims", ["vendor_id"])
    op.create_index("ix_business_claims_claim_key", "business_claims", ["claim_key"])
    op.create_index("ix_business_claims_status", "business_claims", ["status"])
    op.create_index("ix_business_claims_expires_on", "business_claims", ["expires_on"])
    op.create_index("ix_business_claims_verification_requested_at", "business_claims",
                    ["verification_requested_at"])

    op.create_table(
        "claim_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("claim_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("business_claims.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("actor_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_type", sa.String(20), nullable=False, server_default="owner"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_claim_events_claim_id", "claim_events", ["claim_id"])
    op.create_index("ix_claim_events_created_at", "claim_events", ["created_at"])

    op.create_table(
        "standing_profiles",
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("headline", sa.String(200), nullable=True),
        sa.Column("published_checklists", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    # Same values as 0012. `checkfirst` covers a database where 0012 somehow
    # left the type behind; the rename above covers the usual case.
    request_type = _enum(("stock", "worker", "delivery", "rental", "errand", "service"), "requesttype")

    op.create_table(
        "request_watches",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("request_type", request_type, nullable=True),
        sa.Column("keywords", sa.String(200), nullable=True),
        sa.Column("zone_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("market_zones.id", ondelete="SET NULL"), nullable=True),
        sa.Column("min_budget_kes", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_notified_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_request_watches_vendor_id", "request_watches", ["vendor_id"])
    op.create_index("ix_request_watches_zone_id", "request_watches", ["zone_id"])

    op.add_column(
        "business_requests",
        sa.Column("requirements", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("business_requests", "requirements")
    op.drop_index("ix_request_watches_zone_id", table_name="request_watches")
    op.drop_index("ix_request_watches_vendor_id", table_name="request_watches")
    op.drop_table("request_watches")
    op.drop_table("standing_profiles")
    op.drop_index("ix_claim_events_created_at", table_name="claim_events")
    op.drop_index("ix_claim_events_claim_id", table_name="claim_events")
    op.drop_table("claim_events")
    for index in ("ix_business_claims_verification_requested_at", "ix_business_claims_expires_on",
                  "ix_business_claims_status", "ix_business_claims_claim_key",
                  "ix_business_claims_vendor_id"):
        op.drop_index(index, table_name="business_claims")
    op.drop_table("business_claims")
    # Enum types and notification values are left in place: Postgres cannot
    # remove enum values, and dropping the types would break a re-upgrade
    # mid-flight. A downgrade removes the tables the release added.

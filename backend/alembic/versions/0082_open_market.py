"""Seller terms on offers, and the third-party claim record.

Revision ID: 0082_open_market
Revises: 0081_page_gallery

Three additive groups, one migration, because they ship as one product slice:

1. **Seller terms** — `platform_fee_pct` (our share, never ranks) and
   `buyer_cutback_pct` (the buyer's share, the only money-adjacent ranking input)
   on the three offering tables. Both default to 0, which is what every existing
   row means: not a partner.

2. **The whiteboard** — `office_notices` gains `kind`, `colour`, `pinned` and
   `expires_at`: a sticky note that clears itself.

3. **Third-party claims** — `market_observations` gains who reported a price and
   when it was last seen at that price, plus the business's reply columns. An
   existing intake row was collected by an operator, so the reporter stays NULL
   and the source is labelled `operator`.

4. **Hiring accruals** — `hiring_broadcasts`, `hiring_applications`,
   `hiring_claims`. There is deliberately **no column anywhere that can hold a
   payment from an applicant**: the applicant never pays, and that is enforced by
   the schema rather than by a comment.

Every column is nullable or defaulted, so the upgrade is safe on a live table.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0082_open_market"
down_revision: Union[str, None] = "0081_page_gallery"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OFFERING_TABLES = ("stock_items", "booking_services", "tool_listings")


def _terms(table: str) -> None:
    op.add_column(
        table,
        sa.Column("platform_fee_pct", sa.Numeric(5, 2), nullable=False,
                  server_default=sa.text("0")),
    )
    op.add_column(
        table,
        sa.Column("buyer_cutback_pct", sa.Numeric(5, 2), nullable=False,
                  server_default=sa.text("0")),
    )
    op.create_check_constraint(
        f"ck_{table}_terms_nonnegative",
        table,
        "platform_fee_pct >= 0 AND buyer_cutback_pct >= 0",
    )
    op.create_check_constraint(
        f"ck_{table}_terms_ceiling",
        table,
        "platform_fee_pct <= 3 AND buyer_cutback_pct <= 10",
    )


def upgrade() -> None:
    for table in OFFERING_TABLES:
        _terms(table)

    # ── third-party claims ────────────────────────────────────────────────────
    op.add_column("market_observations",
                  sa.Column("reported_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("market_observations",
                  sa.Column("source", sa.String(16), nullable=False,
                            server_default="operator"))
    op.add_column("market_observations", sa.Column("observed_on", sa.Date(), nullable=True))
    op.add_column("market_observations", sa.Column("reply_body", sa.Text(), nullable=True))
    op.add_column("market_observations",
                  sa.Column("reply_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("market_observations", sa.Column("replied_at", sa.DateTime(), nullable=True))
    op.create_check_constraint(
        "ck_market_observations_source",
        "market_observations",
        "source IN ('operator','customer','employee','rival','owner')",
    )
    op.create_foreign_key(
        "fk_market_observations_reported_by", "market_observations", "vendors",
        ["reported_by"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_market_observations_reply_by", "market_observations", "vendors",
        ["reply_by"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_market_observations_product",
                    "market_observations", ["product"])

    # ── hiring ────────────────────────────────────────────────────────────────
    op.create_table(
        "hiring_broadcasts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("poster_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employer_name", sa.String(160), nullable=False),
        # direct | agency | aggregator. Only `direct` is free, forever.
        sa.Column("poster_kind", sa.String(12), nullable=False, server_default="direct"),
        sa.Column("role_title", sa.String(160), nullable=False),
        sa.Column("role_summary", sa.Text(), nullable=False),
        sa.Column("town", sa.String(80), nullable=False),
        sa.Column("region_slug", sa.String(64), nullable=False, server_default="nyanza"),
        sa.Column("salary_kes", sa.Integer(), nullable=True),
        sa.Column("salary_unit", sa.String(12), nullable=False, server_default="month"),
        sa.Column("contact_note", sa.String(300), nullable=True),
        sa.Column("via_code", sa.String(16), nullable=False, unique=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="open"),
        sa.Column("hire_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("poster_kind IN ('direct','agency','aggregator')",
                           name="ck_hiring_broadcasts_poster_kind"),
        sa.CheckConstraint("status IN ('open','closed','filled')",
                           name="ck_hiring_broadcasts_status"),
        sa.CheckConstraint("salary_kes IS NULL OR salary_kes >= 0",
                           name="ck_hiring_broadcasts_salary"),
        sa.CheckConstraint("hire_count >= 0", name="ck_hiring_broadcasts_hires"),
        sa.CheckConstraint("length(btrim(role_title)) > 0",
                           name="ck_hiring_broadcasts_title"),
    )
    op.create_index("ix_hiring_broadcasts_town_status", "hiring_broadcasts",
                    ["region_slug", "status", "created_at"])

    op.create_table(
        "hiring_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("broadcast_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("hiring_broadcasts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("applicant_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        # Who sent them here. The first touch wins; no device fingerprinting.
        sa.Column("attributed_via", sa.String(16), nullable=True),
        sa.Column("cover_note", sa.String(1000), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="applied"),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("hired_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "status IN ('applied','shortlisted','hired','rejected','withdrawn')",
            name="ck_hiring_applications_status",
        ),
        sa.UniqueConstraint("broadcast_id", "applicant_vendor_id",
                            name="uq_hiring_applications_once"),
    )

    op.create_table(
        "hiring_claims",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("broadcast_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("hiring_broadcasts.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("application_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("hiring_applications.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("earner_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payer_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("amount_kes", sa.Integer(), nullable=False, server_default="0"),
        # accrued  the number exists; nobody may be paid
        # payable  the hire was confirmed by two signals; the payer may settle
        # settled  the payer recorded a direct-payment reference
        # void     the hire fell through; the reason is kept
        sa.Column("status", sa.String(12), nullable=False, server_default="accrued"),
        sa.Column("payment_reference", sa.String(120), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("settled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('hire_fee','broadcaster_share')",
                           name="ck_hiring_claims_kind"),
        sa.CheckConstraint("status IN ('accrued','payable','settled','void')",
                           name="ck_hiring_claims_status"),
        sa.CheckConstraint("amount_kes >= 0", name="ck_hiring_claims_amount"),
        sa.UniqueConstraint("application_id", "kind", "earner_vendor_id",
                            name="uq_hiring_claims_once"),
    )
    op.create_index("ix_hiring_claims_earner", "hiring_claims",
                    ["earner_vendor_id", "status", "created_at"])

    # ── the private office whiteboard ─────────────────────────────────────────
    op.add_column("office_notices",
                  sa.Column("kind", sa.String(8), nullable=False, server_default="notice"))
    op.add_column("office_notices",
                  sa.Column("colour", sa.String(12), nullable=False, server_default="plain"))
    op.add_column("office_notices",
                  sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("office_notices", sa.Column("expires_at", sa.DateTime(timezone=True),
                                              nullable=True))
    op.create_check_constraint(
        "ck_office_notices_kind", "office_notices", "kind IN ('notice','sticky')")
    op.create_check_constraint(
        "ck_office_notices_colour", "office_notices",
        "colour IN ('amber','lime','sky','rose','plain')")
    op.create_check_constraint(
        "ck_office_notices_expiry", "office_notices",
        "expires_at IS NULL OR created_at IS NULL OR expires_at > created_at")

    # ── price observation rewards ─────────────────────────────────────────────
    op.create_table(
        "observation_rewards",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("town", sa.String(80), nullable=True),
        sa.Column("accepted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("required", sa.Integer(), nullable=False, server_default="12"),
        sa.Column("amount_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(12), nullable=False, server_default="accrued"),
        sa.Column("payment_reference", sa.String(120), nullable=True),
        sa.Column("reason", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('accrued','paid','void')",
                           name="ck_observation_rewards_status"),
        sa.CheckConstraint("accepted >= 0 AND amount_kes >= 0",
                           name="ck_observation_rewards_nonnegative"),
        sa.UniqueConstraint("vendor_id", "work_date", "town",
                            name="uq_observation_rewards_day"),
    )


def downgrade() -> None:
    op.drop_constraint("ck_office_notices_expiry", "office_notices", type_="check")
    op.drop_constraint("ck_office_notices_colour", "office_notices", type_="check")
    op.drop_constraint("ck_office_notices_kind", "office_notices", type_="check")
    for column in ("expires_at", "pinned", "colour", "kind"):
        op.drop_column("office_notices", column)

    op.drop_table("observation_rewards")
    op.drop_index("ix_hiring_claims_earner", table_name="hiring_claims")
    op.drop_table("hiring_claims")
    op.drop_table("hiring_applications")
    op.drop_index("ix_hiring_broadcasts_town_status", table_name="hiring_broadcasts")
    op.drop_table("hiring_broadcasts")

    op.drop_index("ix_market_observations_product", table_name="market_observations")
    op.drop_constraint("fk_market_observations_reply_by", "market_observations",
                       type_="foreignkey")
    op.drop_constraint("fk_market_observations_reported_by", "market_observations",
                       type_="foreignkey")
    op.drop_constraint("ck_market_observations_source", "market_observations", type_="check")
    for column in ("replied_at", "reply_by", "reply_body", "observed_on", "source",
                   "reported_by"):
        op.drop_column("market_observations", column)

    for table in OFFERING_TABLES:
        op.drop_constraint(f"ck_{table}_terms_ceiling", table, type_="check")
        op.drop_constraint(f"ck_{table}_terms_nonnegative", table, type_="check")
        op.drop_column(table, "buyer_cutback_pct")
        op.drop_column(table, "platform_fee_pct")

"""Event vendor desk: rate cards, structured requests, quotes and bookings.

Revision ID: 0073_event_vendor_desk
Revises: 0072_town_commerce
Create Date: 2026-11-17

The event wedge records a commitment without taking custody of money:

  · a rate card is the vendor's own price list, with self-reported reach;
  · a request is an organiser's structured brief against one of their events;
  · a quote is one vendor's answer, and an accepted quote is the booking.

There is intentionally no wallet, escrow or payout table. Contact details are
opened by the API only after a quote is accepted.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0073_event_vendor_desk"
down_revision = "0072_town_commerce"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "vendor_rate_cards",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("headline", sa.String(200), nullable=False, server_default=""),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("event_categories", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("proof_links", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("reach_claims", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("vendor_id", name="uq_vendor_rate_cards_vendor"),
    )

    op.create_table(
        "rate_card_packages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("rate_card_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendor_rate_cards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("price_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("price_unit", sa.String(24), nullable=False, server_default="per_event"),
        sa.Column("inclusions", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("price_kes >= 0", name="ck_rate_card_packages_price_nonneg"),
        sa.CheckConstraint(
            "price_unit IN ('per_event','per_day','per_person','per_hour','per_item','custom')",
            name="ck_rate_card_packages_unit",
        ),
    )
    op.create_index("ix_rate_card_packages_card_active", "rate_card_packages",
                    ["rate_card_id", "is_active"])

    op.create_table(
        "event_vendor_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("event_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organizer_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("brief", sa.Text(), nullable=False, server_default=""),
        sa.Column("budget_min_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("budget_max_kes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payer", sa.String(16), nullable=False, server_default="organizer"),
        sa.Column("requirements", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("response_deadline", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "status IN ('open','closed','awarded','cancelled')",
            name="ck_event_vendor_requests_status",
        ),
        sa.CheckConstraint(
            "payer IN ('organizer','vendor','split','undecided')",
            name="ck_event_vendor_requests_payer",
        ),
        sa.CheckConstraint(
            "budget_min_kes >= 0 AND budget_max_kes >= 0",
            name="ck_event_vendor_requests_budget_nonneg",
        ),
        sa.CheckConstraint(
            "budget_max_kes = 0 OR budget_max_kes >= budget_min_kes",
            name="ck_event_vendor_requests_budget_band",
        ),
    )
    op.create_index("ix_event_vendor_requests_open", "event_vendor_requests",
                    ["status", "category", "created_at"])
    op.create_index("ix_event_vendor_requests_event", "event_vendor_requests", ["event_id"])

    op.create_table(
        "event_vendor_quotes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("request_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("event_vendor_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("package_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("rate_card_packages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount_kes", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("inclusions", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("valid_until", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="submitted"),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("request_id", "vendor_id", name="uq_event_vendor_quotes_vendor"),
        sa.CheckConstraint(
            "status IN ('submitted','shortlisted','accepted','declined','withdrawn')",
            name="ck_event_vendor_quotes_status",
        ),
        sa.CheckConstraint("amount_kes > 0", name="ck_event_vendor_quotes_amount_positive"),
    )
    op.create_index("ix_event_vendor_quotes_request_status", "event_vendor_quotes",
                    ["request_id", "status"])
    op.create_index("ix_event_vendor_quotes_vendor", "event_vendor_quotes",
                    ["vendor_id", "created_at"])


def downgrade():
    op.drop_table("event_vendor_quotes")
    op.drop_table("event_vendor_requests")
    op.drop_table("rate_card_packages")
    op.drop_table("vendor_rate_cards")

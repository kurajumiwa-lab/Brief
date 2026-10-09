"""Business requests: one object for "my business needs something" (v2.9).

The four jobs — stock, workers, delivery, rentals — each had a screen, but the
moment a business could not *find* what it needed in a directory had no home.
This migration adds that home: `business_requests` (what, where, by when, for
how much) and `request_offers` (who can do it, at what price, how fast), with
one lifecycle for every request type:

    open → fulfilled (one offer accepted) | cancelled (requester withdrew)

Everything is an ordinary indexed row: no AI matching, no shadow ranking. The
open feed orders by shared market, shared city words and shared trade
categories — clauses a trader could read out loud.

Revision ID: 0012_business_requests
Revises: 0011_map_viewport_indexes
Create Date: 2026-10-09
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "0012_business_requests"
down_revision: str = "0011_map_viewport_indexes"
branch_labels = None
depends_on = None

REQUEST_TYPE = ("stock", "worker", "delivery", "rental", "errand", "service")
URGENCY = ("today", "tomorrow", "this_week", "flexible")
REQUEST_STATUS = ("open", "fulfilled", "cancelled")
OFFER_STATUS = ("offered", "accepted", "declined")


def _enum(name, values):
    return PG_ENUM(*values, name=name, create_type=True)


def upgrade() -> None:
    request_type = _enum("request_type", REQUEST_TYPE)
    urgency = _enum("request_urgency", URGENCY)
    request_status = _enum("request_status", REQUEST_STATUS)
    offer_status = _enum("offer_status", OFFER_STATUS)

    op.create_table(
        "business_requests",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("requester_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_type", request_type, nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("location", sa.String(300), nullable=False),
        sa.Column("zone_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("market_zones.id", ondelete="SET NULL"), nullable=True),
        sa.Column("geo_lat", sa.Float(), nullable=True),
        sa.Column("geo_lng", sa.Float(), nullable=True),
        sa.Column("needed_by", urgency, nullable=False),
        sa.Column("budget_kes", sa.Integer(), nullable=True),
        sa.Column("status", request_status, nullable=False),
        sa.Column("accepted_offer_id", PGUUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("char_length(description) >= 8", name="ck_request_description_real"),
    )
    op.create_index("ix_business_requests_requester", "business_requests", ["requester_vendor_id"])
    op.create_index("ix_business_requests_type", "business_requests", ["request_type"])
    op.create_index("ix_business_requests_status", "business_requests", ["status"])
    op.create_index("ix_business_requests_zone", "business_requests", ["zone_id"])

    op.create_table(
        "request_offers",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("request_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("business_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("responder_vendor_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("price_kes", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("lead_time", sa.String(120), nullable=True),
        sa.Column("status", offer_status, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("request_id", "responder_vendor_id", name="uq_request_offer_responder"),
        sa.CheckConstraint("price_kes IS NULL OR price_kes >= 0", name="ck_request_offer_price"),
    )
    op.create_index("ix_request_offers_request", "request_offers", ["request_id"])
    op.create_index("ix_request_offers_responder", "request_offers", ["responder_vendor_id"])
    op.create_index("ix_request_offers_status", "request_offers", ["status"])


def downgrade() -> None:
    op.drop_table("request_offers")
    op.drop_table("business_requests")
    for name in ("offer_status", "request_status", "request_urgency", "request_type"):
        op.execute(f"DROP TYPE IF EXISTS {name}")

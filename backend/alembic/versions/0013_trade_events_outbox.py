"""trade audit history + transactional outbox (locked decisions 5 & 6)

request_events — the request lifecycle's append-only audit trail; written in
the same transaction as the state change it describes.

event_outbox — cross-module facts recorded atomically with canonical state;
a background worker drains and marks them processed. The table doubles as
the raw event history analytics read models and trust metrics rebuild from.

Revision ID: 0013_trade_events_outbox
Revises: 0012_business_requests
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

revision: str = "0013_trade_events_outbox"
down_revision: str = "0012_business_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "request_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("request_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("business_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("actor_vendor_id", PGUUID(as_uuid=True), nullable=True),
        sa.Column("offer_id", PGUUID(as_uuid=True), nullable=True),
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_request_events_request", "request_events", ["request_id"])

    op.create_table(
        "event_outbox",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column("topic", sa.String(length=80), nullable=False),
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_event_outbox_topic", "event_outbox", ["topic"])
    op.create_index("ix_event_outbox_created_at", "event_outbox", ["created_at"])
    op.create_index("ix_event_outbox_processed_at", "event_outbox", ["processed_at"])


def downgrade() -> None:
    op.drop_table("event_outbox")
    op.drop_table("request_events")

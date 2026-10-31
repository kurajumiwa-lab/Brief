"""Market intake: photographs of public advertising become a price dataset.

Three tables, all additive:

  · ``market_intake_batches`` — one upload of up to twelve photographs, or one
    pasted block of text, with the engine that read it. The audit trail.

  · ``market_observations`` — one price statement per row ("Maya diapers bale,
    2,100"). They are ``suggested`` until an operator confirms them; a rejected
    row is kept, because knowing what the reader got wrong is how the extraction
    rules improve.

  · ``market_presences`` — a seller with no account, identified by a virtual ID
    (`~khetia`). This is the table that lets the product carry market data it
    did not get permission to carry *an account* for: a presence has no email,
    no session and no login, it is a label on a price. Claiming it later links
    it to a real vendor by matching phone number.

Nothing is rewritten and nothing is dropped. The downgrade removes the three
tables — which is the honest meaning of rolling the feature back: the dataset
only exists as part of it, and there is no older copy to fall back to.

Revision ID: 0030_market_intake
Revises: 0029_selected_work
Create Date: 2026-10-31
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0030_market_intake"
down_revision: str = "0029_selected_work"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "market_intake_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="screenshots"),
        sa.Column("image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "image_urls",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("ocr_engine", sa.String(length=32), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("seller_hint", sa.String(length=160), nullable=True),
        sa.Column("phone_hint", sa.String(length=24), nullable=True),
        sa.Column("market", sa.String(length=80), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="parsed"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('parsed','empty','failed')", name="ck_market_intake_batch_status"
        ),
    )

    op.create_table(
        "market_presences",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("virtual_id", sa.String(length=32), nullable=False, unique=True),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("phone", sa.String(length=24), nullable=True),
        sa.Column("market", sa.String(length=80), nullable=True),
        sa.Column(
            "categories",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "claimed_vendor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_market_presences_virtual_id", "market_presences", ["virtual_id"], unique=True
    )
    op.create_index("ix_market_presences_phone", "market_presences", ["phone"])

    op.create_table(
        "market_observations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "batch_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("market_intake_batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "presence_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("market_presences.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("product", sa.String(length=160), nullable=False),
        sa.Column("price_kes", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=16), nullable=True),
        sa.Column("category", sa.String(length=60), nullable=True),
        sa.Column("market", sa.String(length=80), nullable=True),
        sa.Column("seller_label", sa.String(length=160), nullable=True),
        sa.Column("phone", sa.String(length=24), nullable=True),
        sa.Column("wholesale", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("raw_line", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="suggested"),
        sa.Column(
            "decided_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('suggested','confirmed','rejected')",
            name="ck_market_observation_status",
        ),
    )
    op.create_index("ix_market_observations_batch_id", "market_observations", ["batch_id"])
    op.create_index(
        "ix_market_observations_status_created",
        "market_observations",
        ["status", "created_at"],
    )
    op.create_index("ix_market_observations_category", "market_observations", ["category"])
    op.create_index("ix_market_observations_market", "market_observations", ["market"])


def downgrade() -> None:
    op.drop_index("ix_market_observations_market", table_name="market_observations")
    op.drop_index("ix_market_observations_category", table_name="market_observations")
    op.drop_index("ix_market_observations_status_created", table_name="market_observations")
    op.drop_index("ix_market_observations_batch_id", table_name="market_observations")
    op.drop_table("market_observations")

    op.drop_index("ix_market_presences_phone", table_name="market_presences")
    op.drop_index("ix_market_presences_virtual_id", table_name="market_presences")
    op.drop_table("market_presences")

    op.drop_table("market_intake_batches")

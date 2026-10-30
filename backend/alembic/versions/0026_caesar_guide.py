"""The guide: two append-only logs behind Caesar's suggestions.

Nothing here is a profile. ``guide_searches`` records the words and whether the
shelves could answer them; ``guide_shelf_visits`` records which shelf was opened
and nothing else. Both are safe to truncate — the product falls back to the
declared shelf map, which is what it ships with.

``guide_searches.vendor_id`` is nullable and ``ON DELETE SET NULL``: most
searching is done by people who are not signed in, and closing a business must
not rewrite the network's memory of what was missing from its shelves.

Purely additive: no existing table, column, constraint or index is touched.

Revision ID: 0026_caesar_guide
Revises: 0025_social_layer
Create Date: 2026-10-30
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0026_caesar_guide"
down_revision: str = "0025_social_layer"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "guide_searches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "vendor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("query", sa.String(200), nullable=False),
        sa.Column("shelf", sa.String(40), nullable=True),
        sa.Column("result_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_guide_searches_vendor_id", "guide_searches", ["vendor_id"])
    # The demand query: zero-result searches grouped over a window.
    op.create_index("ix_guide_searches_miss", "guide_searches", ["result_count", "created_at"])
    op.create_index("ix_guide_searches_query", "guide_searches", ["query", "created_at"])

    op.create_table(
        "guide_shelf_visits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "vendor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("shelf", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_guide_shelf_visits_vendor_id", "guide_shelf_visits", ["vendor_id"])
    # The next-shelf query self-joins on (vendor_id, created_at).
    op.create_index("ix_guide_visits_vendor_time", "guide_shelf_visits", ["vendor_id", "created_at"])


def downgrade() -> None:
    op.drop_table("guide_shelf_visits")
    op.drop_table("guide_searches")

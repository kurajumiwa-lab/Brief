"""Street broadcasts — the scheduled stamp for a weekday script.

Revision ID: 0079_street_broadcasts
Revises: 0078_street_lobbies
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0079_street_broadcasts"
down_revision: Union[str, None] = "0078_street_lobbies"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "street_broadcasts",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("script_key", sa.String(length=40), nullable=False),
        sa.Column("run_date", sa.Date(), nullable=False),
        sa.Column("season_key", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("href", sa.String(length=180), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("script_key", "run_date", name="uq_street_broadcast_day"),
    )
    op.create_index("ix_street_broadcasts_day", "street_broadcasts", ["run_date", "published_at"])


def downgrade() -> None:
    op.drop_index("ix_street_broadcasts_day", table_name="street_broadcasts")
    op.drop_table("street_broadcasts")

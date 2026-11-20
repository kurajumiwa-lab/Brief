"""Location layer: table pins, H3 cells and the open-data context cache.

Revision ID: 0080_location_hex
Revises: 0079_street_broadcasts
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0080_location_hex"
down_revision: Union[str, None] = "0079_street_broadcasts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("street_lobbies", sa.Column("geo_lat", sa.Float(), nullable=True))
    op.add_column("street_lobbies", sa.Column("geo_lng", sa.Float(), nullable=True))
    op.add_column("street_lobbies", sa.Column("h3_r9", sa.String(length=20), nullable=True))
    op.add_column("street_lobbies", sa.Column("h3_r8", sa.String(length=20), nullable=True))
    op.add_column("street_lobbies", sa.Column("h3_r7", sa.String(length=20), nullable=True))
    op.create_index(
        "ix_street_lobbies_h3_r9", "street_lobbies",
        ["h3_r9", "status", "expires_at"],
    )
    op.create_index(
        "ix_street_lobbies_h3_r8", "street_lobbies",
        ["h3_r8", "status", "expires_at"],
    )
    op.create_index(
        "ix_street_lobbies_h3_r7", "street_lobbies",
        ["h3_r7", "status", "expires_at"],
    )

    op.create_table(
        "geo_hex_cells",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("h3_index", sa.String(length=20), nullable=False),
        sa.Column("resolution", sa.Integer(), server_default="9", nullable=False),
        sa.Column("center_lat", sa.Float(), nullable=False),
        sa.Column("center_lng", sa.Float(), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("fixtures", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("fixture_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("source", sa.String(length=24), server_default="none", nullable=False),
        sa.Column("last_error", sa.String(length=300), nullable=True),
        sa.Column("refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("h3_index", name="uq_geo_hex_cells_h3_index"),
    )
    op.create_index("ix_geo_hex_cells_h3_index", "geo_hex_cells", ["h3_index"])
    op.create_index("ix_geo_hex_cells_refreshed", "geo_hex_cells", ["refreshed_at"])
    op.create_index("ix_geo_hex_cells_attempted", "geo_hex_cells", ["attempted_at"])


def downgrade() -> None:
    op.drop_index("ix_geo_hex_cells_attempted", table_name="geo_hex_cells")
    op.drop_index("ix_geo_hex_cells_refreshed", table_name="geo_hex_cells")
    op.drop_index("ix_geo_hex_cells_h3_index", table_name="geo_hex_cells")
    op.drop_table("geo_hex_cells")

    op.drop_index("ix_street_lobbies_h3_r7", table_name="street_lobbies")
    op.drop_index("ix_street_lobbies_h3_r8", table_name="street_lobbies")
    op.drop_index("ix_street_lobbies_h3_r9", table_name="street_lobbies")
    op.drop_column("street_lobbies", "h3_r7")
    op.drop_column("street_lobbies", "h3_r8")
    op.drop_column("street_lobbies", "h3_r9")
    op.drop_column("street_lobbies", "geo_lng")
    op.drop_column("street_lobbies", "geo_lat")

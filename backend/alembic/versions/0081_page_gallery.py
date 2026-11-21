"""Page gallery: the board of photographs a public page shows.

Revision ID: 0081_page_gallery
Revises: 0080_location_hex

Adds `vendor_profiles.gallery_items` — a JSONB list of
{image_url, caption, tag}. It sits beside `work_items` rather than replacing it:
work is *what was delivered*, the gallery is *what it looks like*.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0081_page_gallery"
down_revision: Union[str, None] = "0080_location_hex"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vendor_profiles",
        sa.Column(
            "gallery_items",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("vendor_profiles", "gallery_items")

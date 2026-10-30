"""Selected work: a shop front can show what the business has actually done.

One additive column on ``vendor_profiles``:

  · ``work_items`` — a small JSONB list of public cards
    ({title, summary, outcome, discipline, year, image_url}).

This carries the only capability from the retired creative-portfolio page that
a buyer needs and the app did not already have: *proof of work, on the shelf
where the buyer is already standing.* The portfolio's other surfaces were not
carried across — its price list became Business Desk offers, its inquiry
pipeline became the enquiry inbox, and its identity/bio editing already existed
on the shop front's own profile editor.

The column is NOT NULL with a server default so existing vendors read as an
empty showcase without a backfill, and it carries no constraint beyond being a
list: the shape is enforced by ``app/services/work_showcase.py`` at the write
boundary, because the rule there is allowed to change without a migration.

No data is rewritten and nothing is dropped; the downgrade removes the column
and the showcase with it, which is the honest meaning of rolling the feature
back.

Revision ID: 0029_selected_work
Revises: 0028_business_desk
Create Date: 2026-10-30
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0029_selected_work"
down_revision: str = "0028_business_desk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendor_profiles",
        sa.Column(
            "work_items",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("vendor_profiles", "work_items")

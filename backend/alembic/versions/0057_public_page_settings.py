"""Public Page editor: one JSONB column on vendors for the owner's Page settings.

Additive. Adds vendors.public_page (default '{}'). Nothing existing is changed.

Revision ID: 0057_public_page_settings
Revises: 0056_external_facts
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0057_public_page_settings"
down_revision: str = "0056_external_facts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendors",
        sa.Column("public_page", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("vendors", "public_page")

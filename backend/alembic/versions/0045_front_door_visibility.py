"""Front-door visibility (Phase 8): a vendor chooses whether their door is listed nearby.

Additive: one boolean column on vendors, server default false. Existing vendors are not
listed until they turn it on, so nobody's location becomes visible without their choice.
Downgrade removes only this column.

Revision ID: 0045_front_door_visibility
Revises: 0044_work_assignments
Create Date: 2026-11-11
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0045_front_door_visibility"
down_revision: str = "0044_work_assignments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendors",
        sa.Column("front_door_visible", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("vendors", "front_door_visible")

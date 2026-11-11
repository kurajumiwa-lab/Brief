"""Onboarding: what a person does (multi-select), and whether they finished or skipped it.

Additive. Two columns on vendor_profiles with safe defaults. No row is removed or changed in
meaning: every existing profile starts as 'pending' with no activities. Named CHECK on the state.

Revision ID: 0042_onboarding_activities
Revises: 0041_office_visibility
Create Date: 2026-11-11
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0042_onboarding_activities"
down_revision: str = "0041_office_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vendor_profiles", sa.Column(
        "activities", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))
    op.add_column("vendor_profiles", sa.Column(
        "onboarding_state", sa.String(12), nullable=False, server_default="pending"))
    op.create_check_constraint(
        "ck_vendor_profiles_onboarding_state", "vendor_profiles",
        "onboarding_state IN ('pending', 'done', 'skipped')")


def downgrade() -> None:
    op.drop_constraint("ck_vendor_profiles_onboarding_state", "vendor_profiles", type_="check")
    op.drop_column("vendor_profiles", "onboarding_state")
    op.drop_column("vendor_profiles", "activities")

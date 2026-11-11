"""Office visibility: a home office is private until its owner makes it public.

Additive. One column and one named CHECK rule. No existing row is removed or changed in
meaning: offices that already exist are set to 'public', because they were public when
they were created and their owners must keep what they already published (rule 10).
New offices default to 'private' (rule 9: public visibility is an explicit choice).

Revision ID: 0041_office_visibility
Revises: 0040_home_office
Create Date: 2026-11-11
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0041_office_visibility"
down_revision: str = "0040_home_office"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("offices", sa.Column("visibility", sa.String(12), nullable=False,
                                       server_default="public"))
    op.create_check_constraint("ck_offices_visibility", "offices",
                               "visibility IN ('private', 'public')")
    # Existing rows keep 'public' (grandfathered). New rows start private.
    op.alter_column("offices", "visibility", server_default="private")


def downgrade() -> None:
    op.drop_constraint("ck_offices_visibility", "offices", type_="check")
    op.drop_column("offices", "visibility")

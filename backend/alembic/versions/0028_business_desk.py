"""Business Desk: enquiries remember which need they came through.

Two additive changes to ``catalog_enquiries``:

  · ``desk_key`` — which of the five buying needs the request arrived through.
    Without it an operator has to decode the offer key to route a request, and
    a "custom business solutions" enquiry (which has no offer at all) is
    unroutable.

  · the ``kind`` check constraint gains ``pilot``, ``requirements`` and
    ``interest`` — the three actions the desk's readiness table can produce.
    Existing rows are untouched: every old value is still in the new list,
    which is why this is widened rather than replaced.

No data is rewritten and no column is dropped, so this runs safely before the
code that writes the new column and rolls back without stranding an enquiry.

Revision ID: 0028_business_desk
Revises: 0027_caesar_park
Create Date: 2026-10-30
"""

import sqlalchemy as sa

from alembic import op

revision: str = "0028_business_desk"
down_revision: str = "0027_caesar_park"
branch_labels = None
depends_on = None

OLD_KINDS = "'purchase','trial','quotation','discovery_call'"
NEW_KINDS = ("'purchase','trial','quotation','discovery_call',"
             "'pilot','requirements','interest'")


def upgrade() -> None:
    op.add_column(
        "catalog_enquiries",
        sa.Column("desk_key", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_catalog_enquiries_desk_key", "catalog_enquiries", ["desk_key"]
    )

    op.drop_constraint("ck_catalog_enquiry_kind", "catalog_enquiries", type_="check")
    op.create_check_constraint(
        "ck_catalog_enquiry_kind", "catalog_enquiries", f"kind IN ({NEW_KINDS})"
    )


def downgrade() -> None:
    # Anything recorded by the desk would violate the old constraint, so those
    # rows are mapped back onto the closest pre-desk kind rather than deleted.
    # An enquiry is a customer's request; losing it to a rollback is not an
    # option.
    op.execute(
        "UPDATE catalog_enquiries SET kind = 'quotation' "
        "WHERE kind IN ('pilot', 'requirements', 'interest')"
    )
    op.drop_constraint("ck_catalog_enquiry_kind", "catalog_enquiries", type_="check")
    op.create_check_constraint(
        "ck_catalog_enquiry_kind", "catalog_enquiries", f"kind IN ({OLD_KINDS})"
    )
    op.drop_index("ix_catalog_enquiries_desk_key", table_name="catalog_enquiries")
    op.drop_column("catalog_enquiries", "desk_key")

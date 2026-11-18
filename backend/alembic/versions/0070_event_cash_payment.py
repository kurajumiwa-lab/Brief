"""Event cash payment

Revision ID: 0070_event_cash_payment
Revises: 0069_corridor_price_index
Create Date: 2026-11-17
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0070_event_cash_payment"
down_revision: Union[str, Sequence[str], None] = "0069_corridor_price_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "payment_method IS NULL OR payment_method IN ('TILL','PAYBILL','POCHI','SEND_MONEY','FREE')"
NEW = "payment_method IS NULL OR payment_method IN ('TILL','PAYBILL','POCHI','SEND_MONEY','CASH','FREE')"


def upgrade() -> None:
    op.drop_constraint("ck_events_payment_method", "events", type_="check")
    op.create_check_constraint("ck_events_payment_method", "events", NEW)


def downgrade() -> None:
    # CASH is not representable in the old constraint. Keep the events, but
    # stop claiming a rail the old schema cannot store.
    op.execute("UPDATE events SET payment_method = 'FREE' WHERE payment_method = 'CASH'")
    op.drop_constraint("ck_events_payment_method", "events", type_="check")
    op.create_check_constraint("ck_events_payment_method", "events", OLD)

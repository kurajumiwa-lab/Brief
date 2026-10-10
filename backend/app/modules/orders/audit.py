"""Small shared primitives for the order transaction state machine."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.orders.models import MovementEvent, OrderTransaction


def kes_integer(value) -> int:
    """Convert a recorded KES value to whole shillings without banker's rounding."""
    try:
        return int(Decimal(str(value or 0)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError, TypeError):
        return 0


def platform_fee_for(product_amount_ksh: int) -> int:
    rate = Decimal(str(settings.TRADE_PLATFORM_FEE_RATE))
    if rate < 0 or rate > 1:
        raise ValueError("TRADE_PLATFORM_FEE_RATE must be between 0 and 1")
    return int((Decimal(product_amount_ksh) * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


async def ensure_order_transaction(db: AsyncSession, movement) -> OrderTransaction:
    """Create the immutable price snapshot once, also used by legacy rows."""
    transaction = (await db.execute(
        select(OrderTransaction).where(OrderTransaction.movement_id == movement.id)
    )).scalar_one_or_none()
    if transaction is not None:
        return transaction

    product_amount = kes_integer(movement.total_value)
    transaction = OrderTransaction(
        movement_id=movement.id,
        product_amount_ksh=product_amount,
        platform_fee_ksh=platform_fee_for(product_amount),
    )
    db.add(transaction)
    await db.flush()
    return transaction


def record_movement_event(
    db: AsyncSession,
    movement_id: UUID,
    event_type: str,
    *,
    actor_vendor_id: UUID | None = None,
    payload: dict | None = None,
) -> MovementEvent:
    """Stage one immutable event in the same DB transaction as its state change."""
    row = MovementEvent(
        movement_id=movement_id,
        event_type=event_type,
        actor_vendor_id=actor_vendor_id,
        payload=payload or {},
    )
    db.add(row)
    return row

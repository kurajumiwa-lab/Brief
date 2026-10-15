"""Repeat a completed vendor-to-vendor order, never bypassing the stock engine.

The past order is a template, not a contract or proof of payment. Stock is
locked and rechecked at creation, and the supplier still has to confirm.
"""

import hashlib
import json
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import MovementStatus, StockItem, StockMovement
from app.models.vendor import Vendor
from app.modules.orders.audit import kes_integer, record_movement_event
from app.modules.orders.models import OrderTransaction
from app.modules.orders.schemas import RepeatOrderIn
from app.services import stock_engine


def _request_hash(body: RepeatOrderIn) -> str:
    price = (str(body.proposed_price.quantize(Decimal(".01"))) if body.proposed_price is not None else None)
    data = [str(body.source_movement_id), body.quantity, price]
    return hashlib.sha256(json.dumps(data, separators=(",", ":")).encode()).hexdigest()


async def repeatable_orders(db: AsyncSession, vendor: Vendor, limit: int = 30) -> list[dict]:
    rows = (await db.execute(
        select(StockMovement, StockItem, Vendor, OrderTransaction)
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .join(Vendor, Vendor.id == StockMovement.from_vendor_id)
        .outerjoin(OrderTransaction, OrderTransaction.movement_id == StockMovement.id)
        .where(StockMovement.to_vendor_id == vendor.id,
               StockMovement.status == MovementStatus.RECEIVED.value,
               StockMovement.movement_type == "sourcing")
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(limit)
    )).all()
    out = []
    for previous, item, supplier, transaction in rows:
        # A past supplier may have closed this line or lowered their MOQ or
        # availability. Do not hide those rows: show the buyer why they cannot
        # repeat *this* order, with the original amount still visible.
        reason = None
        if item.vendor_id != supplier.id or supplier.fraud_suspended_at:
            reason = "This supplier is not available for repeat orders"
        elif not item.visible_to_network:
            reason = "This supplier has delisted this stock"
        elif item.quantity_available < item.min_order_quantity:
            reason = f"Only {item.quantity_available} {item.unit_of_measure} left (minimum {item.min_order_quantity})"
        elif previous.unit_price is None:
            reason = "No previous unit price was recorded"
        out.append({
            "source_movement_id": str(previous.id),
            "stock_item_id": str(item.id),
            "supplier_handle": supplier.vendor_handle,
            "supplier_name": supplier.business_name,
            "item": item.name,
            "sku": item.sku,
            "unit": item.unit_of_measure,
            "quantity": previous.quantity,
            "last_unit_price_kes": previous.unit_price,
            "last_total_kes": transaction.product_amount_ksh if transaction else kes_integer(previous.total_value),
            "current_unit_price_kes": stock_engine.effective_unit_price(item, previous.quantity),
            "available": item.quantity_available,
            "min_order_quantity": item.min_order_quantity,
            "last_ordered_at": previous.created_at.isoformat(),
            "unavailable_reason": reason,
        })
    return out


async def repeat_order(
    db: AsyncSession, vendor: Vendor, body: RepeatOrderIn, idempotency_key: str,
) -> dict:
    if not idempotency_key or len(idempotency_key) < 8 or len(idempotency_key) > 128 or not idempotency_key.isascii() or not idempotency_key.isprintable():
        raise HTTPException(400, "Provide an Idempotency-Key of 8–128 printable ASCII characters")
    # The key is scoped to this buyer. Advisory transaction lock serializes
    # *the same key* across workers; the unique index is the final DB guard.
    key_hash = hashlib.sha256(f"{vendor.id}:{idempotency_key}".encode()).hexdigest()
    lock_id = int.from_bytes(bytes.fromhex(key_hash)[:8], "big", signed=True)
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})
    payload_hash = _request_hash(body)
    existing = (await db.execute(select(StockMovement).where(
        StockMovement.to_vendor_id == vendor.id,
        StockMovement.reorder_key_hash == key_hash,
    ))).scalar_one_or_none()
    if existing:
        if existing.reorder_request_hash != payload_hash:
            raise HTTPException(409, "Idempotency-Key was already used for a different order. Check Orders before trying again.")
        return {"movement_id": str(existing.id), "status": existing.status, "replayed": True}

    previous = await db.get(StockMovement, body.source_movement_id)
    if (not previous or previous.to_vendor_id != vendor.id
            or previous.status != MovementStatus.RECEIVED.value or previous.movement_type != "sourcing"):
        raise HTTPException(404, "Completed order not found")
    item = await db.get(StockItem, previous.stock_item_id, with_for_update=True)
    if item is None or item.vendor_id != previous.from_vendor_id:
        raise HTTPException(409, "The original supplier no longer offers this stock")
    supplier = await db.get(Vendor, previous.from_vendor_id)
    if supplier is None or supplier.fraud_suspended_at or not item.visible_to_network:
        raise HTTPException(409, "The original supplier is not offering this stock now")
    if body.quantity > item.quantity_available:
        raise HTTPException(409, f"Only {item.quantity_available} {item.unit_of_measure} left; adjust quantity")
    if previous.unit_price is None and body.proposed_price is None:
        raise HTTPException(409, "This order has no recorded unit price. Ask the supplier for a new quote.")

    proposed = float(body.proposed_price) if body.proposed_price is not None else previous.unit_price
    # OrderTransaction.product_amount_ksh is an integer column; reject an
    # implausibly large proposal cleanly instead of failing at commit.
    if proposed < 0 or Decimal(str(proposed)) * body.quantity > 2_000_000_000:
        raise HTTPException(400, "Proposed product amount must be between 0 and KES 2,000,000,000")
    try:
        movement = await stock_engine.request_sourcing(db, item, vendor, body.quantity, proposed, None)
    except stock_engine.StockError as exc:
        raise HTTPException(409 if exc.status_code == 400 else exc.status_code, str(exc)) from exc
    movement.reorder_key_hash = key_hash
    movement.reorder_request_hash = payload_hash
    record_movement_event(db, movement.id, "order_repeated", actor_vendor_id=vendor.id,
                          payload={"source_movement_id": str(previous.id)})
    await db.commit()
    return {"movement_id": str(movement.id), "status": movement.status, "replayed": False}

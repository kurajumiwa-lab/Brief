"""Vendor-owned trade history. A record is not proof that money changed hands.

Both the screen and CSV use the same scoped, keyset-paginated query. Prices and
amounts come from the movement / immutable transaction, never today's shelf.
"""

import base64
import csv
import io
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.stock import MovementStatus, StockItem, StockMovement
from app.models.vendor import Vendor
from app.modules.orders.audit import kes_integer
from app.modules.orders.models import OrderTransaction

DISCLAIMER = (
    "This is your record of trades on Brief_. It is not a receipt, an invoice, or a tax document."
)
CSV_COLUMNS = (
    "date", "reference", "counterparty handle", "item", "quantity", "unit",
    "unit price KES", "total KES", "goods status", "settlement status",
)


def _cursor_for(row: StockMovement) -> str:
    raw = f"{row.created_at.isoformat()}|{row.id}".encode("ascii")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        value = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True).decode("ascii")
        stamp, identifier = value.split("|", 1)
        date = datetime.fromisoformat(stamp)
        if date.tzinfo is not None:
            raise ValueError("cursor is not a naive UTC timestamp")
        return date, UUID(identifier)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(400, "Invalid records cursor") from exc


def _safe_search(value: str) -> str:
    # An item name is data, not a SQL LIKE pattern.
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def records_page(
    db: AsyncSession, vendor_id: UUID, *, limit: int = 30,
    cursor: str | None = None, q: str | None = None, include_summary: bool = False,
) -> dict:
    supplier, buyer = aliased(Vendor), aliased(Vendor)
    stmt = (
        select(StockMovement, StockItem, supplier, buyer, OrderTransaction)
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .join(supplier, supplier.id == StockMovement.from_vendor_id)
        .join(buyer, buyer.id == StockMovement.to_vendor_id)
        .outerjoin(OrderTransaction, OrderTransaction.movement_id == StockMovement.id)
        .where(or_(StockMovement.from_vendor_id == vendor_id, StockMovement.to_vendor_id == vendor_id))
    )
    if cursor:
        date, identifier = _decode_cursor(cursor)
        stmt = stmt.where(or_(StockMovement.created_at < date, and_(
            StockMovement.created_at == date, StockMovement.id < identifier,
        )))
    if q and q.strip():
        term = q.strip()
        pattern = f"%{_safe_search(term)}%"
        # @ is display syntax, not part of the stored vendor handle.
        handle_term = term[1:] if term.startswith("@") and len(term) > 1 else term
        handle_pattern = f"%{_safe_search(handle_term)}%"
        # Search the *other* vendor, not both sides. Otherwise searching for
        # one's own handle spuriously matches every trade in the history.
        counterparty_handle = case(
            (StockMovement.to_vendor_id == vendor_id, supplier.vendor_handle),
            else_=buyer.vendor_handle,
        )
        stmt = stmt.where(or_(
            StockItem.name.ilike(pattern, escape="\\"),
            StockItem.sku.ilike(pattern, escape="\\"),
            counterparty_handle.ilike(handle_pattern, escape="\\"),
        ))
    rows = (await db.execute(stmt.order_by(
        StockMovement.created_at.desc(), StockMovement.id.desc(),
    ).limit(limit + 1))).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = []
    for movement, item, from_vendor, to_vendor, transaction in rows:
        # Legacy rows without a transaction can still show their recorded
        # movement total. This is NOT recalculated from today's catalogue.
        items.append({
            "id": str(movement.id),
            "reference": str(movement.id),
            "date": movement.created_at.isoformat() if movement.created_at else None,
            "direction": "incoming" if movement.to_vendor_id == vendor_id else "outgoing",
            "counterparty_handle": (from_vendor if movement.to_vendor_id == vendor_id else to_vendor).vendor_handle,
            "item": item.name,
            "sku": item.sku,
            "quantity": movement.quantity,
            "unit": item.unit_of_measure,
            "unit_price_kes": movement.unit_price,
            "total_kes": transaction.product_amount_ksh if transaction else (
                kes_integer(movement.total_value) if movement.total_value is not None else None
            ),
            "goods_status": movement.status,
            "settlement_status": transaction.settlement_status if transaction else "not_started",
        })
    result = {
        "items": items,
        "next_cursor": _cursor_for(rows[-1][0]) if has_more else None,
        "disclaimer": DISCLAIMER,
    }
    if include_summary:
        result["summary"] = await records_summary(db, vendor_id)
    return result


async def records_summary(db: AsyncSession, vendor_id: UUID) -> dict:
    # All-time counts: the stock list is not a lifetime summary (it is capped).
    needs_action = or_(
        and_(StockMovement.from_vendor_id == vendor_id, StockMovement.status.in_((
            MovementStatus.PENDING.value, MovementStatus.CONFIRMED.value,
        ))),
        and_(StockMovement.to_vendor_id == vendor_id, StockMovement.status == MovementStatus.SHIPPED.value),
    )
    total, received, actionable = (await db.execute(select(
        func.count(StockMovement.id),
        func.sum(case((StockMovement.status == MovementStatus.RECEIVED.value, 1), else_=0)),
        func.sum(case((needs_action, 1), else_=0)),
    ).where(or_(StockMovement.from_vendor_id == vendor_id, StockMovement.to_vendor_id == vendor_id)))).one()
    return {"recorded": int(total), "received": int(received or 0), "needs_action": int(actionable or 0)}


def _csv_cell(value) -> str | int:
    if value is None:
        return ""
    if isinstance(value, str):
        # Spreadsheet apps interpret leading = + - @ (even after whitespace)
        # as formulas. These fields include vendor-entered names and handles.
        if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n")):
            return "'" + value
    return value


def csv_lines(records: list[dict]):
    """Yield CSV by row, with a bounded input page (maximum 100 records)."""
    output = io.StringIO()
    writer = csv.writer(output)
    for row in ([DISCLAIMER], CSV_COLUMNS):
        writer.writerow(row)
        yield output.getvalue()
        output.seek(0)
        output.truncate()
    for item in records:
        writer.writerow([_csv_cell(v) for v in (
            item["date"], item["reference"], item["counterparty_handle"], item["item"],
            item["quantity"], item["unit"],
            str(Decimal(str(item["unit_price_kes"]))) if item["unit_price_kes"] is not None else None,
            item["total_kes"], item["goods_status"], item["settlement_status"],
        )])
        yield output.getvalue()
        output.seek(0)
        output.truncate()

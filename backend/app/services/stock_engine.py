"""
Stock Engine — what happens to shelves when vendors deal with each other.

A sourcing request reserves stock on the supplier's shelf. The movement then
walks pending → confirmed → shipped → received (or → cancelled at any point
before it is received). On `received` the supplier's shelf is debited, the
buyer's shelf is credited with a `network_transfer` item, and the parasitism
engine re-scores the pair. On `cancelled` the reservation is released.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import MovementStatus, StockItem, StockMovement, StockSource
from app.models.vendor import Vendor
from app.services import parasitism_engine


class StockError(Exception):
    """A rule of the shelf was broken. Routes translate this to HTTP 400/403."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def recompute_available(item: StockItem) -> None:
    item.quantity_available = max(0, (item.quantity_in_stock or 0) - (item.quantity_reserved or 0))


async def request_sourcing(
    db: AsyncSession, item: StockItem, buyer: Vendor,
    quantity: int, proposed_price: Optional[float], notes: Optional[str],
) -> StockMovement:
    if item.vendor_id == buyer.id:
        raise StockError("Can't source from yourself")
    if not item.visible_to_network:
        raise StockError("This stock is not offered to the network", 403)
    if quantity <= 0:
        raise StockError("Quantity must be positive")
    if quantity < item.min_order_quantity:
        raise StockError(f"Minimum order: {item.min_order_quantity}")
    if item.quantity_available < quantity:
        raise StockError(f"Only {item.quantity_available} available")

    unit_price = proposed_price if proposed_price is not None else (item.wholesale_price or item.unit_price or 0.0)
    movement = StockMovement(
        stock_item_id=item.id,
        from_vendor_id=item.vendor_id,
        to_vendor_id=buyer.id,
        quantity=quantity,
        unit_price=unit_price,
        total_value=round(unit_price * quantity, 2),
        movement_type="sourcing",
        status=MovementStatus.PENDING.value,
        notes=notes,
    )
    item.quantity_reserved += quantity
    recompute_available(item)
    db.add(movement)
    return movement


_TRANSITIONS = {
    "confirm": (MovementStatus.PENDING, MovementStatus.CONFIRMED, "supplier"),
    "ship": (MovementStatus.CONFIRMED, MovementStatus.SHIPPED, "supplier"),
    "receive": (MovementStatus.SHIPPED, MovementStatus.RECEIVED, "buyer"),
}


async def transition(db: AsyncSession, movement: StockMovement, action: str, actor: Vendor) -> StockMovement:
    """Advance a movement. Supplier confirms and ships; buyer receives; either
    side may cancel before receipt."""
    item = await db.get(StockItem, movement.stock_item_id)
    if item is None:
        raise StockError("Stock item no longer exists", 404)

    if action == "cancel":
        if actor.id not in (movement.from_vendor_id, movement.to_vendor_id):
            raise StockError("Not your movement", 403)
        if movement.status == MovementStatus.RECEIVED.value:
            raise StockError("Already received; cannot cancel")
        if movement.status == MovementStatus.CANCELLED.value:
            return movement
        item.quantity_reserved = max(0, item.quantity_reserved - movement.quantity)
        recompute_available(item)
        movement.status = MovementStatus.CANCELLED.value
        movement.completed_at = datetime.utcnow()
        return movement

    if action not in _TRANSITIONS:
        raise StockError(f"Unknown action '{action}'")
    expected, nxt, side = _TRANSITIONS[action]
    owner = movement.from_vendor_id if side == "supplier" else movement.to_vendor_id
    if actor.id != owner:
        raise StockError(f"Only the {side} can {action} this movement", 403)
    if movement.status != expected.value:
        raise StockError(f"Movement is '{movement.status}', expected '{expected.value}' to {action}")

    movement.status = nxt.value
    if nxt is MovementStatus.RECEIVED:
        await _settle_receipt(db, movement, item)
    return movement


async def _settle_receipt(db: AsyncSession, movement: StockMovement, item: StockItem) -> None:
    """Debit the supplier, credit the buyer, score the pair."""
    qty = movement.quantity
    item.quantity_reserved = max(0, item.quantity_reserved - qty)
    item.quantity_in_stock = max(0, item.quantity_in_stock - qty)
    recompute_available(item)
    movement.completed_at = datetime.utcnow()

    # The goods now sit on the buyer's shelf. Same SKU on the buyer's side is
    # topped up; otherwise a new network_transfer item is opened.
    buyer_item = None
    if item.sku:
        buyer_item = (await db.execute(
            select(StockItem).where(StockItem.vendor_id == movement.to_vendor_id, StockItem.sku == item.sku)
        )).scalars().first()
    if buyer_item is None:
        buyer_item = StockItem(
            vendor_id=movement.to_vendor_id,
            sku=item.sku,
            name=item.name,
            category=item.category,
            subcategory=item.subcategory,
            description=item.description,
            unit_of_measure=item.unit_of_measure,
            cost_price=movement.unit_price,
            unit_price=item.unit_price,
            wholesale_price=item.wholesale_price,
            source=StockSource.NETWORK_TRANSFER,
            visible_to_network=False,  # the buyer decides when to offer it onward
            tags=list(item.tags or []),
            quantity_in_stock=0,
        )
        db.add(buyer_item)
    buyer_item.quantity_in_stock = (buyer_item.quantity_in_stock or 0) + qty
    recompute_available(buyer_item)

    supplier = await db.get(Vendor, movement.from_vendor_id)
    buyer = await db.get(Vendor, movement.to_vendor_id)
    if supplier:
        supplier.total_stock_moved += qty
    if buyer:
        buyer.total_stock_moved += qty

    await parasitism_engine.update_vendor_network_score(movement.from_vendor_id, db)
    await parasitism_engine.update_vendor_network_score(movement.to_vendor_id, db)
    await parasitism_engine.update_connection_score(movement.from_vendor_id, movement.to_vendor_id, db)


async def upsert_from_pos(
    db: AsyncSession, vendor: Vendor, rows: list[dict], source: StockSource,
    sync_config: Optional[dict] = None,
) -> dict:
    """Idempotent import used by the POS bridge and the CSV importer. Matches an
    existing shelf line by `pos_item_id`, then by `sku`; otherwise adds one.
    Returns counts for the sync log."""
    cfg = sync_config or {}
    exclude = set(cfg.get("exclude_sku") or [])
    min_stock = int(cfg.get("min_stock") or 0)
    added = updated = skipped = 0
    errors: list[str] = []
    now = datetime.utcnow()

    for i, row in enumerate(rows):
        try:
            name = (row.get("name") or "").strip()
            if not name:
                raise ValueError("missing name")
            sku = (row.get("sku") or None) or None
            if sku in exclude:
                skipped += 1
                continue
            qty = int(float(row.get("quantity") or row.get("quantity_in_stock") or 0))
            if qty < min_stock:
                skipped += 1
                continue
            pos_item_id = row.get("pos_item_id") or None

            item = None
            if pos_item_id:
                item = (await db.execute(select(StockItem).where(
                    StockItem.vendor_id == vendor.id, StockItem.pos_item_id == str(pos_item_id)
                ))).scalars().first()
            if item is None and sku:
                item = (await db.execute(select(StockItem).where(
                    StockItem.vendor_id == vendor.id, StockItem.sku == str(sku)
                ))).scalars().first()

            if item is None:
                item = StockItem(vendor_id=vendor.id, name=name, source=source)
                db.add(item)
                added += 1
            else:
                updated += 1

            item.name = name
            item.sku = str(sku) if sku else item.sku
            item.pos_item_id = str(pos_item_id) if pos_item_id else item.pos_item_id
            item.category = row.get("category") or item.category
            item.description = row.get("description") or item.description
            item.unit_of_measure = row.get("unit_of_measure") or item.unit_of_measure or "units"
            for field in ("unit_price", "wholesale_price", "cost_price"):
                val = row.get(field)
                if val not in (None, ""):
                    setattr(item, field, float(val))
            if row.get("tags"):
                tags = row["tags"]
                item.tags = [t.strip() for t in tags.split("|")] if isinstance(tags, str) else list(tags)
            item.quantity_in_stock = qty
            recompute_available(item)
            item.last_pos_sync = now
            item.visible_to_network = bool(row.get("visible_to_network", item.visible_to_network if item.visible_to_network is not None else True))
        except Exception as exc:  # one bad row must not sink the sync
            errors.append(f"row {i + 1}: {exc}")

    return {"processed": len(rows), "added": added, "updated": updated, "skipped": skipped, "errors": errors}

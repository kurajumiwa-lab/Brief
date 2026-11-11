"""Build the offerings list from the three existing sources.

Each item is normalised to the same shape so the Desk can show one list:

    kind      goods | service | tool
    id        the source row id (string)
    title     display name
    category  source category, or None
    price     number in KES (or the source's own unit), or None
    price_unit  unit label for price, or None
    available bool: is it currently offered
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockItem
from app.models.tools import ToolListing
from app.modules.schedule.models import BookableService

LIMIT = 200


def _value(v):
    return getattr(v, "value", v)


async def _goods(db: AsyncSession, vendor_id, public: bool) -> list[dict]:
    q = select(StockItem).where(StockItem.vendor_id == vendor_id)
    if public:
        q = q.where(StockItem.visible_to_network.is_(True))
    rows = (await db.execute(q.order_by(StockItem.name).limit(LIMIT))).scalars().all()
    return [
        {
            "kind": "goods",
            "id": str(r.id),
            "title": r.name,
            "category": r.category,
            "price": r.unit_price,
            "price_unit": r.unit_of_measure,
            "available": (r.quantity_available or 0) > 0,
        }
        for r in rows
    ]


async def _services(db: AsyncSession, vendor_id, public: bool) -> list[dict]:
    q = select(BookableService).where(BookableService.vendor_id == vendor_id)
    if public:
        q = q.where(BookableService.is_active.is_(True))
    rows = (await db.execute(q.order_by(BookableService.name).limit(LIMIT))).scalars().all()
    return [
        {
            "kind": "service",
            "id": str(r.id),
            "title": r.name,
            "category": None,
            "price": r.price_kes,
            "price_unit": "per visit" if r.price_kes is not None else None,
            "available": bool(r.is_active),
        }
        for r in rows
    ]


async def _tools(db: AsyncSession, vendor_id, public: bool) -> list[dict]:
    q = select(ToolListing).where(ToolListing.vendor_id == vendor_id)
    if public:
        q = q.where(ToolListing.is_available.is_(True))
    rows = (await db.execute(q.order_by(ToolListing.title).limit(LIMIT))).scalars().all()
    return [
        {
            "kind": "tool",
            "id": str(r.id),
            "title": r.title,
            "category": _value(r.category),
            "price": r.price_per_unit,
            "price_unit": r.price_unit,
            "available": bool(r.is_available),
        }
        for r in rows
    ]


async def _collect(db: AsyncSession, vendor_id, public: bool) -> dict:
    items = (
        await _goods(db, vendor_id, public)
        + await _services(db, vendor_id, public)
        + await _tools(db, vendor_id, public)
    )
    counts = {"goods": 0, "service": 0, "tool": 0}
    for it in items:
        counts[it["kind"]] += 1
    return {"items": items, "counts": counts}


async def mine(db: AsyncSession, vendor) -> dict:
    """Everything this person offers, including items not yet visible to the network."""
    return await _collect(db, vendor.id, public=False)


async def public_for(db: AsyncSession, vendor) -> dict:
    """Only what the network may see. Never includes hidden or unavailable-by-flag rows."""
    return await _collect(db, vendor.id, public=True)

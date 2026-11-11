"""Network search: one permission-aware search over the shelves and suppliers I can see.

    GET /api/search/network?q=...&limit=...   products and suppliers matching q

Permissions, applied in the database and not in the browser:
  * products: only goods shelved to the network (visible_to_network). Archived and paused
    offerings are already off that flag. Own shelf is excluded.
  * suppliers: never the viewer. Vendors under a fraud-suspension hold are excluded.
  * anyone the viewer has blocked (the Outside block list) is excluded from both lists.

Read-only. Matching happens in SQL with a result limit, so the whole network is never loaded.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.stock import StockItem
from app.models.vendor import Vendor
from app.modules.outside.feed import blocked_author_ids
from app.routes.auth import get_current_vendor
from app.routes.stock import stock_out_many
from app.routes.vendors import vendor_out

router = APIRouter()


@router.get("/network")
async def search_network(
    q: str = Query(..., min_length=2, max_length=100),
    limit: int = Query(20, ge=1, le=50),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    term = q.strip()
    if len(term) < 2:
        return {"query": q, "products": [], "suppliers": []}
    # The block list holds id strings; the id columns need UUID objects.
    blocked = [uuid.UUID(v) for v in (await blocked_author_ids(db, vendor)) if v]

    product_q = (
        select(StockItem, Vendor)
        .join(Vendor, StockItem.vendor_id == Vendor.id)
        .where(
            StockItem.visible_to_network.is_(True),
            StockItem.quantity_available >= 1,
            StockItem.vendor_id != vendor.id,
            Vendor.fraud_suspended_at.is_(None),
            or_(
                StockItem.name.icontains(term, autoescape=True),
                StockItem.description.icontains(term, autoescape=True),
                StockItem.category.icontains(term, autoescape=True),
                StockItem.subcategory.icontains(term, autoescape=True),
                StockItem.sku.icontains(term, autoescape=True),
            ),
        )
        .order_by(StockItem.quantity_available.desc(), StockItem.updated_at.desc())
        .limit(limit)
    )
    if blocked:
        product_q = product_q.where(Vendor.id.not_in(blocked))
    product_rows = (await db.execute(product_q)).all()

    supplier_q = (
        select(Vendor)
        .where(
            Vendor.id != vendor.id,
            Vendor.fraud_suspended_at.is_(None),
            or_(
                Vendor.business_name.icontains(term, autoescape=True),
                Vendor.vendor_handle.icontains(term, autoescape=True),
                Vendor.business_description.icontains(term, autoescape=True),
            ),
        )
        .order_by(Vendor.network_score.desc(), Vendor.joined_at.desc())
        .limit(limit)
    )
    if blocked:
        supplier_q = supplier_q.where(Vendor.id.not_in(blocked))
    suppliers = (await db.execute(supplier_q)).scalars().all()

    return {
        "query": term,
        "products": [p.model_dump() for p in stock_out_many(product_rows)],
        "suppliers": [vendor_out(v).model_dump() for v in suppliers],
    }

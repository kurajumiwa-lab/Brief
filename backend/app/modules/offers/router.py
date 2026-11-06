"""Offers API — the verified offer shelf.

    GET    /api/offers/public              open browse, no account: every shared item with a trust label
    GET    /api/offers/confirmed           confirmed offers for signed-in businesses (home shelf)
    GET    /api/offers/mine                my items, each with its status and the reason
    POST   /api/offers/{item_id}/confirm   Brief team: confirm an item by hand (reason required)
    DELETE /api/offers/{item_id}/confirm   Brief team: take a hand confirmation back
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.stock import StockItem
from app.models.vendor import Vendor
from app.modules.membership.models import MemberProfile
from app.modules.offers import service
from app.routes.auth import get_current_vendor
from app.routes.governance import require_governance_ops

router = APIRouter()


class HandConfirm(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


def _offer_out(item: StockItem, vendor: Vendor) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "category": item.category,
        "unit_price": item.unit_price,
        "wholesale_price": item.wholesale_price,
        "unit": item.unit_of_measure,
        "quantity_available": item.quantity_available,
        "min_order_quantity": item.min_order_quantity,
        "images": item.images or [],
        "status": service.CONFIRMED,
        "seller": {"id": str(vendor.id), "handle": vendor.vendor_handle, "name": vendor.business_name},
    }


@router.get("/public")
async def public_browse(limit: int = Query(24, ge=1, le=100), category: Optional[str] = None,
                        q: Optional[str] = Query(None, max_length=120), db: AsyncSession = Depends(get_db)):
    """Open to everyone, no account needed. Lists every shared, in-stock item with its trust label."""
    return {"offers": await service.public_offers(db, limit=limit, category=category, q=q)}


@router.get("/confirmed")
async def list_confirmed(limit: int = Query(12, ge=1, le=50), category: Optional[str] = None,
                         vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = await service.confirmed_offers(db, vendor.id, limit=limit, category=category)
    return {"offers": [_offer_out(item, seller) for item, seller in rows]}


@router.get("/mine")
async def my_offers(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"items": await service.status_for_my_items(db, vendor.id)}


async def _item_or_404(db: AsyncSession, item_id: uuid.UUID) -> StockItem:
    item = (await db.execute(select(StockItem).where(StockItem.id == item_id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found.")
    return item


@router.post("/{item_id}/confirm")
async def confirm_by_hand(item_id: uuid.UUID, data: HandConfirm,
                          staff: Vendor = Depends(require_governance_ops("admin")),
                          db: AsyncSession = Depends(get_db)):
    item = await _item_or_404(db, item_id)
    verified = (await db.execute(select(MemberProfile.verification_status).where(
        MemberProfile.vendor_id == item.vendor_id))).scalar_one_or_none() == "verified"
    if not verified:
        raise HTTPException(status_code=409, detail="Verify the business before confirming its offers.")
    created = await service.set_by_hand(db, staff.id, item.id, data.reason.strip())
    await db.commit()
    return {"item_id": str(item.id), "confirmed_by_hand": True, "created": created}


@router.delete("/{item_id}/confirm")
async def remove_hand_confirmation(item_id: uuid.UUID,
                                   staff: Vendor = Depends(require_governance_ops("admin")),
                                   db: AsyncSession = Depends(get_db)):
    await _item_or_404(db, item_id)
    removed = await service.remove_by_hand(db, item_id)
    await db.commit()
    return {"item_id": str(item_id), "confirmed_by_hand": False, "removed": removed}

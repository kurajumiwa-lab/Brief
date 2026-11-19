"""HTTP surface for the event vendor desk.

The public router is deliberately separate: only a GET of a published rate card
is readable without an account. Everything that touches a request, a quote or a
contact detail depends on `get_current_vendor`.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.event_desk import service
from app.modules.event_desk.schemas import (
    PackagesIn, QuoteIn, QuoteStatusIn, RateCardIn, RequestIn, RequestStatusIn,
)
from app.routes.auth import get_current_vendor

router = APIRouter()
public = APIRouter()


@public.get("/public/rate-cards/{handle}")
async def public_rate_card(handle: str, db: AsyncSession = Depends(get_db)):
    return await service.public_rate_card(db, handle)


@router.get("/rate-card")
async def my_rate_card(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.my_rate_card(db, vendor)


@router.put("/rate-card")
async def save_rate_card(data: RateCardIn, vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    result = await service.upsert_rate_card(db, vendor, data)
    await db.commit()
    return {"message": "Rate card saved", "rate_card": result}


@router.put("/rate-card/packages")
async def save_packages(data: PackagesIn, vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    result = await service.replace_packages(db, vendor, data)
    await db.commit()
    return {"message": "Packages saved", "rate_card": result}


@router.get("/requests")
async def open_requests(
    category: str = "",
    q: str = "",
    region: str = "",
    min_budget: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_open_requests(db, vendor, category=category.strip().lower(),
                                            q=q, region=region, min_budget=min_budget, limit=limit)


@router.get("/requests/mine")
async def my_requests(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.my_requests(db, vendor)


@router.get("/requests/{request_id}")
async def request_detail(request_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    return await service.get_request(db, vendor, request_id)


@router.post("/events/{event_id}/requests")
async def create_request(event_id: UUID, data: RequestIn, vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    result = await service.create_request(db, vendor, event_id, data)
    await db.commit()
    return {"message": "Vendor request broadcast", "request": result}


@router.post("/requests/{request_id}/status")
async def set_request_status(request_id: UUID, data: RequestStatusIn,
                             vendor: Vendor = Depends(get_current_vendor),
                             db: AsyncSession = Depends(get_db)):
    result = await service.set_request_status(db, vendor, request_id, data.status)
    await db.commit()
    return {"message": f"Request {data.status}", "request": result}


@router.post("/requests/{request_id}/quotes")
async def submit_quote(request_id: UUID, data: QuoteIn, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    result = await service.submit_quote(db, vendor, request_id, data)
    await db.commit()
    return {"message": "Quote submitted", "quote": result}


@router.get("/quotes/mine")
async def my_quotes(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.my_quotes(db, vendor)


@router.post("/quotes/{quote_id}/status")
async def set_quote_status(quote_id: UUID, data: QuoteStatusIn,
                           vendor: Vendor = Depends(get_current_vendor),
                           db: AsyncSession = Depends(get_db)):
    result = await service.set_quote_status(db, vendor, quote_id, data.status)
    await db.commit()
    return {"message": f"Quote {data.status}", "quote": result}

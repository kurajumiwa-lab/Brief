"""HTTP surface for group logistics.

    GET  /api/logistics/providers                       active delivery providers
    POST /api/logistics/providers                       operator: add a provider
    GET  /api/logistics/orders/open                     open group orders to join
    GET  /api/logistics/orders/mine                     orders I organise or joined
    POST /api/logistics/orders                          start a group order
    GET  /api/logistics/orders/{id}                     one order (participants see detail)
    POST /api/logistics/orders/{id}/join                join an open order
    POST /api/logistics/orders/{id}/leave               leave while open
    POST /api/logistics/orders/{id}/route               organiser: optimise the drop-off route
    POST /api/logistics/orders/{id}/schedule            organiser: provider and delivery window
    POST /api/logistics/orders/{id}/status              organiser: move the delivery forward
    GET  /api/logistics/admin/orders                    operator: oversight list
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.logistics import service
from app.modules.logistics.models import ORDER_STATUSES
from app.routes.auth import get_current_vendor
from app.routes.ops import require_operator

router = APIRouter()


class OrderIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=160)
    description: Optional[str] = Field(None, max_length=2000)
    item_summary: Optional[str] = Field(None, max_length=2000)
    closes_at: Optional[datetime] = None
    delivery_point: Optional[str] = Field(None, max_length=300)


class JoinIn(BaseModel):
    quantity_note: Optional[str] = Field(None, max_length=300)


class StopIn(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    priority: int = Field(0, ge=0, le=5)


class RouteIn(BaseModel):
    stops: list[StopIn] = Field(..., min_length=1, max_length=50)
    start_lat: Optional[float] = Field(None, ge=-90, le=90)
    start_lng: Optional[float] = Field(None, ge=-180, le=180)


class ScheduleIn(BaseModel):
    provider_id: Optional[uuid.UUID] = None
    window_start: datetime
    window_end: datetime


class StatusIn(BaseModel):
    status: str = Field(..., pattern="^(open|locked|scheduled|in_transit|delivered|cancelled)$")
    note: Optional[str] = Field(None, max_length=300)


class ProviderIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=160)
    contact: Optional[str] = Field(None, max_length=200)
    service_area: Optional[str] = Field(None, max_length=200)


def _raise(exc: service.LogisticsError):
    raise HTTPException(exc.status, str(exc))


@router.get("/providers")
async def providers(db: AsyncSession = Depends(get_db)):
    return await service.list_providers(db)


@router.post("/providers", status_code=201)
async def add_provider(body: ProviderIn, staff: Vendor = Depends(require_operator),
                       db: AsyncSession = Depends(get_db)):
    data = await service.add_provider(db, name=body.name, contact=body.contact, service_area=body.service_area)
    await db.commit()
    return data


@router.get("/orders/open")
async def open_orders(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.list_open(db)


@router.get("/orders/mine")
async def my_orders(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.list_mine(db, vendor)


@router.post("/orders", status_code=201)
async def create(body: OrderIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    data = await service.create_order(db, vendor, title=body.title, description=body.description,
                                      item_summary=body.item_summary, closes_at=body.closes_at,
                                      delivery_point=body.delivery_point)
    await db.commit()
    return data


@router.get("/orders/{order_id}")
async def one(order_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        return await service.get_order(db, vendor, order_id)
    except service.LogisticsError as exc:
        _raise(exc)


@router.post("/orders/{order_id}/join")
async def join(order_id: uuid.UUID, body: Optional[JoinIn] = None, vendor: Vendor = Depends(get_current_vendor),
               db: AsyncSession = Depends(get_db)):
    try:
        data = await service.join(db, vendor, order_id, body.quantity_note if body else None)
    except service.LogisticsError as exc:
        _raise(exc)
    await db.commit()
    return data


@router.post("/orders/{order_id}/leave")
async def leave(order_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        data = await service.leave(db, vendor, order_id)
    except service.LogisticsError as exc:
        _raise(exc)
    await db.commit()
    return data


@router.post("/orders/{order_id}/route")
async def route(order_id: uuid.UUID, body: RouteIn, vendor: Vendor = Depends(get_current_vendor),
                db: AsyncSession = Depends(get_db)):
    start = None
    if body.start_lat is not None and body.start_lng is not None:
        start = {"lat": body.start_lat, "lng": body.start_lng, "label": "start"}
    stops = [s.model_dump() for s in body.stops]
    try:
        data = await service.plan_route(db, vendor, order_id, stops, start)
    except service.LogisticsError as exc:
        _raise(exc)
    await db.commit()
    return data


@router.post("/orders/{order_id}/schedule")
async def schedule(order_id: uuid.UUID, body: ScheduleIn, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    try:
        order = await service.get_order(db, vendor, order_id)
        if order["my_role"] != "organiser":
            raise service.LogisticsError("Only the organiser can schedule delivery.", 403)
        data = await service.schedule(db, vendor.vendor_handle, order_id, provider_id=body.provider_id,
                                      window_start=body.window_start, window_end=body.window_end)
    except service.LogisticsError as exc:
        _raise(exc)
    await db.commit()
    return data


@router.post("/orders/{order_id}/status")
async def status(order_id: uuid.UUID, body: StatusIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        order = await service.get_order(db, vendor, order_id)
        if order["my_role"] != "organiser":
            raise service.LogisticsError("Only the organiser can update delivery status.", 403)
        data = await service.set_status(db, vendor.vendor_handle, order_id, body.status, body.note)
    except service.LogisticsError as exc:
        _raise(exc)
    await db.commit()
    return data


@router.get("/admin/orders")
async def admin_orders(status: Optional[str] = Query(None, pattern="^(open|locked|scheduled|in_transit|delivered|cancelled)$"),
                       staff: Vendor = Depends(require_operator), db: AsyncSession = Depends(get_db)):
    return await service.admin_list(db, status)

"""HTTP adapter for offerings.

    GET   /api/offerings/mine                     my offerings, incl. paused (auth). ?include_archived=true
    POST  /api/offerings                          create goods, a service or a tool (auth)
    PATCH /api/offerings/{kind}/{id}              edit my offering (auth, owner only)
    POST  /api/offerings/{kind}/{id}/status       pause | resume | archive (auth, owner only)
    GET   /api/offerings/of/{handle}              what a person offers to the network (public)

Ownership is enforced in the service: every write is scoped to the caller's vendor_id, and a
row that belongs to someone else is reported as not found. Request bodies refuse unknown
fields, so a client cannot set ownership or status fields directly.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.offerings import service
from app.modules.offerings.service import OfferingError
from app.modules.schedule.domains import ServiceDomain
from app.routes.auth import get_current_vendor

router = APIRouter()
public = APIRouter()


class ModeIn(BaseModel):
    """One way a service is given (services only), with its own price and unit."""
    model_config = ConfigDict(extra="forbid")
    mode: Literal["in_shop", "home_visit", "remote", "drop_off", "pickup_delivery"]
    price: Optional[float] = None
    price_unit: Optional[str] = Field(default=None, max_length=30)
    price_mode: Literal["fixed", "negotiable", "ask_me"] = "fixed"


class OfferingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["goods", "service", "tool"]
    title: str = Field(..., min_length=2, max_length=300)
    description: Optional[str] = Field(default=None, max_length=2000)
    category: Optional[str] = Field(default=None, max_length=100)
    price: Optional[float] = None
    price_unit: Optional[str] = Field(default=None, max_length=50)
    price_mode: Literal["fixed", "negotiable", "ask_me"] = "fixed"
    quantity: Optional[StrictInt] = None
    duration_minutes: Optional[StrictInt] = None
    service_radius_km: Optional[StrictInt] = None
    photos: list[str] = []
    domain: Optional[ServiceDomain] = None  # Phase 6: services only
    modes: Optional[list[ModeIn]] = None  # services only: each way it is given, with its own price


class OfferingPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(default=None, min_length=2, max_length=300)
    description: Optional[str] = Field(default=None, max_length=2000)
    category: Optional[str] = Field(default=None, max_length=100)
    price: Optional[float] = None
    price_unit: Optional[str] = Field(default=None, max_length=50)
    price_mode: Optional[Literal["fixed", "negotiable", "ask_me"]] = None
    quantity: Optional[StrictInt] = None
    duration_minutes: Optional[StrictInt] = None
    service_radius_km: Optional[StrictInt] = None
    photos: Optional[list[str]] = None
    domain: Optional[ServiceDomain] = None  # Phase 6: services only; null clears it
    modes: Optional[list[ModeIn]] = None  # services only: replaces the whole list of ways it is given


class StatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["pause", "resume", "archive"]


def _fail(exc: OfferingError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


@router.get("/mine")
async def my_offerings(
    include_archived: bool = Query(False),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.mine(db, vendor, include_archived=include_archived)


@router.post("", status_code=201)
async def create_offering(
    body: OfferingIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    kind = data.pop("kind")
    try:
        row = await service.create(db, vendor, kind, data)
        item = await service.item(db, kind, row)
        await db.commit()
    except OfferingError as exc:
        await db.rollback()
        _fail(exc)
    return item


@router.patch("/{kind}/{offering_id}")
async def update_offering(
    kind: str,
    offering_id: str,
    body: OfferingPatch,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    patch = body.model_dump(exclude_unset=True)
    try:
        row = await service.update(db, vendor, kind, offering_id, patch)
        item = await service.item(db, kind, row)
        await db.commit()
    except OfferingError as exc:
        await db.rollback()
        _fail(exc)
    return item


@router.post("/{kind}/{offering_id}/status")
async def offering_status(
    kind: str,
    offering_id: str,
    body: StatusIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await service.set_status(db, vendor, kind, offering_id, body.action)
        item = await service.item(db, kind, row)
        await db.commit()
    except OfferingError as exc:
        await db.rollback()
        _fail(exc)
    return item


@public.get("/of/{handle}")
async def offerings_of(handle: str, db: AsyncSession = Depends(get_db)):
    from app.models.vendor import Vendor as V
    target = (
        await db.execute(select(V).where(V.vendor_handle == handle.lstrip("@").lower()))
    ).scalars().first()
    if not target:
        raise HTTPException(404, "Not found")
    return await service.public_for(db, target)

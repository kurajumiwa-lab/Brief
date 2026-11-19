"""Pulse windows and flash-drop HTTP surface."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.pulse import service
from app.routes.auth import get_current_vendor

router = APIRouter()
public = APIRouter()


class DropIn(BaseModel):
    label: str = Field(..., min_length=2, max_length=160)
    description: Optional[str] = Field(None, max_length=2000)
    price_kes: int = Field(0, ge=0, le=1000000)
    capacity: int = Field(1, ge=1, le=1000)
    duration_minutes: int = Field(60, ge=1, le=60)


@public.get("")
@public.get("/")
async def current_pulse():
    return service.pulse()


@public.get("/flash-drops")
async def flash_drops(db: AsyncSession = Depends(get_db)):
    return await service.active_drops(db)


@router.post("/flash-drops", status_code=201)
async def create_drop(data: DropIn, vendor: Vendor = Depends(get_current_vendor),
                      db: AsyncSession = Depends(get_db)):
    try:
        drop = await service.create_drop(
            db, vendor, label=data.label, description=data.description,
            price_kes=data.price_kes, capacity=data.capacity,
            duration_minutes=data.duration_minutes,
        )
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    return {"message": "Drop is live", "drop": drop}


@router.get("/flash-drops/mine")
async def my_drops(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.my_drops(db, vendor)


@router.post("/flash-drops/{drop_id}/claim")
async def claim_drop(drop_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    try:
        result = await service.claim_drop(db, vendor, drop_id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    return result

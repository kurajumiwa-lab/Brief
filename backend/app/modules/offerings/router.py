"""HTTP adapter for offerings (read-only).

    GET /api/offerings/mine             my offerings, including hidden ones (auth)
    GET /api/offerings/of/{handle}      what a person offers to the network (public)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.offerings import service
from app.routes.auth import get_current_vendor

router = APIRouter()
public = APIRouter()


@router.get("/mine")
async def my_offerings(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.mine(db, vendor)


@public.get("/of/{handle}")
async def offerings_of(handle: str, db: AsyncSession = Depends(get_db)):
    target = (
        await db.execute(select(Vendor).where(Vendor.vendor_handle == handle.lstrip("@").lower()))
    ).scalars().first()
    if not target:
        raise HTTPException(404, "Not found")
    return await service.public_for(db, target)

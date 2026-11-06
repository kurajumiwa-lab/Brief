"""Daily routine API. Every route needs a signed-in business.

    GET    /api/routine/today            the Today window: items, dots, count
    GET    /api/routine/catalogue        every check, its reason, and whether it is on
    PUT    /api/routine/preferences      {"checks": {"sessions": true, ...}} switch checks on or off
    POST   /api/routine/done/{key}       mark a check done for today
    DELETE /api/routine/done/{key}       undo today's tick
"""

from typing import Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.routine import service
from app.routes.auth import get_current_vendor

router = APIRouter()


class PreferencesIn(BaseModel):
    checks: Dict[str, bool]


@router.get("/today")
async def today(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.today(db, vendor.id)


@router.get("/catalogue")
async def catalogue(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"checks": await service.catalogue(db, vendor.id)}


@router.put("/preferences")
async def preferences(data: PreferencesIn, vendor: Vendor = Depends(get_current_vendor),
                      db: AsyncSession = Depends(get_db)):
    await service.set_preferences(db, vendor.id, data.checks)
    await db.commit()
    return {"checks": await service.catalogue(db, vendor.id)}


@router.post("/done/{key}")
async def done(key: str, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    await service.mark(db, vendor.id, key, done=True)
    await db.commit()
    return {"key": key, "done": True}


@router.delete("/done/{key}")
async def undo(key: str, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    await service.mark(db, vendor.id, key, done=False)
    await db.commit()
    return {"key": key, "done": False}

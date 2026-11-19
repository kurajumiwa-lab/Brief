"""HTTP surface for verified leads and the monthly statement."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.leads import service
from app.routes.auth import get_current_vendor

router = APIRouter()


class LeadIn(BaseModel):
    target_kind: str = Field(..., max_length=16)
    target_id: UUID
    action: str = Field("call", max_length=16)
    scout_code: Optional[str] = Field(None, max_length=16)
    details: Optional[dict] = None


@router.post("/record")
async def record_lead(data: LeadIn, vendor: Vendor = Depends(get_current_vendor),
                      db: AsyncSession = Depends(get_db)):
    try:
        result = await service.record(
            db, vendor, target_kind=data.target_kind, target_id=data.target_id,
            action=data.action, scout_code=data.scout_code, details=data.details,
        )
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    return result


@router.get("/mine")
async def my_leads(month: Optional[str] = None, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    return await service.mine(db, vendor, month)


@router.get("/statement")
async def statement(month: Optional[str] = None, vendor: Vendor = Depends(get_current_vendor),
                    db: AsyncSession = Depends(get_db)):
    return await service.statement(db, vendor, month)


@router.get("/scouted")
async def scouted(month: Optional[str] = None, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    return await service.scouted(db, vendor, month)

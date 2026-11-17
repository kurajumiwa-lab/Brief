from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.profile_handles import change_handle, resolve_alias

router = APIRouter()

class HandleIn(BaseModel):
    new_handle: str = Field(min_length=1, max_length=100)

@router.patch('/profile/handle')
async def update_handle(body: HandleIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    updated = await change_handle(db, vendor.id, body.new_handle)
    return {'handle': updated.vendor_handle, 'handle_changed_at': updated.handle_changed_at.isoformat() + 'Z' if updated.handle_changed_at else None}

@router.get('/profiles/{handle}')
async def resolve(handle: str, db: AsyncSession = Depends(get_db)):
    current = (await db.execute(select(Vendor.vendor_handle).where(Vendor.vendor_handle == handle.lower().lstrip('@'), Vendor.fraud_suspended_at.is_(None)))).scalar_one_or_none()
    if current and not current.startswith('closed_'):
        return {'handle': current}
    current = await resolve_alias(db, handle)
    if current: return {'redirect_to': current}
    raise HTTPException(404, 'Profile not found')

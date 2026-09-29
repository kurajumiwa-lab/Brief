"""
Notifications API (Directive v2.1 §1.3).

    GET  /api/notifications?unread_only&skip&limit  → {unread_count, notifications[]}
    POST /api/notifications/read-all
    POST /api/notifications/{id}/read
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import notification_service as svc

router = APIRouter()


async def _list(unread_only: bool, skip: int, limit: int, vendor: Vendor, db: AsyncSession):
    rows = await svc.list_for(db, vendor.id, unread_only=unread_only, skip=skip, limit=limit)
    return {
        "unread_count": await svc.get_unread_count(db, vendor.id),
        "notifications": [svc.to_dict(n) for n in rows],
    }


@router.get("")
@router.get("/")
async def list_notifications(
    unread_only: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await _list(unread_only, skip, limit, vendor, db)


@router.get("/unread-count")
async def unread(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"unread_count": await svc.get_unread_count(db, vendor.id)}


@router.post("/read-all")
async def read_all(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    n = await svc.mark_all_read(db, vendor.id)
    return {"message": "All notifications marked as read", "marked": n}


@router.post("/{notification_id}/read")
async def read_one(
    notification_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    if not await svc.mark_read(db, vendor.id, notification_id):
        raise HTTPException(404, "Notification not found")
    return {"message": "Marked as read"}

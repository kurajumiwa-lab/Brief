"""Business statuses and follows API. Every route needs a signed-in business.

    GET    /api/statuses/feed                      statuses from businesses I follow, grouped
    GET    /api/statuses/mine                      my live statuses with view counts
    POST   /api/statuses                           post text, a photo or a video
    DELETE /api/statuses/{id}                      remove my status
    POST   /api/statuses/{id}/view                 record that I saw one (followers only)
    GET    /api/statuses/{id}/viewers              who viewed my status (author only)
    GET    /api/statuses/radar                     quick counts for the Home radar
    GET    /api/statuses/suggestions               businesses worth following
    GET    /api/statuses/following                 businesses I follow
    GET    /api/statuses/follow/{vendor_id}        my follow state and their follower count
    POST   /api/statuses/follow/{vendor_id}       follow (201 new, 200 already following)
    DELETE /api/statuses/follow/{vendor_id}       unfollow (idempotent)
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.statuses import service
from app.modules.statuses.models import BusinessFollow
from app.routes.auth import get_current_vendor

router = APIRouter()


class StatusIn(BaseModel):
    kind: str = Field(..., max_length=10)
    body: Optional[str] = Field(None, max_length=600)  # the service enforces 500 after trimming
    media_url: Optional[str] = Field(None, max_length=600)


def _raise(exc: service.StatusError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


@router.get("/feed")
async def feed(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"groups": await service.feed(db, vendor)}


@router.get("/mine")
async def mine(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"statuses": await service.mine(db, vendor)}


@router.get("/radar")
async def radar(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.radar(db, vendor)


@router.post("", status_code=201)
async def post(body: StatusIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        status = await service.post_status(db, vendor, body.kind, body.body, body.media_url)
    except service.StatusError as exc:
        _raise(exc)
    await db.commit()
    return {"id": str(status.id), "expires_at": status.expires_at.isoformat()}


@router.delete("/{status_id}")
async def delete(status_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        await service.delete_status(db, vendor, status_id)
    except service.StatusError as exc:
        _raise(exc)
    await db.commit()
    return {"removed": True}


@router.post("/{status_id}/view")
async def view(status_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
               db: AsyncSession = Depends(get_db)):
    try:
        new = await service.mark_viewed(db, vendor, status_id)
    except service.StatusError as exc:
        _raise(exc)
    await db.commit()
    return {"viewed": True, "new": new}


@router.get("/{status_id}/viewers")
async def viewers(status_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        return {"viewers": await service.viewers(db, vendor, status_id)}
    except service.StatusError as exc:
        _raise(exc)


@router.get("/suggestions")
async def suggestions(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"businesses": await service.suggestions(db, vendor)}


@router.get("/following")
async def following(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    ids = await service.following_ids(db, vendor.id)
    if not ids:
        return {"businesses": []}
    rows = await db.execute(select(Vendor).where(Vendor.id.in_(ids)).order_by(Vendor.business_name))
    return {"businesses": [
        {"vendor_id": str(v.id), "handle": v.vendor_handle, "business_name": v.business_name}
        for v in rows.scalars().all()
    ]}


@router.get("/follow/{vendor_id}")
async def follow_state(vendor_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    return await service.follow_state(db, vendor, vendor_id)


@router.post("/follow/{vendor_id}")
async def follow(vendor_id: uuid.UUID, response: Response, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        created = await service.follow(db, vendor, vendor_id)
    except service.StatusError as exc:
        _raise(exc)
    await db.commit()
    response.status_code = 201 if created else 200
    return {"following": True, "created": created}


@router.delete("/follow/{vendor_id}")
async def unfollow(vendor_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    removed = await service.unfollow(db, vendor, vendor_id)
    await db.commit()
    return {"following": False, "removed": removed}

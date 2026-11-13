"""Event hub routes (Phase 8). Mounted at /api/event-hub.

Off by default: while EVENT_HUB_ENABLED is false, every route returns 404. The flag check is a
router-level dependency, so it runs before authentication.

    GET  /events/{id}/meeting-point      participants: label and Google Maps link
    PUT  /events/{id}/meeting-point      host: set the meeting point
    GET  /events/{id}/gallery            public: photos from this event
    POST /events/{id}/gallery            host: upload a photo (multipart, same pipeline as /api/files)
    GET  /hosts/{vendor_id}/gallery      public: a host's photos across their events
    GET  /events/{id}/messages           participants: the host–attendee thread
    POST /events/{id}/messages           participants: send a message
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.event_hub import service as svc
from app.routes.auth import get_current_vendor
from app.services.images import UnsupportedImage, prepare_image
from app.services.storage import StorageError, max_bytes, safe_filename, storage


def _enabled() -> None:
    if not settings.EVENT_HUB_ENABLED:
        raise HTTPException(404, "Not found")


router = APIRouter(dependencies=[Depends(_enabled)])


class MeetingPointIn(BaseModel):
    label: str = Field(..., min_length=2, max_length=200)
    maps_url: Optional[str] = Field(default=None, max_length=500)


class MessageIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)


async def store_photo(file: UploadFile) -> str:
    """The same checks and storage as /api/files/upload: type, size, image preparation, then store."""
    try:
        _, content_type = safe_filename(file.filename or "", file.content_type)
    except StorageError as exc:
        raise HTTPException(400, str(exc))
    limit = max_bytes()
    data = await file.read(limit * 10 + 1)
    if len(data) > limit * 10:
        raise HTTPException(413, f"File is larger than {limit * 10 // (1024 * 1024)} MB")
    if not data:
        raise HTTPException(400, "Empty file")
    try:
        data, stored_name, content_type = prepare_image(data, file.filename or "file", content_type, max_bytes=limit)
    except UnsupportedImage as exc:
        raise HTTPException(400, str(exc))
    try:
        return await storage.upload(data, stored_name, content_type)
    except StorageError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(503, f"Storage unavailable: {type(exc).__name__}")


def _meeting(row) -> Optional[dict]:
    if row is None:
        return None
    return {"label": row.label, "maps_url": row.maps_url, "updated_at": row.updated_at.isoformat()}


def _photo(p) -> dict:
    return {"id": str(p.id), "event_id": str(p.event_id), "image_url": p.image_url,
            "caption": p.caption, "created_at": p.created_at.isoformat()}


def _msg(m) -> dict:
    return {"id": str(m.id), "sender_vendor_id": str(m.sender_vendor_id) if m.sender_vendor_id else None,
            "body": m.body, "created_at": m.created_at.isoformat()}


@router.get("/events/{event_id}/meeting-point")
async def get_meeting_point(event_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                            db: AsyncSession = Depends(get_db)):
    return {"meeting_point": _meeting(await svc.get_meeting_point(db, vendor, event_id))}


@router.put("/events/{event_id}/meeting-point")
async def set_meeting_point(event_id: uuid.UUID, body: MeetingPointIn,
                            vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        row = await svc.set_meeting_point(db, vendor, event_id, label=body.label, maps_url=body.maps_url)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()
    return {"meeting_point": _meeting(row)}


@router.get("/events/{event_id}/gallery")
async def list_gallery(event_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return {"photos": [_photo(p) for p in await svc.list_event_gallery(db, event_id)]}


@router.post("/events/{event_id}/gallery", status_code=201)
async def add_photo(
    event_id: uuid.UUID,
    file: UploadFile = File(...),
    caption: Optional[str] = Form(default=None),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Host uploads a photo. It goes through the same image pipeline as every other upload."""
    # Check the host before reading the file, so a stranger's upload is refused at once.
    event = await svc._event(db, event_id)
    svc._require_organizer(event, vendor)
    url = await store_photo(file)
    try:
        row = await svc.add_gallery_item(db, vendor, event_id, image_url=url, caption=caption)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()
    return _photo(row)


@router.get("/hosts/{vendor_id}/gallery")
async def host_gallery(vendor_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    rows = await svc.list_host_gallery(db, vendor_id)
    return {"photos": [{**_photo(p), "event_title": title, "event_start": start.isoformat()}
                       for p, title, start in rows]}


@router.get("/events/{event_id}/messages")
async def list_messages(event_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    return {"messages": [_msg(m) for m in await svc.list_messages(db, vendor, event_id)]}


@router.post("/events/{event_id}/messages", status_code=201)
async def send_message(event_id: uuid.UUID, body: MessageIn, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        row = await svc.post_message(db, vendor, event_id, body.body)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()
    return _msg(row)

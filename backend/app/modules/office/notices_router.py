"""Home office noticeboard routes (Fluid Teams, PR 4). Mounted at /api/office/notices.

Off by default: while FLUID_TEAMS_ENABLED is false, every route returns 404. The flag check runs
before authentication.
"""

import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.office import notices as svc
from app.modules.office.service import OfficeError
from app.routes.auth import get_current_vendor


def _enabled() -> None:
    if not settings.FLUID_TEAMS_ENABLED:
        raise HTTPException(404, "Not found")


router = APIRouter(dependencies=[Depends(_enabled)])


class NoticeIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    body: str = Field(..., min_length=2, max_length=4000)
    # The whiteboard (0082). A sticky is family-shared, coloured, optionally
    # pinned, and may expire — the non-permanent markers, made literal.
    kind: Literal["notice", "sticky"] = "notice"
    colour: Literal["amber", "lime", "sky", "rose", "plain"] = "plain"
    pinned: bool = False
    expires_at: Optional[datetime] = None


class NoticeEdit(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=120)
    body: Optional[str] = Field(default=None, min_length=2, max_length=4000)


def _fail(exc: OfficeError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


def _out(n) -> dict:
    return {"id": str(n.id), "office_id": str(n.office_id), "title": n.title, "body": n.body,
            "kind": getattr(n, "kind", "notice"), "colour": getattr(n, "colour", "plain"),
            "pinned": bool(getattr(n, "pinned", False)),
            "expires_at": n.expires_at.isoformat() if getattr(n, "expires_at", None) else None,
            "author_vendor_id": str(n.author_vendor_id) if n.author_vendor_id else None,
            "created_at": n.created_at.isoformat(), "edited_at": n.edited_at.isoformat() if n.edited_at else None}


@router.get("/offices/{office_id}")
async def list_notices(office_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        rows = await svc.list_notices(db, vendor, office_id)
    except OfficeError as exc:
        _fail(exc)
    return {"notices": [_out(n) for n in rows]}


@router.post("/offices/{office_id}", status_code=201)
async def create(office_id: uuid.UUID, body: NoticeIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        row = await svc.create_notice(
            db, vendor, office_id, title=body.title, body=body.body,
            kind=body.kind, colour=body.colour, pinned=body.pinned,
            expires_at=body.expires_at,
        )
    except OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return _out(row)


@router.patch("/offices/{office_id}/{notice_id}")
async def edit(office_id: uuid.UUID, notice_id: uuid.UUID, body: NoticeEdit,
               vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        row = await svc.edit_notice(db, vendor, office_id, notice_id, title=body.title, body=body.body)
    except OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return _out(row)


@router.delete("/offices/{office_id}/{notice_id}", status_code=204)
async def delete(office_id: uuid.UUID, notice_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        await svc.delete_notice(db, vendor, office_id, notice_id)
    except OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return Response(status_code=204)

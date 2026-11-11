"""Workers API. Mounted at /api/workers. Every route needs sign-in.

    POST /api/workers/offices/{office_id}/assignments   assign work (owner or editor)
    GET  /api/workers/offices/{office_id}/assignments   all of an office's work (owner or editor)
    GET  /api/workers/mine                              my open work (active member only)
    GET  /api/workers/assignments/{id}                  one assignment (manager or assignee)
    POST /api/workers/assignments/{id}/start            begin (assignee)
    POST /api/workers/assignments/{id}/complete         finish (assignee or manager)
    POST /api/workers/assignments/{id}/cancel           cancel open work (manager)
    POST /api/workers/assignments/{id}/reassign         move open work to another member (manager)
    GET  /api/workers/assignments/{id}/history          who did what, when (manager or assignee)
"""

import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.workers import service as svc
from app.modules.workers.service import WorkError
from app.routes.auth import get_current_vendor

router = APIRouter()


class AssignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., min_length=2, max_length=200)
    details: Optional[str] = Field(default=None, max_length=2000)
    assignee_handle: str = Field(..., min_length=3, max_length=100)
    due_at: Optional[datetime] = None


class ReassignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignee_handle: str = Field(..., min_length=3, max_length=100)


def _fail(exc: WorkError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


def _office_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except (ValueError, TypeError):
        raise HTTPException(404, "That office was not found.")


async def _run(db: AsyncSession, coro):
    try:
        result = await coro
        await db.commit()
        return result
    except WorkError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/offices/{office_id}/assignments", status_code=201)
async def assign(office_id: str, body: AssignIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    return await _run(db, svc.create(db, vendor, _office_id(office_id), title=body.title,
                                     details=body.details, assignee_handle=body.assignee_handle,
                                     due_at=body.due_at))


@router.get("/offices/{office_id}/assignments")
async def office_work(office_id: str, status: Optional[str] = Query(None),
                      vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"items": await _run(db, svc.list_for_office(db, vendor, _office_id(office_id), status))}


@router.get("/mine")
async def my_work(include_done: bool = Query(False), vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    return {"items": await _run(db, svc.mine(db, vendor, include_done))}


@router.get("/assignments/{assignment_id}")
async def one(assignment_id: str, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await _run(db, svc.get(db, vendor, assignment_id))


@router.post("/assignments/{assignment_id}/start")
async def start(assignment_id: str, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await _run(db, svc.start(db, vendor, assignment_id))


@router.post("/assignments/{assignment_id}/complete")
async def complete(assignment_id: str, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    return await _run(db, svc.complete(db, vendor, assignment_id))


@router.post("/assignments/{assignment_id}/cancel")
async def cancel(assignment_id: str, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await _run(db, svc.cancel(db, vendor, assignment_id))


@router.post("/assignments/{assignment_id}/reassign")
async def reassign(assignment_id: str, body: ReassignIn, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    return await _run(db, svc.reassign(db, vendor, assignment_id, body.assignee_handle))


@router.get("/assignments/{assignment_id}/history")
async def history(assignment_id: str, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    return {"items": await _run(db, svc.history(db, vendor, assignment_id))}

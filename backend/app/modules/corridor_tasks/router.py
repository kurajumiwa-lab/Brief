"""Work-From-Home task board API. Mounted at /api/tasks.

Signed in:
    POST /api/tasks                       post a task (commission + fee snapshot)
    GET  /api/tasks/board                 open tasks in a region, next 7 days
    GET  /api/tasks/inbox                 the Inbox week strip + my task rows
    GET  /api/tasks/mine                  tasks I posted, tasks I claimed, fee ledger
    POST /api/tasks/{id}/claim            atomic claim, +4h hold
    POST /api/tasks/{id}/proof            worker submits proof and payout tag
    POST /api/tasks/{id}/approve          poster approves and sees the payment tag
    POST /api/tasks/{id}/dispute          either party records a problem
    POST /api/tasks/{id}/withdraw         poster withdraws an open/claimed task
"""

import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.corridor_tasks import service as svc
from app.routes.auth import get_current_vendor

router = APIRouter()


class TaskIn(BaseModel):
    task_type: str = Field(..., max_length=32)
    title: str = Field(..., max_length=140)
    instructions: str = Field(..., max_length=4000)
    region_slug: str = Field(..., max_length=64, pattern=r"^[a-z0-9-]+$")
    town: str = Field(..., max_length=64)
    scheduled_date: date
    due_at: datetime
    worker_payout_kes: float = Field(..., gt=0, le=100000)
    min_standing_level: int = Field(default=2, ge=1, le=4)


class ProofIn(BaseModel):
    handoff_code: Optional[str] = Field(default=None, max_length=16)
    photo_url: Optional[str] = Field(default=None, max_length=500)
    mpesa_note: Optional[str] = Field(default=None, max_length=500)
    note: Optional[str] = Field(default=None, max_length=1000)
    payout_tag: dict


class NoteIn(BaseModel):
    note: str = Field(..., max_length=1000)


def _fail(exc: svc.TaskError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


async def _row(db, task_id, viewer):
    """The single-task shape, with the same visibility rules as the list."""
    from sqlalchemy import select
    from app.modules.corridor_tasks.models import CorridorTask

    task = (await db.execute(select(CorridorTask).where(CorridorTask.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, "That task was not found.")
    if viewer.id not in (task.creator_user_id, task.assignee_user_id):
        raise HTTPException(403, "Only the poster or the assigned worker can see this task.")
    level = await svc._standing_level(db, viewer)
    rows = await svc.hydrate(db, [task], viewer, level)
    return rows[0]


@router.post("", status_code=201)
async def create_task(body: TaskIn, vendor: Vendor = Depends(get_current_vendor),
                      db: AsyncSession = Depends(get_db)):
    try:
        task = await svc.create_task(
            db, vendor, task_type=body.task_type, region_slug=body.region_slug,
            town=body.town, title=body.title, instructions=body.instructions,
            payout=body.worker_payout_kes, scheduled_date=body.scheduled_date,
            due_at=body.due_at, min_standing_level=body.min_standing_level,
        )
        await db.commit()
    except svc.TaskError as exc:
        await db.rollback()
        _fail(exc)
    await db.refresh(task)
    return await _row(db, task.id, vendor)


@router.get("/board")
async def board(region_slug: Optional[str] = Query(None, max_length=64),
                town: Optional[str] = Query(None, max_length=64),
                days: int = Query(7, ge=1, le=30),
                vendor: Vendor = Depends(get_current_vendor),
                db: AsyncSession = Depends(get_db)):
    result = await svc.board(db, vendor, region_slug=region_slug, town=town, days=days)
    await db.commit()
    return result


@router.get("/inbox")
async def inbox(days: int = Query(7, ge=1, le=30),
                vendor: Vendor = Depends(get_current_vendor),
                db: AsyncSession = Depends(get_db)):
    result = await svc.inbox(db, vendor, days=days)
    await db.commit()
    return result


@router.get("/mine")
async def mine(vendor: Vendor = Depends(get_current_vendor),
               db: AsyncSession = Depends(get_db)):
    result = await svc.mine(db, vendor)
    await db.commit()
    return result


@router.post("/{task_id}/claim")
async def claim(task_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                db: AsyncSession = Depends(get_db)):
    try:
        await svc.claim(db, vendor, task_id)
        await db.commit()
    except svc.TaskError as exc:
        await db.rollback()
        _fail(exc)
    return await _row(db, task_id, vendor)


@router.post("/{task_id}/proof")
async def submit_proof(task_id: uuid.UUID, body: ProofIn,
                       vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        await svc.submit_proof(
            db, vendor, task_id, handoff_code_value=body.handoff_code,
            photo_url=body.photo_url, mpesa_note=body.mpesa_note,
            note=body.note, payout_tag=body.payout_tag,
        )
        await db.commit()
    except svc.TaskError as exc:
        await db.rollback()
        _fail(exc)
    return await _row(db, task_id, vendor)


@router.post("/{task_id}/approve")
async def approve(task_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        result = await svc.approve_and_pay(db, vendor, task_id)
        await db.commit()
    except svc.TaskError as exc:
        await db.rollback()
        _fail(exc)
    task = result["task"]
    await db.refresh(task)
    return {
        "task": await _row(db, task_id, vendor),
        "payment_tag": result["payment_tag"],
        "fee_recorded": result["fee_recorded"],
        "fee_already_recorded": result.get("fee_already_recorded", False),
        "payment_instruction": (
            "Send the payout directly to this M-Pesa tag, then record it as paid. "
            "The platform never holds the money."
        ),
    }


@router.post("/{task_id}/dispute")
async def dispute(task_id: uuid.UUID, body: NoteIn,
                  vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        await svc.dispute(db, vendor, task_id, body.note)
        await db.commit()
    except svc.TaskError as exc:
        await db.rollback()
        _fail(exc)
    return await _row(db, task_id, vendor)


@router.post("/{task_id}/withdraw")
async def withdraw(task_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    try:
        await svc.cancel(db, vendor, task_id)
        await db.commit()
    except svc.TaskError as exc:
        await db.rollback()
        _fail(exc)
    return await _row(db, task_id, vendor)

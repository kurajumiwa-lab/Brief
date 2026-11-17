"""Recurring hustle routines API. Mounted at /api/routines.

Signed in:
    GET    /api/routines                 my routines and this week's share prompts
    POST   /api/routines                 create a routine (the Repeat Weekly switch)
    PATCH  /api/routines/{id}            edit, pause or resume
    DELETE /api/routines/{id}            remove (published rounds stay live)
    POST   /api/routines/{id}/publish    publish this week's instance now
    POST   /api/routines/instances/{id}/shared   remember a WhatsApp share
"""

import uuid
from datetime import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.routines import service as svc
from app.modules.routines.models import RecurringRoutine
from app.routes.auth import get_current_vendor

router = APIRouter()


class RoutineIn(BaseModel):
    kind: str = Field(default="scheduled", max_length=24)
    title: str = Field(..., max_length=140)
    region_slug: str = Field(..., max_length=64, pattern=r"^[a-z0-9-]+$")
    town: str = Field(..., max_length=64)
    day_of_week: int = Field(..., ge=0, le=6)
    start_time_local: str = Field(..., max_length=8)   # "09:30"
    duration_hours: int = Field(default=6, ge=1, le=72)
    publish_lead_hours: int = Field(default=48, ge=0, le=336)
    is_active: bool = True
    template_payload: dict = Field(default_factory=dict)


class RoutinePatch(BaseModel):
    kind: Optional[str] = Field(default=None, max_length=24)
    title: Optional[str] = Field(default=None, max_length=140)
    region_slug: Optional[str] = Field(default=None, max_length=64, pattern=r"^[a-z0-9-]+$")
    town: Optional[str] = Field(default=None, max_length=64)
    day_of_week: Optional[int] = Field(default=None, ge=0, le=6)
    start_time_local: Optional[str] = Field(default=None, max_length=8)
    duration_hours: Optional[int] = Field(default=None, ge=1, le=72)
    publish_lead_hours: Optional[int] = Field(default=None, ge=0, le=336)
    is_active: Optional[bool] = None
    template_payload: Optional[dict] = None


def _fail(exc: svc.RoutineError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


def _fields(body) -> dict:
    data = body.model_dump(exclude_unset=True) if hasattr(body, "model_dump") else dict(body)
    if data.get("start_time_local") is not None and isinstance(data["start_time_local"], str):
        try:
            data["start_time_local"] = time.fromisoformat(data["start_time_local"])
        except ValueError:
            raise HTTPException(422, "Start time must look like 09:30.")
    return data


@router.get("")
async def mine(vendor: Vendor = Depends(get_current_vendor),
               db: AsyncSession = Depends(get_db)):
    return await svc.mine(db, vendor)


@router.post("", status_code=201)
async def create(body: RoutineIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        clean = svc.validate_routine(
            kind=body.kind, title=body.title, region_slug=body.region_slug, town=body.town,
            day_of_week=body.day_of_week, start_time_local=_fields(body)["start_time_local"],
            duration_hours=body.duration_hours, publish_lead_hours=body.publish_lead_hours,
            template_payload=body.template_payload,
        )
        routine = RecurringRoutine(owner_user_id=vendor.id, is_active=body.is_active, **clean)
        db.add(routine)
        await db.commit()
    except svc.RoutineError as exc:
        await db.rollback()
        _fail(exc)
    return svc.routine_out(routine)


@router.patch("/{routine_id}")
async def update(routine_id: uuid.UUID, body: RoutinePatch,
                 vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    routine = (await db.execute(
        select(RecurringRoutine).where(RecurringRoutine.id == routine_id)
        .with_for_update()
    )).scalar_one_or_none()
    if routine is None or routine.owner_user_id != vendor.id:
        raise HTTPException(404, "That routine was not found.")
    supplied = _fields(body)
    merged = {
        "kind": supplied.get("kind", routine.kind),
        "title": supplied.get("title", routine.title),
        "region_slug": supplied.get("region_slug", routine.region_slug),
        "town": supplied.get("town", routine.town),
        "day_of_week": supplied.get("day_of_week", routine.day_of_week),
        "start_time_local": supplied.get("start_time_local", routine.start_time_local),
        "duration_hours": supplied.get("duration_hours", routine.duration_hours),
        "publish_lead_hours": supplied.get("publish_lead_hours", routine.publish_lead_hours),
        "template_payload": supplied.get("template_payload", routine.template_payload or {}),
    }
    try:
        clean = svc.validate_routine(**merged)
    except svc.RoutineError as exc:
        await db.rollback()
        _fail(exc)
    for key, value in clean.items():
        setattr(routine, key, value)
    if supplied.get("is_active") is not None:
        routine.is_active = bool(supplied["is_active"])
    await db.commit()
    return svc.routine_out(routine)


@router.delete("/{routine_id}", status_code=204)
async def remove(routine_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    routine = (await db.execute(
        select(RecurringRoutine).where(RecurringRoutine.id == routine_id)
    )).scalar_one_or_none()
    if routine is None or routine.owner_user_id != vendor.id:
        raise HTTPException(404, "That routine was not found.")
    # Published activity rows stay live; the foreign key nulls their link.
    await db.execute(delete(RecurringRoutine).where(RecurringRoutine.id == routine.id))
    await db.commit()
    return None


@router.post("/{routine_id}/publish")
async def publish(routine_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        result = await svc.publish_now(db, vendor, routine_id)
        await db.commit()
    except svc.RoutineError as exc:
        await db.rollback()
        _fail(exc)
    return result


@router.post("/instances/{instance_id}/shared")
async def shared(instance_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        result = await svc.mark_shared(db, vendor, instance_id)
        await db.commit()
    except svc.RoutineError as exc:
        await db.rollback()
        _fail(exc)
    return result

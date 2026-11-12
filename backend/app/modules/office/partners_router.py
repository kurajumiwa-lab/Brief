"""Fluid Teams routes (Phase 7, PR 3). Mounted at /api/office/partners.

Off by default: while FLUID_TEAMS_ENABLED is false, every route returns 404. The flag check is a
router-level dependency, so it runs before authentication.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.office import partners as svc
from app.modules.office.service import OfficeError
from app.routes.auth import get_current_vendor


def _enabled() -> None:
    if not settings.FLUID_TEAMS_ENABLED:
        raise HTTPException(404, "Not found")


router = APIRouter(dependencies=[Depends(_enabled)])


class PartnerInviteIn(BaseModel):
    office_id: uuid.UUID
    partner_office_id: uuid.UUID


class PartnerAnswerIn(BaseModel):
    accept: bool


def _fail(exc: OfficeError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


def _out(row) -> dict:
    return {"link_id": str(row.id), "office_id": str(row.office_id),
            "partner_office_id": str(row.partner_office_id), "status": row.status}


@router.post("/invites", status_code=201)
async def invite(body: PartnerInviteIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        row = await svc.invite_partner(db, vendor, body.office_id, body.partner_office_id)
    except OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return _out(row)


@router.post("/{link_id}/answer")
async def answer(link_id: uuid.UUID, body: PartnerAnswerIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        row = await svc.respond_partner(db, vendor, link_id, body.accept)
    except OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return _out(row)


@router.delete("/{link_id}", status_code=204)
async def end(link_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
              db: AsyncSession = Depends(get_db)):
    try:
        await svc.end_partner(db, vendor, link_id)
    except OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return Response(status_code=204)


@router.get("/offices/{office_id}")
async def list_for_office(office_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                          db: AsyncSession = Depends(get_db)):
    try:
        return await svc.list_partners(db, vendor, office_id)
    except OfficeError as exc:
        _fail(exc)

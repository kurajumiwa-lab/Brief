"""Home office API. Mounted at /api/office.

Signed in:
    POST /api/office/offices                         create a home office (one person is enough)
    GET  /api/office/offices/mine                    offices I belong to
    GET  /api/office/offices/{id}                    detail for members: members, events
    POST /api/office/offices/{id}/invites/account    invite a registered profile by handle
    POST /api/office/offices/{id}/invites/link       make a single-use link for someone without an account
    POST /api/office/offices/{id}/invites/respond    accept or decline my pending invite
    DELETE /api/office/offices/{id}/members/{mid}    owner removes a member
    POST /api/office/offices/{id}/events             owner or editor adds an event
    GET  /api/office/offices/{id}/events             members read the calendar
    GET  /api/office/offices/{id}/calendar.ics       members download the calendar file

Public (no login):
    GET  /api/office/public/offices/{id}             name, nature, area, hours, and contact only if chosen
    POST /api/office/links/accept                    use a link once; the token is the proof
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.office import service as svc
from app.modules.office.models import CONTACT_MODES, ROLES
from app.routes.auth import get_current_vendor

router = APIRouter()
public = APIRouter()


class OfficeIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    nature: str = Field(..., min_length=2, max_length=120)
    area: str = Field(..., min_length=2, max_length=120)
    hours_text: Optional[str] = Field(None, max_length=200)
    contact_mode: str = Field("none", max_length=8)


class AccountInviteIn(BaseModel):
    handle: str = Field(..., min_length=2, max_length=100)
    role: str = Field(..., max_length=12)


class LinkInviteIn(BaseModel):
    role: str = Field(..., max_length=12)
    function_label: str = Field(..., min_length=2, max_length=80)


class RespondIn(BaseModel):
    accept: bool


class LinkAcceptIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=120)
    display_name: str = Field(..., min_length=2, max_length=60)


class EventIn(BaseModel):
    activity: str = Field(..., min_length=2, max_length=80)
    title: str = Field(..., min_length=2, max_length=160)
    starts_at: datetime
    ends_at: datetime
    location_text: Optional[str] = Field(None, max_length=200)


def _fail(exc: svc.OfficeError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


def _event_out(e) -> dict:
    return {"id": str(e.id), "activity": e.activity, "title": e.title,
            "starts_at": e.starts_at.isoformat(), "ends_at": e.ends_at.isoformat(),
            "location_text": e.location_text}


# ── signed in ─────────────────────────────────────────────────────────────────

@router.post("/offices", status_code=201)
async def create(body: OfficeIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        office = await svc.create_office(db, vendor, name=body.name, nature=body.nature, area=body.area,
                                         hours_text=body.hours_text, contact_mode=body.contact_mode)
    except svc.OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return svc.office_summary(office, "owner")


@router.get("/offices/mine")
async def mine(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"offices": await svc.my_offices(db, vendor)}


@router.get("/offices/{office_id}")
async def detail(office_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        office = await svc.get_office(db, office_id)
        me = await svc.require_active(db, office_id, vendor)
    except svc.OfficeError as exc:
        _fail(exc)
    events = await svc.events_of(db, vendor, office_id)
    return {**svc.office_summary(office, me.role), "members": await svc.members_of(db, office_id),
            "events": [_event_out(e) for e in events], "roles": list(ROLES), "contact_modes": list(CONTACT_MODES)}


@router.post("/offices/{office_id}/invites/account", status_code=201)
async def invite_account(office_id: uuid.UUID, body: AccountInviteIn, vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    try:
        m = await svc.invite_account(db, vendor, office_id, handle=body.handle, role=body.role)
    except svc.OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {"member_id": str(m.id), "status": m.status, "role": m.role,
            "detail": "Invite sent. The person must accept before they join."}


@router.post("/offices/{office_id}/invites/link", status_code=201)
async def invite_link(office_id: uuid.UUID, body: LinkInviteIn, vendor: Vendor = Depends(get_current_vendor),
                      db: AsyncSession = Depends(get_db)):
    try:
        token, expires = await svc.create_link(db, vendor, office_id, role=body.role, function_label=body.function_label)
    except svc.OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {"token": token, "expires_at": expires.isoformat(),
            "path": f"/office/join/{token}",
            "detail": "Share this link once. It works one time and expires in seven days."}


@router.post("/offices/{office_id}/invites/respond")
async def respond(office_id: uuid.UUID, body: RespondIn, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        out = await svc.respond_invite(db, vendor, office_id, accept=body.accept)
    except svc.OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return out


@router.delete("/offices/{office_id}/members/{member_id}", status_code=204)
async def remove(office_id: uuid.UUID, member_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        await svc.remove_member(db, vendor, office_id, member_id)
    except svc.OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return Response(status_code=204)


@router.post("/offices/{office_id}/events", status_code=201)
async def add_event(office_id: uuid.UUID, body: EventIn, vendor: Vendor = Depends(get_current_vendor),
                    db: AsyncSession = Depends(get_db)):
    try:
        ev = await svc.add_event(db, vendor, office_id, activity=body.activity, title=body.title,
                                 starts_at=body.starts_at, ends_at=body.ends_at, location_text=body.location_text)
    except svc.OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return _event_out(ev)


@router.get("/offices/{office_id}/events")
async def list_events(office_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        events = await svc.events_of(db, vendor, office_id)
    except svc.OfficeError as exc:
        _fail(exc)
    return {"events": [_event_out(e) for e in events]}


@router.get("/offices/{office_id}/calendar.ics")
async def calendar(office_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        office = await svc.get_office(db, office_id)
        events = await svc.events_of(db, vendor, office_id)
    except svc.OfficeError as exc:
        _fail(exc)
    return Response(content=svc.ics_for(office, events), media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="{office.name[:40]}.ics"'})


# ── public ────────────────────────────────────────────────────────────────────

@public.get("/public/offices/{office_id}")
async def public_profile(office_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    try:
        return await svc.public_office(db, office_id)
    except svc.OfficeError as exc:
        _fail(exc)


@public.post("/links/accept", status_code=201)
async def accept_link(body: LinkAcceptIn, db: AsyncSession = Depends(get_db)):
    try:
        out = await svc.accept_link(db, body.token, body.display_name)
    except svc.OfficeError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return out

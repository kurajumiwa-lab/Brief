"""Hiring API. Mounted at /api/hiring.

Public read (no account needed to see a job):
    GET   /api/hiring/board                      open broadcasts, newest first
    GET   /api/hiring/broadcasts/{id}            one broadcast

Signed in:
    POST  /api/hiring/broadcasts                 post a job (free for a direct employer)
    POST  /api/hiring/broadcasts/{id}/apply      apply (?via=CODE). Free, always.
    POST  /api/hiring/applications/{id}/status   shortlist | reject | hire
    POST  /api/hiring/applications/{id}/confirm  employer's second signal → payable
    POST  /api/hiring/applications/{id}/checkin  the hiree's start check-in → payable
    POST  /api/hiring/claims/{id}/settle         record a DIRECT payment reference
    POST  /api/hiring/claims/{id}/void           the hire fell through, with a reason
    GET   /api/hiring/mine                       my broadcasts, applications and claims

Price-gathering rewards (a paid task, never wages):
    GET   /api/hiring/rewards/today              what a full day pays here today
    POST  /api/hiring/rewards                    assess one work day (?accepted, ?town)
    POST  /api/hiring/rewards/{id}/paid          record the DIRECT payment reference
    GET   /api/hiring/rewards/mine               my days, accrued and paid

There is no endpoint, and no field on any endpoint, that takes money from the
person applying. That is the product's promise and the schema's shape.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.hiring import rewards, service
from app.modules.hiring.rewards import RewardError
from app.modules.hiring.service import HiringError
from app.platform.security import vendor_id_from_token
from app.routes.auth import get_current_vendor

router = APIRouter()
public = APIRouter()


class BroadcastIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role_title: str = Field(..., min_length=3, max_length=160)
    role_summary: str = Field(..., min_length=20, max_length=4000)
    employer_name: str = Field(..., min_length=2, max_length=160)
    poster_kind: Literal["direct", "agency", "aggregator"] = "direct"
    town: Optional[str] = Field(default=None, max_length=80)
    region_slug: Optional[str] = Field(default=None, max_length=64, pattern=r"^[a-z0-9-]+$")
    salary_kes: Optional[StrictInt] = Field(default=None, ge=0, le=10_000_000)
    salary_unit: Optional[Literal["month", "day", "week", "job"]] = None
    contact_note: Optional[str] = Field(default=None, max_length=300)


class ApplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cover_note: Optional[str] = Field(default=None, max_length=1000)
    via: Optional[str] = Field(default=None, max_length=16)


class StatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["shortlisted", "rejected", "hired"]


class SettleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payment_reference: str = Field(..., min_length=3, max_length=120)


class VoidIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=10, max_length=300)


def _fail(exc: HiringError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


@public.get("/board")
async def board(
    region_slug: Optional[str] = Query(None, max_length=64),
    town: Optional[str] = Query(None, max_length=80),
    limit: int = Query(40, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await service.board(db, region_slug=region_slug, town=town, limit=limit)


async def _optional_viewer(request: Request, db: AsyncSession) -> Optional[Vendor]:
    """The reader, if they are signed in. A job is public; the applicant list is not.

    The board and the detail page must stay readable with no account — that is
    what makes a vacancy checkable by anyone. But the poster needs to see who
    applied, so the same public route answers differently when it recognises the
    person asking, and `mine` is computed from that identity rather than guessed
    on the client.
    """
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    vid = vendor_id_from_token(header[7:])
    if not vid:
        return None
    return await db.get(Vendor, vid)


@public.get("/broadcasts/{broadcast_id}")
async def one_broadcast(broadcast_id: str, request: Request,
                        db: AsyncSession = Depends(get_db)):
    try:
        viewer = await _optional_viewer(request, db)
        return await service.broadcast(db, broadcast_id, viewer=viewer)
    except HiringError as exc:
        _fail(exc)


@router.post("/broadcasts", status_code=201)
async def post_broadcast(body: BroadcastIn, vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    try:
        row = await service.post(db, vendor, body.model_dump(exclude_unset=True))
        out = await service.broadcast(db, str(row.id), viewer=vendor)
        await db.commit()
    except HiringError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/broadcasts/{broadcast_id}/apply", status_code=201)
async def apply(broadcast_id: str, body: ApplyIn, vendor: Vendor = Depends(get_current_vendor),
                db: AsyncSession = Depends(get_db)):
    try:
        row = await service.apply(db, vendor, broadcast_id,
                                  cover_note=body.cover_note, via=body.via)
        out = {"id": str(row.id), "status": row.status, "attributed_via": row.attributed_via,
               "free_to_apply": True}
        await db.commit()
    except HiringError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/applications/{application_id}/status")
async def set_status(application_id: str, body: StatusIn,
                     vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    try:
        out = await service.mark(db, vendor, application_id, body.status)
        await db.commit()
    except HiringError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/applications/{application_id}/confirm")
async def confirm(application_id: str, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        out = await service.confirm(db, vendor, application_id)
        await db.commit()
    except HiringError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/applications/{application_id}/checkin")
async def checkin(application_id: str, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        out = await service.hiree_checkin(db, vendor, application_id)
        await db.commit()
    except HiringError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/claims/{claim_id}/settle")
async def settle(claim_id: str, body: SettleIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        out = await service.settle(db, vendor, claim_id, body.payment_reference)
        await db.commit()
    except HiringError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/claims/{claim_id}/void")
async def void(claim_id: str, body: VoidIn, vendor: Vendor = Depends(get_current_vendor),
               db: AsyncSession = Depends(get_db)):
    try:
        out = await service.void(db, vendor, claim_id, body.reason)
        await db.commit()
    except HiringError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.get("/mine")
async def mine(vendor: Vendor = Depends(get_current_vendor),
               db: AsyncSession = Depends(get_db)):
    return await service.mine(db, vendor)


# ── the receipt game: a task reward, not wages ────────────────────────────────

class RewardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accepted: StrictInt = Field(..., ge=0, le=500)
    town: Optional[str] = Field(default=None, max_length=80)
    day: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    rejected: Optional[list[dict]] = None


@public.get("/rewards/today")
async def rewards_today(town: Optional[str] = Query(None, max_length=80),
                        db: AsyncSession = Depends(get_db)):
    """Published before the work starts, so nobody is paid less afterwards."""
    from datetime import date as _date
    return await rewards.pool_rate(db, town, day=_date.today())


@router.post("/rewards", status_code=201)
async def assess_reward(body: RewardIn, vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    from datetime import date as _date
    day = _date.fromisoformat(body.day) if body.day else _date.today()
    try:
        row = await rewards.assess(db, vendor=vendor, accepted=body.accepted,
                                   town=body.town, day=day, rejected=body.rejected)
        out = rewards.reward_out(row)
        await db.commit()
    except RewardError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc))
    return out


@router.post("/rewards/{reward_id}/paid")
async def reward_paid(reward_id: str, body: SettleIn,
                      vendor: Vendor = Depends(get_current_vendor),
                      db: AsyncSession = Depends(get_db)):
    try:
        out = await rewards.settle(db, vendor, reward_id, body.payment_reference)
        await db.commit()
    except RewardError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=str(exc))
    return out


@router.get("/rewards/mine")
async def my_rewards(vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    return await rewards.mine(db, vendor)

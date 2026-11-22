"""Merit API. Mounted at /api/merit.

Public (a page's trust ticker is readable before anyone signs up):
    GET   /api/merit/public/{handle}              score, tier, breakdown, streak
    GET   /api/merit/public/{handle}/ticker       the last 30 daily readings
    GET   /api/merit/public/{handle}/endorsements who vouched, and what they said
    GET   /api/merit/leaderboard                  best records in the network

Signed in:
    GET   /api/merit/me                           my score, with what to fix
    POST  /api/merit/endorsements                 vouch for a business, in writing
    DELETE /api/merit/endorsements/{id}           withdraw a vouch
    POST  /api/merit/mentorships                  Blue Chip takes a newcomer on
    GET   /api/merit/mentorships                  mine, both directions
    POST  /api/merit/mentorships/{id}/milestones  the mentee hit something real
    GET   /api/merit/concierge                    what the tier unlocks, honestly
    GET   /api/merit/report                       the bank-ready Pattern Report

There is no route that sets a score, sells a score, or pays anything out. The
report is the only thing that leaves the building, and it leaves in the
business's own hands.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.merit import rules, service
from app.modules.merit.rules import MeritError
from app.routes.auth import get_current_vendor

from sqlalchemy import text

router = APIRouter()
public = APIRouter()

# ── schema guard ────────────────────────────────────────────────────────────
# Merit needs `merit_snapshots`, `trust_endorsements` and `mentorships`, added by
# migration 0083. Production was still on 0057 when this module shipped, so a
# request here raised `UndefinedTable` and surfaced as a 500 — an error page
# rather than an honest "not available yet". `require_schema` turns the missing
# table into 503 with the migration named, which is the difference between "this
# is broken" and "this has not been switched on".
_MERIT_TABLES = ("merit_snapshots", "trust_endorsements", "mentorships")


async def require_schema(db: AsyncSession = Depends(get_db)) -> None:
    missing = [t for t in _MERIT_TABLES if not await _table_exists(db, t)]
    if missing:
        raise HTTPException(
            status_code=503,
            detail=(
                "Merit is not enabled on this database yet: "
                f"{', '.join(missing)} missing. Apply migration 0083_merit."
            ),
        )


async def _table_exists(db: AsyncSession, name: str) -> bool:
    # `to_regclass` returns NULL rather than raising, which is why this is a
    # probe and not a try/except around a real query.
    result = await db.execute(text("SELECT to_regclass(:n) IS NOT NULL"), {"n": f"public.{name}"})
    return bool(result.scalar())



class EndorseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    handle: str = Field(..., min_length=2, max_length=100)
    reason: str = Field(..., min_length=10, max_length=2000)
    context: Optional[str] = Field(default=None, max_length=160)


class MentorshipIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    handle: str = Field(..., min_length=2, max_length=100)
    note: Optional[str] = Field(default=None, max_length=300)


class MilestoneIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    milestone: Literal["first_month_active", "first_paid_work", "first_receipt"]


def _fail(exc: MeritError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


async def _by_handle(db: AsyncSession, handle: str) -> Vendor:
    vendor = (await db.execute(
        select(Vendor).where(Vendor.vendor_handle == handle.lstrip("@").lower())
    )).scalar_one_or_none()
    if vendor is None:
        raise HTTPException(status_code=404, detail="No business with that handle.")
    return vendor


# ── public ───────────────────────────────────────────────────────────────────

@public.get("/{handle}", dependencies=[Depends(require_schema)])
async def public_card(handle: str, db: AsyncSession = Depends(get_db)):
    """A page's trust card. Public, because a claim nobody can check is a boast."""
    vendor = await _by_handle(db, handle)
    out = await service.card(db, vendor)
    await db.commit()
    return out


@public.get("/{handle}/ticker", dependencies=[Depends(require_schema)])
async def public_ticker(handle: str, days: int = Query(30, ge=1, le=180),
                        db: AsyncSession = Depends(get_db)):
    vendor = await _by_handle(db, handle)
    return await service.ticker(db, vendor.id, days=days)


@public.get("/{handle}/endorsements", dependencies=[Depends(require_schema)])
async def public_endorsements(handle: str, db: AsyncSession = Depends(get_db)):
    vendor = await _by_handle(db, handle)
    return await service.endorsements_for(db, vendor.id)


@public.get("/leaderboard/records", dependencies=[Depends(require_schema)])
async def public_leaderboard(limit: int = Query(10, ge=1, le=50),
                             db: AsyncSession = Depends(get_db)):
    return await service.leaderboard(db, limit=limit)


# ── the owner's own ──────────────────────────────────────────────────────────

@router.get("/me", dependencies=[Depends(require_schema)])
async def my_card(vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    out = await service.card(db, vendor)
    await db.commit()
    return out


@router.post("/endorsements", status_code=201, dependencies=[Depends(require_schema)])
async def endorse(body: EndorseIn, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        row = await service.endorse(db, vendor, handle=body.handle,
                                    reason=body.reason, context=body.context)
        await db.commit()
    except MeritError as exc:
        await db.rollback()
        _fail(exc)
    return {
        "id": str(row.id), "weight": row.weight,
        "endorser_score_at_the_time": row.endorser_score,
        "note": "An endorsement is worth what your own record is worth. It is not money.",
    }


@router.delete("/endorsements/{endorsement_id}", dependencies=[Depends(require_schema)])
async def withdraw(endorsement_id: str, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    try:
        row = await service.withdraw_endorsement(db, vendor, endorsement_id)
        await db.commit()
    except MeritError as exc:
        await db.rollback()
        _fail(exc)
    return {"id": str(row.id), "status": row.status}


@router.post("/mentorships", status_code=201, dependencies=[Depends(require_schema)])
async def start_mentorship(body: MentorshipIn,
                           vendor: Vendor = Depends(get_current_vendor),
                           db: AsyncSession = Depends(get_db)):
    try:
        row = await service.start_mentorship(db, vendor, handle=body.handle, note=body.note)
        await db.commit()
    except MeritError as exc:
        await db.rollback()
        _fail(exc)
    return {
        "id": str(row.id), "status": row.status,
        "note": ("You are now mentoring this business. Record a milestone only when "
                 "something has actually happened."),
    }


@router.get("/mentorships", dependencies=[Depends(require_schema)])
async def my_mentorships(vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    return await service.my_mentorships(db, vendor)


@router.post("/mentorships/{mentorship_id}/milestones", dependencies=[Depends(require_schema)])
async def milestone(mentorship_id: str, body: MilestoneIn,
                    vendor: Vendor = Depends(get_current_vendor),
                    db: AsyncSession = Depends(get_db)):
    try:
        out = await service.record_milestone(db, vendor, mentorship_id, body.milestone)
        await db.commit()
    except MeritError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.get("/concierge", dependencies=[Depends(require_schema)])
async def concierge(vendor: Vendor = Depends(get_current_vendor),
                    db: AsyncSession = Depends(get_db)):
    return await service.concierge(db, vendor)


@router.get("/report", dependencies=[Depends(require_schema)])
async def report(vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    """The Pattern Report. Yours to hand to whoever you choose.

    Brief sends it nowhere and speaks to no lender on your behalf. That is what
    keeps this a record and not a credit decision.
    """
    return await service.pattern_report(db, vendor)

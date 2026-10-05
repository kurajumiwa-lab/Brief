"""Hustle League routes — Call-up → Contract → Match → Reward → Upgrade.

    GET  /api/squad/me                          the player card (all derived)
    GET  /api/squad/job-calls?mine=1            open call-ups / my posted
    POST /api/squad/job-calls                   post a call-up (min-wage guard)
    POST /api/squad/job-calls/{id}/accept       accept → contract (+OTP)
    POST /api/squad/contracts/{id}/start        start the match
    POST /api/squad/contracts/{id}/complete     proof: OTP (+photo)
    POST /api/squad/contracts/{id}/confirm      client confirms + rates → pay
    POST /api/squad/contracts/{id}/cancel       cancel (before it's done)
    POST /api/squad/contracts/{id}/rate-client  two-way ratings
    GET  /api/squad/league?month=               monthly standings (real XP)
    POST /api/squad/squads                      form a squad
    POST /api/squad/squads/{id}/invite          invite by @handle
    POST /api/squad/squads/{id}/accept          accept an invite
    POST /api/squad/squads/{id}/leave           leave
    GET  /api/squad/squads/mine                 my squad + members

Every reward written here is a ledger row or a contract field. Cash is the
agreed pay recorded on the contract (paid by the client by mobile money on
this deployment, which has no PSP float — the contract is the audit trail).
"""

import math
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.hustle import HustleContract, HustleJobCall, HustleSquad, HustleSquadMember
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import hustle
from app.services.hustle import (
    DAILY_SAFE_LIMIT, TIER_ORDER, XP_RATING_BONUS,
)

router = APIRouter()

SQD = "squad"


# ── Schemas ──────────────────────────────────────────────────────────────────
class CallCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    task_type: str = Field(min_length=2, max_length=40)
    skill: str = Field(min_length=2, max_length=40)
    required_tier: str = "common"
    pay_kes: int = Field(ge=50, le=200_000)
    location: Optional[str] = Field(default=None, max_length=500)
    geo_lat: Optional[float] = None
    geo_lng: Optional[float] = None
    squad_id: Optional[UUID] = None
    expires_in_hours: int = Field(default=24, ge=1, le=168)


class ContractComplete(BaseModel):
    otp: str = Field(min_length=6, max_length=6)
    photo_url: Optional[str] = Field(default=None, max_length=500)


class ContractConfirm(BaseModel):
    rating: int = Field(ge=1, le=5)
    note: Optional[str] = Field(default=None, max_length=300)


class RateClient(BaseModel):
    stars: int = Field(ge=1, le=5)


class CancelBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)


class SquadCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class SquadInvite(BaseModel):
    handle: str = Field(min_length=2, max_length=80)


# ── Helpers ──────────────────────────────────────────────────────────────────
def _gen_otp() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(6))


async def _call_out(db: AsyncSession, call: HustleJobCall, me: Vendor, lat: Optional[float] = None, lng: Optional[float] = None) -> dict:
    client = await db.get(Vendor, call.vendor_id)
    contract_res = await db.execute(
        select(HustleContract).where(HustleContract.job_call_id == call.id)
    )
    contract = contract_res.scalars().first()
    worker_name = None
    if contract:
        worker = await db.get(Vendor, contract.player_vendor_id)
        worker_name = worker.business_name if worker else None
    distance = None
    if lat is not None and lng is not None and call.geo_lat is not None and call.geo_lng is not None:
        d = _dist_km(lat, lng, call.geo_lat, call.geo_lng)
        distance = round(d, 1) if d is not None else None
    return {
        "id": str(call.id),
        "title": call.title,
        "task_type": call.task_type,
        "skill": call.skill,
        "required_tier": call.required_tier,
        "pay_kes": call.pay_kes,
        "location": call.location,
        "geo_lat": call.geo_lat,
        "geo_lng": call.geo_lng,
        "squad_id": str(call.squad_id) if call.squad_id else None,
        "expires_at": call.expires_at.isoformat(),
        "status": call.status,
        "mine": call.vendor_id == me.id,
        "client": client.business_name if client else "A client",
        "distance_km": distance,
        # The OTP is shown ONLY to the client once someone has accepted.
        "otp": call.otp_code if (call.vendor_id == me.id and call.otp_code) else None,
        "worker": worker_name,
        "contract_id": str(contract.id) if contract else None,
    }


def _masked_phone(phone) -> str | None:
    if not phone:
        return None
    p = phone.strip()
    if len(p) <= 6:
        return p[:2] + "•••"
    return p[:5] + "•" * (len(p) - 7) + p[-2:]


def _dist_km(lat1, lng1, lat2, lng2):
    """Great-circle distance, or None when either point is unknown."""
    if None in (lat1, lng1, lat2, lng2):
        return None
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


async def _contract_out(db: AsyncSession, c: HustleContract, me: Vendor) -> dict:
    call = await db.get(HustleJobCall, c.job_call_id)
    player = await db.get(Vendor, c.player_vendor_id)
    client = await db.get(Vendor, c.vendor_id) if call else None
    # The payout, stated plainly the moment it exists: how much, how it moves,
    # to whose number, and when it was recorded. "direct" on this deployment
    # means the client settles the agreed KES by mobile money and this
    # contract is the record — never a receipt the app invented.
    payout = None
    if c.status == "completed":
        payout = {
            "amount_kes": c.agreed_pay_kes,
            "method": "M-Pesa / mobile money (client settles directly)",
            "status": c.payout_status,
            "to": _masked_phone(player.phone if player else None),
            "recorded_at": c.completed_at.isoformat() if c.completed_at else None,
            "ref": c.payout_ref,
        }
    return {
        "id": str(c.id),
        "job_call_id": str(c.job_call_id),
        "title": call.title if call else None,
        "skill": call.skill if call else None,
        "location": call.location if call else None,
        "pay_kes": c.agreed_pay_kes,
        "status": c.status,
        "otp_verified": c.otp_verified,
        "proof_photo_url": c.proof_photo_url,
        "client_rating": c.client_rating,
        "client_note": c.client_note,
        "worker_client_rating": c.worker_client_rating,
        "xp_earned": c.xp_earned,
        "gold_earned": c.gold_earned,
        "payout": payout,
        "payout_status": c.payout_status,
        "accepted_at": c.accepted_at.isoformat(),
        "started_at": c.started_at.isoformat() if c.started_at else None,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "i_am_player": c.player_vendor_id == me.id,
        "i_am_client": bool(call and call.vendor_id == me.id),
        "player_name": player.business_name if player else "—",
        "client_name": client.business_name if client else "—",
        "otp": call.otp_code if (call and call.vendor_id == me.id and call.otp_code) else None,
    }


def _skill_tier_of(snap: dict, skill: str) -> str:
    for c in snap["cards"]:
        if c["skill"] == skill:
            return c["tier"]
    return "common"


# ── Me ───────────────────────────────────────────────────────────────────────
@router.get("/me")
async def squad_me(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    snap = await hustle.player_snapshot(db, vendor)
    active = await hustle._active_contract(db, vendor.id)
    if active:
        snap["active_contract"] = await _contract_out(db, active, vendor)
    return snap


@router.get("/recent")
async def recent_wins(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    """My last completed matches — the 'reward' side of the loop, from rows."""
    res = await db.execute(
        select(HustleContract, HustleJobCall)
        .join(HustleJobCall, HustleJobCall.id == HustleContract.job_call_id)
        .where(HustleContract.status == "completed",
               HustleContract.player_vendor_id == vendor.id)
        .order_by(HustleContract.completed_at.desc())
        .limit(5)
    )
    wins = []
    for c, call in res.all():
        wins.append({
            "id": str(c.id),
            "title": call.title,
            "skill": call.skill,
            "pay_kes": c.agreed_pay_kes,
            "xp_earned": c.xp_earned,
            "gold_earned": c.gold_earned,
            "client_rating": c.client_rating,
            "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        })
    return {"wins": wins}


# ── Job calls (call-ups) ─────────────────────────────────────────────────────
@router.get("/job-calls")
async def list_calls(
    mine: bool = False,
    skill: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: float = Query(10, ge=1, le=100),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    # The distance origin: explicit coordinates if sent, else the caller's
    # own location — so distances show without the client having to ask.
    olat = lat if lat is not None else vendor.geo_lat
    olng = lng if lng is not None else vendor.geo_lng
    if mine:
        stmt = select(HustleJobCall).where(HustleJobCall.vendor_id == vendor.id)
        rows_res = await db.execute(stmt.order_by(HustleJobCall.created_at.desc()).limit(50))
        rows = rows_res.scalars().all()
    else:
        now = datetime.utcnow()
        stmt = select(HustleJobCall).where(HustleJobCall.status == "open", HustleJobCall.expires_at >= now)
        if skill:
            stmt = stmt.where(HustleJobCall.skill == skill)
        stmt = stmt.where(HustleJobCall.vendor_id != vendor.id)  # never match your own call
        rows_res = await db.execute(stmt.order_by(HustleJobCall.expires_at.asc()).limit(50))
        rows = rows_res.scalars().all()
        if olat is not None and olng is not None:
            def dist(call):
                d = _dist_km(olat, olng, call.geo_lat, call.geo_lng)
                return 1e9 if d is None else d
            rows = sorted(rows, key=dist)
            rows = [r for r in rows if dist(r) <= radius_km] or rows  # empty radius keeps the list honest
    return {"calls": [await _call_out(db, c, vendor, olat, olng) for c in rows]}


@router.post("/job-calls", status_code=201)
async def post_call(body: CallCreate, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    if body.skill not in hustle.SKILLS:
        raise HTTPException(400, f"Unknown skill. One of: {', '.join(hustle.SKILLS)}")
    if body.required_tier not in TIER_ORDER:
        raise HTTPException(400, f"Tier must be one of {', '.join(TIER_ORDER)}")
    floor = hustle.SKILLS[body.skill]["min_wage_kes"]
    if body.pay_kes < floor:
        raise HTTPException(400, f"{hustle.SKILLS[body.skill]['label']} tasks pay at least KES {floor} on this network")
    if body.squad_id:
        squad = await db.get(HustleSquad, body.squad_id)
        if not squad or squad.status != "active":
            raise HTTPException(404, "Squad not found")
        is_member = (await db.execute(
            select(HustleSquadMember.id).where(HustleSquadMember.squad_id == body.squad_id,
                                               HustleSquadMember.vendor_id == vendor.id).limit(1)
        )).first()
        if not is_member:
            raise HTTPException(403, "Only the squad (or its clients) can post squad missions")
    call = HustleJobCall(
        vendor_id=vendor.id, title=body.title.strip(), task_type=body.task_type.strip().lower(),
        skill=body.skill, required_tier=body.required_tier, pay_kes=body.pay_kes,
        location=body.location, geo_lat=body.geo_lat, geo_lng=body.geo_lng,
        squad_id=body.squad_id, status="open",
        expires_at=datetime.utcnow() + timedelta(hours=body.expires_in_hours),
    )
    db.add(call)
    await db.commit()
    await db.refresh(call)
    return await _call_out(db, call, vendor)


@router.post("/job-calls/{call_id}/accept", status_code=201)
async def accept_call(call_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    call = await db.get(HustleJobCall, call_id)
    if not call or call.status != "open":
        raise HTTPException(404, "That call-up is no longer open")
    if call.expires_at < datetime.utcnow():
        raise HTTPException(409, "That call-up expired")
    if call.vendor_id == vendor.id:
        raise HTTPException(400, "You cannot take your own call-up")
    if call.squad_id:
        is_member = (await db.execute(
            select(HustleSquadMember.id).where(HustleSquadMember.squad_id == call.squad_id,
                                               HustleSquadMember.vendor_id == vendor.id).limit(1)
        )).first()
        if not is_member:
            raise HTTPException(403, "This is a squad mission — only squad members can take it")
    # Energy + one-live-contract model.
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    started_today = (await db.execute(
        select(func.count(HustleContract.id)).where(HustleContract.player_vendor_id == vendor.id,
                                                    HustleContract.started_at >= today)
    )).scalar() or 0
    if started_today >= DAILY_SAFE_LIMIT:
        raise HTTPException(409, "You've reached today's safe limit — rest up, the league is not going anywhere")
    if await hustle._active_contract(db, vendor.id):
        raise HTTPException(409, "Finish your current contract first — one match at a time")
    snap = await hustle.player_snapshot(db, vendor)
    if TIER_ORDER.index(_skill_tier_of(snap, call.skill)) < TIER_ORDER.index(call.required_tier):
        raise HTTPException(403, f"This contract needs a {call.required_tier} {call.skill} card — keep completing {call.skill} tasks to rise")

    call.otp_code = _gen_otp()
    call.status = "contracted"
    call.updated_at = datetime.utcnow()
    contract = HustleContract(
        job_call_id=call.id, player_vendor_id=vendor.id,
        agreed_pay_kes=call.pay_kes, status="accepted",
    )
    db.add(contract)
    await db.commit()
    await db.refresh(contract)
    return await _contract_out(db, contract, vendor)


# ── Contracts (the match) ────────────────────────────────────────────────────
@router.post("/contracts/{contract_id}/start")
async def start_contract(contract_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    c = await db.get(HustleContract, contract_id)
    if not c or c.player_vendor_id != vendor.id:
        raise HTTPException(404, "Contract not found")
    if c.status != "accepted":
        raise HTTPException(409, f"Contract is {c.status}, not accepted")
    c.status = "in_progress"
    c.started_at = datetime.utcnow()
    call = await db.get(HustleJobCall, c.job_call_id)
    if call:
        call.status = "in_progress"
        call.updated_at = datetime.utcnow()
    await db.commit()
    return await _contract_out(db, c, vendor)


@router.post("/contracts/{contract_id}/complete")
async def complete_contract(contract_id: UUID, body: ContractComplete,
                            vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    c = await db.get(HustleContract, contract_id)
    if not c or c.player_vendor_id != vendor.id:
        raise HTTPException(404, "Contract not found")
    if c.status not in ("accepted", "in_progress"):
        raise HTTPException(409, f"Contract is {c.status}")
    call = await db.get(HustleJobCall, c.job_call_id)
    if not call or not call.otp_code or body.otp.strip() != call.otp_code:
        raise HTTPException(400, "That code is not the client's — ask them for the one shown on their call-up")
    c.otp_verified = True
    c.proof_photo_url = body.photo_url
    if not c.started_at:
        c.started_at = datetime.utcnow()
    c.status = "proof_pending"
    call.status = "proof_pending"
    call.updated_at = datetime.utcnow()
    await db.commit()
    return await _contract_out(db, c, vendor)


@router.post("/contracts/{contract_id}/confirm")
async def confirm_contract(contract_id: UUID, body: ContractConfirm,
                           vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    """The client's side of the finish: they confirm the work and rate it.
    This is the moment the match is won — and the moment the rewards are
    written, for real, to real rows."""
    c = await db.get(HustleContract, contract_id)
    if not c:
        raise HTTPException(404, "Contract not found")
    call = await db.get(HustleJobCall, c.job_call_id)
    if not call or call.vendor_id != vendor.id:
        raise HTTPException(404, "Only the client can confirm this contract")
    if c.status != "proof_pending":
        raise HTTPException(409, f"Contract is {c.status}, not awaiting confirmation")
    if not c.otp_verified:
        raise HTTPException(409, "The worker's proof code was never verified")

    # Was this the client's FIRST completed business? Counted from rows before
    # this one is written — the "first business" moment is real, not scripted.
    prior = (await db.execute(
        select(func.count(HustleContract.id)).join(
            HustleJobCall, HustleJobCall.id == HustleContract.job_call_id
        ).where(
            HustleJobCall.vendor_id == vendor.id,
            HustleContract.status == "completed",
        )
    )).scalar() or 0
    first_business = prior == 0

    c.client_rating = body.rating
    c.client_note = body.note
    c.status = "completed"
    c.completed_at = datetime.utcnow()
    c.xp_earned = max(0, c.agreed_pay_kes // 10) + (XP_RATING_BONUS if body.rating >= 4 else 0)
    # Cash: this deployment has no PSP float, so the contract records the
    # agreed pay the client settles by mobile money. With a PSP configured,
    # this is where a real disbursement is queued (payout_status/ ref).
    c.payout_status = "direct"
    c.payout_ref = f"agreed:{c.agreed_pay_kes}"
    call.status = "completed"
    call.updated_at = datetime.utcnow()
    await db.flush()
    reward = await hustle.award_on_completion(db, c)
    await db.commit()
    out = {
        **(await _contract_out(db, c, vendor)),
        "reward": {"xp": c.xp_earned, "gold": reward["gold"], "squad_split": reward["squad_split"]},
        "first_business": first_business,
        "note": "The worker is paid the agreed KES by mobile money — this contract is the record.",
    }
    if first_business:
        out["first_business_note"] = (
            f"That was your first settled business on this network: KES {c.agreed_pay_kes} to "
            f"{player_name if (player_name := (await db.get(Vendor, c.player_vendor_id)).vendor_handle) else 'the worker'}. "
            "The contract is kept as the record."
        )
    return out


@router.post("/contracts/{contract_id}/rate-client")
async def rate_client(contract_id: UUID, body: RateClient,
                      vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    c = await db.get(HustleContract, contract_id)
    if not c or c.player_vendor_id != vendor.id or c.status != "completed":
        raise HTTPException(404, "You can rate the client once the match is completed")
    c.worker_client_rating = body.stars
    await db.commit()
    return {"rated": True, "stars": body.stars}


@router.post("/contracts/{contract_id}/cancel")
async def cancel_contract(contract_id: UUID, body: CancelBody,
                          vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    c = await db.get(HustleContract, contract_id)
    if not c:
        raise HTTPException(404, "Contract not found")
    call = await db.get(HustleJobCall, c.job_call_id)
    is_client = call and call.vendor_id == vendor.id
    is_player = c.player_vendor_id == vendor.id
    if not (is_client or is_player):
        raise HTTPException(403, "Only the two sides can cancel")
    if c.status not in ("accepted", "in_progress"):
        raise HTTPException(409, f"Contract is {c.status}")
    c.status = "cancelled"
    c.cancel_reason = body.reason
    if call and call.status in ("contracted", "in_progress"):
        call.status = "open"  # the call-up goes back on the market for others
        call.otp_code = None
        call.updated_at = datetime.utcnow()
    await db.commit()
    return {"cancelled": True}


# ── League ───────────────────────────────────────────────────────────────────
@router.get("/league")
async def league(
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Monthly standings: points = XP from matches completed in the month.
    All derived from completed contracts — there is no points column to
    inflate."""
    m = month or hustle.month_key(datetime.utcnow())
    y, mo = int(m[:4]), int(m[5:7])
    start = datetime(y, mo, 1)
    end = datetime(y + 1, 1, 1) if mo == 12 else datetime(y, mo + 1, 1)
    rows = (await db.execute(
        select(
            HustleContract.player_vendor_id,
            func.sum(HustleContract.xp_earned).label("points"),
            func.count(HustleContract.id).label("matches"),
            func.avg(HustleContract.client_rating).label("avg_rating"),
        ).where(
            HustleContract.status == "completed",
            HustleContract.completed_at >= start,
            HustleContract.completed_at < end,
        ).group_by(HustleContract.player_vendor_id).order_by(func.sum(HustleContract.xp_earned).desc()).limit(50)
    )).all()
    standings = []
    player_ids = [r.player_vendor_id for r in rows]
    vendor_rows = (await db.execute(select(Vendor).where(Vendor.id.in_(player_ids)))).scalars().all() if player_ids else []
    vendors_by_id = {v.id: v for v in vendor_rows}
    lifetime_rows = (await db.execute(
        select(HustleContract.player_vendor_id, func.coalesce(func.sum(HustleContract.xp_earned), 0)).where(
            HustleContract.status == "completed",
            HustleContract.player_vendor_id.in_(player_ids),
        ).group_by(HustleContract.player_vendor_id)
    )).all() if player_ids else []
    lifetime_by_id = {r.player_vendor_id: int(r[1]) for r in lifetime_rows}
    for i, r in enumerate(rows, start=1):
        v = vendors_by_id.get(r.player_vendor_id)
        standings.append({
            "rank": i,
            "name": v.business_name if v else "—",
            "handle": v.vendor_handle if v else None,
            "points": int(r.points or 0),
            "matches": int(r.matches or 0),
            "avg_rating": round(float(r.avg_rating), 2) if r.avg_rating else None,
            "division": hustle._division_for(lifetime_by_id.get(r.player_vendor_id, 0)),
            "me": r.player_vendor_id == vendor.id,
        })
    return {"month": m, "standings": standings}


# ── Squads ───────────────────────────────────────────────────────────────────
async def _squad_out(db: AsyncSession, squad: HustleSquad, me: Vendor) -> dict:
    members = (await db.execute(
        select(HustleSquadMember).where(HustleSquadMember.squad_id == squad.id).order_by(HustleSquadMember.joined_at)
    )).scalars().all()
    out_members = []
    for m in members:
        v = await db.get(Vendor, m.vendor_id)
        out_members.append({
            "vendor_id": str(m.vendor_id), "name": v.business_name if v else "—",
            "handle": v.vendor_handle if v else None, "role": m.role,
            "split_pct": m.split_pct, "me": m.vendor_id == me.id,
        })
    missions = (await db.execute(
        select(func.count(HustleJobCall.id)).where(HustleJobCall.squad_id == squad.id)
    )).scalar() or 0
    completed_m = (await db.execute(
        select(func.count(HustleContract.id)).where(
            HustleContract.status == "completed",
            HustleContract.job_call_id.in_(select(HustleJobCall.id).where(HustleJobCall.squad_id == squad.id)),
        )
    )).scalar() or 0
    return {
        "id": str(squad.id), "name": squad.name, "status": squad.status,
        "captain": str(squad.captain_vendor_id),
        "member_count": len(out_members),
        "members": out_members,
        "missions_posted": missions,
        "missions_completed": completed_m,
        "i_am_member": any(m["me"] for m in out_members),
    }


@router.post("/squads", status_code=201)
async def create_squad(body: SquadCreate, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    squad = HustleSquad(name=body.name.strip(), captain_vendor_id=vendor.id)
    db.add(squad)
    await db.flush()
    db.add(HustleSquadMember(squad_id=squad.id, vendor_id=vendor.id, role="captain", split_pct=20))
    await db.commit()
    await db.refresh(squad)
    return await _squad_out(db, squad, vendor)


@router.post("/squads/{squad_id}/invite")
async def invite_squad(squad_id: UUID, body: SquadInvite, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    squad = await db.get(HustleSquad, squad_id)
    if not squad or squad.status != "active":
        raise HTTPException(404, "Squad not found")
    count = (await db.execute(select(func.count(HustleSquadMember.id)).where(HustleSquadMember.squad_id == squad_id))).scalar() or 0
    if count >= 10:
        raise HTTPException(409, "Squads hold 10 — the best team size for splitting work")
    target = (await db.execute(select(Vendor).where(Vendor.vendor_handle == body.handle.strip().lstrip("@")))).scalars().first()
    if not target:
        raise HTTPException(404, f"No vendor with handle @{body.handle.strip().lstrip('@')}")
    if target.id == vendor.id:
        raise HTTPException(400, "You're already in your own squad")
    exists = (await db.execute(
        select(HustleSquadMember.id).where(HustleSquadMember.squad_id == squad_id,
                                           HustleSquadMember.vendor_id == target.id).limit(1)
    )).first()
    if exists:
        raise HTTPException(409, "They're already in this squad")
    db.add(HustleSquadMember(squad_id=squad_id, vendor_id=target.id, role="member", split_pct=10))
    await db.commit()
    return {"invited": target.vendor_handle, "squad_id": str(squad.id)}


@router.post("/squads/{squad_id}/accept")
async def accept_squad(squad_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    squad = await db.get(HustleSquad, squad_id)
    if not squad:
        raise HTTPException(404, "Squad not found")
    exists = (await db.execute(
        select(HustleSquadMember.id).where(HustleSquadMember.squad_id == squad_id,
                                           HustleSquadMember.vendor_id == vendor.id).limit(1)
    )).first()
    if not exists:
        raise HTTPException(404, "You are not in this squad")
    return {"accepted": True, "squad": await _squad_out(db, squad, vendor)}


@router.post("/squads/{squad_id}/leave")
async def leave_squad(squad_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    squad = await db.get(HustleSquad, squad_id)
    if not squad:
        raise HTTPException(404, "Squad not found")
    m = (await db.execute(
        select(HustleSquadMember).where(HustleSquadMember.squad_id == squad_id,
                                        HustleSquadMember.vendor_id == vendor.id)
    )).scalars().first()
    if not m:
        raise HTTPException(409, "You are not in this squad")
    if m.role == "captain":
        others = (await db.execute(
            select(HustleSquadMember).where(HustleSquadMember.squad_id == squad_id).limit(2)
        )).scalars().all()
        if len(others) <= 1:
            raise HTTPException(409, "You are the only member — the squad disbands if you leave")
        # Captaincy passes to the next-oldest member.
        nxt = [o for o in others if o.vendor_id != vendor.id][0]
        nxt.role = "captain"
        squad.captain_vendor_id = nxt.vendor_id
    db.delete(m)
    remaining = (await db.execute(select(func.count(HustleSquadMember.id)).where(HustleSquadMember.squad_id == squad_id))).scalar() or 0
    if remaining == 0:
        squad.status = "disbanded"
    await db.commit()
    return {"left": True, "disbanded": squad.status == "disbanded"}


@router.get("/squads/mine")
async def my_squad(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(HustleSquadMember, HustleSquad).join(
            HustleSquad, HustleSquadMember.squad_id == HustleSquad.id
        ).where(HustleSquadMember.vendor_id == vendor.id)
    )).all()
    out = []
    for _m, squad in rows:
        if squad.status == "active":
            out.append(await _squad_out(db, squad, vendor))
    return {"squads": out}

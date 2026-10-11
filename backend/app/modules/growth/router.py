"""HTTP adapter for the Business Planner, Live Business Pulse, 5-Gear Resources Motion & Plan Entitlements (v2.12).

    GET    /api/growth/blueprint        inverted pyramid, plans, verified marks, rules & 6-month rollout
    GET    /api/growth/pulse            live DB-backed Business Pulse & 5-Gear Resources Motion
    PUT    /api/growth/plan             switch subscription tier (starter | readiness | network | institution)
    GET    /api/growth/seats            active team seats + server-side seat entitlement usage
    POST   /api/growth/seats            invite a team seat (enforces plan_seats_limit)
    DELETE /api/growth/seats/{seat_id}  revoke a team seat
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.growth import rules, service
from app.routes.auth import get_current_vendor

router = APIRouter()


class PlanChangeIn(BaseModel):
    plan_tier: str = Field(..., min_length=2, max_length=24)


class SeatInviteIn(BaseModel):
    member_email: str = Field(..., min_length=3, max_length=255)
    role: str = Field("clerk", min_length=3, max_length=24)
    member_handle: Optional[str] = Field(None, max_length=100)


@router.get("/blueprint")
async def get_growth_blueprint(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Full Business Planner view: Inverted Pyramid layers, Freemium/Premium
    tiers, Verified Marks families, Hard-Coded Business Rules, Six-Month
    Rollout Plan and live Business Pulse."""
    return await service.growth_blueprint(db, vendor)


@router.get("/pulse")
async def get_live_pulse(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Database-backed Business Pulse and 5-Gear Resources Motion counters."""
    return await service.live_pulse(db, vendor)


@router.put("/plan")
async def update_plan(
    body: PlanChangeIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Change subscription plan and server-side seat/watch entitlements.
    Paid plans never automatically verify a vendor or approve compliance claims."""
    try:
        return await service.change_plan(db, vendor, body.plan_tier)
    except rules.GrowthRuleError as exc:
        raise HTTPException(exc.status, str(exc))


@router.get("/seats")
async def list_seats(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.seat_usage(db, vendor)


@router.post("/seats", status_code=201)
async def add_seat(
    body: SeatInviteIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.add_seat(
            db, vendor,
            member_email=body.member_email,
            role=body.role,
            member_handle=body.member_handle,
        )
    except rules.GrowthRuleError as exc:
        raise HTTPException(exc.status, str(exc))


@router.delete("/seats/{seat_id}")
async def remove_seat(
    seat_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.revoke_seat(db, vendor, seat_id)
    except rules.GrowthRuleError as exc:
        raise HTTPException(exc.status, str(exc))

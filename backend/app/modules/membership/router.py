"""HTTP surface for membership.

    GET  /api/membership/categories                       the category list
    GET  /api/membership/me                               my profile and status
    PUT  /api/membership/me                               edit my profile and privacy
    POST /api/membership/me/verification                  ask for verified status
    GET  /api/membership/me/events                        my membership history
    GET  /api/membership/directory                        searchable member directory
    GET  /api/membership/admin/queue                      operator: members by verification state
    POST /api/membership/admin/{vendor_id}/verification   operator: approve or reject
    POST /api/membership/admin/{vendor_id}/status         operator: suspend or reinstate
    GET  /api/membership/admin/{vendor_id}/events         operator: audit trail
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.membership import service
from app.modules.membership.rules import CATEGORIES
from app.routes.auth import get_current_vendor
from app.routes.ops import require_operator

router = APIRouter()


class ProfileIn(BaseModel):
    display_name: Optional[str] = Field(None, max_length=120)
    category: Optional[str] = Field(None, max_length=32)
    professional_class: Optional[str] = Field(None, max_length=120)
    bio: Optional[str] = Field(None, max_length=2000)
    directory_visible: Optional[bool] = None
    show_contact: Optional[bool] = None


class DecisionIn(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject)$")
    note: Optional[str] = Field(None, max_length=500)


class StatusIn(BaseModel):
    status: str = Field(..., pattern="^(active|suspended)$")
    note: Optional[str] = Field(None, max_length=500)


def _raise(exc: service.MembershipError):
    raise HTTPException(exc.status, str(exc))


@router.get("/categories")
async def categories():
    return [{"key": k, "label": label} for k, label in CATEGORIES]


@router.get("/me")
async def my_profile(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    p = await service.get_or_create_profile(db, vendor)
    await db.commit()
    return service.profile_out(p, vendor)


@router.put("/me")
async def update_me(body: ProfileIn, vendor: Vendor = Depends(get_current_vendor),
                    db: AsyncSession = Depends(get_db)):
    changes = body.model_dump(exclude_unset=True)
    try:
        p = await service.update_profile(db, vendor, changes)
    except service.MembershipError as exc:
        _raise(exc)
    await db.commit()
    return service.profile_out(p, vendor)


@router.post("/me/verification", status_code=201)
async def ask_verification(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        p = await service.request_verification(db, vendor)
    except service.MembershipError as exc:
        _raise(exc)
    await db.commit()
    return service.profile_out(p, vendor)


@router.get("/me/events")
async def my_events(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.member_events(db, vendor.id)


@router.get("/directory")
async def directory(
    q: Optional[str] = Query(None, max_length=120),
    category: Optional[str] = Query(None, max_length=32),
    verified_only: bool = False,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.search_directory(db, q=q, category=category, verified_only=verified_only)
    except service.MembershipError as exc:
        _raise(exc)


@router.get("/admin/queue")
async def admin_queue(status: Optional[str] = Query(None, pattern="^(unverified|pending|verified|rejected)$"),
                      staff: Vendor = Depends(require_operator), db: AsyncSession = Depends(get_db)):
    return await service.admin_queue(db, status)


@router.post("/admin/{vendor_id}/verification")
async def decide(vendor_id: uuid.UUID, body: DecisionIn, staff: Vendor = Depends(require_operator),
                 db: AsyncSession = Depends(get_db)):
    try:
        p = await service.decide_verification(db, staff, vendor_id, body.decision, body.note)
    except service.MembershipError as exc:
        _raise(exc)
    await db.commit()
    return {"verification_status": p.verification_status}


@router.post("/admin/{vendor_id}/status")
async def set_status(vendor_id: uuid.UUID, body: StatusIn, staff: Vendor = Depends(require_operator),
                     db: AsyncSession = Depends(get_db)):
    try:
        p = await service.set_membership_status(db, staff, vendor_id, body.status, body.note)
    except service.MembershipError as exc:
        _raise(exc)
    await db.commit()
    return {"membership_status": p.membership_status}


@router.get("/admin/{vendor_id}/events")
async def admin_events(vendor_id: uuid.UUID, staff: Vendor = Depends(require_operator),
                       db: AsyncSession = Depends(get_db)):
    return await service.member_events(db, vendor_id)

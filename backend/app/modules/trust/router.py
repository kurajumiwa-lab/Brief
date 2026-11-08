"""MarketTrust API. Mounted at /api/trust.

Public (no login, GET only):
    GET  /api/trust/public/branches                 active branches, filter by country or nearby
    GET  /api/trust/public/branches/{id}            one branch with its reputation
    GET  /api/trust/public/branches/{id}/reviews    published reviews
    GET  /api/trust/public/businesses/{vendor_id}/reputation

Signed in (a business account):
    POST /api/trust/branches                        add a branch (pending until verified)
    GET  /api/trust/branches/mine                   my branches and their status
    PUT  /api/trust/branches/{id}/delivery          owner: pick-up, and/or a rider the buyer knows
    POST /api/trust/branches/{id}/tokens            owner: issue a one-time code for the till
    POST /api/trust/branches/{id}/reviews           rate a branch; optional `transaction_token`
    GET  /api/trust/points                          my points balance and history (not money)
    GET  /api/trust/services                        services redeemable for points (empty until approved)
    POST /api/trust/points/redeem                   exchange points for a service (Idempotency-Key)

Brief staff only:
    GET  /api/trust/admin/branches?status=pending   shops waiting for a check (or active)
    POST /api/trust/admin/branches/{id}/verifications
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.trust import catalogue
from app.modules.trust import service as svc
from app.routes.auth import get_current_vendor
from app.routes.governance import require_governance_ops

router = APIRouter()
public = APIRouter()

NO_MONEY_NOTE = "Points are not money. They have no cash value and cannot be withdrawn."


class BranchIn(BaseModel):
    country: str = Field(..., min_length=2, max_length=2)
    branch_name: str = Field(..., min_length=2, max_length=120)
    address_text: str = Field(..., min_length=5, max_length=300)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


class DeliveryIn(BaseModel):
    options: list[str] = Field(..., min_length=1, max_length=4)
    area: Optional[str] = Field(None, max_length=120)
    rider_name: Optional[str] = Field(None, max_length=60)
    rider_phone: Optional[str] = Field(None, max_length=24)


class IssueTokenIn(BaseModel):
    receipt_ref: str = Field(..., min_length=3, max_length=40)


class CustomerReviewIn(BaseModel):
    transaction_code: str = Field(..., min_length=4, max_length=40)
    service_rating: int = Field(..., ge=1, le=5)
    product_rating: int = Field(..., ge=1, le=5)
    overall_rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=500)


class ProfileIn(BaseModel):
    display_name: Optional[str] = Field(None, max_length=40)


class ModerationIn(BaseModel):
    action: str = Field(..., max_length=12)
    reason: str = Field(..., max_length=500)


class ReviewIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    transaction_token: Optional[str] = Field(None, max_length=40)


class VerificationIn(BaseModel):
    method: str = Field(..., max_length=30)
    result: str = Field(..., max_length=12)
    note: Optional[str] = Field(None, max_length=500)


class RedeemIn(BaseModel):
    service_key: str = Field(..., max_length=60)
    country: str = Field(..., min_length=2, max_length=2)


def _fail(db_error: svc.TrustError):
    raise HTTPException(status_code=db_error.status, detail=str(db_error))


def _branch_out(b) -> dict:
    return {
        "id": str(b.id), "vendor_id": str(b.vendor_id), "country_code": b.country_code,
        "branch_name": b.branch_name, "address_text": b.address_text,
        "latitude": float(b.latitude) if b.latitude is not None else None,
        "longitude": float(b.longitude) if b.longitude is not None else None,
        "status": b.status, "verification_level": b.verification_level,
        "delivery": svc.delivery_out(b),
    }


def _review_out(r, names: dict | None = None) -> dict:
    name = (names or {}).get(str(r.review_identity_id)) if r.review_identity_id else None
    return {
        "id": str(r.id), "overall": r.rating, "service": r.service_rating, "product": r.product_rating,
        "evidence_tier": r.evidence_tier, "comment": r.comment,
        "reviewer": name or ("Verified customer" if r.review_identity_id else "Business"),
        "created_at": r.created_at.isoformat(),
    }


# ── public ────────────────────────────────────────────────────────────────────

@public.get("/branches")
async def public_branches(
    country: Optional[str] = Query(None, min_length=2, max_length=2),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    radius_m: int = Query(5000, ge=100, le=50000),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    try:
        rows = await svc.public_branches(db, country=country, lat=lat, lng=lng, radius_m=radius_m, limit=limit)
    except svc.TrustError as exc:
        _fail(exc)
    out = []
    for b in rows:
        out.append({**_branch_out(b), "reputation": await svc.branch_reputation(db, b.id)})
    return {"branches": out}


@public.get("/branches/{branch_id}")
async def public_branch(branch_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    try:
        branch = await svc.get_branch(db, branch_id)
    except svc.TrustError as exc:
        _fail(exc)
    if branch.status != "active":
        raise HTTPException(404, "That branch is not public.")
    return {"branch": _branch_out(branch), "reputation": await svc.branch_reputation(db, branch.id)}


@public.get("/branches/{branch_id}/reviews")
async def public_branch_reviews(branch_id: uuid.UUID, verified_only: bool = False,
                                db: AsyncSession = Depends(get_db)):
    try:
        branch = await svc.get_branch(db, branch_id)
    except svc.TrustError as exc:
        _fail(exc)
    if branch.status != "active":
        raise HTTPException(404, "That branch is not public.")
    rows = await svc.branch_reviews(db, branch.id, verified_only=verified_only)
    names = await svc.display_names(db, rows)
    return {"reviews": [_review_out(r, names) for r in rows]}


@public.get("/businesses/{vendor_id}/reputation")
async def public_business_reputation(vendor_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await svc.business_reputation(db, vendor_id)


# ── signed in ─────────────────────────────────────────────────────────────────

@router.post("/branches", status_code=201)
async def add_branch(body: BranchIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        branch = await svc.add_branch(db, vendor, country=body.country, branch_name=body.branch_name,
                                      address_text=body.address_text, latitude=body.latitude,
                                      longitude=body.longitude)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {**_branch_out(branch), "detail": "Branch added. It becomes public after a storefront check."}


@router.put("/branches/{branch_id}/delivery")
async def set_delivery(branch_id: uuid.UUID, body: DeliveryIn, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        branch = await svc.set_delivery(db, vendor, branch_id, options=body.options, area=body.area,
                                        rider_name=body.rider_name, rider_phone=body.rider_phone)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {**_branch_out(branch), "detail": "Delivery saved. Brief has not checked the rider."}


@router.get("/branches/mine")
async def my_branches(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"branches": [_branch_out(b) for b in await svc.my_branches(db, vendor)]}


@router.post("/branches/{branch_id}/tokens", status_code=201)
async def issue_token(branch_id: uuid.UUID, body: IssueTokenIn, vendor: Vendor = Depends(get_current_vendor),
                      db: AsyncSession = Depends(get_db)):
    try:
        token, expires = await svc.issue_token(db, vendor, branch_id, body.receipt_ref)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {"token": token, "expires_at": expires.isoformat(),
            "detail": "Show this code at the till. It works once and expires in two hours."}


@router.post("/branches/{branch_id}/reviews", status_code=201)
async def submit_review(branch_id: uuid.UUID, body: ReviewIn, vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    try:
        review = await svc.submit_review(db, vendor, branch_id, rating=body.rating, token=body.transaction_token)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {**_review_out(review), "points_earned": svc.REVIEW_POINTS,
            "detail": "Thanks. Your rating is published and " + str(svc.REVIEW_POINTS) + " points were added."}


@router.get("/points")
async def points(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await svc.points_summary(db, vendor)


@router.get("/services")
async def services(country: Optional[str] = Query(None, min_length=2, max_length=2)):
    return {"approved": catalogue.CATALOGUE_APPROVED,
            "services": svc.services_for(country.upper() if country else None),
            "note": "Points are rewards, not money. Services appear here once the Brief team has approved the list."}


@router.post("/points/redeem")
async def redeem(body: RedeemIn, idempotency_key: str = Header(..., alias="Idempotency-Key"),
                 vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        result = await svc.redeem(db, vendor, service_key=body.service_key, country=body.country,
                                  idempotency_key=idempotency_key)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {**result, "note": NO_MONEY_NOTE}


@router.get("/admin/reviews/flagged")
async def staff_flagged_reviews(staff: Vendor = Depends(require_governance_ops("admin")),
                                db: AsyncSession = Depends(get_db)):
    return {"reviews": await svc.flagged_reviews(db)}


@router.post("/admin/reviews/{review_id}/moderation", status_code=201)
async def staff_moderate_review(review_id: uuid.UUID, body: ModerationIn,
                                staff: Vendor = Depends(require_governance_ops("admin")),
                                db: AsyncSession = Depends(get_db)):
    try:
        review = await svc.moderate_review(db, staff, review_id, action=body.action, reason=body.reason)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {"id": str(review.id), "status": review.status}


# ── staff ─────────────────────────────────────────────────────────────────────

@router.get("/admin/branches")
async def staff_branches(status: str = Query("pending", pattern="^(pending|active)$"),
                         staff: Vendor = Depends(require_governance_ops("admin")),
                         db: AsyncSession = Depends(get_db)):
    rows = await svc.branches_by_status(db, status)
    return {"branches": [_branch_out(b) for b in rows]}


@router.post("/admin/branches/{branch_id}/verifications", status_code=201)
async def verify_branch(branch_id: uuid.UUID, body: VerificationIn,
                        staff: Vendor = Depends(require_governance_ops("admin")),
                        db: AsyncSession = Depends(get_db)):
    try:
        branch = await svc.decide_verification(db, staff, branch_id, method=body.method,
                                               result=body.result, note=body.note)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return _branch_out(branch)


# ── customers: no account. A device key identifies the reviewer; a till code proves the sale. ──

customer = APIRouter()
CUSTOMER_KEY = Header(..., alias="X-Customer-Key", min_length=16, max_length=200)


@customer.post("/branches/{branch_id}/reviews", status_code=201)
async def customer_submit_review(branch_id: uuid.UUID, body: CustomerReviewIn,
                                 x_customer_key: str = CUSTOMER_KEY, db: AsyncSession = Depends(get_db)):
    try:
        identity = await svc.identity_for_key(db, x_customer_key)
        review, reasons = await svc.customer_review(
            db, identity, branch_id, token=body.transaction_code, service=body.service_rating,
            product=body.product_rating, overall=body.overall_rating, comment=body.comment)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    held = bool(reasons)
    return {
        "id": str(review.id),
        "status": review.status,
        "evidence_tier": review.evidence_tier,
        "message": ("Thanks. Your review is being checked before it is published. You will see it in your history."
                    if held else "Thanks. Your review is published."),
    }


@customer.get("/reviews")
async def customer_my_reviews(x_customer_key: str = CUSTOMER_KEY, db: AsyncSession = Depends(get_db)):
    try:
        identity = await svc.identity_for_key(db, x_customer_key)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {"display_name": identity.display_name, "reviews": await svc.customer_history(db, identity)}


@customer.put("/profile")
async def customer_profile(body: ProfileIn, x_customer_key: str = CUSTOMER_KEY, db: AsyncSession = Depends(get_db)):
    try:
        identity = await svc.identity_for_key(db, x_customer_key)
        await svc.set_display_name(db, identity, body.display_name)
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    await db.commit()
    return {"display_name": identity.display_name}


"""Social-seller trust API.

Mounted at /api/social-trust, plus two compatibility aliases:
    GET  /api/social-proof/challenge          same as /api/social-trust/challenge
    POST /api/profile/verify-social-bio       same as /api/social-trust/verify-bio

Signed in (owner):
    GET  /api/social-trust/me
    PUT  /api/social-trust/links
    POST /api/social-trust/verify-bio
    GET  /api/social-trust/challenge
    POST /api/social-trust/stock-proof
    GET  /api/social-trust/delivery-reports
    POST /api/social-trust/delivery-reports
    POST /api/social-trust/delivery-reports/{id}/resolve

Public (no login):
    GET  /api/social-trust/public/{handle}
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.social_trust import service as svc
from app.routes.auth import get_current_vendor

router = APIRouter()
alias_router = APIRouter()


class LinksIn(BaseModel):
    links: list[dict] = Field(default_factory=list)


class BioVerifyIn(BaseModel):
    platform: str = Field(..., max_length=16)


class StockProofIn(BaseModel):
    challenge_code: str = Field(..., max_length=10)
    item_title: str = Field(..., max_length=120)
    price_kes: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    image_url: str = Field(..., max_length=500)


class DeliveryReportIn(BaseModel):
    seller_handle: str = Field(..., max_length=100)
    note: str = Field(..., max_length=1000)


class ResolveIn(BaseModel):
    note: str = Field(..., max_length=1000)


def _fail(exc: svc.TrustError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


@router.get("/me")
async def me(vendor: Vendor = Depends(get_current_vendor),
             db: AsyncSession = Depends(get_db)):
    return await svc.owner_state(db, vendor)


@router.put("/links")
async def save_links(body: LinksIn, vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    try:
        links = svc.validate_links(body.links)
        vendor.social_links = links
        await db.commit()
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    return {"social_links": links,
            "message": "Saved. Run the bio check to record what the public page shows today."}


@router.post("/verify-bio")
async def verify_bio(body: BioVerifyIn, vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    try:
        result = await svc.verify_bio(db, vendor, body.platform)
        await db.commit()
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    return result


@alias_router.post("/verify-social-bio")
async def verify_social_bio_alias(body: BioVerifyIn,
                                  vendor: Vendor = Depends(get_current_vendor),
                                  db: AsyncSession = Depends(get_db)):
    return await verify_bio(body, vendor, db)


@router.get("/challenge")
async def challenge(vendor: Vendor = Depends(get_current_vendor)):
    return svc.daily_challenge(vendor)


@alias_router.get("/challenge")
async def challenge_alias(vendor: Vendor = Depends(get_current_vendor)):
    return svc.daily_challenge(vendor)


@router.post("/stock-proof", status_code=201)
async def publish_stock_proof(body: StockProofIn,
                              vendor: Vendor = Depends(get_current_vendor),
                              db: AsyncSession = Depends(get_db)):
    try:
        result = await svc.publish_stock_proof(
            db, vendor, challenge_code=body.challenge_code, item_title=body.item_title,
            price_kes=body.price_kes, image_url=body.image_url,
        )
        await db.commit()
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    return result


@router.get("/delivery-reports")
async def delivery_reports(vendor: Vendor = Depends(get_current_vendor),
                           db: AsyncSession = Depends(get_db)):
    stats = await svc.open_report_stats(db, vendor.id)
    await db.commit()
    return stats


@router.post("/delivery-reports", status_code=201)
async def file_delivery_report(body: DeliveryReportIn,
                               vendor: Vendor = Depends(get_current_vendor),
                               db: AsyncSession = Depends(get_db)):
    try:
        result = await svc.submit_delivery_report(
            db, vendor, seller_handle=body.seller_handle, note=body.note,
        )
        await db.commit()
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    return result


@router.post("/delivery-reports/{report_id}/resolve")
async def resolve_delivery_report(report_id: uuid.UUID, body: ResolveIn,
                                  vendor: Vendor = Depends(get_current_vendor),
                                  db: AsyncSession = Depends(get_db)):
    try:
        result = await svc.resolve_delivery_report(db, vendor, report_id, body.note)
        await db.commit()
    except svc.TrustError as exc:
        await db.rollback()
        _fail(exc)
    return result


@router.get("/public/{handle}")
async def public_card(handle: str, request: Request,
                      db: AsyncSession = Depends(get_db)):
    normalized = str(handle or "").strip().lstrip("@").lower()
    vendor = (await db.execute(
        select(Vendor).where(Vendor.vendor_handle == normalized)
    )).scalar_one_or_none()
    if vendor is None or (vendor.vendor_handle or "").startswith("closed_") \
            or vendor.fraud_suspended_at:
        raise HTTPException(404, "That seller page was not found.")
    return await svc.public_card(db, vendor, str(request.base_url).rstrip("/"))

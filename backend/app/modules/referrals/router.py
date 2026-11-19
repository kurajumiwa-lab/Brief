"""Referral API.

Two doors are public on purpose:

  GET /api/referrals/public/codes/{code}   a WhatsApp link must open for a stranger

Everything else needs the member's bearer token. Claiming a code is a POST and
is deliberately *not* public: an anonymous visitor is sent through registration
first, then the code is attached to the new account.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.referrals import service
from app.modules.referrals.schemas import CampaignCreate, CampaignStatusIn, ClaimIn, PaidIn
from app.routes.auth import get_current_vendor

router = APIRouter()


def _error(exc: service.ReferralError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.message)


@router.get("/campaigns")
async def list_campaigns(
    region: Optional[str] = Query(None, max_length=60),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    rows = await service.campaigns_for(db, vendor, region_slug=region)
    return {
        "campaigns": rows,
        "note": "A link is an introduction. A referral is verified only by a receipt at the shop that funds it.",
    }


@router.get("/public/codes/{code}")
async def public_code(code: str, db: AsyncSession = Depends(get_db)):
    try:
        return await service.public_by_code(db, code)
    except service.ReferralError as exc:
        raise _error(exc)


@router.get("/me")
async def my_referrals(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.overview(db, vendor)


@router.post("/campaigns", status_code=status.HTTP_201_CREATED)
async def create_campaign(
    body: CampaignCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return {"campaign": await service.create_campaign(db, vendor, body)}
    except service.ReferralError as exc:
        raise _error(exc)


@router.post("/campaigns/{campaign_id}/status")
async def set_campaign_status(
    campaign_id: uuid.UUID,
    body: CampaignStatusIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return {"campaign": await service.set_campaign_status(db, vendor, campaign_id, body.status)}
    except service.ReferralError as exc:
        raise _error(exc)


@router.post("/campaigns/{campaign_id}/link", status_code=status.HTTP_201_CREATED)
async def create_link(
    campaign_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return {"link": await service.create_link(db, vendor, campaign_id)}
    except service.ReferralError as exc:
        raise _error(exc)


@router.post("/claim", status_code=status.HTTP_201_CREATED)
async def claim_code(
    body: ClaimIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.attribute_code(db, vendor, body.code)
    except service.ReferralError as exc:
        raise _error(exc)


@router.post("/{referral_id}/paid")
async def mark_bounty_paid(
    referral_id: uuid.UUID,
    body: PaidIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return {
            "referral": await service.mark_paid(db, vendor, referral_id, body.note),
            "note": "Recorded as a direct payment between the shop and the person. No platform money moved.",
        }
    except service.ReferralError as exc:
        raise _error(exc)

"""Price claims: anyone may advertise a price, the business may always answer.

Mounted at /api/price-claims.

Public (no account):
    GET  /api/price-claims/savings              where the same item is cheaper nearby
    GET  /api/price-claims/product?product=     every claim about one item

Signed in:
    POST /api/price-claims                      report a price you can see
    POST /api/price-claims/{id}/reply           the business answers
    POST /api/price-claims/{id}/correct         the business states the current price
    POST /api/price-claims/{id}/dispute         the business disputes the report

There is no "pay to remove" route and no way for an owner to delete a
receipt-backed fact: a correction is a new row with a new date.
"""

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.intake import claims
from app.modules.intake.claims import ClaimError
from app.routes.auth import get_current_vendor

router = APIRouter()
public = APIRouter()


class ClaimIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product: str = Field(..., min_length=2, max_length=160)
    price_kes: StrictInt = Field(..., ge=1, le=100_000_000)
    seller_label: str = Field(..., min_length=2, max_length=160)
    market: Optional[str] = Field(default=None, max_length=80)
    unit: Optional[str] = Field(default=None, max_length=16)
    source: Literal["customer", "employee", "rival", "owner"] = "customer"
    observed_on: Optional[date] = None


class ReplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(..., min_length=2, max_length=2000)


class CorrectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    price_kes: StrictInt = Field(..., ge=1, le=100_000_000)


class DisputeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=10, max_length=2000)


def _fail(exc: ClaimError):
    raise HTTPException(status_code=exc.status, detail=str(exc))


@public.get("/savings")
async def savings(
    town: Optional[str] = Query(None, max_length=80),
    product: Optional[str] = Query(None, max_length=160),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    return await claims.savings(db, town=town, product=product, limit=limit)


@router.post("", status_code=201)
async def submit(body: ClaimIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    try:
        row = await claims.submit(
            db, vendor=vendor, product=body.product, price_kes=body.price_kes,
            seller_label=body.seller_label, market=body.market, unit=body.unit,
            source=body.source, observed_on=body.observed_on,
        )
        out = claims.claim_out(row)
        await db.commit()
    except ClaimError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/{observation_id}/reply")
async def reply(observation_id: str, body: ReplyIn,
                vendor: Vendor = Depends(get_current_vendor),
                db: AsyncSession = Depends(get_db)):
    try:
        row = await claims.reply(db, vendor, observation_id, body.body)
        out = claims.claim_out(row)
        await db.commit()
    except ClaimError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/{observation_id}/correct")
async def correct(observation_id: str, body: CorrectIn,
                  vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        row = await claims.correct(db, vendor, observation_id, body.price_kes)
        out = claims.claim_out(row)
        await db.commit()
    except ClaimError as exc:
        await db.rollback()
        _fail(exc)
    return out


@router.post("/{observation_id}/dispute")
async def dispute(observation_id: str, body: DisputeIn,
                  vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    try:
        out = await claims.dispute(db, vendor, observation_id, body.reason)
        await db.commit()
    except ClaimError as exc:
        await db.rollback()
        _fail(exc)
    return out

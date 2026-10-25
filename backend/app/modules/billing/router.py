"""HTTP surface for subscription billing.

    GET  /api/billing/me                  plan, subscription, invoices, catalogue, live flag
    POST /api/billing/subscribe           start a trial + first invoice
    POST /api/billing/cancel              stop billing at period end (or immediately)
    POST /api/billing/invoices/{id}/simulate   mock provider only
    POST /api/billing/sweep               operator: expire trials and lapses now

Every response carries ``billing.live`` so no screen can imply that recurring
billing is running when the provider is a mock.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.billing import service
from app.routes.auth import get_current_vendor
from app.routes.ops import require_operator

router = APIRouter()


class SubscribeIn(BaseModel):
    plan_tier: str = Field(..., min_length=2, max_length=24)
    billing_period: str = Field("monthly", pattern="^(monthly|annual)$")


class CancelIn(BaseModel):
    immediate: bool = False


@router.get("/me")
async def my_billing(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.overview(db, vendor)


@router.post("/subscribe", status_code=201)
async def subscribe(
    body: SubscribeIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.start_subscription(
            db, vendor, plan_tier=body.plan_tier, billing_period=body.billing_period
        )
    except service.BillingError as exc:
        raise HTTPException(exc.status, str(exc))


@router.post("/cancel")
async def cancel(
    body: Optional[CancelIn] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.cancel(db, vendor, immediate=bool(body and body.immediate))
    except service.BillingError as exc:
        raise HTTPException(exc.status, str(exc))


@router.post("/invoices/{invoice_id}/simulate")
async def simulate(
    invoice_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.simulate_mock_payment(db, vendor, invoice_id)
    except service.BillingError as exc:
        raise HTTPException(exc.status, str(exc))


@router.post("/sweep")
async def sweep(
    staff: Vendor = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Run the lifecycle sweep. Also safe to call from a scheduler."""
    return await service.run_lifecycle_sweep(db)

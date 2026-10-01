"""Murabaha (cost-plus) stock advances — routes (v2.6, halal-trade brief).

Vendor side:
    POST /api/murabaha/contracts          request an advance (pending_approval)
    GET  /api/murabaha/contracts/mine     my advances
    POST /api/murabaha/contracts/{id}/pay pay the full total_selling_ksh

Sacco window (market-ops staff):
    GET  /api/murabaha/contracts/desk     pending + active advances
    POST /api/murabaha/contracts/{id}/approve
    POST /api/murabaha/contracts/{id}/decline
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.halal import MurabahaContract
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.routes.market_locks import require_market_ops
from app.services import halal
from app.services.payments import PaymentError

router = APIRouter()


class MurabahaRequest(BaseModel):
    product: str = Field(min_length=3, max_length=200)
    quantity: int = Field(gt=0, le=1_000_000)
    cost_price_ksh: int = Field(gt=0, le=5_000_000)
    markup_ksh: int = Field(ge=0, le=5_000_000)
    payment_due_days: int = Field(30, ge=1, le=180)
    supplier_vendor_id: Optional[uuid.UUID] = None
    note: Optional[str] = Field(None, max_length=1000)


def _contract_out(c: MurabahaContract, supplier_handle: Optional[str] = None) -> dict:
    return {
        "id": str(c.id),
        "vendor_id": str(c.vendor_id),
        "supplier_vendor_id": str(c.supplier_vendor_id) if c.supplier_vendor_id else None,
        "supplier_handle": supplier_handle,
        "product": c.product,
        "quantity": c.quantity,
        "cost_price_ksh": c.cost_price_ksh,
        "markup_ksh": c.markup_ksh,
        "total_selling_ksh": c.total_selling_ksh,
        "payment_due_date": c.payment_due_date.isoformat() if c.payment_due_date else None,
        "status": c.status,
        "note": c.note,
        "settled_at": c.settled_at.isoformat() if c.settled_at else None,
        "failure_reason": c.failure_reason,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.post("/contracts", status_code=201)
async def request_murabaha(
    data: MurabahaRequest,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    contract = await halal.request_murabaha(
        db, vendor,
        product=data.product, quantity=data.quantity,
        cost_price_ksh=data.cost_price_ksh, markup_ksh=data.markup_ksh,
        payment_due_days=data.payment_due_days,
        supplier_vendor_id=data.supplier_vendor_id, note=data.note,
    )
    await db.commit()
    return _contract_out(contract)


@router.get("/contracts/mine")
async def my_contracts(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(MurabahaContract).where(
        MurabahaContract.vendor_id == vendor.id,
    ).order_by(MurabahaContract.created_at.desc()).limit(50))).scalars().all()
    return [_contract_out(c) for c in rows]


@router.get("/contracts/desk")
async def contract_desk(
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "negotiator", "spotter")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(MurabahaContract).where(
        MurabahaContract.status.in_(("pending_approval", "active")),
    ).order_by(MurabahaContract.created_at.desc()).limit(100))).scalars().all()
    out = []
    for c in rows:
        supplier = await db.get(Vendor, c.supplier_vendor_id) if c.supplier_vendor_id else None
        out.append(_contract_out(c, supplier.vendor_handle if supplier else None))
    return out


@router.post("/contracts/{contract_id}/approve")
async def approve_murabaha(
    contract_id: uuid.UUID,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "negotiator")),
    db: AsyncSession = Depends(get_db),
):
    contract = await halal.contract_or_404(db, contract_id)
    await halal.decide_murabaha(db, contract, staff[0], approve=True)
    await db.commit()
    return _contract_out(contract)


@router.post("/contracts/{contract_id}/decline")
async def decline_murabaha(
    contract_id: uuid.UUID,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "negotiator")),
    db: AsyncSession = Depends(get_db),
):
    contract = await halal.contract_or_404(db, contract_id)
    await halal.decide_murabaha(db, contract, staff[0], approve=False)
    await db.commit()
    return _contract_out(contract)


@router.post("/contracts/{contract_id}/pay", status_code=201)
async def pay_murabaha(
    contract_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    contract = await halal.contract_or_404(db, contract_id)
    try:
        result = await halal.pay_murabaha(db, contract, vendor)
    except PaymentError as exc:
        raise HTTPException(400, str(exc))
    await db.commit()
    return result

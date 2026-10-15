"""HTTP adapter for Market Runs (v2.15), mounted under /api/locks.

    GET    /api/locks/runs/templates
    POST   /api/locks/runs                              create a run (any vendor organises)
    GET    /api/locks/runs                              runs (open ordering, any zone)
    GET    /api/locks/runs/{run_id}/ledger              per-run order ledger
    POST   /api/locks/runs/{run_id}/status              buyer/organiser status flow
    POST   /api/locks/runs/{run_id}/orders              place a request (customer chooses payment)
    POST   /api/locks/runs/orders/{order_id}/confirm    request → confirmed order
    POST   /api/locks/runs/orders/{order_id}/cancel
    POST   /api/locks/runs/orders/{order_id}/allocate   buyer assigns actual allocation + fees
    POST   /api/locks/runs/orders/{order_id}/payments   record advance / on-delivery / shop payment
    POST   /api/locks/runs/orders/{order_id}/handover   collected | delivered | refused
    POST   /api/locks/runs/{run_id}/purchases           supplier purchase + receipt per product
    POST   /api/locks/runs/{run_id}/expenses            transport / handling / cold-chain costs
    GET    /api/locks/runs/orders/mine                  my run orders across runs
"""

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.runs import rules, service
from app.modules.runs.models import RunOrder
from app.routes.auth import get_current_vendor

router = APIRouter()


class RunCreateIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=240)
    market_name: str = Field(..., min_length=2, max_length=200)
    market_city: str = Field("Nairobi", max_length=120)
    zone_id: Optional[UUID] = None
    run_kind: str = Field("consolidated_supply", max_length=32)
    run_date: date
    order_deadline: datetime
    buyer_handle: Optional[str] = Field(None, max_length=100)
    funding_model: str = Field("mixed_open", max_length=32)
    cold_chain_required: bool = False
    cold_chain_plan: Optional[str] = Field(None, max_length=2000)
    notes: Optional[str] = Field(None, max_length=2000)


class StatusIn(BaseModel):
    status: str = Field(..., max_length=24)


class OrderCreateIn(BaseModel):
    product_name: str = Field(..., min_length=2, max_length=200)
    product_id: Optional[UUID] = None
    unit_of_measure: str = Field("units", max_length=50)
    package_size: Optional[str] = Field(None, max_length=120)
    wholesale_package: bool = False
    repack_required: bool = False
    participant_type: str = Field("shop", max_length=16)
    quantity: float = Field(..., gt=0, le=1_000_000)
    payment_method: str = Field("cash_on_delivery", max_length=32)
    money_responsibility: Optional[str] = Field(None, max_length=16)
    funding_source: str = Field("customer_advance", max_length=24)
    delivery_mode: str = Field("collect_at_hub", max_length=24)
    collection_point_handle: Optional[str] = Field(None, max_length=100)
    delivery_area: Optional[str] = Field(None, max_length=240)
    estimated_unit_price: Optional[float] = Field(None, ge=0)
    delivery_fee_kes: int = Field(0, ge=0, le=1_000_000)
    handling_fee_kes: int = Field(0, ge=0, le=1_000_000)
    repack_fee_kes: int = Field(0, ge=0, le=1_000_000)


class AllocateIn(BaseModel):
    quantity_allocated: float = Field(..., ge=0, le=1_000_000)
    delivery_fee_kes: Optional[int] = Field(None, ge=0)
    handling_fee_kes: Optional[int] = Field(None, ge=0)
    repack_fee_kes: Optional[int] = Field(None, ge=0)


class PaymentIn(BaseModel):
    amount_kes: int = Field(..., gt=0, le=100_000_000)
    note: Optional[str] = Field(None, max_length=1000)


class HandoverIn(BaseModel):
    outcome: str = Field(..., max_length=16)


class PurchaseIn(BaseModel):
    product_name: str = Field(..., min_length=2, max_length=200)
    unit_of_measure: str = Field("units", max_length=50)
    supplier_name: Optional[str] = Field(None, max_length=200)
    quantity_purchased: float = Field(..., gt=0, le=10_000_000)
    actual_unit_price: float = Field(..., ge=0, le=1_000_000_000)
    receipt_ref: Optional[str] = Field(None, max_length=2000)
    weight_loss_quantity: float = Field(0, ge=0)
    rejected_quantity: float = Field(0, ge=0)
    notes: Optional[str] = Field(None, max_length=2000)


class ExpenseIn(BaseModel):
    kind: str = Field("transport", max_length=24)
    amount_kes: int = Field(..., ge=0, le=100_000_000)
    receipt_ref: Optional[str] = Field(None, max_length=2000)
    note: Optional[str] = Field(None, max_length=1000)


def _err(exc: rules.RunRuleError) -> HTTPException:
    return HTTPException(exc.status, str(exc))


async def _order(db: AsyncSession, order_id: UUID) -> RunOrder:
    order = await db.get(RunOrder, order_id)
    if order is None:
        raise HTTPException(404, "Run order not found")
    return order


@router.get("/runs/templates")
async def run_templates(vendor: Vendor = Depends(get_current_vendor)):
    return {
        "templates": list(rules.RUN_TEMPLATES),
        "payment_methods": [
            {"key": key, "note": note} for key, note in rules.PAYMENT_METHOD_NOTES.items()
        ],
        "funding_models": [
            {"key": key, "note": note} for key, note in rules.FUNDING_MODEL_NOTES.items()
        ],
        "openness": (
            "Ordering into a run is open to any vendor account, whatever their registered "
            "market zone, and delivery can be outside the market's walkable ring. The "
            "customer chooses the payment method; fees and money responsibility are "
            "shown on the order, and large on-delivery orders are flagged with a deposit "
            "recommendation — never blocked."
        ),
    }


@router.post("/runs", status_code=201)
async def create_run(body: RunCreateIn, vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    try:
        return await service.create_run(db, vendor, data=body.model_dump())
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.get("/runs")
async def list_runs(status: Optional[str] = None, vendor: Vendor = Depends(get_current_vendor),
                    db: AsyncSession = Depends(get_db)):
    return await service.list_runs(db, status=status)


@router.get("/runs/orders/mine")
async def my_run_orders(vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    return await service.my_orders(db, vendor)


@router.get("/runs/{run_id}/ledger")
async def run_ledger(run_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    try:
        run = await service.get_run(db, run_id)
        return await service.ledger(db, run)
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/{run_id}/status")
async def set_run_status(run_id: UUID, body: StatusIn,
                         vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    try:
        run = await service.get_run(db, run_id)
        return await service.set_run_status(db, run, vendor, body.status)
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/{run_id}/orders", status_code=201)
async def create_order(run_id: UUID, body: OrderCreateIn,
                       vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        run = await service.get_run(db, run_id)
        return await service.create_order(db, run, vendor, data=body.model_dump())
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/{run_id}/purchases", status_code=201)
async def record_purchase(run_id: UUID, body: PurchaseIn,
                          vendor: Vendor = Depends(get_current_vendor),
                          db: AsyncSession = Depends(get_db)):
    try:
        run = await service.get_run(db, run_id)
        return await service.record_purchase(db, run, vendor, data=body.model_dump())
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/{run_id}/expenses", status_code=201)
async def record_expense(run_id: UUID, body: ExpenseIn,
                         vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    try:
        run = await service.get_run(db, run_id)
        return await service.record_expense(db, run, vendor, data=body.model_dump())
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/orders/{order_id}/confirm")
async def confirm_order(order_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    try:
        return await service.confirm_order(db, await _order(db, order_id), vendor)
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/orders/{order_id}/cancel")
async def cancel_order(order_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        return await service.cancel_order(db, await _order(db, order_id), vendor)
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/orders/{order_id}/allocate")
async def allocate_order(order_id: UUID, body: AllocateIn,
                         vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    try:
        order = await _order(db, order_id)
        run = await service.get_run(db, order.run_id)
        return await service.allocate_order(
            db, run, order, vendor, quantity_allocated=body.quantity_allocated,
            delivery_fee_kes=body.delivery_fee_kes, handling_fee_kes=body.handling_fee_kes,
            repack_fee_kes=body.repack_fee_kes)
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/orders/{order_id}/payments", status_code=201)
async def record_payment(order_id: UUID, body: PaymentIn,
                         vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    try:
        order = await _order(db, order_id)
        run = await service.get_run(db, order.run_id)
        return await service.record_payment(db, run, order, vendor,
                                            amount_kes=body.amount_kes, note=body.note)
    except rules.RunRuleError as exc:
        raise _err(exc)


@router.post("/runs/orders/{order_id}/handover")
async def mark_handover(order_id: UUID, body: HandoverIn,
                        vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    try:
        order = await _order(db, order_id)
        run = await service.get_run(db, order.run_id)
        return await service.mark_handover(db, run, order, vendor, outcome=body.outcome)
    except rules.RunRuleError as exc:
        raise _err(exc)

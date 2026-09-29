"""
SRM-lite (Directive v2.1 §4.4): vendor performance, computed from movements.

`recalculate(db, vendor_id)` rewrites the vendor's `vendor_performance` row
from their supplier-side history and refreshes the cheap counters on the
vendor row. Called after every movement transition; caller commits.

Definitions (all "as supplier"):
  sourcing_acceptance_rate  confirmed+ / (confirmed+ + cancelled-by-supplier-while-pending)
  order_fulfillment_rate    received / (received + cancelled after confirming)
  on_time_delivery_rate     shipped within PERFORMANCE_ON_TIME_HOURS of confirming
  avg_response_hours        created → confirmed
  avg_fulfillment_hours     created → received
  reliability_score         0.4·fulfillment + 0.3·acceptance + 0.2·on-time + 0.1·volume (≥10 deals = full)
Returns and disputes have no flow yet; the columns stay 0 so the shape is stable.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.performance import VendorPerformance
from app.models.stock import MovementStatus, StockMovement
from app.models.vendor import Vendor


def _hours(a: Optional[datetime], b: Optional[datetime]) -> Optional[float]:
    if not a or not b:
        return None
    return max(0.0, (b - a).total_seconds() / 3600.0)


def _pct(num: int, den: int) -> float:
    return round(100.0 * num / den, 1) if den else 0.0


def _avg(values: list[float]) -> float:
    return round(sum(values) / len(values), 1) if values else 0.0


async def get_or_create(db: AsyncSession, vendor_id: UUID) -> VendorPerformance:
    row = (await db.execute(select(VendorPerformance).where(VendorPerformance.vendor_id == vendor_id))).scalar_one_or_none()
    if row is None:
        row = VendorPerformance(vendor_id=vendor_id)
        db.add(row)
        await db.flush()
    return row


async def recalculate(db: AsyncSession, vendor_id: UUID) -> VendorPerformance:
    movements = (await db.execute(select(StockMovement).where(StockMovement.from_vendor_id == vendor_id))).scalars().all()
    perf = await get_or_create(db, vendor_id)

    received = [m for m in movements if m.status == MovementStatus.RECEIVED.value]
    confirmed_plus = [m for m in movements if m.confirmed_at is not None or m.status in (
        MovementStatus.CONFIRMED.value, MovementStatus.SHIPPED.value, MovementStatus.RECEIVED.value)]
    cancelled = [m for m in movements if m.status == MovementStatus.CANCELLED.value]
    declined = [m for m in cancelled if m.confirmed_at is None and m.cancelled_by_vendor_id == vendor_id]
    backed_out = [m for m in cancelled if m.confirmed_at is not None and m.cancelled_by_vendor_id == vendor_id]

    on_time_pool = [m for m in movements if m.confirmed_at and m.shipped_at]
    on_time = [m for m in on_time_pool if _hours(m.confirmed_at, m.shipped_at) <= settings.PERFORMANCE_ON_TIME_HOURS]

    perf.sourcing_acceptance_rate = _pct(len(confirmed_plus), len(confirmed_plus) + len(declined))
    perf.order_fulfillment_rate = _pct(len(received), len(received) + len(backed_out))
    perf.on_time_delivery_rate = _pct(len(on_time), len(on_time_pool))
    perf.avg_response_hours = _avg([h for h in (_hours(m.created_at, m.confirmed_at) for m in confirmed_plus) if h is not None])
    perf.avg_fulfillment_hours = _avg([h for h in (_hours(m.created_at, m.completed_at) for m in received) if h is not None])
    perf.total_deals_completed = len(received)
    perf.total_trade_value = round(sum(float(m.total_value or 0) for m in received), 2)

    has_sample = bool(confirmed_plus or declined)
    volume_factor = min(len(received), 10) / 10 * 100
    if has_sample:
        perf.reliability_score = round(
            0.4 * (perf.order_fulfillment_rate if (received or backed_out) else 100.0)
            + 0.3 * perf.sourcing_acceptance_rate
            + 0.2 * (perf.on_time_delivery_rate if on_time_pool else 100.0)
            + 0.1 * volume_factor, 1)
    else:
        perf.reliability_score = 0.0
    perf.calculated_at = datetime.utcnow()

    vendor = await db.get(Vendor, vendor_id)
    if vendor is not None:
        vendor.movements_completed = len(received)
        vendor.movements_cancelled = len(backed_out)
    return perf


def to_dict(perf: Optional[VendorPerformance]) -> dict:
    if perf is None:
        return {
            "on_time_delivery_rate": 0, "order_fulfillment_rate": 0, "avg_fulfillment_hours": 0,
            "return_rate": 0, "dispute_rate": 0, "avg_response_hours": 0, "sourcing_acceptance_rate": 0,
            "total_deals_completed": 0, "total_trade_value": 0, "reliability_score": 0, "calculated_at": None,
        }
    return {
        "on_time_delivery_rate": perf.on_time_delivery_rate,
        "order_fulfillment_rate": perf.order_fulfillment_rate,
        "avg_fulfillment_hours": perf.avg_fulfillment_hours,
        "return_rate": perf.return_rate,
        "dispute_rate": perf.dispute_rate,
        "avg_response_hours": perf.avg_response_hours,
        "sourcing_acceptance_rate": perf.sourcing_acceptance_rate,
        "total_deals_completed": perf.total_deals_completed,
        "total_trade_value": perf.total_trade_value,
        "reliability_score": perf.reliability_score,
        "calculated_at": perf.calculated_at.isoformat() if perf.calculated_at else None,
    }

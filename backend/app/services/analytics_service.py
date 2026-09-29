"""
Trade Analytics (Directive v2.1 §3.5 — trade history & analytics).

Aggregates the movements a vendor has actually settled into the numbers a
trader asks about: what moved, to whom, at what price, how reliably, and how
that compares with the rest of the network.

Only `received` movements count as trade — pending holds are not revenue and
cancelled ones are not history.
"""

from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import MovementStatus, StockItem, StockMovement
from app.models.vendor import Vendor, vendor_connections

RECEIVED = MovementStatus.RECEIVED.value
OPEN_STATUSES = (
    MovementStatus.PENDING.value,
    MovementStatus.CONFIRMED.value,
    MovementStatus.SHIPPED.value,
)


def _since(days: int) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


def _bucket_for(days: int) -> str:
    if days <= 31:
        return "day"
    if days <= 120:
        return "week"
    return "month"


def _mine(vendor_id: UUID):
    return or_(StockMovement.from_vendor_id == vendor_id, StockMovement.to_vendor_id == vendor_id)


async def _movement_stats(db: AsyncSession, vendor_id: UUID, days: int) -> dict:
    """Value / unit / count totals split by direction, plus live open work."""
    since = _since(days)
    settled = and_(_mine(vendor_id), StockMovement.status == RECEIVED)
    windowed = and_(settled, StockMovement.completed_at >= since)

    supplied = func.sum(case((StockMovement.from_vendor_id == vendor_id, StockMovement.total_value), else_=0))
    sourced = func.sum(case((StockMovement.to_vendor_id == vendor_id, StockMovement.total_value), else_=0))
    supplied_units = func.sum(case((StockMovement.from_vendor_id == vendor_id, StockMovement.quantity), else_=0))
    sourced_units = func.sum(case((StockMovement.to_vendor_id == vendor_id, StockMovement.quantity), else_=0))

    totals = (await db.execute(
        select(
            func.coalesce(supplied, 0.0), func.coalesce(sourced, 0.0),
            func.coalesce(supplied_units, 0), func.coalesce(sourced_units, 0),
            func.count(StockMovement.id),
        ).where(windowed)
    )).one()

    open_rows = (await db.execute(
        select(StockMovement.status, func.count(StockMovement.id))
        .where(_mine(vendor_id), StockMovement.status.in_(OPEN_STATUSES))
        .group_by(StockMovement.status)
    )).all()

    cancelled = (await db.execute(
        select(func.count(StockMovement.id)).where(_mine(vendor_id), StockMovement.status == MovementStatus.CANCELLED.value,
                                                    StockMovement.created_at >= since)
    )).scalar() or 0

    window_value = float(totals[0]) + float(totals[1])
    movements_in_window = int(totals[4] or 0)

    # Fulfilment timings for the vendor as supplier: confirm → ship, and
    # request → receipt.
    ship_hours = func.avg(func.extract("epoch", StockMovement.shipped_at - StockMovement.confirmed_at) / 3600.0)
    total_hours = func.avg(func.extract("epoch", StockMovement.completed_at - StockMovement.created_at) / 3600.0)
    on_time = func.sum(case((func.extract("epoch", StockMovement.shipped_at - StockMovement.confirmed_at) <= 3600.0 * 72, 1), else_=0))
    timed = (await db.execute(
        select(ship_hours, total_hours, on_time, func.count(StockMovement.id)).where(
            and_(settled, StockMovement.from_vendor_id == vendor_id,
                 StockMovement.confirmed_at.isnot(None), StockMovement.shipped_at.isnot(None)),
        )
    )).one()
    timed_count = int(timed[3] or 0)

    counterparties = (await db.execute(
        select(
            func.count(func.distinct(case(
                (StockMovement.from_vendor_id == vendor_id, StockMovement.to_vendor_id),
                else_=StockMovement.from_vendor_id,
            )))
        ).where(windowed)
    )).scalar() or 0

    return {
        "days": days,
        "supplied_value": round(float(totals[0] or 0), 2),
        "sourced_value": round(float(totals[1] or 0), 2),
        "trade_value": round(window_value, 2),
        "supplied_units": int(totals[2] or 0),
        "sourced_units": int(totals[3] or 0),
        "units_moved": int(totals[2] or 0) + int(totals[3] or 0),
        "movements_settled": movements_in_window,
        "movements_cancelled": int(cancelled),
        "avg_movement_value": round(window_value / movements_in_window, 2) if movements_in_window else 0.0,
        "counterparties": int(counterparties),
        "open_movements": {status: int(count) for status, count in open_rows},
        "open_movements_total": sum(int(count) for _, count in open_rows),
        "avg_hours_to_ship": round(float(timed[0]), 1) if timed[0] is not None else None,
        "avg_hours_to_settle": round(float(timed[1]), 1) if timed[1] is not None else None,
        "on_time_shipment_rate": round(100.0 * float(timed[2] or 0) / timed_count, 1) if timed_count else None,
    }


async def trend(db: AsyncSession, vendor_id: UUID, days: int = 90) -> list[dict]:
    """Trade over time, bucketed by day/week/month so charts stay readable."""
    bucket = _bucket_for(days)
    period = func.date_trunc(bucket, StockMovement.completed_at).label("period")
    rows = (await db.execute(
        select(
            period,
            func.sum(case((StockMovement.from_vendor_id == vendor_id, StockMovement.total_value), else_=0)),
            func.sum(case((StockMovement.to_vendor_id == vendor_id, StockMovement.total_value), else_=0)),
            func.sum(StockMovement.quantity),
            func.count(StockMovement.id),
        )
        .where(_mine(vendor_id), StockMovement.status == RECEIVED, StockMovement.completed_at >= _since(days))
        .group_by(period)
        .order_by(period)
    )).all()
    return [
        {
            "period": r[0].date().isoformat(),
            "bucket": bucket,
            "supplied_value": round(float(r[1] or 0), 2),
            "sourced_value": round(float(r[2] or 0), 2),
            "value": round(float(r[1] or 0) + float(r[2] or 0), 2),
            "units": int(r[3] or 0),
            "movements": int(r[4] or 0),
        }
        for r in rows
    ]


async def counterparties(db: AsyncSession, vendor_id: UUID, days: int = 90, limit: int = 10) -> list[dict]:
    """Who the vendor trades with, ranked by value, with the pair's live score."""
    other_id = case(
        (StockMovement.from_vendor_id == vendor_id, StockMovement.to_vendor_id),
        else_=StockMovement.from_vendor_id,
    ).label("other_id")
    rows = (await db.execute(
        select(
            other_id,
            func.sum(case((StockMovement.from_vendor_id == vendor_id, StockMovement.total_value), else_=0)),
            func.sum(case((StockMovement.to_vendor_id == vendor_id, StockMovement.total_value), else_=0)),
            func.sum(StockMovement.quantity),
            func.count(StockMovement.id),
            func.max(StockMovement.completed_at),
        )
        .where(_mine(vendor_id), StockMovement.status == RECEIVED, StockMovement.completed_at >= _since(days))
        .group_by(other_id)
    )).all()
    if not rows:
        return []

    ids = [r[0] for r in rows]
    vendors = {v.id: v for v in (await db.execute(select(Vendor).where(Vendor.id.in_(ids)))).scalars()}
    vc = vendor_connections
    scores = {}
    for a, b, score in (await db.execute(
        select(vc.c.vendor_a_id, vc.c.vendor_b_id, vc.c.parasitism_score).where(
            or_(vc.c.vendor_a_id.in_(ids), vc.c.vendor_b_id.in_(ids)),
        )
    )).all():
        scores[(a, b)] = float(score or 0)
        scores[(b, a)] = float(score or 0)

    out = []
    for r in rows:
        v = vendors.get(r[0])
        if not v:
            continue
        supplied, sourced = float(r[1] or 0), float(r[2] or 0)
        total = supplied + sourced
        out.append({
            "vendor_id": str(v.id),
            "vendor_handle": v.vendor_handle,
            "business_name": v.business_name,
            "business_categories": v.business_categories or [],
            "supplied_value": round(supplied, 2),   # I sold to them
            "sourced_value": round(sourced, 2),     # I bought from them
            "trade_value": round(total, 2),
            "units": int(r[3] or 0),
            "movements": int(r[4] or 0),
            "balance": round((supplied - sourced) / total, 3) if total else 0.0,
            "balance_label": "balanced" if total and abs(supplied - sourced) / total <= 0.2
            else ("they buy more" if supplied >= sourced else "you buy more"),
            "parasitism_score": scores.get((vendor_id, v.id), 0.0),
            "last_trade_at": r[5].isoformat() if r[5] else None,
        })
    out.sort(key=lambda c: -c["trade_value"])
    return out[:limit]


async def categories(db: AsyncSession, vendor_id: UUID, days: int = 90, limit: int = 12) -> list[dict]:
    """What actually moves, by category — the shelf mix that earns."""
    rows = (await db.execute(
        select(
            func.coalesce(StockItem.category, "uncategorised").label("category"),
            func.sum(case((StockMovement.from_vendor_id == vendor_id, StockMovement.total_value), else_=0)),
            func.sum(case((StockMovement.to_vendor_id == vendor_id, StockMovement.total_value), else_=0)),
            func.sum(StockMovement.quantity),
            func.count(StockMovement.id),
        )
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .where(_mine(vendor_id), StockMovement.status == RECEIVED, StockMovement.completed_at >= _since(days))
        .group_by("category")
    )).all()
    out = []
    for cat, supplied, sourced, units, count in rows:
        supplied, sourced = float(supplied or 0), float(sourced or 0)
        total = supplied + sourced
        out.append({
            "category": cat,
            "supplied_value": round(supplied, 2),
            "sourced_value": round(sourced, 2),
            "trade_value": round(total, 2),
            "units": int(units or 0),
            "movements": int(count or 0),
            "share_pct": 0.0,  # filled below
        })
    total_value = sum(c["trade_value"] for c in out) or 1.0
    for c in out:
        c["share_pct"] = round(100.0 * c["trade_value"] / total_value, 1)
    out.sort(key=lambda c: -c["trade_value"])
    return out[:limit]


async def price_position(db: AsyncSession, vendor: Vendor, days: int = 90, limit: int = 8) -> list[dict]:
    """How this vendor's shelf prices compare with the network, by category.

    Only categories where both sides have something on the shelf are shown;
    the network figure is the median unit price of other vendors' visible
    stock in that category.
    """
    my_rows = (await db.execute(
        select(
            func.coalesce(StockItem.category, "uncategorised").label("category"),
            func.avg(func.coalesce(StockItem.wholesale_price, StockItem.unit_price)),
            func.count(StockItem.id),
        )
        .where(StockItem.vendor_id == vendor.id, StockItem.visible_to_network.is_(True))
        .group_by("category")
        .having(func.count(StockItem.id) > 0)
    )).all()
    my = {r[0]: (float(r[1] or 0), int(r[2])) for r in my_rows if r[1] is not None}
    if not my:
        return []

    other_rows = (await db.execute(
        select(
            func.coalesce(StockItem.category, "uncategorised").label("category"),
            func.avg(func.coalesce(StockItem.wholesale_price, StockItem.unit_price)),
            func.count(func.distinct(StockItem.vendor_id)),
        )
        .where(StockItem.vendor_id != vendor.id, StockItem.visible_to_network.is_(True),
               StockItem.quantity_available > 0, StockItem.category.in_(list(my)))
        .group_by("category")
    )).all()
    network = {r[0]: (float(r[1] or 0), int(r[2])) for r in other_rows}

    out = []
    for cat, (mine, mine_count) in my.items():
        peer = network.get(cat)
        if not peer:
            continue
        peer_price, peer_vendors = peer
        if peer_price <= 0:
            continue
        delta = round(100.0 * (mine - peer_price) / peer_price, 1)
        out.append({
            "category": cat,
            "my_avg_price": round(mine, 2),
            "my_items": mine_count,
            "network_avg_price": round(peer_price, 2),
            "network_vendors": peer_vendors,
            "delta_pct": delta,
            "position": "above" if delta > 5 else "below" if delta < -5 else "in line",
            "price_hint": None if abs(delta) <= 5 else (
                f"You are {abs(delta):.0f}% {'above' if delta > 0 else 'below'} the network median — "
                + ("defend it with quality badges or a bulk tier." if delta > 0 else "there is headroom before you look expensive.")
            ),
        })
    out.sort(key=lambda r: -abs(r["delta_pct"]))
    return out[:limit]


async def network_pulse(db: AsyncSession, days: int = 30) -> dict:
    """Platform-level context so a vendor can read their own numbers against it."""
    since = _since(days)
    totals = (await db.execute(
        select(func.coalesce(func.sum(StockMovement.total_value), 0.0), func.count(StockMovement.id),
               func.count(func.distinct(StockMovement.from_vendor_id)))
        .where(StockMovement.status == RECEIVED, StockMovement.completed_at >= since)
    )).one()
    active_vendors = (await db.execute(
        select(func.count(func.distinct(StockMovement.to_vendor_id)))
        .where(StockMovement.status == RECEIVED, StockMovement.completed_at >= since)
    )).scalar() or 0
    new_vendors = (await db.execute(
        select(func.count(Vendor.id)).where(Vendor.joined_at >= since)
    )).scalar() or 0
    top_categories = (await db.execute(
        select(func.coalesce(StockItem.category, "uncategorised"),
               func.coalesce(func.sum(StockMovement.total_value), 0.0))
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .where(StockMovement.status == RECEIVED, StockMovement.completed_at >= since)
        .group_by(StockItem.category)
        .order_by(func.sum(StockMovement.total_value).desc())
        .limit(5)
    )).all()
    return {
        "days": days,
        "trade_value": round(float(totals[0] or 0), 2),
        "movements": int(totals[1] or 0),
        "active_suppliers": int(totals[2] or 0),
        "active_vendors": active_vendors + int(totals[2] or 0),
        "new_vendors": int(new_vendors or 0),
        "top_categories": [{"category": c, "trade_value": round(float(v or 0), 2)} for c, v in top_categories],
    }


async def overview(db: AsyncSession, vendor: Vendor, days: int = 90) -> dict:
    """Everything the analytics dashboard opens with, in one round trip."""
    stats = await _movement_stats(db, vendor.id, days)
    pulse = await network_pulse(db, days)
    return {
        "vendor_handle": vendor.vendor_handle,
        "days": days,
        "summary": stats,
        "trend": await trend(db, vendor.id, days),
        "counterparties": await counterparties(db, vendor.id, days, limit=5),
        "categories": await categories(db, vendor.id, days),
        "price_position": await price_position(db, vendor, days),
        "network": pulse,
        "share_of_network_pct": round(100.0 * stats["trade_value"] / pulse["trade_value"], 2)
        if pulse["trade_value"] else 0.0,
        "parasitism_index": vendor.parasitism_index,
        "network_score": vendor.network_score,
    }


async def counterparty_detail(db: AsyncSession, vendor: Vendor, other: Vendor, days: int = 180) -> dict:
    """The full trading history with one counterparty — both directions, by month."""
    pair = or_(
        and_(StockMovement.from_vendor_id == vendor.id, StockMovement.to_vendor_id == other.id),
        and_(StockMovement.from_vendor_id == other.id, StockMovement.to_vendor_id == vendor.id),
    )
    period = func.date_trunc("month", StockMovement.completed_at).label("period")
    rows = (await db.execute(
        select(
            period,
            func.sum(case((StockMovement.from_vendor_id == vendor.id, StockMovement.total_value), else_=0)),
            func.sum(case((StockMovement.to_vendor_id == vendor.id, StockMovement.total_value), else_=0)),
            func.count(StockMovement.id),
        )
        .where(pair, StockMovement.status == RECEIVED, StockMovement.completed_at >= _since(days))
        .group_by(period).order_by(period)
    )).all()

    items = (await db.execute(
        select(func.coalesce(StockItem.name, "stock"),
               func.sum(StockMovement.total_value),
               func.sum(StockMovement.quantity))
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .where(pair, StockMovement.status == RECEIVED, StockMovement.completed_at >= _since(days))
        .group_by(StockItem.name)
        .order_by(func.sum(StockMovement.total_value).desc())
        .limit(8)
    )).all()

    shipped = (await db.execute(
        select(func.count(StockMovement.id), func.coalesce(func.sum(StockMovement.total_value), 0.0))
        .where(StockMovement.from_vendor_id == vendor.id, StockMovement.to_vendor_id == other.id,
               StockMovement.status == RECEIVED, StockMovement.completed_at >= _since(days))
    )).one()
    bought = (await db.execute(
        select(func.count(StockMovement.id), func.coalesce(func.sum(StockMovement.total_value), 0.0))
        .where(StockMovement.from_vendor_id == other.id, StockMovement.to_vendor_id == vendor.id,
               StockMovement.status == RECEIVED, StockMovement.completed_at >= _since(days))
    )).one()

    vc = vendor_connections
    score = (await db.execute(
        select(vc.c.parasitism_score).where(or_(
            and_(vc.c.vendor_a_id == vendor.id, vc.c.vendor_b_id == other.id),
            and_(vc.c.vendor_a_id == other.id, vc.c.vendor_b_id == vendor.id),
        ))
    )).scalar()

    return {
        "vendor_handle": other.vendor_handle,
        "business_name": other.business_name,
        "days": days,
        "you_sold": {"movements": int(shipped[0] or 0), "value": round(float(shipped[1] or 0), 2)},
        "you_bought": {"movements": int(bought[0] or 0), "value": round(float(bought[1] or 0), 2)},
        "net_position": round(float(shipped[1] or 0) - float(bought[1] or 0), 2),
        "parasitism_score": float(score or 0),
        "history": [
            {"period": r[0].date().isoformat(), "sold_value": round(float(r[1] or 0), 2),
             "bought_value": round(float(r[2] or 0), 2), "movements": int(r[3] or 0)}
            for r in rows
        ],
        "top_items": [{"name": i[0], "value": round(float(i[1] or 0), 2), "units": int(i[2] or 0)} for i in items],
    }

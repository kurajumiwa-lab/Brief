"""MARKET NEWS — information, not commentary.

    GET /api/news?days=7

Derives report lines from rows written inside the window. Each item carries a
kind and a kind-specific `data` payload shaped for its card template, with the
important information first (price / route / date / window) and the extra
detail available for tap-to-expand. Every number is a real row; a price is
always what a vendor stated (and the item says whether it is the unit or
wholesale price), never a computed "market price".
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.events import Event
from app.models.groups import VendorGroup
from app.models.market_locks import LockWindow, MarketZone
from app.models.stock import StockItem, StockMovement
from app.models.tools import ToolListing
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor

router = APIRouter()

MONEY = "KES"
FRESH_MS = 24 * 3600 * 1000  # "fresh" = written in the last 24h


def _money(v):
    if v is None:
        return None
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _clip(text, n=200):
    if not text:
        return None
    text = str(text).strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def _enum(v):
    return v.value if hasattr(v, "value") else (str(v) if v is not None else None)


def _iso(v):
    return v.isoformat() if v else None


@router.get("")
async def market_news(
    days: int = Query(7, ge=1, le=30),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    since = now - timedelta(days=days)
    items = []

    def fresh(at):
        return (now - at).total_seconds() * 1000 <= FRESH_MS

    # ── Stock lines created or re-stated inside the window ────────────────
    vendors_res = await db.execute(select(Vendor))
    vendors = {v.id: v for v in vendors_res.scalars().all()}

    stock_res = await db.execute(
        select(StockItem).where(
            or_(StockItem.created_at >= since, StockItem.updated_at >= since)
        )
    )
    for it in stock_res.scalars().all():
        v = vendors.get(it.vendor_id)
        unit = _money(it.unit_price)
        whole = _money(it.wholesale_price)
        display = unit if unit is not None else whole
        price_is = "unit" if unit is not None else ("wholesale" if whole is not None else None)
        at = it.updated_at or it.created_at or now
        is_new = (it.created_at or now) >= since
        items.append({
            "id": f"stock-{it.id}",
            "kind": "stock",
            "at": at.isoformat(),
            "fresh": fresh(at),
            "link": {"to": "/stock", "q": {"tab": "network", "search": it.name}},
            "data": {
                "name": it.name,
                "is_new": is_new,
                "vendor": v.business_name if v else "A vendor",
                "vendor_handle": v.vendor_handle if v else None,
                "price": display,
                "price_is": price_is,
                "unit_price": unit,
                "wholesale_price": whole,
                "quantity_available": it.quantity_available,
                "unit_of_measure": it.unit_of_measure,
                "min_order": it.min_order_quantity if (it.min_order_quantity or 1) > 1 else None,
                "category": it.category,
                "subcategory": it.subcategory,
                "quality": _enum(it.quality_status),
                "origin": it.origin_country,
                "batch": it.batch_number,
                "expiry": (it.expiry_date.date().isoformat() if it.expiry_date else None),
                "tags": list(it.tags or [])[:4],
                "sku": it.sku,
                "description": _clip(it.description),
            },
        })

    # ── Movements inside the window ───────────────────────────────────────
    item_res = await db.execute(select(StockItem))
    items_by_id = {i.id: i for i in item_res.scalars().all()}
    mov_res = await db.execute(select(StockMovement).where(StockMovement.created_at >= since))
    for m in mov_res.scalars().all():
        frm = vendors.get(m.from_vendor_id)
        to = vendors.get(m.to_vendor_id)
        it = items_by_id.get(m.stock_item_id)
        at = m.created_at or now
        items.append({
            "id": f"movement-{m.id}",
            "kind": "movement",
            "at": at.isoformat(),
            "fresh": fresh(at),
            "link": {"to": "/stock", "q": {"tab": "movements"}},
            "data": {
                "name": it.name if it else "Stock",
                "quantity": m.quantity,
                "unit": it.unit_of_measure if it else "units",
                "from": {"name": frm.business_name if frm else "—", "handle": frm.vendor_handle if frm else None},
                "to": {"name": to.business_name if to else "—", "handle": to.vendor_handle if to else None},
                "total_value": _money(m.total_value),
                "status": m.status,
                "movement_type": m.movement_type,
                "times": {
                    "created": _iso(m.created_at),
                    "confirmed": _iso(m.confirmed_at),
                    "shipped": _iso(m.shipped_at),
                    "completed": _iso(m.completed_at),
                },
                "notes": _clip(m.notes),
            },
        })

    # ── Events starting within 30 days ────────────────────────────────────
    ev_res = await db.execute(
        select(Event).where(Event.start_date >= now - timedelta(days=1))
    )
    for e in ev_res.scalars().all():
        org = vendors.get(e.organizer_id)
        items.append({
            "id": f"event-{e.id}",
            "kind": "event",
            "at": e.start_date.isoformat(),
            "fresh": False,
            "link": {"to": "/events", "q": {}},
            "data": {
                "title": e.title,
                "dow": e.start_date.strftime("%a"),
                "day": e.start_date.day,
                "mon": e.start_date.strftime("%b"),
                "time": e.start_date.strftime("%H:%M"),
                "location": e.location or ("online" if e.is_virtual else "place not stated"),
                "is_virtual": bool(e.is_virtual),
                "virtual_link": e.virtual_link,
                "registered": e.registered_count,
                "capacity": e.max_vendors,
                "fee": _money(e.entry_fee) if (e.entry_fee or 0) > 0 else None,
                "event_type": e.event_type,
                "organizer": org.business_name if org else "Organiser",
                "requirements": e.vendor_requirements or {},
                "status": e.status,
            },
        })

    # ── Groups opened inside the window (groups carry no updated_at) ───────
    grp_res = await db.execute(select(VendorGroup).where(VendorGroup.created_at >= since))
    for g in grp_res.scalars().all():
        at = g.created_at or now
        items.append({
            "id": f"group-{g.id}",
            "kind": "group",
            "at": at.isoformat(),
            "fresh": fresh(at),
            "link": {"to": "/groups", "q": {}},
            "data": {
                "name": g.name,
                "member_count": g.member_count,
                "max_members": g.max_members,
                "group_type": _enum(g.group_type),
                "category": g.category,
                "region": g.region,
                "description": _clip(g.description),
                "requires_approval": bool(g.requires_approval),
                "tags": list(g.tags or [])[:4],
            },
        })

    # ── Flash-lock windows open today (Nairobi-local date) ────────────────
    zone_res = await db.execute(select(MarketZone))
    zones = {z.id: z for z in zone_res.scalars().all()}
    win_res = await db.execute(
        select(LockWindow)
        .where(LockWindow.local_date == now.date(), LockWindow.status.in_(["open", "rolling"]))
    )
    for w in win_res.scalars().all():
        z = zones.get(w.zone_id)
        items.append({
            "id": f"lock-{w.id}",
            "kind": "lock",
            "at": w.created_at.isoformat(),
            "fresh": fresh(w.created_at),
            "link": {"to": "/locks", "q": {}},
            "data": {
                "zone": z.name if z else "Market zone",
                "city": z.city if z else None,
                "status": w.status,
                "opens": w.opens_at.strftime("%H:%M"),
                "closes": w.closes_at.strftime("%H:%M"),
                "delivery": w.delivery_at.strftime("%H:%M"),
                "roll_count": w.roll_count,
            },
        })

    items.sort(key=lambda x: x["at"], reverse=True)
    items = items[:30]

    # ── Tile counts: one pass per table, counts only ──────────────────────
    async def count(stmt):
        res = await db.execute(stmt)
        return res.scalar() or 0

    counts = {
        "news": len(items),
        "suppliers": await count(select(func.count()).select_from(Vendor)),
        "stock": await count(select(func.count()).select_from(StockItem).where(StockItem.visible_to_network.is_(True))),
        "rentals": await count(
            select(func.count()).select_from(ToolListing).where(ToolListing.is_available.is_(True))
        ),
        "groups": await count(select(func.count()).select_from(VendorGroup)),
        "events": await count(select(func.count()).select_from(Event).where(Event.start_date >= now)),
    }

    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    new_today = await count(
        select(func.count()).select_from(StockItem).where(StockItem.created_at >= day_start)
    ) + await count(
        select(func.count()).select_from(StockMovement).where(StockMovement.created_at >= day_start)
    )

    return {
        "items": items,
        "counts": counts,
        "window_days": days,
        "new_today": new_today,
        "generated_at": now.isoformat(),
    }

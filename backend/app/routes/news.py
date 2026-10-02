"""MARKET NEWS — information, not commentary.

    GET /api/news?days=7

Derives short report lines from rows that were written inside the window:

  * stock lines created or re-stated (what, vendor, price, when stated)
  * movements (who moved what to whom, for how much, what state it's in)
  * events starting soon (title, place, date)
  * groups touched recently (name, member count)
  * daily flash-lock windows open today (zone, pick times)

Each item carries its source and the row's own timestamp — the way a trader
checks whether a note on the board is still fresh. No line is authored and no
price is invented: a stock line's price is what its vendor stated, shown as
stated, never as a "market price".

The tile counts behind the home shelf ride along: every number is a count of
real rows, and a section with nothing underneath gets zero (the shelf renders
that as "—"), never a padded figure.
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


def _money(v):
    if v is None:
        return None
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


@router.get("")
async def market_news(
    days: int = Query(7, ge=1, le=30),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    since = now - timedelta(days=days)
    items = []

    # ── Stock lines created or re-stated inside the window ────────────────
    vendors = {v.id: v for v in (await db.execute(select(Vendor))).scalars().all()}
    stock_q = await db.execute(
        select(StockItem).where(
            or_(StockItem.created_at >= since, StockItem.updated_at >= since)
        )
    )
    for it in stock_q.scalars().all():
        v = vendors.get(it.vendor_id)
        price = _money(it.unit_price if it.unit_price is not None else it.wholesale_price)
        is_new = (it.created_at or now) >= since
        items.append(
            {
                "id": f"stock-{it.id}",
                "kind": "stock",
                "headline": f"{'New on shelf: ' if is_new else 'Re-stated: '}{it.name}",
                "source": v.business_name if v else "A vendor",
                "detail": f"{it.category or 'no category'}" + (f" · min {it.min_order_quantity}" if (it.min_order_quantity or 1) > 1 else ""),
                "price": price,
                "currency": MONEY,
                "at": (it.updated_at or it.created_at or now).isoformat(),
                "link": {"to": "/stock", "q": {"tab": "network", "search": it.name}},
            }
        )

    # ── Movements inside the window ───────────────────────────────────────
    items_by_id = {i.id: i for i in (await db.execute(select(StockItem))).scalars().all()}
    mov_q = await db.execute(select(StockMovement).where(StockMovement.created_at >= since))
    for m in mov_q.scalars().all():
        frm = vendors.get(m.from_vendor_id)
        to = vendors.get(m.to_vendor_id)
        it = items_by_id.get(m.stock_item_id)
        items.append(
            {
                "id": f"movement-{m.id}",
                "kind": "movement",
                "headline": f"{it.name if it else 'Stock'} · {m.quantity} moved",
                "source": f"{frm.business_name if frm else '—'} → {to.business_name if to else '—'}",
                "detail": f"{m.status}" + (f" · {m.movement_type}" if m.movement_type else ""),
                "price": _money(m.total_value),
                "currency": MONEY,
                "at": (m.created_at or now).isoformat(),
                "link": {"to": "/stock", "q": {"tab": "movements"}},
            }
        )

    # ── Events starting within 30 days ────────────────────────────────────
    ev_q = await db.execute(
        select(Event).where(Event.start_date >= now - timedelta(days=1))
    )
    for e in ev_q.scalars().all():
        org = vendors.get(e.organizer_id)
        items.append(
            {
                "id": f"event-{e.id}",
                "kind": "event",
                "headline": f"Event: {e.title}",
                "source": org.business_name if org else "Organiser",
                "detail": (e.location or ("online" if e.is_virtual else "place not stated"))
                + f" · {e.start_date.strftime('%a %d %b')} · {e.registered_count}/{e.max_vendors} registered",
                "price": _money(e.entry_fee) if (e.entry_fee or 0) > 0 else None,
                "currency": MONEY,
                "at": e.start_date.isoformat(),
                "link": {"to": "/events", "q": {}},
            }
        )

    # ── Groups opened inside the window (groups carry no updated_at) ───────
    grp_q = await db.execute(select(VendorGroup).where(VendorGroup.created_at >= since))
    for g in grp_q.scalars().all():
        items.append(
            {
                "id": f"group-{g.id}",
                "kind": "group",
                "headline": f"Group: {g.name}",
                "source": "Vendor groups",
                "detail": f"{g.member_count} members" + (f" · {g.group_type.value if hasattr(g.group_type, 'value') else g.group_type}" if g.group_type else ""),
                "price": None,
                "currency": MONEY,
                "at": (g.created_at or now).isoformat(),
                "link": {"to": "/groups", "q": {}},
            }
        )

    # ── Flash-lock windows open today (Nairobi-local date) ────────────────
    zones = {z.id: z for z in (await db.execute(select(MarketZone))).scalars().all()}
    win_q = await db.execute(
        select(LockWindow)
        .where(LockWindow.local_date == now.date(), LockWindow.status.in_(["open", "rolling"]))
    )
    for w in win_q.scalars().all():
        z = zones.get(w.zone_id)
        items.append(
            {
                "id": f"lock-{w.id}",
                "kind": "lock",
                "headline": f"Flash lock: {z.name if z else 'Market zone'}",
                "source": "Market locks",
                "detail": f"pick {w.opens_at.strftime('%H:%M')}–{w.closes_at.strftime('%H:%M')} · deliver by {w.delivery_at.strftime('%H:%M')}",
                "price": None,
                "currency": MONEY,
                "at": w.created_at.isoformat(),
                "link": {"to": "/locks", "q": {}},
            }
        )

    items.sort(key=lambda x: x["at"], reverse=True)
    items = items[:30]

    # ── Tile counts: one pass per table, counts only ──────────────────────
    async def count(stmt):
        return (await db.execute(stmt)).scalar() or 0

    counts = {
        "news": len(items),
        "suppliers": await count(select(func.count()).select_from(Vendor)),
        "stock": await count(select(func.count()).select_from(StockItem).where(StockItem.visible_to_network.is_(True))),
        "rentals": await count(
            select(func.count()).select_from(ToolListing).where(ToolListing.is_available.is_(True))
        ),
        "groups": await count(select(func.count()).select_from(Group)),
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

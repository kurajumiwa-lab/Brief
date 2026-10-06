"""SURFACE FEED + PRICE INDEX + MAP PINS.

    GET /api/surface/feed    one mixed feed of real surfaces: product, call-up,
                             movement, event, market, place, vendor, index.
                             Round-robin across kinds by freshness — no ranking
                             algorithm, no engagement score, no fake trend.
    GET /api/surface/index   the resellable artifact: median of N STATED
                             prices per category. n >= 3 or the category does
                             not appear (a median of one price is a price,
                             not an index). No vendor identity, ever.
    GET /api/surface/map     the three map layers: vendors, markets, places.

The feed is the operating surface: every card is a row someone wrote, leads
with the one number a trader acts on, and links to the place the action
lives. A kind with no rows simply contributes no cards — the feed never
pads itself.
"""

import math
from datetime import datetime, timedelta
from typing import Optional


from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.events import Event
from app.models.hustle import HustleJobCall
from app.models.market_locks import MarketMember, MarketZone
from app.models.public_place import PublicPlace
from app.models.stock import StockItem, StockMovement
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor

router = APIRouter()

MONEY = "KES"
INDEX_MIN_N = 3  # a median is an index only with a sample


def _dist_km(lat1, lng1, lat2, lng2):
    """Great-circle distance, or None when either point is unknown."""
    if None in (lat1, lng1, lat2, lng2):
        return None
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def _money(v):
    if v is None:
        return None
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _iso(v):
    return v.isoformat() if v else None


def _stated_price(item):
    """(price, label) — what the vendor actually stated, and which price it is."""
    unit = _money(item.unit_price)
    whole = _money(item.wholesale_price)
    if unit is not None:
        return unit, "unit"
    if whole is not None:
        return whole, "wholesale"
    return None, None


def _median(values):
    vs = sorted(values)
    n = len(vs)
    if n == 0:
        return None
    mid = n // 2
    if n % 2 == 1:
        return vs[mid]
    return (vs[mid - 1] + vs[mid]) / 2


# ── PRICE INDEX ──────────────────────────────────────────────────────────────
def _price_index_rows(items):
    """Group stated prices by category. A category appears only with n >= 3 —
    below that the 'index' would be one or two vendors' prices, which is a
    leak, not a statistic. No vendor identity is ever attached.

    Takes StockItem objects directly (a scalar select, not a tuple select)."""
    by_cat = {}
    for item in items:
        price, _label = _stated_price(item)
        if price is None:
            continue
        cat = (item.category or "uncategorised").lower().strip() or "uncategorised"
        entry = by_cat.setdefault(cat, {"prices": [], "as_of": None})
        entry["prices"].append(price)
        updated = item.updated_at
        if updated is not None and (entry["as_of"] is None or updated > entry["as_of"]):
            entry["as_of"] = updated
    out = []
    for cat, entry in by_cat.items():
        n = len(entry["prices"])
        if n < INDEX_MIN_N:
            continue
        out.append({
            "category": cat,
            "n": n,
            "median": _median(entry["prices"]),
            "min": min(entry["prices"]),
            "max": max(entry["prices"]),
            "currency": MONEY,
            "as_of": _iso(entry["as_of"]),
        })
    out.sort(key=lambda r: r["n"], reverse=True)
    return out


async def _price_index(db: AsyncSession, limit: int = 20):
    res = await db.execute(
        select(StockItem).where(StockItem.visible_to_network.is_(True))
    )
    rows = res.scalars().all()
    return _price_index_rows(rows)[:limit]


# ── PRICE INDEX ENDPOINT — the resellable artifact, computed live ───────────
@router.get("/index")
async def price_index(
    category: Optional[str] = None,
    limit: int = 50,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    rows = await _price_index(db, limit=200)
    if category:
        rows = [r for r in rows if r["category"] == category.lower().strip()]
    return {
        "rows": rows[:limit],
        "rule": (
            f"median of n stated vendor prices per category; a category appears only "
            f"with n >= {INDEX_MIN_N}; no vendor identity is ever attached"
        ),
        "generated_at": datetime.utcnow().isoformat(),
    }


# ── MAP PINS ─────────────────────────────────────────────────────────────────
@router.get("/map")
async def map_pins(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    vlat, vlng = vendor.geo_lat, vendor.geo_lng

    zres = await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True)))
    zones = zres.scalars().all()
    mres = await db.execute(
        select(MarketMember.zone_id, func.count(MarketMember.id))
        .group_by(MarketMember.zone_id)
    )
    member_counts = {r[0]: r[1] for r in mres.all()}
    markets = []
    for z in zones:
        if z.center_lat is None:
            continue
        d = _dist_km(vlat, vlng, z.center_lat, z.center_lng)
        markets.append({
            "id": str(z.id), "name": z.name, "city": z.city, "country": z.country,
            "lat": z.center_lat, "lng": z.center_lng, "radius_km": z.radius_km,
            "member_count": member_counts.get(z.id, 0),
            "distance_km": round(d, 1) if d is not None else None,
        })
    markets.sort(key=lambda m: (m["distance_km"] is None, m["distance_km"] or 0))

    pres = await db.execute(
        select(PublicPlace).where(PublicPlace.status.in_(["active", "claimed"]))
    )
    places = []
    for p in pres.scalars().all():
        if p.lat is None:
            continue
        d = _dist_km(vlat, vlng, p.lat, p.lng)
        places.append({
            "id": str(p.id), "name": p.name, "category": p.category,
            "zone_name": p.zone_name, "lat": p.lat, "lng": p.lng,
            "claimed_by_me": p.claimed_by_vendor_id == vendor.id,
            "distance_km": round(d, 1) if d is not None else None,
        })
    places.sort(key=lambda p: (p["distance_km"] is None, p["distance_km"] or 0))

    vres = await db.execute(select(Vendor).where(Vendor.geo_lat.is_not(None)))
    vendors = []
    for v in vres.scalars().all():
        if v.id == vendor.id:
            continue
        d = _dist_km(vlat, vlng, v.geo_lat, v.geo_lng)
        vendors.append({
            "id": str(v.id), "name": v.business_name, "handle": v.vendor_handle,
            "categories": list(v.business_categories or [])[:4],
            "location": v.physical_location,
            "lat": v.geo_lat, "lng": v.geo_lng,
            "distance_km": round(d, 1) if d is not None else None,
        })
    vendors.sort(key=lambda v: (v["distance_km"] is None, v["distance_km"] or 0))

    return {
        "viewer": {"lat": vlat, "lng": vlng},
        "vendors": vendors,
        "markets": markets,
        "places": places,
    }


# ── SURFACE FEED ─────────────────────────────────────────────────────────────
@router.get("/feed")
async def surface_feed(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """One mixed feed. Per kind: newest (or most urgent) real rows, capped.
    Interleaved round-robin so one kind never drowns the others. A kind with
    no rows contributes nothing."""
    now = datetime.utcnow()
    vlat, vlng = vendor.geo_lat, vendor.geo_lng

    def card(id_, kind, at, data, link, action):
        return {
            "id": id_, "kind": kind, "at": _iso(at),
            "data": data, "link": link, "action": action,
        }

    buckets = {}

    # product — hero: the stated price
    res = await db.execute(
        select(StockItem)
        .where(StockItem.visible_to_network.is_(True))
        .order_by(StockItem.updated_at.desc())
        .limit(12)
    )
    vres = await db.execute(select(Vendor))
    vendors_by_id = {v.id: v for v in vres.scalars().all()}
    prods = []
    for it in res.scalars().all():
        price, label = _stated_price(it)
        if price is None:
            continue
        v = vendors_by_id.get(it.vendor_id)
        prods.append(card(
            f"prod-{it.id}", "product", it.updated_at or it.created_at,
            {
                "name": it.name, "price": price, "price_label": label,
                "currency": MONEY,
                "vendor": v.business_name if v else "A vendor",
                "quantity_available": it.quantity_available,
                "unit_of_measure": it.unit_of_measure,
                "category": it.category,
                "quality": it.quality_status.value if hasattr(it.quality_status, "value") else it.quality_status,
            },
            {"to": "/stock", "q": {"tab": "network", "search": it.name}},
            {"label": "View stock", "to": "/stock"},
        ))
    buckets["product"] = prods

    # call-up — hero: the pay. Urgency = soonest expiry first.
    res = await db.execute(
        select(HustleJobCall)
        .where(HustleJobCall.status == "open",
               HustleJobCall.expires_at >= now,
               HustleJobCall.vendor_id != vendor.id)
        .order_by(HustleJobCall.expires_at.asc())
        .limit(6)
    )
    calls = []
    for c in res.scalars().all():
        client = vendors_by_id.get(c.vendor_id)
        d = _dist_km(vlat, vlng, c.geo_lat, c.geo_lng)
        calls.append(card(
            f"call-{c.id}", "callup", c.created_at,
            {
                "title": c.title, "pay": c.pay_kes, "currency": MONEY,
                "skill": c.skill, "client": client.business_name if client else "A client",
                "location": c.location,
                "distance_km": round(d, 1) if d is not None else None,
                "expires_at": _iso(c.expires_at),
                "squad": c.squad_id is not None,
            },
            {"to": "/tasks"},
            {"label": "Accept", "to": "/tasks"},
        ))
    buckets["callup"] = calls

    # movement — hero: the route
    res = await db.execute(
        select(StockMovement).where(StockMovement.created_at >= now - timedelta(days=7))
        .order_by(StockMovement.created_at.desc()).limit(4)
    )
    items_by_id = {}
    res2 = await db.execute(select(StockItem))
    for it in res2.scalars().all():
        items_by_id[it.id] = it
    moves = []
    for m in res.scalars().all():
        frm = vendors_by_id.get(m.from_vendor_id)
        to = vendors_by_id.get(m.to_vendor_id)
        it = items_by_id.get(m.stock_item_id)
        moves.append(card(
            f"move-{m.id}", "movement", m.created_at,
            {
                "name": it.name if it else "Stock",
                "quantity": m.quantity,
                "unit": it.unit_of_measure if it else "units",
                "from_name": frm.business_name if frm else "—",
                "to_name": to.business_name if to else "—",
                "total_value": _money(m.total_value),
                "currency": MONEY,
                "status": m.status,
            },
            {"to": "/stock", "q": {"tab": "movements"}},
            {"label": "View movements", "to": "/stock"},
        ))
    buckets["movement"] = moves

    # event — hero: the date
    res = await db.execute(
        select(Event).where(Event.start_date >= now)
        .order_by(Event.start_date.asc()).limit(3)
    )
    evs = []
    for e in res.scalars().all():
        org = vendors_by_id.get(e.organizer_id)
        evs.append(card(
            f"ev-{e.id}", "event", e.start_date,
            {
                "title": e.title,
                "dow": e.start_date.strftime("%a"), "day": e.start_date.day,
                "mon": e.start_date.strftime("%b"), "time": e.start_date.strftime("%H:%M"),
                "location": e.location or ("online" if e.is_virtual else "place not stated"),
                "registered": e.registered_count, "capacity": e.max_vendors,
                "fee": _money(e.entry_fee) if (e.entry_fee or 0) > 0 else None,
                "currency": MONEY,
                "organizer": org.business_name if org else "Organiser",
            },
            {"to": "/events"},
            {"label": "Open events", "to": "/events"},
        ))
    buckets["event"] = evs

    # market — hero: members registered (a market's real heat)
    zres = await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True)))
    zones = zres.scalars().all()
    mres = await db.execute(
        select(MarketMember.zone_id, func.count(MarketMember.id))
        .group_by(MarketMember.zone_id)
    )
    member_counts = {r[0]: r[1] for r in mres.all()}
    mres2 = await db.execute(
        select(PublicPlace.zone_id, func.count(PublicPlace.id))
        .where(PublicPlace.status.in_(["active", "claimed"]))
        .group_by(PublicPlace.zone_id)
    )
    place_counts = {r[0]: r[1] for r in mres2.all()}
    mkts = []
    for z in zones:
        if z.center_lat is None:
            continue
        d = _dist_km(vlat, vlng, z.center_lat, z.center_lng)
        mkts.append(card(
            f"mkt-{z.id}", "market", z.last_ingest_at or z.created_at,
            {
                "name": z.name, "city": z.city, "country": z.country,
                "members": member_counts.get(z.id, 0),
                "places": place_counts.get(z.id, 0),
                "distance_km": round(d, 1) if d is not None else None,
            },
            {"to": "/markets"},
            {"label": "Open market", "to": "/markets"},
        ))
    mkts.sort(key=lambda c: (-c["data"]["members"], c["data"]["distance_km"] is None, c["data"]["distance_km"] or 0))
    buckets["market"] = mkts[:6]

    # place — hero: distance (or the category when no location is set)
    pres = await db.execute(
        select(PublicPlace)
        .where(PublicPlace.status.in_(["active", "claimed"]))
        .order_by(PublicPlace.last_checked_at.desc())
        .limit(8)
    )
    pls = []
    for p in pres.scalars().all():
        if p.lat is None:
            continue
        d = _dist_km(vlat, vlng, p.lat, p.lng)
        pls.append(card(
            f"plc-{p.id}", "place", p.last_checked_at or p.created_at,
            {
                "name": p.name, "category": p.category, "zone_name": p.zone_name,
                "distance_km": round(d, 1) if d is not None else None,
                "claimed_by_me": p.claimed_by_vendor_id == vendor.id,
                "checked_at": _iso(p.last_checked_at),
            },
            {"to": "/map"},
            {"label": "Claim" if not (p.claimed_by_vendor_id == vendor.id) else "Yours", "to": "/map"},
        ))
    buckets["place"] = pls

    # vendor — hero: distance (the people you can trade with, nearest first)
    vres2 = await db.execute(
        select(Vendor).where(Vendor.geo_lat.is_not(None), Vendor.id != vendor.id)
        .order_by(Vendor.last_active.desc().nulls_last())
        .limit(10)
    )
    vnds = []
    for v in vres2.scalars().all():
        d = _dist_km(vlat, vlng, v.geo_lat, v.geo_lng)
        vnds.append(card(
            f"vnd-{v.id}", "vendor", v.last_active or v.joined_at,
            {
                "name": v.business_name, "handle": v.vendor_handle,
                "categories": list(v.business_categories or [])[:3],
                "location": v.physical_location,
                "distance_km": round(d, 1) if d is not None else None,
            },
            {"to": "/network"},
            {"label": "Connect", "to": "/network"},
        ))
    vnds.sort(key=lambda c: (c["data"]["distance_km"] is None, c["data"]["distance_km"] or 0))
    buckets["vendor"] = vnds[:8]

    # index — hero: the median of N stated prices (n >= 3 only)
    index_rows = await _price_index(db, limit=3)
    idxs = []
    for r in index_rows:
        idxs.append(card(
            f"idx-{r['category']}", "index", None,
            {
                "category": r["category"], "median": r["median"], "min": r["min"],
                "max": r["max"], "n": r["n"], "currency": r["currency"],
                "as_of": r["as_of"],
            },
            {"to": "/search", "q": {"tab": "products"}},
            {"label": "View the sample", "to": "/search"},
        ))
    buckets["index"] = idxs

    # Round-robin interleave by kind, each bucket pre-sorted by urgency/freshness.
    order = ["callup", "product", "movement", "event", "market", "place", "vendor", "index"]
    feed = []
    longest = max((len(buckets.get(k, [])) for k in order), default=0)
    for i in range(longest):
        for k in order:
            bucket = buckets.get(k, [])
            if i < len(bucket):
                feed.append(bucket[i])
    return {"cards": feed, "viewer": {"lat": vlat, "lng": vlng}}

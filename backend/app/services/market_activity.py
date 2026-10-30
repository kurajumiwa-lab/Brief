"""A market is where business happens, not a pin on a map.

The problem this module solves, in one sentence: a market shelf that shows
"0 registered vendors" is a directory of empty rooms, and a market with 100
registrations but two traders who actually have stock should not outrank a
market with 20 that do.

So everything here is measured in **activity**, and every number is a row:

  · **active** — a registered vendor with something on their shelf *right now*
    (visible to the network, quantity available above zero). This is the number
    a vendor acts on, and it is the first thing every payload carries.
  · **registered** — `market_members` rows. Kept, because it is a real fact, but
    never the headline.
  · **listings** — the member vendors' own stock rows. Not copied, not
    re-uploaded, not cached into a market table. The shelf is a view.

That last point is the architecture, and it is deliberate:

    A vendor publishes a product ONCE, on their own shelf.
    The market shelf is a query over `market_members` joined to `stock_items`.
    Therefore: no duplicate listings, no second price to keep in sync, and a
    vendor leaving a market cannot leave a ghost product behind.

Two product rules are enforced here rather than left to the UI:

  · **Membership and visibility are separate.** A vendor can belong to a market
    without publishing every product there — that is what `visible_to_network`
    already means, and this module never ignores it.
  · **An empty market is an invitation, not a zero.** `empty` and
    `invitation` come back together, so no screen has to invent a friendly
    sentence for a graveyard.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.market_locks import MarketMember, MarketZone
from app.models.stock import StockItem
from app.models.tools import ToolCategory, ToolListing
from app.models.vendor import Vendor

# What counts as a service versus a piece of equipment, in the tool taxonomy the
# product already has. Nothing new is invented here.
SERVICE_CATEGORIES = (
    ToolCategory.TRANSPORT,
    ToolCategory.COURIER,
    ToolCategory.POPUP_SHOP,
    ToolCategory.HOTEL_SOURCING,
    ToolCategory.PACKAGING,
)
EQUIPMENT_CATEGORIES = (
    ToolCategory.EQUIPMENT,
    ToolCategory.WAREHOUSE,
    ToolCategory.COLD_STORAGE,
)

RECENT_DAYS = 30

# The radius a person means by "near me" at a market. 150 km was a regional
# scan; this is a walk, a matatu, or a boda ride.
DEFAULT_RADIUS_KM = 25.0
MAX_RADIUS_KM = 500.0


def distance_km(lat1, lng1, lat2, lng2) -> Optional[float]:
    """Great-circle distance, or None when either end is unlocated.

    None is never coerced to 0. An unlocated market is *unknown* distance, and
    showing it as "0 km" would put it at the top of every nearby list.
    """
    if None in (lat1, lng1, lat2, lng2):
        return None
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 6371 * 2 * math.asin(math.sqrt(a))


# ── the bulk measure ─────────────────────────────────────────────────────────


async def activity_by_zone(db: AsyncSession, zone_ids: Iterable) -> dict:
    """Every market's activity in three queries, not three per market.

    The shape is `{zone_id: {...}}` and the caller merges it into whatever it is
    already returning. Deliberately bulk: a list of 60 markets must not become
    180 round trips on a phone in a market with two bars of signal.
    """
    ids = list(zone_ids)
    if not ids:
        return {}

    members = dict(
        (
            await db.execute(
                select(MarketMember.zone_id, func.count(MarketMember.id))
                .where(MarketMember.zone_id.in_(ids))
                .group_by(MarketMember.zone_id)
            )
        ).all()
    )

    since = datetime.utcnow() - timedelta(days=RECENT_DAYS)

    # One pass over the members' stock: per (zone, vendor) how much they have
    # and when they last touched it. Active means "has stock available now".
    per_zone_vendor = (
        await db.execute(
            select(
                MarketMember.zone_id,
                StockItem.vendor_id,
                func.count(StockItem.id).label("items"),
                func.sum(func.greatest(StockItem.quantity_available, 0)).label("available"),
                func.max(StockItem.updated_at).label("last_touched"),
            )
            .join(StockItem, StockItem.vendor_id == MarketMember.vendor_id)
            .where(
                and_(
                    MarketMember.zone_id.in_(ids),
                    StockItem.visible_to_network.is_(True),
                )
            )
            .group_by(MarketMember.zone_id, StockItem.vendor_id)
        )
    ).all()

    acting: dict = {}
    latest: dict = {}
    for zone_id, vendor_id, items, available, last_touched in per_zone_vendor:
        bucket = acting.setdefault(zone_id, {"active": 0, "selling": 0, "listings": 0, "recent": 0})
        bucket["selling"] += 1
        bucket["listings"] += int(items or 0)
        if (available or 0) > 0:
            bucket["active"] += 1
        if last_touched and last_touched >= since:
            bucket["recent"] += 1
        if last_touched and (zone_id not in latest or last_touched > latest[zone_id]):
            latest[zone_id] = last_touched

    services = dict(
        (
            await db.execute(
                select(MarketMember.zone_id, func.count(ToolListing.id))
                .join(ToolListing, ToolListing.vendor_id == MarketMember.vendor_id)
                .where(
                    and_(
                        MarketMember.zone_id.in_(ids),
                        ToolListing.is_available.is_(True),
                        ToolListing.category.in_(SERVICE_CATEGORIES),
                    )
                )
                .group_by(MarketMember.zone_id)
            )
        ).all()
    )
    equipment = dict(
        (
            await db.execute(
                select(MarketMember.zone_id, func.count(ToolListing.id))
                .join(ToolListing, ToolListing.vendor_id == MarketMember.vendor_id)
                .where(
                    and_(
                        MarketMember.zone_id.in_(ids),
                        ToolListing.is_available.is_(True),
                        ToolListing.category.in_(EQUIPMENT_CATEGORIES),
                    )
                )
                .group_by(MarketMember.zone_id)
            )
        ).all()
    )

    out = {}
    for zone_id in ids:
        bucket = acting.get(zone_id, {})
        out[zone_id] = {
            "registered": int(members.get(zone_id, 0)),
            "active_vendors": int(bucket.get("active", 0)),
            "selling_vendors": int(bucket.get("selling", 0)),
            "listings": int(bucket.get("listings", 0)),
            "recent_vendors": int(bucket.get("recent", 0)),
            "services": int(services.get(zone_id, 0)),
            "equipment": int(equipment.get(zone_id, 0)),
            "last_activity_at": latest.get(zone_id).isoformat() if latest.get(zone_id) else None,
        }
    return out


async def categories_by_zone(db: AsyncSession, zone_ids: Iterable, limit: int = 4) -> dict:
    """What each market actually sells, from the members' own categories."""
    ids = list(zone_ids)
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(MarketMember.zone_id, StockItem.category, func.count(StockItem.id).label("n"))
            .join(StockItem, StockItem.vendor_id == MarketMember.vendor_id)
            .where(
                and_(
                    MarketMember.zone_id.in_(ids),
                    StockItem.visible_to_network.is_(True),
                    StockItem.quantity_available > 0,
                    StockItem.category.isnot(None),
                )
            )
            .group_by(MarketMember.zone_id, StockItem.category)
            .order_by(func.count(StockItem.id).desc())
        )
    ).all()
    out: dict = {}
    for zone_id, category, n in rows:
        bucket = out.setdefault(zone_id, [])
        if len(bucket) < limit:
            bucket.append({"category": category, "listings": int(n)})
    return out


def invitation_for(zone_name: str, activity: dict) -> Optional[str]:
    """The sentence an empty market says instead of a row of zeroes.

    Returned from the server so no two screens phrase it differently, and so the
    frontend cannot accidentally present an empty market as an active one.
    """
    if activity.get("active_vendors") or activity.get("listings"):
        return None
    if activity.get("registered"):
        return (
            f"{zone_name} has traders registered but nothing on its shelf yet. "
            "Publish your stock here and you will be the first thing buyers see."
        )
    return (
        f"No trader has claimed {zone_name} yet. If you trade here, be the first — "
        "your shelf is the market's shelf from the day you join."
    )


def is_empty(activity: dict) -> bool:
    return not (activity.get("active_vendors") or activity.get("listings"))


def activity_rank(activity: dict) -> tuple:
    """Sort key: the busiest market first, then the one closest.

    Deliberately not `registered`. A market with a hundred sign-ups and an empty
    shelf ranks below one where twenty traders are actually selling, because the
    second is where a buyer can buy something today.
    """
    return (
        -(activity.get("active_vendors") or 0),
        -(activity.get("listings") or 0),
    )


# ── one market, measured ────────────────────────────────────────────────────


async def market_payload(db: AsyncSession, zone: MarketZone, viewer: Optional[Vendor] = None,
                         origin: Optional[tuple] = None) -> dict:
    """One market, with the numbers that make it worth walking into."""
    activity = (await activity_by_zone(db, [zone.id])).get(zone.id, {})
    categories = (await categories_by_zone(db, [zone.id], limit=6)).get(zone.id, [])

    membership = None
    if viewer is not None:
        row = (
            await db.execute(
                select(MarketMember).where(
                    and_(MarketMember.zone_id == zone.id, MarketMember.vendor_id == viewer.id)
                )
            )
        ).scalar_one_or_none()
        membership = row is not None

    lat, lng = (origin or (None, None))
    d = distance_km(lat, lng, zone.center_lat, zone.center_lng)

    return {
        "id": str(zone.id),
        "name": zone.name,
        "city": zone.city,
        "country": zone.country,
        "distance_km": None if d is None else round(d, 1),
        "located": zone.center_lat is not None,
        **activity,
        "categories": categories,
        # The four doors, each only offered when there is something behind it.
        "explore": [
            {"key": "goods", "label": "Goods", "blurb": "Products vendors sell",
             "available": activity.get("listings", 0) > 0,
             "count": activity.get("listings", 0)},
            {"key": "people", "label": "People", "blurb": "Find local vendors",
             "available": activity.get("selling_vendors", 0) > 0,
             "count": activity.get("selling_vendors", 0)},
            {"key": "services", "label": "Services", "blurb": "Find service providers",
             "available": activity.get("services", 0) > 0,
             "count": activity.get("services", 0)},
            {"key": "equipment", "label": "Equipment", "blurb": "Find tools and equipment",
             "available": activity.get("equipment", 0) > 0,
             "count": activity.get("equipment", 0)},
        ],
        "i_am_member": membership,
        "empty": is_empty(activity),
        "invitation": invitation_for(zone.name, activity),
    }


# ── the shelf: a view over members' own records ─────────────────────────────


async def market_shelf(
    db: AsyncSession,
    zone: MarketZone,
    *,
    kind: str = "goods",
    q: Optional[str] = None,
    limit: int = 24,
    viewer: Optional[Vendor] = None,
) -> dict:
    """What is actually on this market's shelf right now.

    `goods`   — the member vendors' stock rows, visible to the network and in
                stock. One product, published once, appearing here because its
                owner trades in this market.
    `people`  — the member vendors themselves, busiest shelves first.
    `services`/`equipment` — the members' tool listings, split by taxonomy.

    Nothing is copied. Nothing is cached. Leave the market and your products
    leave with you, because they were never here in the first place.
    """
    member_ids = select(MarketMember.vendor_id).where(MarketMember.zone_id == zone.id)

    if kind == "people":
        rows = (
            await db.execute(
                select(
                    Vendor.id,
                    Vendor.business_name,
                    Vendor.vendor_handle,
                    func.count(StockItem.id).label("items"),
                    func.max(StockItem.updated_at).label("last_touched"),
                )
                .join(MarketMember, MarketMember.vendor_id == Vendor.id)
                .outerjoin(
                    StockItem,
                    and_(
                        StockItem.vendor_id == Vendor.id,
                        StockItem.visible_to_network.is_(True),
                        StockItem.quantity_available > 0,
                    ),
                )
                .where(MarketMember.zone_id == zone.id)
                .group_by(Vendor.id, Vendor.business_name, Vendor.vendor_handle)
                .order_by(func.count(StockItem.id).desc(), Vendor.business_name.asc())
                .limit(limit)
            )
        ).all()
        return {
            "kind": kind,
            "market": {"id": str(zone.id), "name": zone.name},
            "items": [
                {
                    "kind": "vendor",
                    "id": str(vid),
                    "title": name or handle,
                    "handle": handle,
                    "to": f"/vendors/{handle}" if handle else "/network",
                    "note": f"{int(items or 0)} item{'s' if int(items or 0) != 1 else ''} on their shelf"
                    if items
                    else "registered, nothing published yet",
                    "last_activity_at": last.isoformat() if last else None,
                }
                for vid, name, handle, items, last in rows
            ],
            "count": len(rows),
        }

    if kind in ("services", "equipment"):
        cats = SERVICE_CATEGORIES if kind == "services" else EQUIPMENT_CATEGORIES
        stmt = (
            select(ToolListing, Vendor)
            .join(Vendor, Vendor.id == ToolListing.vendor_id)
            .where(
                and_(
                    ToolListing.vendor_id.in_(member_ids),
                    ToolListing.is_available.is_(True),
                    ToolListing.category.in_(cats),
                )
            )
            .order_by(ToolListing.created_at.desc())
            .limit(limit)
        )
        if q:
            stmt = stmt.where(
                or_(ToolListing.title.ilike(f"%{q}%"), ToolListing.description.ilike(f"%{q}%"))
            )
        rows = (await db.execute(stmt)).all()
        return {
            "kind": kind,
            "market": {"id": str(zone.id), "name": zone.name},
            "items": [
                {
                    "kind": kind[:-1],  # service / equipment
                    "id": str(tool.id),
                    "title": tool.title,
                    "category": tool.category.value if hasattr(tool.category, "value") else tool.category,
                    "price": tool.price_per_unit,
                    "price_unit": tool.price_unit,
                    "to": f"/tools?listing={tool.id}",
                    "by": vendor.business_name or vendor.vendor_handle,
                    "vendor_handle": vendor.vendor_handle,
                }
                for tool, vendor in rows
            ],
            "count": len(rows),
        }

    stmt = (
        select(StockItem, Vendor)
        .join(Vendor, Vendor.id == StockItem.vendor_id)
        .where(
            and_(
                StockItem.vendor_id.in_(member_ids),
                StockItem.visible_to_network.is_(True),
                StockItem.quantity_available > 0,
            )
        )
    )
    own = 0
    if viewer is not None:
        # Your own shelf is never suggested back to you as somebody else's —
        # but it is still counted, because a vendor who has just published must
        # be able to see that it landed. Told separately as `own`, so the rows
        # stay other people's stock and the count stays honest.
        own = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(StockItem)
                    .join(MarketMember, MarketMember.vendor_id == StockItem.vendor_id)
                    .where(
                        and_(
                            MarketMember.zone_id == zone.id,
                            StockItem.vendor_id == viewer.id,
                            StockItem.visible_to_network.is_(True),
                            StockItem.quantity_available > 0,
                        )
                    )
                )
            ).scalar_one()
            or 0
        )
        stmt = stmt.where(StockItem.vendor_id != viewer.id)
    if q:
        stmt = stmt.where(
            or_(StockItem.name.ilike(f"%{q}%"), StockItem.category.ilike(f"%{q}%"))
        )
    rows = (
        await db.execute(stmt.order_by(StockItem.updated_at.desc()).limit(limit))
    ).all()

    return {
        "kind": "goods",
        "market": {"id": str(zone.id), "name": zone.name},
        # How many of the *viewer's* own goods are on this shelf (hidden from
        # the rows above, but never from the person who published them).
        "own": own,
        "items": [
            {
                "kind": "goods",
                "id": str(item.id),
                "title": item.name,
                "category": item.category,
                "price": item.unit_price if item.unit_price is not None else item.wholesale_price,
                "price_unit": item.unit_of_measure,
                "quantity": item.quantity_available,
                "image": (item.images or [None])[0] if isinstance(item.images, list) and item.images else None,
                "to": f"/listing/{item.id}",
                "by": vendor.business_name or vendor.vendor_handle,
                "vendor_handle": vendor.vendor_handle,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            }
            for item, vendor in rows
        ],
        "count": len(rows),
    }


async def nearby_markets(
    db: AsyncSession,
    *,
    origin: Optional[tuple] = None,
    radius_km: float = DEFAULT_RADIUS_KM,
    viewer: Optional[Vendor] = None,
    limit: int = 12,
    include_empty: bool = False,
) -> dict:
    """Markets around you, busiest first.

    No "scan" button: this is what the home shelf and the markets screen both
    call on load. `radius_km` starts at a walk — 25 km — and widens only when
    the caller asks.

    Nothing in range is not an error: the response says so, and offers the
    widest markets that exist so the screen still has a reason to be open.
    """
    zones = (
        await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True)))
    ).scalars().all()
    ids = [z.id for z in zones]
    activity = await activity_by_zone(db, ids)
    categories = await categories_by_zone(db, ids)

    lat, lng = (origin or (None, None))
    inside, outside = [], []
    for zone in zones:
        d = distance_km(lat, lng, zone.center_lat, zone.center_lng)
        act = activity.get(zone.id, {})
        entry = {
            "id": str(zone.id),
            "name": zone.name,
            "city": zone.city,
            "country": zone.country,
            "distance_km": None if d is None else round(d, 1),
            "located": zone.center_lat is not None,
            **act,
            "categories": categories.get(zone.id, []),
            "empty": is_empty(act),
            "invitation": invitation_for(zone.name, act),
        }
        if d is not None and d <= radius_km:
            inside.append(entry)
        else:
            outside.append(entry)

    inside.sort(key=lambda m: (m["empty"] and not include_empty, *activity_rank(m),
                               m["distance_km"] if m["distance_km"] is not None else 1e9))
    outside.sort(key=lambda m: activity_rank(m))

    if include_empty:
        picked = inside
    else:
        picked = [m for m in inside if not m["empty"]]
        # Never return an empty screen: if nothing in range is trading, show the
        # nearest markets anyway, still labelled as empty with their invitation.
        if not picked:
            picked = inside

    # An unlocated market has no distance, so it can never be "near you" — it is
    # offered separately rather than silently dropped.
    unlocated = [m for m in outside if m["distance_km"] is None]
    wider = [m for m in outside if m["distance_km"] is not None][:limit]

    # The note describes what the caller is actually looking at. When nothing in
    # range is trading, the nearest markets are in `wider`, not in `markets` —
    # saying "the nearest are below" while `markets` is empty would be its own
    # kind of zero-vendor card.
    if any(not m["empty"] for m in picked):
        note = None
    elif any(not m["empty"] for m in wider):
        note = "Nothing within range is trading yet — the nearest markets with a shelf are further out."
    elif wider:
        note = "Nothing within range is trading yet. The nearest markets are further out, and none of them is trading either."
    else:
        note = "No market is within range of this location yet."

    return {
        "origin": {"lat": lat, "lng": lng} if lat is not None else None,
        "radius_km": radius_km,
        "markets": picked[:limit],
        "active_count": sum(1 for m in picked if not m["empty"]),
        "inviting_count": sum(1 for m in picked if m["empty"]),
        # The next ring out, for the "widen the search" control.
        "wider": wider,
        "unlocated": unlocated[:limit],
        "note": note,
    }

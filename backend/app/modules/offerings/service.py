"""Offerings: what a person offers, in one list, and the lifecycle of each offer.

An offering IS a row in one of three existing tables. Nothing is copied into a new table:

    goods    -> stock_items        (StockItem)
    service  -> booking_services   (BookableService)
    tool     -> tool_listings      (ToolListing)

Every read and write filters by the owner's vendor_id. A row that belongs to someone else is
reported as not found, so existence is never leaked.

Lifecycle, reusing the flags that already exist:
    active    visible / is_active / is_available is true, not archived
    paused    the same flag is false (resume turns it back on)
    archived  archived_at is set. Kept for history, hidden from lists, never publicly shown,
              and cannot be resumed.

Pricing mode:
    fixed       a price is required
    negotiable  a price is optional, shown as a starting point
    ask_me      no price is shown or stored

Photos are https URLs only. This module stores links; it does not upload files.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockItem, StockSource
from app.models.tools import ToolCategory, ToolListing
from app.models.vendor import Vendor
from app.modules.schedule.domains import check_domain
from app.modules.schedule.models import SERVICE_MODES, AvailabilityRule, BookableService, ServiceModePrice

LIMIT = 200
KINDS = ("goods", "service", "tool")
PRICE_MODES = ("fixed", "negotiable", "ask_me")
ACTIONS = ("pause", "resume", "archive")
MAX_PHOTOS = 8
MAX_RADIUS_KM = 500


class OfferingError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _value(v):
    return getattr(v, "value", v)


def _now() -> datetime:
    return datetime.utcnow()


# ── reading ───────────────────────────────────────────────────────────────────

FLAG = {"goods": "visible_to_network", "service": "is_active", "tool": "is_available"}
PRICE_ATTR = {"goods": "unit_price", "service": "price_kes", "tool": "price_per_unit"}
# A delivery mode maps to one of the three legacy flags. drop_off and pickup_delivery have none.
LEGACY_FLAG = {"in_shop": "delivery_clinic", "home_visit": "delivery_home", "remote": "delivery_remote"}
LEGACY_NAME = {"in_shop": "clinic", "home_visit": "home", "remote": "remote"}
MAX_MODES = 5


def _status(kind: str, row) -> str:
    if row.archived_at is not None:
        return "archived"
    return "active" if getattr(row, FLAG[kind]) else "paused"


def _modes_out(r, modes) -> list[dict]:
    """Each way the service is given, with its own price. Services with no mode rows yet
    show their single legacy price as one mode, so older rows still read correctly."""
    if modes:
        return [{"mode": m.mode, "price": float(m.price_kes) if m.price_kes is not None else None,
                 "price_unit": m.price_unit, "price_mode": m.price_mode} for m in modes]
    legacy = [m for m, flag in LEGACY_FLAG.items() if getattr(r, flag)]
    return [{"mode": m, "price": float(r.price_kes) if r.price_kes is not None else None,
             "price_unit": r.price_unit, "price_mode": r.price_mode} for m in legacy]


def _item(kind: str, r, modes=None) -> dict:
    """One normalised offering. The first keys are the Phase-2 contract; the rest are additive."""
    if kind == "goods":
        base = {"title": r.name, "category": r.category, "price": r.unit_price,
                "price_unit": r.unit_of_measure, "available": (r.quantity_available or 0) > 0}
        radius, photos = None, list(r.images or [])
        quantity = r.quantity_available or 0
    elif kind == "service":
        # price_unit is stated by the provider when set. Services created before Phase 1 have
        # none, and keep the "per visit" wording they always showed.
        base = {"title": r.name, "category": None, "price": r.price_kes,
                "price_unit": r.price_unit or ("per visit" if r.price_kes is not None else None),
                "available": bool(r.is_active),
                "domain": r.domain,
                "delivery_modes": [LEGACY_NAME[m] for m, flag in LEGACY_FLAG.items() if getattr(r, flag)],
                "modes": _modes_out(r, modes)}
        radius, photos = r.service_radius_km, list(r.images or [])
        quantity = None
    else:
        base = {"title": r.title, "category": _value(r.category), "price": r.price_per_unit,
                "price_unit": r.price_unit, "available": bool(r.is_available)}
        radius, photos = r.service_radius_km, list(r.images or [])
        quantity = None
    return {
        "kind": kind,
        "id": str(r.id),
        **base,
        "status": _status(kind, r),
        "price_mode": r.price_mode,
        "description": r.description,
        "service_radius_km": radius,
        "photos": photos,
        "quantity": quantity,
    }


def _model(kind: str):
    return {"goods": StockItem, "service": BookableService, "tool": ToolListing}[kind]


def _visible_filter(kind: str, model):
    """What the network may see: not archived, and switched on."""
    return [model.archived_at.is_(None), getattr(model, FLAG[kind]).is_(True)]


async def mode_rows(db: AsyncSession, service_ids: list) -> dict:
    """{service_id: [ServiceModePrice, ...]} for many services in one query."""
    if not service_ids:
        return {}
    rows = (await db.execute(
        select(ServiceModePrice).where(ServiceModePrice.service_id.in_(service_ids))
        .order_by(ServiceModePrice.created_at)
    )).scalars().all()
    out: dict = {}
    for r in rows:
        out.setdefault(r.service_id, []).append(r)
    return out


async def item(db: AsyncSession, kind: str, r) -> dict:
    """_item with the service's delivery modes loaded. Use this everywhere a row is returned."""
    modes = None
    if kind == "service":
        modes = (await mode_rows(db, [r.id])).get(r.id, [])
    return _item(kind, r, modes)


async def _rows(db: AsyncSession, kind: str, vendor_id, public: bool, include_archived: bool = False) -> list[dict]:
    model = _model(kind)
    q = select(model).where(model.vendor_id == vendor_id)
    if public:
        q = q.where(*_visible_filter(kind, model))
    elif not include_archived:
        q = q.where(model.archived_at.is_(None))
    order = {"goods": StockItem.name, "service": BookableService.name, "tool": ToolListing.title}[kind]
    rows = (await db.execute(q.order_by(order).limit(LIMIT))).scalars().all()
    modes = await mode_rows(db, [r.id for r in rows]) if kind == "service" else {}
    return [_item(kind, r, modes.get(r.id, []) if kind == "service" else None) for r in rows]


async def _collect(db: AsyncSession, vendor_id, public: bool, include_archived: bool = False) -> dict:
    items = []
    for kind in KINDS:
        items += await _rows(db, kind, vendor_id, public, include_archived)
    counts = {"goods": 0, "service": 0, "tool": 0}
    for it in items:
        counts[it["kind"]] += 1
    return {"items": items, "counts": counts}


async def mine(db: AsyncSession, vendor, include_archived: bool = False) -> dict:
    """Everything this person offers, including paused items. Archived only when asked."""
    return await _collect(db, vendor.id, public=False, include_archived=include_archived)


async def public_for(db: AsyncSession, vendor) -> dict:
    """Only what the network may see. Never includes paused, archived, or hidden rows."""
    return await _collect(db, vendor.id, public=True)


async def public_summary(db: AsyncSession, vendor_ids: list, *, services_need_hours: bool = False) -> dict:
    """Batch view for many people: {vendor_id: {"counts": {...}, "titles": [...]}}.

    Three queries in total, whatever the number of people. Only public rows count.
    Titles are capped at three per person.
    services_need_hours: count a service only for a person who has opening hours set
    (service-providers plan, Phase 3). Off keeps the previous behaviour.
    """
    out: dict = {vid: {"counts": {"goods": 0, "service": 0, "tool": 0}, "titles": []} for vid in vendor_ids}
    if not vendor_ids:
        return out

    def add(vid, kind, title):
        row = out.get(vid)
        if row is None:
            return
        row["counts"][kind] += 1
        if len(row["titles"]) < 3:
            row["titles"].append(title)

    goods = (await db.execute(
        select(StockItem.vendor_id, StockItem.name).where(
            StockItem.vendor_id.in_(vendor_ids),
            StockItem.visible_to_network.is_(True),
            StockItem.archived_at.is_(None),
            StockItem.quantity_available > 0,
        ).order_by(StockItem.name)
    )).all()
    for vid, name in goods:
        add(vid, "goods", name)

    service_where = [
        BookableService.vendor_id.in_(vendor_ids),
        BookableService.is_active.is_(True),
        BookableService.archived_at.is_(None),
    ]
    if services_need_hours:
        service_where.append(BookableService.vendor_id.in_(
            select(AvailabilityRule.vendor_id).where(AvailabilityRule.vendor_id.in_(vendor_ids))
        ))
    services = (await db.execute(
        select(BookableService.vendor_id, BookableService.name).where(*service_where)
        .order_by(BookableService.name)
    )).all()
    for vid, name in services:
        add(vid, "service", name)

    tools = (await db.execute(
        select(ToolListing.vendor_id, ToolListing.title).where(
            ToolListing.vendor_id.in_(vendor_ids),
            ToolListing.is_available.is_(True),
            ToolListing.archived_at.is_(None),
        ).order_by(ToolListing.title)
    )).all()
    for vid, title in tools:
        add(vid, "tool", title)

    return out


# ── validation ────────────────────────────────────────────────────────────────

def _text(value, low: int, high: int, what: str, *, required: bool = True) -> Optional[str]:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise OfferingError(f"Give {what}.", 422)
        return None
    v = str(value).strip()
    if not (low <= len(v) <= high):
        raise OfferingError(f"{what.capitalize()} must be {low}–{high} characters.", 422)
    return v


def _photos(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise OfferingError("Photos must be a list of links.", 422)
    if len(value) > MAX_PHOTOS:
        raise OfferingError(f"At most {MAX_PHOTOS} photos.", 422)
    out = []
    for link in value:
        if not isinstance(link, str) or not link.startswith("https://") or len(link) > 2000:
            raise OfferingError("Each photo must be an https:// link.", 422)
        out.append(link.strip())
    return out


def _domain(value) -> Optional[str]:
    """Phase 6: None or one of the six service domains. Anything else is refused."""
    try:
        return check_domain(value)
    except ValueError as e:
        raise OfferingError(str(e), 422)


def _radius(value, kind: str) -> Optional[int]:
    if value is None:
        return None
    if kind == "goods":
        raise OfferingError("Goods have no service radius.", 422)
    if not isinstance(value, int) or isinstance(value, bool) or not (1 <= value <= MAX_RADIUS_KM):
        raise OfferingError(f"Service radius must be a whole number of km, 1–{MAX_RADIUS_KM}.", 422)
    return value


def _price(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 10_000_000:
        raise OfferingError("Price must be a number from 0 to 10,000,000.", 422)
    return float(value)


def _check_price(mode: str, price: Optional[float], *, sent: bool) -> Optional[float]:
    if mode not in PRICE_MODES:
        raise OfferingError("Price mode must be fixed, negotiable or ask_me.", 422)
    if mode == "ask_me":
        if sent and price is not None:
            raise OfferingError("Ask me means no price is shown. Remove the price or choose another mode.", 422)
        return None
    if mode == "fixed" and price is None:
        raise OfferingError("A fixed price needs an amount. Choose negotiable or ask me to leave it open.", 422)
    return price


def _modes_input(value) -> list[dict]:
    """Validate the list of delivery modes a service is given in. Each has its own price."""
    if not isinstance(value, list) or not value:
        raise OfferingError("Add at least one way the service is given.", 422)
    if len(value) > MAX_MODES:
        raise OfferingError(f"At most {MAX_MODES} ways of giving a service.", 422)
    seen, out = set(), []
    for item in value:
        if not isinstance(item, dict):
            raise OfferingError("Each way of giving the service needs a mode and a price.", 422)
        mode = item.get("mode")
        if mode not in SERVICE_MODES:
            raise OfferingError("Choose a way of giving the service from the list.", 422)
        if mode in seen:
            raise OfferingError("Each way of giving the service can be listed once.", 422)
        seen.add(mode)
        pmode = item.get("price_mode") or "fixed"
        price = _price(item.get("price"))
        price = _check_price(pmode, price, sent=item.get("price") is not None)
        unit = _text(item.get("price_unit"), 1, 30, "a price unit", required=False)
        out.append({"mode": mode, "price_mode": pmode, "price": price, "price_unit": unit})
    return out


def _summary(modes: list[dict]):
    """The single price and flags the service row keeps for older readers.

    Lowest priced way wins the top-level price. Flags say which legacy modes are on.
    """
    priced = [m for m in modes if m["price"] is not None]
    best = min(priced, key=lambda m: m["price"]) if priced else None
    if any(m["price_mode"] == "fixed" for m in modes):
        top_mode = "fixed"
    elif any(m["price_mode"] == "negotiable" for m in modes):
        top_mode = "negotiable"
    else:
        top_mode = "ask_me"
    flags = {flag: any(m["mode"] == mode for m in modes) for mode, flag in LEGACY_FLAG.items()}
    return {
        "price": best["price"] if best else None,
        "price_unit": best["price_unit"] if best else None,
        "price_mode": top_mode,
        "flags": flags,
    }


def _apply_modes(row, modes: list[dict]) -> None:
    """Attach the mode rows to a service row and refresh its summary fields."""
    summary = _summary(modes)
    row.price_kes = int(round(summary["price"])) if summary["price"] is not None else None
    row.price_unit = summary["price_unit"]
    row.price_mode = summary["price_mode"]
    for flag, on in summary["flags"].items():
        setattr(row, flag, on)


async def _write_modes(db: AsyncSession, row, modes: list[dict]) -> None:
    await db.execute(delete(ServiceModePrice).where(ServiceModePrice.service_id == row.id))
    for m in modes:
        db.add(ServiceModePrice(service_id=row.id, mode=m["mode"], price_mode=m["price_mode"],
                                price_kes=int(round(m["price"])) if m["price"] is not None else None,
                                price_unit=m["price_unit"]))
    await db.flush()


# ── writing ───────────────────────────────────────────────────────────────────

async def create(db: AsyncSession, vendor: Vendor, kind: str, data: dict):
    """Create an offering for this person. No business profile is needed."""
    if kind not in KINDS:
        raise OfferingError("Kind must be goods, service or tool.", 422)
    modes_in = None
    if data.get("modes") is not None:
        if kind != "service":
            raise OfferingError("Only services have ways of giving them.", 422)
        modes_in = _modes_input(data.get("modes"))
        summary = _summary(modes_in)
        mode, price = summary["price_mode"], summary["price"]
    else:
        mode = data.get("price_mode") or "fixed"
        price = _check_price(mode, _price(data.get("price")), sent=data.get("price") is not None)
    photos = _photos(data.get("photos"))
    radius = _radius(data.get("service_radius_km"), kind)
    desc = _text(data.get("description"), 1, 2000, "a description", required=False)

    if kind != "service" and data.get("domain") is not None:
        raise OfferingError("Only services have a domain.", 422)
    if kind == "goods":
        qty = data.get("quantity", 0)
        if not isinstance(qty, int) or isinstance(qty, bool) or not (0 <= qty <= 1_000_000):
            raise OfferingError("Quantity must be a whole number.", 422)
        row = StockItem(
            vendor_id=vendor.id,
            name=_text(data.get("title"), 2, 300, "a title"),
            category=_text(data.get("category"), 1, 100, "a category", required=False),
            description=desc,
            quantity_in_stock=qty, quantity_available=qty,
            unit_of_measure=_text(data.get("price_unit"), 1, 50, "a unit", required=False) or "units",
            unit_price=price, source=StockSource.MANUAL_ENTRY,
            visible_to_network=True, images=photos, price_mode=mode,
        )
    elif kind == "service":
        duration = data.get("duration_minutes", 30)
        if not isinstance(duration, int) or isinstance(duration, bool) or not (1 <= duration <= 480):
            raise OfferingError("Duration must be 1–480 minutes.", 422)
        row = BookableService(
            vendor_id=vendor.id,
            name=_text(data.get("title"), 2, 200, "a title"),
            description=desc, duration_minutes=duration,
            price_kes=int(round(price)) if price is not None else None,
            is_active=True, price_mode=mode, service_radius_km=radius, images=photos,
            price_unit=_text(data.get("price_unit"), 1, 30, "a price unit", required=False),
            domain=_domain(data.get("domain")),
        )
        if modes_in is not None:
            _apply_modes(row, modes_in)
    else:
        cat = data.get("category")
        try:
            category = ToolCategory(cat)
        except ValueError:
            raise OfferingError("Choose a tool category from the list.", 422)
        row = ToolListing(
            vendor_id=vendor.id, category=category,
            title=_text(data.get("title"), 2, 300, "a title"),
            description=desc, price_per_unit=price,
            price_unit=_text(data.get("price_unit"), 1, 50, "a price unit", required=False),
            is_available=True, price_mode=mode, service_radius_km=radius, images=photos,
        )
    db.add(row)
    await db.flush()
    if kind == "service" and modes_in is not None:
        await _write_modes(db, row, modes_in)
    return row


async def owned(db: AsyncSession, vendor: Vendor, kind: str, offering_id: str):
    """The row, only if this person owns it. Anything else is 'not found'."""
    if kind not in KINDS:
        raise OfferingError("That offering was not found.", 404)
    try:
        oid = uuid.UUID(offering_id)
    except (ValueError, TypeError):
        raise OfferingError("That offering was not found.", 404)
    model = _model(kind)
    row = (await db.execute(select(model).where(model.id == oid, model.vendor_id == vendor.id))).scalar_one_or_none()
    if row is None:
        raise OfferingError("That offering was not found.", 404)
    return row


EDITABLE = {
    "goods": {"title", "description", "category", "price", "price_unit", "price_mode", "photos", "quantity"},
    "service": {"title", "description", "price", "price_unit", "price_mode", "photos", "service_radius_km",
                "duration_minutes", "domain", "modes"},
    "tool": {"title", "description", "category", "price", "price_unit", "price_mode", "photos", "service_radius_km"},
}


async def update(db: AsyncSession, vendor: Vendor, kind: str, offering_id: str, patch: dict):
    row = await owned(db, vendor, kind, offering_id)
    unknown = set(patch) - EDITABLE[kind]
    if unknown:
        raise OfferingError(f"You cannot change: {', '.join(sorted(unknown))}.", 422)

    modes_in = None
    if "modes" in patch:
        if kind != "service":
            raise OfferingError("Only services have ways of giving them.", 422)
        modes_in = _modes_input(patch["modes"])
        summary = _summary(modes_in)
        mode, price = summary["price_mode"], summary["price"]
    else:
        mode = patch.get("price_mode", row.price_mode)
        if "price" in patch:
            price = _price(patch["price"])
        elif mode == "ask_me":
            price = None  # switching to ask me clears the stored price
        else:
            raw = getattr(row, PRICE_ATTR[kind])
            price = float(raw) if raw is not None else None
        price = _check_price(mode, price, sent="price" in patch)

    if "title" in patch:
        title = _text(patch["title"], 2, 300 if kind != "service" else 200, "a title")
        if kind == "goods":
            row.name = title
        elif kind == "service":
            row.name = title
        else:
            row.title = title
    if "description" in patch:
        row.description = _text(patch["description"], 1, 2000, "a description", required=False)
    if "photos" in patch:
        photos = _photos(patch["photos"])
        row.images = photos
    if "service_radius_km" in patch:
        row.service_radius_km = _radius(patch["service_radius_km"], kind)
    row.price_mode = mode

    if kind == "goods":
        row.unit_price = price
        if "category" in patch:
            row.category = _text(patch["category"], 1, 100, "a category", required=False)
        if "price_unit" in patch:
            row.unit_of_measure = _text(patch["price_unit"], 1, 50, "a unit", required=False) or "units"
        if "quantity" in patch:
            qty = patch["quantity"]
            if not isinstance(qty, int) or isinstance(qty, bool) or not (0 <= qty <= 1_000_000):
                raise OfferingError("Quantity must be a whole number.", 422)
            row.quantity_in_stock = qty
            row.quantity_available = qty
    elif kind == "service":
        row.price_kes = int(round(price)) if price is not None else None
        if modes_in is not None:
            _apply_modes(row, modes_in)  # sets price, unit, mode and legacy flags together
        if "duration_minutes" in patch:
            d = patch["duration_minutes"]
            if not isinstance(d, int) or isinstance(d, bool) or not (1 <= d <= 480):
                raise OfferingError("Duration must be 1–480 minutes.", 422)
            row.duration_minutes = d
        if "price_unit" in patch and modes_in is None:
            row.price_unit = _text(patch["price_unit"], 1, 30, "a price unit", required=False)
        if "domain" in patch:
            row.domain = _domain(patch["domain"])
    else:
        row.price_per_unit = price
        if "category" in patch:
            try:
                row.category = ToolCategory(patch["category"])
            except ValueError:
                raise OfferingError("Choose a tool category from the list.", 422)
        if "price_unit" in patch:
            row.price_unit = _text(patch["price_unit"], 1, 50, "a price unit", required=False)

    await db.flush()
    if kind == "service" and modes_in is not None:
        await _write_modes(db, row, modes_in)
    return row


async def set_status(db: AsyncSession, vendor: Vendor, kind: str, offering_id: str, action: str):
    if action not in ACTIONS:
        raise OfferingError("Action must be pause, resume or archive.", 422)
    row = await owned(db, vendor, kind, offering_id)
    if action == "archive":
        row.archived_at = row.archived_at or _now()
        _switch(kind, row, False)
    elif action == "resume":
        if row.archived_at is not None:
            raise OfferingError("An archived offering cannot be resumed. Create a new one instead.", 409)
        _switch(kind, row, True)
    else:
        if row.archived_at is not None:
            raise OfferingError("This offering is archived.", 409)
        _switch(kind, row, False)
    await db.flush()
    return row


def _switch(kind: str, row, on: bool) -> None:
    setattr(row, FLAG[kind], on)

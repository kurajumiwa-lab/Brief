"""Outside feed — one read contract over content that already exists.

This file is the answer to "avoid creating an entirely separate database or
service for each new feature". There is no shadow copy and no sync job: each
source adapter runs a small, bounded query against the table that already owns
the record and maps it onto ONE normalised shape.

    events            → kind "event"
    stock_items       → kind "listing"
    tool_listings     → kind "service" / "rental"
    business_requests → kind "opportunity"      (+ open hustle call-ups)
    vendor_groups     → kind "community"
    vendor_lists      → kind "collection"
    vendors           → kind "person"
    outside_posts     → kind "post"

Three properties are deliberate:

* **Bounded.** Every adapter takes `limit` and asks the database for at most
  that many rows, ordered by `created_at DESC`. No adapter selects a table.
* **Cursor-stable.** The cursor is `(created_at, id)` and is applied as a
  *filter before ranking*, so page 2 can never repeat page 1 even though the
  scores are recomputed per request. Ranking is not stable enough across
  requests to page through; `(created_at, id)` is.
* **Dedupe.** `(kind, id)` is the identity, so an item reachable from two
  sources appears once.

Privacy is enforced here, at the read boundary, not in the UI: private and
community-scoped posts are never selected for a viewer who is not in the
audience, blocked authors are filtered out, and an `approximate` location never
ships exact coordinates it does not have.
"""

import base64
import json
from datetime import datetime, timedelta
from typing import Optional, Sequence

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events import Event
from app.models.groups import VendorGroup
from app.models.hustle import HustleJobCall
from app.models.stock import StockItem
from app.models.tools import ToolListing
from app.models.vendor import Vendor
from app.models.vendor_list import VendorList
from app.modules.outside.models import (
    OutsideDiscoveryPref, OutsidePost, OutsideReaction,
)
from app.modules.outside.ranking import haversine_km
from app.modules.trade.models import BusinessRequest

# Tool categories that are a rental of a thing rather than a service performed.
RENTAL_CATEGORIES = {"warehouse", "cold_storage", "popup_shop", "equipment"}

# How many candidates each source contributes per page, relative to the
# requested page size. Bounded on both ends: too low and a page comes back
# thin, too high and the query is a table scan wearing a limit.
PER_SOURCE_FACTOR = 4
PER_SOURCE_MAX = 60

MAX_PAGE = 50


# ── cursor ────────────────────────────────────────────────────────────────────

def encode_cursor(created_at: datetime, item_id: str) -> str:
    """Opaque, URL-safe. Not a security boundary — just a stable bookmark."""
    raw = json.dumps({"t": created_at.isoformat(), "i": str(item_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: Optional[str]) -> Optional[tuple]:
    """→ (created_at, id) or None. A malformed cursor is ignored, not an error:
    a bad bookmark should degrade to page one, not break the feed."""
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        return datetime.fromisoformat(raw["t"]), str(raw["i"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def _before_cursor(created_at, item_id, pair):
    """SQL for 'strictly older than the bookmark', ties broken by id."""
    if pair is None:
        return None
    ts, ident = pair
    return or_(created_at < ts, and_(created_at == ts, item_id < ident))


# ── normalisation ─────────────────────────────────────────────────────────────

def _first_image(value) -> Optional[str]:
    if isinstance(value, list) and value:
        first = value[0]
        return first if isinstance(first, str) and first else None
    if isinstance(value, str) and value:
        return value
    return None


def _owner(vendor) -> Optional[dict]:
    if vendor is None:
        return None
    return {
        "id": str(vendor.id),
        "handle": vendor.vendor_handle,
        "name": vendor.business_name,
    }


def _item(**kw) -> dict:
    """The one shape every card knows. Missing keys are None, never absent."""
    base = {
        "id": None, "kind": None, "to": None, "title": None, "summary": None,
        "image": None, "category": None, "tags": [], "location": None,
        "geo_lat": None, "geo_lng": None, "distance_km": None,
        "created_at": None, "starts_at": None, "expires_at": None,
        "status": None, "visibility": "public", "price_kes": None,
        "is_commercial": False, "owner": None, "counts": {}, "meta": {},
    }
    base.update({k: v for k, v in kw.items() if v is not None})
    return base


# ── source adapters ───────────────────────────────────────────────────────────

async def _posts(db, viewer, pair, limit, now):
    q = (
        select(OutsidePost)
        .where(OutsidePost.status == "published", OutsidePost.moderation_status == "approved")
        # Community and private posts reach only their audience; the author
        # always sees their own. Everyone else gets public content only.
        .where(or_(
            OutsidePost.visibility == "public",
            OutsidePost.author_vendor_id == viewer.id,
        ))
        .order_by(OutsidePost.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(OutsidePost.created_at, OutsidePost.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).scalars().all()

    out = []
    for row in rows:
        out.append(_item(
            id=str(row.id), kind="post", to=f"/post/{row.id}",
            title=row.title, summary=row.body,
            image=_first_image(row.media), category=row.category, tags=list(row.tags or []),
            location=row.location, geo_lat=row.geo_lat, geo_lng=row.geo_lng,
            created_at=row.created_at, starts_at=row.starts_at, expires_at=row.expires_at,
            status=row.status, visibility=row.visibility,
            price_kes=row.price_kes, is_commercial=bool(row.is_commercial),
            owner={"id": str(row.author_vendor_id), "handle": None, "name": None},
            counts={"like": row.like_count, "save": row.save_count,
                    "interest": row.interest_count, "reply": row.reply_count},
            meta={"content_type": row.content_type, "audience": row.audience,
                  "response_kind": row.response_kind, "geo_precision": row.geo_precision,
                  "owner_id": str(row.author_vendor_id)},
        ))
    return out


def _event_item(ev, org) -> dict:
    """One event through the feed contract.

    Shared by the list adapter and by `_load_specific`, so a *cancelled* event
    still renders as itself on its detail screen instead of 404ing: the
    discovery feed only shows upcoming and active events, but a record that
    someone registered for must survive its own cancellation.
    """
    seats = max(int(ev.max_vendors or 0) - int(ev.registered_count or 0), 0)
    return _item(
        id=str(ev.id), kind="event", to=f"/events?event={ev.id}",
        title=ev.title, summary=ev.description, image=_first_image(ev.images),
        category=ev.event_type,
        location=ev.location, geo_lat=ev.geo_lat, geo_lng=ev.geo_lng,
        created_at=ev.created_at, starts_at=ev.start_date, expires_at=ev.end_date,
        status=ev.status,
        # An entry fee is optional information, not a gate: `price_kes` is
        # only ever set when the organiser actually charged one.
        price_kes=int(ev.entry_fee) if (ev.entry_fee or 0) > 0 else None,
        is_commercial=bool((ev.entry_fee or 0) > 0),
        owner=_owner(org),
        counts={"attending": ev.registered_count or 0},
        meta={"capacity": ev.max_vendors, "seats_left": seats,
              "is_virtual": bool(ev.is_virtual), "full": seats == 0,
              "owner_id": str(ev.organizer_id)},
    )


async def _events(db, viewer, pair, limit, now):
    q = (
        select(Event, Vendor)
        .join(Vendor, Vendor.id == Event.organizer_id)
        .where(Event.status.in_(["upcoming", "active"]))
        .order_by(Event.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(Event.created_at, Event.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).all()
    return [_event_item(ev, org) for ev, org in rows]


async def _listings(db, viewer, pair, limit, now):
    q = (
        select(StockItem, Vendor)
        .join(Vendor, Vendor.id == StockItem.vendor_id)
        .where(
            StockItem.visible_to_network.is_(True),
            StockItem.vendor_id != viewer.id,   # your own shelf is not discovery
            StockItem.quantity_available > 0,
        )
        .order_by(StockItem.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(StockItem.created_at, StockItem.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).all()

    out = []
    for it, owner in rows:
        price = it.unit_price if it.unit_price is not None else it.wholesale_price
        out.append(_item(
            id=str(it.id), kind="listing", to=f"/listing/{it.id}",
            title=it.name, summary=it.description, image=_first_image(it.images),
            category=it.category,
            location=owner.physical_location, geo_lat=owner.geo_lat, geo_lng=owner.geo_lng,
            created_at=it.created_at, status="published",
            price_kes=int(price) if price is not None else None,
            is_commercial=True,
            owner=_owner(owner),
            counts={"available": it.quantity_available or 0},
            meta={"unit": it.unit_of_measure, "moq": it.min_order_quantity,
                  "quality": it.quality_status, "owner_id": str(it.vendor_id)},
        ))
    return out


async def _tools(db, viewer, pair, limit, now):
    q = (
        select(ToolListing, Vendor)
        .join(Vendor, Vendor.id == ToolListing.vendor_id)
        .where(ToolListing.is_available.is_(True), ToolListing.vendor_id != viewer.id)
        .order_by(ToolListing.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(ToolListing.created_at, ToolListing.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).all()

    out = []
    for tl, owner in rows:
        category = getattr(tl.category, "value", str(tl.category))
        kind = "rental" if category in RENTAL_CATEGORIES else "service"
        out.append(_item(
            id=str(tl.id), kind=kind, to=f"/tools?listing={tl.id}",
            title=tl.title, summary=tl.description, image=_first_image(tl.images),
            category=category,
            location=tl.location or owner.physical_location,
            geo_lat=tl.geo_lat or owner.geo_lat, geo_lng=tl.geo_lng or owner.geo_lng,
            created_at=tl.created_at, expires_at=tl.available_until, status="published",
            price_kes=int(tl.price_per_unit) if tl.price_per_unit is not None else None,
            is_commercial=True,
            owner=_owner(owner),
            counts={},
            meta={"price_unit": tl.price_unit, "deposit": tl.deposit_required,
                  "owner_id": str(tl.vendor_id)},
        ))
    return out


async def _opportunities(db, viewer, pair, limit, now):
    """Requests for help, workers, goods or rides — with or without money.

    `business_requests.budget_kes` has always been nullable ("open to quotes"
    is a real answer), so an unpaid need is a first-class opportunity here.
    """
    q = (
        select(BusinessRequest, Vendor)
        .join(Vendor, Vendor.id == BusinessRequest.requester_vendor_id)
        .where(BusinessRequest.status == "open",
               BusinessRequest.requester_vendor_id != viewer.id)
        .order_by(BusinessRequest.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(BusinessRequest.created_at, BusinessRequest.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).all()

    out = []
    for rq, owner in rows:
        rtype = getattr(rq.request_type, "value", str(rq.request_type))
        urgency = getattr(rq.needed_by, "value", str(rq.needed_by))
        out.append(_item(
            id=str(rq.id), kind="opportunity", to=f"/work?request={rq.id}",
            title=f"{rtype.replace('_', ' ').title()} needed", summary=rq.description,
            category=rtype,
            location=rq.location, geo_lat=rq.geo_lat, geo_lng=rq.geo_lng,
            created_at=rq.created_at, status="open",
            price_kes=rq.budget_kes,                       # None is a real answer
            is_commercial=rq.budget_kes is not None,
            owner=_owner(owner),
            counts={"offers": len(rq.offers or [])},
            meta={"request_type": rtype, "urgency": urgency, "owner_id": str(rq.requester_vendor_id)},
        ))
    return out


async def _callups(db, viewer, pair, limit, now):
    """Open hustle call-ups — paid work, but still an opportunity, not a shelf."""
    q = (
        select(HustleJobCall, Vendor)
        .join(Vendor, Vendor.id == HustleJobCall.vendor_id)
        .where(HustleJobCall.status == "open", HustleJobCall.expires_at > now,
               HustleJobCall.vendor_id != viewer.id)
        .order_by(HustleJobCall.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(HustleJobCall.created_at, HustleJobCall.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).all()

    out = []
    for jc, owner in rows:
        out.append(_item(
            id=str(jc.id), kind="opportunity", to=f"/tasks/squad?call={jc.id}",
            title=jc.title, summary=f"{jc.skill.replace('_', ' ')} · {jc.task_type}",
            category=jc.skill,
            location=jc.location, geo_lat=jc.geo_lat, geo_lng=jc.geo_lng,
            created_at=jc.created_at, expires_at=jc.expires_at, status="open",
            price_kes=int(jc.pay_kes) if jc.pay_kes is not None else None,
            is_commercial=True,
            owner=_owner(owner),
            counts={},
            meta={"source": "hustle", "owner_id": str(jc.vendor_id)},
        ))
    return out


async def _communities(db, viewer, pair, limit, now):
    q = (
        select(VendorGroup)
        .where(VendorGroup.is_public.is_(True))
        .order_by(VendorGroup.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(VendorGroup.created_at, VendorGroup.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).scalars().all()

    out = []
    for g in rows:
        gtype = getattr(g.group_type, "value", str(g.group_type))
        out.append(_item(
            id=str(g.id), kind="community", to=f"/groups?group={g.id}",
            title=g.name, summary=g.description, image=g.logo_url,
            category=g.category or gtype, tags=list(g.tags or []),
            location=g.region, created_at=g.created_at, status="published",
            counts={"members": g.member_count or 0},
            meta={"group_type": gtype, "requires_approval": bool(g.requires_approval),
                  "owner_id": str(g.created_by_vendor_id)},
        ))
    return out


async def _collections(db, viewer, pair, limit, now):
    q = (
        select(VendorList)
        .where(VendorList.is_open.is_(True))
        .order_by(VendorList.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(VendorList.created_at, VendorList.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).scalars().all()

    out = []
    for vl in rows:
        out.append(_item(
            id=str(vl.id), kind="collection", to=f"/lists?list={vl.id}",
            title=vl.name, summary=vl.description, category=vl.category,
            location=vl.region, created_at=vl.created_at, status="published",
            counts={"members": vl.member_count or 0},
            meta={"rating": vl.avg_rating, "reviews": vl.review_count,
                  "capacity": vl.max_vendors},
        ))
    return out


async def _people(db, viewer, pair, limit, now):
    q = (
        select(Vendor)
        .where(Vendor.id != viewer.id, Vendor.fraud_suspended_at.is_(None))
        .order_by(Vendor.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(Vendor.created_at, Vendor.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).scalars().all()

    out = []
    for v in rows:
        out.append(_item(
            id=str(v.id), kind="person", to=f"/@{v.vendor_handle}",
            title=v.business_name, summary=v.business_description,
            category=(v.business_categories or [None])[0] if v.business_categories else None,
            tags=list(v.business_categories or []),
            # A person's location is only shown at the level they chose to
            # share; the exact pin never travels in a public card.
            location=v.physical_location, geo_lat=v.geo_lat, geo_lng=v.geo_lng,
            created_at=v.created_at, status="published",
            meta={"handle": v.vendor_handle, "role": getattr(v.current_role, "value", None),
                  "owner_id": str(v.id)},
        ))
    return out


async def _local_activities(db, viewer, pair, limit, now):
    from app.modules.ledger.models import LocalActivity
    from app.modules.ledger.privacy import public_coordinates
    from app.modules.ledger.service import can_view_activity

    q = (
        select(LocalActivity, Vendor)
        .join(Vendor, Vendor.id == LocalActivity.organizer_vendor_id)
        .where(LocalActivity.lifecycle_status.not_in(["cancelled", "expired"]))
        .order_by(LocalActivity.created_at.desc())
        .limit(limit)
    )
    cond = _before_cursor(LocalActivity.created_at, LocalActivity.id, pair)
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q)).all()

    out = []
    for act, org in rows:
        if not await can_view_activity(db, act, viewer):
            continue
        pub_lat, pub_lng = public_coordinates(act.geo_lat, act.geo_lng, act.geo_precision, authorized_exact=False)
        out.append(_item(
            id=str(act.id),
            kind=act.posting_type,
            to=f"/activities/{act.id}",
            title=act.title,
            summary=act.body,
            image=_first_image(act.media),
            category=act.category,
            tags=list(act.tags or []),
            location=act.area_name,
            geo_lat=pub_lat,
            geo_lng=pub_lng,
            created_at=act.created_at,
            starts_at=act.starts_at,
            expires_at=act.ends_at,
            status=act.lifecycle_status,
            visibility=act.visibility,
            price_kes=act.price_kes,
            is_commercial=bool(act.price_kes is not None and act.price_kes > 0),
            owner={
                "id": str(org.id),
                "handle": org.vendor_handle,
                "name": org.business_name,
                "account_kind": getattr(org, "account_kind", None) or "business",
            },
            counts={"responses": act.response_count or 0, "booked": act.spots_confirmed or 0},
            meta={
                "posting_type": act.posting_type,
                "inferred_template": act.inferred_template,
                "lifecycle_status": act.lifecycle_status,
                "schedule_label": act.schedule_label,
                "location_scope": act.location_scope,
                "is_youth_opportunity": bool((act.permission_rules or {}).get("is_youth_opportunity")),
                "custody_mode": "non_custodial",
                "owner_id": str(org.id),
            },
        ))
    return out


SOURCES = {
    "local_activity": _local_activities,
    "post": _posts,
    "event": _events,
    "listing": _listings,
    "service": _tools,
    "rental": _tools,          # one query, split by category downstream
    "opportunity": _opportunities,
    "callup": _callups,
    "community": _communities,
    "collection": _collections,
    "person": _people,
}

# Which source keys a requested `kind` needs. `service` and `rental` share the
# tools query and are separated after it.
KIND_TO_SOURCE = {
    "available": ["local_activity"],
    "wanted": ["local_activity"],
    "scheduled": ["local_activity"],
    "post": ["post"],
    "event": ["event"],
    "listing": ["listing"],
    "service": ["service"],
    "rental": ["rental"],
    "opportunity": ["local_activity", "opportunity", "callup"],
    "community": ["community"],
    "collection": ["collection"],
    "person": ["person"],
}

DEFAULT_KINDS = ("available", "wanted", "scheduled", "post", "event",
                 "opportunity", "community", "listing", "service", "rental", "collection")


# ── assembly ──────────────────────────────────────────────────────────────────

async def blocked_author_ids(db, viewer) -> set:
    """Authors this viewer has blocked. One small query, applied to every page."""
    from app.modules.outside.models import OutsideContentReport

    rows = (await db.execute(
        select(OutsideContentReport.target_vendor_id).where(
            OutsideContentReport.reporter_vendor_id == viewer.id,
            OutsideContentReport.is_block.is_(True),
            OutsideContentReport.target_vendor_id.is_not(None),
        )
    )).scalars().all()
    return {str(r) for r in rows}


async def viewer_reactions(db, viewer, keys: Sequence[tuple]) -> dict:
    """→ {(kind, id): {reaction: True}} for the items on this page only."""
    if not keys:
        return {}
    kinds = {k for k, _ in keys}
    ids = {i for _, i in keys}
    rows = (await db.execute(
        select(OutsideReaction).where(
            OutsideReaction.vendor_id == viewer.id,
            OutsideReaction.content_kind.in_(kinds),
            OutsideReaction.content_id.in_(ids),
        )
    )).scalars().all()
    out: dict = {}
    for r in rows:
        out.setdefault((r.content_kind, str(r.content_id)), {})[r.reaction] = True
    return out


async def collect(db, viewer, *, kinds, pair, limit, now) -> list:
    """Run the requested source adapters and return one deduped candidate list.

    A source that does not exist in this deployment (or raises for any reason)
    contributes nothing. One broken module cannot take the feed down — the same
    rule the frontend shelf store already applies.
    """
    per_source = min(max(limit * PER_SOURCE_FACTOR, limit), PER_SOURCE_MAX)
    wanted_sources: list = []
    for kind in kinds:
        for src in KIND_TO_SOURCE.get(kind, []):
            if src not in wanted_sources:
                wanted_sources.append(src)

    items: list = []
    seen: set = set()
    for src in wanted_sources:
        try:
            rows = await SOURCES[src](db, viewer, pair, per_source, now)
        except Exception:  # noqa: BLE001 — a broken source degrades to empty
            continue
        for item in rows or []:
            # `service`/`rental` come from one query; keep only what was asked for.
            if item["kind"] not in kinds:
                continue
            key = (item["kind"], item["id"])
            if key in seen:
                continue
            seen.add(key)
            items.append(item)
    return items


def apply_radius(items: list, lat: Optional[float], lng: Optional[float],
                 radius_km: Optional[float]) -> list:
    """Fill in `distance_km`, and drop what is genuinely out of range.

    A missing location is never a disqualifier — national content, online
    events and unlocated communities all stay. Only content with a *known*
    position outside the radius is filtered out, which keeps the radius a
    filter rather than a wall.
    """
    if lat is None or lng is None or radius_km is None:
        return items
    out = []
    for item in items:
        d = haversine_km(lat, lng, item.get("geo_lat"), item.get("geo_lng"))
        item["distance_km"] = d
        if d is not None and d > radius_km:
            continue
        out.append(item)
    return out


def filter_blocked(items: list, blocked: set) -> list:
    if not blocked:
        return items
    return [i for i in items
            if str((i.get("meta") or {}).get("owner_id") or "") not in blocked]


def search_filter(items: list, q: Optional[str], category: Optional[str],
                  has_price: Optional[bool]) -> list:
    """Text + facet filter applied after collection.

    Free-text search runs here rather than in each adapter so one query string
    behaves identically across every content type — which is the whole point of
    a unified search.
    """
    needle = (q or "").strip().lower()
    out = []
    for item in items:
        if needle:
            hay = " ".join(str(x) for x in (
                item.get("title"), item.get("summary"), item.get("category"),
                item.get("location"), *(item.get("tags") or []),
            ) if x).lower()
            if needle not in hay:
                continue
        if category and str(item.get("category") or "").lower() != category.lower():
            continue
        if has_price is True and item.get("price_kes") is None:
            continue
        if has_price is False and item.get("price_kes") is not None:
            continue
        out.append(item)
    return out


async def build_feed(db, viewer, *, kinds=DEFAULT_KINDS, lat=None, lng=None,
                     radius_km=None, cursor=None, limit=20, now=None,
                     query=None, category=None, has_price=None,
                     center_source="unset") -> dict:
    """One page of the Outside feed: ranked, deduped, cursor-paged."""
    now = now or datetime.utcnow()
    limit = max(1, min(int(limit), MAX_PAGE))
    pair = decode_cursor(cursor)

    items = await collect(db, viewer, kinds=kinds, pair=pair, limit=limit, now=now)
    items = filter_blocked(items, await blocked_author_ids(db, viewer))
    items = apply_radius(items, lat, lng, radius_km)
    if query or category or has_price is not None:
        items = search_filter(items, query, category, has_price)

    from app.modules.outside.ranking import RankContext, rank

    prefs = (await db.execute(
        select(OutsideDiscoveryPref).where(OutsideDiscoveryPref.vendor_id == viewer.id)
    )).scalar_one_or_none()

    ctx = RankContext(
        now=now, lat=lat, lng=lng,
        radius_km=radius_km if radius_km is not None else (prefs.radius_km if prefs else 15.0),
        layer=prefs.layer if prefs else "town",
        interests=tuple(prefs.interests or []) if prefs else (),
        connected_vendor_ids=await _connected_ids(db, viewer),
    )

    # Commercial-flood accounting: count each author's commercial items in this
    # candidate set so the decay in `ranking.promotion_decay` has something to
    # work with. Computed once per page, not per item.
    window_start = now - timedelta(hours=24)
    commercial_by_author: dict = {}
    for item in items:
        if not item.get("is_commercial"):
            continue
        created = item.get("created_at")
        if created is None or created < window_start:
            continue
        author = str((item.get("meta") or {}).get("owner_id") or "")
        if author:
            commercial_by_author[author] = commercial_by_author.get(author, 0) + 1
    ctx = RankContext(
        now=ctx.now, lat=ctx.lat, lng=ctx.lng, radius_km=ctx.radius_km,
        layer=ctx.layer, interests=ctx.interests,
        connected_vendor_ids=ctx.connected_vendor_ids,
        recent_commercial_by_author=commercial_by_author,
    )

    ranked = rank(items, ctx)
    page = ranked[:limit]

    reactions = await viewer_reactions(db, viewer, [(r.item["kind"], r.item["id"]) for r in page])
    payload = []
    for r in page:
        entry = dict(r.item)
        entry["score"] = r.score
        entry["reasons"] = r.reasons
        entry["reactions"] = reactions.get((r.item["kind"], r.item["id"]), {})
        entry["created_at"] = _iso(r.item.get("created_at"))
        entry["starts_at"] = _iso(r.item.get("starts_at"))
        entry["expires_at"] = _iso(r.item.get("expires_at"))
        payload.append(entry)

    next_cursor = None
    if len(ranked) > limit:
        last = page[-1].item
        if last.get("created_at"):
            next_cursor = encode_cursor(last["created_at"], last["id"])

    return {
        "items": payload,
        "next_cursor": next_cursor,
        "requested_kinds": list(kinds),
        # `center_source` comes from `resolve_location`, which is the only
        # place that knows why the point is what it is. Inferring it here from
        # "was a lat supplied" is always wrong: the router passes a resolved
        # point even when it came from a saved preference.
        "center": {"lat": lat, "lng": lng, "radius_km": radius_km,
                   "source": center_source},
    }


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else None


async def _connected_ids(db, viewer) -> tuple:
    from app.models.vendor import vendor_connections

    rows = (await db.execute(
        select(vendor_connections.c.vendor_b_id).where(vendor_connections.c.vendor_a_id == viewer.id)
    )).scalars().all()
    return tuple(str(r) for r in rows)

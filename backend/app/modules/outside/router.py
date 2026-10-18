"""Outside — the location-aware discovery surface.

    GET    /api/outside/shelves               the shelf manifest (config, not code)
    GET    /api/outside/feed                  one ranked, location-aware page
    GET    /api/outside/search                the same contract, with a query
    POST   /api/outside/content               ONE creation endpoint, six types
    GET    /api/outside/content/{kind}/{id}   detail
    PATCH  /api/outside/content/{kind}/{id}   edit / change state
    DELETE /api/outside/content/{kind}/{id}   the author removes their own
    POST   /api/outside/reactions             like / save / interest / attending
    DELETE /api/outside/reactions             undo one
    GET    /api/outside/location              where I am looking, and why
    PUT    /api/outside/location              set it — GPS or typed, both fine
    POST   /api/outside/reports               report or block
    GET    /api/outside/activity              grouped activity for the tab

Everything here reads records that already exist; the only tables Outside owns
are the four in `models.py`. Location is resolved in one place
(`resolve_location`) with a documented fallback chain, so denying GPS costs a
radius and never the product.
"""

import uuid as uuidlib
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import ChatMessage, ChatRoom, chat_room_participants
from app.models.events import Event, EventRegistration
from app.models.market_locks import MarketZone
from app.models.notification import Notification
from app.models.stock import StockItem
from app.models.vendor import Vendor
from app.modules.outside import feed as feed_module
from app.modules.outside import publish as publish_module
from app.modules.outside import shelves as shelf_manifest
from app.modules.outside.models import (
    CONTENT_KINDS, REACTIONS, OutsideContentReport, OutsideDiscoveryPref,
    OutsidePost, OutsideReaction,
)
from app.modules.trade.models import BusinessRequest
from app.routes.auth import get_current_vendor

router = APIRouter()

# How wide a default look is when the viewer has said nothing at all.
DEFAULT_RADIUS_KM = 15.0


# ── location resolution ───────────────────────────────────────────────────────

async def resolve_location(db: AsyncSession, vendor: Vendor,
                           lat: Optional[float] = None, lng: Optional[float] = None,
                           radius_km: Optional[float] = None) -> dict:
    """The one place 'where is this person looking' is answered.

    Chain, in order, each step recorded in `source`:

      1. `request`        — the caller passed a point (the map, or a tap)
      2. `gps` / `manual` — the saved discovery preference
      3. `vendor_profile` — the shop address the account already has
      4. `market_zone`    — the nearest real market zone anchor
      5. `unset`          — no location at all; radius filtering is skipped

    Step 5 is a supported outcome, not an error. Content with no position is
    still shown, which is what keeps a sparse area usable.
    """
    prefs = (await db.execute(
        select(OutsideDiscoveryPref).where(OutsideDiscoveryPref.vendor_id == vendor.id)
    )).scalar_one_or_none()

    if lat is not None and lng is not None:
        return {
            "lat": lat, "lng": lng, "source": "request",
            "label": prefs.label if prefs else None,
            "radius_km": radius_km if radius_km is not None else (
                prefs.radius_km if prefs else DEFAULT_RADIUS_KM),
            "layer": prefs.layer if prefs else "town",
            "interests": list(prefs.interests or []) if prefs else [],
            "share_location": bool(prefs.share_location) if prefs else False,
            "prefs": prefs,
        }

    if prefs is not None and prefs.geo_lat is not None and prefs.geo_lng is not None:
        return {
            "lat": prefs.geo_lat, "lng": prefs.geo_lng, "source": prefs.source or "manual",
            "label": prefs.label,
            "radius_km": radius_km if radius_km is not None else prefs.radius_km,
            "layer": prefs.layer, "interests": list(prefs.interests or []),
            "share_location": bool(prefs.share_location), "prefs": prefs,
        }

    if vendor.geo_lat is not None and vendor.geo_lng is not None:
        return {
            "lat": vendor.geo_lat, "lng": vendor.geo_lng, "source": "vendor_profile",
            "label": vendor.physical_location,
            "radius_km": radius_km if radius_km is not None else DEFAULT_RADIUS_KM,
            "layer": "town",
            "interests": list(prefs.interests or []) if prefs else [],
            "share_location": bool(prefs.share_location) if prefs else False,
            "prefs": prefs,
        }

    zone = (await db.execute(
        select(MarketZone).where(MarketZone.is_active.is_(True),
                                 MarketZone.center_lat.is_not(None)).limit(1)
    )).scalar_one_or_none()
    if zone is not None:
        return {
            "lat": zone.center_lat, "lng": zone.center_lng, "source": "market_zone",
            "label": zone.name,
            "radius_km": radius_km if radius_km is not None else DEFAULT_RADIUS_KM,
            "layer": "town",
            "interests": list(prefs.interests or []) if prefs else [],
            "share_location": bool(prefs.share_location) if prefs else False,
            "prefs": prefs,
        }

    return {
        "lat": None, "lng": None, "source": "unset", "label": None,
        "radius_km": radius_km if radius_km is not None else DEFAULT_RADIUS_KM,
        "layer": prefs.layer if prefs else "town",
        "interests": list(prefs.interests or []) if prefs else [],
        "share_location": bool(prefs.share_location) if prefs else False,
        "prefs": prefs,
    }


# ── schemas ───────────────────────────────────────────────────────────────────

class ContentIn(BaseModel):
    """ONE body for every content type.

    Progressive disclosure is a client concern; on the server every field is
    simply optional and `publish.REQUIRED_FIELDS` decides what a given type
    actually needs. `price_kes` is optional for all six types.
    """

    content_type: str = Field(..., max_length=24)
    title: Optional[str] = Field(None, max_length=200)
    body: Optional[str] = Field(None, max_length=8000)
    description: Optional[str] = Field(None, max_length=8000)
    media: Optional[list] = None
    category: Optional[str] = Field(None, max_length=100)
    tags: Optional[list] = None

    location: Optional[str] = Field(None, max_length=300)
    geo_lat: Optional[float] = None
    geo_lng: Optional[float] = None
    geo_precision: Optional[str] = Field(None, max_length=16)
    location_layer: Optional[str] = Field(None, max_length=20)

    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None

    visibility: str = Field("public", max_length=16)
    audience: str = Field("everyone", max_length=16)
    response_kind: str = Field("reply", max_length=20)
    status: Optional[str] = Field(None, max_length=20)

    price_kes: Optional[int] = None
    wholesale_price_kes: Optional[int] = None

    # type-specific
    post_type: Optional[str] = Field(None, max_length=24)
    capacity: Optional[int] = None
    is_virtual: Optional[bool] = None
    virtual_link: Optional[str] = Field(None, max_length=500)
    quantity: Optional[int] = None
    unit: Optional[str] = Field(None, max_length=50)
    min_order_quantity: Optional[int] = None
    group_type: Optional[str] = Field(None, max_length=24)
    requires_approval: Optional[bool] = None
    request_type: Optional[str] = Field(None, max_length=24)
    urgency: Optional[str] = Field(None, max_length=24)


class ContentPatch(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    body: Optional[str] = Field(None, max_length=8000)
    location: Optional[str] = Field(None, max_length=300)
    category: Optional[str] = Field(None, max_length=100)
    tags: Optional[list] = None
    media: Optional[list] = None
    visibility: Optional[str] = Field(None, max_length=16)
    audience: Optional[str] = Field(None, max_length=16)
    response_kind: Optional[str] = Field(None, max_length=20)
    status: Optional[str] = Field(None, max_length=20)
    starts_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    price_kes: Optional[int] = None


class ReactionIn(BaseModel):
    content_kind: str = Field(..., max_length=24)
    content_id: uuidlib.UUID
    reaction: str = Field(..., max_length=16)


class LocationIn(BaseModel):
    label: Optional[str] = Field(None, max_length=200)
    geo_lat: Optional[float] = None
    geo_lng: Optional[float] = None
    source: str = Field("manual", max_length=24)
    radius_km: float = Field(DEFAULT_RADIUS_KM, ge=0.5, le=200)
    layer: str = Field("town", max_length=20)
    interests: Optional[list] = None
    share_location: bool = False


class ReportIn(BaseModel):
    content_kind: str = Field(..., max_length=24)
    content_id: uuidlib.UUID
    reason: str = Field(..., max_length=40)
    detail: Optional[str] = Field(None, max_length=2000)
    is_block: bool = False


# ── shelves & feed ────────────────────────────────────────────────────────────

@router.get("/shelves")
async def get_shelves(
    keys: Optional[str] = Query(None, description="comma-separated shelf keys"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The shelf manifest, plus the viewer's resolved location so a client can
    label the radius it is about to render."""
    wanted = [k.strip() for k in keys.split(",") if k.strip()] if keys else None
    payload = shelf_manifest.manifest(wanted)
    loc = await resolve_location(db, vendor)
    payload["location"] = {k: loc[k] for k in ("lat", "lng", "label", "radius_km", "layer", "source")}
    return payload


@router.get("/feed")
async def get_feed(
    kinds: Optional[str] = Query(None, description="comma-separated content kinds"),
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: Optional[float] = Query(None, ge=0.5, le=200),
    cursor: Optional[str] = None,
    limit: int = Query(20, ge=1, le=50),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """One ranked page. Location-aware, cursor-paged, never padded."""
    kind_list = tuple(feed_module.DEFAULT_KINDS)
    if kinds:
        parsed = [k.strip() for k in kinds.split(",") if k.strip()]
        unknown = [k for k in parsed if k not in CONTENT_KINDS]
        if unknown:
            raise HTTPException(422, f"Unknown content kind(s): {', '.join(unknown)}")
        if parsed:
            kind_list = tuple(parsed)

    loc = await resolve_location(db, vendor, lat, lng, radius_km)
    page = await feed_module.build_feed(
        db, vendor, kinds=kind_list,
        lat=loc["lat"], lng=loc["lng"], radius_km=loc["radius_km"],
        cursor=cursor, limit=limit, center_source=loc["source"],
    )
    page["location"] = {k: loc[k] for k in ("lat", "lng", "label", "radius_km", "layer", "source")}
    return page


@router.get("/search")
async def search(
    q: Optional[str] = Query(None, max_length=200),
    kinds: Optional[str] = None,
    category: Optional[str] = Query(None, max_length=100),
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: Optional[float] = Query(None, ge=0.5, le=200),
    has_price: Optional[bool] = None,
    when: Optional[str] = Query(None, description="today | weekend | week | month"),
    cursor: Optional[str] = None,
    limit: int = Query(20, ge=1, le=50),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """One search across every content type.

    Same feed contract, same cards, so a result is never rendered as a generic
    listing just because search found it.
    """
    kind_list = tuple(feed_module.DEFAULT_KINDS) + ("person", "place", "market")
    if kinds:
        parsed = [k.strip() for k in kinds.split(",") if k.strip()]
        unknown = [k for k in parsed if k not in CONTENT_KINDS]
        if unknown:
            raise HTTPException(422, f"Unknown content kind(s): {', '.join(unknown)}")
        if parsed:
            kind_list = tuple(parsed)

    loc = await resolve_location(db, vendor, lat, lng, radius_km)
    # A search widens the net: if the caller did not ask for a radius, do not
    # silently cut results at 15 km — a specialist contractor serves a city.
    radius = loc["radius_km"] if (radius_km is not None or loc["source"] == "request") else None

    page = await feed_module.build_feed(
        db, vendor, kinds=kind_list, lat=loc["lat"], lng=loc["lng"], radius_km=radius,
        cursor=cursor, limit=limit, query=q, category=category, has_price=has_price,
        center_source=loc["source"],
    )

    if when:
        page["items"] = _filter_when(page["items"], when, datetime.utcnow())

    page["location"] = {k: loc[k] for k in ("lat", "lng", "label", "radius_km", "layer", "source")}
    page["query"] = q
    page["filters"] = {"kinds": list(kind_list), "category": category,
                       "has_price": has_price, "when": when, "radius_km": radius}
    return page


def _filter_when(items: list, when: str, now: datetime) -> list:
    """Date filter for events. Applied after ranking so the order is kept."""
    if when == "today":
        start, end = now, now + timedelta(days=1)
    elif when == "weekend":
        # the coming Saturday 00:00 → Monday 00:00
        days_ahead = (5 - now.weekday()) % 7
        start = (now + timedelta(days=days_ahead)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=2)
    elif when == "week":
        start, end = now, now + timedelta(days=7)
    elif when == "month":
        start, end = now, now + timedelta(days=31)
    else:
        return items
    out = []
    for item in items:
        starts = item.get("starts_at")
        if not starts:
            continue
        try:
            dt = datetime.fromisoformat(starts)
        except (TypeError, ValueError):
            continue
        if start <= dt <= end:
            out.append(item)
    return out


# ── unified creation ──────────────────────────────────────────────────────────

@router.post("/content", status_code=201)
async def create_content(
    body: ContentIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The one publishing endpoint. Six content types, one foundation."""
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    # `body` OR `description` — the UI calls it "what's happening", older
    # callers call it a description. Both are accepted, neither is required
    # twice.
    if "body" not in payload and payload.get("description"):
        payload["body"] = payload["description"]
    try:
        result = await publish_module.publish(db, vendor, payload)
    except publish_module.PublishError as exc:
        await db.rollback()
        raise HTTPException(422, detail={"message": exc.message, "missing": exc.missing})
    await db.commit()
    return result


@router.get("/content/{kind}/{content_id}")
async def get_content(
    kind: str, content_id: uuidlib.UUID,
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    if kind not in CONTENT_KINDS:
        raise HTTPException(422, f"Unknown content kind '{kind}'")
    items = await _load_specific(db, vendor, kind, content_id)
    if not items:
        raise HTTPException(404, "That content is not here, or you cannot see it.")
    return items[0]


@router.patch("/content/{kind}/{content_id}")
async def patch_content(
    kind: str, content_id: uuidlib.UUID, body: ContentPatch,
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    """Edit or change state. Only the author may.

    `status` covers the whole lifecycle the brief asks for — draft, published,
    cancelled, completed, expired — and cancelling is a state change, never a
    delete, so history and notifications keep making sense.
    """
    if kind not in CONTENT_KINDS:
        raise HTTPException(422, f"Unknown content kind '{kind}'")
    row, is_owner = await _authorised_row(db, vendor, kind, content_id)
    if row is None:
        raise HTTPException(404, "That content is not here, or you cannot see it.")
    if not is_owner:
        raise HTTPException(403, "Only the person who published this can change it.")

    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if kind == "post":
        for field, column in (
            ("title", "title"), ("body", "body"), ("location", "location"),
            ("category", "category"), ("tags", "tags"), ("media", "media"),
            ("visibility", "visibility"), ("audience", "audience"),
            ("response_kind", "response_kind"), ("status", "status"),
            ("starts_at", "starts_at"), ("expires_at", "expires_at"),
            ("price_kes", "price_kes"),
        ):
            if field in changes:
                setattr(row, column, changes[field])
        if "price_kes" in changes:
            row.is_commercial = changes["price_kes"] is not None
        row.updated_at = datetime.utcnow()
    elif kind == "event":
        if "title" in changes:
            row.title = changes["title"]
        if "body" in changes:
            row.description = changes["body"]
        if "location" in changes:
            row.location = changes["location"]
        if "starts_at" in changes:
            row.start_date = changes["starts_at"]
        if "price_kes" in changes:
            row.entry_fee = float(changes["price_kes"])
        if "status" in changes and changes["status"] in ("cancelled", "completed", "published"):
            row.status = {"published": "upcoming"}.get(changes["status"], changes["status"])
    elif kind == "listing":
        if "title" in changes:
            row.name = changes["title"]
        if "body" in changes:
            row.description = changes["body"]
        if "category" in changes:
            row.category = changes["category"]
        if "price_kes" in changes:
            row.unit_price = float(changes["price_kes"]) if changes["price_kes"] is not None else None
        if "status" in changes:
            row.visible_to_network = changes["status"] != "removed"
    else:
        # Communities and collections have their own management screens; the
        # honest answer is to send the author there rather than half-edit.
        raise HTTPException(
            409,
            f"A {kind} is edited from its own management screen; only its state "
            "changes here.",
        )

    await db.commit()
    return {"ok": True, "kind": kind, "id": str(content_id), "changed": sorted(changes)}


@router.delete("/content/{kind}/{content_id}", status_code=200)
async def delete_content(
    kind: str, content_id: uuidlib.UUID,
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    """Removal that behaves predictably everywhere.

    Posts are hard-deleted with their reactions (cascade). Everything else that
    other records reference is *retired* — status/visibility flips — so feeds,
    search, notifications and history all agree instead of pointing at a hole.
    """
    if kind not in CONTENT_KINDS:
        raise HTTPException(422, f"Unknown content kind '{kind}'")
    row, is_owner = await _authorised_row(db, vendor, kind, content_id)
    if row is None:
        raise HTTPException(404, "That content is not here, or you cannot see it.")
    if not is_owner:
        raise HTTPException(403, "Only the person who published this can remove it.")

    if kind == "post":
        await db.execute(delete(OutsideReaction).where(
            OutsideReaction.content_kind == "post", OutsideReaction.content_id == content_id))
        await db.delete(row)
        await db.commit()
        return {"ok": True, "removed": True, "kind": kind, "id": str(content_id)}

    if kind == "event":
        row.status = "cancelled"
    elif kind == "listing":
        row.visible_to_network = False
    else:
        raise HTTPException(409, f"A {kind} is retired from its own management screen.")
    await db.commit()
    return {"ok": True, "removed": False, "retired": True, "kind": kind, "id": str(content_id)}


# ── interactions ──────────────────────────────────────────────────────────────

@router.post("/reactions", status_code=201)
async def add_reaction(
    body: ReactionIn,
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    """Like / save / interest / attending, for any content type.

    Attending an event and saving a post are different actions with different
    consequences, so `attending` on an `event` also writes a real
    `event_registrations` row — the interaction never fakes participation.
    """
    if body.content_kind not in CONTENT_KINDS:
        raise HTTPException(422, f"Unknown content kind '{body.content_kind}'")
    if body.reaction not in REACTIONS:
        raise HTTPException(422, f"Unknown reaction '{body.reaction}'. Expected one of: {', '.join(REACTIONS)}")

    existing = (await db.execute(
        select(OutsideReaction).where(
            OutsideReaction.vendor_id == vendor.id,
            OutsideReaction.content_kind == body.content_kind,
            OutsideReaction.content_id == body.content_id,
            OutsideReaction.reaction == body.reaction,
        )
    )).scalar_one_or_none()
    if existing:
        return {"ok": True, "already": True, "reaction": body.reaction, "count": None}

    db.add(OutsideReaction(
        vendor_id=vendor.id, content_kind=body.content_kind,
        content_id=body.content_id, reaction=body.reaction,
        created_at=datetime.utcnow(),
    ))
    count = await _bump_counter(db, body.content_kind, body.content_id, body.reaction, +1)

    if body.reaction == "attending" and body.content_kind == "event":
        await _register_for_event(db, vendor, body.content_id)

    await db.commit()
    return {"ok": True, "reaction": body.reaction, "count": count}


@router.delete("/reactions", status_code=200)
async def remove_reaction(
    body: ReactionIn,
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    if body.reaction not in REACTIONS:
        raise HTTPException(422, f"Unknown reaction '{body.reaction}'")
    res = await db.execute(delete(OutsideReaction).where(
        OutsideReaction.vendor_id == vendor.id,
        OutsideReaction.content_kind == body.content_kind,
        OutsideReaction.content_id == body.content_id,
        OutsideReaction.reaction == body.reaction,
    ))
    if res.rowcount:
        await _bump_counter(db, body.content_kind, body.content_id, body.reaction, -1)
        if body.reaction == "attending" and body.content_kind == "event":
            await _unregister_from_event(db, vendor, body.content_id)
    await db.commit()
    return {"ok": True, "removed": int(res.rowcount or 0)}


async def _bump_counter(db, kind, content_id, reaction, delta) -> Optional[int]:
    """Denormalised counter, only where the record has one."""
    if kind != "post":
        return None
    column = {"like": "like_count", "save": "save_count",
              "interest": "interest_count", "reply": "reply_count"}.get(reaction)
    if not column:
        return None
    await db.execute(
        update(OutsidePost)
        .where(OutsidePost.id == content_id)
        .values({column: getattr(OutsidePost, column) + delta})
    )
    row = (await db.execute(select(OutsidePost).where(OutsidePost.id == content_id))).scalar_one_or_none()
    return getattr(row, column) if row else None


async def _register_for_event(db, vendor, event_id):
    """Attending writes a real registration, respecting capacity."""
    event = await db.get(Event, event_id)
    if event is None:
        return
    exists = (await db.execute(
        select(EventRegistration).where(EventRegistration.event_id == event_id,
                                        EventRegistration.vendor_id == vendor.id)
    )).scalar_one_or_none()
    if exists:
        return
    if event.max_vendors and event.registered_count >= event.max_vendors:
        return  # full: the reaction records interest, it does not invent a seat
    db.add(EventRegistration(event_id=event_id, vendor_id=vendor.id,
                             status="registered", registered_at=datetime.utcnow()))
    event.registered_count = (event.registered_count or 0) + 1


async def _unregister_from_event(db, vendor, event_id):
    reg = (await db.execute(
        select(EventRegistration).where(EventRegistration.event_id == event_id,
                                        EventRegistration.vendor_id == vendor.id)
    )).scalar_one_or_none()
    if reg is None:
        return
    await db.delete(reg)
    event = await db.get(Event, event_id)
    if event and event.registered_count:
        event.registered_count = max(event.registered_count - 1, 0)


# ── location preference ───────────────────────────────────────────────────────

@router.get("/location")
async def get_location(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    loc = await resolve_location(db, vendor)
    return {
        "lat": loc["lat"], "lng": loc["lng"], "label": loc["label"],
        "radius_km": loc["radius_km"], "layer": loc["layer"], "source": loc["source"],
        "interests": loc["interests"], "share_location": loc["share_location"],
        # Telling the client why the point is what it is is what makes the
        # "we could not get your location" case explainable rather than broken.
        "explainable": loc["source"] != "unset",
    }


@router.put("/location")
async def put_location(
    body: LocationIn,
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    """Set where you are looking. Typed locations are first-class.

    `share_location` stays false unless the person turns it on: a saved
    discovery point is never a broadcast position.
    """
    if body.source not in ("gps", "manual", "vendor_profile", "market_zone", "unset"):
        raise HTTPException(422, "source must be gps, manual, vendor_profile, market_zone or unset")
    if body.layer not in ("neighbourhood", "town", "region", "country", "global"):
        raise HTTPException(422, "layer must be one of neighbourhood, town, region, country, global")

    prefs = (await db.execute(
        select(OutsideDiscoveryPref).where(OutsideDiscoveryPref.vendor_id == vendor.id)
    )).scalar_one_or_none()
    if prefs is None:
        prefs = OutsideDiscoveryPref(vendor_id=vendor.id)
        db.add(prefs)

    prefs.label = body.label
    prefs.geo_lat = body.geo_lat
    prefs.geo_lng = body.geo_lng
    prefs.source = body.source if body.geo_lat is not None else "unset"
    prefs.radius_km = body.radius_km
    prefs.layer = body.layer
    if body.interests is not None:
        prefs.interests = list(body.interests)
    prefs.share_location = bool(body.share_location)
    prefs.updated_at = datetime.utcnow()

    await db.commit()
    return await get_location(vendor, db)


# ── safety ────────────────────────────────────────────────────────────────────

@router.post("/reports", status_code=201)
async def report_content(
    body: ReportIn,
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    """Report or block. Every report is an audit row with a status."""
    if body.content_kind not in CONTENT_KINDS:
        raise HTTPException(422, f"Unknown content kind '{body.content_kind}'")

    target_vendor_id = await _author_of(db, body.content_kind, body.content_id)
    if target_vendor_id is not None and str(target_vendor_id) == str(vendor.id):
        raise HTTPException(409, "You cannot report your own content — remove it instead.")

    report = OutsideContentReport(
        reporter_vendor_id=vendor.id,
        content_kind=body.content_kind,
        content_id=body.content_id,
        reason=body.reason,
        detail=body.detail,
        is_block=bool(body.is_block),
        target_vendor_id=target_vendor_id,
        status="open",
        created_at=datetime.utcnow(),
    )
    db.add(report)
    await db.commit()
    return {"ok": True, "id": str(report.id), "status": report.status,
            "blocked": bool(body.is_block)}


# ── activity ──────────────────────────────────────────────────────────────────

# Grouping is the point of the Activity tab: a wall of undifferentiated
# notifications is not an inbox.
ACTIVITY_GROUPS = {
    "invitations": {"group_invite", "group_join_request", "group_approved",
                    "list_registration", "list_approved", "list_rejected",
                    "event_registration"},
    "events": {"event_reminder"},
    "replies": {"deal_proposal", "deal_accepted", "deal_countered", "deal_declined"},
    "trades": {"source_request", "source_accepted", "source_shipped", "source_received",
               "source_cancelled", "shipment_update", "delivery_quote_request",
               "booking_request", "booking_update"},
    "community": {"collective_update", "list_review", "governance_update",
                  "benefit_update", "chama_update"},
    "account": {"stock_low", "stock_verified", "parasitism", "patron_promotion",
                "claim_verified", "claim_rejected", "claim_expiring",
                "claim_verification_requested", "opportunity_match",
                "payment_update", "appeal_update", "route_update", "system"},
}
_GROUP_ORDER = ["invitations", "events", "replies", "trades", "community", "account"]


def _group_of(notification_type: str) -> str:
    for group, members in ACTIVITY_GROUPS.items():
        if notification_type in members:
            return group
    return "account"


@router.get("/activity")
async def activity(
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=100),
    vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db),
):
    """The Activity tab: notifications grouped by kind, plus the two counts
    that are real work waiting — chat rooms with unread messages and events
    the person is attending."""
    rows = (await db.execute(
        select(Notification)
        .where(Notification.recipient_id == vendor.id)
        .order_by(Notification.created_at.desc())
        .limit(limit * 3)
    )).scalars().all()

    groups: dict = {g: [] for g in _GROUP_ORDER}
    unread_total = 0
    for n in rows:
        ntype = n.notification_type.value if hasattr(n.notification_type, "value") else str(n.notification_type)
        if unread_only and n.is_read:
            continue
        if not n.is_read:
            unread_total += 1
        group = _group_of(ntype)
        if len(groups[group]) < limit:
            groups[group].append({
                "id": str(n.id), "type": ntype, "group": group,
                "title": n.title, "body": n.body, "data": n.data or {},
                "is_read": bool(n.is_read),
                "created_at": n.created_at.isoformat() if n.created_at else None,
            })

    # NOTE: `chat_room_participants` has no read-state column, so the backend
    # genuinely cannot know what is unread — the chat client tracks that
    # itself. Rather than invent a number, this reports what the schema does
    # support: how many live rooms you are in, and how many of them have had a
    # message in the last day (`chat_messages.sent_at` is the only activity
    # signal that exists; `ChatRoom` has no `updated_at`).
    total_rooms = (await db.execute(
        select(func.count(ChatRoom.id))
        .join(chat_room_participants, chat_room_participants.c.room_id == ChatRoom.id)
        .where(chat_room_participants.c.vendor_id == vendor.id, ChatRoom.is_active.is_(True))
    )).scalar() or 0

    active_rooms = (await db.execute(
        select(func.count(func.distinct(ChatRoom.id)))
        .join(chat_room_participants, chat_room_participants.c.room_id == ChatRoom.id)
        .join(ChatMessage, ChatMessage.room_id == ChatRoom.id)
        .where(chat_room_participants.c.vendor_id == vendor.id,
               ChatRoom.is_active.is_(True),
               ChatMessage.sent_at >= datetime.utcnow() - timedelta(days=1))
    )).scalar() or 0

    attending = (await db.execute(
        select(func.count(EventRegistration.id))
        .join(Event, Event.id == EventRegistration.event_id)
        .where(EventRegistration.vendor_id == vendor.id,
               EventRegistration.status.in_(["registered", "confirmed"]),
               Event.status == "upcoming")
    )).scalar() or 0

    return {
        "groups": [{"key": g, "items": groups[g], "count": len(groups[g])} for g in _GROUP_ORDER],
        "counts": {
            "unread_notifications": unread_total,
            "rooms": int(total_rooms),
            "rooms_active_today": int(active_rooms),
            "attending": int(attending),
        },
        "preferences": {
            # Exposed so the tab can grow real notification controls instead of
            # inventing them later.
            "groups": _GROUP_ORDER,
            "muted_groups": [],
        },
    }


# ── internal loaders ──────────────────────────────────────────────────────────

async def _authorised_row(db, vendor, kind, content_id):
    """→ (row, is_owner). Access control lives here, not in the UI."""
    if kind == "post":
        row = (await db.execute(
            select(OutsidePost).where(OutsidePost.id == content_id)
        )).scalar_one_or_none()
        if row is None:
            return None, False
        # A private or community post is only readable by its author. There is
        # no group membership model for posts yet, so the safe default is the
        # author — widening this is a deliberate future change, not an accident.
        if row.visibility != "public" and str(row.author_vendor_id) != str(vendor.id):
            return None, False
        return row, str(row.author_vendor_id) == str(vendor.id)

    if kind == "event":
        row = await db.get(Event, content_id)
        return (row, str(row.organizer_id) == str(vendor.id)) if row else (None, False)

    if kind == "listing":
        row = await db.get(StockItem, content_id)
        if row is None:
            return None, False
        if not row.visible_to_network and str(row.vendor_id) != str(vendor.id):
            return None, False
        return row, str(row.vendor_id) == str(vendor.id)

    if kind == "opportunity":
        row = await db.get(BusinessRequest, content_id)
        if row is None:
            return None, False
        if row.status != "open" and str(row.requester_vendor_id) != str(vendor.id):
            return None, False
        return row, str(row.requester_vendor_id) == str(vendor.id)

    return None, False


async def _author_of(db, kind, content_id):
    """Who published this record, so a report can name its target."""
    if kind == "post":
        row = (await db.execute(select(OutsidePost.author_vendor_id)
                                .where(OutsidePost.id == content_id))).scalar_one_or_none()
        return row
    if kind == "event":
        return (await db.execute(select(Event.organizer_id)
                                 .where(Event.id == content_id))).scalar_one_or_none()
    if kind == "listing":
        return (await db.execute(select(StockItem.vendor_id)
                                 .where(StockItem.id == content_id))).scalar_one_or_none()
    if kind == "opportunity":
        return (await db.execute(select(BusinessRequest.requester_vendor_id)
                                 .where(BusinessRequest.id == content_id))).scalar_one_or_none()
    return None


async def _load_specific(db, vendor, kind, content_id) -> list:
    """One record through the feed's own shape, so detail and feed agree."""
    row, _ = await _authorised_row(db, vendor, kind, content_id)
    if row is None:
        return []
    pair = None
    now = datetime.utcnow()
    if kind == "post":
        items = await feed_module._posts(db, vendor, pair, 1, now)
    elif kind == "event":
        items = await feed_module._events(db, vendor, pair, 50, now)
    elif kind == "listing":
        items = await feed_module._listings(db, vendor, pair, 50, now)
    elif kind == "opportunity":
        items = await feed_module._opportunities(db, vendor, pair, 50, now)
    else:
        items = []
    target = str(content_id)
    matched = [i for i in items if i["id"] == target]
    if matched:
        return matched
    # Own listing/opportunity lists exclude the owner, and the events adapter
    # only carries upcoming/active events — so a cancelled event, or your own
    # hidden listing, would otherwise 404 on its own detail screen. Fall back
    # to building the same shape directly from the row.
    from app.modules.outside.feed import _event_item, _item, _owner  # noqa: PLC0415

    if kind == "event":
        org = await db.get(Vendor, row.organizer_id)
        return [_event_item(row, org)]

    if kind == "listing":
        owner = await db.get(Vendor, row.vendor_id)
        return [_item(
            id=str(row.id), kind="listing", to=f"/listing/{row.id}", title=row.name,
            summary=row.description, category=row.category,
            created_at=row.created_at, status="published",
            price_kes=int(row.unit_price) if row.unit_price is not None else None,
            is_commercial=True, owner=_owner(owner),
            counts={"available": row.quantity_available or 0},
            meta={"unit": row.unit_of_measure, "owner_id": str(row.vendor_id)},
        )]
    if kind == "opportunity":
        owner = await db.get(Vendor, row.requester_vendor_id)
        return [_item(
            id=str(row.id), kind="opportunity", to=f"/work?request={row.id}",
            summary=row.description, category=getattr(row.request_type, "value", None),
            location=row.location, created_at=row.created_at, status="open",
            price_kes=row.budget_kes, is_commercial=row.budget_kes is not None,
            owner=_owner(owner),
            meta={"owner_id": str(row.requester_vendor_id)},
        )]
    return []


__all__ = ["router", "resolve_location"]

"""One publishing path for every content type.

The brief's core architectural change: no shelf owns an onboarding flow and no
shelf owns a publishing form. `publish()` is the single entry point; the
content type decides which fields are read, and each type lands in the table
that already owns it:

    post          → outside_posts            (the new social record)
    event         → events                   (house party, trip, meetup, fair)
    listing       → stock_items              (product for sale or to give away)
    community     → vendor_groups            (interest or neighbourhood group)
    collection    → vendor_lists             (curated shelf / guide)
    opportunity   → business_requests, or an outside_posts opportunity when the
                    ask is social rather than commercial

Shared by every branch: creator, title/description, media, category, tags,
location + geo, visibility, status, timestamps. That is the "common publishing
foundation" — the type-specific part is only the handful of fields that
actually differ, validated by `REQUIRED_FIELDS` below.

**Price is never required.** Not by a branch here, not by a column, and not by
a validator. A house party, a hike and a request for company all publish with
no price at all.
"""

import re
import uuid as uuidlib
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events import Event
from app.models.groups import VendorGroup
from app.models.stock import StockItem, StockSource
from app.models.vendor_list import VendorList
from app.modules.outside.models import GEO_PRECISIONS, LOCATION_LAYERS, OutsidePost
from app.modules.trade.models import (
    BusinessRequest, RequestStatus, RequestType, RequestUrgency,
)

CONTENT_TYPES = ("post", "event", "listing", "community", "collection", "opportunity")

# What each type actually needs. Enforced server-side so a client that skips a
# field cannot write a half-record — the UI shows the same list, but the server
# is the one that refuses.
REQUIRED_FIELDS = {
    "post": ["body"],
    "event": ["title", "starts_at"],
    "listing": ["title"],
    "community": ["title"],
    "collection": ["title"],
    "opportunity": ["body"],
}

_SLUG_RE = re.compile(r"[^a-z0-9]+")


class PublishError(Exception):
    """A validation failure the API turns into a 422 with the missing fields."""

    def __init__(self, message: str, missing: Optional[list] = None):
        super().__init__(message)
        self.message = message
        self.missing = missing or []


def _slug(name: str) -> str:
    slug = _SLUG_RE.sub("-", (name or "").lower()).strip("-")
    return slug or "group"


def _parse_dt(value):
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise PublishError(f"'{value}' is not a readable date and time")


MIN_BODY_LENGTH = 8


def validate(content_type: str, payload: dict) -> list:
    """→ the list of required fields that are missing (empty means publishable)."""
    if content_type not in CONTENT_TYPES:
        raise PublishError(
            f"Unknown content type '{content_type}'. "
            f"Expected one of: {', '.join(CONTENT_TYPES)}.",
            missing=["content_type"],
        )
    missing = []
    for field in REQUIRED_FIELDS[content_type]:
        value = payload.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(field)

    # Checked here rather than left to `ck_outside_post_body_real`, so a body
    # that is too short to mean anything is a 422 naming the field and not a
    # 500 out of the database. Same eight-character floor the requests table
    # already uses.
    body = payload.get("body")
    if isinstance(body, str) and 0 < len(body.strip()) < MIN_BODY_LENGTH:
        raise PublishError(
            f"Say a little more — {MIN_BODY_LENGTH} characters is the minimum.",
            missing=["body"],
        )
    return missing


def _validate_shared(payload: dict) -> None:
    """The rules that hold for every content type."""
    visibility = payload.get("visibility", "public")
    if visibility not in ("public", "community", "private"):
        raise PublishError("visibility must be public, community or private", missing=["visibility"])
    if payload.get("geo_precision") and payload["geo_precision"] not in GEO_PRECISIONS:
        raise PublishError("geo_precision must be exact, approximate or none", missing=["geo_precision"])
    if payload.get("location_layer") and payload["location_layer"] not in LOCATION_LAYERS:
        raise PublishError(
            f"location_layer must be one of {', '.join(LOCATION_LAYERS)}",
            missing=["location_layer"],
        )
    media = payload.get("media")
    if media is not None and not isinstance(media, list):
        raise PublishError("media must be a list of references", missing=["media"])
    # An approximate location is the default, never an afterthought: if the
    # author gave coordinates without saying otherwise, they are approximate.
    if payload.get("geo_lat") is not None and not payload.get("geo_precision"):
        payload["geo_precision"] = "approximate"


async def publish(db: AsyncSession, vendor, payload: dict) -> dict:
    """Create one record of any content type. Returns a normalised summary.

    The caller has already authenticated; `vendor` is the author and nothing
    else can set it. Nothing here reads a price as a requirement.
    """
    content_type = (payload.get("content_type") or "").strip().lower()
    _validate_shared(payload)

    missing = validate(content_type, payload)
    if missing:
        raise PublishError(
            f"A {content_type} needs {', '.join(missing)}.",
            missing=missing,
        )

    now = datetime.utcnow()
    status = payload.get("status") or "published"
    if status == "draft":
        status = "draft"

    if content_type == "post":
        record = await _publish_post(db, vendor, payload, status, now)
    elif content_type == "event":
        record = await _publish_event(db, vendor, payload, status, now)
    elif content_type == "listing":
        record = await _publish_listing(db, vendor, payload, status, now)
    elif content_type == "community":
        record = await _publish_community(db, vendor, payload, now)
    elif content_type == "collection":
        record = await _publish_collection(db, vendor, payload, now)
    else:
        record = await _publish_opportunity(db, vendor, payload, status, now)

    await db.flush()
    return record


# ── per-type publishers ───────────────────────────────────────────────────────

async def _publish_post(db, vendor, p, status, now) -> dict:
    post = OutsidePost(
        id=uuidlib.uuid4(),
        author_vendor_id=vendor.id,
        content_type=p.get("post_type") or "post",
        title=(p.get("title") or "").strip() or None,
        body=p["body"].strip(),
        media=list(p.get("media") or []),
        category=p.get("category"),
        tags=list(p.get("tags") or []),
        location=p.get("location"),
        geo_lat=p.get("geo_lat"), geo_lng=p.get("geo_lng"),
        geo_precision=p.get("geo_precision") or ("none" if p.get("geo_lat") is None else "approximate"),
        location_layer=p.get("location_layer") or "town",
        starts_at=_parse_dt(p.get("starts_at")),
        expires_at=_parse_dt(p.get("expires_at")),
        visibility=p.get("visibility", "public"),
        audience=p.get("audience", "everyone"),
        response_kind=p.get("response_kind", "reply"),
        price_kes=p.get("price_kes"),          # optional; None is the normal case
        is_commercial=bool(p.get("price_kes") is not None or p.get("is_commercial")),
        status=status,
        created_at=now, updated_at=now,
    )
    db.add(post)
    return {"content_type": "post", "kind": "post", "id": str(post.id),
            "status": post.status, "to": f"/post/{post.id}",
            "price_required": False}


async def _publish_event(db, vendor, p, status, now) -> dict:
    starts = _parse_dt(p["starts_at"])
    ends = _parse_dt(p.get("ends_at")) or starts
    if ends < starts:
        raise PublishError("An event cannot end before it starts", missing=["ends_at"])

    # `entry_fee` defaults to 0 and stays 0 unless the organiser chose one.
    # Capacity defaults to 0 meaning "no limit", which is the honest default
    # for a house party.
    capacity = p.get("capacity")
    event = Event(
        id=uuidlib.uuid4(),
        organizer_id=vendor.id,
        title=p["title"].strip(),
        description=p.get("body") or p.get("description"),
        event_type=p.get("category") or "networking",
        start_date=starts, end_date=ends,
        location=p.get("location"),
        geo_lat=p.get("geo_lat"), geo_lng=p.get("geo_lng"),
        is_virtual=bool(p.get("is_virtual")),
        virtual_link=p.get("virtual_link"),
        max_vendors=int(capacity) if capacity else 0,
        registered_count=0,
        entry_fee=float(p["price_kes"]) if p.get("price_kes") is not None else 0.0,
        images=list(p.get("media") or []),
        status="draft" if status == "draft" else "upcoming",
        created_at=now,
    )
    db.add(event)
    return {"content_type": "event", "kind": "event", "id": str(event.id),
            "status": event.status, "to": f"/events?event={event.id}",
            "price_required": False,
            "starts_at": starts.isoformat()}


async def _publish_listing(db, vendor, p, status, now) -> dict:
    qty = int(p.get("quantity") or 0)
    item = StockItem(
        id=uuidlib.uuid4(),
        vendor_id=vendor.id,
        name=p["title"].strip(),
        category=p.get("category"),
        description=p.get("body") or p.get("description"),
        quantity_in_stock=qty,
        quantity_reserved=0,
        quantity_available=qty,
        unit_of_measure=p.get("unit") or "units",
        # All three price columns stay NULL when none was given. A free or
        # "price on request" listing is a valid record, not an incomplete one.
        unit_price=float(p["price_kes"]) if p.get("price_kes") is not None else None,
        wholesale_price=float(p["wholesale_price_kes"]) if p.get("wholesale_price_kes") is not None else None,
        min_order_quantity=int(p.get("min_order_quantity") or 1),
        source=StockSource.MANUAL_ENTRY,
        images=list(p.get("media") or []),
        visible_to_network=(status != "draft"),
        created_at=now, updated_at=now,
    )
    db.add(item)
    return {"content_type": "listing", "kind": "listing", "id": str(item.id),
            "status": "draft" if status == "draft" else "published",
            "to": f"/listing/{item.id}", "price_required": False}


async def _publish_community(db, vendor, p, now) -> dict:
    base = _slug(p["title"])
    slug, n = base, 2
    while (await db.execute(select(VendorGroup.id).where(VendorGroup.slug == slug))).first():
        slug, n = f"{base}-{n}", n + 1

    group = VendorGroup(
        id=uuidlib.uuid4(),
        name=p["title"].strip(), slug=slug,
        description=p.get("body") or p.get("description"),
        group_type=p.get("group_type") or "open",
        category=p.get("category"),
        tags=list(p.get("tags") or []),
        region=p.get("location"),
        is_public=(p.get("visibility", "public") != "private"),
        requires_approval=bool(p.get("requires_approval")),
        created_by_vendor_id=vendor.id,
        member_count=1,
        created_at=now,
    )
    db.add(group)
    return {"content_type": "community", "kind": "community", "id": str(group.id),
            "status": "published", "to": f"/groups?group={group.id}",
            "price_required": False}


async def _publish_collection(db, vendor, p, now) -> dict:
    from app.routes.vendor_lists import slugify as list_slug, unique_slug

    vlist = VendorList(
        id=uuidlib.uuid4(),
        name=p["title"].strip(),
        slug=await unique_slug(db, list_slug(p["title"])),
        description=p.get("body") or p.get("description"),
        category=p.get("category"),
        region=p.get("location"),
        is_open=True,
        max_vendors=int(p.get("capacity") or 100),
        requires_approval=bool(p.get("requires_approval", True)),
        is_group_created=False,
        created_at=now,
    )
    db.add(vlist)
    return {"content_type": "collection", "kind": "collection", "id": str(vlist.id),
            "status": "published", "to": f"/lists?list={vlist.id}",
            "price_required": False}


async def _publish_opportunity(db, vendor, p, status, now) -> dict:
    """A commercial ask with a recognised request type becomes a real
    `business_requests` row (so offers, watches and the existing lifecycle
    apply). Anything else — a request for company, a shared ride, a question
    about who knows a fundi — is a post, and needs no budget."""
    request_type = p.get("request_type")
    if request_type:
        try:
            rtype = RequestType(request_type)
        except ValueError:
            raise PublishError(
                f"Unknown request type '{request_type}'.", missing=["request_type"],
            )
        try:
            urgency = RequestUrgency(p.get("urgency") or "flexible")
        except ValueError:
            urgency = RequestUrgency.FLEXIBLE

        rq = BusinessRequest(
            id=uuidlib.uuid4(),
            requester_vendor_id=vendor.id,
            request_type=rtype,
            description=(p.get("body") or p["title"]).strip(),
            location=p.get("location") or vendor.physical_location or "Not stated",
            geo_lat=p.get("geo_lat") or vendor.geo_lat,
            geo_lng=p.get("geo_lng") or vendor.geo_lng,
            needed_by=urgency,
            budget_kes=p.get("price_kes"),     # None ⇒ "open to quotes"
            status=RequestStatus.OPEN,
            created_at=now, updated_at=now,
        )
        db.add(rq)
        return {"content_type": "opportunity", "kind": "opportunity", "id": str(rq.id),
                "status": "open", "to": f"/work?request={rq.id}",
                "price_required": False, "record": "business_request"}

    post = OutsidePost(
        id=uuidlib.uuid4(),
        author_vendor_id=vendor.id,
        content_type="opportunity",
        title=(p.get("title") or "").strip() or None,
        body=p["body"].strip(),
        media=list(p.get("media") or []),
        category=p.get("category"),
        tags=list(p.get("tags") or []),
        location=p.get("location"),
        geo_lat=p.get("geo_lat"), geo_lng=p.get("geo_lng"),
        geo_precision=p.get("geo_precision") or ("none" if p.get("geo_lat") is None else "approximate"),
        location_layer=p.get("location_layer") or "town",
        starts_at=_parse_dt(p.get("starts_at")),
        expires_at=_parse_dt(p.get("expires_at")),
        visibility=p.get("visibility", "public"),
        audience=p.get("audience", "nearby"),
        response_kind=p.get("response_kind", "offer_help"),
        price_kes=p.get("price_kes"),
        is_commercial=p.get("price_kes") is not None,
        status=status,
        created_at=now, updated_at=now,
    )
    db.add(post)
    return {"content_type": "opportunity", "kind": "post", "id": str(post.id),
            "status": post.status, "to": f"/post/{post.id}",
            "price_required": False, "record": "post"}


__all__ = ["publish", "validate", "PublishError", "CONTENT_TYPES", "REQUIRED_FIELDS"]

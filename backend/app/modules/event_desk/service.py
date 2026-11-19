"""The event vendor desk's rules.

Read this module as one sentence: a signed-in organiser broadcasts a structured
brief for an event they own, a signed-in vendor answers once, and the organiser
can accept exactly one answer. Accepting a quote is a recorded booking, not a
payment. Money never enters this module.

Two constraints are enforced everywhere:

  · ownership comes from the signed-in vendor, never from a request body;
  · contact details stay closed until a quote is accepted.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events import Event
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.event_desk.models import (
    EVENT_VENDOR_CATEGORIES, EventVendorQuote, EventVendorRequest, RateCardPackage,
    VendorRateCard,
)
from app.modules.event_desk.schemas import (
    PackagesIn, QuoteIn, RateCardIn, RequestIn,
)
from app.modules.town.audit import audit
from app.services.notification_service import create_notification


def now_utc() -> datetime:
    return datetime.utcnow()


def naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Events and every other table here store naive UTC (the house convention)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _vendor_public(vendor: Vendor) -> dict:
    return {
        "id": str(vendor.id),
        "handle": vendor.vendor_handle,
        "business_name": vendor.business_name,
        "location": vendor.physical_location,
        "account_kind": vendor.account_kind,
    }


def _contact(vendor: Vendor) -> dict:
    """Only ever called for a party to an accepted quote."""
    return {
        "vendor_id": str(vendor.id),
        "business_name": vendor.business_name,
        "phone": vendor.phone,
        "email": vendor.email,
        "allow_direct_calls": bool(vendor.allow_direct_calls),
    }


def _event_brief(event: Event) -> dict:
    return {
        "id": str(event.id),
        "slug": event.slug,
        "title": event.title,
        "event_type": event.event_type,
        "start_date": _iso(event.start_date),
        "end_date": _iso(event.end_date),
        "location": event.location,
        "is_virtual": event.is_virtual,
        "status": event.status,
    }


def _package_out(package: RateCardPackage) -> dict:
    return {
        "id": str(package.id),
        "name": package.name,
        "description": package.description,
        "price_kes": package.price_kes,
        "price_unit": package.price_unit,
        "inclusions": package.inclusions or [],
        "is_active": package.is_active,
        "sort_order": package.sort_order,
    }


def rate_card_out(card: Optional[VendorRateCard], packages: Iterable[RateCardPackage],
                  vendor: Vendor, *, public: bool = False, accepted_bookings: int = 0) -> Optional[dict]:
    if card is None:
        return None
    rows = sorted(
        [p for p in packages if p.is_active or not public],
        key=lambda p: (p.sort_order, p.created_at or now_utc()),
    )
    return {
        "id": str(card.id),
        "vendor": _vendor_public(vendor),
        "headline": card.headline,
        "summary": card.summary,
        "event_categories": card.event_categories or [],
        "proof_links": [
            {
                "label": str(link.get("label", ""))[:80],
                "url": str(link.get("url", ""))[:500],
                "kind": str(link.get("kind", "portfolio"))[:32],
                "verification": "self_reported",
            }
            for link in (card.proof_links or [])
            if isinstance(link, dict) and link.get("url")
        ],
        "reach_claims": [
            {
                "platform": str(claim.get("platform", ""))[:40],
                "metric": str(claim.get("metric", ""))[:60],
                "value": str(claim.get("value", ""))[:40],
                "note": str(claim.get("note", ""))[:200],
                "source": "self_reported",
            }
            for claim in (card.reach_claims or [])
            if isinstance(claim, dict) and claim.get("metric")
        ],
        "is_public": card.is_public,
        "packages": [_package_out(p) for p in rows],
        "accepted_bookings": accepted_bookings,
        "public_url": f"/rate-card/{vendor.vendor_handle}",
        "updated_at": _iso(card.updated_at),
        "money_note": "Prices are set by the vendor. Payment is arranged directly; the platform does not hold funds.",
    }


async def _accepted_bookings(db: AsyncSession, vendor_id: UUID) -> int:
    return int((await db.execute(
        select(func.count(EventVendorQuote.id)).where(
            EventVendorQuote.vendor_id == vendor_id,
            EventVendorQuote.status == "accepted",
        )
    )).scalar_one())


async def _card_and_packages(db: AsyncSession, vendor_id: UUID) -> tuple[Optional[VendorRateCard], list[RateCardPackage]]:
    card = (await db.execute(
        select(VendorRateCard).where(VendorRateCard.vendor_id == vendor_id)
    )).scalar_one_or_none()
    if card is None:
        return None, []
    packages = (await db.execute(
        select(RateCardPackage).where(RateCardPackage.rate_card_id == card.id)
        .order_by(RateCardPackage.sort_order, RateCardPackage.created_at)
    )).scalars().all()
    return card, list(packages)


async def my_rate_card(db: AsyncSession, vendor: Vendor) -> dict:
    card, packages = await _card_and_packages(db, vendor.id)
    bookings = await _accepted_bookings(db, vendor.id)
    return {"rate_card": rate_card_out(card, packages, vendor, accepted_bookings=bookings),
            "packages": [_package_out(p) for p in packages]}


async def public_rate_card(db: AsyncSession, handle: str) -> dict:
    vendor = (await db.execute(
        select(Vendor).where(func.lower(Vendor.vendor_handle) == (handle or "").strip().lower())
    )).scalar_one_or_none()
    if vendor is None or vendor.fraud_suspended_at is not None:
        raise HTTPException(404, "Rate card not found")
    card, packages = await _card_and_packages(db, vendor.id)
    if card is None or not card.is_public:
        raise HTTPException(404, "Rate card not found")
    return rate_card_out(card, packages, vendor, public=True,
                         accepted_bookings=await _accepted_bookings(db, vendor.id))


async def upsert_rate_card(db: AsyncSession, vendor: Vendor, data: RateCardIn) -> dict:
    card, packages = await _card_and_packages(db, vendor.id)
    if card is None:
        card = VendorRateCard(id=uuid.uuid4(), vendor_id=vendor.id)
        db.add(card)
    card.headline = data.headline.strip()
    card.summary = data.summary.strip()
    card.event_categories = data.event_categories
    card.proof_links = [item.model_dump() for item in data.proof_links]
    card.reach_claims = [item.model_dump() for item in data.reach_claims]
    card.is_public = data.is_public
    card.updated_at = now_utc()
    if not packages and data.event_categories:
        # Keep the card's own categories as the package matching surface.
        card.event_categories = data.event_categories
    await db.flush()
    audit(db, action="event_desk.rate_card.saved", entity_type="vendor_rate_card",
          entity_id=card.id, actor_vendor_id=vendor.id,
          payload={"headline": card.headline, "packages": len(packages), "public": card.is_public})
    return rate_card_out(card, packages, vendor, accepted_bookings=await _accepted_bookings(db, vendor.id))


async def replace_packages(db: AsyncSession, vendor: Vendor, data: PackagesIn) -> dict:
    card, existing = await _card_and_packages(db, vendor.id)
    if card is None:
        card = VendorRateCard(id=uuid.uuid4(), vendor_id=vendor.id, headline=vendor.business_name[:200],
                              event_categories=[], proof_links=[], reach_claims=[], is_public=True)
        db.add(card)
        await db.flush()
    # Update packages in place when the client sends an id. Deleting and
    # recreating them would break every quote that points at the package and
    # would rewrite the history a rate card is supposed to make legible.
    by_id = {package.id: package for package in existing}
    seen: set[UUID] = set()
    fresh: list[RateCardPackage] = []
    for index, item in enumerate(data.packages):
        package = by_id.get(item.id) if item.id else None
        if item.id and package is None:
            raise HTTPException(404, "Rate-card package not found")
        if package is None:
            package = RateCardPackage(id=uuid.uuid4(), rate_card_id=card.id)
            db.add(package)
        package.name = item.name.strip()
        package.description = item.description.strip()
        package.price_kes = item.price_kes
        package.price_unit = item.price_unit
        package.inclusions = item.inclusions
        package.is_active = item.is_active
        package.sort_order = item.sort_order if item.sort_order else index
        package.updated_at = now_utc()
        seen.add(package.id)
        fresh.append(package)
    for package in existing:
        if package.id not in seen:
            await db.delete(package)
    card.updated_at = now_utc()
    await db.flush()
    for package in fresh:
        await db.refresh(package)
    audit(db, action="event_desk.rate_card.packages_replaced", entity_type="vendor_rate_card",
          entity_id=card.id, actor_vendor_id=vendor.id, payload={"packages": len(fresh)})
    return rate_card_out(card, fresh, vendor, accepted_bookings=await _accepted_bookings(db, vendor.id))


def _requirements_out(value: Optional[dict]) -> dict:
    allowed = {"access_time", "power", "parking", "setup", "notes"}
    return {k: str(v)[:500] for k, v in (value or {}).items() if k in allowed and v}


def request_out(request: EventVendorRequest, event: Event, organizer: Vendor, *,
                quote_count: int = 0, my_quote: Optional[EventVendorQuote] = None,
                viewer: Optional[Vendor] = None, organizer_contact: Optional[dict] = None) -> dict:
    deadline = naive_utc(request.response_deadline)
    can_quote = bool(
        viewer and viewer.id != request.organizer_id and request.status == "open"
        and deadline and deadline > now_utc() and event.status in ("upcoming", "active")
        and naive_utc(event.start_date) and naive_utc(event.start_date) > now_utc()
    )
    return {
        "id": str(request.id),
        "event": _event_brief(event),
        "organizer": _vendor_public(organizer),
        "title": request.title,
        "category": request.category,
        "brief": request.brief,
        "budget_min_kes": request.budget_min_kes,
        "budget_max_kes": request.budget_max_kes,
        "payer": request.payer,
        "requirements": _requirements_out(request.requirements),
        "response_deadline": _iso(request.response_deadline),
        "status": request.status,
        "quote_count": quote_count,
        "my_quote": _quote_out(my_quote, None, viewer, include_contact=False) if my_quote else None,
        "can_quote": can_quote,
        "organizer_contact": organizer_contact,
        "created_at": _iso(request.created_at),
        "money_note": "Payment is direct between organiser and vendor. The platform records the booking only.",
    }


def _quote_out(quote: Optional[EventVendorQuote], vendor: Optional[Vendor], viewer: Optional[Vendor],
               *, include_contact: bool = False, package_name: Optional[str] = None) -> Optional[dict]:
    if quote is None:
        return None
    is_party = bool(viewer and (viewer.id == quote.vendor_id))
    return {
        "id": str(quote.id),
        "request_id": str(quote.request_id),
        "vendor": _vendor_public(vendor) if vendor else None,
        "vendor_contact": _contact(vendor) if (include_contact and vendor and is_party is False) else None,
        "amount_kes": quote.amount_kes,
        "package_id": str(quote.package_id) if quote.package_id else None,
        "package_name": package_name,
        "message": quote.message,
        "inclusions": quote.inclusions or [],
        "valid_until": _iso(quote.valid_until),
        "status": quote.status,
        "accepted_at": _iso(quote.accepted_at),
        "created_at": _iso(quote.created_at),
        "updated_at": _iso(quote.updated_at),
    }


async def _counts(db: AsyncSession, request_ids: list[UUID]) -> dict[UUID, int]:
    if not request_ids:
        return {}
    rows = (await db.execute(
        select(EventVendorQuote.request_id, func.count(EventVendorQuote.id))
        .where(EventVendorQuote.request_id.in_(request_ids))
        .group_by(EventVendorQuote.request_id)
    )).all()
    return {row[0]: int(row[1]) for row in rows}


async def list_open_requests(db: AsyncSession, viewer: Vendor, *, category: str = "",
                             q: str = "", region: str = "", min_budget: int = 0,
                             limit: int = 50) -> dict:
    stmt = (
        select(EventVendorRequest, Event, Vendor)
        .join(Event, Event.id == EventVendorRequest.event_id)
        .join(Vendor, Vendor.id == EventVendorRequest.organizer_id)
        .where(
            EventVendorRequest.status == "open",
            EventVendorRequest.response_deadline > now_utc(),
            Event.status.in_(("upcoming", "active")),
            Event.start_date > now_utc(),
        )
    )
    if category:
        stmt = stmt.where(EventVendorRequest.category == category)
    if region:
        stmt = stmt.where(Event.location.ilike(f"%{region}%"))
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            EventVendorRequest.title.ilike(needle),
            EventVendorRequest.brief.ilike(needle),
            Event.title.ilike(needle),
            Event.location.ilike(needle),
        ))
    if min_budget > 0:
        stmt = stmt.where(or_(
            EventVendorRequest.budget_max_kes == 0,
            EventVendorRequest.budget_max_kes >= min_budget,
        ))
    rows = (await db.execute(stmt.order_by(EventVendorRequest.created_at.desc()).limit(limit))).all()
    ids = [row[0].id for row in rows]
    counts = await _counts(db, ids)
    own = {}
    if ids:
        own = {
            quote.request_id: quote for quote in (await db.execute(
                select(EventVendorQuote).where(
                    EventVendorQuote.request_id.in_(ids),
                    EventVendorQuote.vendor_id == viewer.id,
                )
            )).scalars().all()
        }
    return {
        "requests": [
            request_out(request, event, organizer, quote_count=counts.get(request.id, 0),
                        my_quote=own.get(request.id), viewer=viewer)
            for request, event, organizer in rows
        ],
        "categories": list(EVENT_VENDOR_CATEGORIES),
        "note": "Only signed-in vendors see this board. A quote records a price; payment stays direct.",
    }


async def my_requests(db: AsyncSession, organizer: Vendor, *, limit: int = 50) -> dict:
    rows = (await db.execute(
        select(EventVendorRequest, Event)
        .join(Event, Event.id == EventVendorRequest.event_id)
        .where(EventVendorRequest.organizer_id == organizer.id)
        .order_by(EventVendorRequest.created_at.desc())
        .limit(limit)
    )).all()
    counts = await _counts(db, [row[0].id for row in rows])
    return {
        "requests": [
            request_out(request, event, organizer, quote_count=counts.get(request.id, 0), viewer=organizer)
            for request, event in rows
        ]
    }


async def _load_request(db: AsyncSession, request_id: UUID, *, lock: bool = False) -> tuple[EventVendorRequest, Event, Vendor]:
    stmt = (
        select(EventVendorRequest, Event, Vendor)
        .join(Event, Event.id == EventVendorRequest.event_id)
        .join(Vendor, Vendor.id == EventVendorRequest.organizer_id)
        .where(EventVendorRequest.id == request_id)
    )
    if lock:
        stmt = stmt.with_for_update(of=EventVendorRequest)
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(404, "Vendor request not found")
    return row[0], row[1], row[2]


async def create_request(db: AsyncSession, organizer: Vendor, event_id: UUID, data: RequestIn) -> dict:
    if organizer.fraud_suspended_at is not None:
        raise HTTPException(403, "This account cannot post requests while suspended")
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    if event.organizer_id != organizer.id:
        raise HTTPException(403, "Only the organiser can broadcast a vendor request for this event")
    if event.status in ("completed", "cancelled"):
        raise HTTPException(409, "This event is closed")
    deadline = naive_utc(data.response_deadline)
    if deadline is None or deadline <= now_utc():
        raise HTTPException(422, "The response deadline must be in the future")
    if deadline >= naive_utc(event.start_date):
        raise HTTPException(422, "The response deadline must be before the event starts")
    request = EventVendorRequest(
        id=uuid.uuid4(), event_id=event.id, organizer_id=organizer.id,
        title=data.title.strip(), category=data.category, brief=data.brief.strip(),
        budget_min_kes=data.budget_min_kes, budget_max_kes=data.budget_max_kes,
        payer=data.payer, requirements=data.requirements,
        response_deadline=deadline, status="open",
    )
    db.add(request)
    await db.flush()
    audit(db, action="event_desk.request.created", entity_type="event_vendor_request",
          entity_id=request.id, actor_vendor_id=organizer.id,
          payload={"event_id": event.id, "category": request.category, "title": request.title})
    return request_out(request, event, organizer, viewer=organizer)


async def get_request(db: AsyncSession, viewer: Vendor, request_id: UUID) -> dict:
    request, event, organizer = await _load_request(db, request_id)
    is_owner = request.organizer_id == viewer.id
    if request.status == "open" and not is_owner:
        # Any signed-in vendor can read an open brief; only the owner sees the
        # quotes that came back. A closed brief is visible only to its parties.
        pass
    elif not is_owner:
        own = (await db.execute(
            select(EventVendorQuote.id).where(
                EventVendorQuote.request_id == request.id,
                EventVendorQuote.vendor_id == viewer.id,
            )
        )).first()
        if own is None:
            raise HTTPException(403, "This request is no longer open")

    count = int((await db.execute(
        select(func.count(EventVendorQuote.id)).where(EventVendorQuote.request_id == request.id)
    )).scalar_one())
    my_quote = None
    organizer_contact = None
    if is_owner:
        rows = (await db.execute(
            select(EventVendorQuote, Vendor, RateCardPackage.name)
            .join(Vendor, Vendor.id == EventVendorQuote.vendor_id)
            .outerjoin(RateCardPackage, RateCardPackage.id == EventVendorQuote.package_id)
            .where(EventVendorQuote.request_id == request.id)
            .order_by(EventVendorQuote.created_at)
        )).all()
        quotes = [
            _quote_out(quote, vendor, viewer, include_contact=quote.status == "accepted", package_name=package_name)
            for quote, vendor, package_name in rows
        ]
    else:
        row = (await db.execute(
            select(EventVendorQuote, Vendor, RateCardPackage.name)
            .join(Vendor, Vendor.id == EventVendorQuote.vendor_id)
            .outerjoin(RateCardPackage, RateCardPackage.id == EventVendorQuote.package_id)
            .where(EventVendorQuote.request_id == request.id, EventVendorQuote.vendor_id == viewer.id)
        )).first()
        quotes = []
        if row:
            my_quote = row[0]
            if my_quote.status == "accepted":
                organizer_contact = _contact(organizer)
            quotes = [_quote_out(my_quote, row[1], viewer, include_contact=False, package_name=row[2])]
    return {
        **request_out(request, event, organizer, quote_count=count, my_quote=my_quote,
                      viewer=viewer, organizer_contact=organizer_contact),
        "quotes": quotes,
    }


async def set_request_status(db: AsyncSession, organizer: Vendor, request_id: UUID, status: str) -> dict:
    request, event, _ = await _load_request(db, request_id, lock=True)
    if request.organizer_id != organizer.id:
        raise HTTPException(403, "Only the organiser can close this request")
    if request.status == "awarded":
        raise HTTPException(409, "Awarded requests cannot be closed")
    if request.status == status:
        return request_out(request, event, organizer, viewer=organizer)
    request.status = status
    request.updated_at = now_utc()
    active = (await db.execute(
        select(EventVendorQuote).where(
            EventVendorQuote.request_id == request.id,
            EventVendorQuote.status.in_(("submitted", "shortlisted")),
        )
    )).scalars().all()
    for quote in active:
        quote.status = "declined"
        quote.updated_at = now_utc()
        await create_notification(
            db, quote.vendor_id, NotificationType.EVENT_HOST_UPDATE,
            f"Request {status}: {request.title}",
            f"{organizer.business_name} closed the vendor request for {event.title}.",
            sender_id=organizer.id, data={"request_id": str(request.id), "status": status},
        )
    audit(db, action=f"event_desk.request.{status}", entity_type="event_vendor_request",
          entity_id=request.id, actor_vendor_id=organizer.id, payload={"status": status})
    return request_out(request, event, organizer, viewer=organizer)


async def submit_quote(db: AsyncSession, vendor: Vendor, request_id: UUID, data: QuoteIn) -> dict:
    if vendor.fraud_suspended_at is not None:
        raise HTTPException(403, "This account cannot quote while suspended")
    request, event, organizer = await _load_request(db, request_id, lock=True)
    if request.organizer_id == vendor.id:
        raise HTTPException(409, "You cannot quote your own event")
    if request.status != "open":
        raise HTTPException(409, "This request is not open")
    deadline = naive_utc(request.response_deadline)
    if deadline is None or deadline <= now_utc():
        raise HTTPException(409, "The response deadline has passed")
    if event.status not in ("upcoming", "active") or naive_utc(event.start_date) <= now_utc():
        raise HTTPException(409, "This event has already started")

    package_name = None
    if data.package_id:
        package = (await db.execute(
            select(RateCardPackage)
            .join(VendorRateCard, VendorRateCard.id == RateCardPackage.rate_card_id)
            .where(
                RateCardPackage.id == data.package_id,
                VendorRateCard.vendor_id == vendor.id,
                RateCardPackage.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if package is None:
            raise HTTPException(404, "Rate-card package not found")
        package_name = package.name

    valid_until = naive_utc(data.valid_until)
    if valid_until and valid_until <= now_utc():
        raise HTTPException(422, "The quote validity must be in the future")

    existing = (await db.execute(
        select(EventVendorQuote).where(
            EventVendorQuote.request_id == request.id,
            EventVendorQuote.vendor_id == vendor.id,
        ).with_for_update()
    )).scalar_one_or_none()
    if existing and existing.status not in ("submitted", "shortlisted"):
        raise HTTPException(409, "This quote can no longer be changed")

    if existing:
        quote = existing
    else:
        quote = EventVendorQuote(
            id=uuid.uuid4(), request_id=request.id, vendor_id=vendor.id,
            status="submitted",
        )
        db.add(quote)
    quote.package_id = data.package_id
    quote.amount_kes = data.amount_kes
    quote.message = data.message.strip()
    quote.inclusions = data.inclusions
    quote.valid_until = valid_until
    quote.updated_at = now_utc()
    await db.flush()
    await create_notification(
        db, organizer.id, NotificationType.EVENT_HOST_UPDATE,
        f"New quote for {request.title}",
        f"{vendor.business_name} quoted KES {data.amount_kes:,} for {event.title}.",
        sender_id=vendor.id, data={"request_id": str(request.id), "quote_id": str(quote.id)},
    )
    audit(db, action="event_desk.quote.submitted", entity_type="event_vendor_quote",
          entity_id=quote.id, actor_vendor_id=vendor.id,
          payload={"request_id": request.id, "amount_kes": quote.amount_kes})
    return _quote_out(quote, vendor, organizer, include_contact=False, package_name=package_name)


async def my_quotes(db: AsyncSession, vendor: Vendor, *, limit: int = 50) -> dict:
    rows = (await db.execute(
        select(EventVendorQuote, EventVendorRequest, Event, Vendor, RateCardPackage.name)
        .join(EventVendorRequest, EventVendorRequest.id == EventVendorQuote.request_id)
        .join(Event, Event.id == EventVendorRequest.event_id)
        .join(Vendor, Vendor.id == EventVendorRequest.organizer_id)
        .outerjoin(RateCardPackage, RateCardPackage.id == EventVendorQuote.package_id)
        .where(EventVendorQuote.vendor_id == vendor.id)
        .order_by(EventVendorQuote.created_at.desc())
        .limit(limit)
    )).all()
    return {
        "quotes": [
            {
                **_quote_out(quote, vendor, vendor, include_contact=quote.status == "accepted", package_name=package_name),
                "request": {
                    "id": str(request.id),
                    "title": request.title,
                    "category": request.category,
                    "status": request.status,
                    "response_deadline": _iso(request.response_deadline),
                },
                "event": _event_brief(event),
                "organizer": _vendor_public(organizer),
                "organizer_contact": _contact(organizer) if quote.status == "accepted" else None,
            }
            for quote, request, event, organizer, package_name in rows
        ]
    }


async def set_quote_status(db: AsyncSession, actor: Vendor, quote_id: UUID, status: str) -> dict:
    # Lock order is request → quote, matching submit_quote. Locking the quote
    # first would let a concurrent submission deadlock against an acceptance.
    initial = (await db.execute(
        select(EventVendorQuote.request_id).where(EventVendorQuote.id == quote_id)
    )).scalar_one_or_none()
    if initial is None:
        raise HTTPException(404, "Quote not found")
    request, event, organizer = await _load_request(db, initial, lock=True)
    quote = (await db.execute(
        select(EventVendorQuote).where(EventVendorQuote.id == quote_id).with_for_update()
    )).scalar_one_or_none()
    if quote is None:
        raise HTTPException(404, "Quote not found")
    vendor = await db.get(Vendor, quote.vendor_id)
    if vendor is None:
        raise HTTPException(404, "Vendor not found")

    if status == "withdrawn":
        if actor.id != quote.vendor_id:
            raise HTTPException(403, "Only this vendor can withdraw the quote")
        if quote.status not in ("submitted", "shortlisted"):
            raise HTTPException(409, "This quote can no longer be withdrawn")
        quote.status = "withdrawn"
        quote.updated_at = now_utc()
        await create_notification(
            db, request.organizer_id, NotificationType.EVENT_HOST_UPDATE,
            f"Quote withdrawn: {request.title}",
            f"{vendor.business_name} withdrew their quote for {event.title}.",
            sender_id=vendor.id, data={"request_id": str(request.id), "quote_id": str(quote.id)},
        )
        await db.flush()
        audit(db, action="event_desk.quote.withdrawn", entity_type="event_vendor_quote",
              entity_id=quote.id, actor_vendor_id=actor.id, payload={"status": status})
        return _quote_out(quote, vendor, actor, include_contact=False)

    if actor.id != request.organizer_id:
        raise HTTPException(403, "Only the organiser can shortlist, accept or decline a quote")
    if quote.vendor_id == actor.id:
        raise HTTPException(409, "You cannot accept your own quote")
    if request.status in ("closed", "cancelled"):
        raise HTTPException(409, "This request is closed")
    if request.status == "awarded":
        raise HTTPException(409, "This request has already been awarded")

    if status == "shortlisted":
        if quote.status != "submitted":
            raise HTTPException(409, "Only a submitted quote can be shortlisted")
        quote.status = "shortlisted"
    elif status == "declined":
        if quote.status not in ("submitted", "shortlisted"):
            raise HTTPException(409, "This quote has already been decided")
        quote.status = "declined"
        await create_notification(
            db, vendor.id, NotificationType.EVENT_REGISTRATION,
            f"Quote declined: {request.title}",
            f"{organizer.business_name} chose another quote for {event.title}.",
            sender_id=actor.id, data={"request_id": str(request.id), "quote_id": str(quote.id)},
        )
    elif status == "accepted":
        if quote.status not in ("submitted", "shortlisted"):
            raise HTTPException(409, "This quote has already been decided")
        # The response deadline stops new quotes. It does not stop the organiser
        # from deciding on a quote that was submitted in time.
        valid_until = naive_utc(quote.valid_until)
        if valid_until and valid_until <= now_utc():
            raise HTTPException(409, "This quote has expired; ask the vendor for a fresh one")
        quote.status = "accepted"
        quote.accepted_at = now_utc()
        request.status = "awarded"
        request.updated_at = now_utc()
        others = (await db.execute(
            select(EventVendorQuote).where(
                EventVendorQuote.request_id == request.id,
                EventVendorQuote.id != quote.id,
                EventVendorQuote.status.in_(("submitted", "shortlisted")),
            )
        )).scalars().all()
        for other in others:
            other.status = "declined"
            other.updated_at = now_utc()
            await create_notification(
                db, other.vendor_id, NotificationType.EVENT_REGISTRATION,
                f"Quote declined: {request.title}",
                f"{organizer.business_name} accepted another quote for {event.title}.",
                sender_id=actor.id, data={"request_id": str(request.id)},
            )
        await create_notification(
            db, vendor.id, NotificationType.EVENT_REGISTRATION,
            f"You are booked: {request.title}",
            f"{organizer.business_name} accepted your KES {quote.amount_kes:,} quote for {event.title}. Contact details are now open; agree payment directly.",
            sender_id=actor.id, data={"request_id": str(request.id), "quote_id": str(quote.id)},
        )
    else:  # pragma: no cover - schema makes this unreachable
        raise HTTPException(422, "Unknown quote status")

    quote.updated_at = now_utc()
    await db.flush()
    if status != "accepted":
        audit(db, action=f"event_desk.quote.{status}", entity_type="event_vendor_quote",
              entity_id=quote.id, actor_vendor_id=actor.id, payload={"status": status})
    else:
        audit(db, action="event_desk.quote.accepted", entity_type="event_vendor_quote",
              entity_id=quote.id, actor_vendor_id=actor.id,
              payload={"request_id": request.id, "amount_kes": quote.amount_kes, "event_id": event.id})
    return _quote_out(quote, vendor, actor, include_contact=status == "accepted")

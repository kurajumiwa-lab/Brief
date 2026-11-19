import re
import uuid
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.discovery_visibility import scheduled_event_window, discoverable
from app.database import get_db
from app.models.events import PAYMENT_METHODS, Event, EventRegistration
from app.models.groups import GroupMembership
from app.models.vendor import Vendor
from app.models.vendor_list import VendorList, VendorListMembership
from app.modules.outside.feed import blocked_author_ids
from app.models.notification import NotificationType
from app.routes.auth import get_current_vendor
from app.services import event_payments, patron_service
from app.services.notification_service import create_notification, notify_many

router = APIRouter()

EVENT_TYPES = {"networking", "trade_show", "sourcing_trip", "popup_market", "workshop", "market_day", "trade_fair", "auction", "wedding", "ceremony", "corporate_event", "conference", "party"}


def _slugify(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return text[:80] or "event"


def _new_slug(title: str) -> str:
    return f"{_slugify(title)}-{uuid.uuid4().hex[:6]}"


class EventCreate(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    description: Optional[str] = None
    event_type: str = "networking"
    start_date: datetime
    end_date: datetime
    location: Optional[str] = None
    geo_lat: Optional[float] = None
    geo_lng: Optional[float] = None
    is_virtual: bool = False
    virtual_link: Optional[str] = None
    max_vendors: int = Field(50, ge=1)
    entry_fee: float = Field(0, ge=0)
    vendor_requirements: dict = {}
    vendor_list_id: Optional[str] = None
    group_id: Optional[str] = None
    # Structured logistics + 1-tap M-Pesa tag (spec §1A).
    meeting_point: Optional[str] = Field(default=None, max_length=500)
    departure_time: Optional[str] = Field(default=None, max_length=32)
    inclusions: list[str] = []
    checklist: list[str] = []
    payment_method: Optional[str] = None
    payment_number: Optional[str] = Field(default=None, max_length=32)
    payment_account: Optional[str] = Field(default=None, max_length=64)
    payment_recipient_name: Optional[str] = Field(default=None, max_length=120)
    hold_ttl_minutes: int = Field(120, ge=5, le=10080)

    @model_validator(mode="after")
    def _dates(self):
        # Browsers send tz-aware ISO strings ("...Z"); the columns are naive UTC.
        self.start_date = _naive_utc(self.start_date)
        self.end_date = _naive_utc(self.end_date)
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        if self.event_type not in EVENT_TYPES:
            raise ValueError(f"event_type must be one of {sorted(EVENT_TYPES)}")
        self.payment_method, self.payment_number, self.payment_account = _clean_payment(
            self.entry_fee, self.payment_method, self.payment_number, self.payment_account,
        )
        self.inclusions = [str(x).strip()[:120] for x in (self.inclusions or []) if str(x).strip()][:20]
        self.checklist = [str(x).strip()[:120] for x in (self.checklist or []) if str(x).strip()][:20]
        return self


class EventPaymentIn(BaseModel):
    """Organiser edits the price and the rail guests pay through."""
    entry_fee: float = Field(0, ge=0)
    payment_method: Optional[str] = None
    payment_number: Optional[str] = Field(default=None, max_length=32)
    payment_account: Optional[str] = Field(default=None, max_length=64)
    payment_recipient_name: Optional[str] = Field(default=None, max_length=120)
    hold_ttl_minutes: int = Field(120, ge=5, le=10080)

    @model_validator(mode="after")
    def _payment(self):
        self.payment_method, self.payment_number, self.payment_account = _clean_payment(
            self.entry_fee, self.payment_method, self.payment_number, self.payment_account,
        )
        return self


class SubmitPaymentIn(BaseModel):
    # The pasted M-Pesa confirmation SMS (or just the code). Stored as the
    # user-declared note; never treated as Daraja proof.
    raw_text: str = Field(..., min_length=1, max_length=5000)
    sms_text: Optional[str] = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def _alias(self):
        if not (self.raw_text or "").strip() and (self.sms_text or "").strip():
            self.raw_text = self.sms_text
        return self


class RejectPaymentIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


def _naive_utc(dt: datetime) -> datetime:
    """Normalise any datetime to naive UTC so it fits TIMESTAMP WITHOUT TIME ZONE."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _clean_payment(entry_fee: float, method: Optional[str], number: Optional[str],
                   account: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """The one payment rule, used by create and by the organiser's edit.

    Money never touches the platform. A priced event must name a rail the
    organiser owns; a free event must not pretend to have one.
    """
    method = (method or "").strip().upper() or None
    if method and method not in PAYMENT_METHODS:
        raise ValueError(f"payment_method must be one of {sorted(PAYMENT_METHODS)}")
    number = (number or "").strip() or None
    account = (account or "").strip() or None
    fee = float(entry_fee or 0)

    if method == "CASH":
        # Cash is paid to the organiser in person; there is no number to copy.
        if fee <= 0:
            raise ValueError("Set an entry fee, or choose the free option — cash with no fee collects nothing.")
        return "CASH", None, None
    if method == "FREE":
        if fee > 0:
            raise ValueError("A priced event needs a payment method; choose Till, Paybill, phone or cash.")
        return "FREE", None, None
    if fee > 0 and method is None:
        raise ValueError("Add how guests pay you (Till, Paybill, phone or cash) before publishing a priced event.")
    if fee <= 0 and method in event_payments.PAID_METHODS:
        raise ValueError("Set an entry fee, or choose the free option — a payment method with no fee collects nothing.")
    if method in event_payments.PAID_METHODS and not number:
        raise ValueError("Enter the Till, Paybill or phone number guests should pay.")
    if method != "PAYBILL":
        account = None
    return method, number, account


def _registration_out(r: Optional[EventRegistration]) -> Optional[dict]:
    if r is None:
        return None
    return {
        "id": str(r.id),
        "status": r.status,
        "booking_status": r.booking_status,
        "waitlist_position": r.waitlist_position,
        "hold_expires_at": r.hold_expires_at.isoformat() if r.hold_expires_at else None,
        # A resold pass is held by someone who did not send the original
        # M-Pesa note. The seller's reference is not theirs to see.
        "mpesa_code": None if (r.pass_rotation or 0) else r.mpesa_code,
        "mpesa_amount": (None if (r.pass_rotation or 0)
                         else float(r.mpesa_amount) if r.mpesa_amount is not None else None),
        "mpesa_recipient_matched": None if (r.pass_rotation or 0) else r.mpesa_recipient_matched,
        "mpesa_submitted_at": (None if (r.pass_rotation or 0)
                               else r.mpesa_submitted_at.isoformat() if r.mpesa_submitted_at else None),
        "transferred": bool(r.pass_rotation or 0),
        "registered_at": r.registered_at.isoformat() if r.registered_at else None,
        "checked_in_at": r.checked_in_at.isoformat() if r.checked_in_at else None,
        # The pass code only exists once CONFIRMED — the same code the Inbox
        # agenda derives, so the two screens can never disagree.
        "pass_code": event_payments.pass_code_for(r.id, r.pass_rotation) if r.booking_status == "CONFIRMED" else None,
    }


def _event_out(
    e: Event, organizer: Vendor, my_reg: Optional[EventRegistration] = None,
    counts: Optional[dict] = None,
) -> dict:
    cap = e.max_vendors or 0
    confirmed = (counts or {}).get("confirmed_count")
    waitlist = (counts or {}).get("waitlist_count")
    occupied = (counts or {}).get("occupied")
    # Legacy counters stay authoritative for spots_left when we have no
    # batch counts (single-event reads pass counts explicitly).
    if occupied is None:
        occupied = e.registered_count or 0
    if confirmed is None:
        confirmed = occupied
    if waitlist is None:
        waitlist = 0
    my_status = my_reg.status if my_reg else None
    return {
        "id": str(e.id),
        "slug": e.slug,
        "title": e.title,
        "description": e.description,
        "event_type": e.event_type,
        "organizer": organizer.vendor_handle,
        "organizer_id": str(organizer.id),
        "organizer_business": organizer.business_name,
        "start_date": e.start_date.isoformat(),
        "end_date": e.end_date.isoformat(),
        "location": e.location,
        "is_virtual": e.is_virtual,
        "virtual_link": e.virtual_link if my_reg and my_reg.booking_status == "CONFIRMED" else None,  # link is for registered vendors
        "max_vendors": e.max_vendors,
        "capacity": cap or None,
        "registered_count": e.registered_count,
        "confirmed_count": confirmed,
        "waitlist_count": waitlist,
        "active_holds": (counts or {}).get("active_holds", 0),
        "entry_fee": e.entry_fee,
        "price": e.entry_fee,
        "spots_left": max(0, cap - occupied) if cap else None,
        "is_full": bool(cap and occupied >= cap),
        "is_paid": event_payments.is_paid_event(e),
        "meeting_point": e.meeting_point,
        "departure_time": e.departure_time,
        "inclusions": e.inclusions or [],
        "checklist": e.checklist or [],
        "payment_method": e.payment_method,
        "payment_ready": event_payments.payment_problem(e) is None,
        "payment_problem": event_payments.payment_problem(e),
        "payment_number": e.payment_number,
        "payment_account": e.payment_account,
        "payment_recipient_name": e.payment_recipient_name,
        "hold_ttl_minutes": e.hold_ttl_minutes,
        "vendor_requirements": e.vendor_requirements or {},
        "vendor_list_id": str(e.vendor_list_id) if e.vendor_list_id else None,
        "group_id": str(e.group_id) if e.group_id else None,
        "status": e.status,
        "my_status": my_status,
        "my_booking_status": my_reg.booking_status if my_reg else None,
        "my_registration": _registration_out(my_reg),
    }


def _parse_uuid(value: Optional[str], label: str) -> Optional[UUID]:
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(400, f"{label} is not a UUID")


@router.post("/create", status_code=201)
async def create_event(
    data: EventCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Create an event. Patrons get priority, but any vendor can create."""
    vendor_list_id = _parse_uuid(data.vendor_list_id, "vendor_list_id")
    group_id = _parse_uuid(data.group_id, "group_id")

    if vendor_list_id:
        vlist = await db.get(VendorList, vendor_list_id)
        if not vlist:
            raise HTTPException(404, "Business list not found")
        from app.routes.vendor_lists import _can_manage
        if not await _can_manage(db, vendor, vlist):
            raise HTTPException(403, "Only whoever runs that list can host an event for it")
    if group_id:
        gm = (await db.execute(select(GroupMembership.id).where(
            GroupMembership.group_id == group_id, GroupMembership.vendor_id == vendor.id,
            GroupMembership.role.in_(["admin", "moderator"]), GroupMembership.is_active.is_(True),
        ))).first()
        if not gm:
            raise HTTPException(403, "Only group admins or moderators can host an event for a group")

    patron_id = None
    patron = await patron_service.get_patron(db, vendor) if vendor.is_patron else None
    if patron:
        patron_id = patron.id
        patron.total_events_organized += 1
        await patron_service.check_patron_promotion(patron.id, db, patron=patron)

    event = Event(
        organizer_id=vendor.id, patron_id=patron_id, vendor_list_id=vendor_list_id, group_id=group_id,
        slug=_new_slug(data.title),
        **data.model_dump(exclude={"vendor_list_id", "group_id"}),
    )
    db.add(event)
    await db.commit()
    return {"message": f"Event '{event.title}' created", "event_id": str(event.id), "slug": event.slug}


async def _my_registrations(db: AsyncSession, vendor_id: UUID) -> dict:
    rows = (await db.execute(
        select(EventRegistration).where(EventRegistration.vendor_id == vendor_id)
    )).scalars().all()
    return {r.event_id: r for r in rows}


@router.get("/browse")
async def browse_events(
    event_type: Optional[str] = None,
    location: Optional[str] = None,
    include_past: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Event, Vendor)
        .join(Vendor, Event.organizer_id == Vendor.id)
        .where(Event.status.in_(["upcoming", "active"]), Vendor.fraud_suspended_at.is_(None),
               Event.group_id.is_(None), Event.vendor_list_id.is_(None),
               scheduled_event_window(datetime.utcnow(), Event.start_date), discoverable(Vendor))
    )
    # Permission: events from organizers I have blocked are not offered in discovery.
    # A direct link to one still opens, the same as a blocked person's profile.
    blocked = [UUID(v) for v in (await blocked_author_ids(db, vendor)) if v]
    if blocked:
        query = query.where(Event.organizer_id.not_in(blocked))
    if event_type:
        query = query.where(Event.event_type == event_type)
    if location:
        query = query.where(Event.location.ilike(f"%{location}%"))
    query = query.order_by(Event.start_date.asc()).offset(skip).limit(limit)
    rows = (await db.execute(query)).all()

    mine = await _my_registrations(db, vendor.id)
    batch = await event_payments.counts_for(db, [e.id for e, _ in rows])
    return [_event_out(e, v, mine.get(e.id), batch.get(e.id)) for e, v in rows]


@router.get("/mine")
async def my_events(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Events you organise and events you registered for."""
    mine = await _my_registrations(db, vendor.id)
    query = (
        select(Event, Vendor).join(Vendor, Event.organizer_id == Vendor.id)
        .where((Event.organizer_id == vendor.id) | (Event.id.in_(list(mine)) if mine else False))
        .order_by(Event.start_date.asc())
    )
    rows = (await db.execute(query)).all()
    batch = await event_payments.counts_for(db, [e.id for e, _ in rows])
    return [_event_out(e, v, mine.get(e.id), batch.get(e.id)) for e, v in rows]


@router.get("/payment-queue")
async def payment_queue(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Payments waiting on *my* confirmation — the Inbox queue.

    Only events I organise: a submitted M-Pesa note, or a live cash booking on
    a cash event. Each row carries the parsed risk flags (or `cash_due`) so the
    host decides in one tap; the raw SMS note is included because the host
    needs it to verify against their Till.
    """
    # A lapsed cash hold is not waiting for the host any more; expire first so
    # the queue is what is actually actionable.
    await event_payments.expire_stale_holds(db)
    await db.commit()
    rows = (await db.execute(
        select(EventRegistration, Event, Vendor)
        .join(Event, Event.id == EventRegistration.event_id)
        .join(Vendor, Vendor.id == EventRegistration.vendor_id)
        .where(
            Event.organizer_id == vendor.id,
            or_(
                EventRegistration.booking_status == "PAYMENT_SUBMITTED",
                and_(
                    EventRegistration.booking_status == "PENDING_PAYMENT",
                    Event.payment_method == "CASH",
                ),
            ),
        )
        .order_by(EventRegistration.mpesa_submitted_at.asc().nulls_first())
    )).all()
    return [{
        "event_id": str(ev.id),
        "event_title": ev.title,
        "event_slug": ev.slug,
        "registration_id": str(r.id),
        "vendor_id": str(v.id),
        "vendor_handle": v.vendor_handle,
        "business_name": v.business_name,
        "payment_method": ev.payment_method,
        "cash_due": (ev.payment_method or "").upper() == "CASH",
        "mpesa_code": r.mpesa_code,
        "mpesa_amount": float(r.mpesa_amount) if r.mpesa_amount is not None else None,
        "mpesa_recipient_matched": r.mpesa_recipient_matched,
        "mpesa_raw_note": r.mpesa_raw_note,
        "mpesa_submitted_at": r.mpesa_submitted_at.isoformat() if r.mpesa_submitted_at else None,
        "ticket_price": ev.entry_fee,
        "amount_is_partial": (
            r.mpesa_amount is not None and float(r.mpesa_amount) < float(ev.entry_fee or 0)
        ),
    } for r, ev, v in rows]


@router.get("/by-slug/{slug}")
async def get_event_by_slug(
    slug: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Resolve /e/<slug> (WhatsApp roster link) to the event detail."""
    row = (await db.execute(
        select(Event, Vendor).join(Vendor, Event.organizer_id == Vendor.id).where(Event.slug == slug)
    )).first()
    if not row:
        raise HTTPException(404, "Event not found")
    e, v = row
    await db.get(Event, e.id, with_for_update=True)
    await event_payments.expire_stale_holds(db, event_id=e.id)
    await db.commit()
    mine = await _my_registrations(db, vendor.id)
    return _event_out(e, v, mine.get(e.id), await event_payments.counts(db, e))


@router.get("/{event_id}")
async def get_event(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(Event, Vendor).join(Vendor, Event.organizer_id == Vendor.id).where(Event.id == event_id)
    )).first()
    if not row:
        raise HTTPException(404, "Event not found")
    e, v = row
    await db.get(Event, e.id, with_for_update=True)
    await event_payments.expire_stale_holds(db, event_id=e.id)
    await db.commit()
    mine = await _my_registrations(db, vendor.id)
    return _event_out(e, v, mine.get(e.id), await event_payments.counts(db, e))


@router.patch("/{event_id}/payment")
async def update_event_payment(
    event_id: UUID,
    data: EventPaymentIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Organiser edits their own price and payment rail, including after
    publishing. Existing bookings keep the state they already reached; new
    bookings use the new rail. The platform still never holds the money."""
    event = await db.get(Event, event_id, with_for_update=True)
    if not event or event.organizer_id != vendor.id:
        raise HTTPException(404, "Event not found")
    if event.status in ("completed", "cancelled"):
        raise HTTPException(409, f"Event is {event.status}; payment details can no longer change")
    event.entry_fee = data.entry_fee
    event.payment_method = data.payment_method
    event.payment_number = data.payment_number
    event.payment_account = data.payment_account
    event.payment_recipient_name = (data.payment_recipient_name or "").strip() or None
    event.hold_ttl_minutes = data.hold_ttl_minutes
    await db.commit()
    await db.refresh(event)
    mine = await _my_registrations(db, vendor.id)
    return _event_out(event, vendor, mine.get(event.id), await event_payments.counts(db, event))


@router.get("/{event_id}/registrations")
async def event_registrations(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    if event.organizer_id != vendor.id:
        raise HTTPException(403, "Only the organiser sees the registration list")
    rows = (await db.execute(
        select(EventRegistration, Vendor).join(Vendor, Vendor.id == EventRegistration.vendor_id)
        .where(EventRegistration.event_id == event_id).order_by(EventRegistration.registered_at)
    )).all()
    return [{
        "vendor_id": str(v.id), "vendor_handle": v.vendor_handle, "business_name": v.business_name,
        "business_categories": v.business_categories or [],
        "status": r.status, "booking_status": r.booking_status,
        "waitlist_position": r.waitlist_position,
        "hold_expires_at": r.hold_expires_at.isoformat() if r.hold_expires_at else None,
        "mpesa_code": r.mpesa_code,
        "mpesa_amount": float(r.mpesa_amount) if r.mpesa_amount is not None else None,
        "mpesa_recipient_matched": r.mpesa_recipient_matched,
        "booth_assignment": r.booth_assignment, "registered_at": r.registered_at.isoformat(),
        "checked_in_at": r.checked_in_at.isoformat() if r.checked_in_at else None,
    } for r, v in rows]


async def _book(db: AsyncSession, event_id: UUID, vendor: Vendor, *, commit: bool = True) -> dict:
    event = await db.get(Event, event_id, with_for_update=True)
    if not event:
        raise HTTPException(404, "Event not found")
    if event.status not in ("upcoming", "active"):
        raise HTTPException(400, f"Event is {event.status}")

    await event_payments.expire_stale_holds(db, event_id=event_id)
    existing = (await db.execute(select(EventRegistration).where(
        EventRegistration.event_id == event_id, EventRegistration.vendor_id == vendor.id,
    ))).scalar_one_or_none()
    if existing:
        # An expired hold is not a booking: the guest may book again.
        if existing.booking_status == "EXPIRED":
            await db.delete(existing)
            await db.flush()
        else:
            raise HTTPException(400, "Already registered")

    # Events scoped to a list or group are for their members.
    if event.vendor_list_id:
        ok = (await db.execute(select(VendorListMembership.id).where(
            VendorListMembership.vendor_list_id == event.vendor_list_id,
            VendorListMembership.vendor_id == vendor.id, VendorListMembership.status == "approved",
        ))).first()
        if not ok and event.organizer_id != vendor.id:
            raise HTTPException(403, "This event is for businesses on its list")
    if event.group_id:
        ok = (await db.execute(select(GroupMembership.id).where(
            GroupMembership.group_id == event.group_id, GroupMembership.vendor_id == vendor.id,
            GroupMembership.is_active.is_(True),
        ))).first()
        if not ok and event.organizer_id != vendor.id:
            raise HTTPException(403, "This event is for members of its group")

    # A price without a rail is an unfinished event, not a free one. Refuse the
    # booking so no pass is issued that the organiser did not agree to.
    problem = event_payments.payment_problem(event)
    if problem:
        raise HTTPException(409, problem)

    req = event.vendor_requirements or {}
    wanted = [c.lower() for c in req.get("categories", [])]
    if wanted and not ({c.lower() for c in (vendor.business_categories or [])} & set(wanted)):
        raise HTTPException(400, f"This event is for businesses in: {', '.join(req['categories'])}")

    try:
        reg = await event_payments.book_spot(db, event, vendor)
    except HTTPException:
        await db.rollback()
        raise
    if reg.booking_status != "WAITLISTED":
        await create_notification(
            db, event.organizer_id, NotificationType.EVENT_REGISTRATION,
            f"@{vendor.vendor_handle} registered for {event.title}",
            f"{event.registered_count}/{event.max_vendors} vendors registered",
            sender_id=vendor.id, data={"event_id": event.id, "vendor_handle": vendor.vendor_handle},
        )
    if commit:
        await db.commit()
    current = await event_payments.counts(db, event)
    cash = (event.payment_method or "").upper() == "CASH"
    messages = {
        "CONFIRMED": f"Registered for '{event.title}' — your pass is ready",
        "PENDING_PAYMENT": (
            f"Spot held for '{event.title}' — pay the organiser in cash to confirm"
            if cash else f"Spot held for '{event.title}' — pay via M-Pesa to confirm"
        ),
        "WAITLISTED": f"You're #{reg.waitlist_position} on the waiting list for '{event.title}'",
    }
    return {
        "message": messages.get(reg.booking_status, f"Registered for '{event.title}'"),
        "booking_status": reg.booking_status,
        "status": reg.status,
        "registration": _registration_out(reg),
        "confirmed_count": current["confirmed_count"],
        "waitlist_count": current["waitlist_count"],
        "spots_left": current["spots_left"],
        "is_full": current["is_full"],
    }


@router.post("/{event_id}/register")
async def register_for_event(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Book a spot — or join the waitlist when the event is full (spec §3)."""
    return await _book(db, event_id, vendor)


@router.post("/{event_id}/book")
async def book_event(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Alias of /register with the spec's 'Book Spot' name."""
    return await _book(db, event_id, vendor)


@router.post("/{event_id}/submit-payment")
async def submit_event_payment(
    event_id: UUID,
    data: SubmitPaymentIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Paste the M-Pesa confirmation SMS. Queues a 1-tap host confirmation.

    The note is user-declared evidence, not Daraja proof: the code must be
    globally unique, the amount/recipient flags ride to the host's Inbox,
    and the Trade Pass stays locked until the host taps Confirm.
    """
    event = await db.get(Event, event_id, with_for_update=True)
    if not event:
        raise HTTPException(404, "Event not found")
    try:
        reg, summary = await event_payments.submit_payment(db, event, vendor, data.raw_text)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()
    return {
        "message": "Payment noted — waiting for the host to confirm your pass",
        "booking_status": reg.booking_status,
        "registration": _registration_out(reg),
        **summary,
    }


@router.post("/{event_id}/confirm-payment/{registration_id}")
async def confirm_event_payment(
    event_id: UUID,
    registration_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Host confirms a submitted M-Pesa note, or marks cash received.
    Unlocks the HO-84K pass; a lapsed hold is not resurrected."""
    event = await db.get(Event, event_id, with_for_update=True)
    if not event or event.organizer_id != vendor.id:
        raise HTTPException(404, "Event not found")
    # The hold may have lapsed since the host's screen loaded. Expire first so
    # a stale tap cannot issue a second pass for a seat that was released.
    await event_payments.expire_stale_holds(db, event_id=event_id)
    try:
        reg = await event_payments.confirm_payment(db, event, registration_id)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()
    return {
        "message": ("Cash marked received — pass unlocked"
                    if (event.payment_method or "").upper() == "CASH"
                    else "Payment confirmed — pass unlocked"),
        "booking_status": reg.booking_status,
        "registration": _registration_out(reg),
        "pass_code": event_payments.pass_code_for(reg.id, reg.pass_rotation),
    }


@router.post("/{event_id}/reject-payment/{registration_id}")
async def reject_event_payment(
    event_id: UUID,
    registration_id: UUID,
    data: RejectPaymentIn = RejectPaymentIn(),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Host rejects a note. The seat stays held for a corrected submission."""
    event = await db.get(Event, event_id, with_for_update=True)
    if not event or event.organizer_id != vendor.id:
        raise HTTPException(404, "Event not found")
    try:
        reg = await event_payments.reject_payment(db, event, registration_id, data.reason)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()
    return {
        "message": "Payment rejected — guest can submit a corrected code",
        "booking_status": reg.booking_status,
        "registration": _registration_out(reg),
    }


@router.get("/{event_id}/roster")
async def event_roster(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Live roster for the WhatsApp share button. Host only: confirmed
    names are the host's to broadcast; everyone else sees the counts on
    the event detail."""
    event = await db.get(Event, event_id, with_for_update=True)
    if not event or event.organizer_id != vendor.id:
        raise HTTPException(404, "Event not found")
    await event_payments.expire_stale_holds(db, event_id=event.id)
    await db.commit()
    return await event_payments.roster(db, event)


@router.post("/{event_id}/cancel-registration")
async def cancel_registration(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    event = await db.get(Event, event_id, with_for_update=True)
    reg = (await db.execute(select(EventRegistration).where(
        EventRegistration.event_id == event_id, EventRegistration.vendor_id == vendor.id,
    ))).scalar_one_or_none()
    if not event or not reg:
        raise HTTPException(404, "Registration not found")
    await event_payments.cancel_booking(db, event, reg)
    await db.commit()
    return {"message": "Registration cancelled"}


@router.post("/{event_id}/status")
async def set_event_status(
    event_id: UUID,
    status: str = Query(..., pattern="^(upcoming|active|completed|cancelled)$"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    event = await db.get(Event, event_id)
    if not event or event.organizer_id != vendor.id:
        raise HTTPException(404, "Event not found")
    previous = event.status
    event.status = status
    if status == "completed" and previous != "completed":
        # Registered vendors who never checked in are no-shows (post-event analytics).
        regs = (await db.execute(select(EventRegistration).where(
            EventRegistration.event_id == event_id, EventRegistration.status.in_(("registered", "confirmed")),
        ))).scalars().all()
        for r in regs:
            r.status = "no_show"
    if status == "cancelled" and previous != "cancelled":
        vendor_ids = (await db.execute(select(EventRegistration.vendor_id).where(
            EventRegistration.event_id == event_id, EventRegistration.status.in_(("registered", "confirmed")),
        ))).scalars().all()
        await notify_many(db, vendor_ids, NotificationType.SYSTEM, f"Cancelled: {event.title}",
                          f"The organiser @{vendor.vendor_handle} cancelled this event.",
                          sender_id=vendor.id, data={"event_id": event.id})
    await db.commit()
    return {"message": f"Event is now {status}", "status": status}


# --- check-in & post-event analytics (v2.1 §4.4) --------------------------------------

async def _check_in(db: AsyncSession, event: Event, vendor_id: UUID) -> EventRegistration:
    reg = (await db.execute(select(EventRegistration).where(
        EventRegistration.event_id == event.id, EventRegistration.vendor_id == vendor_id,
    ))).scalar_one_or_none()
    if not reg:
        raise HTTPException(404, "No registration for that business")
    # Only a CONFIRMED booking checks in. An unpaid hold or a waitlist place
    # is not a seat at the door, however real the registration row is.
    if reg.booking_status != "CONFIRMED":
        raise HTTPException(400, "Only confirmed bookings can check in — pay and wait for the host to confirm first")
    if reg.status != "attended":
        reg.status = "attended"
        reg.checked_in_at = datetime.utcnow()
    return reg


@router.post("/{event_id}/check-in")
async def self_check_in(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """A registered vendor checks in once the event is running (or on the day)."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    now = datetime.utcnow()
    window_open = event.status == "active" or (event.status == "upcoming" and event.start_date.date() <= now.date())
    if not window_open:
        raise HTTPException(400, "Check-in opens on the day of the event")
    reg = await _check_in(db, event, vendor.id)
    await db.commit()
    return {"message": f"Checked in to '{event.title}'", "status": reg.status, "checked_in_at": reg.checked_in_at.isoformat()}


@router.post("/{event_id}/check-in/{vendor_id}")
async def organiser_check_in(
    event_id: UUID,
    vendor_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The organiser marks a vendor present at the door."""
    event = await db.get(Event, event_id)
    if not event or event.organizer_id != vendor.id:
        raise HTTPException(404, "Event not found")
    reg = await _check_in(db, event, vendor_id)
    await db.commit()
    return {"message": "Checked in", "status": reg.status, "checked_in_at": reg.checked_in_at.isoformat()}


@router.get("/{event_id}/analytics")
async def event_analytics(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Registrations, attendance and the category mix — for the organiser."""
    event = await db.get(Event, event_id)
    if not event or event.organizer_id != vendor.id:
        raise HTTPException(404, "Event not found")
    rows = (await db.execute(
        select(EventRegistration, Vendor).join(Vendor, Vendor.id == EventRegistration.vendor_id)
        .where(EventRegistration.event_id == event_id)
    )).all()
    by_status: dict[str, int] = {}
    by_booking: dict[str, int] = {}
    categories: dict[str, int] = {}
    for r, v in rows:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        by_booking[r.booking_status] = by_booking.get(r.booking_status, 0) + 1
        for c in v.business_categories or []:
            categories[c] = categories.get(c, 0) + 1
    attended = by_status.get("attended", 0)
    registered = len(rows)
    current = await event_payments.counts(db, event)
    return {
        "event_id": str(event.id),
        "status": event.status,
        "registered": registered,
        "capacity": event.max_vendors,
        "confirmed_count": current["confirmed_count"],
        "waitlist_count": current["waitlist_count"],
        "active_holds": current["active_holds"],
        "fill_rate": round(100.0 * registered / event.max_vendors, 1) if event.max_vendors else 0,
        "attended": attended,
        "no_show": by_status.get("no_show", 0),
        "attendance_rate": round(100.0 * attended / registered, 1) if registered else 0,
        "by_status": by_status,
        "by_booking_status": by_booking,
        "categories": sorted(({"category": k, "vendors": n} for k, n in categories.items()), key=lambda x: -x["vendors"]),
    }

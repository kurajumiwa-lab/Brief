"""Calendar rules: the week view, free slots, booking and appointment status.

Everything here works on naive Nairobi wall-clock times (see models.py).
"""

import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bookings import ToolBooking
from app.models.events import Event, EventRegistration
from app.models.vendor import Vendor
from app.modules.schedule.models import (
    HOLDING_STATUSES, Appointment, AvailabilityRule, BookableService, ScheduleEntry,
)

NAIROBI = ZoneInfo("Africa/Nairobi")
ENTRY_MAX_SPAN = timedelta(days=14)
TOOL_KIND_LABEL = {
    "warehouse": "Warehouse space",
    "popup_shop": "Pop-up shop",
    "hotel_sourcing": "Hotel stay",
}


def nairobi_now() -> datetime:
    return datetime.now(NAIROBI).replace(tzinfo=None)


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="minutes")


def _bad(message: str, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=message)


# ---------- the week ---------------------------------------------------------------

async def week_view(db: AsyncSession, vendor_id: uuid.UUID, start_day: date) -> dict:
    """Everything on one vendor's calendar for seven days, in one list.

    Sources: their own plans, appointments they host or have booked, events they
    are registered for, and tool bookings they hold. Overlapping timed items are
    returned as `conflicts` so the app can warn, not block.
    """
    start = datetime.combine(start_day, time.min)
    end = start + timedelta(days=7)
    items: list[dict] = []

    entries = (await db.execute(select(ScheduleEntry).where(
        ScheduleEntry.vendor_id == vendor_id,
        ScheduleEntry.status != "cancelled",
        ScheduleEntry.starts_at < end, ScheduleEntry.ends_at > start,
    ))).scalars().all()
    for e in entries:
        items.append({"id": str(e.id), "source": "plan", "kind": e.kind, "title": e.title,
                      "starts_at": _iso(e.starts_at), "ends_at": _iso(e.ends_at),
                      "status": e.status, "location": e.location, "editable": True})

    hosted = (await db.execute(
        select(Appointment, BookableService.name).join(BookableService, BookableService.id == Appointment.service_id)
        .where(Appointment.vendor_id == vendor_id, Appointment.status.in_(HOLDING_STATUSES),
               Appointment.starts_at < end, Appointment.ends_at > start)
    )).all()
    for appt, service_name in hosted:
        items.append({"id": str(appt.id), "source": "appointment", "kind": "meeting",
                      "title": f"{service_name} with {appt.client_name}",
                      "starts_at": _iso(appt.starts_at), "ends_at": _iso(appt.ends_at),
                      "status": appt.status, "location": None, "editable": False})

    booked = (await db.execute(
        select(Appointment, BookableService.name).join(BookableService, BookableService.id == Appointment.service_id)
        .where(Appointment.client_vendor_id == vendor_id, Appointment.status.in_(("requested", "confirmed")),
               Appointment.starts_at < end, Appointment.ends_at > start)
    )).all()
    for appt, service_name in booked:
        items.append({"id": str(appt.id), "source": "appointment", "kind": "meeting",
                      "title": f"Booked: {service_name}",
                      "starts_at": _iso(appt.starts_at), "ends_at": _iso(appt.ends_at),
                      "status": appt.status, "location": None, "editable": False})

    events = (await db.execute(
        select(Event, EventRegistration.status)
        .join(EventRegistration, EventRegistration.event_id == Event.id)
        .where(EventRegistration.vendor_id == vendor_id,
               EventRegistration.status.in_(("registered", "confirmed")),
               Event.status != "cancelled",
               Event.start_date < end, Event.end_date > start)
    )).all()
    for ev, reg_status in events:
        items.append({"id": str(ev.id), "source": "event", "kind": "event", "title": ev.title,
                      "starts_at": _iso(ev.start_date), "ends_at": _iso(ev.end_date),
                      "status": reg_status, "location": ev.location, "editable": False})

    bookings = (await db.execute(select(ToolBooking).where(
        ToolBooking.booker_vendor_id == vendor_id,
        ToolBooking.status.in_(("requested", "confirmed")),
        ToolBooking.start_date < end, ToolBooking.end_date > start,
    ))).scalars().all()
    for b in bookings:
        items.append({"id": str(b.id), "source": "booking", "kind": "booking",
                      "title": TOOL_KIND_LABEL.get(b.kind, "Booking"),
                      "starts_at": _iso(b.start_date), "ends_at": _iso(b.end_date),
                      "status": b.status, "location": None, "editable": False})

    items.sort(key=lambda i: i["starts_at"])
    conflicts = []
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            if overlaps(datetime.fromisoformat(a["starts_at"]), datetime.fromisoformat(a["ends_at"]),
                        datetime.fromisoformat(b["starts_at"]), datetime.fromisoformat(b["ends_at"])):
                conflicts.append([a["id"], b["id"]])
    return {"start": _iso(start), "end": _iso(end), "items": items, "conflicts": conflicts}


# ---------- personal plans ----------------------------------------------------------

def check_entry_times(starts_at: datetime, ends_at: datetime) -> None:
    if ends_at <= starts_at:
        raise _bad("The end time must be after the start time.")
    if ends_at - starts_at > ENTRY_MAX_SPAN:
        raise _bad("A single plan can span at most 14 days.")


async def get_entry(db: AsyncSession, vendor_id: uuid.UUID, entry_id: uuid.UUID) -> ScheduleEntry:
    entry = (await db.execute(select(ScheduleEntry).where(
        ScheduleEntry.id == entry_id, ScheduleEntry.vendor_id == vendor_id))).scalar_one_or_none()
    if entry is None:
        raise _bad("Not found.", 404)
    return entry


# ---------- services and hours ------------------------------------------------------

async def get_service(db: AsyncSession, vendor_id: uuid.UUID, service_id: uuid.UUID) -> BookableService:
    service = (await db.execute(select(BookableService).where(
        BookableService.id == service_id, BookableService.vendor_id == vendor_id))).scalar_one_or_none()
    if service is None:
        raise _bad("Service not found.", 404)
    return service


def check_rules(rules: list[dict]) -> None:
    """Windows on the same weekday must not overlap."""
    by_day: dict[int, list[tuple[int, int]]] = {}
    for r in rules:
        by_day.setdefault(r["weekday"], []).append((r["start_minute"], r["end_minute"]))
    for windows in by_day.values():
        windows.sort()
        for (s1, e1), (s2, _e2) in zip(windows, windows[1:]):
            if s2 < e1:
                raise _bad("Opening hours on the same day overlap.")


async def replace_rules(db: AsyncSession, vendor_id: uuid.UUID, rules: list[dict]) -> list[AvailabilityRule]:
    check_rules(rules)
    existing = (await db.execute(select(AvailabilityRule).where(
        AvailabilityRule.vendor_id == vendor_id))).scalars().all()
    for row in existing:
        await db.delete(row)
    await db.flush()
    created = []
    for r in rules:
        row = AvailabilityRule(vendor_id=vendor_id, **r)
        db.add(row)
        created.append(row)
    await db.flush()
    return created


# ---------- slots and booking -------------------------------------------------------

async def _busy_for(db: AsyncSession, vendor_id: uuid.UUID, start: datetime, end: datetime,
                    pad: timedelta = timedelta(0)) -> list[tuple[datetime, datetime]]:
    """Time a vendor cannot use: appointments they hold or have booked, and planned entries."""
    busy: list[tuple[datetime, datetime]] = []
    window_start, window_end = start - timedelta(hours=1), end + timedelta(hours=1)
    rows = (await db.execute(select(Appointment.starts_at, Appointment.ends_at).where(
        Appointment.status.in_(HOLDING_STATUSES),
        or_(Appointment.vendor_id == vendor_id, Appointment.client_vendor_id == vendor_id),
        Appointment.starts_at < window_end, Appointment.ends_at > window_start,
    ))).all()
    busy.extend((s - pad, e + pad) for s, e in rows)
    plans = (await db.execute(select(ScheduleEntry.starts_at, ScheduleEntry.ends_at).where(
        ScheduleEntry.vendor_id == vendor_id, ScheduleEntry.status == "planned",
        ScheduleEntry.starts_at < window_end, ScheduleEntry.ends_at > window_start,
    ))).all()
    busy.extend((s - pad, e + pad) for s, e in plans)
    return busy


async def free_slots(db: AsyncSession, host_id: uuid.UUID, service: BookableService, day: date) -> list[datetime]:
    """Start times on `day` when `service` can be booked with `host_id`.

    Buffers: the candidate service's own buffer is kept on both sides of it
    (busy time is padded by that buffer). An existing booking's buffer, if it
    was for a different service, is not re-applied. Good enough for v1 where a
    business normally uses one break length; revisit if they differ a lot.
    """
    rules = (await db.execute(select(AvailabilityRule).where(
        AvailabilityRule.vendor_id == host_id, AvailabilityRule.weekday == day.weekday()))).scalars().all()
    if not rules:
        return []
    day_start = datetime.combine(day, time.min)
    busy = await _busy_for(db, host_id, day_start, day_start + timedelta(days=1), pad=timedelta(minutes=service.buffer_minutes))
    now = nairobi_now()
    length = timedelta(minutes=service.duration_minutes)
    step = length + timedelta(minutes=service.buffer_minutes)
    slots: list[datetime] = []
    for rule in sorted(rules, key=lambda r: r.start_minute):
        t = day_start + timedelta(minutes=rule.start_minute)
        limit = day_start + timedelta(minutes=rule.end_minute)
        while t + length <= limit:
            if t > now and not any(overlaps(t, t + length, bs, be) for bs, be in busy):
                slots.append(t)
            t += step
    return slots


async def book(db: AsyncSession, client_id: uuid.UUID, host_id: uuid.UUID, service_id: uuid.UUID,
               starts_at: datetime, client_name: str, client_phone: str | None,
               notes: str | None) -> Appointment:
    if client_id == host_id:
        raise _bad("You cannot book your own service.")
    service = (await db.execute(select(BookableService).where(
        BookableService.id == service_id, BookableService.vendor_id == host_id,
        BookableService.is_active.is_(True)))).scalar_one_or_none()
    if service is None:
        raise _bad("This service is not available.", 404)

    # Serialise bookings for this host: a second request waits here until the first commits.
    await db.execute(select(Vendor.id).where(Vendor.id == host_id).with_for_update())

    if starts_at not in await free_slots(db, host_id, service, starts_at.date()):
        raise _bad("That time is no longer free. Pick another slot.", 409)
    ends_at = starts_at + timedelta(minutes=service.duration_minutes)
    if any(overlaps(starts_at, ends_at, bs, be)
           for bs, be in await _busy_for(db, client_id, starts_at, ends_at)):
        raise _bad("You already have something at this time.", 409)

    appt = Appointment(vendor_id=host_id, service_id=service.id, client_vendor_id=client_id,
                       client_name=client_name, client_phone=client_phone, starts_at=starts_at,
                       ends_at=ends_at, status="requested", notes=notes)
    db.add(appt)
    await db.flush()
    return appt


ACTOR_TRANSITIONS = {
    "host": {"requested": {"confirmed", "declined"},
             "confirmed": {"completed", "no_show", "cancelled"}},
    "client": {"requested": {"cancelled"}, "confirmed": {"cancelled"}},
}


async def set_status(db: AsyncSession, vendor_id: uuid.UUID, appt_id: uuid.UUID, new_status: str) -> Appointment:
    appt = (await db.execute(select(Appointment).where(Appointment.id == appt_id, or_(
        Appointment.vendor_id == vendor_id, Appointment.client_vendor_id == vendor_id)))).scalar_one_or_none()
    if appt is None:
        raise _bad("Appointment not found.", 404)
    role = "host" if appt.vendor_id == vendor_id else "client"
    allowed = ACTOR_TRANSITIONS[role].get(appt.status, set())
    if new_status not in allowed:
        raise _bad(f"You cannot change a {appt.status} appointment to {new_status}.", 409)
    appt.status = new_status
    await db.flush()
    return appt


async def list_appointments(db: AsyncSession, vendor_id: uuid.UUID, role: str) -> list[tuple[Appointment, str]]:
    column = Appointment.vendor_id if role == "host" else Appointment.client_vendor_id
    rows = (await db.execute(
        select(Appointment, BookableService.name)
        .join(BookableService, BookableService.id == Appointment.service_id)
        .where(column == vendor_id)
        .order_by(Appointment.starts_at.desc()).limit(200)
    )).all()
    return [(a, name) for a, name in rows]


def appointment_out(appt: Appointment, service_name: str, role: str) -> dict:
    out = {
        "id": str(appt.id), "service": service_name, "status": appt.status,
        "starts_at": _iso(appt.starts_at), "ends_at": _iso(appt.ends_at), "notes": appt.notes,
        "role": role,
    }
    if role == "host":
        out["client_name"] = appt.client_name
        out["client_phone"] = appt.client_phone
    return out

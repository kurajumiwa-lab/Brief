"""
Tool bookings — the calendar behind warehouse space, popup pitches and hotel
rooms for travelling vendors (Directive v2.1 §5.2, §5.3, §5.4).

One table, one status machine, three shapes of booking. The only thing that
changes between kinds is what counts as capacity:

    warehouse   capacity from the listing (`capacity.sqm` / `capacity.pallets`,
                else unlimited) — overlapping live bookings are summed
    popup_shop  `PopupShop.shared_spaces_available` floor spaces, `quantity`
                vendors can share a day
    hotel       rooms; `details.rooms` requested per night, no listing cap

A booking is live while its status is `requested` or `confirmed`. Availability
on a given day is capacity minus live bookings overlapping that day.
"""

from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bookings import KIND_FROM_CATEGORY, ToolBooking
from app.models.tools import HotelSourcing, PopupShop, ToolListing
from app.models.vendor import Vendor

LIVE_STATUSES = ("requested", "confirmed")

KIND_LABEL = {
    "warehouse": "space",
    "popup_shop": "pitch",
    "hotel_sourcing": "room",
}


class BookingError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def kind_for(category) -> Optional[str]:
    value = getattr(category, "value", category)
    return KIND_FROM_CATEGORY.get(value)


def _capacity_int(capacity: dict, *keys: str) -> Optional[int]:
    for key in keys:
        try:
            val = int(float((capacity or {}).get(key)))
        except (TypeError, ValueError):
            continue
        if val > 0:
            return val
    return None


async def capacity_for(db: AsyncSession, listing: ToolListing) -> Optional[int]:
    """How many `quantity` units can be booked at once. None = uncapped."""
    kind = kind_for(listing.category)
    if kind == "popup_shop":
        shop = (await db.execute(
            select(PopupShop).where(PopupShop.tool_listing_id == listing.id)
        )).scalars().first()
        if shop and shop.shared_spaces_available:
            return int(shop.shared_spaces_available)
        return _capacity_int(listing.capacity, "spaces", "units") or 1
    if kind == "warehouse":
        return _capacity_int(listing.capacity, "sqm", "sqm_available", "pallets", "units")
    # Hotels: rooms the host declares, if any. None = the host decides per request.
    return _capacity_int(listing.capacity, "rooms", "units")


def unit_for(listing: ToolListing, kind: Optional[str] = None) -> str:
    """The natural unit of a listing: the capacity key it declares, else a default."""
    kind = kind or kind_for(listing.category)
    if kind == "hotel_sourcing":
        return "rooms"
    if kind == "popup_shop":
        return "spaces"
    capacity = listing.capacity or {}
    for key in ("sqm", "pallets", "units"):
        if _capacity_int(capacity, key):
            return key
    return capacity.get("unit") or "units"


async def _live_overlap(db: AsyncSession, listing_id: UUID, start: datetime, end: datetime,
                        exclude: Optional[UUID] = None) -> list[ToolBooking]:
    query = select(ToolBooking).where(
        ToolBooking.tool_listing_id == listing_id,
        ToolBooking.status.in_(LIVE_STATUSES),
        ToolBooking.start_date < end,
        ToolBooking.end_date > start,
    )
    if exclude:
        query = query.where(ToolBooking.id != exclude)
    return (await db.execute(query)).scalars().all()


async def requested_units(db: AsyncSession, listing: ToolListing, start: datetime, end: datetime,
                          exclude: Optional[UUID] = None, details: Optional[dict] = None) -> int:
    """Units already committed over a window. Hotels count rooms, not bookings."""
    rows = await _live_overlap(db, listing.id, start, end, exclude)
    kind = kind_for(listing.category)
    if kind == "hotel_sourcing":
        return sum(int((r.details or {}).get("rooms") or r.quantity or 1) for r in rows)
    return sum(int(r.quantity or 1) for r in rows)


async def create_booking(
    db: AsyncSession,
    listing: ToolListing,
    booker: Vendor,
    start: datetime,
    end: datetime,
    quantity: int = 1,
    unit: Optional[str] = None,
    details: Optional[dict] = None,
    notes: Optional[str] = None,
    auto_confirm: bool = False,
) -> ToolBooking:
    """Validate and hold a window. Caller commits (and notifies)."""
    kind = kind_for(listing.category)
    if kind is None:
        raise BookingError("This listing does not take bookings — only warehouse, cold storage, "
                           "popup shops and hotel sourcing do", 400)
    if not listing.is_available:
        raise BookingError("This listing is currently unavailable", 400)
    if listing.vendor_id == booker.id:
        raise BookingError("This is your own listing")
    if end <= start:
        raise BookingError("end must be after start")
    if quantity <= 0:
        raise BookingError("quantity must be positive")

    capacity = await capacity_for(db, listing)
    committed = await requested_units(db, listing, start, end)
    if capacity is not None and committed + quantity > capacity:
        free = max(0, capacity - quantity - committed) if capacity > quantity else 0
        raise BookingError(
            f"Only {max(0, capacity - committed)} of {capacity} {unit or 'units'} free in that window "
            f"(consider a different window or ask the host)", 409)

    quantity = int(quantity)
    booking = ToolBooking(
        tool_listing_id=listing.id,
        booker_vendor_id=booker.id,
        kind=kind,
        status="confirmed" if auto_confirm else "requested",
        start_date=start,
        end_date=end,
        quantity=quantity,
        unit=unit or ("rooms" if kind == "hotel_sourcing" else "spaces" if kind == "popup_shop" else "units"),
        rate=listing.price_per_unit,
        estimated_cost=round(float(listing.price_per_unit or 0) * quantity, 2) if listing.price_per_unit else None,
        details=details or {},
        notes=notes,
        decided_at=datetime.utcnow() if auto_confirm else None,
    )
    db.add(booking)
    await db.flush()
    listing.times_booked = (listing.times_booked or 0) + 1
    return booking


async def set_status(db: AsyncSession, booking: ToolBooking, status: str, actor: Vendor,
                     note: Optional[str] = None) -> ToolBooking:
    """Drive the status machine. Host decides requests; either side may cancel
    before the window starts; a finished window can be closed out."""
    listing = await db.get(ToolListing, booking.tool_listing_id)
    is_host = listing is not None and listing.vendor_id == actor.id
    is_booker = booking.booker_vendor_id == actor.id
    if not (is_host or is_booker):
        raise BookingError("Not your booking", 403)

    current = booking.status
    if status in ("confirmed", "declined"):
        if not is_host:
            raise BookingError("Only the host confirms or declines a booking", 403)
        if current not in ("requested",):
            raise BookingError(f"Booking is already {current}")
        booking.status = status
        booking.decided_at = datetime.utcnow()
        booking.decision_note = note
    elif status == "cancelled":
        if current in ("cancelled", "declined", "completed"):
            raise BookingError(f"Booking is already {current}")
        booking.status = "cancelled"
        booking.cancelled_at = datetime.utcnow()
        booking.decision_note = note
    elif status == "completed":
        # the state machine is checked first, so a dead booking says *why*
        # (400) rather than hiding behind the host-only rule (403)
        if current != "confirmed":
            raise BookingError(f"A {current} booking cannot be completed")
        if not is_host:
            raise BookingError("Only the host closes out a booking", 403)
        booking.status = "completed"
        booking.decided_at = booking.decided_at or datetime.utcnow()
    else:
        raise BookingError(f"Unknown booking status '{status}'")
    return booking


def to_dict(booking: ToolBooking, listing: ToolListing, host: Vendor, booker: Vendor,
            me: Vendor, capacity: Optional[int] = None) -> dict:
    return {
        "id": str(booking.id),
        "kind": booking.kind,
        "status": booking.status,
        "start_date": booking.start_date.isoformat(),
        "end_date": booking.end_date.isoformat(),
        "quantity": booking.quantity,
        "unit": booking.unit,
        "rate": booking.rate,
        "estimated_cost": booking.estimated_cost,
        "details": booking.details or {},
        "notes": booking.notes,
        "decision_note": booking.decision_note,
        "requested_at": booking.requested_at.isoformat(),
        "decided_at": booking.decided_at.isoformat() if booking.decided_at else None,
        "cancelled_at": booking.cancelled_at.isoformat() if booking.cancelled_at else None,
        "tool": {
            "id": str(listing.id), "title": listing.title, "category": listing.category.value,
            "location": listing.location, "capacity": listing.capacity or {},
            "price_per_unit": listing.price_per_unit, "price_unit": listing.price_unit,
        },
        "host": {"vendor_id": str(host.id), "vendor_handle": host.vendor_handle, "business_name": host.business_name},
        "booker": {"vendor_id": str(booker.id), "vendor_handle": booker.vendor_handle,
                   "business_name": booker.business_name},
        "capacity": capacity,
        "my_role": "host" if host.id == me.id else "booker",
        "can_decide": host.id == me.id and booking.status == "requested",
        "can_cancel": booking.status in LIVE_STATUSES and (host.id == me.id or booker.id == me.id),
    }


async def calendar(db: AsyncSession, listing: ToolListing, start: datetime, end: datetime,
                   my_bookings_only: Optional[UUID] = None) -> dict:
    """Day-by-day availability for a listing between two dates.

    Each day reports capacity, how much is committed and how much is free, so
    the UI can paint a calendar rather than a single "booked / free" flag.
    """
    capacity = await capacity_for(db, listing)
    rows = await _live_overlap(db, listing.id, start, end)
    kind = kind_for(listing.category)

    def committed_on(day: datetime) -> int:
        """A day counts as taken when any part of a live booking covers it —
        a booking that starts at 2pm still occupies that morning's slot."""
        total = 0
        next_day = day + timedelta(days=1)
        for b in rows:
            if b.start_date < next_day and b.end_date > day:
                if kind == "hotel_sourcing":
                    total += int((b.details or {}).get("rooms") or b.quantity or 1)
                else:
                    total += int(b.quantity or 1)
        return total

    days = []
    cursor = datetime(start.year, start.month, start.day)
    last = datetime(end.year, end.month, end.day)
    while cursor <= last:
        committed = committed_on(cursor)
        free = None if capacity is None else max(0, capacity - committed)
        mine = [b for b in rows if my_bookings_only and b.booker_vendor_id == my_bookings_only
                and b.start_date < cursor + timedelta(days=1) and b.end_date > cursor]
        days.append({
            "date": cursor.date().isoformat(),
            "capacity": capacity,
            "committed": committed,
            "free": free,
            "full": capacity is not None and committed >= capacity,
            "my_quantity": sum(int(b.quantity or 1) for b in mine) or 0,
        })
        cursor += timedelta(days=1)

    return {
        "listing_id": str(listing.id),
        "kind": kind,
        "title": listing.title,
        "unit": unit_for(listing, kind),
        "capacity": capacity,
        "from": days[0]["date"] if days else start.date().isoformat(),
        "to": days[-1]["date"] if days else end.date().isoformat(),
        "days": days,
    }


async def bookings_for(db: AsyncSession, vendor: Vendor, role: str = "all") -> list[ToolBooking]:
    """Bookings where the vendor is the host, the booker, or either."""
    if role == "host":
        listing_ids = select(ToolListing.id).where(ToolListing.vendor_id == vendor.id)
        where = ToolBooking.tool_listing_id.in_(listing_ids)
    elif role == "booker":
        where = ToolBooking.booker_vendor_id == vendor.id
    else:
        listing_ids = select(ToolListing.id).where(ToolListing.vendor_id == vendor.id)
        where = or_(ToolBooking.booker_vendor_id == vendor.id, ToolBooking.tool_listing_id.in_(listing_ids))
    return (await db.execute(
        select(ToolBooking).where(where).order_by(ToolBooking.start_date.desc()).limit(200)
    )).scalars().all()


async def my_upcoming_conflicts(db: AsyncSession, booking: ToolBooking) -> list[ToolBooking]:
    """Other live bookings the same booker has over the same window (a vendor
    cannot be in two warehouses at once)."""
    return (await db.execute(
        select(ToolBooking).where(
            ToolBooking.booker_vendor_id == booking.booker_vendor_id,
            ToolBooking.id != booking.id,
            ToolBooking.status == "confirmed",
            and_(ToolBooking.start_date < booking.end_date, ToolBooking.end_date > booking.start_date),
        )
    )).scalars().all()


async def hotel_details(db: AsyncSession, listing: ToolListing) -> Optional[dict]:
    if kind_for(listing.category) != "hotel_sourcing":
        return None
    row = (await db.execute(select(HotelSourcing).where(HotelSourcing.tool_listing_id == listing.id))).scalars().first()
    if not row:
        return None
    return {"hotel_name": row.hotel_name, "proximity_to": row.proximity_to or [],
            "vendor_rate": row.vendor_rate, "includes_storage": row.includes_storage,
            "meeting_room": row.meeting_room}

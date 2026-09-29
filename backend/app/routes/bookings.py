"""
Dated tool bookings & availability calendars — Directive v2.1 §5.2 (warehouse
space, live availability), §5.3 (popup shop booking) and §5.4 (hotel sourcing
for travelling vendors).

All three live on one calendar model (`app/services/booking_service.py`), so
the flows are the same shape: a vendor asks for a window, the host confirms or
declines, either side can cancel before it starts, the host closes it out.

    POST /api/tools/{tool_id}/book                        ask for a window
    POST /api/tools/{tool_id}/book-warehouse              legacy alias (kept)
    GET  /api/tools/{tool_id}/availability-calendar       day-by-day free space
    GET  /api/tools/bookings?role=host|booker|all         your bookings
    GET  /api/tools/bookings/{id}                         one booking
    POST /api/tools/bookings/{id}/status?status=...       confirm / decline / cancel / complete
"""

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, Union
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.bookings import ToolBooking
from app.models.notification import NotificationType
from app.models.tools import ToolCategory, ToolListing
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import booking_service
from app.services.notification_service import create_notification

router = APIRouter()

BOOKABLE_CATEGORIES = (
    ToolCategory.WAREHOUSE, ToolCategory.COLD_STORAGE, ToolCategory.POPUP_SHOP, ToolCategory.HOTEL_SOURCING,
)


class BookingCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Browsers send `2026-10-01` from a date input and `2026-10-01T08:00` from a
    # datetime picker; accept both. A bare date means midnight that day.
    start_date: Union[datetime, date]
    end_date: Union[datetime, date]
    quantity: int = Field(1, ge=1)
    unit: Optional[str] = Field(None, max_length=50)
    details: dict = {}
    notes: Optional[str] = Field(None, max_length=1000)

    @field_validator("start_date", "end_date")
    @classmethod
    def _naive_utc(cls, value: Union[datetime, date]) -> datetime:
        if isinstance(value, date) and not isinstance(value, datetime):
            return datetime.combine(value, time.min)
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


class WarehouseBookingIn(BookingCreate):
    """The original §2.4 warehouse payload, still accepted: `space_allocated`."""

    space_allocated: dict = {}


def _booking_or_404(booking: Optional[ToolBooking]) -> ToolBooking:
    if not booking:
        raise HTTPException(404, "Booking not found")
    return booking


def _day(value: Optional[str]) -> Optional[datetime]:
    """Accept `2026-10-01` or `2026-10-01T08:00[,Z]` — browsers send both shapes."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"'{value}' is not a date or datetime")
    if parsed.tzinfo:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


async def _out(db: AsyncSession, booking: ToolBooking, me: Vendor) -> dict:
    listing = await db.get(ToolListing, booking.tool_listing_id)
    host = await db.get(Vendor, listing.vendor_id) if listing else None
    booker = await db.get(Vendor, booking.booker_vendor_id)
    if not listing or not host or not booker:
        raise HTTPException(410, "The listing behind this booking is gone")
    capacity = await booking_service.capacity_for(db, listing)
    return booking_service.to_dict(booking, listing, host, booker, me, capacity)


async def _book(db: AsyncSession, tool_id: UUID, data: BookingCreate, vendor: Vendor,
                space_allocated: Optional[dict] = None) -> dict:
    listing = await db.get(ToolListing, tool_id)
    if not listing:
        raise HTTPException(404, "Tool not found")
    if listing.category not in BOOKABLE_CATEGORIES:
        raise HTTPException(400, "Only warehouse, cold storage, popup shop and hotel listings take bookings")

    details = dict(data.details or {})
    if space_allocated:
        details["space_allocated"] = space_allocated

    try:
        booking = await booking_service.create_booking(
            db, listing, vendor, data.start_date, data.end_date,
            quantity=data.quantity, unit=data.unit, details=details, notes=data.notes,
        )
    except booking_service.BookingError as exc:
        raise HTTPException(exc.status_code, str(exc))

    host = await db.get(Vendor, listing.vendor_id)
    label = booking_service.KIND_LABEL.get(booking.kind, "booking")
    await create_notification(
        db, listing.vendor_id, NotificationType.BOOKING_REQUEST,
        f"@{vendor.vendor_handle} wants {booking.quantity} {booking.unit} of {listing.title}",
        f"{booking.start_date.date()} → {booking.end_date.date()}"
        + (f" · {booking.estimated_cost:g} KES estimated" if booking.estimated_cost else ""),
        sender_id=vendor.id,
        data={"booking_id": booking.id, "tool_id": listing.id, "kind": booking.kind,
              "start_date": booking.start_date, "end_date": booking.end_date,
              "quantity": booking.quantity, "unit": booking.unit, "host_handle": host.vendor_handle if host else None},
    )
    await db.commit()
    await db.refresh(booking)
    return {
        "message": f"{label.capitalize()} requested — the host will confirm",
        "booking_id": str(booking.id),
        "kind": booking.kind,
        "status": booking.status,
        "start_date": booking.start_date.isoformat(),
        "end_date": booking.end_date.isoformat(),
        "quantity": booking.quantity,
        "unit": booking.unit,
        "estimated_cost": booking.estimated_cost,
        **_out_payload(booking, listing, host, vendor),
    }


def _out_payload(booking: ToolBooking, listing: ToolListing, host: Optional[Vendor], booker: Vendor) -> dict:
    return {
        "listing": {"id": str(listing.id), "title": listing.title, "category": listing.category.value,
                    "location": listing.location, "price_per_unit": listing.price_per_unit,
                    "price_unit": listing.price_unit, "capacity": listing.capacity or {}},
        "host_handle": host.vendor_handle if host else None,
        "booker_handle": booker.vendor_handle,
        # `rental_id` is the pre-v2.2 field name for the same row; kept so older
        # clients and scripts keep working.
        "rental_id": str(booking.id),
    }


@router.post("/{tool_id}/book", status_code=201)
async def create_booking(
    tool_id: UUID,
    data: BookingCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Ask a host for a dated window. Idempotent-by-conflict: the API refuses
    (409) rather than double-booking a full window."""
    return await _book(db, tool_id, data, vendor)


@router.post("/{tool_id}/book-warehouse", status_code=201)
async def book_warehouse(
    tool_id: UUID,
    data: WarehouseBookingIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Warehouse / cold-storage alias of `POST /book` (v2.1 §2.4 payload)."""
    return await _book(db, tool_id, data, vendor, space_allocated=data.space_allocated)


@router.get("/{tool_id}/availability-calendar")
async def availability_calendar(
    tool_id: UUID,
    start: Optional[str] = Query(None, alias="from"),
    end: Optional[str] = Query(None, alias="to"),
    days: int = Query(30, ge=1, le=180),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Day-by-day free capacity for a listing — the warehouse / popup / hotel calendar.
    `from` / `to` take a date (`2026-10-01`) or a full ISO datetime; `to` is inclusive."""
    listing = await db.get(ToolListing, tool_id)
    if not listing:
        raise HTTPException(404, "Tool not found")
    if listing.category not in BOOKABLE_CATEGORIES:
        raise HTTPException(400, "This listing has no calendar — it is not a space, pitch or room")

    now = datetime.utcnow()
    start = _day(start) or datetime(now.year, now.month, now.day)
    end = _day(end) or (start + timedelta(days=days - 1))  # `to` is inclusive
    if end < start:
        raise HTTPException(400, "`to` must not be before `from`")

    out = await booking_service.calendar(db, listing, start, end, my_bookings_only=vendor.id)
    out["mine"] = [await _out(db, b, vendor) for b in
                   await booking_service.bookings_for(db, vendor, role="booker")
                   if b.tool_listing_id == listing.id]
    return out


@router.get("/bookings")
async def my_bookings(
    role: str = Query("all", pattern="^(host|booker|all)$"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Bookings you host and bookings you made, newest window first."""
    rows = await booking_service.bookings_for(db, vendor, role)
    return [await _out(db, b, vendor) for b in rows]


@router.get("/bookings/{booking_id}")
async def get_booking(
    booking_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    booking = _booking_or_404(await db.get(ToolBooking, booking_id))
    return await _out(db, booking, vendor)


@router.post("/bookings/{booking_id}/status")
async def set_booking_status(
    booking_id: UUID,
    status: str = Query(..., pattern="^(confirmed|declined|cancelled|completed)$"),
    note: Optional[str] = Query(None, max_length=500),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The host confirms/declines/completes; either side cancels. Everyone gets told."""
    booking = _booking_or_404(await db.get(ToolBooking, booking_id, with_for_update=True))
    listing = await db.get(ToolListing, booking.tool_listing_id)
    if not listing:
        raise HTTPException(410, "The listing behind this booking is gone")

    try:
        await booking_service.set_status(db, booking, status, vendor, note)
    except booking_service.BookingError as exc:
        raise HTTPException(exc.status_code, str(exc))

    counterpart = booking.booker_vendor_id if listing.vendor_id == vendor.id else listing.vendor_id
    verb = {"confirmed": "confirmed", "declined": "declined", "cancelled": "cancelled", "completed": "completed"}[status]
    await create_notification(
        db, counterpart, NotificationType.BOOKING_UPDATE,
        f"{listing.title}: booking {verb}",
        (note or f"@{vendor.vendor_handle} {verb} the {booking.start_date.date()} → {booking.end_date.date()} window"),
        sender_id=vendor.id,
        data={"booking_id": booking.id, "tool_id": listing.id, "status": status,
              "start_date": booking.start_date, "end_date": booking.end_date},
    )
    await db.commit()
    await db.refresh(booking)
    return {"message": f"Booking {verb}", "status": booking.status, "booking": await _out(db, booking, vendor)}

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.events import Event, EventRegistration
from app.models.groups import GroupMembership
from app.models.vendor import Vendor
from app.models.vendor_list import VendorList, VendorListMembership
from app.models.notification import NotificationType
from app.routes.auth import get_current_vendor
from app.services import patron_service
from app.services.notification_service import create_notification, notify_many

router = APIRouter()

EVENT_TYPES = {"networking", "trade_show", "sourcing_trip", "popup_market", "workshop", "market_day", "trade_fair", "auction"}


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

    @model_validator(mode="after")
    def _dates(self):
        # Browsers send tz-aware ISO strings ("...Z"); the columns are naive UTC.
        self.start_date = _naive_utc(self.start_date)
        self.end_date = _naive_utc(self.end_date)
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        if self.event_type not in EVENT_TYPES:
            raise ValueError(f"event_type must be one of {sorted(EVENT_TYPES)}")
        return self


def _naive_utc(dt: datetime) -> datetime:
    """Normalise any datetime to naive UTC so it fits TIMESTAMP WITHOUT TIME ZONE."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _event_out(e: Event, organizer: Vendor, my_status: Optional[str] = None) -> dict:
    return {
        "id": str(e.id),
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
        "virtual_link": e.virtual_link if my_status else None,  # link is for registered vendors
        "max_vendors": e.max_vendors,
        "registered_count": e.registered_count,
        "entry_fee": e.entry_fee,
        "spots_left": max(0, e.max_vendors - e.registered_count),
        "vendor_requirements": e.vendor_requirements or {},
        "vendor_list_id": str(e.vendor_list_id) if e.vendor_list_id else None,
        "group_id": str(e.group_id) if e.group_id else None,
        "status": e.status,
        "my_status": my_status,
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
            raise HTTPException(404, "Vendor list not found")
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
        **data.model_dump(exclude={"vendor_list_id", "group_id"}),
    )
    db.add(event)
    await db.commit()
    return {"message": f"Event '{event.title}' created", "event_id": str(event.id)}


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
        .where(Event.status.in_(["upcoming", "active"]))
    )
    if not include_past:
        query = query.where(Event.end_date >= datetime.utcnow())
    if event_type:
        query = query.where(Event.event_type == event_type)
    if location:
        query = query.where(Event.location.ilike(f"%{location}%"))
    query = query.order_by(Event.start_date.asc()).offset(skip).limit(limit)
    rows = (await db.execute(query)).all()

    mine = dict((await db.execute(
        select(EventRegistration.event_id, EventRegistration.status).where(EventRegistration.vendor_id == vendor.id)
    )).all())
    return [_event_out(e, v, mine.get(e.id)) for e, v in rows]


@router.get("/mine")
async def my_events(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Events you organise and events you registered for."""
    mine = dict((await db.execute(
        select(EventRegistration.event_id, EventRegistration.status).where(EventRegistration.vendor_id == vendor.id)
    )).all())
    query = (
        select(Event, Vendor).join(Vendor, Event.organizer_id == Vendor.id)
        .where((Event.organizer_id == vendor.id) | (Event.id.in_(list(mine)) if mine else False))
        .order_by(Event.start_date.asc())
    )
    rows = (await db.execute(query)).all()
    return [_event_out(e, v, mine.get(e.id)) for e, v in rows]


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
    reg = (await db.execute(select(EventRegistration.status).where(
        EventRegistration.event_id == event_id, EventRegistration.vendor_id == vendor.id,
    ))).scalar_one_or_none()
    return _event_out(e, v, reg)


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
        "status": r.status, "booth_assignment": r.booth_assignment, "registered_at": r.registered_at.isoformat(),
        "checked_in_at": r.checked_in_at.isoformat() if r.checked_in_at else None,
    } for r, v in rows]


@router.post("/{event_id}/register")
async def register_for_event(
    event_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    event = await db.get(Event, event_id, with_for_update=True)
    if not event:
        raise HTTPException(404, "Event not found")
    if event.status not in ("upcoming", "active"):
        raise HTTPException(400, f"Event is {event.status}")
    if event.registered_count >= event.max_vendors:
        raise HTTPException(400, "Event is full")

    existing = (await db.execute(select(EventRegistration).where(
        EventRegistration.event_id == event_id, EventRegistration.vendor_id == vendor.id,
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Already registered")

    # Events scoped to a list or group are for their members.
    if event.vendor_list_id:
        ok = (await db.execute(select(VendorListMembership.id).where(
            VendorListMembership.vendor_list_id == event.vendor_list_id,
            VendorListMembership.vendor_id == vendor.id, VendorListMembership.status == "approved",
        ))).first()
        if not ok and event.organizer_id != vendor.id:
            raise HTTPException(403, "This event is for vendors on its list")
    if event.group_id:
        ok = (await db.execute(select(GroupMembership.id).where(
            GroupMembership.group_id == event.group_id, GroupMembership.vendor_id == vendor.id,
            GroupMembership.is_active.is_(True),
        ))).first()
        if not ok and event.organizer_id != vendor.id:
            raise HTTPException(403, "This event is for members of its group")

    req = event.vendor_requirements or {}
    wanted = [c.lower() for c in req.get("categories", [])]
    if wanted and not ({c.lower() for c in (vendor.business_categories or [])} & set(wanted)):
        raise HTTPException(400, f"This event is for vendors in: {', '.join(req['categories'])}")

    db.add(EventRegistration(event_id=event_id, vendor_id=vendor.id))
    event.registered_count += 1
    await create_notification(
        db, event.organizer_id, NotificationType.EVENT_REGISTRATION,
        f"@{vendor.vendor_handle} registered for {event.title}",
        f"{event.registered_count}/{event.max_vendors} vendors registered",
        sender_id=vendor.id, data={"event_id": event.id, "vendor_handle": vendor.vendor_handle},
    )
    await db.commit()
    return {"message": f"Registered for '{event.title}'"}


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
    await db.delete(reg)
    event.registered_count = max(0, event.registered_count - 1)
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
        raise HTTPException(404, "No registration for that vendor")
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
    categories: dict[str, int] = {}
    for r, v in rows:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        for c in v.business_categories or []:
            categories[c] = categories.get(c, 0) + 1
    attended = by_status.get("attended", 0)
    registered = len(rows)
    return {
        "event_id": str(event.id),
        "status": event.status,
        "registered": registered,
        "capacity": event.max_vendors,
        "fill_rate": round(100.0 * registered / event.max_vendors, 1) if event.max_vendors else 0,
        "attended": attended,
        "no_show": by_status.get("no_show", 0),
        "attendance_rate": round(100.0 * attended / registered, 1) if registered else 0,
        "by_status": by_status,
        "categories": sorted(({"category": k, "vendors": n} for k, n in categories.items()), key=lambda x: -x["vendors"]),
    }

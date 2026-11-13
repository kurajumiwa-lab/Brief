"""HTTP surface for the Brief calendar.

    GET    /api/schedule/week?start=YYYY-MM-DD        my week: plans, appointments, events, bookings
    POST   /api/schedule/entries                      add a plan, task, meeting or reminder
    PATCH  /api/schedule/entries/{id}                 edit or mark done / cancelled
    DELETE /api/schedule/entries/{id}                 remove one of my plans
    GET    /api/schedule/services                     my bookable services
    POST   /api/schedule/services                     add a service
    PATCH  /api/schedule/services/{id}                edit a service
    GET    /api/schedule/availability                 my weekly opening hours
    PUT    /api/schedule/availability                 replace my opening hours
    GET    /api/schedule/vendors/{vendor_id}/services a business's active services (signed-in view)
    GET    /api/schedule/vendors/{vendor_id}/slots    free start times for a service on a day
    POST   /api/schedule/appointments                 book a slot (host must confirm)
    GET    /api/schedule/appointments?role=host|client
    POST   /api/schedule/appointments/{id}/status     confirm, decline, complete, cancel …
"""

import uuid
from datetime import date, datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.schedule import service
from app.modules.schedule.domains import ServiceDomain, check_domain
from app.modules.offerings import service as offering_service
from app.modules.schedule.models import (
    APPOINTMENT_STATUSES, ENTRY_KINDS, ENTRY_STATUSES, AvailabilityRule, BookableService, ScheduleEntry,
)
from app.routes.auth import get_current_vendor

router = APIRouter()


# ---------- schemas -------------------------------------------------------------------

class EntryIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: Literal["plan", "task", "meeting", "reminder"] = "plan"
    starts_at: datetime
    ends_at: datetime
    location: Optional[str] = Field(default=None, max_length=300)
    notes: Optional[str] = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _times(self):
        if self.starts_at.tzinfo is not None:
            self.starts_at = self.starts_at.replace(tzinfo=None)
            self.ends_at = self.ends_at.replace(tzinfo=None)
        return self


class EntryPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    kind: Optional[Literal["plan", "task", "meeting", "reminder"]] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    location: Optional[str] = Field(default=None, max_length=300)
    notes: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[Literal["planned", "done", "cancelled"]] = None


DELIVERY_FIELDS = ("delivery_clinic", "delivery_home", "delivery_remote")


def _unit(value: Optional[str]) -> Optional[str]:
    """Blank means not stated. Stored trimmed, at most 30 characters."""
    if value is None:
        return None
    return value.strip() or None


class ServiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    duration_minutes: int = Field(default=30, ge=5, le=480)
    buffer_minutes: int = Field(default=0, ge=0, le=120)
    price_kes: Optional[int] = Field(default=None, ge=0)
    is_active: bool = True
    # Delivery modes default to clinic only, which is the decision for existing services (D1).
    delivery_clinic: bool = True
    delivery_home: bool = False
    delivery_remote: bool = False
    price_unit: Optional[str] = Field(default=None, max_length=30)
    domain: Optional[ServiceDomain] = None  # Phase 6, optional

    @model_validator(mode="after")
    def _some_mode(self):
        if not (self.delivery_clinic or self.delivery_home or self.delivery_remote):
            raise ValueError("Choose at least one way to give this service.")
        return self


class ServicePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=480)
    buffer_minutes: Optional[int] = Field(default=None, ge=0, le=120)
    price_kes: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None
    delivery_clinic: Optional[bool] = None
    delivery_home: Optional[bool] = None
    delivery_remote: Optional[bool] = None
    price_unit: Optional[str] = Field(default=None, max_length=30)
    domain: Optional[ServiceDomain] = None  # Phase 6; send null to clear

    @field_validator(*DELIVERY_FIELDS)
    @classmethod
    def _not_null(cls, value):
        # Sent as null, the column (NOT NULL) would refuse the write; say so plainly instead.
        if value is None:
            raise ValueError("Say true or false for each way of giving this service.")
        return value


class WindowIn(BaseModel):
    weekday: int = Field(ge=0, le=6)  # 0 = Monday
    start_minute: int = Field(ge=0, le=1439)
    end_minute: int = Field(ge=1, le=1440)

    @model_validator(mode="after")
    def _order(self):
        if self.end_minute <= self.start_minute:
            raise ValueError("end_minute must be after start_minute")
        return self


class BookIn(BaseModel):
    host_vendor_id: uuid.UUID
    service_id: uuid.UUID
    starts_at: datetime
    client_name: str = Field(min_length=1, max_length=200)
    client_phone: Optional[str] = Field(default=None, max_length=40)
    notes: Optional[str] = Field(default=None, max_length=1000)


class StatusIn(BaseModel):
    status: Literal["confirmed", "declined", "completed", "no_show", "cancelled"]


def _entry_out(e: ScheduleEntry) -> dict:
    return {"id": str(e.id), "title": e.title, "kind": e.kind, "status": e.status,
            "starts_at": service._iso(e.starts_at), "ends_at": service._iso(e.ends_at),
            "location": e.location, "notes": e.notes}


def _service_out(s: BookableService) -> dict:
    return {"id": str(s.id), "name": s.name, "description": s.description,
            "duration_minutes": s.duration_minutes, "buffer_minutes": s.buffer_minutes,
            "price_kes": s.price_kes, "is_active": s.is_active,
            "delivery_clinic": bool(s.delivery_clinic), "delivery_home": bool(s.delivery_home),
            "delivery_remote": bool(s.delivery_remote), "price_unit": s.price_unit,
            "domain": s.domain}


def _rule_out(r: AvailabilityRule) -> dict:
    return {"weekday": r.weekday, "start_minute": r.start_minute, "end_minute": r.end_minute}


# ---------- my week and plans ---------------------------------------------------------

@router.get("/week")
async def my_week(start: Optional[date] = Query(default=None),
                  vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    day = service.monday_of(start or service.nairobi_now().date())
    return await service.week_view(db, vendor.id, day)


@router.post("/entries", status_code=201)
async def add_entry(data: EntryIn, vendor: Vendor = Depends(get_current_vendor),
                    db: AsyncSession = Depends(get_db)):
    service.check_entry_times(data.starts_at, data.ends_at)
    entry = ScheduleEntry(vendor_id=vendor.id, **data.model_dump())
    db.add(entry)
    await db.commit()
    return _entry_out(entry)


@router.patch("/entries/{entry_id}")
async def edit_entry(entry_id: uuid.UUID, data: EntryPatch, vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    entry = await service.get_entry(db, vendor.id, entry_id)
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(entry, field, value)
    service.check_entry_times(entry.starts_at, entry.ends_at)
    await db.commit()
    return _entry_out(entry)


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    entry = await service.get_entry(db, vendor.id, entry_id)
    await db.delete(entry)
    await db.commit()


# ---------- my services and hours -----------------------------------------------------

@router.get("/services")
async def my_services(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(BookableService).where(BookableService.vendor_id == vendor.id)
                             .order_by(BookableService.created_at))).scalars().all()
    return {"services": [_service_out(s) for s in rows]}


@router.post("/services", status_code=201)
async def add_service(data: ServiceIn, vendor: Vendor = Depends(get_current_vendor),
                      db: AsyncSession = Depends(get_db)):
    fields = data.model_dump()
    fields["price_unit"] = _unit(fields["price_unit"])
    fields["domain"] = check_domain(fields["domain"])
    svc = BookableService(vendor_id=vendor.id, **fields)
    db.add(svc)
    await db.flush()
    await offering_service.sync_legacy_modes(db, svc)
    await db.commit()
    return _service_out(svc)


@router.patch("/services/{service_id}")
async def edit_service(service_id: uuid.UUID, data: ServicePatch, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    svc = await service.get_service(db, vendor.id, service_id)
    changes = data.model_dump(exclude_unset=True)
    # Check the delivery modes as they will be after this patch, before anything is written.
    after = {f: changes.get(f, getattr(svc, f)) for f in DELIVERY_FIELDS}
    if not any(after.values()):
        raise HTTPException(422, "Choose at least one way to give this service.")
    if "price_unit" in changes:
        changes["price_unit"] = _unit(changes["price_unit"])
    if "domain" in changes:
        changes["domain"] = check_domain(changes["domain"])
    old_kes, old_unit = svc.price_kes, svc.price_unit
    for field, value in changes.items():
        setattr(svc, field, value)
    await db.flush()
    await offering_service.sync_legacy_modes(db, svc, old_kes=old_kes, old_unit=old_unit)
    await db.commit()
    return _service_out(svc)


@router.get("/availability")
async def my_availability(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(AvailabilityRule).where(AvailabilityRule.vendor_id == vendor.id)
                             .order_by(AvailabilityRule.weekday, AvailabilityRule.start_minute))).scalars().all()
    return {"windows": [_rule_out(r) for r in rows]}


@router.put("/availability")
async def set_availability(windows: list[WindowIn], vendor: Vendor = Depends(get_current_vendor),
                           db: AsyncSession = Depends(get_db)):
    rows = await service.replace_rules(db, vendor.id, [w.model_dump() for w in windows])
    await db.commit()
    return {"windows": [_rule_out(r) for r in sorted(rows, key=lambda r: (r.weekday, r.start_minute))]}


# ---------- booking ----------------------------------------------------------------------

@router.get("/vendors/{vendor_id}/services")
async def vendor_services(vendor_id: uuid.UUID, _: Vendor = Depends(get_current_vendor),
                          db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(BookableService).where(
        BookableService.vendor_id == vendor_id, BookableService.is_active.is_(True))
        .order_by(BookableService.created_at))).scalars().all()
    return {"services": [_service_out(s) for s in rows]}


@router.get("/vendors/{vendor_id}/slots")
async def vendor_slots(vendor_id: uuid.UUID, service_id: uuid.UUID, day: date,
                       _: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    svc = (await db.execute(select(BookableService).where(
        BookableService.id == service_id, BookableService.vendor_id == vendor_id,
        BookableService.is_active.is_(True)))).scalar_one_or_none()
    if svc is None:
        raise HTTPException(status_code=404, detail="Service not found.")
    slots = await service.free_slots(db, vendor_id, svc, day)
    return {"day": day.isoformat(), "duration_minutes": svc.duration_minutes,
            "slots": [service._iso(s) for s in slots]}


@router.post("/appointments", status_code=201)
async def book_appointment(data: BookIn, vendor: Vendor = Depends(get_current_vendor),
                           db: AsyncSession = Depends(get_db)):
    appt = await service.book(db, vendor.id, data.host_vendor_id, data.service_id,
                              data.starts_at.replace(tzinfo=None),
                              data.client_name, data.client_phone, data.notes)
    svc = await service.get_service(db, data.host_vendor_id, data.service_id)
    await db.commit()
    return service.appointment_out(appt, svc.name, "client")


@router.get("/appointments")
async def my_appointments(role: Literal["host", "client"] = Query(default="host"),
                          vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = await service.list_appointments(db, vendor.id, role)
    return {"appointments": [service.appointment_out(a, name, role) for a, name in rows]}


@router.post("/appointments/{appointment_id}/status")
async def appointment_status(appointment_id: uuid.UUID, data: StatusIn,
                             vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    appt = await service.set_status(db, vendor.id, appointment_id, data.status)
    svc = await service.get_service(db, appt.vendor_id, appt.service_id)
    await db.commit()
    role = "host" if appt.vendor_id == vendor.id else "client"
    return service.appointment_out(appt, svc.name, role)

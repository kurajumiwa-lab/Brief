"""Professional profile card: services, hours, delivery, registration status, completed work.

Every value comes from an existing row. Nothing is filled in as an example. The completed
count comes only from appointments with status 'completed', and is None (not 0) when there are
none, so the UI shows nothing rather than a made-up number.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.credentials import service as credentials
from app.modules.schedule.models import Appointment, AvailabilityRule, BookableService

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _delivery(s: BookableService) -> list:
    modes = []
    if s.delivery_clinic:
        modes.append("clinic")
    if s.delivery_home:
        modes.append("home")
    if s.delivery_remote:
        modes.append("remote")
    return modes


async def card_for_vendor(db: AsyncSession, vendor_id: uuid.UUID) -> dict:
    services = (await db.execute(
        select(BookableService).where(
            BookableService.vendor_id == vendor_id,
            BookableService.is_active.is_(True),
            BookableService.archived_at.is_(None),
        ).order_by(BookableService.name)
    )).scalars().all()

    rules = (await db.execute(
        select(AvailabilityRule).where(AvailabilityRule.vendor_id == vendor_id)
        .order_by(AvailabilityRule.weekday, AvailabilityRule.start_minute)
    )).scalars().all()
    hours: dict = {}
    for r in rules:
        hours.setdefault(WEEKDAYS[r.weekday], []).append(f"{_hhmm(r.start_minute)}–{_hhmm(r.end_minute)}")
    hours_out = [{"day": d, "windows": hours[d]} for d in WEEKDAYS if d in hours]

    completed = (await db.execute(
        select(func.count()).select_from(Appointment).where(
            Appointment.vendor_id == vendor_id, Appointment.status == "completed",
        )
    )).scalar_one()

    creds = await credentials.public_for_handle_vendor(db, vendor_id)

    return {
        "services": [
            {
                "id": str(s.id),
                "name": s.name,
                "duration_minutes": s.duration_minutes,
                "price_kes": s.price_kes,
                "price_mode": s.price_mode,
                "price_unit": s.price_unit,
                "delivery": _delivery(s),
            }
            for s in services
        ],
        "hours": hours_out,
        "registrations": creds,
        "completed_appointments": int(completed) if completed > 0 else None,
    }

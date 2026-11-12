"""Professional profile card: services, hours, delivery, registration status, completed work.

Every value comes from an existing row. Nothing is filled in as an example. The completed
count comes only from appointments with status 'completed'. Zero is returned as zero, and the
screen says there are no completed bookings yet.
"""

import uuid

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.vendor import Vendor
from app.modules.credentials import service as credentials
from app.modules.ratings.models import PostTradeRating
from app.modules.schedule.domains import SERVICE_DOMAIN_LABELS
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
    vendor = await db.get(Vendor, vendor_id)
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

    completed_q = select(func.count()).select_from(Appointment).where(
        Appointment.vendor_id == vendor_id, Appointment.status == "completed",
    )
    # Phase 7, PR 102. With the rating gate on, a completed booking counts only once it is final
    # (its post-trade rating is recorded). Off by default: the count is unchanged.
    if settings.POST_TRADE_RATING_GATE_ENABLED:
        completed_q = completed_q.where(exists().where(
            PostTradeRating.subject_kind == "appointment",
            PostTradeRating.subject_id == Appointment.id,
        ))
    completed = (await db.execute(completed_q)).scalar_one()

    creds = await credentials.public_for_handle_vendor(db, vendor_id)

    return {
        "handle": vendor.vendor_handle if vendor else None,
        # Area as the public profile already shows it (VendorOut.physical_location).
        "location": vendor.physical_location if vendor else None,
        "services": [
            {
                "id": str(s.id),
                "name": s.name,
                "duration_minutes": s.duration_minutes,
                "price_kes": s.price_kes,
                "price_mode": s.price_mode,
                "price_unit": s.price_unit,
                "delivery": _delivery(s),
                "domain": s.domain,
                "domain_label": SERVICE_DOMAIN_LABELS.get(s.domain) if s.domain else None,
            }
            for s in services
        ],
        "hours": hours_out,
        "registrations": creds,
        "completed_appointments": int(completed),
    }

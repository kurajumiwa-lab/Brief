"""Daily routine: which checks exist, what each one counts, and today's dots.

Rules the user can rely on:
- A check appears only if it is switched on. The defaults are on for the three
  checks almost every trader needs. Everything else starts off.
- A dot shows only when a check is on, not yet done today, and has something
  waiting. Nothing else is counted as urgent.
- Every check says why it is there, in plain words.
- Nothing runs in the background. Counts are read when the Today window opens.
"""

import uuid
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockItem
from app.modules.blueprints import service as blueprint_service
from app.modules.knowledge.models import KnowledgeListing, KnowledgeRegistration
from app.modules.offers import service as offers_service
from app.modules.routine.models import RoutineCompletion, RoutinePreference
from app.modules.schedule.models import Appointment, ScheduleEntry
from app.modules.schedule.service import nairobi_now

CHECKS = [
    {"key": "appointments", "label": "Booking requests", "link": "/calendar", "default_on": True,
     "why": "Clients who asked for a time are waiting for you to confirm or decline it."},
    {"key": "today_plans", "label": "Today's plans", "link": "/calendar", "default_on": True,
     "why": "Look at what you planned for today, and mark what is done."},
    {"key": "stock_out", "label": "Sold-out stock", "link": "/stock", "default_on": True,
     "why": "Items with nothing left stop showing to other businesses. Restock them, or leave them hidden."},
    {"key": "offers", "label": "Offers not yet confirmed", "link": "/stock", "default_on": False,
     "why": "Your shared items that have no completed deal with another business yet. A first deal confirms them."},
    {"key": "sessions", "label": "Sessions coming up", "link": "/learn", "default_on": False,
     "why": "Seminars, courses or mentor sessions you signed up for in the next three days."},
]
CHECK_BY_KEY = {c["key"]: c for c in CHECKS}


def _bad(message: str, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=message)


async def _count(db: AsyncSession, vendor_id: uuid.UUID, key: str, now: datetime) -> int:
    if key == "appointments":
        return (await db.execute(select(func.count()).select_from(Appointment).where(
            Appointment.vendor_id == vendor_id, Appointment.status == "requested"))).scalar_one()
    if key == "today_plans":
        start = datetime.combine(now.date(), datetime.min.time())
        end = start + timedelta(days=1)
        return (await db.execute(select(func.count()).select_from(ScheduleEntry).where(
            ScheduleEntry.vendor_id == vendor_id, ScheduleEntry.status == "planned",
            ScheduleEntry.starts_at >= start, ScheduleEntry.starts_at < end))).scalar_one()
    if key == "stock_out":
        return (await db.execute(select(func.count()).select_from(StockItem).where(
            StockItem.vendor_id == vendor_id, StockItem.quantity_available <= 0))).scalar_one()
    if key == "offers":
        items = await offers_service.status_for_my_items(db, vendor_id)
        return sum(1 for i in items if i["status"] == offers_service.LISTED)
    if key == "sessions":
        horizon = now + timedelta(days=3)
        return (await db.execute(select(func.count()).select_from(KnowledgeRegistration)
                                 .join(KnowledgeListing, KnowledgeListing.id == KnowledgeRegistration.listing_id)
                                 .where(KnowledgeRegistration.vendor_id == vendor_id,
                                        KnowledgeListing.status == "published",
                                        KnowledgeListing.starts_at >= now,
                                        KnowledgeListing.starts_at <= horizon,
                                        KnowledgeRegistration.checked_in_at.is_(None)))).scalar_one()
    return 0


async def enabled_map(db: AsyncSession, vendor_id: uuid.UUID) -> dict[str, bool]:
    rows = (await db.execute(select(RoutinePreference).where(
        RoutinePreference.vendor_id == vendor_id))).scalars().all()
    chosen = {r.check_key: r.enabled for r in rows}
    return {c["key"]: chosen.get(c["key"], c["default_on"]) for c in CHECKS}


async def catalogue(db: AsyncSession, vendor_id: uuid.UUID) -> list[dict]:
    on = await enabled_map(db, vendor_id)
    return [{"key": c["key"], "label": c["label"], "why": c["why"], "enabled": on[c["key"]]} for c in CHECKS]


async def set_preferences(db: AsyncSession, vendor_id: uuid.UUID, checks: dict[str, bool]) -> None:
    unknown = [k for k in checks if k not in CHECK_BY_KEY]
    if unknown:
        raise _bad(f"Unknown check: {unknown[0]}", 422)
    rows = {r.check_key: r for r in (await db.execute(select(RoutinePreference).where(
        RoutinePreference.vendor_id == vendor_id))).scalars().all()}
    for key, enabled in checks.items():
        row = rows.get(key)
        if row is None:
            db.add(RoutinePreference(vendor_id=vendor_id, check_key=key, enabled=bool(enabled)))
        else:
            row.enabled = bool(enabled)
            row.updated_at = datetime.utcnow()
    await db.flush()


async def _done_today(db: AsyncSession, vendor_id: uuid.UUID, today: date) -> set[str]:
    return set((await db.execute(select(RoutineCompletion.check_key).where(
        RoutineCompletion.vendor_id == vendor_id, RoutineCompletion.day == today))).scalars().all())


async def mark(db: AsyncSession, vendor_id: uuid.UUID, key: str, done: bool) -> None:
    if key not in CHECK_BY_KEY:
        raise _bad("Unknown check.", 404)
    today = nairobi_now().date()
    row = (await db.execute(select(RoutineCompletion).where(
        RoutineCompletion.vendor_id == vendor_id, RoutineCompletion.check_key == key,
        RoutineCompletion.day == today))).scalar_one_or_none()
    if done and row is None:
        db.add(RoutineCompletion(vendor_id=vendor_id, check_key=key, day=today))
    elif not done and row is not None:
        await db.delete(row)
    await db.flush()


async def today(db: AsyncSession, vendor_id: uuid.UUID) -> dict:
    now = nairobi_now().replace(tzinfo=None)
    on = await enabled_map(db, vendor_id)
    done = await _done_today(db, vendor_id, now.date())
    items = []
    for c in CHECKS:
        if not on[c["key"]]:
            continue
        count = await _count(db, vendor_id, c["key"], now)
        is_done = c["key"] in done
        items.append({"key": c["key"], "label": c["label"], "why": c["why"], "link": c["link"],
                      "count": count, "done": is_done, "dot": (not is_done) and count > 0,
                      "kind": "check"})
    for step in await blueprint_service.next_steps(db, vendor_id):
        items.append({"key": step["key"], "label": step["label"], "why": step["why"], "link": step["link"],
                      "count": 1, "done": False, "dot": True, "kind": "template"})
    return {"date": now.date().isoformat(), "items": items,
            "dots": sum(1 for i in items if i["dot"])}

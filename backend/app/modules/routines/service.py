"""Recurring routine rules and the hourly publishing sweep.

A routine is inert until its lead window opens. The sweep then publishes a
normal `local_activities` row, so discovery, 0064 expiry and public sharing
keep working with no special case. The work is idempotent three ways:

  1. the routine row is locked `FOR UPDATE` while it is generated;
  2. `last_generated_for_date` is updated in the same transaction;
  3. `recurring_routine_instances` has a UNIQUE (routine_id, occurrence_date).

Automatic publishing never invents a new price, capacity or meeting point: the
instance is a copy of the owner's template.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.ledger.models import LocalActivity
from app.modules.routines.models import (
    DAY_NAMES, KINDS, RecurringRoutine, RecurringRoutineInstance, weekly_label,
)
from app.services.notification_service import create_notification

NAIROBI = ZoneInfo("Africa/Nairobi")

INFERRED_TEMPLATES = (
    "repair_artisan", "agricultural_produce_fodder", "tool_lending", "collection_point",
    "travelling_round", "community_learning", "supervised_youth_task", "group_sourcing",
    "general",
)
POSTING_TYPE_FOR_KIND = {"scheduled": "scheduled", "event": "scheduled", "offer": "available"}
PAYMENT_METHODS = ("SEND_MONEY", "POCHI", "TILL", "PAYBILL")


class RoutineError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _python_weekday(spec_day: int) -> int:
    """Spec 0=Sun..6=Sat → Python Monday=0..Sunday=6."""
    return (int(spec_day) + 6) % 7


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def next_occurrence(now: datetime, day_of_week: int, start_time: time) -> datetime:
    """The next weekly slot, as an aware EAT datetime."""
    local_now = _aware(now).astimezone(NAIROBI)
    delta = (_python_weekday(day_of_week) - local_now.weekday()) % 7
    day = local_now.date() + timedelta(days=delta)
    moment = datetime.combine(day, start_time, tzinfo=NAIROBI)
    if moment <= local_now:
        moment += timedelta(days=7)
    return moment


def validate_routine(*, kind: str, title: str, region_slug: str, town: str,
                     day_of_week: int, start_time_local, duration_hours: int,
                     publish_lead_hours: int, template_payload) -> dict:
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        raise RoutineError("Choose scheduled, event or offer.", 422)
    title = " ".join((title or "").split())
    if not 4 <= len(title) <= 140:
        raise RoutineError("Give the routine a title of 4 to 140 characters.", 422)
    if not re.fullmatch(r"[a-z0-9-]{2,64}", (region_slug or "").strip()):
        raise RoutineError("Choose the region this routine runs in.", 422)
    town = " ".join((town or "").split())
    if not 2 <= len(town) <= 64:
        raise RoutineError("Enter the town or estate.", 422)
    if not 0 <= int(day_of_week) <= 6:
        raise RoutineError("Choose a day of the week.", 422)
    if isinstance(start_time_local, str):
        try:
            start_time_local = time.fromisoformat(start_time_local)
        except ValueError:
            raise RoutineError("Start time must look like 09:30.", 422)
    if not isinstance(start_time_local, time):
        raise RoutineError("Choose a start time.", 422)
    if not 1 <= int(duration_hours) <= 72:
        raise RoutineError("A round lasts between 1 and 72 hours.", 422)
    if not 0 <= int(publish_lead_hours) <= 336:
        raise RoutineError("Publish lead time must be 0 to 336 hours.", 422)
    if not isinstance(template_payload, dict):
        raise RoutineError("The template must be an object.", 422)

    payload = {k: v for k, v in template_payload.items()}
    template = str(payload.get("inferred_template") or "general")
    if template not in INFERRED_TEMPLATES:
        raise RoutineError("That activity template is not recognised.", 422)
    payload["inferred_template"] = template
    body = str(payload.get("body") or "").strip()
    if len(body) > 4000:
        raise RoutineError("The description is too long (4000 characters max).", 422)
    price = payload.get("price_kes")
    if price not in (None, ""):
        try:
            price = Decimal(str(price))
        except Exception:
            raise RoutineError("Price must be a number.", 422)
        if price < 0 or price > 10_000_000:
            raise RoutineError("Price is out of range.", 422)
        payload["price_kes"] = int(price)
    else:
        payload.pop("price_kes", None)
    capacity = payload.get("capacity")
    if capacity not in (None, ""):
        try:
            capacity = int(capacity)
        except Exception:
            raise RoutineError("Capacity must be a whole number.", 422)
        if not 1 <= capacity <= 10000:
            raise RoutineError("Capacity must be between 1 and 10,000.", 422)
        payload["capacity"] = capacity
    else:
        payload.pop("capacity", None)
    tag = payload.get("payment_tag")
    if tag:
        if not isinstance(tag, dict) or str(tag.get("method", "")).upper() not in PAYMENT_METHODS:
            raise RoutineError("Payment tag must have a method and number.", 422)
        number = re.sub(r"[\s-]", "", str(tag.get("number") or ""))
        if not re.fullmatch(r"(?:254|0)?[17]\d{8}|\d{5,9}", number):
            raise RoutineError("Enter a valid payment number.", 422)
        payload["payment_tag"] = {
            "method": str(tag["method"]).upper(), "number": number,
            "account": str(tag.get("account") or "")[:64] or None,
            "name": " ".join(str(tag.get("name") or "").split())[:120] or None,
        }
    else:
        payload.pop("payment_tag", None)
    inclusions = payload.get("inclusions")
    if inclusions is not None:
        if not isinstance(inclusions, list):
            raise RoutineError("Inclusions must be a list.", 422)
        payload["inclusions"] = [str(item)[:80] for item in inclusions[:12] if str(item).strip()]
    payload["body"] = body
    return {
        "kind": kind, "title": title, "region_slug": region_slug.strip().lower(),
        "town": town, "day_of_week": int(day_of_week),
        "start_time_local": start_time_local, "duration_hours": int(duration_hours),
        "publish_lead_hours": int(publish_lead_hours), "template_payload": payload,
    }


def _body_for(routine: RecurringRoutine) -> str:
    payload = routine.template_payload or {}
    body = str(payload.get("body") or "").strip()
    if len(body) >= 8:
        return body
    label = weekly_label(routine.day_of_week)
    bits = [f"{label} · {routine.town}.", f"Ask in chat for this week's details."]
    return " ".join(bits)


def _activity_for(routine: RecurringRoutine, occurrence: datetime) -> LocalActivity:
    payload = routine.template_payload or {}
    label = weekly_label(routine.day_of_week)
    starts_local = occurrence.astimezone(NAIROBI)
    starts_utc = starts_local.astimezone(timezone.utc).replace(tzinfo=None)
    expires_utc = (starts_local + timedelta(hours=int(routine.duration_hours))).astimezone(
        timezone.utc).replace(tzinfo=None)
    template_fields = {
        "meeting_point": str(payload.get("meeting_point") or "")[:200] or None,
        "inclusions": list(payload.get("inclusions") or []),
        "routine_id": str(routine.id),
        "week_of": starts_local.date().isoformat(),
    }
    return LocalActivity(
        organizer_vendor_id=routine.owner_user_id,
        posting_type=POSTING_TYPE_FOR_KIND.get(routine.kind, "scheduled"),
        inferred_template=payload.get("inferred_template") or "general",
        category=str(payload.get("category") or "")[:100] or None,
        title=routine.title,
        body=_body_for(routine),
        media=list(payload.get("media") or [])[:6],
        tags=[str(tag)[:40] for tag in list(payload.get("tags") or [])[:10]],
        area_name=routine.town,
        location_scope="town",
        geo_precision="approximate",
        starts_at=starts_utc,
        ends_at=expires_utc,
        expires_at=expires_utc,
        schedule_label=label,
        capacity=payload.get("capacity"),
        spots_confirmed=0,
        visibility="public",
        permission_rules={"recurring": True, "routine_id": str(routine.id)},
        template_fields=template_fields,
        price_kes=payload.get("price_kes"),
        price_basis="fixed" if payload.get("price_kes") is not None else "quote_requested",
        lifecycle_status="published",
        recurring_routine_id=routine.id,
        recurrence_label=label,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )


async def _generate_locked(db: AsyncSession, routine: RecurringRoutine, now: datetime,
                           *, force: bool = False) -> Optional[dict]:
    occurrence = next_occurrence(now, routine.day_of_week, routine.start_time_local)
    occurrence_date = occurrence.date()
    existing = (await db.execute(
        select(RecurringRoutineInstance).where(
            RecurringRoutineInstance.routine_id == routine.id,
            RecurringRoutineInstance.occurrence_date == occurrence_date,
        )
    )).scalar_one_or_none()
    if existing is not None:
        return None
    trigger_at = occurrence - timedelta(hours=int(routine.publish_lead_hours))
    if not force and trigger_at > _aware(now):
        return None
    # Never publish a round that has already finished.
    if occurrence + timedelta(hours=int(routine.duration_hours)) <= _aware(now):
        return None

    activity = _activity_for(routine, occurrence)
    db.add(activity)
    await db.flush()
    # `ON CONFLICT DO NOTHING` rather than catching an IntegrityError: a
    # rollback here would discard every other routine already published in this
    # sweep. The routine row is locked, so a conflict means another process won
    # the race — keep its instance and drop the copy we just made.
    inserted = await db.execute(
        pg_insert(RecurringRoutineInstance)
        .values(routine_id=routine.id, occurrence_date=occurrence_date,
                activity_id=activity.id, created_at=now_utc())
        .on_conflict_do_nothing(index_elements=["routine_id", "occurrence_date"])
        .returning(RecurringRoutineInstance.id)
    )
    if inserted.scalar_one_or_none() is None:
        await db.delete(activity)
        await db.flush()
        return None

    routine.last_generated_for_date = occurrence_date
    routine.last_generated_activity_id = activity.id
    routine.updated_at = now_utc()
    await create_notification(
        db, routine.owner_user_id, NotificationType.SYSTEM,
        "This week's round is live",
        f"“{routine.title}” published for {occurrence_date:%a %d %b}. "
        "Share this week's round to WhatsApp from your Inbox — one tap.",
        data={"routine_id": str(routine.id), "activity_id": str(activity.id),
              "kind": routine.kind},
    )
    return {
        "routine_id": str(routine.id),
        "occurrence_date": occurrence_date.isoformat(),
        "activity_id": str(activity.id),
        "starts_at": occurrence.isoformat(),
        "label": weekly_label(routine.day_of_week),
    }


async def sweep_due(db: AsyncSession, now: Optional[datetime] = None) -> list[dict]:
    """The hourly sweep. Safe to run on every process at once."""
    now = now or now_utc()
    generated: list[dict] = []
    routines = (await db.execute(
        select(RecurringRoutine).where(RecurringRoutine.is_active.is_(True))
        .with_for_update(skip_locked=True)
    )).scalars().all()
    for routine in routines:
        result = await _generate_locked(db, routine, now)
        if result:
            generated.append(result)
    await db.flush()
    return generated


async def publish_now(db: AsyncSession, vendor: Vendor, routine_id: uuid.UUID) -> dict:
    routine = (await db.execute(
        select(RecurringRoutine).where(RecurringRoutine.id == routine_id).with_for_update()
    )).scalar_one_or_none()
    if routine is None or routine.owner_user_id != vendor.id:
        raise RoutineError("That routine was not found.", 404)
    result = await _generate_locked(db, routine, now_utc(), force=True)
    if result is None:
        raise RoutineError("This week's round is already published.", 409)
    return result


def routine_out(routine: RecurringRoutine, generated=None) -> dict:
    payload = routine.template_payload or {}
    return {
        "id": str(routine.id),
        "kind": routine.kind,
        "title": routine.title,
        "region_slug": routine.region_slug,
        "town": routine.town,
        "day_of_week": int(routine.day_of_week),
        "day_label": DAY_NAMES[int(routine.day_of_week)],
        "recurrence_label": weekly_label(routine.day_of_week),
        "start_time_local": routine.start_time_local.strftime("%H:%M"),
        "duration_hours": int(routine.duration_hours),
        "publish_lead_hours": int(routine.publish_lead_hours),
        "is_active": bool(routine.is_active),
        "last_generated_for_date": (routine.last_generated_for_date.isoformat()
                                    if routine.last_generated_for_date else None),
        "last_generated_activity_id": (str(routine.last_generated_activity_id)
                                       if routine.last_generated_activity_id else None),
        "template": {
            "body": payload.get("body") or "",
            "price_kes": payload.get("price_kes"),
            "capacity": payload.get("capacity"),
            "meeting_point": payload.get("meeting_point"),
            "inclusions": list(payload.get("inclusions") or []),
            "inferred_template": payload.get("inferred_template") or "general",
            "category": payload.get("category"),
            "tags": list(payload.get("tags") or []),
            "has_payment_tag": bool(payload.get("payment_tag")),
        },
        "generated": generated,
    }


async def mine(db: AsyncSession, vendor: Vendor) -> dict:
    routines = (await db.execute(
        select(RecurringRoutine).where(RecurringRoutine.owner_user_id == vendor.id)
        .order_by(RecurringRoutine.created_at.desc())
    )).scalars().all()
    instances = (await db.execute(
        select(RecurringRoutineInstance, LocalActivity)
        .join(LocalActivity, LocalActivity.id == RecurringRoutineInstance.activity_id)
        .where(RecurringRoutineInstance.routine_id.in_([r.id for r in routines] or [uuid.uuid4()]))
        .order_by(RecurringRoutineInstance.occurrence_date.desc()).limit(30)
    )).all() if routines else []
    sharing = []
    for instance, activity in instances:
        sharing.append({
            "instance_id": str(instance.id),
            "routine_id": str(instance.routine_id),
            "activity_id": str(activity.id),
            "occurrence_date": instance.occurrence_date.isoformat(),
            "title": activity.title,
            "starts_at": activity.starts_at.isoformat() if activity.starts_at else None,
            "share_path": f"/activities/{activity.id}",
            "shared_at": instance.whatsapp_shared_at.isoformat() if instance.whatsapp_shared_at else None,
            "share_text": (
                f"{activity.title} — {instance.occurrence_date:%a %d %b} in "
                f"{activity.area_name or ''}. This week's round is live; message me to book."
            ).strip(),
        })
    return {"routines": [routine_out(r) for r in routines], "share_prompts": sharing}


async def mark_shared(db: AsyncSession, vendor: Vendor, instance_id: uuid.UUID) -> dict:
    instance = (await db.execute(
        select(RecurringRoutineInstance, RecurringRoutine)
        .join(RecurringRoutine, RecurringRoutine.id == RecurringRoutineInstance.routine_id)
        .where(RecurringRoutineInstance.id == instance_id)
    )).first()
    if instance is None or instance[1].owner_user_id != vendor.id:
        raise RoutineError("That published round was not found.", 404)
    row, routine = instance
    if row.whatsapp_shared_at is None:
        row.whatsapp_shared_at = now_utc()
        routine.updated_at = now_utc()
        await db.flush()
    return {"instance_id": str(row.id), "shared_at": row.whatsapp_shared_at.isoformat()}


def public_routines(routines: list[RecurringRoutine]) -> list[dict]:
    return [{
        "title": r.title,
        "kind": r.kind,
        "town": r.town,
        "day_of_week": int(r.day_of_week),
        "day_label": DAY_NAMES[int(r.day_of_week)],
        "start_time_local": r.start_time_local.strftime("%H:%M"),
        "recurrence_label": weekly_label(r.day_of_week),
    } for r in routines if r.is_active]

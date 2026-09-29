"""
Notification service (Directive v2.1 §2.3).

`create_notification()` adds a row to the caller's session and flushes — the
caller commits, so a notification is never written for a movement that
rolled back. Helpers swallow their own errors: a broken alert must not fail
the deal that caused it.

Delivery is pull: the client polls `GET /api/notifications` every 30 s and the
count rides on the bell. (A per-vendor WebSocket push and an e-mail digest
are the next steps the directive marks TODO.)
"""

import logging
from datetime import datetime, timedelta
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.notification import Notification, NotificationType

log = logging.getLogger("brief.notifications")

MILESTONES = (25, 50, 75, 100)


def _clean(data: Optional[dict]) -> dict:
    out = {}
    for k, v in (data or {}).items():
        if isinstance(v, UUID):
            v = str(v)
        elif isinstance(v, datetime):
            v = v.isoformat()
        out[k] = v
    return out


async def create_notification(
    db: AsyncSession,
    recipient_id: UUID,
    notification_type: NotificationType,
    title: str,
    body: str = "",
    sender_id: Optional[UUID] = None,
    data: Optional[dict] = None,
) -> Optional[Notification]:
    """Queue one notification on the session (flushed, not committed)."""
    if recipient_id is None or recipient_id == sender_id:
        return None
    try:
        notif = Notification(
            recipient_id=recipient_id,
            sender_id=sender_id,
            notification_type=notification_type,
            title=(title or "")[:200],
            body=(body or "")[:500] or None,
            data=_clean(data),
        )
        db.add(notif)
        await db.flush()
        # TODO: push via WebSocket to the connected client
        # TODO: queue e-mail digest for unread notifications
        return notif
    except Exception:  # pragma: no cover - defensive
        log.exception("could not queue notification %s for %s", notification_type, recipient_id)
        return None


async def notify_many(
    db: AsyncSession, recipient_ids: Iterable[UUID], notification_type: NotificationType, title: str,
    body: str = "", sender_id: Optional[UUID] = None, data: Optional[dict] = None,
) -> int:
    n = 0
    for rid in {r for r in recipient_ids if r}:
        if await create_notification(db, rid, notification_type, title, body, sender_id, data):
            n += 1
    return n


async def get_unread_count(db: AsyncSession, vendor_id: UUID) -> int:
    result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.recipient_id == vendor_id,
            Notification.is_read.is_(False),
        )
    )
    return int(result.scalar() or 0)


async def list_for(db: AsyncSession, vendor_id: UUID, unread_only: bool = False,
                   skip: int = 0, limit: int = 50) -> list[Notification]:
    query = (
        select(Notification)
        .options(selectinload(Notification.sender))
        .where(Notification.recipient_id == vendor_id)
    )
    if unread_only:
        query = query.where(Notification.is_read.is_(False))
    query = query.order_by(Notification.created_at.desc()).offset(skip).limit(limit)
    return list((await db.execute(query)).scalars().all())


async def mark_read(db: AsyncSession, vendor_id: UUID, notification_id: UUID) -> bool:
    notif = await db.get(Notification, notification_id)
    if not notif or notif.recipient_id != vendor_id:
        return False
    if not notif.is_read:
        notif.is_read = True
        notif.read_at = datetime.utcnow()
    await db.commit()
    return True


async def mark_all_read(db: AsyncSession, vendor_id: UUID) -> int:
    result = await db.execute(
        update(Notification)
        .where(Notification.recipient_id == vendor_id, Notification.is_read.is_(False))
        .values(is_read=True, read_at=datetime.utcnow())
    )
    await db.commit()
    return int(result.rowcount or 0)


def to_dict(n: Notification) -> dict:
    sender = getattr(n, "sender", None)
    return {
        "id": str(n.id),
        "type": n.notification_type.value if hasattr(n.notification_type, "value") else str(n.notification_type),
        "title": n.title,
        "body": n.body,
        "data": n.data or {},
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "sender_handle": sender.vendor_handle if sender else None,
    }


# --- domain helpers ---------------------------------------------------------

def crossed_milestone(before: float, after: float) -> Optional[int]:
    """The highest parasitism milestone passed between two scores, if any."""
    hit = [m for m in MILESTONES if before < m <= after]
    return hit[-1] if hit else None


async def low_stock_alert(db: AsyncSession, item, previous_qty: Optional[int]) -> bool:
    """STOCK_LOW when a shelf crosses down to the threshold (an item's minimum
    order quantity is the floor when it is higher). Fires once per crossing."""
    try:
        floor = max(settings.STOCK_LOW_THRESHOLD, int(item.min_order_quantity or 0))
        qty = int(item.quantity_in_stock or 0)
        if qty > floor:
            return False
        if previous_qty is not None and previous_qty <= floor:
            return False  # already low; don't nag on every sync
        await create_notification(
            db, item.vendor_id, NotificationType.STOCK_LOW,
            f"Low stock: {item.name}",
            f"{qty} {item.unit_of_measure or 'units'} left" + (f" (SKU {item.sku})" if item.sku else ""),
            data={"stock_id": item.id, "quantity": qty},
        )
        return True
    except Exception:  # pragma: no cover
        log.exception("low stock alert failed for %s", getattr(item, "id", None))
        return False


async def send_event_reminders(db: AsyncSession) -> int:
    """EVENT_REMINDER to every registered vendor (and the organiser) of events
    starting within EVENT_REMINDER_HOURS. Each event is reminded once. Caller
    commits."""
    from app.models.events import Event, EventRegistration  # local import: avoid cycles

    now = datetime.utcnow()
    horizon = now + timedelta(hours=settings.EVENT_REMINDER_HOURS)
    events = (await db.execute(select(Event).where(
        Event.status.in_(("upcoming", "active")),
        Event.reminder_sent_at.is_(None),
        Event.start_date >= now, Event.start_date <= horizon,
    ))).scalars().all()
    sent = 0
    for event in events:
        vendor_ids = (await db.execute(select(EventRegistration.vendor_id).where(
            EventRegistration.event_id == event.id,
            EventRegistration.status.in_(("registered", "confirmed")),
        ))).scalars().all()
        when = event.start_date.strftime("%a %d %b, %H:%M UTC")
        sent += await notify_many(
            db, list(vendor_ids) + [event.organizer_id], NotificationType.EVENT_REMINDER,
            f"Starts soon: {event.title}", when + (f" · {event.location}" if event.location else ""),
            data={"event_id": event.id},
        )
        event.reminder_sent_at = now
    return sent

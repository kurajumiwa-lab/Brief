"""Event hub rules (Phase 8). Authorisation is enforced here, on the server.

- A participant is the event's organiser, or a vendor whose registration is registered, confirmed
  or attended. Only participants read the meeting point and the host–attendee messages.
- Only the organiser sets the meeting point, posts gallery photos, and sends messages as the host.
- The gallery is public: it is how a host shows past events to new people. Photos are uploaded
  through the file pipeline (images are checked and stored there); no outside link is accepted.
- The meeting point is a label and a Google Maps link only. No map is embedded, and no exact
  location is stored beyond what the organiser types.
"""

import uuid
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events import Event, EventRegistration
from app.models.vendor import Vendor
from app.modules.event_hub.models import EventGalleryItem, EventMeetingPoint, EventMessage

PARTICIPANT_STATUSES = ("registered", "confirmed", "attended")


async def _event(db: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "Event not found")
    return event


async def _is_participant(db: AsyncSession, event: Event, vendor: Vendor) -> bool:
    if event.organizer_id == vendor.id:
        return True
    row = (await db.execute(select(EventRegistration.id).where(
        EventRegistration.event_id == event.id,
        EventRegistration.vendor_id == vendor.id,
        EventRegistration.status.in_(PARTICIPANT_STATUSES),
    ))).first()
    return row is not None


async def _require_participant(db: AsyncSession, event: Event, vendor: Vendor) -> None:
    if not await _is_participant(db, event, vendor):
        raise HTTPException(403, "Only people who RSVP'd can see this")


def _require_organizer(event: Event, vendor: Vendor) -> None:
    if event.organizer_id != vendor.id:
        raise HTTPException(403, "Only the host can do this")


# Host → required path prefix ("" means any path). Google's own map hosts must serve /maps.
MAPS_RULES = {
    "maps.google.com": "",
    "maps.app.goo.gl": "",
    "goo.gl": "/maps",
    "www.google.com": "/maps",
    "google.com": "/maps",
}


def clean_maps_url(url: Optional[str]) -> Optional[str]:
    """A Google Maps link, https only. Blank means no link."""
    v = (url or "").strip()
    if not v:
        return None
    if len(v) > 500:
        raise HTTPException(422, "The map link is too long")
    parsed = urlparse(v)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in MAPS_RULES:
        raise HTTPException(422, "Use a Google Maps link (https://maps.google.com/… or maps.app.goo.gl/…)")
    if not parsed.path.startswith(MAPS_RULES[host]):
        raise HTTPException(422, "Use a Google Maps link")
    return v


# ── meeting point ─────────────────────────────────────────────────────────────

async def get_meeting_point(db: AsyncSession, vendor: Vendor, event_id: uuid.UUID) -> Optional[EventMeetingPoint]:
    event = await _event(db, event_id)
    await _require_participant(db, event, vendor)
    return await db.get(EventMeetingPoint, event_id)


async def set_meeting_point(db: AsyncSession, vendor: Vendor, event_id: uuid.UUID,
                            *, label: str, maps_url: Optional[str]) -> EventMeetingPoint:
    event = await _event(db, event_id)
    _require_organizer(event, vendor)
    text = (label or "").strip()
    if not 2 <= len(text) <= 200:
        raise HTTPException(422, "Enter a meeting point of 2 to 200 characters")
    row = await db.get(EventMeetingPoint, event_id)
    if row is None:
        row = EventMeetingPoint(event_id=event_id)
        db.add(row)
    row.label = text
    row.maps_url = clean_maps_url(maps_url)
    row.updated_at = datetime.utcnow()
    await db.flush()
    return row


# ── gallery ───────────────────────────────────────────────────────────────────

async def list_event_gallery(db: AsyncSession, event_id: uuid.UUID) -> list:
    await _event(db, event_id)
    return (await db.execute(select(EventGalleryItem).where(EventGalleryItem.event_id == event_id)
                             .order_by(EventGalleryItem.created_at.desc()))).scalars().all()


async def list_host_gallery(db: AsyncSession, host_id: uuid.UUID, limit: int = 60) -> list:
    rows = (await db.execute(select(EventGalleryItem, Event.title, Event.start_date)
                             .join(Event, Event.id == EventGalleryItem.event_id)
                             .where(Event.organizer_id == host_id)
                             .order_by(EventGalleryItem.created_at.desc()).limit(limit))).all()
    return rows


async def add_gallery_item(db: AsyncSession, vendor: Vendor, event_id: uuid.UUID,
                           *, image_url: str, caption: Optional[str]) -> EventGalleryItem:
    event = await _event(db, event_id)
    _require_organizer(event, vendor)
    text = (caption or "").strip()[:300] or None
    row = EventGalleryItem(event_id=event_id, image_url=image_url, caption=text,
                           created_at=datetime.utcnow())
    db.add(row)
    await db.flush()
    return row


# ── messages ──────────────────────────────────────────────────────────────────

async def list_messages(db: AsyncSession, vendor: Vendor, event_id: uuid.UUID, limit: int = 200) -> list:
    event = await _event(db, event_id)
    await _require_participant(db, event, vendor)
    rows = (await db.execute(select(EventMessage).where(EventMessage.event_id == event_id)
                             .order_by(EventMessage.created_at.desc()).limit(limit))).scalars().all()
    return list(reversed(rows))


async def post_message(db: AsyncSession, vendor: Vendor, event_id: uuid.UUID, body: str) -> EventMessage:
    event = await _event(db, event_id)
    await _require_participant(db, event, vendor)
    text = (body or "").strip()
    if not 1 <= len(text) <= 1000:
        raise HTTPException(422, "A message is 1 to 1000 characters")
    row = EventMessage(event_id=event_id, sender_vendor_id=vendor.id, body=text, created_at=datetime.utcnow())
    db.add(row)
    await db.flush()
    return row

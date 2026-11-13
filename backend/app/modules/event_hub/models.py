"""Event hub records (Phase 8). Each one hangs off an existing `events` row.

- EventMeetingPoint: where to meet, as a label and a Google Maps link. Shown to participants only.
- EventGalleryItem: a photo from a past event, posted by the host. Public, for advertising.
- EventMessage: a message between the host and the people who RSVP'd. Participants only.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class EventMeetingPoint(Base):
    __tablename__ = "event_meeting_points"
    __table_args__ = (
        CheckConstraint("char_length(btrim(label)) > 0", name="ck_event_meeting_points_label"),
    )

    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    label = Column(String(200), nullable=False)
    maps_url = Column(String(500), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class EventGalleryItem(Base):
    __tablename__ = "event_gallery_items"
    __table_args__ = (
        Index("ix_event_gallery_items_event_created", "event_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    image_url = Column(String(500), nullable=False)
    caption = Column(String(300), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class EventMessage(Base):
    __tablename__ = "event_messages"
    __table_args__ = (
        CheckConstraint("char_length(btrim(body)) > 0", name="ck_event_messages_body"),
        Index("ix_event_messages_event_created", "event_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    sender_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

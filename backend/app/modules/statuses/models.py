"""Business follows and 24-hour statuses.

A follow is business → business (LinkedIn model). A status is visible only to
the businesses that follow its author, and it expires 24 hours after posting.
Who viewed a status is recorded so the author, and only the author, can see it.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class BusinessFollow(Base):
    __tablename__ = "business_follows"
    __table_args__ = (
        UniqueConstraint("follower_id", "followed_id", name="uq_business_follow_pair"),
        CheckConstraint("follower_id <> followed_id", name="ck_business_follow_not_self"),
        Index("ix_business_follows_followed", "followed_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    follower_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    followed_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class BusinessStatus(Base):
    __tablename__ = "business_statuses"
    __table_args__ = (
        CheckConstraint("kind IN ('text', 'photo', 'video')", name="ck_business_status_kind"),
        CheckConstraint("body IS NULL OR char_length(body) <= 500", name="ck_business_status_body"),
        Index("ix_business_statuses_vendor_created", "vendor_id", "created_at"),
        Index("ix_business_statuses_expires", "expires_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(10), nullable=False, default="text")
    body = Column(Text, nullable=True)
    media_url = Column(String(600), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))
    expires_at = Column(DateTime, nullable=False)
    removed_at = Column(DateTime, nullable=True)


class StatusView(Base):
    __tablename__ = "status_views"
    __table_args__ = (
        UniqueConstraint("status_id", "viewer_id", name="uq_status_view_pair"),
        Index("ix_status_views_viewer", "viewer_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status_id = Column(UUID(as_uuid=True), ForeignKey("business_statuses.id", ondelete="CASCADE"), nullable=False, index=True)
    viewer_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    viewed_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))

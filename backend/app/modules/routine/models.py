"""Daily routine: the user's choices and what they marked done.

A check is only shown when the user has switched it on. Off means it never
appears and never makes a dot. Nothing here runs in the background.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class RoutinePreference(Base):
    __tablename__ = "routine_preferences"
    __table_args__ = (UniqueConstraint("vendor_id", "check_key", name="uq_routine_preference"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    check_key = Column(String(64), nullable=False)
    enabled = Column(Boolean, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class RoutineCompletion(Base):
    """A daily check marked done for one calendar day (Nairobi date)."""
    __tablename__ = "routine_completions"
    __table_args__ = (UniqueConstraint("vendor_id", "check_key", "day", name="uq_routine_completion"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    check_key = Column(String(64), nullable=False)
    day = Column(Date, nullable=False)
    done_at = Column(DateTime, default=datetime.utcnow, nullable=False)

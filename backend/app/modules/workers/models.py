import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

STATUSES = ("assigned", "in_progress", "done", "cancelled")
OPEN_STATUSES = ("assigned", "in_progress")


class WorkAssignment(Base):
    """One piece of work, given to one active member of one office.

    The worker is an existing OfficeMember. Access is checked on every request, so removing a
    member or changing their role takes effect at once, even for work already assigned to them.
    """
    __tablename__ = "work_assignments"
    __table_args__ = (
        CheckConstraint(f"status IN {STATUSES}", name="ck_work_assignments_status"),
        CheckConstraint("char_length(btrim(title)) > 0", name="ck_work_assignments_title_nonblank"),
        CheckConstraint("status <> 'done' OR completed_at IS NOT NULL", name="ck_work_assignments_done_has_time"),
        Index("ix_work_assignments_assignee_status", "assignee_vendor_id", "status"),
        Index("ix_work_assignments_office_status", "office_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    office_id = Column(UUID(as_uuid=True), ForeignKey("offices.id", ondelete="CASCADE"), nullable=False)
    assignee_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False)
    assigned_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)
    details = Column(Text, nullable=True)
    status = Column(String(12), nullable=False, default="assigned", server_default="assigned")
    due_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)

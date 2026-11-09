"""Home office: a team's home base on Brief.

Open onboarding: one person can create a profile alone. Team members join later, either by
a single-use link (unregistered person, with a stated function) or by an invite to a registered
profile, which the person must accept. Nothing here holds money.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

ROLES = ("owner", "editor", "approver", "member", "partner", "staff")
MEMBER_STATUSES = ("invited", "active", "removed")
CONTACT_MODES = ("none", "phone", "email")


def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class Office(Base):
    __tablename__ = "offices"
    __table_args__ = (
        CheckConstraint(_in("contact_mode", CONTACT_MODES), name="ck_offices_contact_mode"),
        CheckConstraint(_in("status", ("active", "archived")), name="ck_offices_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                             nullable=False, index=True)
    name = Column(String(120), nullable=False)
    nature = Column(String(120), nullable=False)      # what the venture does
    area = Column(String(120), nullable=False)        # where it works; never the exact address
    hours_text = Column(String(200), nullable=True)
    contact_mode = Column(String(8), nullable=False, default="none", server_default="none")
    status = Column(String(12), nullable=False, default="active", server_default="active")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class OfficeMember(Base):
    __tablename__ = "office_members"
    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="ck_office_members_role"),
        CheckConstraint(_in("status", MEMBER_STATUSES), name="ck_office_members_status"),
        CheckConstraint("NOT (vendor_id IS NOT NULL AND display_name IS NOT NULL)", name="ck_office_members_identity"),
        Index("uq_office_member_account", "office_id", "vendor_id", unique=True,
              postgresql_where=text("vendor_id IS NOT NULL")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    office_id = Column(UUID(as_uuid=True), ForeignKey("offices.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    # A registered member has vendor_id; a link-joined person has display_name and no account.
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=True)
    display_name = Column(String(60), nullable=True)
    function_label = Column(String(80), nullable=True)
    role = Column(String(12), nullable=False, default="staff", server_default="staff")
    status = Column(String(12), nullable=False, default="invited", server_default="invited")
    invite_token_hash = Column(String(64), nullable=True, unique=True)
    invite_expires_at = Column(DateTime, nullable=True)
    invited_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    responded_at = Column(DateTime, nullable=True)


class OfficeEvent(Base):
    __tablename__ = "office_events"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ck_office_events_order"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    office_id = Column(UUID(as_uuid=True), ForeignKey("offices.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    activity = Column(String(80), nullable=False)    # e.g. "Saturday delivery run"
    title = Column(String(160), nullable=False)
    starts_at = Column(DateTime, nullable=False, index=True)
    ends_at = Column(DateTime, nullable=False)
    location_text = Column(String(200), nullable=True)
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

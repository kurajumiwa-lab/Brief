"""Home office: a team's home base on Brief.

Open onboarding: one person can create a profile alone. Team members join later, either by
a single-use link (unregistered person, with a stated function) or by an invite to a registered
profile, which the person must accept. Nothing here holds money.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

ROLES = ("owner", "editor", "approver", "member", "partner", "staff")
MEMBER_STATUSES = ("invited", "active", "removed")
CONTACT_MODES = ("none", "phone", "email")


def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _nonblank(column: str) -> str:
    return f"length(btrim({column})) > 0"


# Timestamps are timezone-aware and stored in UTC. Mirrors migration 0040_home_office.
TS = DateTime(timezone=True)


class Office(Base):
    __tablename__ = "offices"
    __table_args__ = (
        CheckConstraint(_in("contact_mode", CONTACT_MODES), name="ck_offices_contact_mode"),
        CheckConstraint(_in("status", ("active", "archived")), name="ck_offices_status"),
        CheckConstraint(_in("visibility", ("private", "public")), name="ck_offices_visibility"),
        CheckConstraint(
            f"{_nonblank('name')} AND {_nonblank('nature')} AND {_nonblank('area')} "
            f"AND (hours_text IS NULL OR {_nonblank('hours_text')})",
            name="ck_offices_text_nonblank",
        ),
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
    # Rule 9: private until the owner chooses otherwise. Mirrors migration 0041.
    visibility = Column(String(12), nullable=False, default="private", server_default="private")
    created_at = Column(TS, nullable=False, default=datetime.utcnow)
    updated_at = Column(TS, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class OfficeMember(Base):
    __tablename__ = "office_members"
    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="ck_office_members_role"),
        CheckConstraint(_in("status", MEMBER_STATUSES), name="ck_office_members_status"),
        CheckConstraint("role <> 'owner' OR vendor_id IS NOT NULL", name="ck_office_members_owner_is_account"),
        CheckConstraint("NOT (vendor_id IS NOT NULL AND display_name IS NOT NULL)",
                        name="ck_office_members_identity_single"),
        CheckConstraint(
            "(vendor_id IS NOT NULL OR display_name IS NOT NULL)"
            " OR (status = 'invited' AND invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL)"
            " OR status = 'removed'",
            name="ck_office_members_identity_present",
        ),
        CheckConstraint(f"display_name IS NULL OR {_nonblank('display_name')}",
                        name="ck_office_members_display_nonblank"),
        CheckConstraint(f"function_label IS NULL OR {_nonblank('function_label')}",
                        name="ck_office_members_function_nonblank"),
        CheckConstraint("invite_token_hash IS NULL OR (status = 'invited' AND invite_expires_at IS NOT NULL)",
                        name="ck_office_members_credential_pending"),
        CheckConstraint("status = 'invited' OR (invite_token_hash IS NULL AND invite_expires_at IS NULL)",
                        name="ck_office_members_no_stale_credentials"),
        Index("uq_office_member_account", "office_id", "vendor_id", unique=True,
              postgresql_where=text("vendor_id IS NOT NULL")),
        Index("ix_office_members_vendor_id", "vendor_id", postgresql_where=text("vendor_id IS NOT NULL")),
        Index("uq_office_one_active_owner", "office_id", unique=True,
              postgresql_where=text("role = 'owner' AND status = 'active'")),
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
    invite_expires_at = Column(TS, nullable=True)
    invited_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TS, nullable=False, default=datetime.utcnow)
    responded_at = Column(TS, nullable=True)


class OfficeEvent(Base):
    __tablename__ = "office_events"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ck_office_events_order"),
        CheckConstraint(
            f"{_nonblank('activity')} AND {_nonblank('title')} "
            f"AND (location_text IS NULL OR {_nonblank('location_text')})",
            name="ck_office_events_text_nonblank",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    office_id = Column(UUID(as_uuid=True), ForeignKey("offices.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    activity = Column(String(80), nullable=False)    # e.g. "Saturday delivery run"
    title = Column(String(160), nullable=False)
    starts_at = Column(TS, nullable=False, index=True)
    ends_at = Column(TS, nullable=False)
    location_text = Column(String(200), nullable=True)
    created_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TS, nullable=False, default=datetime.utcnow)


PARTNER_STATUSES = ("invited", "active", "declined", "removed")


class OfficePartner(Base):
    """A partner team: one office invites another office to work with it. Two home offices only.

    The inviting office's owner sends the invite; the other office's owner accepts or declines.
    Either owner may end an active link. Mirrors migration 0050_office_partners.
    """
    __tablename__ = "office_partners"
    __table_args__ = (
        CheckConstraint(_in("status", PARTNER_STATUSES), name="ck_office_partners_status"),
        CheckConstraint("office_id <> partner_office_id", name="ck_office_partners_not_self"),
        Index("uq_office_partners_pair", "office_id", "partner_office_id", unique=True),
        Index("ix_office_partners_partner", "partner_office_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    office_id = Column(UUID(as_uuid=True), ForeignKey("offices.id", ondelete="CASCADE"), nullable=False)
    partner_office_id = Column(UUID(as_uuid=True), ForeignKey("offices.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(10), nullable=False, default="invited", server_default="invited")
    invited_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    responded_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TS, nullable=False, default=datetime.utcnow)
    responded_at = Column(TS, nullable=True)
    updated_at = Column(TS, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class OfficeNotice(Base):
    """A noticeboard post for one home office. Members read it; owners and editors post and edit.

    An author may also edit or delete their own post. Mirrors migration 0052_office_notices.
    """
    __tablename__ = "office_notices"
    __table_args__ = (
        CheckConstraint(_nonblank("title"), name="ck_office_notices_title_nonblank"),
        CheckConstraint(_nonblank("body"), name="ck_office_notices_body_nonblank"),
        Index("ix_office_notices_office_created", "office_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    office_id = Column(UUID(as_uuid=True), ForeignKey("offices.id", ondelete="CASCADE"), nullable=False)
    author_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(120), nullable=False)
    body = Column(String(4000), nullable=False)
    created_at = Column(TS, nullable=False, default=datetime.utcnow)
    updated_at = Column(TS, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    edited_at = Column(TS, nullable=True)

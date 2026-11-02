"""Membership profiles and the audit trail of every membership change."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class MemberProfile(Base):
    __tablename__ = "member_profiles"
    __table_args__ = (
        CheckConstraint(
            "membership_status IN ('active','suspended')", name="ck_member_profiles_status"
        ),
        CheckConstraint(
            "verification_status IN ('unverified','pending','verified','rejected')",
            name="ck_member_profiles_verification",
        ),
        Index("ix_member_profiles_directory", "directory_visible", "membership_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       unique=True, nullable=False)
    display_name = Column(String(120), nullable=True)
    category = Column(String(32), nullable=True)
    professional_class = Column(String(120), nullable=True)
    bio = Column(Text, nullable=True)

    membership_status = Column(String(16), nullable=False, default="active", server_default="active")
    verification_status = Column(String(16), nullable=False, default="unverified",
                                 server_default="unverified")
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(String(100), nullable=True)

    directory_visible = Column(Boolean, nullable=False, default=False, server_default="false")
    show_contact = Column(Boolean, nullable=False, default=False, server_default="false")

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    vendor = relationship("Vendor", lazy="noload")


class MembershipEvent(Base):
    """Append-only record of verification and membership changes. Never edited."""

    __tablename__ = "membership_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    actor = Column(String(100), nullable=False)  # handle of the member or operator
    action = Column(String(48), nullable=False)
    before = Column(JSONB, nullable=True)
    after = Column(JSONB, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

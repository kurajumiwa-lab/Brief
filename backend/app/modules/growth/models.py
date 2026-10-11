"""Persistent models for plan entitlements, team seats and motion audit history (v2.12).

    vendor_team_members      seats sharing one business's passport & workspace,
                             capped by `vendor.plan_seats_limit`. No team seat
                             can ever self-verify compliance claims.
    plan_entitlement_events  append-only history of plan tier changes, seat
                             grants/revocations and motion-window checks.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

TEAM_ROLES = ("owner", "finance", "clerk")
TEAM_STATUSES = ("active", "revoked")
PLAN_TIERS = ("starter", "readiness", "network", "institution")


class VendorTeamMember(Base):
    """A seat invited onto a business's workspace and passport."""
    __tablename__ = "vendor_team_members"
    __table_args__ = (
        CheckConstraint("role IN ('owner','finance','clerk')", name="ck_vendor_team_member_role"),
        CheckConstraint("status IN ('active','revoked')", name="ck_vendor_team_member_status"),
        UniqueConstraint("vendor_id", "member_email", name="uq_vendor_team_member_email"),
        Index("ix_vendor_team_members_vendor_status", "vendor_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    member_email = Column(String(255), nullable=False)
    member_handle = Column(String(100), nullable=True)
    role = Column(String(24), nullable=False, default="clerk", server_default="clerk")
    status = Column(String(24), nullable=False, default="active", server_default="active")
    added_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)


class PlanEntitlementEvent(Base):
    """Append-only audit record for plan changes, seat actions and motion gates."""
    __tablename__ = "plan_entitlement_events"
    __table_args__ = (
        Index("ix_plan_entitlement_events_vendor_created", "vendor_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    action = Column(String(48), nullable=False)
    previous_tier = Column(String(24), nullable=True)
    new_tier = Column(String(24), nullable=True)
    actor_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    payload = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

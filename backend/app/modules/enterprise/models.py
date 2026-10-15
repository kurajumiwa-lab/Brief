"""Enterprise workspaces, memberships and managed devices (v2.13).

This is a scope upgrade of the existing vendor network, not a second app:

    enterprise_workspaces   one row per paying organisation (trade
                            association, cooperative, employer, county
                            programme, business). It *wraps* the vendors,
                            groups, lists and passports that already exist —
                            a workspace member is still an ordinary Vendor
                            with an @handle, stock, claims and movements.
    enterprise_memberships  vendor ↔ workspace, with the role the person
                            holds *inside that organisation* (owner, admin,
                            field_officer, member, viewer). `registered_by`
                            records which field officer brought the vendor
                            in, so an association can see field activity
                            as counts of named registrations — never as an
                            opaque officer score.
    managed_devices         a register of Android devices an organisation
                            has enrolled for its people. Brief_ keeps the
                            register and the audit trail; Google's Android
                            Enterprise / the organisation's EMM does the
                            actual device management. `emm_device_id` is
                            the provider's reference when one exists.
    device_commands         append-only audit of every remote action
                            requested (lock, remove company data, wipe).
                            A command is only `dispatched` when an EMM is
                            actually configured and accepts it — the API
                            never reports a lock/wipe that did not happen.

Deliberately NOT here: a marketplace, a job-matching engine, or an MDM.
Those already exist (stock/requests/orders) or are provided by Android
Enterprise and integrated, not rebuilt.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

ORG_TYPES = ("trade_association", "cooperative", "business", "employer", "county_org", "other")
MEMBER_ROLES = ("owner", "admin", "field_officer", "member", "viewer")
MEMBER_STATUSES = ("active", "revoked")
WORKSPACE_STATUSES = ("active", "suspended")
ENROLMENT_MODES = ("fully_managed", "work_profile", "dedicated")
DEVICE_STATUSES = ("pending", "enrolled", "active", "locked", "suspended", "retired")
COMMAND_TYPES = ("lock", "wipe_work_data", "wipe_device", "lost_mode")
COMMAND_STATUSES = ("requested", "dispatched", "acknowledged", "failed", "rejected", "cancelled")


class EnterpriseWorkspace(Base):
    __tablename__ = "enterprise_workspaces"
    __table_args__ = (
        CheckConstraint(
            "org_type IN ('trade_association','cooperative','business','employer','county_org','other')",
            name="ck_enterprise_workspace_org_type",
        ),
        CheckConstraint("status IN ('active','suspended')", name="ck_enterprise_workspace_status"),
        Index("ix_enterprise_workspaces_owner", "owner_vendor_id"),
        Index("ix_enterprise_workspaces_public", "is_public", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug = Column(String(120), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    org_type = Column(String(32), nullable=False, default="trade_association", server_default="trade_association")
    region = Column(String(120), nullable=False, default="Kisumu", server_default="Kisumu")
    description = Column(Text, nullable=True)
    # Branding for the organisation's portal view (name/colour/logo only —
    # the workspace renders inside Brief_, it is not a separate website).
    branding = Column(JSONB, nullable=False, default=dict)
    owner_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=False
    )
    plan_key = Column(String(24), nullable=False, default="pilot", server_default="pilot")
    status = Column(String(24), nullable=False, default="active", server_default="active")
    # Connected to the public marketplace: members stay discoverable as
    # ordinary vendors, and the workspace itself may be listed for joining.
    is_public = Column(Boolean, nullable=False, default=False, server_default="false")
    # Android Enterprise binding, copied from the organisation's Google
    # admin / EMM console when it enrols. Null until that external step
    # happens — Brief_ cannot create it and never pretends to.
    android_enterprise_id = Column(String(200), nullable=True)
    emm_provider = Column(String(80), nullable=False, default="none", server_default="none")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class EnterpriseMembership(Base):
    __tablename__ = "enterprise_memberships"
    __table_args__ = (
        CheckConstraint(
            "role IN ('owner','admin','field_officer','member','viewer')",
            name="ck_enterprise_membership_role",
        ),
        CheckConstraint("status IN ('active','revoked')", name="ck_enterprise_membership_status"),
        UniqueConstraint("workspace_id", "vendor_id", name="uq_enterprise_membership_vendor"),
        Index("ix_enterprise_memberships_workspace_status", "workspace_id", "status"),
        Index("ix_enterprise_memberships_vendor_status", "vendor_id", "status"),
        Index("ix_enterprise_memberships_registered_by", "registered_by_vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(
        UUID(as_uuid=True), ForeignKey("enterprise_workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(String(24), nullable=False, default="member", server_default="member")
    status = Column(String(24), nullable=False, default="active", server_default="active")
    # The field officer (or admin) who registered this member — the basis
    # of the field-activity dashboard. Counts only; no officer ranking.
    registered_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)


class ManagedDevice(Base):
    __tablename__ = "managed_devices"
    __table_args__ = (
        CheckConstraint(
            "enrolment_mode IN ('fully_managed','work_profile','dedicated')",
            name="ck_managed_device_enrolment_mode",
        ),
        CheckConstraint(
            "status IN ('pending','enrolled','active','locked','suspended','retired')",
            name="ck_managed_device_status",
        ),
        Index("ix_managed_devices_workspace_status", "workspace_id", "status"),
        Index("ix_managed_devices_assigned", "assigned_vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(
        UUID(as_uuid=True), ForeignKey("enterprise_workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    assigned_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    enrolled_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    label = Column(String(200), nullable=False)
    # Asset tag / EMM reference — never an IMEI or personal phone number.
    device_ref = Column(String(120), nullable=True)
    emm_device_id = Column(String(200), nullable=True)
    enrolment_mode = Column(String(24), nullable=False, default="work_profile", server_default="work_profile")
    status = Column(String(24), nullable=False, default="pending", server_default="pending")
    policy_name = Column(String(200), nullable=True)
    enrolled_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class DeviceCommand(Base):
    __tablename__ = "device_commands"
    __table_args__ = (
        CheckConstraint(
            "command_type IN ('lock','wipe_work_data','wipe_device','lost_mode')",
            name="ck_device_command_type",
        ),
        CheckConstraint(
            "status IN ('requested','dispatched','acknowledged','failed','rejected','cancelled')",
            name="ck_device_command_status",
        ),
        CheckConstraint(
            "enrolment_mode IN ('fully_managed','work_profile','dedicated')",
            name="ck_device_command_enrolment_mode",
        ),
        Index("ix_device_commands_workspace_created", "workspace_id", "created_at"),
        Index("ix_device_commands_device_created", "device_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(
        UUID(as_uuid=True), ForeignKey("enterprise_workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    device_id = Column(
        UUID(as_uuid=True), ForeignKey("managed_devices.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    command_type = Column(String(24), nullable=False)
    # Snapshot at request time: what was allowed then is what the audit says.
    enrolment_mode = Column(String(24), nullable=False)
    reason = Column(Text, nullable=False)
    requested_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    status = Column(String(24), nullable=False, default="requested", server_default="requested")
    # True only when a configured EMM accepted the command for delivery.
    dispatched = Column(Boolean, nullable=False, default=False, server_default="false")
    result_note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    dispatched_at = Column(DateTime, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)

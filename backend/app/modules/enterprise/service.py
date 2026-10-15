"""Service layer for enterprise workspaces (v2.13).

Every count on the dashboard is queried from the database at request time.
Field activity is reported as *named registrations per officer* — a count
an association official can check against their own register — never as a
composite officer score.
"""

import re
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.vendor import Vendor
from app.modules.enterprise import rules
from app.modules.enterprise.models import (
    DeviceCommand,
    EnterpriseMembership,
    EnterpriseWorkspace,
    ManagedDevice,
)

# ── serialisation ────────────────────────────────────────────────────────────


def workspace_out(ws: EnterpriseWorkspace, *, my_role: Optional[str] = None) -> dict:
    spec = rules.plan_spec(ws.plan_key)
    return {
        "id": str(ws.id),
        "slug": ws.slug,
        "name": ws.name,
        "org_type": ws.org_type,
        "region": ws.region,
        "description": ws.description,
        "branding": ws.branding or {},
        "owner_handle": None,  # filled by callers that already loaded the owner
        "plan": {
            "key": spec.key,
            "name": spec.name,
            "price_kes_monthly": spec.price_kes_monthly,
            "price_kes_annual": spec.price_kes_annual,
            "max_members": spec.max_members,
            "max_field_officers": spec.max_field_officers,
            "max_devices": spec.max_devices,
        },
        "status": ws.status,
        "is_public": bool(ws.is_public),
        "marketplace_connected": True,
        "android": {
            "enterprise_bound": bool(ws.android_enterprise_id and (ws.emm_provider or "none") != "none"),
            "android_enterprise_id": ws.android_enterprise_id,
            "emm_provider": ws.emm_provider or "none",
            "dispatch_enabled": bool(settings.ENTERPRISE_DEVICE_COMMANDS_DISPATCH_ENABLED),
            "note": (
                "Android Enterprise / your EMM manages the phones. Brief_ keeps the "
                "device register and the command audit trail and sends nothing to a "
                "device until an EMM is bound and dispatch is enabled."
            ),
        },
        "my_role": my_role,
        "created_at": ws.created_at.isoformat() if ws.created_at else None,
    }


def membership_out(m: EnterpriseMembership, vendor: Optional[Vendor] = None,
                   registrar: Optional[Vendor] = None) -> dict:
    return {
        "id": str(m.id),
        "workspace_id": str(m.workspace_id),
        "vendor_id": str(m.vendor_id),
        "vendor_handle": vendor.vendor_handle if vendor else None,
        "business_name": vendor.business_name if vendor else None,
        "is_verified": bool(vendor.is_verified) if vendor else None,
        "role": m.role,
        "status": m.status,
        "registered_by_handle": registrar.vendor_handle if registrar else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def device_out(d: ManagedDevice, assignee: Optional[Vendor] = None) -> dict:
    return {
        "id": str(d.id),
        "workspace_id": str(d.workspace_id),
        "label": d.label,
        "device_ref": d.device_ref,
        "emm_device_id": d.emm_device_id,
        "enrolment_mode": d.enrolment_mode,
        "enrolment_note": rules.ENROLMENT_MODE_NOTES.get(d.enrolment_mode, "").strip(),
        "allowed_commands": list(rules.allowed_commands(d.enrolment_mode)),
        "status": d.status,
        "policy_name": d.policy_name,
        "assigned_handle": assignee.vendor_handle if assignee else None,
        "enrolled_at": d.enrolled_at.isoformat() if d.enrolled_at else None,
        "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


def command_out(c: DeviceCommand) -> dict:
    return {
        "id": str(c.id),
        "workspace_id": str(c.workspace_id),
        "device_id": str(c.device_id),
        "command_type": c.command_type,
        "enrolment_mode": c.enrolment_mode,
        "reason": c.reason,
        "status": c.status,
        "dispatched": bool(c.dispatched),
        "result_note": c.result_note,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "dispatched_at": c.dispatched_at.isoformat() if c.dispatched_at else None,
        "acknowledged_at": c.acknowledged_at.isoformat() if c.acknowledged_at else None,
    }


# ── helpers ──────────────────────────────────────────────────────────────────


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return slug[:80] or "workspace"


async def _unique_slug(db: AsyncSession, name: str) -> str:
    base = _slugify(name)
    slug, n = base, 2
    while (await db.execute(
        select(EnterpriseWorkspace.id).where(EnterpriseWorkspace.slug == slug)
    )).scalar_one_or_none() is not None:
        slug = f"{base}-{n}"
        n += 1
    return slug


async def get_workspace(db: AsyncSession, workspace_id: UUID) -> EnterpriseWorkspace:
    ws = await db.get(EnterpriseWorkspace, workspace_id)
    if ws is None:
        raise rules.EnterpriseRuleError("Workspace not found", status=404)
    return ws


async def membership_of(db: AsyncSession, workspace_id: UUID, vendor_id: UUID) -> Optional[EnterpriseMembership]:
    return (await db.execute(
        select(EnterpriseMembership).where(
            EnterpriseMembership.workspace_id == workspace_id,
            EnterpriseMembership.vendor_id == vendor_id,
            EnterpriseMembership.status == "active",
        )
    )).scalar_one_or_none()


async def require_role(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor,
                       roles: tuple[str, ...]) -> EnterpriseMembership:
    m = await membership_of(db, ws.id, vendor.id)
    if m is None:
        raise rules.EnterpriseRuleError("You are not a member of this workspace", status=403)
    if m.role not in roles:
        raise rules.EnterpriseRuleError(
            f"This action needs one of: {', '.join(roles)} (your role: {m.role})", status=403
        )
    return m


async def _vendor_by_handle(db: AsyncSession, handle: str) -> Vendor:
    clean = (handle or "").strip().lstrip("@").lower()
    vendor = (await db.execute(
        select(Vendor).where(func.lower(Vendor.vendor_handle) == clean)
    )).scalar_one_or_none()
    if vendor is None:
        raise rules.EnterpriseRuleError(f"No vendor with handle @{clean}", status=404)
    return vendor


async def _usage(db: AsyncSession, ws: EnterpriseWorkspace) -> dict:
    members = int((await db.execute(
        select(func.count()).select_from(EnterpriseMembership).where(
            EnterpriseMembership.workspace_id == ws.id,
            EnterpriseMembership.status == "active",
        )
    )).scalar_one())
    officers = int((await db.execute(
        select(func.count()).select_from(EnterpriseMembership).where(
            EnterpriseMembership.workspace_id == ws.id,
            EnterpriseMembership.status == "active",
            EnterpriseMembership.role == "field_officer",
        )
    )).scalar_one())
    devices = int((await db.execute(
        select(func.count()).select_from(ManagedDevice).where(
            ManagedDevice.workspace_id == ws.id,
            ManagedDevice.status != "retired",
        )
    )).scalar_one())
    spec = rules.plan_spec(ws.plan_key)
    return {
        "members_used": members, "members_limit": spec.max_members,
        "field_officers_used": officers, "field_officers_limit": spec.max_field_officers,
        "devices_used": devices, "devices_limit": spec.max_devices,
    }


# ── workspaces ───────────────────────────────────────────────────────────────


async def create_workspace(db: AsyncSession, vendor: Vendor, *, name: str, org_type: str,
                           region: str, description: Optional[str], is_public: bool,
                           branding: Optional[dict]) -> dict:
    org = (org_type or "trade_association").strip().lower()
    if org not in ("trade_association", "cooperative", "business", "employer", "county_org", "other"):
        raise rules.EnterpriseRuleError(f"Unknown org_type '{org_type}'", status=400)
    clean_name = (name or "").strip()
    if len(clean_name) < 3:
        raise rules.EnterpriseRuleError("Workspace name needs at least 3 characters", status=400)
    ws = EnterpriseWorkspace(
        slug=await _unique_slug(db, clean_name),
        name=clean_name,
        org_type=org,
        region=(region or "Kisumu").strip() or "Kisumu",
        description=(description or "").strip() or None,
        branding=branding or {},
        owner_vendor_id=vendor.id,
        plan_key="pilot",
        is_public=bool(is_public),
    )
    db.add(ws)
    await db.flush()
    db.add(EnterpriseMembership(
        workspace_id=ws.id, vendor_id=vendor.id, role="owner",
        registered_by_vendor_id=vendor.id,
    ))
    await db.commit()
    await db.refresh(ws)
    out = workspace_out(ws, my_role="owner")
    out["owner_handle"] = vendor.vendor_handle
    out["usage"] = await _usage(db, ws)
    return out


async def my_workspaces(db: AsyncSession, vendor: Vendor) -> list[dict]:
    rows = (await db.execute(
        select(EnterpriseWorkspace, EnterpriseMembership.role)
        .join(EnterpriseMembership, EnterpriseMembership.workspace_id == EnterpriseWorkspace.id)
        .where(EnterpriseMembership.vendor_id == vendor.id,
               EnterpriseMembership.status == "active")
        .order_by(EnterpriseWorkspace.created_at.asc())
    )).all()
    return [workspace_out(ws, my_role=role) for ws, role in rows]


async def discover_workspaces(db: AsyncSession, vendor: Vendor, *, q: str = "") -> list[dict]:
    """Public workspaces a vendor could ask to join — the marketplace side
    of the dual model. Private workspaces are never listed."""
    stmt = select(EnterpriseWorkspace).where(
        EnterpriseWorkspace.is_public.is_(True),
        EnterpriseWorkspace.status == "active",
    )
    if q.strip():
        stmt = stmt.where(EnterpriseWorkspace.name.ilike(f"%{q.strip()}%"))
    rows = (await db.execute(stmt.order_by(EnterpriseWorkspace.created_at.desc()).limit(50))).scalars().all()
    out = []
    for ws in rows:
        mine = await membership_of(db, ws.id, vendor.id)
        out.append({**workspace_out(ws, my_role=mine.role if mine else None),
                    "member_count": (await _usage(db, ws))["members_used"]})
    return out


async def update_workspace(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor, *,
                           fields: dict) -> dict:
    m = await require_role(db, ws, vendor, rules.MANAGE_ROLES)
    if "name" in fields and fields["name"]:
        ws.name = str(fields["name"]).strip()
    if "region" in fields and fields["region"]:
        ws.region = str(fields["region"]).strip()
    if "description" in fields:
        ws.description = (str(fields["description"]).strip() or None) if fields["description"] else None
    if "is_public" in fields and fields["is_public"] is not None:
        ws.is_public = bool(fields["is_public"])
    if "branding" in fields and isinstance(fields["branding"], dict):
        ws.branding = {**(ws.branding or {}), **fields["branding"]}
    if "plan_key" in fields and fields["plan_key"]:
        key = str(fields["plan_key"]).strip().lower()
        if key not in rules.WORKSPACE_PLANS:
            raise rules.EnterpriseRuleError(
                f"plan_key must be one of {', '.join(rules.WORKSPACE_PLANS)}", status=400)
        spec = rules.plan_spec(key)
        usage = await _usage(db, ws)
        if usage["members_used"] > spec.max_members or usage["devices_used"] > spec.max_devices:
            raise rules.EnterpriseRuleError(
                "Current usage exceeds that plan's limits — revoke members or retire devices first.",
                status=400)
        ws.plan_key = key
    # Binding the Android Enterprise organisation is an owner-only act: it
    # asserts an external fact (the ID in Google's console) that Brief_
    # cannot check, so it is kept narrow and auditable via updated_at.
    if "android_enterprise_id" in fields or "emm_provider" in fields:
        if m.role != "owner":
            raise rules.EnterpriseRuleError("Only the workspace owner can bind Android Enterprise", status=403)
        if "android_enterprise_id" in fields:
            ws.android_enterprise_id = (str(fields["android_enterprise_id"]).strip() or None) \
                if fields["android_enterprise_id"] else None
        if "emm_provider" in fields and fields["emm_provider"]:
            ws.emm_provider = str(fields["emm_provider"]).strip()
    ws.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(ws)
    out = workspace_out(ws, my_role=m.role)
    out["usage"] = await _usage(db, ws)
    return out


# ── members ──────────────────────────────────────────────────────────────────


async def list_members(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor) -> dict:
    await require_role(db, ws, vendor, rules.READ_ROLES)
    rows = (await db.execute(
        select(EnterpriseMembership, Vendor)
        .join(Vendor, Vendor.id == EnterpriseMembership.vendor_id)
        .where(EnterpriseMembership.workspace_id == ws.id,
               EnterpriseMembership.status == "active")
        .order_by(EnterpriseMembership.created_at.asc())
    )).all()
    registrars = {}
    out = []
    for m, member_vendor in rows:
        registrar = None
        if m.registered_by_vendor_id:
            if m.registered_by_vendor_id not in registrars:
                registrars[m.registered_by_vendor_id] = await db.get(Vendor, m.registered_by_vendor_id)
            registrar = registrars[m.registered_by_vendor_id]
        out.append(membership_out(m, member_vendor, registrar))
    return {"workspace_id": str(ws.id), "members": out, "usage": await _usage(db, ws)}


async def add_member(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor, *,
                     handle: str, role: str) -> dict:
    actor = await require_role(db, ws, vendor, rules.FIELD_ROLES)
    role_clean = (role or "member").strip().lower()
    if role_clean not in ("admin", "field_officer", "member", "viewer"):
        raise rules.EnterpriseRuleError("role must be admin, field_officer, member or viewer", status=400)
    if role_clean == "admin" and actor.role not in rules.MANAGE_ROLES:
        raise rules.EnterpriseRuleError("Field officers cannot appoint admins", status=403)
    target = await _vendor_by_handle(db, handle)
    if await membership_of(db, ws.id, target.id):
        raise rules.EnterpriseRuleError(f"@{target.vendor_handle} is already a member", status=409)
    usage = await _usage(db, ws)
    spec = rules.plan_spec(ws.plan_key)
    if usage["members_used"] >= spec.max_members:
        raise rules.EnterpriseRuleError(
            f"Your {spec.name} plan includes {spec.max_members} members ({usage['members_used']} in use). "
            "Upgrade the workspace plan or revoke a membership first.", status=403)
    if role_clean == "field_officer" and usage["field_officers_used"] >= spec.max_field_officers:
        raise rules.EnterpriseRuleError(
            f"Your {spec.name} plan includes {spec.max_field_officers} field officers "
            f"({usage['field_officers_used']} in use).", status=403)
    existing = (await db.execute(
        select(EnterpriseMembership).where(
            EnterpriseMembership.workspace_id == ws.id,
            EnterpriseMembership.vendor_id == target.id)
    )).scalar_one_or_none()
    if existing:  # a previously revoked seat is reactivated, never duplicated
        existing.status, existing.role = "active", role_clean
        existing.registered_by_vendor_id, existing.revoked_at = vendor.id, None
        member = existing
    else:
        member = EnterpriseMembership(
            workspace_id=ws.id, vendor_id=target.id, role=role_clean,
            registered_by_vendor_id=vendor.id,
        )
        db.add(member)
    await db.commit()
    await db.refresh(member)
    return membership_out(member, target, vendor)


async def revoke_member(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor,
                        membership_id: UUID) -> dict:
    await require_role(db, ws, vendor, rules.MANAGE_ROLES)
    member = await db.get(EnterpriseMembership, membership_id)
    if member is None or member.workspace_id != ws.id or member.status != "active":
        raise rules.EnterpriseRuleError("Active membership not found", status=404)
    if member.role == "owner":
        raise rules.EnterpriseRuleError("The workspace owner cannot be revoked", status=400)
    member.status, member.revoked_at = "revoked", datetime.utcnow()
    await db.commit()
    return {"revoked": True, "membership_id": str(member.id), "usage": await _usage(db, ws)}


# ── devices & commands ───────────────────────────────────────────────────────


async def list_devices(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor) -> dict:
    await require_role(db, ws, vendor, rules.READ_ROLES)
    rows = (await db.execute(
        select(ManagedDevice).where(ManagedDevice.workspace_id == ws.id)
        .order_by(ManagedDevice.created_at.asc())
    )).scalars().all()
    out = []
    for d in rows:
        assignee = await db.get(Vendor, d.assigned_vendor_id) if d.assigned_vendor_id else None
        out.append(device_out(d, assignee))
    return {"workspace_id": str(ws.id), "devices": out, "usage": await _usage(db, ws)}


async def enrol_device(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor, *,
                       label: str, enrolment_mode: str, assigned_handle: Optional[str],
                       policy_name: Optional[str], device_ref: Optional[str]) -> dict:
    await require_role(db, ws, vendor, rules.FIELD_ROLES)
    mode = (enrolment_mode or "work_profile").strip().lower()
    if mode not in rules.COMMAND_MATRIX:
        raise rules.EnterpriseRuleError(
            f"enrolment_mode must be one of {', '.join(rules.COMMAND_MATRIX)}", status=400)
    if not (label or "").strip():
        raise rules.EnterpriseRuleError("Give the device a label (e.g. 'Field phone 1 — Achieng')", status=400)
    usage = await _usage(db, ws)
    spec = rules.plan_spec(ws.plan_key)
    if usage["devices_used"] >= spec.max_devices:
        raise rules.EnterpriseRuleError(
            f"Your {spec.name} plan includes {spec.max_devices} managed devices "
            f"({usage['devices_used']} in use). Retire a device or upgrade first.", status=403)
    assignee = await _vendor_by_handle(db, assigned_handle) if assigned_handle else None
    if assignee is not None and not await membership_of(db, ws.id, assignee.id):
        raise rules.EnterpriseRuleError(
            "The assigned vendor must be a workspace member first", status=400)
    device = ManagedDevice(
        workspace_id=ws.id,
        assigned_vendor_id=assignee.id if assignee else None,
        enrolled_by_vendor_id=vendor.id,
        label=label.strip(),
        device_ref=(device_ref or "").strip() or None,
        enrolment_mode=mode,
        status="enrolled",
        policy_name=(policy_name or "").strip() or None,
        enrolled_at=datetime.utcnow(),
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device_out(device, assignee)


async def request_command(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor,
                          device_id: UUID, *, command_type: str, reason: str) -> dict:
    """Record a remote-action request. Dispatch is the honest part: without
    a bound EMM (or with dispatch disabled in deployment config) the command
    stays `requested` and the response says so in words."""
    await require_role(db, ws, vendor, rules.MANAGE_ROLES)
    if not (reason or "").strip():
        raise rules.EnterpriseRuleError(
            "A reason is required — it is kept in the audit trail (e.g. 'Phone reported lost, 12 Oct')",
            status=400)
    device = await db.get(ManagedDevice, device_id)
    if device is None or device.workspace_id != ws.id:
        raise rules.EnterpriseRuleError("Device not found in this workspace", status=404)
    if device.status == "retired":
        raise rules.EnterpriseRuleError("That device is retired", status=400)
    cmd = (command_type or "").strip().lower()
    rules.require_command_allowed(device.enrolment_mode, cmd)

    bound = bool(ws.android_enterprise_id and (ws.emm_provider or "none") != "none")
    dispatch = bool(bound and settings.ENTERPRISE_DEVICE_COMMANDS_DISPATCH_ENABLED)
    now = datetime.utcnow()
    command = DeviceCommand(
        workspace_id=ws.id, device_id=device.id, command_type=cmd,
        enrolment_mode=device.enrolment_mode, reason=reason.strip(),
        requested_by_vendor_id=vendor.id,
        status="dispatched" if dispatch else "requested",
        dispatched=dispatch,
        dispatched_at=now if dispatch else None,
        result_note=(
            f"Sent to {ws.emm_provider} for delivery. Brief_ has not confirmed the "
            "device carried it out — check the EMM console for acknowledgement."
            if dispatch else
            "Recorded for audit. NOT sent to the device: no Android Enterprise / EMM "
            "is bound to this workspace (or dispatch is disabled in deployment config)."
        ),
    )
    db.add(command)
    if dispatch and cmd == "lock":
        device.status = "locked"
    await db.commit()
    await db.refresh(command)
    return command_out(command)


async def list_commands(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor,
                        device_id: Optional[UUID] = None) -> list[dict]:
    await require_role(db, ws, vendor, rules.READ_ROLES)
    stmt = select(DeviceCommand).where(DeviceCommand.workspace_id == ws.id)
    if device_id:
        stmt = stmt.where(DeviceCommand.device_id == device_id)
    rows = (await db.execute(stmt.order_by(DeviceCommand.created_at.desc()).limit(100))).scalars().all()
    return [command_out(c) for c in rows]


# ── dashboard ────────────────────────────────────────────────────────────────


async def dashboard(db: AsyncSession, ws: EnterpriseWorkspace, vendor: Vendor) -> dict:
    member = await require_role(db, ws, vendor, rules.READ_ROLES)
    usage = await _usage(db, ws)

    role_rows = (await db.execute(
        select(EnterpriseMembership.role, func.count()).where(
            EnterpriseMembership.workspace_id == ws.id,
            EnterpriseMembership.status == "active",
        ).group_by(EnterpriseMembership.role)
    )).all()
    device_rows = (await db.execute(
        select(ManagedDevice.status, func.count()).where(
            ManagedDevice.workspace_id == ws.id
        ).group_by(ManagedDevice.status)
    )).all()
    mode_rows = (await db.execute(
        select(ManagedDevice.enrolment_mode, func.count()).where(
            ManagedDevice.workspace_id == ws.id, ManagedDevice.status != "retired",
        ).group_by(ManagedDevice.enrolment_mode)
    )).all()

    # Field activity: registrations in the last 30 days, named per officer.
    since = datetime.utcnow() - timedelta(days=30)
    field_rows = (await db.execute(
        select(Vendor.vendor_handle, func.count())
        .join(EnterpriseMembership,
              EnterpriseMembership.registered_by_vendor_id == Vendor.id)
        .where(EnterpriseMembership.workspace_id == ws.id,
               EnterpriseMembership.created_at >= since,
               EnterpriseMembership.role != "owner")
        .group_by(Vendor.vendor_handle)
        .order_by(func.count().desc())
    )).all()
    pending = int((await db.execute(
        select(func.count()).select_from(DeviceCommand).where(
            DeviceCommand.workspace_id == ws.id,
            DeviceCommand.status == "requested",
        )
    )).scalar_one())

    out = workspace_out(ws, my_role=member.role)
    out["usage"] = usage
    out["dashboard"] = {
        "members_by_role": {r: int(c) for r, c in role_rows},
        "devices_by_status": {s: int(c) for s, c in device_rows},
        "devices_by_enrolment_mode": {m: int(c) for m, c in mode_rows},
        "field_registrations_last_30d": [
            {"officer_handle": handle, "registrations": int(count)} for handle, count in field_rows
        ],
        "field_registrations_total_30d": sum(int(c) for _, c in field_rows),
        "pending_device_commands": pending,
        "note": (
            "Field activity counts named registrations recorded in this workspace. "
            "It is a register an official can audit — not an officer ranking or score."
        ),
    }
    return out

"""HTTP adapter for enterprise workspaces & managed devices (v2.13).

    GET    /api/enterprise/plans                       workspace plans (KSh) + Android Enterprise guide
    POST   /api/enterprise/workspaces                  create a workspace (creator becomes owner)
    GET    /api/enterprise/workspaces                  workspaces I belong to
    GET    /api/enterprise/discover                    public workspaces (marketplace side)
    GET    /api/enterprise/workspaces/{id}             workspace detail (members)
    PUT    /api/enterprise/workspaces/{id}             settings / plan / Android binding (owner for binding)
    GET    /api/enterprise/workspaces/{id}/dashboard   member, device & field-activity counts
    GET    /api/enterprise/workspaces/{id}/members
    POST   /api/enterprise/workspaces/{id}/members     add by @handle (field officers may register members)
    DELETE /api/enterprise/workspaces/{id}/members/{membership_id}
    GET    /api/enterprise/workspaces/{id}/devices
    POST   /api/enterprise/workspaces/{id}/devices     enrol a managed Android device
    GET    /api/enterprise/workspaces/{id}/commands    command audit trail
    POST   /api/enterprise/workspaces/{id}/devices/{device_id}/commands
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.enterprise import rules, service
from app.routes.auth import get_current_vendor

router = APIRouter()


class WorkspaceCreateIn(BaseModel):
    name: str = Field(..., min_length=3, max_length=200)
    org_type: str = Field("trade_association", max_length=32)
    region: str = Field("Kisumu", max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    is_public: bool = False
    branding: Optional[dict] = None


class WorkspaceUpdateIn(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    region: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    is_public: Optional[bool] = None
    branding: Optional[dict] = None
    plan_key: Optional[str] = Field(None, max_length=24)
    android_enterprise_id: Optional[str] = Field(None, max_length=200)
    emm_provider: Optional[str] = Field(None, max_length=80)


class MemberAddIn(BaseModel):
    vendor_handle: str = Field(..., min_length=2, max_length=100)
    role: str = Field("member", max_length=24)


class DeviceEnrolIn(BaseModel):
    label: str = Field(..., min_length=2, max_length=200)
    enrolment_mode: str = Field("work_profile", max_length=24)
    assigned_handle: Optional[str] = Field(None, max_length=100)
    policy_name: Optional[str] = Field(None, max_length=200)
    device_ref: Optional[str] = Field(None, max_length=120)


class CommandIn(BaseModel):
    command_type: str = Field(..., max_length=24)
    reason: str = Field(..., min_length=3, max_length=2000)


def _err(exc: rules.EnterpriseRuleError) -> HTTPException:
    return HTTPException(exc.status, str(exc))


@router.get("/plans")
async def list_plans(vendor: Vendor = Depends(get_current_vendor)):
    """Workspace pricing in KSh and where Android Enterprise fits — the
    organisation buys the workspace; its members keep their own vendor
    plans on the public marketplace side."""
    return {
        "model": "both",
        "summary": (
            "One public marketplace (every member remains a discoverable vendor) "
            "connected to paid, private enterprise workspaces (this module)."
        ),
        "plans": [
            {
                "key": p.key, "name": p.name,
                "price_kes_monthly": p.price_kes_monthly, "price_kes_annual": p.price_kes_annual,
                "audience": p.audience, "max_members": p.max_members,
                "max_field_officers": p.max_field_officers, "max_devices": p.max_devices,
                "features": list(p.features),
            }
            for p in rules.WORKSPACE_PLANS.values()
        ],
        "android_enterprise": {
            "what_it_provides": [
                "Enrolment of Android phones as fully-managed, work-profile or dedicated devices",
                "App distribution and device policy through the organisation's EMM console",
                "Remote lock and company-data removal, subject to the enrolment mode",
            ],
            "what_it_does_not_provide": [
                "The vendor marketplace, stock, deals or job matching — those stay in Brief_",
                "A separate app: the workspace renders inside Brief_ for members and officers",
            ],
            "enrolment_modes": [
                {"mode": mode, "allowed_commands": list(cmds),
                 "note": rules.ENROLMENT_MODE_NOTES[mode].strip()}
                for mode, cmds in rules.COMMAND_MATRIX.items()
            ],
            "honesty_rule": (
                "A device command is only reported as dispatched when an EMM is bound "
                "to the workspace and dispatch is enabled. Otherwise it is an audited "
                "request that has not reached the phone."
            ),
        },
    }


@router.post("/workspaces", status_code=201)
async def create_workspace(body: WorkspaceCreateIn, vendor: Vendor = Depends(get_current_vendor),
                           db: AsyncSession = Depends(get_db)):
    try:
        return await service.create_workspace(
            db, vendor, name=body.name, org_type=body.org_type, region=body.region,
            description=body.description, is_public=body.is_public, branding=body.branding)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.get("/workspaces")
async def list_my_workspaces(vendor: Vendor = Depends(get_current_vendor),
                             db: AsyncSession = Depends(get_db)):
    return await service.my_workspaces(db, vendor)


@router.get("/discover")
async def discover(q: str = "", vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    return await service.discover_workspaces(db, vendor, q=q)


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        member = await service.require_role(db, ws, vendor, rules.READ_ROLES)
        out = service.workspace_out(ws, my_role=member.role)
        out["usage"] = await service._usage(db, ws)
        return out
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.put("/workspaces/{workspace_id}")
async def update_workspace(workspace_id: UUID, body: WorkspaceUpdateIn,
                           vendor: Vendor = Depends(get_current_vendor),
                           db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.update_workspace(
            db, ws, vendor, fields=body.model_dump(exclude_unset=True))
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.get("/workspaces/{workspace_id}/dashboard")
async def workspace_dashboard(workspace_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                              db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.dashboard(db, ws, vendor)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.get("/workspaces/{workspace_id}/members")
async def list_members(workspace_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.list_members(db, ws, vendor)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.post("/workspaces/{workspace_id}/members", status_code=201)
async def add_member(workspace_id: UUID, body: MemberAddIn,
                     vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.add_member(db, ws, vendor, handle=body.vendor_handle, role=body.role)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.delete("/workspaces/{workspace_id}/members/{membership_id}")
async def revoke_member(workspace_id: UUID, membership_id: UUID,
                        vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.revoke_member(db, ws, vendor, membership_id)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.get("/workspaces/{workspace_id}/devices")
async def list_devices(workspace_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.list_devices(db, ws, vendor)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.post("/workspaces/{workspace_id}/devices", status_code=201)
async def enrol_device(workspace_id: UUID, body: DeviceEnrolIn,
                       vendor: Vendor = Depends(get_current_vendor),
                       db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.enrol_device(
            db, ws, vendor, label=body.label, enrolment_mode=body.enrolment_mode,
            assigned_handle=body.assigned_handle, policy_name=body.policy_name,
            device_ref=body.device_ref)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.get("/workspaces/{workspace_id}/commands")
async def list_commands(workspace_id: UUID, vendor: Vendor = Depends(get_current_vendor),
                        db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.list_commands(db, ws, vendor)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)


@router.post("/workspaces/{workspace_id}/devices/{device_id}/commands", status_code=201)
async def request_command(workspace_id: UUID, device_id: UUID, body: CommandIn,
                          vendor: Vendor = Depends(get_current_vendor),
                          db: AsyncSession = Depends(get_db)):
    try:
        ws = await service.get_workspace(db, workspace_id)
        return await service.request_command(
            db, ws, vendor, device_id, command_type=body.command_type, reason=body.reason)
    except rules.EnterpriseRuleError as exc:
        raise _err(exc)

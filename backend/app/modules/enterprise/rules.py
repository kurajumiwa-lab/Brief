"""Enterprise workspace plans, role permissions and device-command rules (v2.13).

Three rules are enforced here, centrally, for the same reason the growth
module enforces its rules in code:

1. **Entitlements are server-side.** A workspace plan caps members, field
   officers and managed devices. The UI may hide a button; only this file
   decides whether the action happens.
2. **Remote actions respect the enrolment mode.** What Android Enterprise
   allows depends on how the device was enrolled — a work-profile phone
   can lose its *company data*, never its owner's personal data, so
   `wipe_device` on a work-profile device is refused whatever the plan.
3. **No EMM, no claim.** Brief_ is not an MDM. Until an organisation binds
   its Android Enterprise / EMM (`android_enterprise_id` + `emm_provider`)
   and dispatch is enabled in deployment config, a command is recorded
   as `requested` with `dispatched=False`. It is an audited request, and
   the API says exactly that — it never reports a lock or wipe that no
   system has carried out.
"""

from dataclasses import dataclass
from typing import Optional


class EnterpriseRuleError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class WorkspacePlan:
    key: str
    name: str
    price_kes_monthly: int
    price_kes_annual: Optional[int]
    audience: str
    max_members: int
    max_field_officers: int
    max_devices: int
    features: tuple[str, ...]


# Pricing extends the per-business ladder that already exists in
# modules/growth (Readiness KES 2,900 · Network KES 9,500 · Institution
# KES 90,000 per business/month). A workspace is bought once by the
# organisation; its members keep their own vendor plans.
WORKSPACE_PLANS: dict[str, WorkspacePlan] = {
    "pilot": WorkspacePlan(
        key="pilot",
        name="Kisumu Pilot",
        price_kes_monthly=0,
        price_kes_annual=0,
        audience="One association + a concentrated vendor group in one area, 90 days",
        max_members=25,
        max_field_officers=3,
        max_devices=5,
        features=(
            "Branded workspace inside Brief_ (name, colour, logo) — no separate app or website",
            "Member register: vendors the association has brought onto the network",
            "Field-officer registration tracking (who registered whom, as counts)",
            "Up to 5 managed devices on the register, commands audit-only until an EMM is bound",
        ),
    ),
    "association": WorkspacePlan(
        key="association",
        name="Association",
        price_kes_monthly=24500,
        price_kes_annual=245000,
        audience="Trade associations, cooperatives and SACCO-linked trader groups",
        max_members=200,
        max_field_officers=10,
        max_devices=30,
        features=(
            "Everything in Pilot, up to 200 members and 10 field officers",
            "Public workspace listing connected to the marketplace (members stay discoverable as vendors)",
            "Field activity dashboard: registrations per officer, device status, pending commands",
            "Managed-device register for up to 30 Android phones with enrolment-mode command rules",
        ),
    ),
    "enterprise": WorkspacePlan(
        key="enterprise",
        name="Enterprise / County",
        price_kes_monthly=145000,
        price_kes_annual=1450000,
        audience="County programmes, large employers and multi-branch organisations",
        max_members=2000,
        max_field_officers=100,
        max_devices=500,
        features=(
            "Everything in Association, up to 2,000 members and 500 managed devices",
            "Multiple admin seats and viewer (read-only auditor) roles",
            "Android Enterprise binding support: fully-managed, work-profile and dedicated devices",
            "Command audit export basis — every request, its enrolment mode and its dispatch state",
        ),
    ),
}

# Who may do what inside a workspace. The owner is a member with role
# `owner`; there is exactly one owner row per workspace at creation.
MANAGE_ROLES = ("owner", "admin")                    # settings, members, devices, commands
FIELD_ROLES = ("owner", "admin", "field_officer")    # register members, enrol devices
READ_ROLES = ("owner", "admin", "field_officer", "member", "viewer")

# Android Enterprise enrolment mode → commands that mode can honour.
# work_profile: the organisation owns only the work profile, so it may
# lock it and remove *company* data — wiping the whole device would erase
# the officer's personal data and is refused. fully_managed / dedicated:
# the organisation owns the device, so a full wipe is legitimate.
COMMAND_MATRIX: dict[str, tuple[str, ...]] = {
    "fully_managed": ("lock", "wipe_work_data", "wipe_device", "lost_mode"),
    "work_profile": ("lock", "wipe_work_data", "lost_mode"),
    "dedicated": ("lock", "wipe_work_data", "wipe_device", "lost_mode"),
}

ENROLMENT_MODE_NOTES = {
    "fully_managed": "Organisation-owned phone, fully managed. Lock and full wipe are available.",
    "work_profile": "Officer's own phone with a work profile. Only the work profile can be locked or removed — personal data is untouchable.",
    "dedicated": "Organisation-owned device locked to work use (kiosk/field kit). Lock and full wipe are available.",
}


def plan_spec(key: Optional[str]) -> WorkspacePlan:
    return WORKSPACE_PLANS.get((key or "pilot").strip().lower(), WORKSPACE_PLANS["pilot"])


def allowed_commands(enrolment_mode: str) -> tuple[str, ...]:
    return COMMAND_MATRIX.get(enrolment_mode, ())


def require_command_allowed(enrolment_mode: str, command_type: str) -> None:
    cmd = (command_type or "").strip().lower()
    mode = (enrolment_mode or "").strip().lower()
    if mode not in COMMAND_MATRIX:
        raise EnterpriseRuleError(f"Unknown enrolment mode '{enrolment_mode}'", status=400)
    if cmd not in ("lock", "wipe_work_data", "wipe_device", "lost_mode"):
        raise EnterpriseRuleError(f"Unknown device command '{command_type}'", status=400)
    if cmd not in COMMAND_MATRIX[mode]:
        raise EnterpriseRuleError(
            f"'{cmd}' is not available on a {mode.replace('_', ' ')} device. "
            + ENROLMENT_MODE_NOTES[mode].strip(),
            status=400,
        )

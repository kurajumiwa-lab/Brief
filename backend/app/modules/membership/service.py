"""Membership rules: profiles, verification, suspension, directory and audit."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.membership import rules
from app.modules.membership.models import MemberProfile, MembershipEvent


class MembershipError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


async def _profile(db: AsyncSession, vendor: Vendor) -> Optional[MemberProfile]:
    return (await db.execute(
        select(MemberProfile).where(MemberProfile.vendor_id == vendor.id)
    )).scalar_one_or_none()


async def get_or_create_profile(db: AsyncSession, vendor: Vendor) -> MemberProfile:
    profile = await _profile(db, vendor)
    if profile is None:
        profile = MemberProfile(
            vendor_id=vendor.id,
            display_name=vendor.business_name,
            directory_visible=rules.DEFAULT_PRIVACY["directory_visible"],
            show_contact=rules.DEFAULT_PRIVACY["show_contact"],
        )
        db.add(profile)
        await db.flush()
        _event(db, vendor.id, vendor.vendor_handle, "profile_created", None, _snapshot(profile))
    return profile


def _snapshot(p: MemberProfile) -> dict:
    return {
        "display_name": p.display_name,
        "category": p.category,
        "professional_class": p.professional_class,
        "membership_status": p.membership_status,
        "verification_status": p.verification_status,
        "directory_visible": p.directory_visible,
        "show_contact": p.show_contact,
    }


def _event(db: AsyncSession, vendor_id, actor: str, action: str,
           before: Optional[dict], after: Optional[dict], note: Optional[str] = None) -> None:
    db.add(MembershipEvent(vendor_id=vendor_id, actor=actor, action=action,
                           before=before, after=after, note=note))


def profile_out(p: MemberProfile, vendor: Vendor) -> dict:
    return {
        "vendor_id": str(vendor.id),
        "handle": vendor.vendor_handle,
        "business_name": vendor.business_name,
        "display_name": p.display_name,
        "category": p.category,
        "professional_class": p.professional_class,
        "bio": p.bio,
        "membership_status": p.membership_status,
        "verification_status": p.verification_status,
        "verified": p.verification_status == "verified",
        "verified_at": p.verified_at.isoformat() if p.verified_at else None,
        "directory_visible": p.directory_visible,
        "show_contact": p.show_contact,
        "fees": "none",  # free for now
    }


async def update_profile(db: AsyncSession, vendor: Vendor, changes: dict) -> MemberProfile:
    profile = await get_or_create_profile(db, vendor)
    if profile.membership_status == "suspended":
        raise MembershipError("Your membership is suspended. Contact the platform team.", 403)
    unknown = set(changes) - set(rules.MEMBER_EDITABLE)
    if unknown:
        raise MembershipError(f"These fields cannot be changed here: {', '.join(sorted(unknown))}", 400)
    if "category" in changes and changes["category"] not in (None, *rules.CATEGORY_KEYS):
        raise MembershipError("Unknown membership category.", 400)
    before = _snapshot(profile)
    for key, value in changes.items():
        setattr(profile, key, value)
    profile.updated_at = datetime.utcnow()
    await db.flush()
    after = _snapshot(profile)
    if before != after:
        _event(db, vendor.id, vendor.vendor_handle, "profile_updated", before, after)
    return profile


async def request_verification(db: AsyncSession, vendor: Vendor) -> MemberProfile:
    profile = await get_or_create_profile(db, vendor)
    if profile.membership_status == "suspended":
        raise MembershipError("Your membership is suspended. Contact the platform team.", 403)
    if profile.verification_status == "verified":
        raise MembershipError("You are already verified.", 409)
    if profile.verification_status == "pending":
        raise MembershipError("Your verification request is already waiting for review.", 409)
    before = _snapshot(profile)
    profile.verification_status = "pending"
    profile.updated_at = datetime.utcnow()
    await db.flush()
    _event(db, vendor.id, vendor.vendor_handle, "verification_requested", before, _snapshot(profile))
    return profile


async def _target(db: AsyncSession, vendor_id: uuid.UUID) -> tuple[Vendor, MemberProfile]:
    vendor = await db.get(Vendor, vendor_id)
    if vendor is None:
        raise MembershipError("Member not found.", 404)
    profile = await get_or_create_profile(db, vendor)
    return vendor, profile


async def decide_verification(db: AsyncSession, operator: Vendor, vendor_id: uuid.UUID,
                              decision: str, note: Optional[str] = None) -> MemberProfile:
    if decision not in ("approve", "reject"):
        raise MembershipError("Decision must be approve or reject.", 400)
    vendor, profile = await _target(db, vendor_id)
    if profile.verification_status != "pending":
        raise MembershipError("There is no pending verification request for this member.", 409)
    before = _snapshot(profile)
    if decision == "approve":
        profile.verification_status = "verified"
        profile.verified_at = datetime.utcnow()
        profile.verified_by = operator.vendor_handle
    else:
        profile.verification_status = "rejected"
        profile.verified_at = None
        profile.verified_by = None
    profile.updated_at = datetime.utcnow()
    await db.flush()
    _event(db, vendor.id, operator.vendor_handle,
           "verification_approved" if decision == "approve" else "verification_rejected",
           before, _snapshot(profile), note)
    return profile


async def set_membership_status(db: AsyncSession, operator: Vendor, vendor_id: uuid.UUID,
                                status: str, note: Optional[str] = None) -> MemberProfile:
    if status not in rules.MEMBERSHIP_STATUSES:
        raise MembershipError("Status must be active or suspended.", 400)
    vendor, profile = await _target(db, vendor_id)
    if profile.membership_status == status:
        raise MembershipError(f"This membership is already {status}.", 409)
    before = _snapshot(profile)
    profile.membership_status = status
    profile.updated_at = datetime.utcnow()
    await db.flush()
    _event(db, vendor.id, operator.vendor_handle,
           "membership_suspended" if status == "suspended" else "membership_reinstated",
           before, _snapshot(profile), note)
    return profile


async def member_events(db: AsyncSession, vendor_id: uuid.UUID) -> list[dict]:
    rows = (await db.execute(
        select(MembershipEvent).where(MembershipEvent.vendor_id == vendor_id)
        .order_by(MembershipEvent.created_at.desc()).limit(200)
    )).scalars().all()
    return [{
        "action": r.action, "actor": r.actor, "before": r.before, "after": r.after,
        "note": r.note, "at": r.created_at.isoformat(),
    } for r in rows]


async def search_directory(db: AsyncSession, *, q: Optional[str] = None,
                           category: Optional[str] = None, verified_only: bool = False) -> list[dict]:
    """Only members who opted in, who are active. Private fields are never returned."""
    stmt = (
        select(MemberProfile, Vendor)
        .join(Vendor, Vendor.id == MemberProfile.vendor_id)
        .where(MemberProfile.directory_visible.is_(True))
        .where(MemberProfile.membership_status == "active")
    )
    if category:
        if category not in rules.CATEGORY_KEYS:
            raise MembershipError("Unknown membership category.", 400)
        stmt = stmt.where(MemberProfile.category == category)
    if verified_only:
        stmt = stmt.where(MemberProfile.verification_status == "verified")
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            MemberProfile.display_name.ilike(term),
            MemberProfile.professional_class.ilike(term),
            MemberProfile.bio.ilike(term),
        ))
    rows = (await db.execute(stmt.order_by(MemberProfile.display_name).limit(rules.DIRECTORY_LIMIT))).all()
    out = []
    for p, v in rows:
        item = {
            "vendor_id": str(v.id),
            "handle": v.vendor_handle,
            "display_name": p.display_name or v.business_name,
            "category": p.category,
            "professional_class": p.professional_class,
            "bio": p.bio,
            "verified": p.verification_status == "verified",
        }
        if p.show_contact:
            item["contact_phone"] = v.phone
        out.append(item)
    return out


async def admin_queue(db: AsyncSession, status: Optional[str] = None) -> list[dict]:
    stmt = select(MemberProfile, Vendor).join(Vendor, Vendor.id == MemberProfile.vendor_id)
    if status:
        stmt = stmt.where(MemberProfile.verification_status == status)
    rows = (await db.execute(stmt.order_by(MemberProfile.updated_at.desc()).limit(200))).all()
    return [profile_out(p, v) for p, v in rows]

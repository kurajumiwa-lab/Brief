"""Fluid Teams: partner teams between two home offices (Phase 7, PR 3).

Rules, enforced here on the server:
- Only an owner of an active office may invite another office, or answer an invite to theirs.
- An office cannot partner with itself, and a pair of offices has at most one link.
- Either owner may end an active link. A declined or removed link can be invited again.
- A partner link shares no money and no data. It only says the two teams work together.
- The link is what the rating team block reads: members of partnered offices cannot rate each other.

The whole feature is off unless FLUID_TEAMS_ENABLED is on (the router enforces that).
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.office.models import Office, OfficeMember, OfficePartner
from app.modules.office.service import OfficeError, get_office
from app.modules.trust.service import audit


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _owner_of(db: AsyncSession, office_id: uuid.UUID, vendor: Vendor) -> Office:
    """The office, if this vendor is its active owner. Anyone else is refused."""
    office = await get_office(db, office_id)
    m = (await db.execute(select(OfficeMember).where(
        OfficeMember.office_id == office_id, OfficeMember.vendor_id == vendor.id,
        OfficeMember.status == "active", OfficeMember.role == "owner",
    ))).scalar_one_or_none()
    if m is None:
        raise OfficeError("Only the owner of this office can change its partner teams.", 403)
    return office


async def _link_between(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> Optional[OfficePartner]:
    return (await db.execute(select(OfficePartner).where(or_(
        and_(OfficePartner.office_id == a, OfficePartner.partner_office_id == b),
        and_(OfficePartner.office_id == b, OfficePartner.partner_office_id == a),
    )))).scalar_one_or_none()


async def invite_partner(db: AsyncSession, actor: Vendor, office_id: uuid.UUID,
                         partner_office_id: uuid.UUID) -> OfficePartner:
    if office_id == partner_office_id:
        raise OfficeError("An office cannot be a partner of itself.", 422)
    await _owner_of(db, office_id, actor)
    await get_office(db, partner_office_id)   # the other office must exist and be active
    existing = await _link_between(db, office_id, partner_office_id)
    if existing is not None:
        if existing.status == "active":
            raise OfficeError("These two offices are already partner teams.", 409)
        if existing.status == "invited":
            raise OfficeError("A partner invite between these offices is already waiting.", 409)
        # declined or removed: the invite is sent again, from the office that asks now
        existing.office_id, existing.partner_office_id = office_id, partner_office_id
        existing.status = "invited"
        existing.invited_by_vendor_id = actor.id
        existing.responded_by_vendor_id = None
        existing.responded_at = None
        existing.updated_at = _now()
        row = existing
    else:
        row = OfficePartner(office_id=office_id, partner_office_id=partner_office_id, status="invited",
                            invited_by_vendor_id=actor.id, created_at=_now(), updated_at=_now())
        db.add(row)
    await db.flush()
    await audit(db, actor, "office_partner_invited", "office", office_id, None,
                {"partner_office_id": str(partner_office_id)})
    return row


async def respond_partner(db: AsyncSession, actor: Vendor, link_id: uuid.UUID, accept: bool) -> OfficePartner:
    row = await db.get(OfficePartner, link_id)
    if row is None:
        raise OfficeError("That partner invite was not found.", 404)
    if row.status != "invited":
        raise OfficeError("That partner invite has already been answered.", 409)
    # Only the invited side (the other office's owner) may answer.
    await _owner_of(db, row.partner_office_id, actor)
    row.status = "active" if accept else "declined"
    row.responded_by_vendor_id = actor.id
    row.responded_at = _now()
    row.updated_at = _now()
    await db.flush()
    await audit(db, actor, "office_partner_answered", "office", row.partner_office_id, None,
                {"accepted": accept, "office_id": str(row.office_id)})
    return row


async def end_partner(db: AsyncSession, actor: Vendor, link_id: uuid.UUID) -> OfficePartner:
    row = await db.get(OfficePartner, link_id)
    if row is None or row.status == "removed":
        raise OfficeError("That partner link was not found.", 404)
    try:
        await _owner_of(db, row.office_id, actor)
    except OfficeError:
        await _owner_of(db, row.partner_office_id, actor)   # the other owner may end it too
    row.status = "removed"
    row.updated_at = _now()
    await db.flush()
    await audit(db, actor, "office_partner_ended", "office", row.office_id, None,
                {"partner_office_id": str(row.partner_office_id)})
    return row


async def list_partners(db: AsyncSession, actor: Vendor, office_id: uuid.UUID) -> dict:
    """Partner links for an office the actor belongs to: pending in both directions, plus active."""
    m = (await db.execute(select(OfficeMember.id).where(
        OfficeMember.office_id == office_id, OfficeMember.vendor_id == actor.id,
        OfficeMember.status == "active",
    ))).scalar_one_or_none()
    if m is None:
        raise OfficeError("You are not a member of this office.", 403)
    rows = (await db.execute(select(OfficePartner).where(
        OfficePartner.status.in_(("invited", "active")),
        or_(OfficePartner.office_id == office_id, OfficePartner.partner_office_id == office_id),
    ))).scalars().all()
    return {"office_id": str(office_id), "partners": [
        {"link_id": str(r.id), "status": r.status,
         "direction": "sent" if r.office_id == office_id else "received",
         "other_office_id": str(r.partner_office_id if r.office_id == office_id else r.office_id)}
        for r in rows
    ]}


async def partnered(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    """True when two offices are active partner teams. Read by the rating team block."""
    row = await _link_between(db, a, b)
    return row is not None and row.status == "active"

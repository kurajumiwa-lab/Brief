"""Home office rules. Authorisation is enforced here, on the server, not only in the app.

Who can do what:
- owner: everything, including inviting, removing members and removing the office;
- editor: adds calendar events and invites people as staff, partner or member;
- approver, member, partner, staff: read the office and its calendar once active;
- anyone: reads the public summary, which shows contact details only if the owner chose them.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.office.models import CONTACT_MODES, ROLES, Office, OfficeEvent, OfficeMember
from app.modules.trust.service import audit

LINK_TTL = timedelta(days=7)
WRITE_ROLES = ("owner", "editor")
INVITE_ROLES = ("editor", "approver", "member", "partner", "staff")   # owner is never granted by invite


class OfficeError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    """Timezone-aware UTC. Every stored timestamp is timestamptz."""
    return datetime.now(timezone.utc)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.strip().encode()).hexdigest()


def _text(value: Optional[str], low: int, high: int, what: str, *, required: bool = True) -> Optional[str]:
    v = (value or "").strip()
    if not v:
        if required:
            raise OfficeError(f"Enter {what}.", 422)
        return None
    if not low <= len(v) <= high:
        raise OfficeError(f"{what.capitalize()} must be {low} to {high} characters.", 422)
    return v


def _as_utc(dt: datetime) -> datetime:
    """A naive datetime is taken as UTC (what the calendar page sends); an aware one is converted."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def get_office(db: AsyncSession, office_id: uuid.UUID) -> Office:
    office = await db.get(Office, office_id)
    if office is None or office.status != "active":
        raise OfficeError("That office was not found.", 404)
    return office


async def membership(db: AsyncSession, office_id: uuid.UUID, vendor_id: uuid.UUID) -> Optional[OfficeMember]:
    return (await db.execute(select(OfficeMember).where(
        OfficeMember.office_id == office_id, OfficeMember.vendor_id == vendor_id,
    ))).scalar_one_or_none()


async def require_active(db: AsyncSession, office_id: uuid.UUID, vendor: Vendor,
                         allowed: Optional[tuple] = None) -> OfficeMember:
    m = await membership(db, office_id, vendor.id)
    if m is None or m.status != "active":
        raise OfficeError("You are not a member of this office.", 403)
    if allowed is not None and m.role not in allowed:
        raise OfficeError("Your role in this office does not allow that.", 403)
    return m


# ── offices ───────────────────────────────────────────────────────────────────

async def create_office(db: AsyncSession, owner: Vendor, *, name: str, nature: str, area: str,
                        hours_text: Optional[str], contact_mode: str) -> Office:
    if contact_mode not in CONTACT_MODES:
        raise OfficeError("Choose how people may contact the office: none, phone or email.", 422)
    office = Office(
        owner_vendor_id=owner.id,
        name=_text(name, 2, 120, "the office name"),
        nature=_text(nature, 2, 120, "what the office does"),
        area=_text(area, 2, 120, "the area it works in"),
        hours_text=_text(hours_text, 2, 200, "opening hours", required=False),
        contact_mode=contact_mode,
        status="active",
        created_at=_now(), updated_at=_now(),
    )
    db.add(office)
    await db.flush()
    db.add(OfficeMember(office_id=office.id, vendor_id=owner.id, role="owner", status="active",
                        created_at=_now(), responded_at=_now(), invited_by_vendor_id=owner.id))
    await db.flush()
    await audit(db, owner, "office_created", "office", office.id, None, {"name": office.name})
    return office


VISIBILITIES = ("private", "public")


async def set_visibility(db: AsyncSession, actor: Vendor, office_id: uuid.UUID, visibility: str) -> Office:
    """Open or close an office's public front door. Owner only; always audited."""
    if visibility not in VISIBILITIES:
        raise OfficeError("Visibility must be private or public.", 422)
    office = await get_office(db, office_id)
    await require_active(db, office_id, actor, ("owner",))
    before = office.visibility
    office.visibility = visibility
    office.updated_at = _now()
    await db.flush()
    await audit(db, actor, "office_visibility_changed", "office", office.id, None,
                {"from": before, "to": visibility})
    return office


async def ensure_home_office(db: AsyncSession, vendor: Vendor) -> Optional[Office]:
    """Rule 3: every person gets a private home office. Created once, never duplicated.

    Uses the same creation path as an office made by hand, so the owner membership and the
    audit event are identical. If the person already owns an active office, nothing is added.
    Name and area fall back to safe placeholders, which are private until the owner edits them.
    """
    existing = (await db.execute(
        select(Office.id).join(OfficeMember, OfficeMember.office_id == Office.id).where(
            OfficeMember.vendor_id == vendor.id, OfficeMember.role == "owner",
            OfficeMember.status == "active", Office.status == "active",
        ).limit(1)
    )).first()
    if existing:
        return None
    name = (vendor.business_name or "").strip()[:120]
    if len(name) < 2:
        name = "Home office"
    # Never copy physical_location: it may be an exact address, and the office area is public
    # once the owner opens it. The owner sets a general area deliberately.
    area = "Not set yet"
    return await create_office(db, vendor, name=name, nature="Personal", area=area,
                               hours_text=None, contact_mode="none")


async def my_offices(db: AsyncSession, vendor: Vendor) -> list[dict]:
    rows = (await db.execute(
        select(Office, OfficeMember.role).join(OfficeMember, OfficeMember.office_id == Office.id)
        .where(OfficeMember.vendor_id == vendor.id, OfficeMember.status == "active", Office.status == "active")
        .order_by(Office.created_at)
    )).all()
    return [office_summary(o, role) for o, role in rows]


def office_summary(o: Office, role: Optional[str] = None) -> dict:
    return {"id": str(o.id), "name": o.name, "nature": o.nature, "area": o.area,
            "hours_text": o.hours_text, "contact_mode": o.contact_mode, "my_role": role,
            "visibility": o.visibility}


async def public_office(db: AsyncSession, office_id: uuid.UUID) -> dict:
    office = await get_office(db, office_id)
    if office.visibility != "public":
        # A private office is indistinguishable from a missing one: no name, no area, no hint.
        raise OfficeError("That office was not found.", 404)
    contact = None
    if office.contact_mode != "none":
        owner = await db.get(Vendor, office.owner_vendor_id)
        if office.contact_mode == "phone" and owner and owner.phone:
            contact = {"phone": owner.phone}
        if office.contact_mode == "email" and owner and owner.email:
            contact = {"email": owner.email}
    return {**office_summary(office), "contact": contact}


# ── members and invites ───────────────────────────────────────────────────────

async def members_of(db: AsyncSession, office_id: uuid.UUID) -> list[dict]:
    rows = (await db.execute(
        select(OfficeMember).where(OfficeMember.office_id == office_id, OfficeMember.status != "removed")
        .order_by(OfficeMember.created_at)
    )).scalars().all()
    out = []
    for m in rows:
        name = m.display_name
        if m.vendor_id:
            v = await db.get(Vendor, m.vendor_id)
            name = v.business_name if v else "Member"
        out.append({"id": str(m.id), "name": name, "role": m.role, "status": m.status,
                    "function_label": m.function_label, "registered": m.vendor_id is not None})
    return out


async def invite_account(db: AsyncSession, actor: Vendor, office_id: uuid.UUID, *, handle: str, role: str) -> OfficeMember:
    await get_office(db, office_id)
    await require_active(db, office_id, actor, WRITE_ROLES)
    if role not in INVITE_ROLES:
        raise OfficeError("Choose a role you can invite: editor, approver, member, partner or staff.", 422)
    invitee = (await db.execute(select(Vendor).where(Vendor.vendor_handle == handle.strip().lower()))).scalar_one_or_none()
    if invitee is None:
        raise OfficeError("No registered profile has that handle.", 404)
    existing = await membership(db, office_id, invitee.id)
    if existing and existing.status != "removed":
        raise OfficeError("That profile is already in this office or invited.", 409)
    if existing:
        existing.status, existing.role, existing.responded_at = "invited", role, None
        existing.invited_by_vendor_id = actor.id
        m = existing
    else:
        m = OfficeMember(office_id=office_id, vendor_id=invitee.id, role=role, status="invited",
                         invited_by_vendor_id=actor.id, created_at=_now())
        db.add(m)
    await db.flush()
    await audit(db, actor, "member_invited", "office", office_id, None, {"role": role, "account": True})
    return m


async def create_link(db: AsyncSession, actor: Vendor, office_id: uuid.UUID, *, role: str,
                      function_label: str) -> tuple[str, datetime]:
    """A single-use link for someone without an account. Only its hash is stored."""
    await get_office(db, office_id)
    await require_active(db, office_id, actor, WRITE_ROLES)
    if role not in INVITE_ROLES:
        raise OfficeError("Choose a role you can invite: editor, approver, member, partner or staff.", 422)
    label = _text(function_label, 2, 80, "their function (for example 'home visits')")
    token = secrets.token_urlsafe(24)
    expires = _now() + LINK_TTL
    db.add(OfficeMember(office_id=office_id, display_name=None, function_label=label, role=role,
                        status="invited", invite_token_hash=hash_token(token), invite_expires_at=expires,
                        invited_by_vendor_id=actor.id, created_at=_now()))
    await db.flush()
    await audit(db, actor, "link_created", "office", office_id, None, {"role": role, "function": label})
    return token, expires


async def accept_link(db: AsyncSession, token: str, display_name: str) -> dict:
    """Used once. The person needs no account. Their name is shown to the team.

    The consume step is one conditional UPDATE, so two requests racing with the same
    link cannot both succeed: only the row still in 'invited' state, unexpired, and
    holding this token's hash is changed. The hash is cleared in the same statement.
    """
    name = _text(display_name, 2, 60, "your name")
    h = hash_token(token)
    m = (await db.execute(select(OfficeMember).where(OfficeMember.invite_token_hash == h))).scalar_one_or_none()
    if m is None or m.status != "invited" or m.vendor_id is not None:
        raise OfficeError("This link is not valid any more.", 404)
    if m.invite_expires_at and m.invite_expires_at < _now():
        raise OfficeError("This link has expired. Ask the team for a new one.", 410)
    now = _now()
    res = await db.execute(
        update(OfficeMember)
        .where(OfficeMember.id == m.id, OfficeMember.invite_token_hash == h,
               OfficeMember.status == "invited", OfficeMember.vendor_id.is_(None),
               or_(OfficeMember.invite_expires_at.is_(None), OfficeMember.invite_expires_at >= now))
        .values(display_name=name, status="active", responded_at=now,
                invite_token_hash=None, invite_expires_at=None)
        .returning(OfficeMember.office_id, OfficeMember.role)
    )
    row = res.first()
    if row is None:  # lost the race, or already used
        raise OfficeError("This link is not valid any more.", 404)
    await db.flush()
    await audit(db, None, "link_accepted", "office", row.office_id, None, {"role": row.role})
    return {"office_id": str(row.office_id), "role": row.role}


async def respond_invite(db: AsyncSession, vendor: Vendor, office_id: uuid.UUID, *, accept: bool) -> dict:
    m = await membership(db, office_id, vendor.id)
    if m is None or m.status != "invited":
        raise OfficeError("You have no pending invite to this office.", 404)
    m.status = "active" if accept else "removed"
    m.responded_at = _now()
    m.invite_token_hash, m.invite_expires_at = None, None   # no credential survives an answer
    await db.flush()
    await audit(db, vendor, "invite_accepted" if accept else "invite_declined", "office", office_id, None, {})
    return {"office_id": str(office_id), "status": m.status}


async def remove_member(db: AsyncSession, actor: Vendor, office_id: uuid.UUID, member_id: uuid.UUID) -> None:
    await get_office(db, office_id)
    await require_active(db, office_id, actor, ("owner",))
    m = await db.get(OfficeMember, member_id)
    if m is None or m.office_id != office_id or m.status == "removed":
        raise OfficeError("That member was not found.", 404)
    if m.role == "owner":
        # One active owner per office is a database rule. Ownership transfer is not built yet,
        # so the owner row can't be removed at all.
        raise OfficeError("The owner cannot be removed from their own office.", 409)
    m.status = "removed"
    m.responded_at = _now()
    m.invite_token_hash, m.invite_expires_at = None, None   # a removed member keeps no credential
    await db.flush()
    await audit(db, actor, "member_removed", "office", office_id, None, {"role": m.role})


# ── calendar ──────────────────────────────────────────────────────────────────

async def add_event(db: AsyncSession, actor: Vendor, office_id: uuid.UUID, *, activity: str, title: str,
                    starts_at: datetime, ends_at: datetime, location_text: Optional[str]) -> OfficeEvent:
    await get_office(db, office_id)
    await require_active(db, office_id, actor, WRITE_ROLES)
    s, e = _as_utc(starts_at), _as_utc(ends_at)
    if e <= s:
        raise OfficeError("The event must end after it starts.", 422)
    ev = OfficeEvent(office_id=office_id, activity=_text(activity, 2, 80, "the activity"),
                     title=_text(title, 2, 160, "the event title"), starts_at=s, ends_at=e,
                     location_text=_text(location_text, 2, 200, "the place", required=False),
                     created_by_vendor_id=actor.id, created_at=_now())
    db.add(ev)
    await db.flush()
    await audit(db, actor, "event_added", "office", office_id, None, {"event_id": str(ev.id)})
    return ev


async def events_of(db: AsyncSession, actor: Vendor, office_id: uuid.UUID) -> list[OfficeEvent]:
    await get_office(db, office_id)
    await require_active(db, office_id, actor)
    rows = (await db.execute(select(OfficeEvent).where(OfficeEvent.office_id == office_id)
                             .order_by(OfficeEvent.starts_at).limit(500))).scalars().all()
    return list(rows)


def ics_for(office: Office, events: list[OfficeEvent]) -> str:
    """A plain calendar file (RFC 5545) that Google Calendar, Outlook and Apple import."""
    def esc(s: str) -> str:
        return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

    def stamp(dt: datetime) -> str:
        return _as_utc(dt).strftime("%Y%m%dT%H%M%SZ")

    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Brief//Home office//EN", "CALSCALE:GREGORIAN"]
    for ev in events:
        lines += [
            "BEGIN:VEVENT",
            f"UID:{ev.id}@brief",
            f"DTSTAMP:{stamp(_now())}",
            f"DTSTART:{stamp(ev.starts_at)}",
            f"DTEND:{stamp(ev.ends_at)}",
            f"SUMMARY:{esc(ev.title)}",
            f"CATEGORIES:{esc(ev.activity)}",
        ]
        if ev.location_text:
            lines.append(f"LOCATION:{esc(ev.location_text)}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"

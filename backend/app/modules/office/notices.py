"""Home office noticeboard rules (Fluid Teams, PR 4). Authorisation is enforced here, on the server.

- Any active member reads the board.
- Owners and editors post, edit any post, and delete any post.
- An author may also edit their own post. Nobody else may.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.office.models import NOTE_COLOURS, NOTE_KINDS, OfficeMember, OfficeNotice
from app.modules.office.service import OfficeError, _text, get_office

EDIT_ROLES = ("owner", "editor")


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _member(db: AsyncSession, office_id: uuid.UUID, vendor: Vendor) -> OfficeMember:
    m = (await db.execute(select(OfficeMember).where(
        OfficeMember.office_id == office_id, OfficeMember.vendor_id == vendor.id,
        OfficeMember.status == "active",
    ))).scalar_one_or_none()
    if m is None:
        raise OfficeError("You are not a member of this office.", 403)
    return m


async def list_notices(db: AsyncSession, actor: Vendor, office_id: uuid.UUID) -> list:
    """The board: live notes first, pinned above the rest, expired ones gone.

    An expired sticky is not deleted — the row stays for the author — but the
    board stops showing it, which is what a non-permanent marker means.
    """
    await get_office(db, office_id)
    await _member(db, office_id, actor)
    now = _now()
    rows = (await db.execute(
        select(OfficeNotice).where(
            OfficeNotice.office_id == office_id,
            (OfficeNotice.expires_at.is_(None)) | (OfficeNotice.expires_at > now),
        ).order_by(OfficeNotice.pinned.desc(), OfficeNotice.created_at.desc())
    )).scalars().all()
    return rows


async def create_notice(db: AsyncSession, actor: Vendor, office_id: uuid.UUID,
                        *, title: str, body: str, kind: str = "notice",
                        colour: str = "plain", pinned: bool = False,
                        expires_at: Optional[datetime] = None) -> OfficeNotice:
    await get_office(db, office_id)
    m = await _member(db, office_id, actor)
    if m.role not in EDIT_ROLES:
        raise OfficeError("Only the owner or an editor can post to the noticeboard.", 403)
    if kind not in NOTE_KINDS:
        raise OfficeError("A board post is a notice or a sticky note.", 422)
    if colour not in NOTE_COLOURS:
        raise OfficeError("Choose one of the board colours.", 422)
    if expires_at is not None and expires_at <= _now():
        raise OfficeError("A note cannot expire in the past. Leave it blank to keep it.", 422)
    row = OfficeNotice(
        office_id=office_id, author_vendor_id=actor.id,
        title=_text(title, 2, 120, "the notice title"),
        body=_text(body, 2, 4000, "the notice text"),
        kind=kind, colour=colour, pinned=bool(pinned), expires_at=expires_at,
        created_at=_now(), updated_at=_now(),
    )
    db.add(row)
    await db.flush()
    return row


async def _notice_for_write(db: AsyncSession, actor: Vendor, office_id: uuid.UUID,
                            notice_id: uuid.UUID, *, author_may_edit: bool) -> OfficeNotice:
    await get_office(db, office_id)
    m = await _member(db, office_id, actor)
    row = await db.get(OfficeNotice, notice_id)
    if row is None or row.office_id != office_id:
        raise OfficeError("That notice was not found.", 404)
    is_author = author_may_edit and row.author_vendor_id == actor.id
    if m.role not in EDIT_ROLES and not is_author:
        raise OfficeError("Only the owner, an editor, or the author can change this notice.", 403)
    return row


async def edit_notice(db: AsyncSession, actor: Vendor, office_id: uuid.UUID, notice_id: uuid.UUID,
                      *, title: Optional[str], body: Optional[str]) -> OfficeNotice:
    row = await _notice_for_write(db, actor, office_id, notice_id, author_may_edit=True)
    if title is not None:
        row.title = _text(title, 2, 120, "the notice title")
    if body is not None:
        row.body = _text(body, 2, 4000, "the notice text")
    row.edited_at = _now()
    row.updated_at = _now()
    await db.flush()
    return row


async def delete_notice(db: AsyncSession, actor: Vendor, office_id: uuid.UUID, notice_id: uuid.UUID) -> None:
    row = await _notice_for_write(db, actor, office_id, notice_id, author_may_edit=True)
    await db.delete(row)
    await db.flush()

"""Workers: assign work to active office members, with scoped access and a history.

Who may do what (each rule is checked on every request, against the current membership):

    owner / editor of the office   create, reassign, cancel, see all of the office's work, read history
    the assignee, while still an ACTIVE member   see their own work, start it, complete it, read its history
    anyone else                    nothing. A missing or foreign assignment is reported as not found.

A removed or merely invited member loses worker access at once, even for work already assigned.
An editor who is downgraded loses manager access at once. History is the existing audit trail.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.office.models import Office, OfficeMember
from app.modules.office.service import WRITE_ROLES, membership, require_active, OfficeError
from app.modules.trust.models import AuditEvent
from app.modules.trust.service import audit
from app.modules.workers.models import OPEN_STATUSES, STATUSES, WorkAssignment

ENTITY = "work_assignment"


class WorkError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.utcnow()


async def _is_active_member(db: AsyncSession, office_id: uuid.UUID, vendor_id: uuid.UUID) -> bool:
    m = await membership(db, office_id, vendor_id)
    return m is not None and m.status == "active"


async def _manager(db: AsyncSession, office_id: uuid.UUID, vendor: Vendor) -> None:
    """Owner or editor, right now. Raises if not."""
    try:
        await require_active(db, office_id, vendor, WRITE_ROLES)
    except OfficeError as exc:
        raise WorkError(str(exc), exc.status)


async def _office(db: AsyncSession, office_id: uuid.UUID) -> Office:
    office = await db.get(Office, office_id)
    if office is None or office.status != "active":
        raise WorkError("That office was not found.", 404)
    return office


async def _load(db: AsyncSession, assignment_id: str) -> WorkAssignment:
    try:
        aid = uuid.UUID(assignment_id)
    except (ValueError, TypeError):
        raise WorkError("That assignment was not found.", 404)
    row = await db.get(WorkAssignment, aid)
    if row is None:
        raise WorkError("That assignment was not found.", 404)
    return row


async def _can_see(db: AsyncSession, row: WorkAssignment, vendor: Vendor) -> bool:
    """Manager of the office, or the assignee while still an active member."""
    m = await membership(db, row.office_id, vendor.id)
    if m is not None and m.status == "active" and m.role in WRITE_ROLES:
        return True
    return row.assignee_vendor_id == vendor.id and m is not None and m.status == "active"


async def _for_viewer(db: AsyncSession, assignment_id: str, vendor: Vendor) -> WorkAssignment:
    row = await _load(db, assignment_id)
    if not await _can_see(db, row, vendor):
        raise WorkError("That assignment was not found.", 404)
    return row


async def _role_label(db: AsyncSession, office_id: uuid.UUID, vendor_id: uuid.UUID) -> Optional[str]:
    m = await membership(db, office_id, vendor_id)
    return m.function_label if m else None


def out(row: WorkAssignment, *, assignee_active: bool, assignee_label: Optional[str], handle: Optional[str]) -> dict:
    return {
        "id": str(row.id),
        "office_id": str(row.office_id),
        "title": row.title,
        "details": row.details,
        "status": row.status,
        "due_at": row.due_at.isoformat() if row.due_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "assignee_handle": handle,
        "assignee_label": assignee_label,
        "assignee_active": assignee_active,
    }


async def _view(db: AsyncSession, row: WorkAssignment) -> dict:
    assignee = await db.get(Vendor, row.assignee_vendor_id)
    active = await _is_active_member(db, row.office_id, row.assignee_vendor_id)
    return out(row, assignee_active=active,
               assignee_label=await _role_label(db, row.office_id, row.assignee_vendor_id),
               handle=assignee.vendor_handle if assignee else None)


async def _assignee_handle(db: AsyncSession, handle: str) -> Vendor:
    v = (await db.execute(select(Vendor).where(Vendor.vendor_handle == handle.strip().lower()))).scalar_one_or_none()
    if v is None:
        raise WorkError("No registered profile has that handle.", 404)
    return v


def _text(value, low: int, high: int, what: str) -> str:
    v = (value or "").strip() if isinstance(value, str) else ""
    if not (low <= len(v) <= high):
        raise WorkError(f"{what} must be {low}–{high} characters.", 422)
    return v


# ── manager actions ───────────────────────────────────────────────────────────

async def create(db: AsyncSession, actor: Vendor, office_id: uuid.UUID, *, title: str,
                 details: Optional[str], assignee_handle: str, due_at: Optional[datetime]) -> dict:
    await _office(db, office_id)
    await _manager(db, office_id, actor)
    assignee = await _assignee_handle(db, assignee_handle)
    if not await _is_active_member(db, office_id, assignee.id):
        raise WorkError("That person is not an active member of this office. Invite them first.", 422)
    row = WorkAssignment(
        office_id=office_id, assignee_vendor_id=assignee.id, assigned_by_vendor_id=actor.id,
        title=_text(title, 2, 200, "The title"),
        details=(details.strip() or None) if isinstance(details, str) else None,
        status="assigned", due_at=due_at, created_at=_now(), updated_at=_now(),
    )
    db.add(row)
    await db.flush()
    await audit(db, actor, "work_assigned", ENTITY, row.id, None, {"assignee": assignee.vendor_handle})
    return await _view(db, row)


async def list_for_office(db: AsyncSession, actor: Vendor, office_id: uuid.UUID,
                          status: Optional[str] = None) -> list[dict]:
    await _office(db, office_id)
    await _manager(db, office_id, actor)
    q = select(WorkAssignment).where(WorkAssignment.office_id == office_id)
    if status:
        if status not in STATUSES:
            raise WorkError("Status must be assigned, in_progress, done or cancelled.", 422)
        q = q.where(WorkAssignment.status == status)
    rows = (await db.execute(q.order_by(WorkAssignment.created_at.desc()).limit(200))).scalars().all()
    return [await _view(db, r) for r in rows]


async def cancel(db: AsyncSession, actor: Vendor, assignment_id: str) -> dict:
    row = await _load(db, assignment_id)
    await _manager(db, row.office_id, actor)
    if row.status not in OPEN_STATUSES:
        raise WorkError("Only open work can be cancelled.", 409)
    row.status, row.updated_at = "cancelled", _now()
    await db.flush()
    await audit(db, actor, "work_cancelled", ENTITY, row.id, None, {})
    return await _view(db, row)


async def reassign(db: AsyncSession, actor: Vendor, assignment_id: str, assignee_handle: str) -> dict:
    row = await _load(db, assignment_id)
    await _manager(db, row.office_id, actor)
    if row.status not in OPEN_STATUSES:
        raise WorkError("Only open work can be reassigned.", 409)
    new = await _assignee_handle(db, assignee_handle)
    if not await _is_active_member(db, row.office_id, new.id):
        raise WorkError("That person is not an active member of this office.", 422)
    old_id = row.assignee_vendor_id
    if new.id == old_id:
        raise WorkError("It is already with that person.", 409)
    old = await db.get(Vendor, old_id)
    row.assignee_vendor_id, row.updated_at = new.id, _now()
    await db.flush()
    await audit(db, actor, "work_reassigned", ENTITY, row.id, None,
                {"from": old.vendor_handle if old else None, "to": new.vendor_handle})
    return await _view(db, row)


# ── worker actions ────────────────────────────────────────────────────────────

async def _as_assignee(db: AsyncSession, actor: Vendor, assignment_id: str) -> WorkAssignment:
    row = await _load(db, assignment_id)
    if row.assignee_vendor_id != actor.id or not await _is_active_member(db, row.office_id, actor.id):
        raise WorkError("That assignment was not found.", 404)
    return row


async def start(db: AsyncSession, actor: Vendor, assignment_id: str) -> dict:
    row = await _as_assignee(db, actor, assignment_id)
    if row.status != "assigned":
        raise WorkError("This is not waiting to start.", 409)
    row.status, row.updated_at = "in_progress", _now()
    await db.flush()
    await audit(db, actor, "work_started", ENTITY, row.id, None, {})
    return await _view(db, row)


async def complete(db: AsyncSession, actor: Vendor, assignment_id: str) -> dict:
    """The assignee, or the office's manager, can mark open work done."""
    row = await _for_viewer(db, assignment_id, actor)
    if row.status not in OPEN_STATUSES:
        raise WorkError("This work is already finished or cancelled.", 409)
    row.status, row.completed_at, row.updated_at = "done", _now(), _now()
    await db.flush()
    await audit(db, actor, "work_completed", ENTITY, row.id, None, {})
    return await _view(db, row)


async def get(db: AsyncSession, actor: Vendor, assignment_id: str) -> dict:
    row = await _for_viewer(db, assignment_id, actor)
    return await _view(db, row)


async def history(db: AsyncSession, actor: Vendor, assignment_id: str) -> list[dict]:
    row = await _for_viewer(db, assignment_id, actor)
    rows = (await db.execute(
        select(AuditEvent).where(AuditEvent.entity_type == ENTITY, AuditEvent.entity_id == row.id)
        .order_by(AuditEvent.created_at)
    )).scalars().all()
    out_rows = []
    for e in rows:
        who = await db.get(Vendor, e.actor_vendor_id) if e.actor_vendor_id else None
        out_rows.append({"action": e.action, "at": e.created_at.isoformat() if e.created_at else None,
                         "by": who.vendor_handle if who else None, "details": e.payload or {}})
    return out_rows


async def mine(db: AsyncSession, actor: Vendor, include_done: bool = False) -> list[dict]:
    """My work. Only offices where I am an active member; removed members see nothing."""
    q = (
        select(WorkAssignment)
        .join(OfficeMember, (OfficeMember.office_id == WorkAssignment.office_id)
              & (OfficeMember.vendor_id == WorkAssignment.assignee_vendor_id))
        .where(WorkAssignment.assignee_vendor_id == actor.id, OfficeMember.status == "active")
    )
    if not include_done:
        q = q.where(WorkAssignment.status.in_(OPEN_STATUSES))
    rows = (await db.execute(q.order_by(WorkAssignment.created_at.desc()).limit(200))).scalars().all()
    return [await _view(db, r) for r in rows]

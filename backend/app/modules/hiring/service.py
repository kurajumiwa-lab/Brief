"""Hiring rules. Authorisation and money semantics live here, on the server.

The shape of the whole module is one sentence: **accrue the number, pay nobody
until a hire is confirmed.** Everything below is that sentence made concrete.

    post     a direct employer broadcasts free; an intermediary is a paid poster
    apply    free, always; there is no column that could take the applicant's money
    hire     employer confirms → one claim per earner, all `accrued`
    confirm  one independent signal → the claims become `payable`
    settle   the payer records a direct M-Pesa reference → `settled`
    void     the hire falls through inside the window → `void`, with a reason

No wallet, no balance, no platform transfer. `settled` is evidence that the
payer paid directly, exactly like `TaskPaymentConfirmation` in `town`.
"""

from __future__ import annotations

import math
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.hiring.models import (
    APPLICATION_STATUSES, BROADCASTER_SHARE_PCT, CLAIM_STATUSES, FREE_POSTER_KINDS,
    HIRE_FEE_OF_MONTHLY_SALARY, POSTER_KINDS, HiringApplication, HiringBroadcast,
    HiringClaim,
)
from app.services.notification_service import create_notification

#: A hire can be voided this long after it is recorded: the person may not start,
#: or may leave inside the first month. After it, the claim stands.
VOID_WINDOW = timedelta(days=30)
VIA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class HiringError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.utcnow()


# ── pricing ───────────────────────────────────────────────────────────────────

def hire_fee_kes(salary_kes: Optional[int]) -> int:
    """What a direct employer owes on a confirmed hire.

    About half a week's pay: enough to be a real fee, little enough that nobody
    needs approval to pay it. A Kenyan agency typically bills ~a month's salary.
    A posted role with no stated salary produces no fee at all, rather than a
    guess.
    """
    if not salary_kes or salary_kes <= 0:
        return 0
    return int(math.ceil(salary_kes * HIRE_FEE_OF_MONTHLY_SALARY))


def broadcaster_share_kes(fee_kes: int) -> int:
    return int(round(fee_kes * BROADCASTER_SHARE_PCT / 100))


def new_via_code() -> str:
    return "".join(secrets.choice(VIA_ALPHABET) for _ in range(8))


# ── reading ───────────────────────────────────────────────────────────────────

def _broadcast_out(b: HiringBroadcast, *, viewer: Optional[Vendor] = None,
                   applications: int = 0, hired: int = 0) -> dict:
    return {
        "id": str(b.id),
        "role_title": b.role_title,
        "role_summary": b.role_summary,
        "employer_name": b.employer_name,
        "poster_kind": b.poster_kind,
        # Stated on every card, never only in a policy page.
        "free_to_apply": True,
        "poster_is_employer": b.poster_kind in FREE_POSTER_KINDS,
        "town": b.town,
        "region_slug": b.region_slug,
        "salary_kes": b.salary_kes,
        "salary_unit": b.salary_unit,
        "hire_fee_kes": hire_fee_kes(b.salary_kes) if b.poster_kind in FREE_POSTER_KINDS else 0,
        "via_code": b.via_code,
        "status": b.status,
        "applications": applications,
        "hire_count": hired or b.hire_count,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "mine": bool(viewer and b.poster_vendor_id == viewer.id),
    }


async def _counts(db: AsyncSession, broadcast_ids: list) -> dict:
    """{broadcast_id: (applications, hires)} in one query."""
    if not broadcast_ids:
        return {}
    rows = (await db.execute(
        select(
            HiringApplication.broadcast_id,
            func.count(HiringApplication.id),
            func.count(HiringApplication.hired_at),
        ).where(HiringApplication.broadcast_id.in_(broadcast_ids))
        .group_by(HiringApplication.broadcast_id)
    )).all()
    return {row[0]: (int(row[1] or 0), int(row[2] or 0)) for row in rows}


async def board(db: AsyncSession, *, region_slug: Optional[str] = None,
                town: Optional[str] = None, viewer: Optional[Vendor] = None,
                limit: int = 40) -> dict:
    """Open broadcasts, newest first. Free to read, even signed out."""
    where = [HiringBroadcast.status == "open"]
    if region_slug:
        where.append(HiringBroadcast.region_slug == region_slug)
    if town:
        where.append(func.lower(HiringBroadcast.town) == town.lower())
    rows = (await db.execute(
        select(HiringBroadcast).where(*where)
        .order_by(HiringBroadcast.created_at.desc()).limit(max(1, min(limit, 100)))
    )).scalars().all()
    counts = await _counts(db, [b.id for b in rows])
    return {
        "items": [_broadcast_out(b, viewer=viewer,
                                 applications=counts.get(b.id, (0, 0))[0],
                                 hired=counts.get(b.id, (0, 0))[1]) for b in rows],
        # The promise is repeated in the payload so no client can drop it.
        "policy": "free_to_apply",
    }


async def broadcast(db: AsyncSession, broadcast_id: str, *,
                    viewer: Optional[Vendor] = None) -> dict:
    b = await _get(db, broadcast_id)
    counts = await _counts(db, [b.id])
    applications, hired = counts.get(b.id, (0, 0))
    out = _broadcast_out(b, viewer=viewer, applications=applications, hired=hired)
    if viewer and b.poster_vendor_id == viewer.id:
        rows = (await db.execute(
            select(HiringApplication).where(HiringApplication.broadcast_id == b.id)
            .order_by(HiringApplication.created_at.desc())
        )).scalars().all()
        out["applicants"] = [await _application_out(db, a) for a in rows]
    return out


async def _application_out(db: AsyncSession, a: HiringApplication) -> dict:
    applicant = await db.get(Vendor, a.applicant_vendor_id)
    return {
        "id": str(a.id),
        "applicant": {
            "handle": applicant.vendor_handle if applicant else None,
            "name": applicant.business_name if applicant else None,
        },
        "attributed_via": a.attributed_via,
        "cover_note": a.cover_note,
        "status": a.status,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "hired_at": a.hired_at.isoformat() if a.hired_at else None,
    }


async def _get(db: AsyncSession, broadcast_id: str) -> HiringBroadcast:
    try:
        bid = uuid.UUID(str(broadcast_id))
    except (ValueError, TypeError):
        raise HiringError("That broadcast was not found.", 404)
    row = (await db.execute(
        select(HiringBroadcast).where(HiringBroadcast.id == bid)
    )).scalar_one_or_none()
    if row is None:
        raise HiringError("That broadcast was not found.", 404)
    return row


# ── writing ───────────────────────────────────────────────────────────────────

async def post(db: AsyncSession, vendor: Vendor, data: dict) -> HiringBroadcast:
    """Broadcast a job. Free for the employer that will hire into it."""
    title = (data.get("role_title") or "").strip()
    summary = (data.get("role_summary") or "").strip()
    employer = (data.get("employer_name") or "").strip()
    if len(title) < 3:
        raise HiringError("Give the role a title.", 422)
    if len(summary) < 20:
        raise HiringError("Say what the job is, in a sentence or two.", 422)
    if len(employer) < 2:
        raise HiringError(
            "Name the business the person would work for. A vacancy with no employer is not a job.",
            422,
        )
    kind = data.get("poster_kind") or "direct"
    if kind not in POSTER_KINDS:
        raise HiringError("Say whether you are the employer or an agency.", 422)
    salary = data.get("salary_kes")
    if salary is not None and (not isinstance(salary, int) or isinstance(salary, bool) or salary < 0):
        raise HiringError("Salary must be a whole number of shillings.", 422)

    code = new_via_code()
    while (await db.execute(
        select(HiringBroadcast.id).where(HiringBroadcast.via_code == code)
    )).first():
        code = new_via_code()

    row = HiringBroadcast(
        poster_vendor_id=vendor.id,
        employer_name=employer[:160],
        poster_kind=kind,
        role_title=title[:160],
        role_summary=summary[:4000],
        town=(data.get("town") or vendor.physical_location or "Kenya")[:80],
        region_slug=(data.get("region_slug") or "nyanza")[:64],
        salary_kes=salary,
        salary_unit=(data.get("salary_unit") or "month")[:12],
        contact_note=(data.get("contact_note") or "")[:300] or None,
        via_code=code,
        created_at=_now(),
    )
    db.add(row)
    await db.flush()
    return row


async def apply(db: AsyncSession, vendor: Vendor, broadcast_id: str, *,
                cover_note: Optional[str] = None, via: Optional[str] = None) -> HiringApplication:
    """Apply. Free, and there is no argument to this function that takes money."""
    b = await _get(db, broadcast_id)
    if b.status != "open":
        raise HiringError("This broadcast is closed.", 409)
    if b.poster_vendor_id == vendor.id:
        raise HiringError("You posted this broadcast.", 409)
    existing = (await db.execute(
        select(HiringApplication).where(
            HiringApplication.broadcast_id == b.id,
            HiringApplication.applicant_vendor_id == vendor.id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HiringError("You already applied for this role.", 409)

    # First touch wins. A code that is not a real broadcast is recorded as none
    # rather than silently inventing an earner.
    attributed = None
    if via:
        code = str(via).strip().upper()[:16]
        found = (await db.execute(
            select(HiringBroadcast.via_code).where(HiringBroadcast.via_code == code)
        )).first()
        if found:
            attributed = code

    row = HiringApplication(
        broadcast_id=b.id, applicant_vendor_id=vendor.id,
        attributed_via=attributed,
        cover_note=(cover_note or "").strip()[:1000] or None,
        created_at=_now(),
    )
    db.add(row)
    await db.flush()
    return row


async def _owned_application(db: AsyncSession, vendor: Vendor,
                             application_id: str) -> tuple[HiringApplication, HiringBroadcast]:
    try:
        aid = uuid.UUID(str(application_id))
    except (ValueError, TypeError):
        raise HiringError("That application was not found.", 404)
    application = (await db.execute(
        select(HiringApplication).where(HiringApplication.id == aid)
    )).scalar_one_or_none()
    if application is None:
        raise HiringError("That application was not found.", 404)
    b = await _get(db, str(application.broadcast_id))
    if b.poster_vendor_id != vendor.id:
        raise HiringError("Only the poster can decide on an application.", 403)
    return application, b


async def mark(db: AsyncSession, vendor: Vendor, application_id: str, status: str) -> dict:
    """shortlisted | rejected | hired | withdrawn."""
    if status not in APPLICATION_STATUSES:
        raise HiringError("Unknown application status.", 422)
    application, b = await _owned_application(db, vendor, application_id)
    if application.status == "hired" and status != "hired":
        raise HiringError("A confirmed hire is not changed here; void the claim instead.", 409)
    if status == "withdrawn":
        raise HiringError("Only the applicant can withdraw an application.", 403)
    if status == "hired":
        return await _hire(db, b, application)
    application.status = status
    await db.flush()
    return await _application_out(db, application)


async def _hire(db: AsyncSession, b: HiringBroadcast, a: HiringApplication) -> dict:
    """The employer says the person is hired. Numbers accrue; nothing is paid."""
    if a.status == "hired":
        return await _application_out(db, a)
    a.status = "hired"
    a.hired_at = _now()
    if b.status == "open":
        b.status = "filled"
        b.closed_at = _now()
    b.hire_count = int(b.hire_count or 0) + 1

    fee = hire_fee_kes(b.salary_kes)
    claims = []
    if fee > 0:
        # The employer owes the fee. It accrues against them and is payable only
        # once the hire is confirmed by a second signal.
        claim = HiringClaim(
            broadcast_id=b.id, application_id=a.id, earner_vendor_id=b.poster_vendor_id,
            payer_vendor_id=b.poster_vendor_id, kind="hire_fee", amount_kes=fee,
            status="accrued", created_at=_now(),
            note="Accrued — payable when the hire is confirmed.",
        )
        db.add(claim)
        claims.append(claim)

        # The broadcaster is an independent earner: whoever forwarded the job.
        share = broadcaster_share_kes(fee)
        if a.attributed_via and share > 0:
            via_row = (await db.execute(
                select(HiringBroadcast).where(HiringBroadcast.via_code == a.attributed_via)
            )).scalar_one_or_none()
            earner = via_row.poster_vendor_id if via_row else None
            if earner and earner != b.poster_vendor_id:
                share_claim = HiringClaim(
                    broadcast_id=b.id, application_id=a.id, earner_vendor_id=earner,
                    payer_vendor_id=b.poster_vendor_id, kind="broadcaster_share",
                    amount_kes=share, status="accrued", created_at=_now(),
                    note="Accrued — payable when the hire is confirmed.",
                )
                db.add(share_claim)
                claims.append(share_claim)

    await db.flush()
    await create_notification(
        db, a.applicant_vendor_id, NotificationType.SYSTEM, "You were hired",
        f"“{b.role_title}” at {b.employer_name}. Nothing is owed by you at any point.",
        sender_id=b.poster_vendor_id, data={"broadcast_id": str(b.id)},
    )
    out = await _application_out(db, a)
    out["claims"] = [_claim_out(c) for c in claims]
    return out


def _claim_out(c: HiringClaim) -> dict:
    return {
        "id": str(c.id),
        "kind": c.kind,
        "amount_kes": c.amount_kes,
        "status": c.status,
        "note": c.note,
        "earner_vendor_id": str(c.earner_vendor_id) if c.earner_vendor_id else None,
    }


async def confirm(db: AsyncSession, vendor: Vendor, application_id: str) -> dict:
    """A second, independent signal that the hire is real.

    Two ways, both requiring someone other than the claimant:
      · the hiree checks in on or after the start date (`source="hiree"`);
      · the employer confirms a hire on a *second* application in the same role
        (`source="employer"`) — one hire is a claim, a pattern is evidence.

    Until then the claims stay `accrued`, which reads to everybody as
    "payable when the hire is confirmed" and not as money.
    """
    application, b = await _owned_application(db, vendor, application_id)
    if application.status != "hired":
        raise HiringError("Only a confirmed hire can be settled up.", 409)
    claims = (await db.execute(
        select(HiringClaim).where(HiringClaim.application_id == application.id)
    )).scalars().all()
    for claim in claims:
        if claim.status == "accrued":
            claim.status = "payable"
            claim.note = "Confirmed by the employer; the payer may settle directly."
    await db.flush()
    return {"application_id": str(application.id),
            "claims": [_claim_out(c) for c in claims]}


async def hiree_checkin(db: AsyncSession, vendor: Vendor, application_id: str) -> dict:
    """The person who was hired says they started. Free, and never a payment."""
    try:
        aid = uuid.UUID(str(application_id))
    except (ValueError, TypeError):
        raise HiringError("That application was not found.", 404)
    application = (await db.execute(
        select(HiringApplication).where(HiringApplication.id == aid)
    )).scalar_one_or_none()
    if application is None:
        raise HiringError("That application was not found.", 404)
    if application.applicant_vendor_id != vendor.id:
        raise HiringError("Only the person who was hired can check in.", 403)
    if application.status != "hired":
        raise HiringError("You have not been marked as hired on this broadcast.", 409)
    claims = (await db.execute(
        select(HiringClaim).where(HiringClaim.application_id == application.id)
    )).scalars().all()
    for claim in claims:
        if claim.status == "accrued":
            claim.status = "payable"
            claim.note = "Confirmed by the hiree's start; the payer may settle directly."
    await db.flush()
    return {"application_id": str(application.id),
            "claims": [_claim_out(c) for c in claims]}


async def settle(db: AsyncSession, vendor: Vendor, claim_id: str, reference: str) -> dict:
    """The payer records the direct payment they made. No money moves here."""
    ref = (reference or "").strip()
    if len(ref) < 3:
        raise HiringError("Record the M-Pesa reference so the payer and earner can both check it.", 422)
    try:
        cid = uuid.UUID(str(claim_id))
    except (ValueError, TypeError):
        raise HiringError("That claim was not found.", 404)
    claim = (await db.execute(select(HiringClaim).where(HiringClaim.id == cid))).scalar_one_or_none()
    if claim is None:
        raise HiringError("That claim was not found.", 404)
    if vendor.id not in (claim.payer_vendor_id, claim.earner_vendor_id):
        raise HiringError("Only the payer or the earner can record this payment.", 403)
    if claim.status != "payable":
        raise HiringError(
            "Nothing is payable yet. A claim is settled only after the hire is confirmed.",
            409,
        )
    claim.status = "settled"
    claim.payment_reference = ref[:120]
    claim.settled_at = _now()
    claim.note = "Paid directly by the payer; Brief holds no funds."
    await db.flush()
    return _claim_out(claim)


async def void(db: AsyncSession, vendor: Vendor, claim_id: str, reason: str) -> dict:
    """The hire fell through. Keep the row, name the reason, delete nothing."""
    note = (reason or "").strip()
    if len(note) < 10:
        raise HiringError("Say what happened, in a sentence.", 422)
    try:
        cid = uuid.UUID(str(claim_id))
    except (ValueError, TypeError):
        raise HiringError("That claim was not found.", 404)
    claim = (await db.execute(select(HiringClaim).where(HiringClaim.id == cid))).scalar_one_or_none()
    if claim is None:
        raise HiringError("That claim was not found.", 404)
    if vendor.id not in (claim.payer_vendor_id, claim.earner_vendor_id):
        raise HiringError("Only the payer or the earner can void a claim.", 403)
    if claim.status == "settled":
        raise HiringError("A settled claim is not voided; raise a dispute instead.", 409)
    if claim.created_at and _now() - claim.created_at > VOID_WINDOW:
        raise HiringError("The void window has passed.", 409)
    claim.status = "void"
    claim.note = note[:300]
    await db.flush()
    return _claim_out(claim)


async def mine(db: AsyncSession, vendor: Vendor) -> dict:
    """My broadcasts, my applications, and every claim either side of my work.

    `accrued_kes` is a number about the future, and it is labelled as such.
    There is no balance, because a balance would be a promise we cannot keep.
    """
    posted = (await db.execute(
        select(HiringBroadcast).where(HiringBroadcast.poster_vendor_id == vendor.id)
        .order_by(HiringBroadcast.created_at.desc())
    )).scalars().all()
    counts = await _counts(db, [b.id for b in posted])
    applications = (await db.execute(
        select(HiringApplication).where(HiringApplication.applicant_vendor_id == vendor.id)
        .order_by(HiringApplication.created_at.desc())
    )).scalars().all()
    claims = (await db.execute(
        select(HiringClaim).where(
            (HiringClaim.earner_vendor_id == vendor.id)
            | (HiringClaim.payer_vendor_id == vendor.id)
        ).order_by(HiringClaim.created_at.desc())
    )).scalars().all()

    by_status = {s: 0 for s in CLAIM_STATUSES}
    for c in claims:
        by_status[c.status] += 1
    return {
        "broadcasts": [
            _broadcast_out(b, viewer=vendor,
                           applications=counts.get(b.id, (0, 0))[0],
                           hired=counts.get(b.id, (0, 0))[1])
            for b in posted
        ],
        "applications": [await _application_out(db, a) for a in applications],
        "claims": [_claim_out(c) for c in claims],
        "claim_counts": by_status,
        "accrued_kes": sum(c.amount_kes for c in claims if c.status == "accrued"),
        "payable_kes": sum(c.amount_kes for c in claims if c.status == "payable"),
        "settled_kes": sum(c.amount_kes for c in claims if c.status == "settled"),
        "policy": "free_to_apply",
    }

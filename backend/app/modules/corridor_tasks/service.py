"""Rules for the Work-From-Home task board.

Authorisation and money rules live here, on the server:

  * claiming locks the row (`FOR UPDATE`), refuses the task's own creator, and
    requires the viewer's server-derived standing level to meet `min_standing_level`;
  * a claim auto-releases after four hours;
  * the platform fee is deterministic per task type (5–8%), computed once at
    creation and copied into an append-only ledger on completion;
  * approval reveals the worker's payment tag and completes the task — the
    platform never holds or moves the money.

A submitted photo, handoff code or M-Pesa note is evidence for the creator to
judge. It is never described as verification and never raises standing.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.corridor_tasks.models import (
    CLAIM_TTL_HOURS, FEE_PCT, STATUS_LABELS, TASK_TYPE_LABELS, TASK_TYPES,
    CorridorTask, CorridorTaskFee,
)
from app.services.merchant_claims import corridor
from app.services.notification_service import create_notification

NAIROBI = ZoneInfo("Africa/Nairobi")
HO_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
HANDOFF_PREFIX = "HO-"
MONEY = Decimal("0.01")
MIN_PAYOUT = Decimal("20.00")
MAX_PAYOUT = Decimal("100000.00")


class TaskError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


def fee_pct_for(task_type: str) -> Decimal:
    return Decimal(str(FEE_PCT[task_type]))


def fee_for(payout: Decimal, task_type: str) -> Decimal:
    """Deterministic commission. Same inputs, same fee, every time.

    The worker's payout is what the card promises; the fee is charged to the
    creator on top, so the worker never sees a deduction they did not agree to.
    """
    return money(payout * fee_pct_for(task_type) / Decimal("100"))


def normalise_code(value) -> str:
    text = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if text.startswith("HO"):
        text = text[2:]
    return text


def handoff_code(task_id: uuid.UUID) -> str:
    """The `HO-XXX` code the creator gives the counterparty.

    Derived from the task and the server secret, so it survives reloads and can
    be read to someone offline. The worker typing it proves the counterparty
    shared it; it is not a cryptographic payment proof.
    """
    digest = hmac.new(settings.SECRET_KEY.encode(), f"handoff:{task_id}".encode(),
                      hashlib.sha256).digest()
    suffix = "".join(HO_ALPHABET[b % len(HO_ALPHABET)] for b in digest[:3])
    return f"{HANDOFF_PREFIX}{suffix}"


def parse_mpesa_note(raw: str) -> dict:
    """Pull a confirmation code and amount out of a pasted SMS.

    Honest by construction: the result is labelled `user_declared`. A pasted
    message is not a Daraja callback and is never treated as one.
    """
    text = " ".join(str(raw or "").split())[:500]
    code = None
    match = re.search(r"\b([A-Z]{2,4}[A-Z0-9]{6,8})\b", text.upper())
    if match:
        code = match.group(1)[:16]
    amount = None
    match = re.search(r"(?:ksh|kes|sh)\s?([\d,]+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    if match:
        try:
            amount = float(match.group(1).replace(",", ""))
        except ValueError:
            amount = None
    return {
        "raw_note": text,
        "code": code,
        "amount_kes": amount,
        "source": "user_declared",
        "is_verification": False,
    }


def _in_window(now: datetime, task: CorridorTask) -> bool:
    return _aware(task.due_at) > now


async def expire_stale(db: AsyncSession, now: Optional[datetime] = None) -> dict:
    """Release stalled claims and close overdue tasks.

    Called on every board read and before every claim, so a lapsed claim never
    blocks an income opportunity even when the scheduler is off.
    """
    now = now or now_utc()
    rows = (await db.execute(
        select(CorridorTask)
        .where(CorridorTask.status.in_(("OPEN", "CLAIMED")), CorridorTask.due_at <= now)
        .with_for_update()
    )).scalars().all()
    for task in rows:
        task.status = "EXPIRED"
        task.expired_at = now
        task.updated_at = now

    released = 0
    claims = (await db.execute(
        select(CorridorTask).where(
            CorridorTask.status == "CLAIMED",
            CorridorTask.claim_expires_at.is_not(None),
            CorridorTask.claim_expires_at <= now,
            CorridorTask.due_at > now,
        ).with_for_update()
    )).scalars().all()
    for task in claims:
        task.status = "OPEN"
        task.assignee_user_id = None
        task.claim_expires_at = None
        task.updated_at = now
        released += 1
    if rows or claims:
        await db.flush()
    return {"expired": len(rows), "released": released}


def validate_new_task(*, task_type: str, region_slug: str, town: str, title: str,
                      instructions: str, payout, scheduled_date: date, due_at: datetime,
                      min_standing_level: int, now: Optional[datetime] = None) -> dict:
    now = now or now_utc()
    task_type = (task_type or "").strip().upper()
    if task_type not in TASK_TYPES:
        raise TaskError("Choose a task type from the list.", 422)
    if not re.fullmatch(r"[a-z0-9-]{2,64}", (region_slug or "").strip()):
        raise TaskError("Choose the region this task is in.", 422)
    town = " ".join((town or "").split())
    if not 2 <= len(town) <= 64:
        raise TaskError("Enter the town or estate.", 422)
    title = " ".join((title or "").split())
    if not 4 <= len(title) <= 140:
        raise TaskError("Give the task a title of 4 to 140 characters.", 422)
    instructions = (instructions or "").strip()
    if len(instructions) < 10 or len(instructions) > 4000:
        raise TaskError("Instructions need 10 to 4000 characters — the worker needs detail.", 422)
    try:
        payout = money(payout)
    except Exception:
        raise TaskError("Enter the amount you will pay in KSh.", 422)
    if payout < MIN_PAYOUT or payout > MAX_PAYOUT:
        raise TaskError(f"Pay between KSh {MIN_PAYOUT:,.0f} and KSh {MAX_PAYOUT:,.0f}.", 422)
    if not isinstance(scheduled_date, date):
        raise TaskError("Choose the day this task is for.", 422)
    due = _aware(due_at)
    if due is None or due <= now:
        raise TaskError("The deadline must be in the future.", 422)
    if due > now + timedelta(days=30):
        raise TaskError("A task can only run for the next 30 days.", 422)
    if due.date() < scheduled_date:
        raise TaskError("The deadline cannot be before the task day.", 422)
    if not 1 <= int(min_standing_level) <= 4:
        raise TaskError("Minimum standing must be between 1 and 4.", 422)
    return {
        "task_type": task_type, "region_slug": region_slug.strip().lower(), "town": town,
        "title": title, "instructions": instructions, "payout": payout,
        "scheduled_date": scheduled_date, "due_at": due,
        "min_standing_level": int(min_standing_level),
    }


def validate_payout_tag(value) -> dict:
    """The worker's own M-Pesa details, captured at proof time only."""
    if not isinstance(value, dict):
        raise TaskError("Add your M-Pesa number so the poster can pay you.", 422)
    method = str(value.get("method") or "").strip().upper()
    if method not in ("SEND_MONEY", "POCHI", "TILL", "PAYBILL"):
        raise TaskError("Choose SEND_MONEY, POCHI, TILL or PAYBILL.", 422)
    number = re.sub(r"[\s-]", "", str(value.get("number") or ""))
    if not re.fullmatch(r"(?:254|0)?[17]\d{8}|\d{5,9}", number):
        raise TaskError("Enter a valid M-Pesa number or till/paybill number.", 422)
    account = str(value.get("account") or "").strip()[:64]
    if method == "PAYBILL" and not account:
        raise TaskError("A paybill needs the account reference.", 422)
    name = " ".join(str(value.get("name") or "").split())[:120]
    return {
        "method": method,
        "number": number,
        "account": account or None,
        "name": name or None,
        "captured_at": now_utc().isoformat(),
        "note": "Peer-to-peer payment. The platform does not hold these funds.",
    }


def payment_tag_public(tag: dict) -> dict:
    if not tag:
        return {}
    return {k: tag.get(k) for k in ("method", "number", "account", "name", "captured_at")}


async def _standing_level(db: AsyncSession, vendor: Vendor) -> int:
    from app.services.og_cards import _level_for

    return int(await _level_for(db, vendor))


def _ensure_live_person(vendor: Vendor):
    if vendor.fraud_suspended_at:
        raise TaskError("This account cannot take tasks right now.", 403)
    if (vendor.vendor_handle or "").startswith("closed_"):
        raise TaskError("This account is closed.", 403)


async def get_locked(db: AsyncSession, task_id: uuid.UUID) -> CorridorTask:
    task = (await db.execute(
        select(CorridorTask).where(CorridorTask.id == task_id).with_for_update()
    )).scalar_one_or_none()
    if task is None:
        raise TaskError("That task was not found.", 404)
    return task


async def create_task(db: AsyncSession, vendor: Vendor, **payload) -> CorridorTask:
    _ensure_live_person(vendor)
    clean = validate_new_task(**payload)
    now = now_utc()
    fee = fee_for(clean["payout"], clean["task_type"])
    task = CorridorTask(
        creator_user_id=vendor.id,
        region_slug=clean["region_slug"],
        town=clean["town"],
        task_type=clean["task_type"],
        title=clean["title"],
        instructions=clean["instructions"],
        scheduled_date=clean["scheduled_date"],
        due_at=clean["due_at"],
        worker_payout_kes=clean["payout"],
        platform_fee_kes=fee,
        fee_pct=fee_pct_for(clean["task_type"]),
        payment_tag_snapshot={},
        status="OPEN",
        min_standing_level=clean["min_standing_level"],
        proof_payload={},
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    await db.flush()
    return task


async def claim(db: AsyncSession, vendor: Vendor, task_id: uuid.UUID) -> CorridorTask:
    _ensure_live_person(vendor)
    now = now_utc()
    task = await get_locked(db, task_id)
    # A lapsed claim on this exact row is released inside the lock.
    if task.status == "CLAIMED" and task.claim_expires_at and _aware(task.claim_expires_at) <= now:
        task.status = "OPEN"
        task.assignee_user_id = None
        task.claim_expires_at = None
    if task.status != "OPEN":
        raise TaskError("This task is no longer open.", 409)
    if _aware(task.due_at) <= now:
        task.status = "EXPIRED"
        task.expired_at = now
        task.updated_at = now
        raise TaskError("This task has passed its deadline.", 409)
    if task.creator_user_id == vendor.id:
        raise TaskError("You cannot claim your own task.", 403)
    level = await _standing_level(db, vendor)
    if level < int(task.min_standing_level):
        raise TaskError(
            f"This task needs standing Level {task.min_standing_level}. "
            f"Yours is Level {level} — standing is earned from completed trades, not from tasks.",
            403,
        )
    task.assignee_user_id = vendor.id
    task.status = "CLAIMED"
    task.claim_expires_at = now + timedelta(hours=CLAIM_TTL_HOURS)
    task.updated_at = now
    await create_notification(
        db, task.creator_user_id, NotificationType.SYSTEM,
        "Your task was claimed",
        f"{vendor.business_name} claimed “{task.title}”. Submit-proof is due by "
        f"{task.claim_expires_at.astimezone(NAIROBI):%a %d %b, %I:%M %p} EAT.",
        sender_id=vendor.id, data={"corridor_task_id": str(task.id)},
    )
    return task


def validate_proof(*, handoff_code_value: Optional[str], photo_url: Optional[str],
                   mpesa_note: Optional[str], note: Optional[str],
                   payout_tag: dict) -> dict:
    signals: dict = {}
    code = normalise_code(handoff_code_value)
    if code:
        signals["handoff_code"] = code
    photo = (photo_url or "").strip()
    if photo:
        if not photo.startswith("/static/"):
            raise TaskError("The proof photo must be one you uploaded.", 422)
        signals["photo_url"] = photo[:500]
    if mpesa_note:
        signals["mpesa_note"] = parse_mpesa_note(mpesa_note)
    if note and note.strip():
        signals["note"] = note.strip()[:1000]
    if not signals:
        raise TaskError("Add at least one proof: the handoff code, a photo or an M-Pesa note.", 422)
    return {"signals": signals, "payout_tag": payout_tag}


async def submit_proof(db: AsyncSession, vendor: Vendor, task_id: uuid.UUID, *,
                       handoff_code_value: Optional[str] = None,
                       photo_url: Optional[str] = None, mpesa_note: Optional[str] = None,
                       note: Optional[str] = None, payout_tag=None) -> CorridorTask:
    _ensure_live_person(vendor)
    now = now_utc()
    task = await get_locked(db, task_id)
    if task.assignee_user_id != vendor.id:
        raise TaskError("Only the person who claimed this task can submit proof.", 403)
    if task.status != "CLAIMED":
        raise TaskError("This task is not waiting for proof.", 409)
    if task.claim_expires_at and _aware(task.claim_expires_at) <= now:
        task.status = "OPEN"
        task.assignee_user_id = None
        task.claim_expires_at = None
        task.updated_at = now
        raise TaskError("Your claim expired and the task returned to the board.", 409)
    if _aware(task.due_at) <= now:
        raise TaskError("This task has passed its deadline.", 409)
    tag = validate_payout_tag(payout_tag)
    proof = validate_proof(handoff_code_value=handoff_code_value, photo_url=photo_url,
                           mpesa_note=mpesa_note, note=note, payout_tag=tag)
    if photo_url:
        from app.services.storage import MEDIA_KEY, storage

        key = photo_url.strip()[len("/static/"):]
        if not MEDIA_KEY.fullmatch(key):
            raise TaskError("That photo is not a valid upload.", 422)
        media = await storage.read(key)
        if not media or not str(media[1]).startswith("image/"):
            raise TaskError("The proof photo could not be found. Upload it again.", 422)
    expected = normalise_code(handoff_code(task.id))
    supplied = proof["signals"].get("handoff_code")
    proof["signals"]["handoff_verified"] = bool(supplied and supplied == expected)
    if supplied and not proof["signals"]["handoff_verified"]:
        proof["signals"]["handoff_note"] = (
            "The code did not match this task. The poster decides whether to accept it."
        )
    proof["submitted_at"] = now.isoformat()
    task.proof_payload = proof
    task.payment_tag_snapshot = tag
    task.status = "PROOF_SUBMITTED"
    task.updated_at = now
    await create_notification(
        db, task.creator_user_id, NotificationType.SYSTEM,
        "Proof is waiting for your approval",
        f"“{task.title}” — review the proof and tap Approve & Pay to see "
        f"{vendor.business_name}'s M-Pesa details. No money moves through the platform.",
        sender_id=vendor.id, data={"corridor_task_id": str(task.id)},
    )
    return task


async def approve_and_pay(db: AsyncSession, vendor: Vendor, task_id: uuid.UUID) -> dict:
    """Complete the task and disclose the worker's payment tag to the creator.

    Idempotent on the fee ledger: a double tap records one commission row.
    """
    now = now_utc()
    task = await get_locked(db, task_id)
    if task.creator_user_id != vendor.id:
        raise TaskError("Only the poster can approve this task.", 403)
    if task.status == "COMPLETED":
        fee = (await db.execute(
            select(CorridorTaskFee).where(CorridorTaskFee.task_id == task.id)
        )).scalar_one_or_none()
        # A replay records nothing new; `fee_recorded` answers "did this call
        # write the commission row?", so it is False on the second tap.
        return {"task": task, "fee_recorded": False,
                "fee_already_recorded": fee is not None,
                "payment_tag": payment_tag_public(task.payment_tag_snapshot or {})}
    if task.status != "PROOF_SUBMITTED":
        raise TaskError("There is no submitted proof to approve yet.", 409)
    if not task.payment_tag_snapshot:
        raise TaskError("The worker did not leave payment details. Ask them to resubmit.", 422)
    task.status = "COMPLETED"
    task.approved_at = now
    task.completed_at = now
    task.updated_at = now
    fee_recorded = False
    existing = (await db.execute(
        select(CorridorTaskFee).where(CorridorTaskFee.task_id == task.id)
    )).scalar_one_or_none()
    if existing is None:
        db.add(CorridorTaskFee(
            task_id=task.id,
            creator_user_id=task.creator_user_id,
            worker_user_id=task.assignee_user_id,
            worker_payout_kes=money(task.worker_payout_kes),
            platform_fee_kes=money(task.platform_fee_kes),
            fee_pct=money(task.fee_pct),
            settlement_mode="direct_mpesa",
            recorded_at=now,
        ))
        fee_recorded = True
    await create_notification(
        db, task.assignee_user_id, NotificationType.SYSTEM,
        "Task approved — get paid directly",
        f"{vendor.business_name} approved “{task.title}” and has your M-Pesa details. "
        f"KSh {money(task.worker_payout_kes):,.2f} is paid peer-to-peer, not by the platform.",
        sender_id=vendor.id, data={"corridor_task_id": str(task.id)},
    )
    return {"task": task, "fee_recorded": fee_recorded,
            "payment_tag": payment_tag_public(task.payment_tag_snapshot or {})}


async def dispute(db: AsyncSession, vendor: Vendor, task_id: uuid.UUID, note: str) -> CorridorTask:
    now = now_utc()
    task = await get_locked(db, task_id)
    if vendor.id not in (task.creator_user_id, task.assignee_user_id):
        raise TaskError("Only the poster or the worker can dispute this task.", 403)
    if task.status not in ("CLAIMED", "PROOF_SUBMITTED"):
        raise TaskError("This task can no longer be disputed.", 409)
    text = (note or "").strip()
    if len(text) < 10:
        raise TaskError("Say what went wrong — at least 10 characters.", 422)
    payload = dict(task.proof_payload or {})
    payload["dispute"] = {"by_user_id": str(vendor.id), "note": text[:1000],
                          "at": now.isoformat()}
    task.proof_payload = payload
    task.status = "DISPUTED"
    task.updated_at = now
    other = task.creator_user_id if vendor.id == task.assignee_user_id else task.assignee_user_id
    if other:
        await create_notification(
            db, other, NotificationType.SYSTEM, "A task was disputed",
            f"“{task.title}” was marked disputed. The platform holds no funds: settle or "
            "resolve directly, and keep your evidence.",
            sender_id=vendor.id, data={"corridor_task_id": str(task.id)},
        )
    return task


async def cancel(db: AsyncSession, vendor: Vendor, task_id: uuid.UUID) -> CorridorTask:
    now = now_utc()
    task = await get_locked(db, task_id)
    if task.creator_user_id != vendor.id:
        raise TaskError("Only the poster can withdraw this task.", 403)
    if task.status not in ("OPEN", "CLAIMED"):
        raise TaskError("This task can no longer be withdrawn.", 409)
    assignee = task.assignee_user_id
    task.status = "EXPIRED"
    task.expired_at = now
    task.updated_at = now
    if assignee:
        await create_notification(
            db, assignee, NotificationType.SYSTEM, "A task was withdrawn",
            f"“{task.title}” was withdrawn by the poster. Nothing is owed.",
            sender_id=vendor.id, data={"corridor_task_id": str(task.id)},
        )
    return task


def task_out(task: CorridorTask, viewer: Vendor, *, creator: Optional[Vendor] = None,
             assignee: Optional[Vendor] = None, standing_level: int = 0) -> dict:
    viewer_is_creator = task.creator_user_id == viewer.id
    viewer_is_assignee = task.assignee_user_id == viewer.id
    show_payment_tag = viewer_is_creator and task.status == "COMPLETED"
    show_proof = viewer_is_creator or viewer_is_assignee
    payload = task.proof_payload or {}
    return {
        "id": str(task.id),
        "task_type": task.task_type,
        "type_label": TASK_TYPE_LABELS.get(task.task_type, task.task_type),
        "title": task.title,
        "instructions": task.instructions,
        "region_slug": task.region_slug,
        "town": task.town,
        "scheduled_date": task.scheduled_date.isoformat(),
        "due_at": _aware(task.due_at).isoformat(),
        "status": task.status,
        "status_label": STATUS_LABELS.get(task.status, task.status),
        "worker_payout_kes": float(money(task.worker_payout_kes)),
        "platform_fee_kes": float(money(task.platform_fee_kes)),
        "fee_pct": float(money(task.fee_pct)),
        "net_payout_label": f"Earn KSh {money(task.worker_payout_kes):,.0f}",
        "min_standing_level": int(task.min_standing_level),
        "claim_expires_at": (_aware(task.claim_expires_at).isoformat()
                             if task.claim_expires_at else None),
        "created_at": _aware(task.created_at).isoformat() if task.created_at else None,
        "is_creator": viewer_is_creator,
        "is_assignee": viewer_is_assignee,
        "can_claim": (task.status == "OPEN" and not viewer_is_creator
                      and standing_level >= int(task.min_standing_level)),
        "claim_blocked_reason": (
            "Your own task" if viewer_is_creator
            else None if standing_level >= int(task.min_standing_level)
            else f"Needs standing Level {task.min_standing_level}"
        ),
        "can_submit_proof": viewer_is_assignee and task.status == "CLAIMED",
        "can_approve": viewer_is_creator and task.status == "PROOF_SUBMITTED",
        "can_dispute": (viewer_is_creator or viewer_is_assignee)
                       and task.status in ("CLAIMED", "PROOF_SUBMITTED"),
        "creator": ({"id": str(creator.id), "handle": creator.vendor_handle,
                     "name": creator.business_name} if creator else None),
        "assignee": ({"id": str(assignee.id), "handle": assignee.vendor_handle,
                      "name": assignee.business_name} if assignee else None),
        # The creator needs this to hand to the counterparty; nobody else sees it.
        "handoff_code": handoff_code(task.id) if viewer_is_creator else None,
        "proof": (payload if show_proof else {}),
        "payment_tag": (payment_tag_public(task.payment_tag_snapshot or {})
                        if show_payment_tag else {}),
        # One honest line under every evidence row.
        "signal_note": ("Photo, code and pasted M-Pesa text are structured signals, "
                        "not platform verification. Completing a task adds no standing."),
    }


async def hydrate(db: AsyncSession, tasks: list[CorridorTask], viewer: Vendor,
                  standing_level: int) -> list[dict]:
    ids = {t.creator_user_id for t in tasks} | {t.assignee_user_id for t in tasks if t.assignee_user_id}
    people = {}
    if ids:
        for person in (await db.execute(select(Vendor).where(Vendor.id.in_(ids)))).scalars():
            people[person.id] = person
    return [
        task_out(task, viewer, creator=people.get(task.creator_user_id),
                 assignee=people.get(task.assignee_user_id) if task.assignee_user_id else None,
                 standing_level=standing_level)
        for task in tasks
    ]


async def inbox(db: AsyncSession, vendor: Vendor, days: int = 7) -> dict:
    now = now_utc()
    released = await expire_stale(db, now)
    level = await _standing_level(db, vendor)
    today = now.astimezone(NAIROBI).date()
    end = today + timedelta(days=max(1, min(days, 30)) - 1)
    # The board is local. An open task from another corridor is not this
    # person's commute, and showing it would make the week strip noise.
    viewer_region = corridor(vendor.physical_location)
    open_here = CorridorTask.status == "OPEN"
    if viewer_region:
        open_here = open_here & (CorridorTask.region_slug == viewer_region)
    query = (
        select(CorridorTask)
        .where(CorridorTask.scheduled_date >= today, CorridorTask.scheduled_date <= end)
        .where(or_(
            CorridorTask.creator_user_id == vendor.id,
            CorridorTask.assignee_user_id == vendor.id,
            open_here,
        ))
        .order_by(CorridorTask.scheduled_date, CorridorTask.due_at)
    )
    tasks = (await db.execute(query)).scalars().all()
    output = await hydrate(db, list(tasks), vendor, level)

    days_out = []
    for offset in range(max(1, min(days, 30))):
        day = today + timedelta(days=offset)
        same = [t for t in output if t["scheduled_date"] == day.isoformat()]
        days_out.append({
            "date": day.isoformat(),
            "day_name": ("Today" if offset == 0 else day.strftime("%a")),
            "available": len([t for t in same if t["status"] == "OPEN"]),
            "claimed": len([t for t in same if t["status"] in ("CLAIMED", "PROOF_SUBMITTED")]),
            "mine": len([t for t in same if t["is_assignee"] or t["is_creator"]]),
        })

    earned = (await db.execute(
        select(func.coalesce(func.sum(CorridorTask.worker_payout_kes), 0))
        .where(CorridorTask.assignee_user_id == vendor.id, CorridorTask.status == "COMPLETED")
    )).scalar_one()
    pending = (await db.execute(
        select(func.coalesce(func.sum(CorridorTask.worker_payout_kes), 0))
        .where(CorridorTask.assignee_user_id == vendor.id,
               CorridorTask.status.in_(("CLAIMED", "PROOF_SUBMITTED")))
    )).scalar_one()
    fees = (await db.execute(
        select(func.coalesce(func.sum(CorridorTaskFee.platform_fee_kes), 0))
        .where(CorridorTaskFee.creator_user_id == vendor.id)
    )).scalar_one()

    return {
        "days": days_out,
        "tasks": output,
        "standing_level": level,
        "earnings": {
            "earned_kes": float(money(earned)),
            "pending_kes": float(money(pending)),
            "platform_fees_recorded_kes": float(money(fees)),
            "note": ("Earnings are paid directly by the poster over M-Pesa. The platform "
                     "holds no funds and completed tasks add no standing credit."),
        },
        "released_stale_claims": released["released"],
    }


async def board(db: AsyncSession, vendor: Vendor, *, region_slug: Optional[str] = None,
                town: Optional[str] = None, days: int = 7) -> dict:
    now = now_utc()
    await expire_stale(db, now)
    level = await _standing_level(db, vendor)
    today = now.astimezone(NAIROBI).date()
    end = today + timedelta(days=max(1, min(days, 30)) - 1)
    query = (
        select(CorridorTask)
        .where(CorridorTask.scheduled_date >= today, CorridorTask.scheduled_date <= end)
        .where(CorridorTask.status.in_(("OPEN", "CLAIMED", "PROOF_SUBMITTED")))
    )
    if region_slug:
        query = query.where(CorridorTask.region_slug == region_slug.strip().lower())
    if town:
        query = query.where(CorridorTask.town.ilike(f"%{town.strip()}%"))
    tasks = (await db.execute(query.order_by(CorridorTask.scheduled_date,
                                             CorridorTask.due_at).limit(200))).scalars().all()
    return {
        "tasks": await hydrate(db, list(tasks), vendor, level),
        "standing_level": level,
        "today": today.isoformat(),
    }


async def mine(db: AsyncSession, vendor: Vendor) -> dict:
    now = now_utc()
    await expire_stale(db, now)
    level = await _standing_level(db, vendor)
    posted = (await db.execute(
        select(CorridorTask).where(CorridorTask.creator_user_id == vendor.id)
        .order_by(CorridorTask.created_at.desc()).limit(100)
    )).scalars().all()
    claimed = (await db.execute(
        select(CorridorTask).where(CorridorTask.assignee_user_id == vendor.id)
        .order_by(CorridorTask.created_at.desc()).limit(100)
    )).scalars().all()
    fees = (await db.execute(
        select(CorridorTaskFee).where(CorridorTaskFee.creator_user_id == vendor.id)
        .order_by(CorridorTaskFee.recorded_at.desc()).limit(100)
    )).scalars().all()
    return {
        "posted": await hydrate(db, list(posted), vendor, level),
        "claimed": await hydrate(db, list(claimed), vendor, level),
        "standing_level": level,
        "fees": [{
            "task_id": str(f.task_id),
            "worker_payout_kes": float(money(f.worker_payout_kes)),
            "platform_fee_kes": float(money(f.platform_fee_kes)),
            "fee_pct": float(money(f.fee_pct)),
            "settlement_mode": f.settlement_mode,
            "recorded_at": _aware(f.recorded_at).isoformat(),
        } for f in fees],
    }

"""Scout marketplace records on top of the existing corridor task engine.

The task engine already publishes work, claims it, accepts proof and lets the
merchant approve. It also discloses that payment is direct M-Pesa. What was
missing was the commercial record around it: a rating after completion, the
scout's confirmation that money arrived, and a first-class dispute row.

A pasted M-Pesa message is a **reported** signal. A merchant acknowledgement is
a second signal. Neither makes the platform a party to the payment.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.corridor_tasks.models import CorridorTask, CorridorTaskFee
from app.modules.corridor_tasks import service as task_service
from app.modules.town.audit import audit
from app.modules.town.errors import CommerceError
from app.modules.town.models import (
    DisputeCase, ScoutTaskRating, TaskPaymentConfirmation,
)
from app.services.notification_service import create_notification


def _now() -> datetime:
    return datetime.utcnow()


async def _task(db: AsyncSession, task_id, *, lock: bool = False) -> CorridorTask:
    statement = select(CorridorTask).where(CorridorTask.id == task_id)
    if lock:
        statement = statement.with_for_update()
    task = (await db.execute(statement)).scalar_one_or_none()
    if task is None:
        raise CommerceError("That task was not found.", 404)
    return task


async def board(
    db: AsyncSession, vendor: Vendor, *, region_slug: str | None = None,
    town: str | None = None, days: int = 7,
) -> dict[str, Any]:
    result = await task_service.board(db, vendor, region_slug=region_slug, town=town, days=days)
    tasks = result.get("tasks") or []
    ids = [uuid.UUID(str(task["id"])) for task in tasks]
    if ids:
        ratings = {
            row.task_id: rating_out(row)
            for row in (await db.execute(
                select(ScoutTaskRating).where(ScoutTaskRating.task_id.in_(ids))
            )).scalars().all()
        }
        payments = {
            row.task_id: payment_out(row)
            for row in (await db.execute(
                select(TaskPaymentConfirmation).where(TaskPaymentConfirmation.task_id.in_(ids))
            )).scalars().all()
        }
        for task in tasks:
            task_id = uuid.UUID(str(task["id"]))
            task["rating"] = ratings.get(task_id)
            task["payment_confirmation"] = payments.get(task_id)
    await db.commit()
    return result


async def detail(db: AsyncSession, vendor: Vendor, task_id) -> dict[str, Any]:
    task = await _task(db, task_id)
    if vendor.id not in (task.creator_user_id, task.assignee_user_id):
        raise CommerceError("Only the poster or the assigned scout can see this task.", 403)
    level = await task_service._standing_level(db, vendor)
    rows = await task_service.hydrate(db, [task], vendor, level)
    row = dict(rows[0])
    rating = (await db.execute(
        select(ScoutTaskRating).where(ScoutTaskRating.task_id == task.id)
    )).scalar_one_or_none()
    payment = (await db.execute(
        select(TaskPaymentConfirmation).where(TaskPaymentConfirmation.task_id == task.id)
    )).scalar_one_or_none()
    row["rating"] = rating_out(rating) if rating else None
    row["payment_confirmation"] = payment_out(payment) if payment else None
    return row


def rating_out(row: ScoutTaskRating) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "task_id": str(row.task_id),
        "rating": int(row.rating),
        "note": row.note,
        "scout_vendor_id": str(row.scout_vendor_id),
        "merchant_vendor_id": str(row.merchant_vendor_id),
        "created_at": row.created_at.isoformat(),
    }


def payment_out(row: TaskPaymentConfirmation) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "task_id": str(row.task_id),
        "amount_kes": float(row.amount_kes),
        "payment_method": row.payment_method,
        "payment_reference": row.payment_reference,
        "reported_at": row.created_at.isoformat(),
        "payer_confirmed": row.confirmed_by_vendor_id is not None,
        "status": "confirmed" if row.confirmed_by_vendor_id else "reported",
        "note": (
            "A reported payment is an unverified signal. The platform did not "
            "move this money and does not guarantee it."
        ),
    }


async def rate(
    db: AsyncSession, *, vendor: Vendor, task_id, rating: int, note: str | None = None,
) -> ScoutTaskRating:
    task = await _task(db, task_id, lock=True)
    if task.creator_user_id != vendor.id:
        raise CommerceError("Only the merchant who posted the task can rate the scout.", 403)
    if task.status != "COMPLETED":
        raise CommerceError("Rate a scout after the task is completed.", 409)
    if task.assignee_user_id is None:
        raise CommerceError("This task has no assigned scout.", 409)
    existing = (await db.execute(
        select(ScoutTaskRating).where(ScoutTaskRating.task_id == task.id)
    )).scalar_one_or_none()
    if existing is not None:
        raise CommerceError("This task has already been rated.", 409)
    score = int(rating or 0)
    if score < 1 or score > 5:
        raise CommerceError("Choose a rating from 1 to 5.", 422)
    row = ScoutTaskRating(
        id=uuid.uuid4(),
        task_id=task.id, scout_vendor_id=task.assignee_user_id,
        merchant_vendor_id=task.creator_user_id, rating=score,
        note=(" ".join((note or "").split())[:500] or None),
    )
    db.add(row)
    audit(
        db, action="scout_task_rated", entity_type="corridor_task", entity_id=task.id,
        actor_vendor_id=vendor.id, payload={"rating": score, "scout_id": task.assignee_user_id},
    )
    await create_notification(
        db, task.assignee_user_id, NotificationType.SYSTEM,
        "A merchant rated your work",
        f"“{task.title}” received {score}/5.",
        sender_id=vendor.id, data={"corridor_task_id": str(task.id)},
    )
    await db.flush()
    return row


async def confirm_payment(
    db: AsyncSession, *, vendor: Vendor, task_id, amount_kes: float,
    payment_reference: str, note: str | None = None,
) -> TaskPaymentConfirmation:
    task = await _task(db, task_id, lock=True)
    if task.assignee_user_id != vendor.id:
        raise CommerceError("Only the assigned scout can report a payment.", 403)
    if task.status != "COMPLETED":
        raise CommerceError("A payment can be reported after the merchant approves the task.", 409)
    amount = float(amount_kes or 0)
    if amount <= 0:
        raise CommerceError("Enter the amount that actually arrived.", 422)
    reference = " ".join((payment_reference or "").split())[:120]
    if len(reference) < 3:
        raise CommerceError("Paste the M-Pesa confirmation code or reference.", 422)
    existing = (await db.execute(
        select(TaskPaymentConfirmation).where(TaskPaymentConfirmation.task_id == task.id)
    )).scalar_one_or_none()
    if existing is not None:
        raise CommerceError("This task already has a payment confirmation.", 409)
    row = TaskPaymentConfirmation(
        id=uuid.uuid4(),
        task_id=task.id, payer_vendor_id=task.creator_user_id,
        scout_vendor_id=vendor.id, amount_kes=amount,
        payment_method="direct_mpesa", payment_reference=reference,
        confirmed_by_vendor_id=None,
    )
    db.add(row)
    proof = dict(task.proof_payload or {})
    proof["payment_confirmation"] = {
        "status": "reported", "amount_kes": amount, "reference": reference,
        "note": (note or "")[:300], "at": _now().isoformat(),
        "verification": "unverified_signal",
    }
    task.proof_payload = proof
    audit(
        db, action="scout_payment_reported", entity_type="corridor_task", entity_id=task.id,
        actor_vendor_id=vendor.id, payload={"amount_kes": amount, "reference": reference},
    )
    await create_notification(
        db, task.creator_user_id, NotificationType.SYSTEM,
        "Scout reported a direct payment",
        f"The scout reports KES {amount:,.0f} arrived for “{task.title}”. This is a signal, not a platform confirmation.",
        sender_id=vendor.id, data={"corridor_task_id": str(task.id)},
    )
    await db.flush()
    return row


async def acknowledge_payment(
    db: AsyncSession, *, vendor: Vendor, task_id,
) -> TaskPaymentConfirmation:
    task = await _task(db, task_id, lock=True)
    if task.creator_user_id != vendor.id:
        raise CommerceError("Only the merchant who posted the task can acknowledge payment.", 403)
    row = (await db.execute(
        select(TaskPaymentConfirmation).where(TaskPaymentConfirmation.task_id == task.id)
    )).scalar_one_or_none()
    if row is None:
        raise CommerceError("The scout has not reported a payment yet.", 404)
    if row.confirmed_by_vendor_id is not None and row.confirmed_by_vendor_id != vendor.id:
        return row
    row.confirmed_by_vendor_id = vendor.id
    proof = dict(task.proof_payload or {})
    payment = dict(proof.get("payment_confirmation") or {})
    payment.update({"status": "confirmed", "confirmed_at": _now().isoformat()})
    proof["payment_confirmation"] = payment
    task.proof_payload = proof
    audit(
        db, action="scout_payment_acknowledged", entity_type="corridor_task",
        entity_id=task.id, actor_vendor_id=vendor.id,
        payload={"amount_kes": float(row.amount_kes), "signals": 2},
    )
    await create_notification(
        db, row.scout_vendor_id, NotificationType.SYSTEM,
        "Merchant acknowledged your payment",
        f"The merchant confirmed the direct payment for “{task.title}”.",
        sender_id=vendor.id, data={"corridor_task_id": str(task.id)},
    )
    await db.flush()
    return row


async def open_dispute(
    db: AsyncSession, *, vendor: Vendor, task_id, reason: str,
) -> DisputeCase:
    task = await _task(db, task_id, lock=True)
    if vendor.id not in (task.creator_user_id, task.assignee_user_id):
        raise CommerceError("Only the poster or the scout can dispute this task.", 403)
    if task.status not in ("CLAIMED", "PROOF_SUBMITTED", "COMPLETED"):
        raise CommerceError("This task can no longer be disputed.", 409)
    text = " ".join((reason or "").split())
    if len(text) < 10:
        raise CommerceError("Say what went wrong — at least 10 characters.", 422)
    if task.status != "COMPLETED":
        # Before completion the task itself is frozen. After completion the work
        # stands; only the payment record is in question, so keep COMPLETED.
        try:
            await task_service.dispute(db, vendor, task.id, text)
        except task_service.TaskError as exc:
            raise CommerceError(str(exc), exc.status) from exc
    dispute = DisputeCase(
        id=uuid.uuid4(),
        domain="task", subject_id=task.id, opened_by_vendor_id=vendor.id,
        against_vendor_id=(
            task.assignee_user_id if vendor.id == task.creator_user_id else task.creator_user_id
        ),
        reason=text[:2000], status="open",
    )
    db.add(dispute)
    await db.flush()
    return dispute


async def profile(db: AsyncSession, vendor: Vendor) -> dict[str, Any]:
    completed = int((await db.execute(
        select(func.count(CorridorTask.id)).where(
            CorridorTask.assignee_user_id == vendor.id,
            CorridorTask.status == "COMPLETED",
        )
    )).scalar() or 0)
    rating_row = (await db.execute(
        select(func.avg(ScoutTaskRating.rating), func.count(ScoutTaskRating.id)).where(
            ScoutTaskRating.scout_vendor_id == vendor.id,
        )
    )).one()
    earned = (await db.execute(
        select(func.coalesce(func.sum(CorridorTaskFee.worker_payout_kes), 0)).where(
            CorridorTaskFee.worker_user_id == vendor.id,
        )
    )).scalar() or 0
    fees = (await db.execute(
        select(func.coalesce(func.sum(CorridorTaskFee.platform_fee_kes), 0)).where(
            CorridorTaskFee.worker_user_id == vendor.id,
        )
    )).scalar() or 0
    recent = list((await db.execute(
        select(ScoutTaskRating)
        .where(ScoutTaskRating.scout_vendor_id == vendor.id)
        .order_by(ScoutTaskRating.created_at.desc())
        .limit(10)
    )).scalars().all())
    return {
        "completed_tasks": completed,
        "rating_avg": round(float(rating_row[0] or 0), 2),
        "rating_count": int(rating_row[1] or 0),
        "earned_kes": float(earned),
        "platform_fees_kes": float(fees),
        "recent_ratings": [rating_out(row) for row in recent],
        "settlement": (
            "Merchants pay scouts directly over M-Pesa. The platform records its fee "
            "and never holds the worker's payout."
        ),
        "payment_signal_threshold": int(settings.TOWN_TASK_PAYMENT_SIGNAL_THRESHOLD),
    }


async def fee_catalogue(db: AsyncSession) -> list[dict[str, Any]]:
    from app.modules.corridor_tasks.models import FEE_PCT, TASK_TYPE_LABELS
    from app.modules.town import config as town_config

    return [
        {
            "task_type": key,
            "label": TASK_TYPE_LABELS.get(key, key),
            "fee_pct": float(await town_config.get_pct(db, town_config.SCOUT_FEE_KEYS[key])),
        }
        for key in FEE_PCT
    ]

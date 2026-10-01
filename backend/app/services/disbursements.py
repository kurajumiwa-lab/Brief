"""Disbursement engine (v2.5) — money OUT, with dual approval above the line.

Every payout from a custody sub-account to a M-Pesa wallet goes through here:

* ≤ ``DUAL_APPROVAL_THRESHOLD_KSH``  → approved and queued immediately.
* above the threshold                → ``pending_approval`` until two DIFFERENT
  eligible approvers sign:

  - ``chama_loan`` / ``chama_dividend`` → the chama's chair & treasurer
    (who are not the borrower / recipient).
  - ``pick_settlement`` / ``pick_refund`` → two market-ops staff.

Approval only flips state and queues the PSP call; the money actually moves
when the PSP's ``payout.completed`` webhook arrives (never before).
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.chamas import Chama, ChamaDividend, ChamaLoan, ChamaMember
from app.models.payments import Disbursement
from app.models.vendor import Vendor
from app.services.governance import add_audit_event
from app.services.psp_client import PSPError, get_psp_client


class DisbursementError(Exception):
    pass


async def request_disbursement(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    recipient_phone: str,
    amount_ksh: int,
    source_psp_sub: str,
    requestor_id: Optional[uuid.UUID],
    recipient_name: Optional[str] = None,
    recipient_provider: Optional[str] = None,
    narrative: str = "",
) -> Disbursement:
    """Create a disbursement. Small amounts auto-approve and queue; larger
    ones wait for two approvals. The caller commits."""
    from app.services.psp_client import detect_provider

    if amount_ksh <= 0:
        raise DisbursementError("Disbursement amount must be positive")
    if amount_ksh > settings.DISBURSE_PER_TRANSACTION_LIMIT_KSH:
        raise DisbursementError(f"Amount exceeds the KSh {settings.DISBURSE_PER_TRANSACTION_LIMIT_KSH:,} per-transaction cap")
    if not recipient_phone:
        raise DisbursementError("Recipient has no phone number to pay")

    disbursement = Disbursement(
        entity_type=entity_type,
        entity_id=entity_id,
        recipient_phone=recipient_phone,
        recipient_provider=recipient_provider or detect_provider(recipient_phone),
        recipient_name=recipient_name,
        amount_ksh=amount_ksh,
        source_psp_sub=source_psp_sub,
        psp_api_ref=f"DSB-{uuid.uuid4().hex[:14]}",
        requested_by_vendor_id=requestor_id,
        status="approved" if amount_ksh <= settings.DUAL_APPROVAL_THRESHOLD_KSH else "pending_approval",
    )
    db.add(disbursement)
    await db.flush()

    add_audit_event(
        db, actor_type="vendor" if requestor_id else "system", actor_id=requestor_id,
        action="disbursement_requested", entity_type=entity_type, entity_id=entity_id,
        new_state={"disbursement_id": str(disbursement.id), "amount_ksh": amount_ksh,
                   "source_psp_sub": source_psp_sub, "status": disbursement.status},
        reason_code="auto_approved" if disbursement.status == "approved" else "dual_approval_required",
        explanation=narrative,
    )

    if disbursement.status == "approved":
        await execute_disbursement(db, disbursement)
    else:
        await _notify_approvers(db, disbursement)
    return disbursement


async def execute_disbursement(db: AsyncSession, disbursement: Disbursement) -> None:
    """Queue the payout with the PSP. The webhook finalises it."""
    psp = get_psp_client()
    disbursement.status = "queued"
    await db.flush()
    try:
        result = await psp.disburse(
            phone=disbursement.recipient_phone,
            amount=disbursement.amount_ksh,
            provider=disbursement.recipient_provider,
            api_ref=disbursement.psp_api_ref,
            wallet=disbursement.source_psp_sub,
            narrative=f"{disbursement.entity_type} {disbursement.entity_id}",
        )
    except PSPError as exc:
        disbursement.status = "failed"
        disbursement.failure_reason = str(exc)[:400]
        await db.flush()
        raise DisbursementError(str(exc)) from exc
    disbursement.psp_payout_id = result.get("payout_id")


def _eligible_chama_officers(chama: Chama, membership: ChamaMember) -> bool:
    return membership.role in ("chair", "treasurer")


async def _chama_for_disbursement(db: AsyncSession, disbursement: Disbursement) -> Optional[Chama]:
    if disbursement.entity_type in ("chama_loan",):
        loan = await db.get(ChamaLoan, disbursement.entity_id)
        return await db.get(Chama, loan.chama_id) if loan else None
    if disbursement.entity_type == "chama_dividend":
        dividend = await db.get(ChamaDividend, disbursement.entity_id)
        return await db.get(Chama, dividend.chama_id) if dividend else None
    return None


async def approve_disbursement(db: AsyncSession, disbursement_id: uuid.UUID, vendor: Vendor) -> Disbursement:
    """Record one approval; queue the payout when both are in."""
    disbursement = await db.get(Disbursement, disbursement_id, with_for_update=True)
    if disbursement is None:
        raise HTTPException(404, "Disbursement not found")
    if disbursement.status != "pending_approval":
        raise HTTPException(400, f"This disbursement is {disbursement.status}, not awaiting approval")

    is_chama = disbursement.entity_type in ("chama_loan", "chama_dividend")
    if is_chama:
        chama = await _chama_for_disbursement(db, disbursement)
        if chama is None:
            raise HTTPException(404, "The chama behind this disbursement no longer exists")
        membership = (await db.execute(select(ChamaMember).where(
            ChamaMember.chama_id == chama.id, ChamaMember.vendor_id == vendor.id,
        ))).scalar_one_or_none()
        if membership is None or membership.role not in ("chair", "treasurer"):
            raise HTTPException(403, "Only the chama's chair or treasurer can approve its payouts")
        # Never approve a payout to yourself.
        if disbursement.entity_type == "chama_loan":
            loan = await db.get(ChamaLoan, disbursement.entity_id)
            if loan and loan.borrower_id == vendor.id:
                raise HTTPException(403, "You cannot approve a loan to yourself")
    else:
        role = settings.market_ops_role(vendor.vendor_handle)
        if role is None or role not in ("admin", "clerk", "negotiator"):
            raise HTTPException(403, "Only market operations staff can approve this payout")
        if disbursement.requested_by_vendor_id == vendor.id:
            raise HTTPException(403, "You cannot approve a disbursement you requested")

    now = datetime.utcnow()
    if disbursement.approver_1 is None:
        disbursement.approver_1 = vendor.id
        disbursement.approver_1_at = now
    elif disbursement.approver_1 == vendor.id:
        raise HTTPException(400, "You already approved this disbursement")
    elif disbursement.approver_2 is None:
        disbursement.approver_2 = vendor.id
        disbursement.approver_2_at = now
        disbursement.status = "approved"
        add_audit_event(
            db, actor_type="vendor", actor_id=vendor.id, action="disbursement_dual_approved",
            entity_type=disbursement.entity_type, entity_id=disbursement.entity_id,
            new_state={"disbursement_id": str(disbursement.id), "approver_2": str(vendor.id)},
        )
    else:
        raise HTTPException(400, "This disbursement is fully approved")
    await db.flush()

    if disbursement.status == "approved":
        await execute_disbursement(db, disbursement)
    return disbursement


async def _notify_approvers(db: AsyncSession, disbursement: Disbursement) -> None:
    """Best-effort bell notifications to the people who must approve."""
    from app.models.notification import NotificationType
    from app.services.notification_service import create_notification

    data = {
        "disbursement_id": str(disbursement.id),
        "entity_type": disbursement.entity_type,
        "amount_ksh": disbursement.amount_ksh,
    }
    title = (f"Payout awaiting dual approval: KSh {disbursement.amount_ksh:,}")
    if disbursement.entity_type in ("chama_loan", "chama_dividend"):
        chama = await _chama_for_disbursement(db, disbursement)
        if chama:
            officers = (await db.execute(select(ChamaMember).where(
                ChamaMember.chama_id == chama.id, ChamaMember.role.in_(("chair", "treasurer")),
            ))).scalars().all()
            for officer in officers:
                await create_notification(
                    db, officer.vendor_id, NotificationType.CHAMA_UPDATE, title,
                    f"{chama.name}: approve or decline this payout from the pool.",
                    data=data,
                )
    elif disbursement.entity_type in ("pick_settlement", "pick_refund"):
        # Bell for market-ops staff is covered by the ops board; audit trail
        # carries the record. (Push to staff devices is a later step.)
        pass

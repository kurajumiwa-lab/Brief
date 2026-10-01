"""Payments & custody routes (v2.5).

* ``POST /api/payments/webhook`` — the ONE inbound payment callback. Open to
  unauthenticated callers, secured by the HMAC-SHA256 signature header
  (exactly how a real PSP reaches you); the mock provider delivers to the same
  function in-process.
* ``/api/payments/intents*`` — a vendor's own collection intents.
* ``/api/payments/custody/*`` — market-ops finance desk: balances, ledger,
  disbursement approvals, disputes, reconciliation.
"""

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.market_locks import LockPick
from app.models.payments import (
    DISPUTE_HOLD, Disbursement, DisputeHold, PaymentIntent, ReconciliationRun,
)
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.routes.market_locks import require_market_ops
from app.services import custody, psp_client, reconciliation as recon
from app.services.disbursements import approve_disbursement

router = APIRouter()


# ---------------------------------------------------------------------------
# Webhook (open; signature-verified)
# ---------------------------------------------------------------------------

@router.post("/webhook")
async def psp_webhook(request: Request):
    """Single endpoint for ALL payment events. Always answers 200 to stop PSP
    retries; processing is idempotent on the intent/disbursement state."""
    raw = await request.body()
    signature = request.headers.get("X-Webhook-Signature")
    if not psp_client.verify_webhook_signature(raw, signature):
        raise HTTPException(401, "Invalid webhook signature")
    try:
        event = await request.json()
    except Exception:
        raise HTTPException(400, "Webhook body must be JSON")
    from app.services.payments import process_inbound_event

    handled = await process_inbound_event(event)
    if not handled:
        # Non-2xx so a real PSP retries; the handler is idempotent, so the
        # retry is safe once the creating transaction has committed.
        raise HTTPException(502, "Event not processed yet; please retry")
    return {"status": "received"}


# ---------------------------------------------------------------------------
# Vendor intents
# ---------------------------------------------------------------------------

def _intent_out(intent: PaymentIntent) -> dict:
    return {
        "id": str(intent.id),
        "entity_type": intent.entity_type,
        "entity_id": str(intent.entity_id),
        "amount_ksh": intent.amount_ksh,
        "provider": intent.provider,
        "target_psp_sub": intent.target_psp_sub,
        "psp_api_ref": intent.psp_api_ref,
        "status": intent.status,
        "failure_reason": intent.failure_reason,
        "mpesa_receipt": intent.mpesa_receipt,
        "created_at": intent.created_at.isoformat() if intent.created_at else None,
        "completed_at": intent.completed_at.isoformat() if intent.completed_at else None,
    }


@router.get("/intents")
async def my_intents(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = None,
):
    stmt = select(PaymentIntent).where(PaymentIntent.vendor_id == vendor.id)
    if status:
        stmt = stmt.where(PaymentIntent.status == status)
    intents = (await db.execute(stmt.order_by(PaymentIntent.created_at.desc()).limit(100))).scalars().all()
    return [_intent_out(i) for i in intents]


@router.get("/intents/{intent_id}")
async def my_intent(
    intent_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    intent = await db.get(PaymentIntent, intent_id)
    if intent is None or intent.vendor_id != vendor.id:
        raise HTTPException(404, "Payment intent not found")
    return _intent_out(intent)


# ---------------------------------------------------------------------------
# Custody desk (market ops)
# ---------------------------------------------------------------------------

@router.get("/custody/balances")
async def custody_balances(
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "clerk")),
    db: AsyncSession = Depends(get_db),
):
    """PSP wallet vs ledger balance per sub-account (the dashboard source)."""
    psp = psp_client.get_psp_client()
    ledger = await custody.all_sub_balances(db)
    last_runs = {
        row.psp_sub_account: row
        for row in (await db.execute(
            select(ReconciliationRun).where(
                ReconciliationRun.run_date == datetime.utcnow().date(),
            )
        )).scalars()
    }
    balances = []
    for wallet in await psp.list_wallets():
        psp_balance = 0
        try:
            psp_balance = await psp.get_wallet_balance(wallet)
        except psp_client.PSPError:
            pass
        ledger_balance = ledger.get(wallet, 0)
        run = last_runs.get(wallet)
        balances.append({
            "psp_sub_account": wallet,
            "psp_balance_ksh": int(psp_balance),
            "ledger_balance_ksh": int(ledger_balance),
            "variance_ksh": int(psp_balance) - int(ledger_balance),
            "last_reconciliation": None if run is None else {
                "status": run.status, "variance_ksh": run.variance_ksh,
                "run_date": run.run_date.isoformat(),
            },
        })
    return {"balances": balances, "dual_approval_threshold_ksh": settings.DUAL_APPROVAL_THRESHOLD_KSH}


@router.get("/custody/ledger")
async def custody_ledger(
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "clerk")),
    db: AsyncSession = Depends(get_db),
    sub: Optional[str] = None,
    vendor_id: Optional[uuid.UUID] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[uuid.UUID] = None,
    limit: int = Query(100, le=500),
):
    from app.models.payments import CustodyLedgerEntry

    stmt = select(CustodyLedgerEntry)
    if sub:
        stmt = stmt.where(CustodyLedgerEntry.psp_sub_account == sub)
    if vendor_id:
        stmt = stmt.where(CustodyLedgerEntry.vendor_id == vendor_id)
    if entity_type:
        stmt = stmt.where(CustodyLedgerEntry.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(CustodyLedgerEntry.entity_id == entity_id)
    rows = (await db.execute(stmt.order_by(
        CustodyLedgerEntry.created_at.desc(), CustodyLedgerEntry.id.desc()
    ).limit(limit))).scalars().all()
    return [{
        "id": str(r.id), "psp_sub_account": r.psp_sub_account,
        "transaction_type": r.transaction_type, "amount_ksh": r.amount_ksh,
        "direction": r.direction, "running_balance_ksh": r.running_balance_ksh,
        "psp_reference": r.psp_reference, "mpesa_receipt": r.mpesa_receipt,
        "vendor_id": str(r.vendor_id) if r.vendor_id else None,
        "entity_type": r.entity_type,
        "entity_id": str(r.entity_id) if r.entity_id else None,
        "reversal_of": str(r.reversal_of) if r.reversal_of else None,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]


@router.get("/disbursements")
async def list_disbursements(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = None,
    limit: int = 100,
):
    """A vendor sees their own payouts (as borrower/recipient) plus — if they
    are a chama officer or market ops — anything awaiting their approval."""
    is_ops = settings.market_ops_role(vendor.vendor_handle) in ("admin", "clerk", "negotiator")
    stmt = select(Disbursement)
    if status:
        stmt = stmt.where(Disbursement.status == status)
    rows = (await db.execute(stmt.order_by(Disbursement.created_at.desc()).limit(limit))).scalars().all()
    from app.services.disbursements import _chama_for_disbursement

    out = []
    for d in rows:
        visible = is_ops or d.requested_by_vendor_id == vendor.id
        if not visible:
            chama = await _chama_for_disbursement(db, d)
            if chama:
                from app.models.chamas import ChamaMember
                membership = (await db.execute(select(ChamaMember).where(
                    ChamaMember.chama_id == chama.id, ChamaMember.vendor_id == vendor.id,
                ))).scalar_one_or_none()
                visible = membership is not None
        if not visible:
            continue
        out.append({
            "id": str(d.id), "entity_type": d.entity_type, "entity_id": str(d.entity_id),
            "amount_ksh": d.amount_ksh, "source_psp_sub": d.source_psp_sub,
            "recipient_phone": d.recipient_phone, "recipient_name": d.recipient_name,
            "status": d.status, "approver_1": str(d.approver_1) if d.approver_1 else None,
            "approver_2": str(d.approver_2) if d.approver_2 else None,
            "failure_reason": d.failure_reason,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "completed_at": d.completed_at.isoformat() if d.completed_at else None,
        })
    return out


@router.post("/disbursements/{disbursement_id}/approve")
async def approve_payout(
    disbursement_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    disbursement = await approve_disbursement(db, disbursement_id, vendor)
    await db.commit()
    return {
        "id": str(disbursement.id), "status": disbursement.status,
        "approver_1": str(disbursement.approver_1) if disbursement.approver_1 else None,
        "approver_2": str(disbursement.approver_2) if disbursement.approver_2 else None,
    }


# ---------------------------------------------------------------------------
# Disputes
# ---------------------------------------------------------------------------

@router.get("/disputes")
async def list_disputes(
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "clerk", "negotiator")),
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = None,
):
    stmt = select(DisputeHold)
    if status:
        stmt = stmt.where(DisputeHold.status == status)
    rows = (await db.execute(stmt.order_by(DisputeHold.created_at.desc()).limit(200))).scalars().all()
    return [{
        "id": str(h.id), "entity_type": h.entity_type, "entity_id": str(h.entity_id),
        "vendor_id": str(h.vendor_id) if h.vendor_id else None,
        "amount_ksh": h.amount_ksh, "reason": h.reason, "status": h.status,
        "resolution_note": h.resolution_note,
        "created_at": h.created_at.isoformat() if h.created_at else None,
    } for h in rows]


class DisputeResolution(BaseModel):
    outcome: str = Field(pattern="^(refund_to_vendor|release_to_supplier|escalate)$")
    note: Optional[str] = Field(None, max_length=2000)


@router.post("/disputes/{dispute_id}/resolve")
async def resolve_dispute(
    dispute_id: uuid.UUID,
    data: DisputeResolution,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin")),
    db: AsyncSession = Depends(get_db),
):
    from app.services import lock_settlement

    hold = await db.get(DisputeHold, dispute_id, with_for_update=True)
    if hold is None:
        raise HTTPException(404, "Dispute not found")
    result = await lock_settlement.resolve_dispute(db, hold, staff[0], data.outcome, data.note or "")
    await db.commit()
    return result


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------

@router.get("/reconciliation/runs")
async def reconciliation_runs(
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "clerk")),
    db: AsyncSession = Depends(get_db),
    limit: int = 100,
):
    rows = (await db.execute(
        select(ReconciliationRun).order_by(
            ReconciliationRun.run_date.desc(), ReconciliationRun.psp_sub_account
        ).limit(limit)
    )).scalars().all()
    return [{
        "id": str(r.id), "run_date": r.run_date.isoformat(),
        "psp_sub_account": r.psp_sub_account,
        "psp_reported_balance": r.psp_reported_balance,
        "ledger_balance": r.ledger_balance,
        "variance_ksh": r.variance_ksh, "status": r.status,
        "variance_explanation": r.variance_explanation,
        "resolved_by": str(r.resolved_by) if r.resolved_by else None,
    } for r in rows]


@router.post("/reconciliation/run")
async def trigger_reconciliation(
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin")),
    db: AsyncSession = Depends(get_db),
):
    runs = await recon.run_reconciliation(db)
    await db.commit()
    return [{
        "id": str(r.id), "run_date": r.run_date.isoformat(),
        "psp_sub_account": r.psp_sub_account,
        "psp_reported_balance": r.psp_reported_balance,
        "ledger_balance": r.ledger_balance,
        "variance_ksh": r.variance_ksh, "status": r.status,
        "variance_explanation": r.variance_explanation,
        "resolved_by": str(r.resolved_by) if r.resolved_by else None,
    } for r in runs]


class ResolveVariance(BaseModel):
    explanation: str = Field(min_length=5, max_length=400)


@router.post("/reconciliation/runs/{run_id}/resolve")
async def resolve_variance(
    run_id: uuid.UUID,
    data: ResolveVariance,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin")),
    db: AsyncSession = Depends(get_db),
):
    run = await recon.resolve_variance(db, run_id, staff[0].id, data.explanation)
    await db.commit()
    return {"id": str(run.id), "status": run.status}

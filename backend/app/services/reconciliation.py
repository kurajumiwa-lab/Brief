"""Daily PSP ↔ ledger reconciliation (v2.5).

The most important operational process in the platform: if the ledger drifts
from the PSP's wallets, we have a financial crisis. Every day we compare each
sub-account's ledger running balance against the PSP-reported wallet balance,
record a `ReconciliationRun` row, and flag variances beyond the tolerance.

Orphan detection (belt and braces): completed intents with no matching ledger
entry older than an hour mean a webhook was lost — the PSP's dashboard will
show the same mismatch.
"""

import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.governance import GovernanceAuditEvent
from app.models.payments import PaymentIntent, ReconciliationRun
from app.services import custody, psp_client
from app.services.governance import add_audit_event

log = logging.getLogger("brief.recon")


async def run_reconciliation(db: AsyncSession, run_date=None) -> list[ReconciliationRun]:
    """Reconcile every wallet the PSP reports. Idempotent per (date, wallet)."""
    psp = psp_client.get_psp_client()
    today = run_date or datetime.utcnow().date()
    tolerance = settings.RECONCILIATION_VARIANCE_TOLERANCE_KSH
    runs: list[ReconciliationRun] = []

    for wallet in await psp.list_wallets():
        try:
            psp_balance = await psp.get_wallet_balance(wallet)
        except psp_client.PSPError as exc:
            log.error("recon: cannot read wallet %s: %s", wallet, exc)
            continue
        ledger_balance = await custody.sub_balance(db, wallet)
        variance = int(psp_balance) - int(ledger_balance)
        status = "matched" if abs(variance) <= tolerance else "variance_found"

        run = (await db.execute(select(ReconciliationRun).where(
            ReconciliationRun.run_date == today,
            ReconciliationRun.psp_sub_account == wallet,
        ))).scalar_one_or_none()
        if run is None:
            run = ReconciliationRun(
                run_date=today, psp_sub_account=wallet,
                psp_reported_balance=int(psp_balance), ledger_balance=int(ledger_balance),
                variance_ksh=variance, status=status,
            )
            db.add(run)
        else:
            run.psp_reported_balance = int(psp_balance)
            run.ledger_balance = int(ledger_balance)
            run.variance_ksh = variance
            run.status = status
        if status == "variance_found":
            run.variance_explanation = (
                f"PSP {psp_balance} vs ledger {ledger_balance} (tolerance ±{tolerance}). "
                "Check the PSP dashboard and the webhook log before touching either."
            )
        await db.flush()
        runs.append(run)

        if status == "variance_found":
            log.error("RECONCILIATION VARIANCE: %s PSP=%s Ledger=%s Diff=%s",
                      wallet, psp_balance, ledger_balance, variance)
            add_audit_event(
                db, actor_type="system", actor_id=None,
                action="reconciliation_variance", entity_type="custody_wallet",
                entity_id=uuid.uuid5(uuid.NAMESPACE_URL, f"wallet:{wallet}"),
                new_state={"wallet": wallet, "psp_balance": psp_balance,
                           "ledger_balance": ledger_balance, "variance": variance},
                reason_code="variance_beyond_tolerance",
                explanation=run.variance_explanation,
            )

    orphans = await find_orphan_intents(db)
    if orphans:
        for orphan in orphans:
            log.error("ORPHAN PAYMENT: intent=%s api_ref=%s amount=%s — webhook likely missed",
                      orphan.id, orphan.psp_api_ref, orphan.amount_ksh)
        add_audit_event(
            db, actor_type="system", actor_id=None,
            action="reconciliation_orphan_intents", entity_type="payment_intent",
            entity_id=orphans[0].id,
            new_state={"count": len(orphans), "ids": [str(o.id) for o in orphans[:10]]},
            reason_code="orphan_intents",
        )

    await db.flush()
    return runs


async def find_orphan_intents(db: AsyncSession) -> list[PaymentIntent]:
    """Completed intents with no ledger row (older than an hour)."""
    cutoff = datetime.utcnow() - timedelta(hours=1)
    rows = (await db.execute(
        select(PaymentIntent).where(
            PaymentIntent.status == "completed",
            PaymentIntent.completed_at <= cutoff,
        )
    )).scalars().all()
    orphans = []
    for intent in rows:
        has_entry = (await db.execute(select(custody.CustodyLedgerEntry.id).where(
            custody.CustodyLedgerEntry.intent_id == intent.id,
        ).limit(1))).scalar_one_or_none()
        if has_entry is None:
            orphans.append(intent)
    return orphans


async def reconcile_due(db: AsyncSession) -> int:
    """Worker hook: run the daily reconciliation when its hour has passed and
    today has no runs yet. Returns the number of wallets reconciled (0 = not
    due / already done)."""
    now = datetime.utcnow()
    if now.hour < settings.DAILY_RECONCILIATION_HOUR_UTC:
        return 0
    existing = (await db.execute(select(ReconciliationRun.id).where(
        ReconciliationRun.run_date == now.date(),
    ).limit(1))).scalar_one_or_none()
    if existing is not None:
        return 0
    runs = await run_reconciliation(db)
    log.info("daily reconciliation: %d wallets checked", len(runs))
    return len(runs)


async def resolve_variance(db: AsyncSession, run_id: uuid.UUID, resolver_id: uuid.UUID,
                           explanation: str) -> ReconciliationRun:
    run = await db.get(ReconciliationRun, run_id)
    if run is None:
        raise ValueError("reconciliation run not found")
    if run.status != "variance_found":
        raise ValueError(f"run is {run.status}, not variance_found")
    run.status = "resolved"
    run.resolved_by = resolver_id
    run.variance_explanation = (explanation or run.variance_explanation or "")[:400]
    add_audit_event(
        db, actor_type="vendor", actor_id=resolver_id,
        action="reconciliation_resolved", entity_type="custody_wallet",
        entity_id=uuid.uuid5(uuid.NAMESPACE_URL, f"wallet:{run.psp_sub_account}"),
        new_state={"run_id": str(run.id), "explanation": run.variance_explanation},
    )
    return run

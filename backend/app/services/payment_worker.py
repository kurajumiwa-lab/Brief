"""Payments housekeeping scheduler (v2.5).

Runs alongside the POS scheduler: one pass every minute (cheap, idempotent
queries), each job in its own transaction so one failure never blocks the
others:

* expire stale pending payment intents (the vendor's prompt timed out at the
  PSP; the seat/claim is freed and they can retry),
* default chama loans past their due cycle (Biashara Score event + audit),
* the daily PSP ↔ ledger reconciliation at the configured hour.
"""

import asyncio
import logging

from app.config import settings
from app.database import async_session

log = logging.getLogger("brief.payments_worker")


async def expire_stale_intents(session_factory) -> int:
    """Pending intents older than the TTL are expired (not failed — the PSP
    may still deliver a late success, which the webhook handles by leaving
    the intent terminal and reconciliation reconciles the wallet)."""
    from datetime import datetime, timedelta

    from sqlalchemy import select, update

    from app.models.notification import NotificationType
    from app.models.payments import PaymentIntent
    from app.services.notification_service import create_notification

    async with session_factory() as db:
        cutoff = datetime.utcnow() - timedelta(minutes=settings.PAYMENT_INTENT_TTL_MINUTES)
        stale = (await db.execute(select(PaymentIntent).where(
            PaymentIntent.status == "pending",
            PaymentIntent.created_at < cutoff,
        ).with_for_update())).scalars().all()
        count = 0
        for intent in stale:
            intent.status = "expired"
            intent.failure_reason = "Payment window closed without confirmation"
            await db.flush()
            await create_notification(
                db, intent.vendor_id, NotificationType.PAYMENT_UPDATE,
                "Payment window closed",
                f"Your KSh {intent.amount_ksh:,} payment ({intent.entity_type}) was not confirmed in time. "
                "If you did pay, it will still be credited — otherwise you can retry.",
                data={"intent_id": str(intent.id)},
            )
            count += 1
        if count:
            await db.commit()
            log.info("expired %d stale payment intents", count)
        return count


async def flag_chama_defaults(session_factory) -> int:
    from app.services import chamas

    async with session_factory() as db:
        n = await chamas.flag_overdue_loans(db)
        if n:
            await db.commit()
            log.warning("flagged %d overdue chama loans as defaulted", n)
        return n


async def flag_murabaha_defaults(session_factory) -> int:
    from app.services import halal

    async with session_factory() as db:
        n = await halal.flag_overdue_murabaha(db)
        if n:
            await db.commit()
            log.warning("flagged %d overdue murabaha advances as defaulted", n)
        return n


async def run_daily_reconciliation(session_factory) -> int:
    from app.services import reconciliation

    async with session_factory() as db:
        n = await reconciliation.reconcile_due(db)
        if n:
            await db.commit()
        return n


async def scheduler_loop(session_factory, interval_seconds: int = 60) -> None:
    log.info("💳 payments scheduler: every %ss", interval_seconds)
    while True:
        for name, job in (("expire intents", expire_stale_intents),
                          ("chama defaults", flag_chama_defaults),
                          ("murabaha defaults", flag_murabaha_defaults),
                          ("daily reconciliation", run_daily_reconciliation)):
            try:
                await job(session_factory)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("payments scheduler: %s pass failed", name)
        await asyncio.sleep(interval_seconds)

"""Payments service (v2.5) — collection intents and the PSP webhook.

One inbound webhook carries every terminal payment event. The handler:

1. finds the intent/disbursement by the PSP's ``api_ref`` (our reference),
2. ignores duplicates (state already terminal → idempotent no-op),
3. in ONE transaction: updates the record, writes the append-only ledger
   entry (only now, with the confirmed PSP reference) and fires the
   entity hook (escrow / chama / …),
4. always answers 200 to the PSP.

The webhook sink is registered with the PSP client at import time; the mock
provider delivers events in-process, real providers over HTTP.
"""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.notification import NotificationType
from app.models.payments import PaymentIntent
from app.models.vendor import Vendor
from app.services import custody, psp_client
from app.services.custody import CustodyError
from app.services.governance import add_audit_event
from app.services.notification_service import create_notification

log = logging.getLogger("brief.payments")


class PaymentError(Exception):
    pass


# ---------------------------------------------------------------------------
# Collections (money IN)
# ---------------------------------------------------------------------------

def validate_collection(vendor: Vendor, amount_ksh: int) -> None:
    """Pre-flight guardrails before an intent is created."""
    if amount_ksh <= 0:
        raise PaymentError("Amount must be positive")
    if amount_ksh > settings.COLLECT_PER_TRANSACTION_LIMIT_KSH:
        raise PaymentError(
            f"Amount exceeds the KSh {settings.COLLECT_PER_TRANSACTION_LIMIT_KSH:,} per-transaction cap")
    if not vendor.phone:
        raise PaymentError("Add your M-Pesa number before paying (vendor profile → phone)")
    if settings.PAYMENT_REQUIRE_VERIFIED_PHONE and not vendor.phone_verified_at:
        raise PaymentError("Your phone number is not verified")
    if vendor.fraud_suspended_at:
        raise PaymentError("This account is suspended from payments")


async def check_daily_collection_limit(db: AsyncSession, vendor_id: uuid.UUID, amount_ksh: int) -> None:
    daily = (await db.execute(
        select(func.coalesce(func.sum(PaymentIntent.amount_ksh), 0)).where(
            PaymentIntent.vendor_id == vendor_id,
            PaymentIntent.status.in_(("pending", "completed")),
            PaymentIntent.created_at >= datetime.utcnow() - timedelta(days=1),
        )
    )).scalar_one()
    if int(daily or 0) + amount_ksh > settings.COLLECT_DAILY_PER_VENDOR_LIMIT_KSH:
        raise PaymentError(
            f"Daily collection limit of KSh {settings.COLLECT_DAILY_PER_VENDOR_LIMIT_KSH:,} reached")


async def find_active_intent(
    db: AsyncSession, vendor_id: uuid.UUID, entity_type: str, entity_id: uuid.UUID,
) -> Optional[PaymentIntent]:
    """A pending or just-completed intent for this exact (entity, vendor)."""
    return (await db.execute(
        select(PaymentIntent).where(
            PaymentIntent.vendor_id == vendor_id,
            PaymentIntent.entity_type == entity_type,
            PaymentIntent.entity_id == entity_id,
            PaymentIntent.status.in_(("pending", "completed")),
        ).order_by(PaymentIntent.created_at.desc()).limit(1)
    )).scalar_one_or_none()


async def create_collection_intent(
    db: AsyncSession,
    vendor: Vendor,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    amount_ksh: int,
    target_psp_sub: str,
    provider: Optional[str] = None,
    phone: Optional[str] = None,
) -> PaymentIntent:
    """Validate and persist a pending collection intent (committed).

    The PSP handoff is a separate step — :func:`start_collection` — so the
    caller can commit any dependent rows that reference the intent before
    the PSP's webhook can land.
    """
    validate_collection(vendor, amount_ksh)
    await check_daily_collection_limit(db, vendor.id, amount_ksh)

    phone = phone or vendor.phone
    provider = provider or psp_client.detect_provider(phone)

    existing = await find_active_intent(db, vendor.id, entity_type, entity_id)
    if existing is not None and existing.status == "pending":
        raise HTTPException(409, "A payment for this is already in progress")

    intent = PaymentIntent(
        vendor_id=vendor.id,
        entity_type=entity_type,
        entity_id=entity_id,
        amount_ksh=amount_ksh,
        provider=provider,
        phone=phone,
        target_psp_sub=target_psp_sub,
        psp_api_ref=f"COL-{uuid.uuid4().hex[:14]}",
        status="pending",
    )
    db.add(intent)
    await db.commit()          # the PSP must be able to see it when the webhook lands
    await db.refresh(intent)
    return intent


async def start_collection(db: AsyncSession, intent: PaymentIntent) -> PaymentIntent:
    """Hand a COMMITTED intent to the PSP (separate step on purpose: callers
    can commit dependent rows — e.g. a loan's repayment_intent_id — before
    the PSP's webhook can land, so webhook and request never fight over the
    same rows).

    The money only counts once the ``payment.completed`` webhook arrives.
    """
    psp = psp_client.get_psp_client()
    try:
        await psp.collect(
            phone=intent.phone, amount=intent.amount_ksh, provider=intent.provider,
            api_ref=intent.psp_api_ref, wallet=intent.target_psp_sub,
            narrative=intent.entity_type,
        )
    except psp_client.PSPError as exc:
        intent.status = "failed"
        intent.failure_reason = str(exc)[:400]
        await db.commit()
        raise PaymentError(f"Payment could not be started: {exc}") from exc

    add_audit_event(
        db, actor_type="vendor", actor_id=intent.vendor_id, action="collection_requested",
        entity_type=intent.entity_type, entity_id=intent.entity_id,
        new_state={"intent_id": str(intent.id), "amount_ksh": intent.amount_ksh,
                   "target_psp_sub": intent.target_psp_sub},
    )
    await db.commit()
    await db.refresh(intent)
    return intent


# ---------------------------------------------------------------------------
# Webhook processing (the ledger gets written HERE)
# ---------------------------------------------------------------------------

LEDER_TYPE_FOR_ENTITY = {
    "pick_deposit": "collection_in",
    "pick_full_payment": "collection_in",
    "chama_deposit": "chama_pool_in",
    "chama_loan_repayment": "chama_repayment_in",
    "sacco_savings": "sacco_deposit_in",
    "sacco_loan_repayment": "sacco_repayment_in",
    "pool_ride_share": "collection_in",
    # v2.6 halal-trade: murabaha repayment into the Sacco window; remitted
    # musharakah profit into the chama pool.
    "murabaha_repayment": "collection_in",
    "musharakah_profit": "chama_pool_in",
}


async def process_inbound_event(event: dict) -> bool:
    """Webhook sink. Owns its session + transaction, so a webhook never
    shares a transaction with the request that created the intent.

    Returns True when the event was applied (or was a safe duplicate);
    False when it could not be applied right now (e.g. the intent doesn't
    exist yet because the creating request hasn't committed) — senders are
    expected to retry, exactly like a real PSP would.
    """
    event_type = event.get("type")
    api_ref = event.get("api_ref")
    if not event_type or not api_ref:
        log.warning("webhook without type/api_ref ignored: %s", event)
        return False

    async with async_session() as db:
        try:
            if event_type == "payment.completed":
                handled = await _on_payment_completed(db, event)
            elif event_type == "payment.failed":
                handled = await _on_payment_failed(db, event)
            elif event_type == "payout.completed":
                handled = await _on_payout_completed(db, event)
            elif event_type == "payout.failed":
                handled = await _on_payout_failed(db, event)
            elif event_type == "refund.completed":
                handled = await _on_refund_completed(db, event)
            else:
                log.info("webhook type %s not handled", event_type)
                return False
            if not handled:
                return False
            await db.commit()
            return True
        except CustodyError as exc:
            await db.rollback()
            log.error("webhook %s rejected by custody rules: %s", event_type, exc)
            return False
        except Exception:
            await db.rollback()
            log.exception("webhook %s failed (api_ref=%s)", event_type, api_ref)
            return False


async def _find_intent(db: AsyncSession, event: dict) -> Optional[PaymentIntent]:
    intent = (await db.execute(select(PaymentIntent).where(
        PaymentIntent.psp_api_ref == event.get("api_ref")
    ).with_for_update())).scalar_one_or_none()
    if intent is None and event.get("id"):
        intent = (await db.execute(select(PaymentIntent).where(
            PaymentIntent.psp_payment_id == event.get("id")
        ).with_for_update())).scalar_one_or_none()
    return intent


async def _on_payment_completed(db: AsyncSession, event: dict) -> bool:
    intent = await _find_intent(db, event)
    if intent is None:
        log.warning("orphan payment.completed: api_ref=%s id=%s", event.get("api_ref"), event.get("id"))
        return False
    if intent.status == "completed":
        return True  # idempotent duplicate
    if intent.status != "pending":
        log.warning("payment.completed for %s intent; ignoring", intent.status)
        return True

    intent.status = "completed"
    intent.psp_payment_id = str(event.get("id") or "")
    intent.mpesa_receipt = str(event.get("mpesa_receipt") or "")[:40] or None
    intent.completed_at = datetime.utcnow()
    await db.flush()

    await custody.write_ledger_entry(
        db,
        psp_sub_account=intent.target_psp_sub,
        transaction_type=LEDER_TYPE_FOR_ENTITY.get(intent.entity_type, "collection_in"),
        amount_ksh=intent.amount_ksh,
        direction="credit",
        psp_reference=intent.psp_payment_id or intent.psp_api_ref,
        vendor_id=intent.vendor_id,
        entity_type=intent.entity_type,
        entity_id=intent.entity_id,
        intent_id=intent.id,
        provider=intent.provider,
        mpesa_receipt=intent.mpesa_receipt,
    )

    await _post_payment_hook(db, intent)
    return True


async def _on_payment_failed(db: AsyncSession, event: dict) -> bool:
    intent = await _find_intent(db, event)
    if intent is None:
        log.warning("orphan payment.failed: api_ref=%s", event.get("api_ref"))
        return False
    if intent.status != "pending":
        return True  # stale event for an already-resolved intent
    intent.status = "failed"
    intent.psp_payment_id = str(event.get("id") or "") or None
    intent.failure_reason = str(event.get("failure_reason") or "Payment failed")[:400]
    intent.completed_at = datetime.utcnow()
    await db.flush()
    await create_notification(
        db, intent.vendor_id, NotificationType.PAYMENT_UPDATE,
        "Payment did not complete",
        f"{intent.failure_reason} (KSh {intent.amount_ksh:,}, {intent.entity_type}). You can retry.",
        data={"intent_id": str(intent.id)},
    )
    return True


async def _on_refund_completed(db: AsyncSession, event: dict) -> bool:
    intent = await _find_intent(db, event)
    if intent is None:
        log.warning("orphan refund.completed: api_ref=%s", event.get("api_ref"))
        return False
    if intent.status == "refunded":
        return True  # idempotent duplicate
    if intent.status != "completed":
        log.warning("refund.completed for %s intent; ignoring", intent.status)
        return True
    intent.status = "refunded"
    intent.psp_payment_id = str(event.get("id") or intent.psp_payment_id or "")
    await db.flush()
    # The originating entity keeps its funds state; a refund is a PSP-side
    # claw-back. (v2.5 flows use dispute disbursements instead.)
    add_audit_event(
        db, actor_type="system", actor_id=None, action="refund_completed",
        entity_type=intent.entity_type, entity_id=intent.entity_id,
        new_state={"intent_id": str(intent.id), "amount_ksh": intent.amount_ksh},
    )
    return True


async def _post_payment_hook(db: AsyncSession, intent: PaymentIntent) -> None:
    """Entity-specific downstream action, in the same transaction."""
    from app.services import chamas, lock_settlement  # local: avoids import cycle

    if intent.entity_type in ("pick_full_payment", "pick_deposit"):
        await lock_settlement.on_pick_payment_completed(db, intent)
    elif intent.entity_type == "chama_deposit":
        await chamas.on_deposit_completed(db, intent)
    elif intent.entity_type == "chama_loan_repayment":
        await chamas.on_repayment_completed(db, intent)
    elif intent.entity_type == "musharakah_profit":
        await chamas.on_profit_received(db, intent)
    elif intent.entity_type == "murabaha_repayment":
        from app.services import halal
        await halal.on_murabaha_repaid(db, intent)
    else:
        log.info("no post-payment hook for entity_type=%s", intent.entity_type)


async def _find_disbursement(db: AsyncSession, event: dict):
    from app.models.payments import Disbursement

    d = (await db.execute(select(Disbursement).where(
        Disbursement.psp_api_ref == event.get("api_ref")
    ).with_for_update())).scalar_one_or_none()
    if d is None and event.get("id"):
        d = (await db.execute(select(Disbursement).where(
            Disbursement.psp_payout_id == event.get("id")
        ).with_for_update())).scalar_one_or_none()
    return d


async def _on_payout_completed(db: AsyncSession, event: dict) -> bool:
    from app.models.payments import Disbursement
    from app.services import chamas, disbursements, lock_settlement

    d = await _find_disbursement(db, event)
    if d is None:
        log.warning("orphan payout.completed: api_ref=%s", event.get("api_ref"))
        return False
    if d.status == "completed":
        return True  # idempotent duplicate
    if d.status not in ("queued", "approved"):
        log.warning("payout.completed for %s disbursement; ignoring", d.status)
        return True

    d.status = "completed"
    d.psp_payout_id = str(event.get("id") or "")
    d.completed_at = datetime.utcnow()
    await db.flush()

    # The money has moved in the PSP; account for it in the ledger.
    ledger_type = _LEDGER_TYPE_FOR_PAYOUT.get(d.entity_type)
    if ledger_type is None:
        # Reserved Layer-3 entity type: the money moved but we have no ledger
        # vocabulary for it yet. Fail loud (the webhook retries, the
        # disbursement stays visible in the custody desk) instead of writing
        # a silently-wrong ledger type.
        log.critical(
            "payout.completed for entity_type=%s (api_ref=%s): no ledger "
            "transaction type mapped — refusing to book it", d.entity_type, d.psp_api_ref,
        )
        raise ValueError(f"No ledger transaction type for payout entity_type={d.entity_type}")

    await custody.write_ledger_entry(
        db,
        psp_sub_account=d.source_psp_sub,
        transaction_type=ledger_type,
        amount_ksh=d.amount_ksh,
        direction="debit",
        psp_reference=d.psp_payout_id or d.psp_api_ref,
        entity_type=d.entity_type,
        entity_id=d.entity_id,
        approved_by=d.approver_1,
        approved_by_2=d.approver_2,
        notes=f"payout to {d.recipient_phone}",
    )

    if d.entity_type == "pick_settlement":
        await lock_settlement.on_settlement_completed(db, d)
    elif d.entity_type == "pick_refund":
        await lock_settlement.on_refund_completed(db, d)
    elif d.entity_type == "chama_loan":
        await chamas.on_loan_disbursed(db, d)
    elif d.entity_type == "chama_dividend":
        await chamas.on_dividend_paid(db, d)
    return True


async def _on_payout_failed(db: AsyncSession, event: dict) -> bool:
    from app.services import chamas

    d = await _find_disbursement(db, event)
    if d is None:
        log.warning("orphan payout.failed: api_ref=%s", event.get("api_ref"))
        return False
    if d.status == "failed":
        return True  # idempotent duplicate
    d.status = "failed"
    d.psp_payout_id = str(event.get("id") or "") or None
    d.failure_reason = str(event.get("failure_reason") or "Payout failed")[:400]
    d.completed_at = datetime.utcnow()
    await db.flush()
    add_audit_event(
        db, actor_type="system", actor_id=None, action="disbursement_failed",
        entity_type=d.entity_type, entity_id=d.entity_id,
        new_state={"disbursement_id": str(d.id), "reason": d.failure_reason},
    )
    if d.entity_type == "chama_loan":
        await chamas.on_loan_disbursement_failed(db, d)
    elif d.entity_type == "chama_dividend":
        await chamas.on_dividend_failed(db, d)
    return True


# Ledger transaction type for each payout entity. Layer-3 types that have no
# published vocabulary yet (sacco_withdrawal, network_benefit) are NOT
# mapped: a completed payout for them raises (see _on_payout_completed) so
# the mismatch can never be booked under a wrong type.
_LEDGER_TYPE_FOR_PAYOUT = {
    "pick_settlement": "escrow_release",
    "pick_refund": "dispute_release",
    "chama_loan": "chama_loan_out",
    "chama_dividend": "chama_dividend_out",
    "sacco_loan": "sacco_loan_out",
    "sacco_dividend": "sacco_dividend_out",
    "pool_ride_transporter": "escrow_release",
    "price_shield_credit": "escrow_refund",
}


# Register the sink so the mock PSP (and tests) can deliver events in-process.
psp_client.register_webhook_sink(process_inbound_event)

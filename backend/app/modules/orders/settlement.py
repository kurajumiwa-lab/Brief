"""Provider-sub-account settlement for paid stock-movement orders.

Collections land only in the explicitly configured PSP sub-account. Supplier
and courier payouts are queued after receipt proof; verified refunds reduce the
corresponding product, delivery, or fee component before any payout is queued.
This module never treats an ordinary platform account as escrow.
"""

import logging
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.payments import (
    PLATFORM_FEES,
    CustodyLedgerEntry,
    Disbursement,
    PaymentIntent,
    PaymentRefund,
)
from app.models.stock import StockMovement
from app.models.vendor import Vendor
from app.modules.orders.audit import record_movement_event
from app.modules.orders.models import DeliveryQuote, OrderDispute, OrderTransaction
from app.services import custody, psp_client
from app.services.disbursements import DisbursementError, request_disbursement
from app.services.governance import add_audit_event

log = logging.getLogger("brief.orders.settlement")


async def _settlement_plan(db: AsyncSession, transaction: OrderTransaction, movement: StockMovement):
    """Return the remaining PSP payout targets and fee after verified refunds."""
    payment = (await db.execute(select(PaymentIntent).where(
        PaymentIntent.entity_type == "stock_movement_payment",
        PaymentIntent.entity_id == movement.id,
        PaymentIntent.status.in_(("completed", "refunded")),
    ).order_by(PaymentIntent.created_at.desc()).limit(1))).scalars().first()
    if payment is None:
        return None, "not_applicable"
    if payment.status == "refunded":
        return None, "refunded"

    refunds = (await db.execute(select(PaymentRefund).where(
        PaymentRefund.payment_intent_id == payment.id,
        PaymentRefund.status.in_(("pending", "completed")),
    ))).scalars().all()
    if any(row.status == "pending" for row in refunds):
        return None, "refund_pending"

    completed = [row for row in refunds if row.status == "completed"]
    refunded_total = sum(row.amount_ksh for row in completed)
    product_refunded = sum(row.product_refund_ksh for row in completed)
    delivery_refunded = sum(row.delivery_refund_ksh for row in completed)
    fee_refunded = sum(row.platform_fee_refund_ksh for row in completed)

    quote = await db.get(DeliveryQuote, transaction.selected_quote_id) if transaction.selected_quote_id else None
    if quote is None or quote.status not in ("selected", "offered"):
        return None, "failed"
    product = int(transaction.product_amount_ksh) - product_refunded
    delivery = int(quote.price_ksh) - delivery_refunded
    fee = int(transaction.platform_fee_ksh) - fee_refunded
    remaining_total = product + delivery + fee
    if min(product, delivery, fee) < 0:
        log.error("order %s refund allocation exceeds its agreed components", movement.id)
        return None, "failed"
    if (refunded_total > payment.amount_ksh
            or product_refunded + delivery_refunded + fee_refunded != refunded_total
            or remaining_total != payment.amount_ksh - refunded_total):
        log.error("order %s refund allocation does not reconcile to its verified payment", movement.id)
        return None, "failed"
    if remaining_total == 0:
        return None, "refunded"

    supplier = await db.get(Vendor, movement.from_vendor_id)
    if supplier is None:
        return None, "failed"
    targets: dict[str, tuple[Vendor, int, str]] = {}
    if quote.provider_type == "supplier_delivery":
        supplier_amount = product + delivery - fee
        courier = None
        courier_amount = 0
    elif quote.provider_type in ("courier", "errand", "scheduled"):
        supplier_amount = product - fee
        courier = await db.get(Vendor, quote.provider_vendor_id) if quote.provider_vendor_id else None
        courier_amount = delivery
    elif quote.provider_type == "self_pickup":
        supplier_amount = product - fee
        courier = None
        courier_amount = 0
    else:
        return None, "failed"

    if supplier_amount < 0 or courier_amount < 0:
        log.error("order %s leaves a negative settlement component after refunds", movement.id)
        return None, "failed"
    if supplier_amount:
        if not supplier.phone:
            log.error("order %s has no supplier payout phone", movement.id)
            return None, "failed"
        targets["movement_settlement"] = (supplier, supplier_amount, supplier.business_name)
    if courier_amount:
        if courier is None or not courier.phone:
            log.error("order %s has no valid delivery-provider payout phone", movement.id)
            return None, "failed"
        targets["movement_delivery"] = (courier, courier_amount, quote.provider_name)
    return (targets, fee, payment), None


async def start_order_settlement(db: AsyncSession, movement_id: UUID, *, retry_failed: bool = False) -> None:
    """Queue agreed payouts once, after receipt proof and verified payment.

    Provider errors cannot reverse the physical receipt. A failed payout stays
    visible for market-ops review; only an explicit support retry creates a new
    provider reference.
    """
    transaction = (await db.execute(
        select(OrderTransaction).where(OrderTransaction.movement_id == movement_id).with_for_update()
    )).scalar_one_or_none()
    movement = await db.get(StockMovement, movement_id)
    if transaction is None or movement is None or movement.status != "received":
        return
    if transaction.settlement_status in ("settled", "refunded"):
        return

    dispute = (await db.execute(select(OrderDispute.id).where(
        OrderDispute.movement_id == movement_id,
        OrderDispute.status.in_(("open", "in_review")),
    ).limit(1))).scalar_one_or_none()
    if dispute:
        transaction.settlement_status = "blocked_by_dispute"
        return

    plan, error = await _settlement_plan(db, transaction, movement)
    if error:
        transaction.settlement_status = error
        return
    targets, fee, _payment = plan

    if not settings.TRADE_SETTLEMENT_ENABLED or not settings.TRADE_PSP_SUB_ACCOUNT:
        transaction.settlement_status = "unavailable"
        log.error("order %s is paid but provider settlement is not configured", movement_id)
        return

    payout_rows = (await db.execute(select(Disbursement).where(
        Disbursement.entity_type.in_(("movement_settlement", "movement_delivery")),
        Disbursement.entity_id == movement_id,
    ).order_by(Disbursement.created_at.asc(), Disbursement.id.asc()))).scalars().all()
    latest = _latest_by_type(payout_rows)

    if not targets:
        await _transfer_platform_fee(db, movement_id, transaction, fee)
        transaction.settlement_status = "settled"
        _record_settled(db, movement_id, fee, payout_rows)
        return

    for entity_type, (recipient, amount, name) in targets.items():
        current = latest.get(entity_type)
        if current and current.status in ("pending_approval", "approved", "queued", "completed"):
            if current.amount_ksh != amount:
                transaction.settlement_status = "failed"
                log.error("order %s has an existing %s payout for a different amount", movement_id, entity_type)
                return
            continue
        if current and current.status in ("failed", "reversed") and not retry_failed:
            transaction.settlement_status = "failed"
            return
        try:
            payout = await request_disbursement(
                db,
                entity_type=entity_type,
                entity_id=movement_id,
                recipient_phone=recipient.phone,
                amount_ksh=amount,
                source_psp_sub=settings.TRADE_PSP_SUB_ACCOUNT,
                requestor_id=None,
                recipient_name=name,
                narrative=f"Order {str(movement_id)[:8]} {entity_type.removeprefix('movement_')}",
            )
        except DisbursementError:
            transaction.settlement_status = "failed"
            await db.flush()
            log.exception("could not queue %s payout for order %s", entity_type, movement_id)
            return
        latest[entity_type] = payout

    payout_status = _status_from_latest(latest, targets)
    # "settled" from payout rows still needs the fee-transfer/ledger step.
    transaction.settlement_status = "pending" if payout_status == "settled" else payout_status
    await db.flush()
    await maybe_finalize_order_settlement(db, movement_id)


def _latest_by_type(rows: list[Disbursement]) -> dict[str, Disbursement]:
    latest: dict[str, Disbursement] = {}
    for row in rows:
        latest[row.entity_type] = row
    return latest


def _status_from_latest(latest: dict[str, Disbursement], targets: dict) -> str:
    rows = [latest.get(kind) for kind in targets]
    if any(row is None or row.status in ("failed", "reversed") for row in rows):
        return "failed"
    if any(row.status == "pending_approval" for row in rows):
        return "pending_approval"
    if all(row.status == "completed" for row in rows):
        return "settled"
    return "pending"


async def _transfer_platform_fee(db: AsyncSession, movement_id: UUID, transaction: OrderTransaction, fee: int) -> None:
    """Make the PSP transfer idempotent and book it only after provider success."""
    if fee <= 0:
        return
    if not settings.TRADE_PSP_SUB_ACCOUNT:
        raise psp_client.PSPError("Order platform-fee sub-account is not configured")

    reference = f"ORDER-FEE-{movement_id}"
    existing = (await db.execute(select(CustodyLedgerEntry.id).where(
        CustodyLedgerEntry.psp_reference == reference,
        CustodyLedgerEntry.transaction_type == "fee_deducted",
        CustodyLedgerEntry.entity_id == movement_id,
    ).limit(1))).scalar_one_or_none()
    if existing:
        return

    transfer = await psp_client.get_psp_client().internal_transfer(
        from_wallet=settings.TRADE_PSP_SUB_ACCOUNT,
        to_wallet=PLATFORM_FEES,
        amount=fee,
        api_ref=reference,
    )
    confirmed_reference = str(transfer.get("transfer_id") or reference)
    await custody.write_ledger_entry(
        db, psp_sub_account=settings.TRADE_PSP_SUB_ACCOUNT,
        transaction_type="escrow_release", amount_ksh=fee, direction="debit",
        psp_reference=reference, entity_type="stock_movement", entity_id=movement_id,
        notes="Order platform fee (PSP transfer confirmed)",
    )
    await custody.write_ledger_entry(
        db, psp_sub_account=PLATFORM_FEES,
        transaction_type="fee_deducted", amount_ksh=fee, direction="credit",
        psp_reference=reference, entity_type="stock_movement", entity_id=movement_id,
        notes=f"Order platform fee (PSP transfer {confirmed_reference})",
    )


async def maybe_finalize_order_settlement(db: AsyncSession, movement_id: UUID) -> None:
    """Finalize fee accounting after each required payout has verified success."""
    transaction = (await db.execute(
        select(OrderTransaction).where(OrderTransaction.movement_id == movement_id).with_for_update()
    )).scalar_one_or_none()
    if transaction is None or transaction.settlement_status in ("settled", "refunded"):
        return
    movement = await db.get(StockMovement, movement_id)
    if movement is None or movement.status != "received":
        return

    dispute = (await db.execute(select(OrderDispute.id).where(
        OrderDispute.movement_id == movement_id,
        OrderDispute.status.in_(("open", "in_review")),
    ).limit(1))).scalar_one_or_none()
    if dispute:
        transaction.settlement_status = "blocked_by_dispute"
        return

    plan, error = await _settlement_plan(db, transaction, movement)
    if error:
        transaction.settlement_status = error
        return
    targets, fee, _payment = plan
    payout_rows = (await db.execute(select(Disbursement).where(
        Disbursement.entity_type.in_(("movement_settlement", "movement_delivery")),
        Disbursement.entity_id == movement_id,
    ).order_by(Disbursement.created_at.asc(), Disbursement.id.asc()))).scalars().all()
    latest = _latest_by_type(payout_rows)

    if targets:
        status = _status_from_latest(latest, targets)
        if status != "settled":
            transaction.settlement_status = status
            return
        if any(latest[kind].amount_ksh != amount for kind, (_recipient, amount, _name) in targets.items()):
            transaction.settlement_status = "failed"
            log.error("order %s payout amount differs from the remaining verified terms", movement_id)
            return

    try:
        await _transfer_platform_fee(db, movement_id, transaction, fee)
    except psp_client.PSPError:
        transaction.settlement_status = "failed"
        log.exception("platform-fee transfer failed for order %s", movement_id)
        return

    transaction.settlement_status = "settled"
    _record_settled(db, movement_id, fee, payout_rows)


def _record_settled(db: AsyncSession, movement_id: UUID, fee: int, payouts: list[Disbursement]) -> None:
    record_movement_event(
        db, movement_id, "supplier_settled", payload={
            "fee_ksh": fee, "disbursement_ids": [str(row.id) for row in payouts],
        },
    )
    add_audit_event(
        db, actor_type="system", actor_id=None, action="order_settled",
        entity_type="stock_movement", entity_id=movement_id,
        new_state={"fee_ksh": fee, "disbursement_ids": [str(row.id) for row in payouts]},
    )

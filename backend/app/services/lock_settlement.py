"""Lock settlement (v2.5) — the pick-hedging escrow state machine.

A locked cluster moves money like this (funds live in the PSP, never with us):

    vendor pays   ESCROW_PICK_HEDGING  ← collection_in   (per pick)
    all paid      cluster.funds_status = funded
    ops settles   supplier paid (gross − fee) → escrow_release
                  fee → PLATFORM_FEES (internal transfer) → fee_deducted
                  picks settled, RevenueEvent recorded, Biashara +5
    vendor disputes  pick's share → DISPUTE_HOLD (dispute_freeze)
    ops resolves     refund → dispute_release, or release back to escrow

The platform facilitation fee is booked as a `supplier_facilitation_fee`
RevenueEvent, so it feeds the existing vendor benefit-pool accounting —
the flywheel from the Sacco Moat brief.
"""

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.governance import RevenueEvent
from app.models.market_locks import LockCluster, LockPick, LockWindow, SupplierMOQ, SupplierQuote
from app.models.notification import NotificationType
from app.models.payments import DISPUTE_HOLD, ESCROW_PICK_HEDGING, PLATFORM_FEES, DisputeHold
from app.models.vendor import Vendor
from app.services import biashara, custody, psp_client
from app.services.disbursements import request_disbursement
from app.services.governance import add_audit_event
from app.services.notification_service import create_notification, notify_many
from app.services.payments import PaymentError, create_collection_intent, start_collection

log = logging.getLogger("brief.lock_settlement")


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def pick_payable(cluster: LockCluster, pick: LockPick) -> int:
    if cluster.locked_unit_price is None or cluster.locked_quantity is None:
        raise HTTPException(409, "This cluster has no locked price yet")
    return int(round(pick.quantity * cluster.locked_unit_price))


def _pick_payable_sync(cluster: LockCluster, pick: LockPick) -> int:
    """A pick's payable at the locked price (0 if no price — should not happen
    for paid/in_dispute picks)."""
    if cluster.locked_unit_price is None:
        return 0
    return int(round(pick.quantity * cluster.locked_unit_price))


async def cluster_gross(db: AsyncSession, cluster: LockCluster) -> int:
    """What is owed to the supplier right now: paid total minus frozen disputes.
    Disputed picks paid into escrow when they confirmed, so their payable is
    subtracted while their money sits in DISPUTE_HOLD."""
    disputed_picks = (await db.execute(select(LockPick).where(
        LockPick.cluster_id == cluster.id, LockPick.status == "in_dispute",
    ))).scalars().all()
    disputed_total = sum(_pick_payable_sync(cluster, p) for p in disputed_picks)
    return int(cluster.paid_total_ksh or 0) - disputed_total


async def supplier_of_cluster(db: AsyncSession, cluster: LockCluster) -> Optional[Vendor]:
    if not cluster.selected_quote_id:
        return None
    quote = await db.get(SupplierQuote, cluster.selected_quote_id)
    if quote is None:
        return None
    offer = await db.get(SupplierMOQ, quote.supplier_moq_id)
    if offer is None:
        return None
    return await db.get(Vendor, offer.supplier_vendor_id)


async def _open_disputes_for_pick(db: AsyncSession, pick: LockPick) -> Optional[DisputeHold]:
    return (await db.execute(select(DisputeHold).where(
        DisputeHold.entity_type == "lock_pick",
        DisputeHold.entity_id == pick.id,
        DisputeHold.status == "frozen",
    ))).scalar_one_or_none()


async def _settlement_in_flight(db: AsyncSession, cluster: LockCluster) -> bool:
    from app.models.payments import Disbursement

    return (await db.execute(select(Disbursement.id).where(
        Disbursement.entity_type == "pick_settlement",
        Disbursement.entity_id == cluster.id,
        Disbursement.status.in_(("pending_approval", "approved", "queued")),
    ).limit(1))).scalar_one_or_none() is not None


# ---------------------------------------------------------------------------
# 1. Vendor pays their pick (money → escrow)
# ---------------------------------------------------------------------------

async def pay_for_pick(db: AsyncSession, cluster: LockCluster, pick: LockPick, vendor: Vendor,
                       provider: Optional[str] = None) -> dict:
    if cluster.status != "locked" or cluster.locked_unit_price is None:
        raise HTTPException(400, "This cluster has no locked price to pay against")
    if pick.cluster_id != cluster.id or pick.vendor_id != vendor.id:
        raise HTTPException(404, "Lock pick not found")
    if pick.status != "submitted":
        raise HTTPException(400, f"Your pick is {pick.status}")
    if cluster.funds_status == "settled":
        raise HTTPException(400, "This cluster is already settled")
    if await _settlement_in_flight(db, cluster):
        raise HTTPException(409, "Settlement is in progress; payment is closed")

    amount = pick_payable(cluster, pick)
    if amount <= 0:
        raise HTTPException(400, "Nothing to pay")
    intent = await create_collection_intent(
        db, vendor,
        entity_type="pick_full_payment",
        entity_id=pick.id,
        amount_ksh=amount,
        target_psp_sub=ESCROW_PICK_HEDGING,
        provider=provider,
    )
    await start_collection(db, intent)
    return {"intent_id": str(intent.id), "status": intent.status,
            "amount_ksh": intent.amount_ksh, "cluster_id": str(cluster.id)}


async def on_pick_payment_completed(db: AsyncSession, intent) -> None:
    """Webhook hook: the vendor's money is in escrow."""
    pick = await db.get(LockPick, intent.entity_id)
    if pick is None or pick.status != "submitted":
        log.warning("pick payment for missing/changed pick %s", intent.entity_id)
        return
    cluster = await db.get(LockCluster, pick.cluster_id, with_for_update=True)
    if cluster is None:
        return

    pick.status = "paid"
    cluster.paid_total_ksh = int(cluster.paid_total_ksh or 0) + intent.amount_ksh
    await db.flush()

    outstanding = (await db.execute(select(LockPick.id).where(
        LockPick.cluster_id == cluster.id, LockPick.status == "submitted",
    ).limit(1))).scalar_one_or_none()
    if outstanding is None and cluster.funds_status != "funded":
        cluster.funds_status = "funded"
        add_audit_event(
            db, actor_type="system", actor_id=None, action="lock_cluster_funded",
            entity_type="lock_cluster", entity_id=cluster.id,
            new_state={"paid_total_ksh": cluster.paid_total_ksh},
        )
        supplier = await supplier_of_cluster(db, cluster)
        if supplier:
            await create_notification(
                db, supplier.id, NotificationType.PAYMENT_UPDATE,
                "Lock cluster fully funded",
                f"KSh {cluster.paid_total_ksh:,} is in escrow for your delivery. A market operator will settle after delivery.",
                data={"market_lock_cluster_id": str(cluster.id)},
            )
        pickers = list((await db.execute(select(LockPick.vendor_id).where(
            LockPick.cluster_id == cluster.id, LockPick.status.in_(("paid", "in_dispute")),
        ))).scalars())
        await notify_many(
            db, pickers, NotificationType.PAYMENT_UPDATE,
            "Lock fully funded — goods on the way",
            "All picks are paid and held in escrow. Tap PROBLEM if the delivery goes wrong.",
            data={"market_lock_cluster_id": str(cluster.id)},
        )
    else:
        await create_notification(
            db, intent.vendor_id, NotificationType.PAYMENT_UPDATE,
            f"KSh {intent.amount_ksh:,} held in escrow",
            "Your payment is safe until delivery. The supplier is paid only once settlement is approved.",
            data={"market_lock_cluster_id": str(cluster.id)},
        )


# ---------------------------------------------------------------------------
# 2. Ops settles: supplier paid from escrow, fee to PLATFORM_FEES
# ---------------------------------------------------------------------------

async def request_lock_settlement(db: AsyncSession, cluster: LockCluster, staff: Vendor) -> dict:
    if cluster.status != "locked" or cluster.funds_status != "funded":
        raise HTTPException(400, "Only a funded cluster can be settled")
    if cluster.funds_status == "settled" or cluster.settled_at:
        raise HTTPException(400, "This cluster is already settled")
    if await _settlement_in_flight(db, cluster):
        raise HTTPException(409, "A settlement for this cluster is already in flight")

    supplier = await supplier_of_cluster(db, cluster)
    if supplier is None or not supplier.phone:
        raise HTTPException(409, "The selected supplier has no phone number to pay")

    gross = await cluster_gross(db, cluster)
    fee = int(round(gross * settings.PLATFORM_FEE_RATE))
    net = gross - fee
    if net <= 0:
        raise HTTPException(400, "Nothing left to settle after disputes")

    disbursement = await request_disbursement(
        db, entity_type="pick_settlement", entity_id=cluster.id,
        recipient_phone=supplier.phone, amount_ksh=net,
        source_psp_sub=ESCROW_PICK_HEDGING, requestor_id=staff.id,
        recipient_name=supplier.business_name,
        narrative=f"Lock cluster settlement (fee KSh {fee:,} withheld)",
    )
    return {"disbursement_id": str(disbursement.id), "status": disbursement.status,
            "gross_ksh": gross, "fee_ksh": fee, "net_ksh": net,
            "dual_approval": disbursement.status == "pending_approval"}


async def on_settlement_completed(db: AsyncSession, disbursement) -> None:
    """Webhook hook: supplier has the money — close the loop."""
    cluster = await db.get(LockCluster, disbursement.entity_id, with_for_update=True)
    if cluster is None or cluster.settled_at is not None:
        return

    # Move the fee escrow → PLATFORM_FEES now, after the PSP confirmed the
    # payout, and account for both sides of that movement.
    gross = await cluster_gross(db, cluster)
    fee = max(0, int(gross) - disbursement.amount_ksh)
    if fee > 0:
        transfer = await psp_client.get_psp_client().internal_transfer(
            from_wallet=ESCROW_PICK_HEDGING, to_wallet=PLATFORM_FEES,
            amount=fee, api_ref=f"FEE-{cluster.id}",
        )
        transfer_ref = transfer.get("transfer_id") or disbursement.psp_payout_id
        await custody.write_ledger_entry(
            db, psp_sub_account=ESCROW_PICK_HEDGING, transaction_type="escrow_release",
            amount_ksh=fee, direction="debit", psp_reference=transfer_ref,
            entity_type="pick_settlement", entity_id=cluster.id,
            approved_by=disbursement.approver_1, approved_by_2=disbursement.approver_2,
            notes="platform facilitation fee (escrow side)",
        )
        await custody.write_ledger_entry(
            db, psp_sub_account=PLATFORM_FEES, transaction_type="fee_deducted",
            amount_ksh=fee, direction="credit", psp_reference=transfer_ref,
            entity_type="pick_settlement", entity_id=cluster.id,
            notes=f"{settings.PLATFORM_FEE_RATE:.0%} facilitation fee",
        )

    cluster.funds_status = "settled"
    cluster.settled_at = datetime.utcnow()
    picks = (await db.execute(select(LockPick).where(
        LockPick.cluster_id == cluster.id, LockPick.status == "paid",
    ))).scalars().all()
    settled_vendors = []
    for pick in picks:
        pick.status = "settled"
        settled_vendors.append(pick.vendor_id)
    await db.flush()

    add_audit_event(
        db, actor_type="system", actor_id=disbursement.requested_by_vendor_id,
        action="lock_cluster_settled", entity_type="lock_cluster", entity_id=cluster.id,
        new_state={"supplier_paid_ksh": disbursement.amount_ksh,
                   "fee_ksh": fee, "funds_status": "settled"},
    )

    # The facilitation fee becomes eligible revenue for the benefit pool.
    if fee > 0 and disbursement.requested_by_vendor_id:
        db.add(RevenueEvent(
            source_type="supplier_facilitation_fee",
            source_reference=f"lock_cluster:{cluster.id}",
            gross_amount_ksh=fee, payment_fees_ksh=0, net_amount_ksh=fee,
            recognized_at=datetime.utcnow(),
            evidence_note=f"Lock settlement {disbursement.psp_payout_id or disbursement.psp_api_ref}",
            created_by_vendor_id=disbursement.requested_by_vendor_id,
        ))
        await db.flush()

    for vendor_id in set(settled_vendors):
        await biashara.record_biashara_event(
            db, vendor_id, "pick_completed",
            reference=f"lock_cluster:{cluster.id}",
            explanation="Picked stock was paid, delivered and settled through escrow.",
        )

    supplier = await supplier_of_cluster(db, cluster)
    if supplier:
        await create_notification(
            db, supplier.id, NotificationType.PAYMENT_UPDATE,
            f"Settlement paid: KSh {disbursement.amount_ksh:,}",
            f"KSh {fee:,} platform fee withheld from KSh {int(gross):,} gross.",
            data={"market_lock_cluster_id": str(cluster.id)},
        )
    await notify_many(
        db, set(settled_vendors), NotificationType.PAYMENT_UPDATE,
        "Lock settled — stock is yours",
        "Escrow released to the supplier. This pick now counts toward your Biashara Score.",
        data={"market_lock_cluster_id": str(cluster.id)},
    )


# ---------------------------------------------------------------------------
# 3. Disputes: freeze a pick's share, then resolve
# ---------------------------------------------------------------------------

async def open_lock_dispute(db: AsyncSession, cluster: LockCluster, pick: LockPick,
                            vendor: Vendor, reason: str) -> DisputeHold:
    if pick.cluster_id != cluster.id or pick.vendor_id != vendor.id:
        raise HTTPException(404, "Lock pick not found")
    if await _open_disputes_for_pick(db, pick):
        raise HTTPException(409, "This pick already has an open dispute")
    if pick.status != "paid":
        raise HTTPException(400, f"Only a paid pick can be disputed (yours is {pick.status})")
    if cluster.funds_status == "settled":
        raise HTTPException(400, "This cluster is already settled")
    if await _settlement_in_flight(db, cluster):
        raise HTTPException(409, "Settlement is in progress; disputes are closed")

    amount = _pick_payable_sync(cluster, pick)
    transfer = await psp_client.get_psp_client().internal_transfer(
        from_wallet=ESCROW_PICK_HEDGING, to_wallet=DISPUTE_HOLD,
        amount=amount, api_ref=f"FREEZE-{pick.id}",
    )
    transfer_ref = transfer.get("transfer_id") or "freeze"
    freeze_entry = await custody.write_ledger_entry(
        db, psp_sub_account=ESCROW_PICK_HEDGING, transaction_type="dispute_freeze",
        amount_ksh=amount, direction="debit", psp_reference=transfer_ref,
        vendor_id=vendor.id, entity_type="lock_pick", entity_id=pick.id,
        notes=f"frozen: {(reason or '')[:200]}",
    )
    await custody.write_ledger_entry(
        db, psp_sub_account=DISPUTE_HOLD, transaction_type="dispute_freeze",
        amount_ksh=amount, direction="credit", psp_reference=transfer_ref,
        vendor_id=vendor.id, entity_type="lock_pick", entity_id=pick.id,
    )

    hold = DisputeHold(
        original_ledger_id=freeze_entry.id,
        entity_type="lock_pick", entity_id=pick.id, vendor_id=vendor.id,
        amount_ksh=amount, reason=(reason or "Delivery problem")[:2000],
        status="frozen",
    )
    db.add(hold)
    pick.status = "in_dispute"
    add_audit_event(
        db, actor_type="vendor", actor_id=vendor.id, action="lock_dispute_opened",
        entity_type="lock_pick", entity_id=pick.id,
        new_state={"dispute_id": str(hold.id), "amount_ksh": amount, "status": "frozen"},
    )
    await db.flush()
    await create_notification(
        db, vendor.id, NotificationType.PAYMENT_UPDATE,
        f"KSh {amount:,} frozen pending review",
        "Your payment is safe in a dispute hold. A market operator will resolve it.",
        data={"market_lock_cluster_id": str(cluster.id), "dispute_id": str(hold.id)},
    )
    return hold


async def resolve_dispute(db: AsyncSession, hold: DisputeHold, staff: Vendor,
                          outcome: str, note: str) -> dict:
    if hold.status != "frozen":
        raise HTTPException(400, f"This dispute is {hold.status}")
    if outcome not in ("refund_to_vendor", "release_to_supplier", "escalate"):
        raise HTTPException(400, "Outcome must be refund_to_vendor, release_to_supplier or escalate")

    if outcome == "escalate":
        hold.status = "escalated"
        hold.resolution_note = (note or "")[:2000] or None
        hold.resolved_by = staff.id
        await db.flush()
        return {"dispute_id": str(hold.id), "status": hold.status}

    pick = await db.get(LockPick, hold.entity_id)
    cluster = await db.get(LockCluster, pick.cluster_id) if pick else None

    if outcome == "refund_to_vendor":
        if pick is None or not pick.vendor_id:
            raise HTTPException(409, "The pick behind this dispute no longer exists")
        vendor = await db.get(Vendor, pick.vendor_id)
        disbursement = await request_disbursement(
            db, entity_type="pick_refund", entity_id=hold.id,
            recipient_phone=vendor.phone or "", amount_ksh=hold.amount_ksh,
            source_psp_sub=DISPUTE_HOLD, requestor_id=staff.id,
            recipient_name=vendor.business_name,
            narrative=f"Dispute {hold.id}: {(note or '')[:120]}",
        )
        # Payout finalisation (on_refund_completed) flips the hold + pick.
        return {"disbursement_id": str(disbursement.id), "status": disbursement.status,
                "dispute_id": str(hold.id)}

    # release_to_supplier: return the frozen share to escrow for settlement.
    transfer = await psp_client.get_psp_client().internal_transfer(
        from_wallet=DISPUTE_HOLD, to_wallet=ESCROW_PICK_HEDGING,
        amount=hold.amount_ksh, api_ref=f"RELEASE-{hold.id}",
    )
    transfer_ref = transfer.get("transfer_id") or "release"
    await custody.write_ledger_entry(
        db, psp_sub_account=DISPUTE_HOLD, transaction_type="dispute_release",
        amount_ksh=hold.amount_ksh, direction="debit", psp_reference=transfer_ref,
        vendor_id=hold.vendor_id, entity_type="lock_pick", entity_id=hold.entity_id,
        notes=(note or "released to supplier")[:200],
    )
    await custody.write_ledger_entry(
        db, psp_sub_account=ESCROW_PICK_HEDGING, transaction_type="dispute_release",
        amount_ksh=hold.amount_ksh, direction="credit", psp_reference=transfer_ref,
        vendor_id=hold.vendor_id, entity_type="lock_pick", entity_id=hold.entity_id,
    )
    if pick is not None:
        pick.status = "paid"
    hold.status = "released_to_supplier"
    hold.resolution_note = (note or "")[:2000] or None
    hold.resolved_by = staff.id
    hold.resolved_at = datetime.utcnow()
    add_audit_event(
        db, actor_type="vendor", actor_id=staff.id, action="dispute_released_to_supplier",
        entity_type="lock_pick", entity_id=hold.entity_id,
        new_state={"dispute_id": str(hold.id), "status": hold.status},
    )
    if cluster is not None:
        await create_notification(
            db, hold.vendor_id, NotificationType.PAYMENT_UPDATE,
            "Dispute resolved: payment released",
            "The operator judged the delivery valid; your payment returns to escrow for settlement.",
            data={"market_lock_cluster_id": str(cluster.id), "dispute_id": str(hold.id)},
        )
    return {"dispute_id": str(hold.id), "status": hold.status}


async def on_refund_completed(db: AsyncSession, disbursement) -> None:
    """Webhook hook: the vendor got their money back."""
    hold = await db.get(DisputeHold, disbursement.entity_id)
    if hold is None or hold.status != "frozen":
        return
    pick = await db.get(LockPick, hold.entity_id)
    if pick is not None:
        pick.status = "refunded"
    hold.status = "released_to_vendor"
    hold.resolution_note = "Refunded to vendor"
    hold.resolved_by = disbursement.requested_by_vendor_id
    hold.resolved_at = datetime.utcnow()
    await db.flush()
    if pick is not None:
        cluster = await db.get(LockCluster, pick.cluster_id)
        await create_notification(
            db, pick.vendor_id, NotificationType.PAYMENT_UPDATE,
            f"Refund paid: KSh {hold.amount_ksh:,}",
            "Your dispute was resolved in your favour."
            + (f" The lock ({cluster.id}) remains open for the other picks." if cluster else ""),
            data={"dispute_id": str(hold.id)},
        )

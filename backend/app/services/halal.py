"""Murabaha (cost-plus) stock advances (v2.6, halal-trade brief).

The Sacco window buys physical stock at a known cost and sells it to the
vendor at a fixed, disclosed markup, payable in full by an agreed date.
Sharia requirements honoured here:

* cost and profit are both fixed and known at signing (no variable margin,
  no late-payment interest — a late payment is a default, not a penalty rate),
* the contract is for a specific, physically-described good (no paper
  speculation),
* repayment is a real PSP collection into the SACCO_ADVANCES sub-account, so
  the custody ledger stays reconcilable.

Roles: the vendor requests (and later pays); market-ops staff (the Sacco
window) approve, decline or watch the desk. The Sacco's purchase from the
supplier is an out-of-band physical trade (Layer 3 operations).
"""

import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.halal import MurabahaContract
from app.models.notification import NotificationType
from app.models.payments import SACCO_ADVANCES
from app.models.vendor import Vendor
from app.services import biashara, psp_client
from app.services.governance import add_audit_event
from app.services.notification_service import create_notification
from app.services.payments import create_collection_intent, start_collection

MIN_DUE_DAYS, MAX_DUE_DAYS = 1, 180
MAX_CONTRACT_KSH = 5_000_000


async def _sacco_wallet(db: AsyncSession) -> str:
    psp = psp_client.get_psp_client()
    await psp.create_wallet(SACCO_ADVANCES)
    return SACCO_ADVANCES


async def contract_or_404(db: AsyncSession, contract_id: uuid.UUID) -> MurabahaContract:
    contract = await db.get(MurabahaContract, contract_id)
    if contract is None:
        raise HTTPException(404, "Murabaha contract not found")
    return contract


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

async def request_murabaha(
    db: AsyncSession, vendor: Vendor, *, product: str, quantity: int,
    cost_price_ksh: int, markup_ksh: int, payment_due_days: int,
    supplier_vendor_id: uuid.UUID | None = None, note: str | None = None,
) -> MurabahaContract:
    product = (product or "").strip()
    if len(product) < 3:
        raise HTTPException(400, "Describe the stock (product)")
    quantity = int(quantity)
    if quantity <= 0 or quantity > 1_000_000:
        raise HTTPException(400, "Quantity must be a positive number")
    cost_price_ksh = int(cost_price_ksh)
    markup_ksh = int(markup_ksh)
    if cost_price_ksh <= 0:
        raise HTTPException(400, "The cost price must be positive")
    if markup_ksh < 0:
        raise HTTPException(400, "The markup cannot be negative")
    total = cost_price_ksh + markup_ksh
    if total > MAX_CONTRACT_KSH:
        raise HTTPException(400, f"A single advance is capped at KSh {MAX_CONTRACT_KSH:,}")
    payment_due_days = int(payment_due_days)
    if not MIN_DUE_DAYS <= payment_due_days <= MAX_DUE_DAYS:
        raise HTTPException(400, f"Payment term must be {MIN_DUE_DAYS}–{MAX_DUE_DAYS} days")
    if supplier_vendor_id is not None:
        supplier = await db.get(Vendor, supplier_vendor_id)
        if supplier is None:
            raise HTTPException(404, "Supplier vendor not found")

    open_contract = (await db.execute(select(MurabahaContract.id).where(
        MurabahaContract.vendor_id == vendor.id,
        MurabahaContract.status.in_(("pending_approval", "active")),
    ).limit(1))).scalar_one_or_none()
    if open_contract:
        raise HTTPException(409, "You already have a murabaha advance in progress; settle it first")

    contract = MurabahaContract(
        vendor_id=vendor.id,
        supplier_vendor_id=supplier_vendor_id,
        product=product[:200],
        quantity=quantity,
        cost_price_ksh=cost_price_ksh,
        markup_ksh=markup_ksh,
        total_selling_ksh=total,
        payment_due_date=datetime.utcnow() + timedelta(days=payment_due_days),
        status="pending_approval",
        note=(note or "").strip()[:1000] or None,
    )
    db.add(contract)
    await db.flush()
    add_audit_event(
        db, actor_type="vendor", actor_id=vendor.id, action="murabaha_requested",
        entity_type="murabaha_contract", entity_id=contract.id,
        new_state={"product": contract.product, "quantity": quantity,
                   "cost_price_ksh": cost_price_ksh, "markup_ksh": markup_ksh,
                   "total_selling_ksh": total, "payment_due_days": payment_due_days},
    )
    await create_notification(
        db, vendor.id, NotificationType.PAYMENT_UPDATE,
        "Murabaha advance requested",
        f"KSh {total:,} for {product} × {quantity} (cost KSh {cost_price_ksh:,} + fixed margin "
        f"KSh {markup_ksh:,}). The Sacco window will review it.",
        data={"contract_id": str(contract.id)},
    )
    return contract


async def decide_murabaha(
    db: AsyncSession, contract: MurabahaContract, staff: Vendor, approve: bool,
) -> MurabahaContract:
    if contract.status != "pending_approval":
        raise HTTPException(400, f"This contract is {contract.status}; only pending ones can be decided")
    contract.status = "active" if approve else "declined"
    contract.approved_by_vendor_id = staff.id
    contract.approved_at = datetime.utcnow()
    await db.flush()
    add_audit_event(
        db, actor_type="vendor", actor_id=staff.id,
        action="murabaha_approved" if approve else "murabaha_declined",
        entity_type="murabaha_contract", entity_id=contract.id,
        previous_state={"status": "pending_approval"}, new_state={"status": contract.status},
    )
    await create_notification(
        db, contract.vendor_id, NotificationType.PAYMENT_UPDATE,
        "Murabaha advance approved" if approve else "Murabaha advance declined",
        (f"Pay KSh {contract.total_selling_ksh:,} by "
         f"{contract.payment_due_date.strftime('%Y-%m-%d')} to settle it.")
        if approve else
        "The Sacco window did not approve this advance. You may request a revised one.",
        data={"contract_id": str(contract.id)},
    )
    return contract


async def pay_murabaha(db: AsyncSession, contract: MurabahaContract, vendor: Vendor) -> dict:
    if contract.vendor_id != vendor.id:
        raise HTTPException(404, "Murabaha contract not found")
    if contract.status == "settled":
        raise HTTPException(400, "This advance is already settled")
    if contract.status != "active":
        raise HTTPException(400, f"Only an approved (active) advance can be paid (it is {contract.status})")
    intent = await create_collection_intent(
        db, vendor,
        entity_type="murabaha_repayment",
        entity_id=contract.id,
        amount_ksh=int(contract.total_selling_ksh),
        target_psp_sub=await _sacco_wallet(db),
    )
    contract.repayment_intent_id = intent.id
    await db.commit()  # FK reference lands before the PSP's webhook can
    await start_collection(db, intent)
    return {"intent_id": str(intent.id), "status": intent.status,
            "amount_ksh": intent.amount_ksh,
            "due": contract.payment_due_date.isoformat()}


async def on_murabaha_repaid(db: AsyncSession, intent) -> None:
    """Webhook hook: the vendor's full payment has landed in the Sacco window."""
    contract = await db.get(MurabahaContract, intent.entity_id)
    if contract is None or contract.status == "settled":
        return
    contract.status = "settled"
    contract.settled_at = datetime.utcnow()
    await db.flush()
    await biashara.record_biashara_event(
        db, contract.vendor_id, "murabaha_settled",
        reference=f"murabaha:{contract.id}",
        explanation=f"Paid KSh {contract.total_selling_ksh:,} on a cost-plus advance "
                    f"({contract.product} × {contract.quantity}) before the due date.",
    )
    await create_notification(
        db, contract.vendor_id, NotificationType.PAYMENT_UPDATE,
        f"Murabaha advance settled: KSh {contract.total_selling_ksh:,}",
        f"{contract.product} × {contract.quantity} is yours. The stock release note is with the Sacco window.",
        data={"contract_id": str(contract.id)},
    )


async def flag_overdue_murabaha(db: AsyncSession) -> int:
    """Worker job: active advances past their due date + grace are defaulted.

    There is deliberately NO late-payment interest: a late payer becomes a
    default (a credit event), they do not pay a growing penalty.
    """
    now = datetime.utcnow()
    cutoff = now - timedelta(days=settings.MURABAHA_GRACE_DAYS)
    contracts = (await db.execute(select(MurabahaContract).where(
        MurabahaContract.status == "active",
        MurabahaContract.payment_due_date < cutoff,
    ).with_for_update())).scalars().all()
    flagged = 0
    for contract in contracts:
        contract.status = "defaulted"
        contract.failure_reason = f"Payment due {contract.payment_due_date.date()} not received within grace"
        await db.flush()
        add_audit_event(
            db, actor_type="system", actor_id=None, action="murabaha_overdue_defaulted",
            entity_type="murabaha_contract", entity_id=contract.id,
            previous_state={"status": "active"},
            new_state={"status": "defaulted", "payment_due": contract.payment_due_date.isoformat()},
        )
        await biashara.record_biashara_event(
            db, contract.vendor_id, "murabaha_defaulted",
            reference=f"murabaha:{contract.id}",
            explanation=f"Cost-plus advance of KSh {contract.total_selling_ksh:,} "
                        f"({contract.product} × {contract.quantity}) passed its due date.",
        )
        await create_notification(
            db, contract.vendor_id, NotificationType.PAYMENT_UPDATE,
            "Murabaha advance is now in default",
            f"It was due {contract.payment_due_date.strftime('%Y-%m-%d')}. Meet the Sacco window "
            "to arrange the stock release or a replacement contract.",
            data={"contract_id": str(contract.id)},
        )
        flagged += 1
    return flagged

"""Prepaid promotional credit: purchase, confirmation, spend and expiry.

A merchant pays for credit through a licensed rail outside the platform. They
record the reference; an operator confirms it; only then does the balance move.
The balance is not money the platform owes the merchant — it is a promotional
budget that can only be spent on customer rewards, and unredeemed credit is
reported separately from revenue.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.receipts import ReceiptMerchant
from app.models.vendor import Vendor
from app.modules.town import config as town_config
from app.modules.town.audit import audit
from app.modules.town.errors import CommerceError
from app.modules.town.models import (
    MerchantAnalyticsSubscription, MerchantCreditAccount, MerchantCreditEntry,
    MerchantCreditPurchase,
)

MIN_PURCHASE_KES = 100
MAX_PURCHASE_KES = 500_000
SUBSCRIPTION_PRICE_KES = 500


def _now() -> datetime:
    return datetime.utcnow()


async def account_for(
    db: AsyncSession, merchant_id, *, lock: bool = False,
) -> MerchantCreditAccount:
    statement = select(MerchantCreditAccount).where(MerchantCreditAccount.merchant_id == merchant_id)
    if lock:
        statement = statement.with_for_update()
    account = (await db.execute(statement)).scalar_one_or_none()
    if account is None:
        account = MerchantCreditAccount(
            merchant_id=merchant_id, purchased_kes=0, available_kes=0,
            spent_kes=0, expired_kes=0, outstanding_kes=0,
        )
        db.add(account)
        await db.flush()
    return account


async def expire(db: AsyncSession, account: MerchantCreditAccount) -> int:
    """Move lapsed credit out of `available` into the expired bucket."""
    now = _now()
    if account.available_kes <= 0 or account.expires_at is None or account.expires_at > now:
        return 0
    expired = int(account.available_kes)
    account.available_kes = 0
    account.expired_kes = int(account.expired_kes or 0) + expired
    account.updated_at = now
    db.add(MerchantCreditEntry(
        merchant_id=account.merchant_id,
        entry_type="expire",
        amount_kes=expired,
        idempotency_key=f"expire:{account.merchant_id}:{int(now.timestamp())}",
        reference_type="credit_account",
        reference_id=account.id,
        note="Prepaid credit reached its disclosed validity date.",
    ))
    await db.flush()
    return expired


async def summary(db: AsyncSession, merchant_id, *, lock: bool = False) -> dict[str, Any]:
    account = await account_for(db, merchant_id, lock=lock)
    await expire(db, account)
    return {
        "merchant_id": str(merchant_id),
        "purchased_kes": int(account.purchased_kes or 0),
        "available_kes": int(account.available_kes or 0),
        "spent_kes": int(account.spent_kes or 0),
        "expired_kes": int(account.expired_kes or 0),
        "outstanding_kes": int(account.outstanding_kes or 0),
        "expires_at": account.expires_at.isoformat() if account.expires_at else None,
        "note": (
            "Prepaid promotional credit. Not withdrawable, not platform revenue. "
            "Outstanding and expired credit are reported separately."
        ),
    }


async def request_purchase(
    db: AsyncSession,
    *,
    merchant: ReceiptMerchant,
    vendor: Vendor,
    amount_kes: int,
    payment_reference: str,
    idempotency_key: str,
    note: Optional[str] = None,
) -> MerchantCreditPurchase:
    amount = int(amount_kes or 0)
    if amount < MIN_PURCHASE_KES:
        raise CommerceError(f"Buy at least KES {MIN_PURCHASE_KES:,} of credit.", 422)
    if amount > MAX_PURCHASE_KES:
        raise CommerceError(f"A single purchase is capped at KES {MAX_PURCHASE_KES:,}.", 422)
    reference = " ".join((payment_reference or "").split())
    if len(reference) < 4:
        raise CommerceError("Record the M-Pesa or bank reference for the payment.", 422)
    key = " ".join((idempotency_key or "").split())[:120]
    if len(key) < 6:
        raise CommerceError("Send an idempotency key so a retry does not double-buy.", 422)

    existing = (
        await db.execute(
            select(MerchantCreditPurchase).where(
                MerchantCreditPurchase.merchant_id == merchant.id,
                MerchantCreditPurchase.idempotency_key == key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    purchase = MerchantCreditPurchase(
        id=uuid.uuid4(),
        merchant_id=merchant.id,
        amount_kes=amount,
        payment_reference=reference[:120],
        payment_method="direct_mpesa",
        idempotency_key=key,
        status="pending",
        requested_by_vendor_id=vendor.id,
        note=(note or "")[:300] or None,
    )
    db.add(purchase)
    audit(
        db, action="merchant_credit_requested", entity_type="merchant_credit_purchase",
        entity_id=purchase.id, actor_vendor_id=vendor.id,
        payload={"merchant_id": merchant.id, "amount_kes": amount, "reference": reference[:40]},
    )
    await db.flush()
    return purchase


async def confirm_purchase(
    db: AsyncSession,
    *,
    purchase_id,
    operator: Vendor,
    approve: bool,
    note: Optional[str] = None,
) -> dict[str, Any]:
    purchase = (
        await db.execute(
            select(MerchantCreditPurchase)
            .where(MerchantCreditPurchase.id == purchase_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if purchase is None:
        raise CommerceError("That credit purchase was not found.", 404)
    if purchase.status == "confirmed":
        return {"purchase": purchase, "credited": False, "replayed": True}
    if purchase.status == "rejected":
        raise CommerceError("That purchase was already rejected.", 409)

    purchase.confirmed_by_vendor_id = operator.id
    if not approve:
        purchase.status = "rejected"
        purchase.note = (note or purchase.note or "Payment could not be matched.")[:300]
        audit(
            db, action="merchant_credit_rejected", entity_type="merchant_credit_purchase",
            entity_id=purchase.id, actor_vendor_id=operator.id,
            payload={"amount_kes": purchase.amount_kes, "note": purchase.note},
        )
        await db.flush()
        return {"purchase": purchase, "credited": False, "replayed": False}

    account = await account_for(db, purchase.merchant_id, lock=True)
    await expire(db, account)
    purchase.status = "confirmed"
    purchase.confirmed_at = _now()
    purchase.note = (note or purchase.note or "Payment matched.")[:300]
    account.purchased_kes = int(account.purchased_kes or 0) + int(purchase.amount_kes)
    account.available_kes = int(account.available_kes or 0) + int(purchase.amount_kes)
    days = int((await town_config.get_value(db, town_config.CREDIT_EXPIRY)).get("days") or 365)
    account.expires_at = _now() + timedelta(days=max(1, days))
    account.updated_at = _now()
    db.add(MerchantCreditEntry(
        merchant_id=purchase.merchant_id,
        entry_type="purchase",
        amount_kes=int(purchase.amount_kes),
        idempotency_key=f"purchase:{purchase.id}",
        reference_type="merchant_credit_purchase",
        reference_id=purchase.id,
        note=f"Confirmed by operator. Reference {purchase.payment_reference[:40]}",
        created_by_vendor_id=operator.id,
    ))
    audit(
        db, action="merchant_credit_confirmed", entity_type="merchant_credit_purchase",
        entity_id=purchase.id, actor_vendor_id=operator.id,
        payload={"amount_kes": purchase.amount_kes, "merchant_id": purchase.merchant_id},
    )
    await db.flush()
    return {"purchase": purchase, "credited": True, "replayed": False}


async def spend(
    db: AsyncSession,
    *,
    merchant_id,
    amount_kes: int,
    idempotency_key: str,
    reference_type: str,
    reference_id,
    note: str | None = None,
) -> int:
    """Spend up to `amount_kes` of credit. Returns what was actually funded.

    Partial funding is intentional: a shop with KES 30 left can fund 30 points
    today rather than silently issuing an unfunded reward. The caller records
    the unfunded remainder separately.
    """
    requested = max(0, int(amount_kes or 0))
    if requested == 0:
        return 0
    account = await account_for(db, merchant_id, lock=True)
    await expire(db, account)
    existing = (
        await db.execute(
            select(MerchantCreditEntry.id).where(
                MerchantCreditEntry.merchant_id == merchant_id,
                MerchantCreditEntry.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return 0
    funded = min(requested, max(0, int(account.available_kes or 0)))
    if funded <= 0:
        return 0
    account.available_kes = int(account.available_kes) - funded
    account.spent_kes = int(account.spent_kes or 0) + funded
    account.outstanding_kes = int(account.outstanding_kes or 0) + funded
    account.updated_at = _now()
    db.add(MerchantCreditEntry(
        merchant_id=merchant_id,
        entry_type="spend",
        amount_kes=funded,
        idempotency_key=idempotency_key[:120],
        reference_type=reference_type[:40],
        reference_id=reference_id,
        note=(note or "")[:300] or None,
    ))
    await db.flush()
    return funded


async def redeem_outstanding(db: AsyncSession, *, merchant_id, value_kes: int) -> None:
    """A voucher was used: the obligation it represented is settled in the shop."""
    account = await account_for(db, merchant_id, lock=True)
    settled = min(max(0, int(value_kes or 0)), max(0, int(account.outstanding_kes or 0)))
    if settled:
        account.outstanding_kes = int(account.outstanding_kes) - settled
        account.updated_at = _now()
        await db.flush()


async def purchases_for(
    db: AsyncSession, merchant_id, *, limit: int = 20,
) -> list[MerchantCreditPurchase]:
    return list((await db.execute(
        select(MerchantCreditPurchase)
        .where(MerchantCreditPurchase.merchant_id == merchant_id)
        .order_by(MerchantCreditPurchase.created_at.desc())
        .limit(limit)
    )).scalars().all())


async def pending_purchases(db: AsyncSession, *, limit: int = 50) -> list[MerchantCreditPurchase]:
    return list((await db.execute(
        select(MerchantCreditPurchase)
        .where(MerchantCreditPurchase.status == "pending")
        .order_by(MerchantCreditPurchase.created_at.asc())
        .limit(limit)
    )).scalars().all())


async def subscription_for(db: AsyncSession, merchant_id) -> MerchantAnalyticsSubscription | None:
    sub = (
        await db.execute(
            select(MerchantAnalyticsSubscription)
            .where(MerchantAnalyticsSubscription.merchant_id == merchant_id)
        )
    ).scalar_one_or_none()
    if sub is not None and sub.status == "active" and sub.expires_at and sub.expires_at <= _now():
        sub.status = "expired"
        await db.flush()
    return sub


async def premium(db: AsyncSession, merchant_id) -> bool:
    sub = await subscription_for(db, merchant_id)
    return bool(sub is not None and sub.status == "active")


async def request_subscription(
    db: AsyncSession,
    *,
    merchant: ReceiptMerchant,
    vendor: Vendor,
    months: int,
    payment_reference: str,
) -> MerchantAnalyticsSubscription:
    months = max(1, min(12, int(months or 1)))
    reference = " ".join((payment_reference or "").split())
    if len(reference) < 4:
        raise CommerceError("Record the payment reference for the subscription.", 422)
    sub = await subscription_for(db, merchant.id)
    if sub is None:
        sub = MerchantAnalyticsSubscription(id=uuid.uuid4(), merchant_id=merchant.id)
        db.add(sub)
    if sub.status == "active":
        raise CommerceError("This shop's analytics subscription is already active.", 409)
    sub.plan = "premium"
    sub.price_kes = SUBSCRIPTION_PRICE_KES
    sub.months = months
    sub.status = "pending"
    sub.payment_reference = reference[:120]
    sub.requested_by_vendor_id = vendor.id
    audit(
        db, action="analytics_subscription_requested",
        entity_type="merchant_analytics_subscription", entity_id=sub.id,
        actor_vendor_id=vendor.id,
        payload={"merchant_id": merchant.id, "months": months, "reference": reference[:40]},
    )
    await db.flush()
    return sub


async def confirm_subscription(
    db: AsyncSession, *, merchant_id, operator: Vendor, approve: bool, note: str | None = None,
) -> MerchantAnalyticsSubscription | None:
    sub = await subscription_for(db, merchant_id)
    if sub is None:
        raise CommerceError("That subscription request was not found.", 404)
    if sub.status == "active":
        return sub
    if not approve:
        sub.status = "rejected"
        sub.confirmed_by_vendor_id = operator.id
        await db.flush()
        return sub
    sub.status = "active"
    sub.confirmed_by_vendor_id = operator.id
    sub.started_at = _now()
    sub.expires_at = _now() + timedelta(days=30 * max(1, int(sub.months or 1)))
    audit(
        db, action="analytics_subscription_confirmed",
        entity_type="merchant_analytics_subscription", entity_id=sub.id,
        actor_vendor_id=operator.id,
        payload={"merchant_id": merchant_id, "months": int(sub.months or 1),
                 "note": (note or "")[:120]},
    )
    await db.flush()
    return sub

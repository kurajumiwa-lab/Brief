"""Merchant dashboard, reward policy and anonymised demand/price insights.

A shop sees its own transactions, not its customers. Customer identity never
appears in this payload: no vendor handle, no phone, no receipt raw payload.
Item-level and cross-shop price bands are part of the premium analytics plan;
the free dashboard still shows totals, credit and redemptions.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from statistics import median
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.receipts import Receipt, ReceiptMerchant, ReceiptVoucher
from app.models.vendor import Vendor
from app.modules.town import credits as credit_service
from app.modules.town import trust as trust_service
from app.modules.town.audit import audit
from app.modules.town.errors import CommerceError
from app.modules.town.models import (
    DisputeCase, MerchantRewardPolicy, ReceiptItem, ReceiptRedemption, ReferralListing,
)

DEFAULT_RATE = 2
DEFAULT_CAP = 500
INSIGHT_MIN_RECEIPTS = 10
INSIGHT_MIN_MERCHANTS = 3


async def owned_merchant(
    db: AsyncSession, vendor: Vendor, merchant_id=None,
) -> ReceiptMerchant:
    statement = select(ReceiptMerchant)
    if merchant_id is not None:
        statement = statement.where(ReceiptMerchant.id == merchant_id)
    else:
        statement = statement.where(ReceiptMerchant.claimed_by_vendor_id == vendor.id)
    merchant = (await db.execute(statement.with_for_update())).scalar_one_or_none()
    if merchant is None:
        raise CommerceError("No shop is linked to this account. Claim a shop first.", 404)
    if merchant.claimed_by_vendor_id != vendor.id and not getattr(vendor, "is_operator", False):
        # The router checks the operator allow-list; this is the ownership guard.
        from app.config import settings

        if not settings.is_operator(vendor.vendor_handle):
            raise CommerceError("Only the shop's verified owner can open this dashboard.", 403)
    return merchant


async def policy_for(db: AsyncSession, merchant_id) -> MerchantRewardPolicy:
    policy = (await db.execute(
        select(MerchantRewardPolicy).where(MerchantRewardPolicy.merchant_id == merchant_id)
    )).scalar_one_or_none()
    if policy is None:
        policy = MerchantRewardPolicy(
            merchant_id=merchant_id,
            points_per_100_kes=DEFAULT_RATE,
            max_points_per_receipt=DEFAULT_CAP,
            priority_bonus_pct=0,
        )
        db.add(policy)
        await db.flush()
    return policy


def policy_out(policy: MerchantRewardPolicy) -> dict[str, Any]:
    return {
        "points_per_100_kes": int(policy.points_per_100_kes),
        "max_points_per_receipt": int(policy.max_points_per_receipt),
        "priority_bonus_pct": int(policy.priority_bonus_pct),
        "updated_at": policy.updated_at.isoformat() if policy.updated_at else None,
        "explanation": (
            f"A KES 100 receipt earns {int(policy.points_per_100_kes)} points. "
            f"Receipts scanned within 15 minutes get an extra {int(policy.priority_bonus_pct)}%. "
            "Points are funded from prepaid credit, not from the platform."
        ),
    }


async def set_policy(
    db: AsyncSession, *, merchant: ReceiptMerchant, vendor: Vendor,
    points_per_100_kes: int, max_points_per_receipt: int, priority_bonus_pct: int,
) -> MerchantRewardPolicy:
    rate = int(points_per_100_kes or 0)
    cap = int(max_points_per_receipt or 0)
    bonus = int(priority_bonus_pct or 0)
    if not 1 <= rate <= 100:
        raise CommerceError("The reward rate must be between 1 and 100 points per KES 100.", 422)
    if not 0 <= cap <= 1_000_000:
        raise CommerceError("Set a reward cap between 0 and 1,000,000 points.", 422)
    if not 0 <= bonus <= 100:
        raise CommerceError("The priority bonus must be between 0% and 100%.", 422)
    if rate > 20:
        raise CommerceError("A rate above 20 points per KES 100 is likely a mistype; confirm with support.", 422)
    policy = await policy_for(db, merchant.id)
    policy.points_per_100_kes = rate
    policy.max_points_per_receipt = cap
    policy.priority_bonus_pct = bonus
    policy.updated_by_vendor_id = vendor.id
    audit(
        db, action="merchant_reward_policy_updated", entity_type="merchant_reward_policy",
        entity_id=policy.id, actor_vendor_id=vendor.id,
        payload={"rate": rate, "cap": cap, "priority_bonus": bonus, "merchant_id": merchant.id},
    )
    await db.flush()
    return policy


async def _receipt_totals(db: AsyncSession, merchant_id, since: datetime | None = None) -> dict[str, Any]:
    statement = select(
        func.count(Receipt.id),
        func.coalesce(func.sum(Receipt.total), 0),
        func.coalesce(func.sum(Receipt.points), 0),
        func.coalesce(func.sum(Receipt.reward_funded_kes), 0),
        func.count(func.distinct(Receipt.vendor_id)),
    ).where(Receipt.merchant_id == merchant_id)
    if since is not None:
        statement = statement.where(Receipt.scanned_at >= since)
    row = (await db.execute(statement)).one()
    return {
        "receipts": int(row[0] or 0),
        "sales_kes": int(row[1] or 0),
        "points_issued": int(row[2] or 0),
        "funded_kes": int(row[3] or 0),
        "customers": int(row[4] or 0),
    }


async def _redemptions(db: AsyncSession, merchant_id) -> dict[str, Any]:
    row = (await db.execute(
        select(func.count(ReceiptRedemption.id), func.coalesce(func.sum(ReceiptRedemption.value_kes), 0))
        .where(ReceiptRedemption.merchant_id == merchant_id)
    )).one()
    vouchers = (await db.execute(
        select(func.count(ReceiptVoucher.id))
        .where(ReceiptVoucher.merchant_id == merchant_id, ReceiptVoucher.status == "issued")
    )).scalar() or 0
    expired = (await db.execute(
        select(func.count(ReceiptVoucher.id))
        .where(ReceiptVoucher.merchant_id == merchant_id, ReceiptVoucher.status == "expired")
    )).scalar() or 0
    return {
        "redemptions": int(row[0] or 0),
        "value_kes": int(row[1] or 0),
        "open_vouchers": int(vouchers),
        "expired_vouchers": int(expired),
    }


async def _top_items(db: AsyncSession, merchant_id, limit: int = 8) -> list[dict[str, Any]]:
    rows = (await db.execute(
        select(
            ReceiptItem.description,
            func.sum(ReceiptItem.quantity),
            func.sum(ReceiptItem.total_price_kes),
            func.count(ReceiptItem.id),
        )
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .where(Receipt.merchant_id == merchant_id)
        .group_by(ReceiptItem.description)
        .order_by(func.sum(ReceiptItem.total_price_kes).desc())
        .limit(limit)
    )).all()
    return [
        {
            "description": row[0],
            "quantity": float(row[1] or 0),
            "value_kes": int(row[2] or 0),
            "lines": int(row[3] or 0),
        }
        for row in rows
    ]


async def _daily_demand(db: AsyncSession, merchant_id, days: int = 14) -> list[dict[str, Any]]:
    since = datetime.utcnow() - timedelta(days=max(1, min(60, days)))
    rows = (await db.execute(
        select(
            func.date(func.timezone("Africa/Nairobi", Receipt.scanned_at)),
            func.count(Receipt.id),
            func.coalesce(func.sum(Receipt.total), 0),
        )
        .where(Receipt.merchant_id == merchant_id, Receipt.scanned_at >= since)
        .group_by(func.date(func.timezone("Africa/Nairobi", Receipt.scanned_at)))
        .order_by(func.date(func.timezone("Africa/Nairobi", Receipt.scanned_at)))
    )).all()
    return [
        {"date": str(row[0]), "receipts": int(row[1]), "sales_kes": int(row[2] or 0)}
        for row in rows
    ]


async def _hour_demand(db: AsyncSession, merchant_id) -> list[dict[str, Any]]:
    rows = (await db.execute(
        select(
            func.extract("hour", func.timezone("Africa/Nairobi", Receipt.scanned_at)),
            func.count(Receipt.id),
        )
        .where(Receipt.merchant_id == merchant_id)
        .group_by(func.extract("hour", func.timezone("Africa/Nairobi", Receipt.scanned_at)))
        .order_by(func.extract("hour", func.timezone("Africa/Nairobi", Receipt.scanned_at)))
    )).all()
    return [{"hour": int(row[0]), "receipts": int(row[1])} for row in rows]


async def _price_bands(db: AsyncSession, merchant_id) -> list[dict[str, Any]]:
    rows = (await db.execute(
        select(ReceiptItem.description, ReceiptItem.unit_price_kes)
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .where(Receipt.merchant_id == merchant_id)
        .limit(2000)
    )).all()
    grouped: dict[str, list[int]] = {}
    for description, price in rows:
        grouped.setdefault(str(description), []).append(int(price or 0))
    out = []
    for description, prices in grouped.items():
        if len(prices) < 3:
            continue
        clean = sorted(price for price in prices if price > 0)
        if not clean:
            continue
        out.append({
            "description": description,
            "samples": len(clean),
            "min_kes": clean[0],
            "median_kes": int(round(median(clean))),
            "max_kes": clean[-1],
        })
    out.sort(key=lambda row: row["samples"], reverse=True)
    return out[:10]


async def _region_bands(db: AsyncSession, region: str | None = None) -> list[dict[str, Any]]:
    """Anonymised cross-shop price bands in the same region, above privacy floors."""
    statement = (
        select(
            ReceiptItem.description,
            func.count(func.distinct(Receipt.merchant_id)),
            func.count(ReceiptItem.id),
            func.avg(ReceiptItem.unit_price_kes),
        )
        .join(Receipt, Receipt.id == ReceiptItem.receipt_id)
        .join(ReceiptMerchant, ReceiptMerchant.id == Receipt.merchant_id)
        .where(Receipt.merchant_id.isnot(None), ReceiptItem.unit_price_kes > 0)
    )
    if region:
        statement = statement.where(ReceiptMerchant.region == region)
    rows = (await db.execute(statement.group_by(ReceiptItem.description))).all()
    out = []
    for description, merchants, samples, average in rows:
        if int(merchants or 0) < INSIGHT_MIN_MERCHANTS or int(samples or 0) < INSIGHT_MIN_RECEIPTS:
            continue
        out.append({
            "description": description,
            "merchants": int(merchants),
            "samples": int(samples),
            "average_unit_price_kes": int(round(float(average or 0))),
        })
    out.sort(key=lambda row: row["samples"], reverse=True)
    return out[:10]


async def dashboard(
    db: AsyncSession, *, merchant: ReceiptMerchant, viewer: Vendor, days: int = 30,
) -> dict[str, Any]:
    now = datetime.utcnow()
    since = now - timedelta(days=max(1, min(365, int(days or 30))))
    credits = await credit_service.summary(db, merchant.id)
    policy = await policy_for(db, merchant.id)
    trust = await trust_service.current(db, viewer.id)
    premium = await credit_service.premium(db, merchant.id)
    totals = await _receipt_totals(db, merchant.id)
    recent_totals = await _receipt_totals(db, merchant.id, since=since)
    redemptions = await _redemptions(db, merchant.id)
    listings = list((await db.execute(
        select(ReferralListing)
        .where(ReferralListing.owner_vendor_id == merchant.claimed_by_vendor_id)
        .order_by(ReferralListing.created_at.desc())
        .limit(5)
    )).scalars().all())
    recent_rows = list((await db.execute(
        select(Receipt)
        .where(Receipt.merchant_id == merchant.id)
        .order_by(Receipt.scanned_at.desc())
        .limit(8)
    )).scalars().all())
    disputes = int((await db.execute(
        select(func.count(DisputeCase.id)).where(
            DisputeCase.domain == "receipt",
            DisputeCase.status == "open",
            DisputeCase.subject_id.in_(select(Receipt.id).where(Receipt.merchant_id == merchant.id)),
        )
    )).scalar() or 0)

    payload: dict[str, Any] = {
        "merchant": {
            "id": str(merchant.id),
            "name": merchant.name,
            "region": merchant.region,
            "claim_status": merchant.claim_status,
            "can_publish_offers": merchant.claim_status in ("verified", "probationary"),
        },
        "viewer_trust": trust,
        "credits": credits,
        "policy": policy_out(policy),
        "period_days": int(days),
        "totals": totals,
        "period": recent_totals,
        "redemptions": redemptions,
        "recent_receipts": [
            {
                "id": str(row.id),
                "total_kes": int(row.total),
                "points": int(row.points or 0),
                "funded_kes": int(row.reward_funded_kes or 0),
                "status": row.status,
                "source": row.source,
                "freshness": row.freshness_key,
                "scanned_at": row.scanned_at.isoformat(),
                "flags": row.fraud_flags or [],
            }
            for row in recent_rows
        ],
        "listings": [
            {
                "id": str(row.id),
                "title": row.title,
                "provider": row.provider,
                "verification_status": row.verification_status,
                "bounty_kes": int(row.bounty_kes or 0),
                "status": row.status,
            }
            for row in listings
        ],
        "open_disputes": disputes,
        "analytics": {
            "premium": premium,
            "price_kes": credit_service.SUBSCRIPTION_PRICE_KES,
            "locked_reason": None if premium else "Premium analytics shows item-level demand and price bands.",
        },
        "obligations_note": (
            "Available credit is a promotional budget, not revenue. Outstanding customer rewards "
            "and expired credit are tracked as obligations separately and are never counted as earned revenue."
        ),
    }
    if premium:
        payload["analytics"].update({
            "top_items": await _top_items(db, merchant.id),
            "daily_demand": await _daily_demand(db, merchant.id, days=min(30, int(days))),
            "hour_demand": await _hour_demand(db, merchant.id),
            "price_bands": await _price_bands(db, merchant.id),
            "region_price_bands": await _region_bands(db, merchant.region),
            "privacy_floors": {
                "min_receipts": INSIGHT_MIN_RECEIPTS,
                "min_merchants": INSIGHT_MIN_MERCHANTS,
            },
        })
    return payload


async def request_subscription(
    db: AsyncSession, *, merchant: ReceiptMerchant, vendor: Vendor,
    months: int, payment_reference: str,
):
    return await credit_service.request_subscription(
        db, merchant=merchant, vendor=vendor, months=months,
        payment_reference=payment_reference,
    )


async def subscription_payload(db: AsyncSession, merchant_id) -> dict[str, Any]:
    sub = await credit_service.subscription_for(db, merchant_id)
    if sub is None:
        return {"status": "none", "price_kes": credit_service.SUBSCRIPTION_PRICE_KES, "plan": "premium"}
    return {
        "id": str(sub.id),
        "status": sub.status,
        "plan": sub.plan,
        "price_kes": int(sub.price_kes or 0),
        "months": int(sub.months or 1),
        "payment_reference": sub.payment_reference,
        "started_at": sub.started_at.isoformat() if sub.started_at else None,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
    }

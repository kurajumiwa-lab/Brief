"""Admin moderation for the town commerce layer.

Mounted at `/api/ops/commerce` and gated by the same `require_operator` allowlist
as the rest of ops. This is where a credit purchase is confirmed, a listing is
verified, a conversion is independently checked, a dispute is resolved and a
percentage is changed.

The overview separates three numbers that must never be conflated:

  `available_credit_kes`      a merchant's promotional budget
  `outstanding_obligations`   customer rewards already issued but not redeemed
  `recognized_fee_revenue`    only platform fees that have actually been paid
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.notification import NotificationType
from app.models.receipts import Receipt, ReceiptMerchant
from app.modules.corridor_tasks.models import CorridorTask
from app.modules.town import config as town_config
from app.modules.town import credits as credit_service
from app.modules.town import referral_exchange as exchange
from app.modules.town.audit import audit
from app.modules.town.errors import CommerceError
from app.modules.town.models import (
    CommerceSetting, DisputeCase, MerchantAnalyticsSubscription, MerchantCreditAccount,
    MerchantCreditPurchase, PlatformFeeEntry, ReferralConversion, ReferralListing,
)
from app.modules.town.schemas import (
    CommerceSettingsIn, PurchaseReviewIn, ReferralVerifyIn, ResolveDisputeIn,
)
from app.modules.trust.models import AuditEvent
from app.services.notification_service import create_notification
from app.routes.ops import require_operator

router = APIRouter()


def _fail(exc: CommerceError):
    raise HTTPException(exc.status, exc.message)


def _sum(statement):
    return func.coalesce(func.sum(statement), 0)


@router.get("/overview")
async def overview(
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    credit_row = (await db.execute(
        select(
            _sum(MerchantCreditAccount.purchased_kes),
            _sum(MerchantCreditAccount.available_kes),
            _sum(MerchantCreditAccount.spent_kes),
            _sum(MerchantCreditAccount.expired_kes),
            _sum(MerchantCreditAccount.outstanding_kes),
        )
    )).one()
    receipt_row = (await db.execute(
        select(func.count(Receipt.id), _sum(Receipt.total), _sum(Receipt.points))
    )).one()
    listings = int((await db.execute(select(func.count(ReferralListing.id)))).scalar() or 0)
    verified_listings = int((await db.execute(
        select(func.count(ReferralListing.id)).where(ReferralListing.verification_status == "verified")
    )).scalar() or 0)
    active_sponsors = int((await db.execute(
        select(func.count(ReferralListing.id)).where(
            ReferralListing.sponsored_bid_kes > 0,
            ReferralListing.sponsored_until > datetime.utcnow(),
        )
    )).scalar() or 0)
    conversions = int((await db.execute(select(func.count(ReferralConversion.id)))).scalar() or 0)
    verified_conversions = int((await db.execute(
        select(func.count(ReferralConversion.id)).where(ReferralConversion.status == "verified")
    )).scalar() or 0)
    open_disputes = int((await db.execute(
        select(func.count(DisputeCase.id)).where(DisputeCase.status.in_(("open", "reviewing")))
    )).scalar() or 0)
    pending_purchases = int((await db.execute(
        select(func.count(MerchantCreditPurchase.id)).where(MerchantCreditPurchase.status == "pending")
    )).scalar() or 0)
    pending_subscriptions = int((await db.execute(
        select(func.count(MerchantAnalyticsSubscription.id)).where(
            MerchantAnalyticsSubscription.status == "pending"
        )
    )).scalar() or 0)
    pending_conversions = int((await db.execute(
        select(func.count(ReferralConversion.id)).where(
            ReferralConversion.status.in_(("pending", "disputed"))
        )
    )).scalar() or 0)
    fee_rows = (await db.execute(
        select(PlatformFeeEntry.status, _sum(PlatformFeeEntry.fee_kes))
        .group_by(PlatformFeeEntry.status)
    )).all()
    fees = {str(row[0]): int(row[1] or 0) for row in fee_rows}
    return {
        "credits": {
            "purchased_kes": int(credit_row[0] or 0),
            "available_kes": int(credit_row[1] or 0),
            "spent_kes": int(credit_row[2] or 0),
            "expired_kes": int(credit_row[3] or 0),
            "outstanding_obligations_kes": int(credit_row[4] or 0),
        },
        "receipts": {
            "count": int(receipt_row[0] or 0),
            "sales_kes": int(receipt_row[1] or 0),
            "points_issued": int(receipt_row[2] or 0),
        },
        "referrals": {
            "listings": listings,
            "verified_listings": verified_listings,
            "active_sponsored": active_sponsors,
            "conversions": conversions,
            "verified_conversions": verified_conversions,
            "pending_conversions": pending_conversions,
        },
        "fees": {
            "accrued_kes": fees.get("accrued", 0),
            "invoiced_kes": fees.get("invoiced", 0),
            "paid_kes": fees.get("paid", 0),
            "waived_kes": fees.get("waived", 0),
            "recognized_fee_revenue_kes": fees.get("paid", 0),
        },
        "queues": {
            "pending_credit_purchases": pending_purchases,
            "pending_subscriptions": pending_subscriptions,
            "pending_conversions": pending_conversions,
            "open_disputes": open_disputes,
        },
        "accounting_note": (
            "Available credit and outstanding customer rewards are obligations, not revenue. "
            "Only fees with status `paid` are recognized. The platform holds no payout funds."
        ),
        "free_for_now": bool(settings.FREE_FOR_NOW),
        "fees_enabled": bool(settings.FEES_ENABLED),
    }


@router.get("/credits/pending")
async def pending_credit_purchases(
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    rows = await credit_service.pending_purchases(db)
    merchants = {}
    if rows:
        ids = {row.merchant_id for row in rows}
        merchants = {
            merchant.id: merchant for merchant in (await db.execute(
                select(ReceiptMerchant).where(ReceiptMerchant.id.in_(ids))
            )).scalars().all()
        }
    return {
        "purchases": [
            {
                "id": str(row.id),
                "merchant_id": str(row.merchant_id),
                "merchant_name": merchants[row.merchant_id].name if row.merchant_id in merchants else None,
                "amount_kes": int(row.amount_kes),
                "payment_reference": row.payment_reference,
                "requested_at": row.created_at.isoformat(),
                "status": row.status,
            }
            for row in rows
        ]
    }


@router.post("/credits/purchases/{purchase_id}/review")
async def review_credit_purchase(
    purchase_id: uuid.UUID,
    body: PurchaseReviewIn,
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await credit_service.confirm_purchase(
            db, purchase_id=purchase_id, operator=operator,
            approve=body.approve, note=body.note,
        )
        await db.commit()
        purchase = result["purchase"]
        if purchase.requested_by_vendor_id and not result["replayed"]:
            confirmed = purchase.status == "confirmed"
            await create_notification(
                db, purchase.requested_by_vendor_id, NotificationType.SYSTEM,
                "Prepaid credit confirmed" if confirmed else "Credit purchase rejected",
                (
                    f"KES {int(purchase.amount_kes):,} was added to your promotional credit."
                    if confirmed else
                    "The payment could not be matched. No credit was posted."
                ),
                sender_id=operator.id, data={"merchant_credit_purchase_id": str(purchase.id)},
            )
            await db.commit()
        return {
            "purchase": {
                "id": str(purchase.id),
                "status": purchase.status,
                "amount_kes": int(purchase.amount_kes),
                "confirmed_at": purchase.confirmed_at.isoformat() if purchase.confirmed_at else None,
            },
            "credited": result["credited"],
            "replayed": result["replayed"],
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.get("/subscriptions/pending")
async def pending_subscriptions(
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    rows = list((await db.execute(
        select(MerchantAnalyticsSubscription, ReceiptMerchant)
        .join(ReceiptMerchant, ReceiptMerchant.id == MerchantAnalyticsSubscription.merchant_id)
        .where(MerchantAnalyticsSubscription.status == "pending")
        .order_by(MerchantAnalyticsSubscription.created_at.asc())
    )).all())
    return {
        "subscriptions": [
            {
                "merchant_id": str(sub.merchant_id),
                "merchant_name": merchant.name,
                "plan": sub.plan,
                "price_kes": int(sub.price_kes or 0),
                "months": int(sub.months or 1),
                "payment_reference": sub.payment_reference,
                "requested_at": sub.created_at.isoformat(),
            }
            for sub, merchant in rows
        ]
    }


@router.post("/subscriptions/{merchant_id}/review")
async def review_subscription(
    merchant_id: uuid.UUID,
    body: PurchaseReviewIn,
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    try:
        sub = await credit_service.confirm_subscription(
            db, merchant_id=merchant_id, operator=operator,
            approve=body.approve, note=body.note,
        )
        await db.commit()
        if sub is not None and sub.requested_by_vendor_id:
            await create_notification(
                db, sub.requested_by_vendor_id, NotificationType.SYSTEM,
                "Analytics subscription active" if sub.status == "active" else "Analytics subscription rejected",
                (
                    "Premium analytics is unlocked until "
                    f"{sub.expires_at.strftime('%d %b %Y') if sub.expires_at else 'the end of the term'}."
                    if sub.status == "active" else
                    "The subscription payment could not be confirmed."
                ),
                sender_id=operator.id,
            )
            await db.commit()
        return {
            "subscription": {
                "merchant_id": str(merchant_id),
                "status": sub.status if sub else "none",
                "expires_at": sub.expires_at.isoformat() if sub and sub.expires_at else None,
            }
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.get("/listings/pending")
async def pending_listings(
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    rows = list((await db.execute(
        select(ReferralListing)
        .where(ReferralListing.verification_status.in_(("unverified", "pending")))
        .order_by(ReferralListing.created_at.asc())
        .limit(100)
    )).scalars().all())
    return {"listings": [exchange.listing_out(row) for row in rows]}


@router.post("/listings/{listing_id}/verify")
async def verify_listing(
    listing_id: uuid.UUID,
    body: ReferralVerifyIn,
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    listing = (await db.execute(
        select(ReferralListing).where(ReferralListing.id == listing_id)
    )).scalar_one_or_none()
    if listing is None:
        raise HTTPException(404, "That listing was not found.")
    listing.verification_status = "verified" if body.approve else "rejected"
    listing.verification_note = (body.note or ("Verified by an operator." if body.approve else "Rejected by an operator."))[:500]
    listing.updated_at = datetime.utcnow()
    audit(
        db, action="referral_listing_reviewed", entity_type="referral_listing",
        entity_id=listing.id, actor_vendor_id=operator.id,
        payload={"status": listing.verification_status, "note": listing.verification_note[:120]},
    )
    await db.commit()
    return {"listing": exchange.listing_out(listing)}


@router.get("/conversions/pending")
async def pending_conversions(
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    rows = list((await db.execute(
        select(ReferralConversion, ReferralListing)
        .join(ReferralListing, ReferralListing.id == ReferralConversion.listing_id)
        .where(ReferralConversion.status.in_(("pending", "disputed")))
        .order_by(ReferralConversion.created_at.asc())
        .limit(100)
    )).all())
    return {
        "conversions": [
            {
                "id": str(conversion.id),
                "listing_id": str(conversion.listing_id),
                "provider": listing.provider,
                "title": listing.title,
                "status": conversion.status,
                "proof_type": conversion.proof_type,
                "proof_reference": conversion.proof_reference,
                "bounty_kes": int(conversion.bounty_kes or 0),
                "created_at": conversion.created_at.isoformat(),
            }
            for conversion, listing in rows
        ]
    }


@router.post("/conversions/{conversion_id}/verify")
async def verify_conversion(
    conversion_id: uuid.UUID,
    body: ReferralVerifyIn,
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    conversion = (await db.execute(
        select(ReferralConversion).where(ReferralConversion.id == conversion_id).with_for_update()
    )).scalar_one_or_none()
    if conversion is None:
        raise HTTPException(404, "That conversion was not found.")
    try:
        conversion = await exchange.verify(
            db, conversion=conversion, reviewer=operator, approve=body.approve, note=body.note,
        )
        await db.commit()
        await db.refresh(conversion)
        return {
            "conversion": {
                "id": str(conversion.id),
                "status": conversion.status,
                "bounty_status": conversion.bounty_status,
                "bounty_kes": int(conversion.bounty_kes or 0),
                "review_note": conversion.review_note,
            }
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.get("/disputes")
async def disputes(
    status: Optional[str] = Query(None, max_length=20),
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    statement = select(DisputeCase).order_by(DisputeCase.created_at.desc()).limit(200)
    if status:
        statement = statement.where(DisputeCase.status == status)
    rows = list((await db.execute(statement)).scalars().all())
    return {"disputes": [
        {
            "id": str(row.id),
            "domain": row.domain,
            "subject_id": str(row.subject_id),
            "status": row.status,
            "reason": row.reason,
            "opened_by_vendor_id": str(row.opened_by_vendor_id) if row.opened_by_vendor_id else None,
            "against_vendor_id": str(row.against_vendor_id) if row.against_vendor_id else None,
            "resolution": row.resolution,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]}


@router.post("/disputes/{dispute_id}/resolve")
async def resolve_dispute(
    dispute_id: uuid.UUID,
    body: ResolveDisputeIn,
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    dispute = (await db.execute(
        select(DisputeCase).where(DisputeCase.id == dispute_id).with_for_update()
    )).scalar_one_or_none()
    if dispute is None:
        raise HTTPException(404, "That dispute was not found.")
    dispute.status = body.status
    dispute.resolution = body.resolution
    dispute.resolved_by_vendor_id = operator.id
    dispute.resolved_at = datetime.utcnow()
    audit(
        db, action="dispute_resolved", entity_type=f"{dispute.domain}_dispute",
        entity_id=dispute.id, actor_vendor_id=operator.id,
        payload={"status": dispute.status, "resolution": body.resolution[:120]},
    )
    for recipient in (dispute.opened_by_vendor_id, dispute.against_vendor_id):
        if recipient:
            await create_notification(
                db, recipient, NotificationType.SYSTEM,
                "A dispute was resolved",
                body.resolution[:500],
                sender_id=operator.id, data={"dispute_id": str(dispute.id)},
            )
    await db.commit()
    return {
        "dispute": {
            "id": str(dispute.id),
            "status": dispute.status,
            "resolution": dispute.resolution,
            "resolved_at": dispute.resolved_at.isoformat(),
        }
    }


@router.get("/settings")
async def commerce_settings(
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    values = await town_config.all_values(db)
    return {
        "settings": values,
        "charging_enabled": town_config.charging_enabled(),
        "free_for_now": bool(settings.FREE_FOR_NOW),
        "fees_enabled": bool(settings.FEES_ENABLED),
        "disclosure": (
            "Rates are percentages. While FREE_FOR_NOW is on, the quote still shows the "
            "configured percentage but no fee is accrued or charged."
        ),
    }


@router.patch("/settings")
async def update_commerce_settings(
    body: CommerceSettingsIn,
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    changes = body.model_dump(exclude_unset=True, exclude={"note"})
    key_map = {
        "campaign_fee_pct": town_config.CAMPAIGN_FEE,
        "lead_fee_pct": town_config.LEAD_FEE,
        "expiry_days": town_config.CREDIT_EXPIRY,
        **{
            f"{key}_pct": key
            for key in town_config.SCOUT_FEE_KEYS.values()
        },
    }
    if "credit_expiry_days" in changes:
        changes["expiry_days"] = changes.pop("credit_expiry_days")
    if not changes:
        raise HTTPException(422, "Send at least one rate to change.")
    for field, value in changes.items():
        key = key_map.get(field)
        if key is None:
            continue
        if field == "expiry_days":
            await town_config.set_value(
                db, key, {"days": int(value)}, actor_id=operator.id,
                description=body.note or "Credit validity period",
            )
        else:
            await town_config.set_value(
                db, key, {"pct": float(value)}, actor_id=operator.id,
                description=body.note or "Platform fee percentage",
            )
        audit(
            db, action="commerce_rate_changed", entity_type="commerce_setting",
            entity_id=uuid.uuid4(), actor_vendor_id=operator.id,
            payload={"key": key, "value": value, "note": body.note or ""},
        )
    await db.commit()
    return {
        "settings": await town_config.all_values(db),
        "charging_enabled": town_config.charging_enabled(),
        "note": "The change applies to the next quote. Existing accrued fees are not rewritten.",
    }


@router.get("/fees")
async def platform_fees(
    status: Optional[str] = Query(None, max_length=20),
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    statement = select(PlatformFeeEntry).order_by(PlatformFeeEntry.created_at.desc()).limit(200)
    if status:
        statement = statement.where(PlatformFeeEntry.status == status)
    rows = list((await db.execute(statement)).scalars().all())
    return {
        "fees": [
            {
                "id": str(row.id),
                "source_type": row.source_type,
                "source_id": str(row.source_id),
                "base_amount_kes": int(row.base_amount_kes or 0),
                "fee_pct": float(row.fee_pct),
                "fee_kes": int(row.fee_kes or 0),
                "status": row.status,
                "note": row.note,
                "created_at": row.created_at.isoformat(),
                "paid_at": row.paid_at.isoformat() if row.paid_at else None,
            }
            for row in rows
        ]
    }


@router.get("/audit")
async def commerce_audit(
    limit: int = Query(100, ge=1, le=500),
    operator=Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    rows = list((await db.execute(
        select(AuditEvent)
        .where(or_(
            AuditEvent.entity_type.in_((
                "receipt", "receipt_merchant", "referral_listing", "referral_conversion",
                "merchant_credit_purchase", "merchant_reward_policy", "corridor_task",
                "referral_bounty", "commerce_setting", "merchant_analytics_subscription",
            )),
            AuditEvent.action.like("referral_%"),
            AuditEvent.action.like("merchant_credit_%"),
            AuditEvent.action.like("commerce_%"),
        ))
        .order_by(AuditEvent.created_at.desc())
        .limit(limit)
    )).scalars().all())
    return {
        "events": [
            {
                "id": str(row.id),
                "action": row.action,
                "entity_type": row.entity_type,
                "entity_id": str(row.entity_id),
                "actor_vendor_id": str(row.actor_vendor_id) if row.actor_vendor_id else None,
                "payload": row.payload,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }

"""Referral economics without custody.

The loop this module implements:

    merchant funds a campaign for a shop they have claimed
        → a member shares a code
        → a new person links the code before they shop
        → a *verified* receipt at that exact shop qualifies the referral
        → points land in the append-only points ledger
        → the merchant sees a bounty due and pays it directly

A code, a screenshot or a claimed link moves nothing. The only transition to
`qualified` lives in `qualify_verified_receipt`, and it is called by the receipt
engine after the receipt itself has been priced and accepted.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.notification import NotificationType
from app.models.receipts import Receipt, ReceiptMerchant
from app.models.vendor import Vendor
from app.modules.referrals.models import Referral, ReferralCampaign, ReferralLink
from app.modules.trust.models import PointsEntry
from app.services import merchant_claims as claims_service
from app.services.notification_service import create_notification

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class ReferralError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat(timespec="seconds") + "Z"
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _region(value: Optional[str]) -> str:
    cleaned = (value or "").strip().lower().replace("_", "-").replace(" ", "-")
    return cleaned[:60] or "nyanza"


def _new_code() -> str:
    return "R" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(7))


def _price_label(value: int) -> str:
    return f"KSh {int(value):,}"


def _empty_stats() -> dict:
    return {
        "referrals": 0, "pending": 0, "qualified": 0, "rejected": 0, "used": 0,
        "reward_points_awarded": 0, "bounty_due_kes": 0, "bounty_paid_kes": 0,
    }


def _campaign_stats_map(rows) -> dict:
    out: dict = {}
    for row in rows:
        campaign_id, total, pending, qualified, rejected, points, due, paid = row
        out[campaign_id] = {
            "referrals": int(total or 0),
            "pending": int(pending or 0),
            "qualified": int(qualified or 0),
            "rejected": int(rejected or 0),
            "used": int(pending or 0) + int(qualified or 0),
            "reward_points_awarded": int(points or 0),
            "bounty_due_kes": int(due or 0),
            "bounty_paid_kes": int(paid or 0),
        }
    return out


async def _stats_for(db: AsyncSession, campaign_ids: list[uuid.UUID]) -> dict:
    if not campaign_ids:
        return {}
    rows = (
        await db.execute(
            select(
                Referral.campaign_id,
                func.count(Referral.id),
                func.count(Referral.id).filter(Referral.status == "pending"),
                func.count(Referral.id).filter(Referral.status == "qualified"),
                func.count(Referral.id).filter(Referral.status == "rejected"),
                func.coalesce(
                    func.sum(Referral.reward_points).filter(Referral.status == "qualified"), 0,
                ),
                func.coalesce(
                    func.sum(Referral.bounty_kes).filter(
                        and_(Referral.status == "qualified", Referral.bounty_status == "due")
                    ), 0,
                ),
                func.coalesce(
                    func.sum(Referral.bounty_kes).filter(Referral.bounty_status == "paid"), 0,
                ),
            )
            .where(Referral.campaign_id.in_(campaign_ids))
            .group_by(Referral.campaign_id)
        )
    ).all()
    return _campaign_stats_map(rows)


def _link_out(link: ReferralLink) -> dict:
    return {
        "id": str(link.id),
        "code": link.code,
        "path": f"/r/{link.code}",
        "active": bool(link.active),
        "created_at": _iso(link.created_at),
    }


def _campaign_out(
    campaign: ReferralCampaign,
    merchant: ReceiptMerchant,
    *,
    viewer_id: Optional[uuid.UUID],
    stats: Optional[dict] = None,
    link: Optional[ReferralLink] = None,
) -> dict:
    stats = stats or _empty_stats()
    max_referrals = int(campaign.max_referrals or 0)
    return {
        "id": str(campaign.id),
        "title": campaign.title,
        "description": campaign.description,
        "region_slug": campaign.region_slug,
        "country_code": campaign.country_code,
        "status": campaign.status,
        "reward_points": int(campaign.reward_points or 0),
        "reward_kes": int(campaign.reward_kes or 0),
        "max_referrals": max_referrals,
        "remaining_referrals": max(0, max_referrals - stats["used"]),
        # The campaign budget is the promise multiplied by the places. It is a
        # ceiling, not a wallet: the merchant pays each bounty directly.
        "budget_points": max_referrals * int(campaign.reward_points or 0),
        "budget_kes": max_referrals * int(campaign.reward_kes or 0),
        "merchant": {"name": merchant.name, "pin": merchant.pin, "region": merchant.region},
        "is_mine": bool(viewer_id and campaign.merchant_vendor_id == viewer_id),
        "my_link": _link_out(link) if link else None,
        "stats": stats,
        "starts_at": _iso(campaign.starts_at),
        "ends_at": _iso(campaign.ends_at),
        "created_at": _iso(campaign.created_at),
    }


def _referral_out(
    referral: Referral,
    campaign: ReferralCampaign,
    merchant: ReceiptMerchant,
    referred: Vendor,
    referrer: Optional[Vendor] = None,
) -> dict:
    out = {
        "id": str(referral.id),
        "status": referral.status,
        "campaign_id": str(campaign.id),
        "campaign_title": campaign.title,
        "merchant_name": merchant.name,
        "reward_points": int(referral.reward_points or 0),
        "bounty_kes": int(referral.bounty_kes or 0),
        "bounty_status": referral.bounty_status,
        "bounty_marked_at": _iso(referral.bounty_marked_at),
        "bounty_note": referral.bounty_note,
        "qualified_at": _iso(referral.qualified_at),
        "rejected_reason": referral.rejected_reason,
        "referred": {
            "name": referred.business_name,
            "handle": referred.vendor_handle,
        },
        "evidence": (
            {
                "receipt_total": int(referral.receipt_total or 0),
                "merchant_name": merchant.name,
                "note": "A server-verified receipt at this shop is the evidence. A screenshot is not.",
            }
            if referral.receipt_total
            else None
        ),
        "created_at": _iso(referral.created_at),
    }
    if referrer is not None:
        out["referrer"] = {"name": referrer.business_name, "handle": referrer.vendor_handle}
    return out


async def _merchant_or_500(db: AsyncSession, merchant_id: uuid.UUID) -> ReceiptMerchant:
    merchant = (
        await db.execute(select(ReceiptMerchant).where(ReceiptMerchant.id == merchant_id))
    ).scalar_one_or_none()
    if merchant is None:
        raise ReferralError("The shop behind this campaign no longer exists.", status=409)
    return merchant


async def _owned_shop(db: AsyncSession, vendor: Vendor, shop_id: uuid.UUID) -> ReceiptMerchant:
    shop = (
        await db.execute(
            select(ReceiptMerchant).where(
                ReceiptMerchant.id == shop_id,
                ReceiptMerchant.claimed_by_vendor_id == vendor.id,
            )
        )
    ).scalar_one_or_none()
    if shop is None:
        raise ReferralError("That shop is not one you have claimed.", status=404)
    if not claims_service.can_publish_offers(shop.claim_status):
        raise ReferralError(
            "Finish the shop claim before funding referral invitations. A pending claim cannot promise a reward.",
            status=403,
        )
    return shop


async def _campaign_or_404(db: AsyncSession, campaign_id: uuid.UUID) -> ReferralCampaign:
    campaign = (
        await db.execute(select(ReferralCampaign).where(ReferralCampaign.id == campaign_id))
    ).scalar_one_or_none()
    if campaign is None:
        raise ReferralError("That referral campaign was not found.", status=404)
    return campaign


async def create_campaign(db: AsyncSession, vendor: Vendor, body) -> dict:
    shop = await _owned_shop(db, vendor, body.shop_id)
    reward_points = int(body.reward_points or 0)
    reward_kes = int(body.reward_kes or 0)
    if reward_points <= 0 and reward_kes <= 0:
        raise ReferralError(
            "A campaign must offer points or a cash bounty. People should not work for nothing.",
            status=422,
        )
    now = datetime.utcnow()
    ends_at = _naive_utc(body.ends_at)
    if ends_at is not None and ends_at <= now:
        raise ReferralError("The campaign must end in the future.", status=422)
    campaign = ReferralCampaign(
        merchant_vendor_id=vendor.id,
        receipt_merchant_id=shop.id,
        title=" ".join(body.title.split())[:160],
        description=body.description,
        region_slug=_region(body.region_slug or shop.region or "nyanza"),
        country_code="KE",
        reward_points=reward_points,
        reward_kes=reward_kes,
        max_referrals=int(body.max_referrals),
        status="active",
        starts_at=now,
        ends_at=ends_at,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)
    return _campaign_out(campaign, shop, viewer_id=vendor.id)


async def set_campaign_status(
    db: AsyncSession, vendor: Vendor, campaign_id: uuid.UUID, status: str,
) -> dict:
    campaign = await _campaign_or_404(db, campaign_id)
    if campaign.merchant_vendor_id != vendor.id:
        raise ReferralError("Only the shop that funds a campaign can pause it.", status=403)
    if status not in ("active", "paused"):
        raise ReferralError("A campaign is either active or paused.", status=422)
    if status == "active" and campaign.ends_at and campaign.ends_at <= datetime.utcnow():
        raise ReferralError("This campaign has ended. Create a new one.", status=409)
    campaign.status = status
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(campaign)
    shop = await _merchant_or_500(db, campaign.receipt_merchant_id)
    stats = (await _stats_for(db, [campaign.id])).get(campaign.id, _empty_stats())
    return _campaign_out(campaign, shop, viewer_id=vendor.id, stats=stats)


async def create_link(db: AsyncSession, vendor: Vendor, campaign_id: uuid.UUID) -> dict:
    campaign = (
        await db.execute(
            select(ReferralCampaign).where(ReferralCampaign.id == campaign_id).with_for_update()
        )
    ).scalar_one_or_none()
    if campaign is None:
        raise ReferralError("That referral campaign was not found.", status=404)
    if campaign.status != "active":
        raise ReferralError("This campaign is paused. A code from it would not be honest.", status=409)
    if campaign.ends_at and campaign.ends_at <= datetime.utcnow():
        raise ReferralError("This campaign has ended.", status=409)
    if campaign.merchant_vendor_id == vendor.id:
        raise ReferralError("You fund this campaign; you cannot also claim its bounty.", status=409)
    stats = (await _stats_for(db, [campaign.id])).get(campaign.id, _empty_stats())
    if stats["used"] >= int(campaign.max_referrals):
        raise ReferralError("This campaign has filled all of its invitation places.", status=409)

    existing = (
        await db.execute(
            select(ReferralLink).where(
                ReferralLink.campaign_id == campaign.id,
                ReferralLink.referrer_vendor_id == vendor.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if not existing.active:
            existing.active = True
            await db.commit()
            await db.refresh(existing)
        return _link_out(existing)

    code = None
    for _ in range(8):
        candidate = _new_code()
        taken = (
            await db.execute(select(ReferralLink.id).where(ReferralLink.code == candidate))
        ).scalar_one_or_none()
        if taken is None:
            code = candidate
            break
    if code is None:
        raise ReferralError("Could not create a code just now. Try once more.", status=503)

    link = ReferralLink(
        campaign_id=campaign.id,
        referrer_vendor_id=vendor.id,
        code=code,
        active=True,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _link_out(link)


async def attribute_code(db: AsyncSession, vendor: Vendor, code: str) -> dict:
    normalized = (code or "").strip().upper()
    if not normalized:
        raise ReferralError("A referral code is required.", status=422)
    link = (
        await db.execute(
            select(ReferralLink).where(ReferralLink.code == normalized).with_for_update()
        )
    ).scalar_one_or_none()
    if link is None or not link.active:
        raise ReferralError("That invite is not active.", status=404)
    campaign = (
        await db.execute(
            select(ReferralCampaign).where(ReferralCampaign.id == link.campaign_id).with_for_update()
        )
    ).scalar_one_or_none()
    if campaign is None or campaign.status != "active":
        raise ReferralError("That campaign is not accepting new people right now.", status=409)
    if campaign.ends_at and campaign.ends_at <= datetime.utcnow():
        raise ReferralError("That campaign has ended.", status=409)
    if campaign.merchant_vendor_id == vendor.id:
        raise ReferralError("The shop funding a campaign cannot be its own referral.", status=409)
    if link.referrer_vendor_id == vendor.id:
        raise ReferralError("You cannot claim your own referral code.", status=409)

    existing = (
        await db.execute(
            select(Referral).where(
                Referral.campaign_id == campaign.id,
                Referral.referred_vendor_id == vendor.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.referrer_vendor_id == link.referrer_vendor_id:
            shop = await _merchant_or_500(db, campaign.receipt_merchant_id)
            return {
                "referral": _referral_out(existing, campaign, shop, vendor),
                "already_linked": True,
            }
        raise ReferralError("Another invitation already introduced you to this campaign.", status=409)

    stats = (await _stats_for(db, [campaign.id])).get(campaign.id, _empty_stats())
    if stats["used"] >= int(campaign.max_referrals):
        raise ReferralError("This campaign has filled all of its invitation places.", status=409)

    referral = Referral(
        campaign_id=campaign.id,
        link_id=link.id,
        referrer_vendor_id=link.referrer_vendor_id,
        referred_vendor_id=vendor.id,
        status="pending",
        reward_points=0,
        bounty_kes=0,
        bounty_status="not_due",
    )
    db.add(referral)
    await db.flush()
    await create_notification(
        db,
        campaign.merchant_vendor_id,
        NotificationType.SYSTEM,
        "Someone linked your referral campaign",
        "They stay pending until a verified receipt at your shop. A link is not a customer.",
        data={"referral_id": str(referral.id), "campaign_id": str(campaign.id)},
    )
    await db.commit()
    await db.refresh(referral)
    shop = await _merchant_or_500(db, campaign.receipt_merchant_id)
    return {
        "referral": _referral_out(referral, campaign, shop, vendor),
        "already_linked": False,
        "next": "Scan a verified receipt at this shop and the invitation becomes a real referral.",
    }


async def campaigns_for(
    db: AsyncSession,
    viewer: Vendor,
    *,
    region_slug: Optional[str] = None,
    mine_only: bool = False,
    include_paused: bool = False,
) -> list[dict]:
    now = datetime.utcnow()
    statement = (
        select(ReferralCampaign, ReceiptMerchant)
        .join(ReceiptMerchant, ReceiptMerchant.id == ReferralCampaign.receipt_merchant_id)
        .order_by(ReferralCampaign.created_at.desc())
        .limit(50)
    )
    if mine_only:
        statement = statement.where(ReferralCampaign.merchant_vendor_id == viewer.id)
        if not include_paused:
            statement = statement.where(ReferralCampaign.status == "active")
    else:
        statement = statement.where(
            ReferralCampaign.status == "active",
            ReferralCampaign.starts_at <= now,
            (ReferralCampaign.ends_at.is_(None)) | (ReferralCampaign.ends_at > now),
        )
    if region_slug:
        statement = statement.where(ReferralCampaign.region_slug == _region(region_slug))
    rows = (await db.execute(statement)).all()
    if not rows:
        return []
    ids = [campaign.id for campaign, _ in rows]
    stats = await _stats_for(db, ids)
    links = (
        await db.execute(
            select(ReferralLink).where(
                ReferralLink.campaign_id.in_(ids),
                ReferralLink.referrer_vendor_id == viewer.id,
                ReferralLink.active.is_(True),
            )
        )
    ).scalars().all()
    by_campaign = {link.campaign_id: link for link in links}
    return [
        _campaign_out(
            campaign,
            merchant,
            viewer_id=viewer.id,
            stats=stats.get(campaign.id, _empty_stats()),
            link=by_campaign.get(campaign.id),
        )
        for campaign, merchant in rows
    ]


async def public_by_code(db: AsyncSession, code: str) -> dict:
    normalized = (code or "").strip().upper()
    row = (
        await db.execute(
            select(ReferralLink, ReferralCampaign, ReceiptMerchant, Vendor)
            .join(ReferralCampaign, ReferralCampaign.id == ReferralLink.campaign_id)
            .join(ReceiptMerchant, ReceiptMerchant.id == ReferralCampaign.receipt_merchant_id)
            .join(Vendor, Vendor.id == ReferralLink.referrer_vendor_id)
            .where(ReferralLink.code == normalized)
        )
    ).first()
    if row is None:
        raise ReferralError("That invite was not found.", status=404)
    link, campaign, merchant, referrer = row
    now = datetime.utcnow()
    if (
        not link.active
        or campaign.status != "active"
        or campaign.starts_at > now
        or (campaign.ends_at is not None and campaign.ends_at <= now)
    ):
        raise ReferralError("That invite is not active.", status=404)
    stats = (await _stats_for(db, [campaign.id])).get(campaign.id, _empty_stats())
    return {
        "code": link.code,
        "campaign": {
            "id": str(campaign.id),
            "title": campaign.title,
            "description": campaign.description,
            "region_slug": campaign.region_slug,
            "reward_points": int(campaign.reward_points or 0),
            "reward_kes": int(campaign.reward_kes or 0),
            "remaining_referrals": max(0, int(campaign.max_referrals) - stats["used"]),
        },
        "merchant": {"name": merchant.name, "region": merchant.region},
        "referrer": {"name": referrer.business_name, "handle": referrer.vendor_handle},
        "verification": (
            "This becomes a verified referral only after you submit a receipt from this "
            "shop that the receipt engine accepts. A screenshot or a promise is not a transaction."
        ),
    }


async def _link_stats(db: AsyncSession, link_id: uuid.UUID) -> dict:
    rows = (
        await db.execute(
            select(Referral.status, func.count(Referral.id))
            .where(Referral.link_id == link_id)
            .group_by(Referral.status)
        )
    ).all()
    counts = {status: int(count) for status, count in rows}
    return {
        "pending": counts.get("pending", 0),
        "qualified": counts.get("qualified", 0),
        "rejected": counts.get("rejected", 0),
    }


async def overview(db: AsyncSession, vendor: Vendor) -> dict:
    campaigns = await campaigns_for(db, vendor, mine_only=True, include_paused=True)

    link_rows = (
        await db.execute(
            select(ReferralLink, ReferralCampaign, ReceiptMerchant)
            .join(ReferralCampaign, ReferralCampaign.id == ReferralLink.campaign_id)
            .join(ReceiptMerchant, ReceiptMerchant.id == ReferralCampaign.receipt_merchant_id)
            .where(
                ReferralLink.referrer_vendor_id == vendor.id,
                ReferralLink.active.is_(True),
            )
            .order_by(ReferralLink.created_at.desc())
        )
    ).all()
    links = []
    for link, campaign, merchant in link_rows:
        links.append({
            "code": link.code,
            "path": f"/r/{link.code}",
            "campaign_id": str(campaign.id),
            "campaign_title": campaign.title,
            "merchant_name": merchant.name,
            "campaign_status": campaign.status,
            "reward_points": int(campaign.reward_points or 0),
            "reward_kes": int(campaign.reward_kes or 0),
            "counts": await _link_stats(db, link.id),
            "created_at": _iso(link.created_at),
        })

    referral_rows = (
        await db.execute(
            select(Referral, ReferralCampaign, ReceiptMerchant, Vendor)
            .join(ReferralCampaign, ReferralCampaign.id == Referral.campaign_id)
            .join(ReceiptMerchant, ReceiptMerchant.id == ReferralCampaign.receipt_merchant_id)
            .join(Vendor, Vendor.id == Referral.referred_vendor_id)
            .where(Referral.referrer_vendor_id == vendor.id)
            .order_by(Referral.created_at.desc())
            .limit(100)
        )
    ).all()
    referrals = [
        _referral_out(referral, campaign, merchant, referred, referrer=vendor)
        for referral, campaign, merchant, referred in referral_rows
    ]

    # The merchant's side of the same table: who came in, what is owed, and
    # whether the shop says it has paid them directly. No platform balance.
    referrer_alias = aliased(Vendor)
    owner_rows = (
        await db.execute(
            select(Referral, ReferralCampaign, ReceiptMerchant, referrer_alias, Vendor)
            .join(ReferralCampaign, ReferralCampaign.id == Referral.campaign_id)
            .join(ReceiptMerchant, ReceiptMerchant.id == ReferralCampaign.receipt_merchant_id)
            .join(referrer_alias, referrer_alias.id == Referral.referrer_vendor_id)
            .join(Vendor, Vendor.id == Referral.referred_vendor_id)
            .where(ReferralCampaign.merchant_vendor_id == vendor.id)
            .order_by(Referral.created_at.desc())
            .limit(100)
        )
    ).all()
    received = [
        _referral_out(referral, campaign, merchant, referred, referrer=referrer)
        for referral, campaign, merchant, referrer, referred in owner_rows
    ]

    summary = (
        await db.execute(
            select(
                func.count(Referral.id).filter(Referral.status == "pending"),
                func.count(Referral.id).filter(Referral.status == "qualified"),
                func.count(Referral.id).filter(Referral.status == "rejected"),
                func.coalesce(
                    func.sum(Referral.reward_points).filter(Referral.status == "qualified"), 0,
                ),
                func.coalesce(
                    func.sum(Referral.bounty_kes).filter(
                        and_(Referral.status == "qualified", Referral.bounty_status == "due")
                    ), 0,
                ),
                func.coalesce(
                    func.sum(Referral.bounty_kes).filter(Referral.bounty_status == "paid"), 0,
                ),
            ).where(Referral.referrer_vendor_id == vendor.id)
        )
    ).one()

    return {
        "summary": {
            "pending": int(summary[0] or 0),
            "qualified": int(summary[1] or 0),
            "rejected": int(summary[2] or 0),
            "points_earned": int(summary[3] or 0),
            "bounty_due_kes": int(summary[4] or 0),
            "bounty_paid_kes": int(summary[5] or 0),
        },
        "links": links,
        "referrals": referrals,
        "received": received,
        "campaigns": campaigns,
        "rules": [
            "A code is not a customer. A referral stays pending until a verified receipt arrives.",
            "Only a new customer counts. Someone who already shopped at the shop before the invite is rejected.",
            "Points are a reward, not money. A cash bounty is paid by the merchant directly; the platform never holds it.",
        ],
    }


async def mark_paid(
    db: AsyncSession, vendor: Vendor, referral_id: uuid.UUID, note: Optional[str] = None,
) -> dict:
    row = (
        await db.execute(
            select(Referral, ReferralCampaign, ReceiptMerchant, Vendor)
            .join(ReferralCampaign, ReferralCampaign.id == Referral.campaign_id)
            .join(ReceiptMerchant, ReceiptMerchant.id == ReferralCampaign.receipt_merchant_id)
            .join(Vendor, Vendor.id == Referral.referred_vendor_id)
            .where(Referral.id == referral_id)
        )
    ).first()
    if row is None:
        raise ReferralError("That referral was not found.", status=404)
    referral, campaign, merchant, referred = row
    if campaign.merchant_vendor_id != vendor.id:
        raise ReferralError("Only the shop that funds this campaign can mark a bounty paid.", status=403)
    if referral.status != "qualified":
        raise ReferralError("A pending referral has no bounty to pay yet.", status=409)
    if int(referral.bounty_kes or 0) <= 0:
        raise ReferralError("This referral has no cash bounty.", status=409)
    if referral.bounty_status == "paid":
        return _referral_out(referral, campaign, merchant, referred)
    referral.bounty_status = "paid"
    referral.bounty_marked_at = datetime.utcnow()
    referral.bounty_note = (note or "").strip()[:255] or None
    referral.updated_at = datetime.utcnow()
    await create_notification(
        db,
        referral.referrer_vendor_id,
        NotificationType.SYSTEM,
        "A referral bounty was marked paid",
        f"{merchant.name} recorded a direct payment. The platform did not move this money.",
        sender_id=campaign.merchant_vendor_id,
        data={"referral_id": str(referral.id), "campaign_id": str(campaign.id)},
    )
    await db.commit()
    await db.refresh(referral)
    return _referral_out(referral, campaign, merchant, referred)


async def qualify_verified_receipt(
    db: AsyncSession, *, receipt: Receipt, buyer: Vendor,
) -> Optional[dict]:
    """The only place a referral becomes `qualified`.

    Called by the receipt route *after* a receipt has been accepted. If the
    receipt is not verified, or the shop does not match, or the person had
    already shopped there before the invite, nothing is awarded.
    """
    if receipt.status != "verified" or receipt.merchant_id is None:
        return None
    candidate_ids = (
        await db.execute(
            select(Referral.id)
            .join(ReferralCampaign, ReferralCampaign.id == Referral.campaign_id)
            .where(
                Referral.referred_vendor_id == buyer.id,
                Referral.status == "pending",
                Referral.created_at <= receipt.scanned_at,
                ReferralCampaign.receipt_merchant_id == receipt.merchant_id,
                ReferralCampaign.status.in_(("active", "paused")),
            )
            .order_by(Referral.created_at.asc())
            .limit(5)
        )
    ).scalars().all()
    if not candidate_ids:
        return None

    referral = (
        await db.execute(
            select(Referral)
            .where(Referral.id.in_(candidate_ids))
            .order_by(Referral.created_at.asc())
            .with_for_update(skip_locked=True)
        )
    ).scalars().first()
    if referral is None:
        return None

    campaign = (
        await db.execute(
            select(ReferralCampaign)
            .where(ReferralCampaign.id == referral.campaign_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if (
        campaign is None
        or campaign.receipt_merchant_id != receipt.merchant_id
        or campaign.status not in ("active", "paused")
    ):
        return None
    if buyer.id in (campaign.merchant_vendor_id, referral.referrer_vendor_id):
        return None

    merchant = await _merchant_or_500(db, campaign.receipt_merchant_id)
    now = datetime.utcnow()

    prior = (
        await db.execute(
            select(func.count(Receipt.id)).where(
                Receipt.vendor_id == buyer.id,
                Receipt.merchant_id == receipt.merchant_id,
                Receipt.id != receipt.id,
                Receipt.scanned_at < referral.created_at,
                Receipt.status.in_(("verified", "partial")),
            )
        )
    ).scalar_one()
    if int(prior or 0) > 0:
        referral.status = "rejected"
        referral.rejected_reason = "Already a customer at this shop before the invitation."
        referral.receipt_id = receipt.id
        referral.receipt_merchant_id = receipt.merchant_id
        referral.receipt_total = receipt.total
        referral.qualified_at = None
        referral.updated_at = now
        await create_notification(
            db,
            referral.referrer_vendor_id,
            NotificationType.SYSTEM,
            "A referral did not qualify",
            "The person had already shopped at this shop before the invitation. No reward was released.",
            sender_id=campaign.merchant_vendor_id,
            data={"referral_id": str(referral.id), "campaign_id": str(campaign.id)},
        )
        return _referral_out(referral, campaign, merchant, buyer)

    points = int(campaign.reward_points or 0)
    bounty = int(campaign.reward_kes or 0)
    if points > 0:
        db.add(PointsEntry(
            vendor_id=referral.referrer_vendor_id,
            country_code=campaign.country_code or "KE",
            entry_type="earn",
            points=points,
            reason_key="referral_verified",
            reference_type="referral",
            reference_id=referral.id,
        ))
    referral.status = "qualified"
    referral.qualified_at = now
    referral.receipt_id = receipt.id
    referral.receipt_merchant_id = receipt.merchant_id
    referral.receipt_total = receipt.total
    referral.reward_points = points
    referral.bounty_kes = bounty
    referral.bounty_status = "due" if bounty > 0 else "not_due"
    referral.updated_at = now
    await db.flush()
    await create_notification(
        db,
        referral.referrer_vendor_id,
        NotificationType.SYSTEM,
        "A referral was verified",
        (
            f"{merchant.name} accepted a verified receipt."
            + (f" {points} points were added." if points else "")
            + (f" {_price_label(bounty)} is due directly from the shop." if bounty else "")
        ),
        sender_id=campaign.merchant_vendor_id,
        data={"referral_id": str(referral.id), "campaign_id": str(campaign.id)},
    )
    return _referral_out(referral, campaign, merchant, buyer)

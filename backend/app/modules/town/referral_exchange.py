"""The referral index: searchable introductions with evidence-based rewards.

This is deliberately separate from the shop-referral engine in
`app.modules.referrals`. That engine rewards a customer for bringing someone to
a claimed shop. This index covers external providers — ride-hailing, coaches,
betting platforms and local businesses — where the platform cannot see the
provider's database.

So the rule is stricter, not looser:

  · a click is a signal, never a conversion;
  · a screenshot is evidence to review, never verification;
  · a bounty is paid to the referrer only after a reviewer confirms the action;
  · a listing that says `unverified` is shown as unverified, not hidden.

Sponsored placements are capped, clearly labelled, and ranked separately from
organic results. The label and the bid are part of the API response.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.town import config as town_config
from app.modules.town import trust as trust_service
from app.modules.town.audit import audit
from app.modules.town.errors import CommerceError
from app.modules.town.models import (
    DisputeCase, PlatformFeeEntry, ReferralBounty, ReferralClick,
    ReferralConversion, ReferralListing, ReferralShareLink,
)
from app.services.notification_service import create_notification

CATEGORIES = ("ride_hailing", "transport", "betting", "retail", "services", "other")
MAX_SPONSORED_RESULTS = 3
MAX_SPONSOR_DAYS = 30
MIN_SPONSOR_KES = 100
SHARE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _now() -> datetime:
    return datetime.utcnow()


def listing_out(
    listing: ReferralListing, *,
    sponsored: bool = False,
    share: ReferralShareLink | None = None,
    viewer_level: int | None = None,
    stats: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": str(listing.id),
        "provider": listing.provider,
        "category": listing.category,
        "title": listing.title,
        "description": listing.description,
        "referral_code": listing.referral_code,
        "referral_url": listing.referral_url,
        "offer_terms": listing.offer_terms,
        "region_slug": listing.region_slug,
        "country_code": listing.country_code,
        "bounty_kes": int(listing.bounty_kes or 0),
        "bounty_points": int(listing.bounty_points or 0),
        "budget_kes": int(listing.budget_kes or 0),
        "verification_method": listing.verification_method,
        "verification_status": listing.verification_status,
        "verification_note": listing.verification_note,
        "trust_level_required": int(listing.trust_level_required or 1),
        "status": listing.status,
        "sponsored": bool(sponsored),
        "sponsored_label": "Sponsored" if sponsored else None,
        "sponsored_until": listing.sponsored_until.isoformat() if listing.sponsored_until else None,
        "share_code": share.code if share is not None else None,
        "share_path": f"/referral-index/go/{share.code}" if share is not None else None,
        "eligible": (viewer_level is None or int(viewer_level) >= int(listing.trust_level_required or 1)),
        "expires_at": listing.expires_at.isoformat() if listing.expires_at else None,
        "created_at": listing.created_at.isoformat() if listing.created_at else None,
        "stats": stats or {},
    }


def _active_clause(now: datetime):
    return (
        ReferralListing.status == "active",
        or_(ReferralListing.expires_at.is_(None), ReferralListing.expires_at > now),
        ReferralListing.verification_status != "rejected",
    )


async def search(
    db: AsyncSession,
    *,
    query: str | None = None,
    category: str | None = None,
    region: str | None = None,
    provider: str | None = None,
    limit: int = 30,
    viewer: Vendor | None = None,
) -> dict[str, Any]:
    now = _now()
    limit = max(1, min(60, int(limit or 30)))
    statement = select(ReferralListing).where(*_active_clause(now))
    betting_enabled = bool(settings.TOWN_BETTING_CATEGORY_ENABLED)
    if not betting_enabled:
        statement = statement.where(ReferralListing.category != "betting")
    if query:
        needle = f"%{query.strip()[:80]}%"
        statement = statement.where(or_(
            ReferralListing.title.ilike(needle),
            ReferralListing.provider.ilike(needle),
            ReferralListing.description.ilike(needle),
            ReferralListing.offer_terms.ilike(needle),
        ))
    if category and category in CATEGORIES:
        statement = statement.where(ReferralListing.category == category)
    if region:
        statement = statement.where(ReferralListing.region_slug == region)
    if provider:
        statement = statement.where(ReferralListing.provider.ilike(f"%{provider.strip()[:60]}%"))

    rows = [] if (category == "betting" and not betting_enabled) else list((await db.execute(
        statement.order_by(ReferralListing.created_at.desc()).limit(200)
    )).scalars().all())

    viewer_level = int((await trust_service.current(db, viewer.id))["level"]) if viewer else None
    sponsored = [
        row for row in rows
        if int(row.sponsored_bid_kes or 0) > 0
        and row.sponsored_until is not None
        and row.sponsored_until > now
    ]
    sponsored.sort(key=lambda row: (int(row.sponsored_bid_kes or 0), row.sponsored_until), reverse=True)
    sponsored = sponsored[:MAX_SPONSORED_RESULTS]
    sponsored_ids = {row.id for row in sponsored}
    organic = [row for row in rows if row.id not in sponsored_ids]
    organic.sort(key=lambda row: (
        0 if row.verification_status == "verified" else 1,
        0 if row.verification_status == "pending" else 1,
        -int(row.bounty_kes or 0),
        -row.created_at.timestamp(),
    ))
    organic = organic[:limit]
    sponsored = sponsored[:limit]

    # Per-listing counts in one round trip, not N+1.
    ids = [row.id for row in sponsored + organic]
    counts: dict[uuid.UUID, dict[str, int]] = {}
    if ids:
        clicks = (await db.execute(
            select(ReferralClick.listing_id, func.count(ReferralClick.id))
            .where(ReferralClick.listing_id.in_(ids))
            .group_by(ReferralClick.listing_id)
        )).all()
        conversions = (await db.execute(
            select(ReferralConversion.listing_id, func.count(ReferralConversion.id))
            .where(ReferralConversion.listing_id.in_(ids))
            .group_by(ReferralConversion.listing_id)
        )).all()
        verified = (await db.execute(
            select(ReferralConversion.listing_id, func.count(ReferralConversion.id))
            .where(
                ReferralConversion.listing_id.in_(ids),
                ReferralConversion.status == "verified",
            )
            .group_by(ReferralConversion.listing_id)
        )).all()
        for row_id, count in clicks:
            counts.setdefault(row_id, {"clicks": 0, "conversions": 0, "verified": 0})["clicks"] = int(count)
        for row_id, count in conversions:
            counts.setdefault(row_id, {"clicks": 0, "conversions": 0, "verified": 0})["conversions"] = int(count)
        for row_id, count in verified:
            counts.setdefault(row_id, {"clicks": 0, "conversions": 0, "verified": 0})["verified"] = int(count)

    return {
        "sponsored": [listing_out(row, sponsored=True, viewer_level=viewer_level,
                                  stats=counts.get(row.id)) for row in sponsored],
        "results": [listing_out(row, viewer_level=viewer_level,
                                stats=counts.get(row.id)) for row in organic],
        "ranking": {
            "sponsored_slots": MAX_SPONSORED_RESULTS,
            "sponsored_label": "Sponsored",
            "organic_order": "verified first, then highest bounty, then newest",
            "disclosure": (
                "Sponsored results are paid placements, capped at three and always labelled. "
                "They never change whether a listing is verified."
            ),
        },
        "viewer_trust_level": viewer_level,
        "categories": [
            item for item in CATEGORIES
            if item != "betting" or betting_enabled
        ],
    }


async def my_listings(db: AsyncSession, vendor: Vendor) -> list[dict[str, Any]]:
    rows = list((await db.execute(
        select(ReferralListing)
        .where(ReferralListing.owner_vendor_id == vendor.id)
        .order_by(ReferralListing.created_at.desc())
    )).scalars().all())
    return [listing_out(row) for row in rows]


async def create_listing(db: AsyncSession, vendor: Vendor, data: dict[str, Any]) -> ReferralListing:
    provider = " ".join(str(data.get("provider") or "").split())
    title = " ".join(str(data.get("title") or "").split())
    category = (data.get("category") or "other").strip().lower()
    if len(provider) < 2:
        raise CommerceError("Name the provider (for example Uber or Ena Coach).", 422)
    if len(title) < 5:
        raise CommerceError("Give the listing a title of at least five characters.", 422)
    if category not in CATEGORIES:
        raise CommerceError("Choose a category from the list.", 422)
    if category == "betting" and not settings.TOWN_BETTING_CATEGORY_ENABLED:
        raise CommerceError(
            "Betting listings are off while the age-gate and advertising policy is reviewed.",
            422,
        )
    code = " ".join(str(data.get("referral_code") or "").split())[:80] or None
    url = " ".join(str(data.get("referral_url") or "").split())[:1000] or None
    if not code and not url:
        raise CommerceError("Add the referral code or link people will use.", 422)
    if url and not url.lower().startswith(("http://", "https://")):
        raise CommerceError("A referral link must start with http:// or https://.", 422)
    bounty = int(data.get("bounty_kes") or 0)
    budget = int(data.get("budget_kes") or 0)
    if bounty < 0 or budget < 0:
        raise CommerceError("Bounties cannot be negative.", 422)
    if budget and bounty > budget:
        raise CommerceError("A single bounty cannot exceed the campaign budget.", 422)

    expires_at = data.get("expires_at")
    if expires_at is not None and getattr(expires_at, "tzinfo", None) is not None:
        expires_at = expires_at.astimezone(timezone.utc).replace(tzinfo=None)
    listing = ReferralListing(
        id=uuid.uuid4(),
        owner_vendor_id=vendor.id,
        provider=provider[:80],
        category=category,
        title=title[:160],
        description=(data.get("description") or "")[:4000] or None,
        referral_code=code,
        referral_url=url,
        offer_terms=(data.get("offer_terms") or "")[:4000] or None,
        region_slug=(data.get("region_slug") or "nyanza")[:60],
        country_code=(data.get("country_code") or "KE")[:2].upper(),
        bounty_kes=bounty,
        bounty_points=max(0, int(data.get("bounty_points") or 0)),
        budget_kes=budget,
        verification_method=(data.get("verification_method") or "manual")[:20],
        verification_status="unverified",
        trust_level_required=max(1, min(5, int(data.get("trust_level_required") or 1))),
        status="active",
        expires_at=expires_at,
    )
    db.add(listing)
    audit(
        db, action="referral_listing_created", entity_type="referral_listing",
        entity_id=listing.id, actor_vendor_id=vendor.id,
        payload={"provider": provider, "category": category, "bounty_kes": bounty},
    )
    await db.flush()
    return listing


async def update_listing(
    db: AsyncSession, vendor: Vendor, listing: ReferralListing, data: dict[str, Any],
) -> ReferralListing:
    if listing.owner_vendor_id != vendor.id:
        raise CommerceError("Only the listing owner can edit it.", 403)
    if "status" in data and data["status"] in ("active", "paused", "expired"):
        listing.status = data["status"]
    for field in ("title", "description", "offer_terms", "referral_code", "referral_url"):
        if field in data and data[field] is not None:
            value = str(data[field]).strip()
            setattr(listing, field, value[:4000] or None)
    if data.get("bounty_kes") is not None:
        listing.bounty_kes = max(0, int(data["bounty_kes"]))
    if data.get("budget_kes") is not None:
        listing.budget_kes = max(0, int(data["budget_kes"]))
    if listing.budget_kes and listing.bounty_kes and listing.bounty_kes > listing.budget_kes:
        raise CommerceError("A single bounty cannot exceed the campaign budget.", 422)
    if listing.referral_url and not listing.referral_url.lower().startswith(("http://", "https://")):
        raise CommerceError("A referral link must start with http:// or https://.", 422)
    if not listing.referral_code and not listing.referral_url:
        raise CommerceError("Keep the referral code or link people will use.", 422)
    listing.updated_at = _now()
    audit(
        db, action="referral_listing_updated", entity_type="referral_listing",
        entity_id=listing.id, actor_vendor_id=vendor.id, payload={"fields": ",".join(data.keys())},
    )
    await db.flush()
    return listing


def _share_code() -> str:
    return "X" + "".join(secrets.choice(SHARE_ALPHABET) for _ in range(7))


async def share_link(db: AsyncSession, vendor: Vendor, listing: ReferralListing) -> ReferralShareLink:
    if listing.status != "active":
        raise CommerceError("That listing is not active.", 409)
    if listing.verification_status == "rejected":
        raise CommerceError("That listing was rejected.", 409)
    if listing.expires_at and listing.expires_at <= _now():
        raise CommerceError("That listing has expired.", 409)
    if listing.owner_vendor_id == vendor.id:
        raise CommerceError("The listing owner cannot earn a bounty on their own listing.", 403)
    existing = (
        await db.execute(
            select(ReferralShareLink).where(
                ReferralShareLink.listing_id == listing.id,
                ReferralShareLink.referrer_vendor_id == vendor.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.active = True
        return existing
    for _ in range(8):
        code = _share_code()
        taken = (await db.execute(
            select(ReferralShareLink.id).where(ReferralShareLink.code == code)
        )).scalar_one_or_none()
        if taken is None:
            break
    else:  # pragma: no cover
        raise CommerceError("Could not allocate a share code. Try again.", 503)
    link = ReferralShareLink(
        listing_id=listing.id, referrer_vendor_id=vendor.id, code=code, active=True,
    )
    db.add(link)
    await db.flush()
    return link


async def public_visit(
    db: AsyncSession, code: str, *, viewer: Vendor | None = None,
) -> dict[str, Any]:
    share = (
        await db.execute(
            select(ReferralShareLink).where(
                ReferralShareLink.code == code.upper(), ReferralShareLink.active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if share is None:
        raise CommerceError("That referral link is not active.", 404)
    listing = (
        await db.execute(select(ReferralListing).where(ReferralListing.id == share.listing_id))
    ).scalar_one_or_none()
    if (
        listing is None
        or listing.status != "active"
        or listing.verification_status == "rejected"
        or (listing.expires_at and listing.expires_at <= _now())
    ):
        raise CommerceError("That referral listing is no longer available.", 404)
    token = secrets.token_urlsafe(18)[:40]
    click = ReferralClick(
        listing_id=listing.id, share_link_id=share.id,
        viewer_vendor_id=viewer.id if viewer else None,
        token=token, source="link",
    )
    db.add(click)
    audit(
        db, action="referral_click", entity_type="referral_listing", entity_id=listing.id,
        actor_vendor_id=viewer.id if viewer else None,
        payload={"share_code": share.code, "click_token": token},
    )
    await db.flush()
    viewer_level = int((await trust_service.current(db, viewer.id))["level"]) if viewer else None
    return {
        "listing": listing_out(listing, share=share, viewer_level=viewer_level),
        "click_token": token,
        "referrer_vendor_id": str(share.referrer_vendor_id),
        "disclosure": "The referrer may receive a bounty if your action is independently verified.",
    }


async def claim(
    db: AsyncSession,
    *,
    vendor: Vendor,
    listing: ReferralListing,
    proof_type: str,
    proof_reference: str | None,
    proof_payload: dict[str, Any] | None,
    share_code: str | None = None,
    click_token: str | None = None,
    code_used: str | None = None,
) -> ReferralConversion:
    now = _now()
    if listing.status != "active" or (listing.expires_at and listing.expires_at <= now):
        raise CommerceError("That listing is not accepting referrals.", 409)
    if listing.verification_status == "rejected":
        raise CommerceError("That listing is not accepting referrals.", 409)
    if listing.owner_vendor_id == vendor.id:
        raise CommerceError("You cannot refer yourself to your own listing.", 403)
    if not vendor.phone_verified_at:
        raise CommerceError("Verify your phone number before claiming a referral reward.", 403)
    level = int((await trust_service.current(db, vendor.id))["level"])
    if level < int(listing.trust_level_required or 1):
        raise CommerceError(
            f"This listing needs trust Level {listing.trust_level_required}. "
            f"Yours is Level {level}.", 403,
        )

    if listing.referral_code and code_used and code_used.strip().upper() != listing.referral_code.strip().upper():
        audit(
            db, action="referral_invalid_code", entity_type="referral_listing",
            entity_id=listing.id, actor_vendor_id=vendor.id,
            payload={"submitted_code": code_used[:40]},
        )
        raise CommerceError("That code does not match this listing. Check the code with the provider.", 422)

    existing = (
        await db.execute(
            select(ReferralConversion).where(
                ReferralConversion.listing_id == listing.id,
                ReferralConversion.actor_vendor_id == vendor.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise CommerceError("You already submitted this referral. One conversion per person per listing.", 409)

    proof_type = (proof_type or "transaction_ref").strip().lower()
    if proof_type not in ("transaction_ref", "screenshot", "provider_api", "merchant_confirmation"):
        raise CommerceError("Choose a proof type the listing accepts.", 422)
    reference = " ".join((proof_reference or "").split())[:200] or None
    payload = dict(proof_payload or {})
    if proof_type == "transaction_ref" and (not reference or len(reference) < 4):
        raise CommerceError("Enter the provider's transaction or account reference.", 422)
    if proof_type == "screenshot" and not (payload.get("screenshot_url") or payload.get("image_url")):
        raise CommerceError("Upload or link the screenshot you want reviewed.", 422)
    if proof_type == "provider_api" and not reference:
        raise CommerceError("Provider API proof needs a provider reference.", 422)

    share = None
    if share_code:
        share = (
            await db.execute(
                select(ReferralShareLink).where(
                    ReferralShareLink.code == share_code.upper(),
                    ReferralShareLink.listing_id == listing.id,
                    ReferralShareLink.active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if share is None:
            raise CommerceError("That referral link is not active.", 404)
    # A direct claimant earns the bounty themselves; a share link earns for the
    # person who shared it. Either way the funder pays directly, never us.
    referrer_id = share.referrer_vendor_id if share is not None else vendor.id
    if share is not None and referrer_id == vendor.id:
        raise CommerceError("A referrer cannot claim their own link.", 403)
    click = None
    if click_token:
        click = (
            await db.execute(
                select(ReferralClick).where(
                    ReferralClick.token == click_token,
                    ReferralClick.listing_id == listing.id,
                )
            )
        ).scalar_one_or_none()

    conversion = ReferralConversion(
        id=uuid.uuid4(),
        listing_id=listing.id,
        share_link_id=share.id if share else None,
        click_id=click.id if click else None,
        actor_vendor_id=vendor.id,
        referrer_vendor_id=referrer_id,
        proof_type=proof_type,
        proof_reference=reference,
        proof_payload=payload,
        status="pending",
        bounty_kes=int(listing.bounty_kes or 0),
        bounty_status="not_due",
        reward_points=0,
    )
    db.add(conversion)
    audit(
        db, action="referral_conversion_claimed", entity_type="referral_conversion",
        entity_id=conversion.id, actor_vendor_id=vendor.id,
        payload={"listing_id": listing.id, "proof_type": proof_type, "reference": reference or ""},
    )
    await db.flush()
    return conversion


async def verify(
    db: AsyncSession,
    *,
    conversion: ReferralConversion,
    reviewer: Vendor,
    approve: bool,
    note: str | None = None,
) -> ReferralConversion:
    now = _now()
    listing = (
        await db.execute(
            select(ReferralListing)
            .where(ReferralListing.id == conversion.listing_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if listing is None:
        raise CommerceError("The listing for that referral no longer exists.", 404)
    is_owner = listing.owner_vendor_id == reviewer.id
    is_operator = settings.is_operator(reviewer.vendor_handle)
    if not (is_owner or is_operator):
        raise CommerceError("Only the listing owner or an operator can review this referral.", 403)
    if conversion.status == "verified":
        return conversion
    if conversion.status not in ("pending", "disputed"):
        raise CommerceError("That conversion is already closed.", 409)

    # Approval is the independent step. The listing owner has an incentive to
    # approve a friend's screenshot; an operator does not. Owners may reject.
    if approve and not is_operator:
        raise CommerceError(
            "An operator must independently verify a conversion before a bounty is due.",
            403,
        )

    if approve:
        # A screenshot alone is exactly the artefact that is easy to fabricate.
        # It can be *part* of the evidence, but it cannot be the only evidence
        # unless an operator is the one reviewing it.
        if conversion.proof_type == "screenshot" and not is_operator:
            raise CommerceError(
                "A screenshot alone is not verification. Add a transaction reference or ask an operator to review it.",
                422,
            )
        if conversion.proof_type == "transaction_ref" and len((conversion.proof_reference or "")) < 4:
            raise CommerceError("The transaction reference is too short to verify.", 422)

        budget = int(listing.budget_kes or 0)
        bounty = int(conversion.bounty_kes or 0)
        if bounty > 0 and budget > 0:
            committed = int((await db.execute(
                select(func.coalesce(func.sum(ReferralConversion.bounty_kes), 0)).where(
                    ReferralConversion.listing_id == listing.id,
                    ReferralConversion.status == "verified",
                )
            )).scalar() or 0)
            if committed + bounty > budget:
                raise CommerceError("The listing's bounty budget is exhausted.", 409)

        conversion.status = "verified"
        conversion.reviewer_vendor_id = reviewer.id
        conversion.review_note = (note or "Proof reviewed.")[:500]
        conversion.verified_at = now
        conversion.reward_points = max(0, int(listing.bounty_points or 0))
        conversion.bounty_status = "due" if bounty > 0 else "not_due"
        if bounty > 0:
            bounty_row = (
                await db.execute(
                    select(ReferralBounty).where(ReferralBounty.listing_id == listing.id)
                )
            ).scalar_one_or_none()
            if bounty_row is None:
                bounty_row = ReferralBounty(
                    id=uuid.uuid4(),
                    listing_id=listing.id, funder_vendor_id=listing.owner_vendor_id,
                    amount_kes=budget or bounty, committed_kes=0, paid_kes=0,
                    status="active", funded_at=now,
                )
                db.add(bounty_row)
            bounty_row.committed_kes = int(bounty_row.committed_kes or 0) + bounty
            bounty_row.status = "exhausted" if bounty_row.amount_kes and bounty_row.committed_kes >= bounty_row.amount_kes else "active"
            bounty_row.updated_at = now

            quote = await town_config.quote(db, town_config.LEAD_FEE, bounty)
            if quote["fee_kes"] > 0:
                db.add(PlatformFeeEntry(
                    source_type="referral_conversion",
                    source_id=conversion.id,
                    payer_vendor_id=listing.owner_vendor_id,
                    base_amount_kes=bounty,
                    fee_pct=quote["fee_pct"],
                    fee_kes=quote["fee_kes"],
                    status="accrued",
                    idempotency_key=f"referral-lead:{conversion.id}",
                    note=f"Verified lead fee at {quote['fee_pct']:.2f}%.",
                ))
        if conversion.referrer_vendor_id:
            await create_notification(
                db, conversion.referrer_vendor_id, NotificationType.SYSTEM,
                "Referral verified",
                f"“{listing.title}” was independently verified. Any bounty is paid directly by the funder; the platform holds no funds.",
                sender_id=reviewer.id, data={"referral_conversion_id": str(conversion.id)},
            )
        await create_notification(
            db, conversion.actor_vendor_id, NotificationType.SYSTEM,
            "Referral conversion verified",
            f"Your action for “{listing.title}” was verified.",
            sender_id=reviewer.id, data={"referral_conversion_id": str(conversion.id)},
        )
    else:
        conversion.status = "rejected"
        conversion.reviewer_vendor_id = reviewer.id
        conversion.review_note = (note or "The proof did not meet the listing's conditions.")[:500]
        conversion.bounty_status = "not_due"
        await create_notification(
            db, conversion.actor_vendor_id, NotificationType.SYSTEM,
            "Referral could not be verified",
            conversion.review_note,
            sender_id=reviewer.id, data={"referral_conversion_id": str(conversion.id)},
        )

    audit(
        db, action="referral_conversion_verified" if approve else "referral_conversion_rejected",
        entity_type="referral_conversion", entity_id=conversion.id, actor_vendor_id=reviewer.id,
        payload={"listing_id": listing.id, "note": (note or "")[:120]},
    )
    await db.flush()
    return conversion


async def mark_bounty_paid(
    db: AsyncSession, *, conversion: ReferralConversion, owner: Vendor, note: str,
) -> ReferralConversion:
    listing = (
        await db.execute(select(ReferralListing).where(ReferralListing.id == conversion.listing_id))
    ).scalar_one_or_none()
    if listing is None or listing.owner_vendor_id != owner.id:
        raise CommerceError("Only the listing owner can record this payment.", 403)
    if conversion.status != "verified":
        raise CommerceError("A bounty is paid only after the conversion is verified.", 409)
    if conversion.bounty_status == "paid":
        return conversion
    cleaned = " ".join((note or "").split())[:255]
    if len(cleaned) < 3:
        raise CommerceError("Record the M-Pesa reference so the payment is auditable.", 422)
    conversion.bounty_status = "paid"
    conversion.review_note = (conversion.review_note or "")[:300]
    bounty_row = (
        await db.execute(select(ReferralBounty).where(ReferralBounty.listing_id == listing.id))
    ).scalar_one_or_none()
    if bounty_row is not None:
        bounty_row.paid_kes = int(bounty_row.paid_kes or 0) + int(conversion.bounty_kes or 0)
        bounty_row.updated_at = _now()
    audit(
        db, action="referral_bounty_paid", entity_type="referral_conversion",
        entity_id=conversion.id, actor_vendor_id=owner.id,
        payload={"amount_kes": conversion.bounty_kes, "note": cleaned},
    )
    if conversion.referrer_vendor_id:
        await create_notification(
            db, conversion.referrer_vendor_id, NotificationType.SYSTEM,
            "Bounty paid directly",
            f"The funder recorded a direct payment for “{listing.title}”: {cleaned}",
            sender_id=owner.id, data={"referral_conversion_id": str(conversion.id)},
        )
    await db.flush()
    return conversion


async def open_dispute(
    db: AsyncSession, *, conversion: ReferralConversion, vendor: Vendor, reason: str,
) -> DisputeCase:
    if vendor.id not in (conversion.actor_vendor_id, conversion.referrer_vendor_id):
        raise CommerceError("Only the person who referred or was referred can dispute this.", 403)
    text = " ".join((reason or "").split())
    if len(text) < 10:
        raise CommerceError("Say what went wrong — at least 10 characters.", 422)
    listing = (
        await db.execute(select(ReferralListing).where(ReferralListing.id == conversion.listing_id))
    ).scalar_one_or_none()
    if listing is None:
        raise CommerceError("The listing for that referral no longer exists.", 404)
    if conversion.referrer_vendor_id and conversion.referrer_vendor_id != vendor.id:
        against_id = conversion.referrer_vendor_id
    elif listing.owner_vendor_id != vendor.id:
        against_id = listing.owner_vendor_id
    else:
        against_id = conversion.actor_vendor_id if conversion.actor_vendor_id != vendor.id else None
    dispute = DisputeCase(
        id=uuid.uuid4(),
        domain="referral", subject_id=conversion.id, opened_by_vendor_id=vendor.id,
        against_vendor_id=against_id,
        reason=text[:2000], status="open",
    )
    db.add(dispute)
    conversion.status = "disputed"
    await db.flush()
    return dispute


async def sponsor(
    db: AsyncSession, *, listing: ReferralListing, vendor: Vendor,
    bid_kes: int, days: int, payment_reference: str,
) -> ReferralListing:
    if listing.owner_vendor_id != vendor.id:
        raise CommerceError("Only the listing owner can sponsor it.", 403)
    bid = int(bid_kes or 0)
    if bid < MIN_SPONSOR_KES:
        raise CommerceError(f"A sponsored placement starts at KES {MIN_SPONSOR_KES}.", 422)
    max_bid = 5000
    if int(listing.bounty_kes or 0) > 0:
        max_bid = max(MIN_SPONSOR_KES, int(int(listing.bounty_kes) * settings.TOWN_MAX_SPONSOR_OF_BOUNTY_PCT / 100))
    if bid > max_bid:
        raise CommerceError(f"The bid is capped at KES {max_bid:,} for this listing.", 422)
    days = max(1, min(MAX_SPONSOR_DAYS, int(days or 1)))
    reference = " ".join((payment_reference or "").split())
    if len(reference) < 4:
        raise CommerceError("Record the payment reference for the sponsored placement.", 422)
    listing.sponsored_bid_kes = bid
    listing.sponsored_until = _now() + timedelta(days=days)
    listing.updated_at = _now()
    # A sponsored placement is bought, not a percentage of a sale. The winning
    # bid is the platform's revenue; the listing's verification is never for sale.
    if town_config.charging_enabled():
        db.add(PlatformFeeEntry(
            source_type="sponsorship", source_id=listing.id, payer_vendor_id=vendor.id,
            base_amount_kes=bid, fee_pct=100.0, fee_kes=bid,
            status="accrued", idempotency_key=f"sponsor:{listing.id}:{int(_now().timestamp())}",
            note=f"Sponsored placement, {days} days. Reference {reference[:40]}",
        ))
    audit(
        db, action="referral_listing_sponsored", entity_type="referral_listing",
        entity_id=listing.id, actor_vendor_id=vendor.id,
        payload={"bid_kes": bid, "days": days, "reference": reference[:40]},
    )
    await db.flush()
    return listing


async def fund_bounty(
    db: AsyncSession, *, listing: ReferralListing, vendor: Vendor,
    amount_kes: int, payment_reference: str,
) -> ReferralBounty:
    if listing.owner_vendor_id != vendor.id:
        raise CommerceError("Only the listing owner can fund its bounty.", 403)
    amount = int(amount_kes or 0)
    if amount <= 0:
        raise CommerceError("Enter the amount you actually set aside.", 422)
    reference = " ".join((payment_reference or "").split())
    if len(reference) < 4:
        raise CommerceError("Record the payment reference for the bounty funding.", 422)
    row = (
        await db.execute(select(ReferralBounty).where(ReferralBounty.listing_id == listing.id))
    ).scalar_one_or_none()
    if row is None:
        row = ReferralBounty(
            id=uuid.uuid4(),
            listing_id=listing.id, funder_vendor_id=vendor.id,
            amount_kes=amount, committed_kes=0, paid_kes=0, status="active",
            funding_reference=reference[:120], funded_at=_now(),
        )
        db.add(row)
    if row.committed_kes and amount < row.committed_kes:
        raise CommerceError("The funded amount cannot be below bounties already committed.", 409)
    row.amount_kes = amount
    row.funding_reference = reference[:120]
    row.funded_at = _now()
    row.status = "active"
    listing.budget_kes = amount
    audit(
        db, action="referral_bounty_funded", entity_type="referral_bounty",
        entity_id=row.id, actor_vendor_id=vendor.id,
        payload={"amount_kes": amount, "reference": reference[:40]},
    )
    await db.flush()
    return row


async def mine_conversions(db: AsyncSession, vendor: Vendor) -> list[dict[str, Any]]:
    rows = list((await db.execute(
        select(ReferralConversion)
        .where(or_(
            ReferralConversion.actor_vendor_id == vendor.id,
            ReferralConversion.referrer_vendor_id == vendor.id,
        ))
        .order_by(ReferralConversion.created_at.desc())
        .limit(100)
    )).scalars().all())
    return [
        {
            "id": str(row.id),
            "listing_id": str(row.listing_id),
            "status": row.status,
            "proof_type": row.proof_type,
            "proof_reference": row.proof_reference,
            "bounty_kes": int(row.bounty_kes or 0),
            "bounty_status": row.bounty_status,
            "review_note": row.review_note,
            "verified_at": row.verified_at.isoformat() if row.verified_at else None,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


async def listing_stats(db: AsyncSession, listing_id) -> dict[str, Any]:
    clicks = int((await db.execute(
        select(func.count(ReferralClick.id)).where(ReferralClick.listing_id == listing_id)
    )).scalar() or 0)
    total = int((await db.execute(
        select(func.count(ReferralConversion.id)).where(ReferralConversion.listing_id == listing_id)
    )).scalar() or 0)
    verified = int((await db.execute(
        select(func.count(ReferralConversion.id)).where(
            ReferralConversion.listing_id == listing_id,
            ReferralConversion.status == "verified",
        )
    )).scalar() or 0)
    disputed = int((await db.execute(
        select(func.count(ReferralConversion.id)).where(
            ReferralConversion.listing_id == listing_id,
            ReferralConversion.status == "disputed",
        )
    )).scalar() or 0)
    return {"clicks": clicks, "conversions": total, "verified": verified, "disputes": disputed}

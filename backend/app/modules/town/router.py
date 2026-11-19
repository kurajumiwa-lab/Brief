"""HTTP surface for receipt rewards, the referral index and scout records.

Mounted at `/api/town`. Public listing search and share-link landing live under
`/api/town/referral-index/public/`, which is GET-only at the middleware. Claiming
a referral, buying credit or rating a scout always requires a signed-in account.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.receipts import Receipt, ReceiptMerchant, ReceiptVoucher
from app.models.vendor import Vendor
from app.modules.intake import ocr
from app.modules.town import credits as credit_service
from app.modules.town import merchant as merchant_service
from app.modules.town import receipts as receipt_service
from app.modules.town import referral_exchange as exchange
from app.modules.town import scout as scout_service
from app.modules.town import trust as trust_service
from app.modules.town.audit import audit
from app.modules.town.errors import CommerceError
from app.modules.town.models import (
    DisputeCase, MerchantCreditPurchase, ReceiptItem, ReceiptRedemption,
    ReferralConversion, ReferralListing, ReferralShareLink,
)
from app.modules.town.schemas import (
    BountyFundIn, BountyPaidIn, CreditPurchaseIn, DisputeIn, OcrTextIn,
    PaymentConfirmationIn, RatingIn, ReasonIn, ReceiptCaptureIn, ReferralClaimIn,
    ReferralListingIn, ReferralListingUpdate, ReferralVerifyIn,
    RewardPolicyIn, SponsorIn, SubscriptionIn,
)
from app.routes.auth import get_current_vendor
from app.services.images import UnsupportedImage, prepare_image
from app.services.storage import StorageError, storage

router = APIRouter()
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def _fail(exc: CommerceError):
    raise HTTPException(exc.status, exc.message)


def receipt_out(receipt: Receipt, items=None) -> dict:
    return {
        "id": str(receipt.id),
        "merchant_id": str(receipt.merchant_id) if receipt.merchant_id else None,
        "merchant_name": receipt.merchant_name,
        "merchant_pin": receipt.merchant_pin,
        "invoice_no": receipt.invoice_no,
        "total_kes": int(receipt.total or 0),
        "tax_kes": int(receipt.tax or 0) or None,
        "status": receipt.status,
        "source": receipt.source,
        "freshness": receipt.freshness_key,
        "base_points": int(receipt.base_points or 0),
        "points": int(receipt.points or 0),
        "funded_kes": int(receipt.reward_funded_kes or 0),
        "items_total_kes": int(receipt.items_total_kes or 0) or None,
        "fraud_flags": receipt.fraud_flags or [],
        "issued_at": receipt.issued_at.isoformat() if receipt.issued_at else None,
        "scanned_at": receipt.scanned_at.isoformat(),
        "photo_url": receipt.photo_url,
        "ocr_engine": receipt.ocr_engine,
        "extraction": receipt.extraction or {},
        "items": [
            {
                "line_no": item.line_no,
                "description": item.description,
                "quantity": float(item.quantity),
                "unit_price_kes": int(item.unit_price_kes),
                "total_price_kes": int(item.total_price_kes),
                "confidence": int(item.confidence),
            }
            for item in (items or [])
        ],
    }


def conversion_out(row: ReferralConversion) -> dict:
    return {
        "id": str(row.id),
        "listing_id": str(row.listing_id),
        "share_link_id": str(row.share_link_id) if row.share_link_id else None,
        "status": row.status,
        "proof_type": row.proof_type,
        "proof_reference": row.proof_reference,
        "bounty_kes": int(row.bounty_kes or 0),
        "bounty_status": row.bounty_status,
        "reward_points": int(row.reward_points or 0),
        "review_note": row.review_note,
        "verified_at": row.verified_at.isoformat() if row.verified_at else None,
        "created_at": row.created_at.isoformat(),
        "note": (
            "A conversion is pending until an operator verifies the qualifying action. "
            "The platform never holds the bounty."
        ),
    }


def purchase_out(row: MerchantCreditPurchase) -> dict:
    return {
        "id": str(row.id),
        "merchant_id": str(row.merchant_id),
        "amount_kes": int(row.amount_kes),
        "payment_reference": row.payment_reference,
        "payment_method": row.payment_method,
        "status": row.status,
        "note": row.note,
        "confirmed_at": row.confirmed_at.isoformat() if row.confirmed_at else None,
        "created_at": row.created_at.isoformat(),
    }


async def _listing(db: AsyncSession, listing_id) -> ReferralListing:
    row = (
        await db.execute(select(ReferralListing).where(ReferralListing.id == listing_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "That referral listing was not found.")
    return row


async def _conversion(db: AsyncSession, conversion_id) -> ReferralConversion:
    row = (
        await db.execute(
            select(ReferralConversion).where(ReferralConversion.id == conversion_id).with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "That referral conversion was not found.")
    return row


async def _merchant(db: AsyncSession, merchant_id, vendor: Vendor) -> ReceiptMerchant:
    try:
        return await merchant_service.owned_merchant(db, vendor, merchant_id)
    except CommerceError as exc:
        _fail(exc)


# ── receipt capture and OCR ──────────────────────────────────────────────────

@router.post("/receipts/capture", status_code=201)
async def capture_receipt(
    body: ReceiptCaptureIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await receipt_service.capture(
            db, vendor=vendor,
            payload=body.payload,
            source=body.source,
            merchant_name=body.merchant_name,
            merchant_pin=body.merchant_pin,
            invoice_no=body.invoice_no,
            total_kes=body.total_kes,
            tax_kes=body.tax_kes,
            issued_at=body.issued_at,
            region=body.region,
            photo_url=body.photo_url,
            ocr_engine=body.ocr_engine,
            items=[item.model_dump() for item in body.items],
            consent=body.photo_consent,
            extraction=body.extraction,
        )
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)
    receipt = result["receipt"]
    items = list((await db.execute(
        select(ReceiptItem).where(ReceiptItem.receipt_id == receipt.id).order_by(ReceiptItem.line_no)
    )).scalars().all())
    return {
        "receipt": receipt_out(receipt, items),
        "points_awarded": result["points_awarded"],
        "calculated_points": result["calculated_points"],
        "funded_points": result["funded_points"],
        "unfunded_points": result["unfunded_points"],
        "priority": result["priority"],
        "freshness": result["freshness"],
        "fraud_flags": result["fraud_flags"],
        "referral": result["referral"],
        "note": result["note"],
    }


@router.post("/receipts/ocr")
async def scan_receipt_photo(
    file: UploadFile = File(...),
    consent: bool = Form(False),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Read a receipt photo into a draft. Nothing is written to the ledger."""
    data = await file.read()
    if not data:
        raise HTTPException(422, "The photograph is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Keep the photograph under 8 MB.")
    name = file.filename or "receipt.jpg"
    try:
        image, stored_name, content_type = prepare_image(
            data, name, file.content_type or "image/jpeg",
        )
    except UnsupportedImage as exc:
        raise HTTPException(422, str(exc))

    photo_url = None
    warnings: list[str] = []
    if consent:
        try:
            photo_url = await storage.upload(image, stored_name, content_type)
        except StorageError as exc:
            warnings.append(f"The photograph could not be stored: {exc}")
    elif settings.TOWN_RECEIPT_PHOTO_CONSENT_REQUIRED:
        warnings.append("Consent was not given, so the photograph was read and discarded.")

    lines = ocr.read_lines(image)
    engine = ocr.engine_name() if lines else None
    if not lines:
        return {
            "available": ocr.available(),
            "engine": ocr.engine_name(),
            "draft": None,
            "photo_url": photo_url,
            "warnings": warnings + [
                "No OCR engine is installed on this host. Paste the receipt text or enter the lines by hand."
                if not ocr.available() else
                "The photograph could not be read. Try a flatter, brighter picture."
            ],
        }
    draft = receipt_service.parse_ocr_lines(lines, engine=engine)
    return {
        "available": True,
        "engine": engine or "text",
        "draft": draft,
        "photo_url": photo_url,
        "warnings": warnings + draft.get("warnings", []),
        "disclosure": (
            "OCR can misread a faded line. Check the merchant, total and items before submitting. "
            "The photograph is kept only with consent."
        ),
    }


@router.post("/receipts/ocr/text")
async def scan_receipt_text(
    body: OcrTextIn,
    vendor: Vendor = Depends(get_current_vendor),
):
    """The no-engine path: paste the text printed on the receipt."""
    draft = receipt_service.parse_ocr_lines(body.text.splitlines(), engine="text")
    return {
        "available": True,
        "engine": "text",
        "draft": draft,
        "photo_url": None,
        "warnings": draft.get("warnings", []),
        "disclosure": "Pasted text is evidence to review; it is not a verification of the paper.",
    }


# ── merchant dashboard and credit ───────────────────────────────────────────

@router.get("/merchant/me")
async def my_merchant_dashboard(
    days: int = Query(30, ge=1, le=365),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        merchant = await merchant_service.owned_merchant(db, vendor)
        payload = await merchant_service.dashboard(db, merchant=merchant, viewer=vendor, days=days)
        await db.commit()
        return payload
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.get("/merchant/{merchant_id}/dashboard")
async def merchant_dashboard(
    merchant_id: uuid.UUID,
    days: int = Query(30, ge=1, le=365),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        merchant = await merchant_service.owned_merchant(db, vendor, merchant_id)
        payload = await merchant_service.dashboard(db, merchant=merchant, viewer=vendor, days=days)
        await db.commit()
        return payload
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.patch("/merchant/{merchant_id}/policy")
async def update_reward_policy(
    merchant_id: uuid.UUID,
    body: RewardPolicyIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        merchant = await merchant_service.owned_merchant(db, vendor, merchant_id)
        policy = await merchant_service.set_policy(
            db, merchant=merchant, vendor=vendor,
            points_per_100_kes=body.points_per_100_kes,
            max_points_per_receipt=body.max_points_per_receipt,
            priority_bonus_pct=body.priority_bonus_pct,
        )
        await db.commit()
        await db.refresh(policy)
        return {"policy": merchant_service.policy_out(policy)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.get("/merchant/{merchant_id}/credits")
async def merchant_credits(
    merchant_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        merchant = await merchant_service.owned_merchant(db, vendor, merchant_id)
        summary = await credit_service.summary(db, merchant.id)
        purchases = await credit_service.purchases_for(db, merchant.id)
        subscription = await merchant_service.subscription_payload(db, merchant.id)
        await db.commit()
        return {
            "credits": summary,
            "purchases": [purchase_out(row) for row in purchases],
            "subscription": subscription,
            "payment_note": (
                "Pay the platform through the licensed rail shown in the campaign brief, then "
                "record the reference. An operator confirms it before credit is posted."
            ),
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/merchant/{merchant_id}/credits/purchase", status_code=201)
async def request_credit_purchase(
    merchant_id: uuid.UUID,
    body: CreditPurchaseIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        merchant = await merchant_service.owned_merchant(db, vendor, merchant_id)
        purchase = await credit_service.request_purchase(
            db, merchant=merchant, vendor=vendor, amount_kes=body.amount_kes,
            payment_reference=body.payment_reference,
            idempotency_key=body.idempotency_key, note=body.note,
        )
        await db.commit()
        await db.refresh(purchase)
        return {"purchase": purchase_out(purchase), "credits": await credit_service.summary(db, merchant.id)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/merchant/{merchant_id}/analytics/subscribe", status_code=201)
async def subscribe_analytics(
    merchant_id: uuid.UUID,
    body: SubscriptionIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        merchant = await merchant_service.owned_merchant(db, vendor, merchant_id)
        sub = await merchant_service.request_subscription(
            db, merchant=merchant, vendor=vendor, months=body.months,
            payment_reference=body.payment_reference,
        )
        await db.commit()
        return {
            "subscription": await merchant_service.subscription_payload(db, merchant.id),
            "request_id": str(sub.id),
            "note": "An operator confirms the payment before the premium analytics view unlocks.",
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


# ── referral index (private) ─────────────────────────────────────────────────

@router.get("/referral-index/listings")
async def search_listings(
    q: Optional[str] = Query(None, max_length=80),
    category: Optional[str] = Query(None, max_length=24),
    region: Optional[str] = Query(None, max_length=60),
    provider: Optional[str] = Query(None, max_length=60),
    limit: int = Query(30, ge=1, le=60),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    payload = await exchange.search(
        db, query=q, category=category, region=region, provider=provider,
        limit=limit, viewer=vendor,
    )
    await db.commit()
    return payload


@router.get("/referral-index/mine")
async def my_listings(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    listings = await exchange.my_listings(db, vendor)
    conversions = await exchange.mine_conversions(db, vendor)
    return {"listings": listings, "conversions": conversions}


@router.post("/referral-index/listings", status_code=201)
async def create_listing(
    body: ReferralListingIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        listing = await exchange.create_listing(db, vendor, body.model_dump())
        await db.commit()
        await db.refresh(listing)
        return {
            "listing": exchange.listing_out(listing),
            "note": "The listing starts unverified. An operator reviews the provider and proof method before it can earn a verified badge.",
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.patch("/referral-index/listings/{listing_id}")
async def update_listing(
    listing_id: uuid.UUID,
    body: ReferralListingUpdate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        listing = await _listing(db, listing_id)
        listing = await exchange.update_listing(db, vendor, listing, body.model_dump(exclude_unset=True))
        await db.commit()
        await db.refresh(listing)
        return {"listing": exchange.listing_out(listing)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/referral-index/listings/{listing_id}/share")
async def share_listing(
    listing_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        listing = await _listing(db, listing_id)
        link = await exchange.share_link(db, vendor, listing)
        await db.commit()
        await db.refresh(link)
        return {
            "share": {
                "code": link.code,
                "path": f"/referral-index/go/{link.code}",
                "listing_id": str(listing.id),
                "provider": listing.provider,
                "bounty_kes": int(listing.bounty_kes or 0),
                "note": "Share this link. A bounty is due only after an operator verifies the qualifying action.",
            }
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/referral-index/listings/{listing_id}/claim", status_code=201)
async def claim_listing(
    listing_id: uuid.UUID,
    body: ReferralClaimIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        listing = await _listing(db, listing_id)
        conversion = await exchange.claim(
            db, vendor=vendor, listing=listing, proof_type=body.proof_type,
            proof_reference=body.proof_reference, proof_payload=body.proof_payload,
            share_code=body.share_code, click_token=body.click_token, code_used=body.code_used,
        )
        await db.commit()
        await db.refresh(conversion)
        return {
            "conversion": conversion_out(conversion),
            "listing": exchange.listing_out(listing),
            "next": "An operator reviews the evidence. A bounty is not due until then.",
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.get("/referral-index/conversions/mine")
async def my_conversions(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return {"conversions": await exchange.mine_conversions(db, vendor)}


@router.post("/referral-index/conversions/{conversion_id}/verify")
async def verify_conversion(
    conversion_id: uuid.UUID,
    body: ReferralVerifyIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversion = await _conversion(db, conversion_id)
        conversion = await exchange.verify(
            db, conversion=conversion, reviewer=vendor, approve=body.approve, note=body.note,
        )
        await db.commit()
        await db.refresh(conversion)
        return {"conversion": conversion_out(conversion)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/referral-index/conversions/{conversion_id}/paid")
async def mark_bounty_paid(
    conversion_id: uuid.UUID,
    body: BountyPaidIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversion = await _conversion(db, conversion_id)
        conversion = await exchange.mark_bounty_paid(
            db, conversion=conversion, owner=vendor, note=body.note,
        )
        await db.commit()
        await db.refresh(conversion)
        return {"conversion": conversion_out(conversion)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/referral-index/listings/{listing_id}/sponsor")
async def sponsor_listing(
    listing_id: uuid.UUID,
    body: SponsorIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        listing = await _listing(db, listing_id)
        listing = await exchange.sponsor(
            db, listing=listing, vendor=vendor, bid_kes=body.bid_kes,
            days=body.days, payment_reference=body.payment_reference,
        )
        await db.commit()
        await db.refresh(listing)
        return {
            "listing": exchange.listing_out(listing, sponsored=True),
            "disclosure": "Sponsored placements are capped at three and always labelled. Verification is separate.",
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/referral-index/listings/{listing_id}/bounty")
async def fund_bounty(
    listing_id: uuid.UUID,
    body: BountyFundIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        listing = await _listing(db, listing_id)
        bounty = await exchange.fund_bounty(
            db, listing=listing, vendor=vendor, amount_kes=body.amount_kes,
            payment_reference=body.payment_reference,
        )
        await db.commit()
        return {
            "bounty": {
                "id": str(bounty.id),
                "amount_kes": int(bounty.amount_kes or 0),
                "committed_kes": int(bounty.committed_kes or 0),
                "paid_kes": int(bounty.paid_kes or 0),
                "status": bounty.status,
                "funding_reference": bounty.funding_reference,
                "note": "The funder pays the referrer directly. The platform never holds the bounty.",
            }
        }
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/referral-index/conversions/{conversion_id}/dispute", status_code=201)
async def dispute_conversion(
    conversion_id: uuid.UUID,
    body: ReasonIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversion = await _conversion(db, conversion_id)
        dispute = await exchange.open_dispute(
            db, conversion=conversion, vendor=vendor, reason=body.reason,
        )
        await db.commit()
        return {"dispute": _dispute_out(dispute)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


# ── public referral index (GET only at the middleware) ──────────────────────

@router.get("/referral-index/public/listings")
async def public_search(
    q: Optional[str] = Query(None, max_length=80),
    category: Optional[str] = Query(None, max_length=24),
    region: Optional[str] = Query(None, max_length=60),
    provider: Optional[str] = Query(None, max_length=60),
    limit: int = Query(30, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    payload = await exchange.search(
        db, query=q, category=category, region=region, provider=provider, limit=limit, viewer=None,
    )
    await db.commit()
    return payload


@router.get("/referral-index/public/go/{code}")
async def public_referral_landing(
    code: str,
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = await exchange.public_visit(db, code)
        await db.commit()
        return payload
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


# ── scout records ───────────────────────────────────────────────────────────

@router.get("/scout/board")
async def scout_board(
    region_slug: Optional[str] = Query(None, max_length=64),
    town: Optional[str] = Query(None, max_length=64),
    days: int = Query(7, ge=1, le=30),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await scout_service.board(
            db, vendor, region_slug=region_slug, town=town, days=days,
        )
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.get("/scout/tasks/{task_id}")
async def scout_task_detail(
    task_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = await scout_service.detail(db, vendor, task_id)
        await db.commit()
        return payload
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/scout/tasks/{task_id}/rating", status_code=201)
async def rate_scout(
    task_id: uuid.UUID,
    body: RatingIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        rating = await scout_service.rate(
            db, vendor=vendor, task_id=task_id, rating=body.rating, note=body.note,
        )
        await db.commit()
        await db.refresh(rating)
        return {"rating": scout_service.rating_out(rating)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/scout/tasks/{task_id}/payment-confirmation", status_code=201)
async def confirm_scout_payment(
    task_id: uuid.UUID,
    body: PaymentConfirmationIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await scout_service.confirm_payment(
            db, vendor=vendor, task_id=task_id, amount_kes=body.amount_kes,
            payment_reference=body.payment_reference, note=body.note,
        )
        await db.commit()
        await db.refresh(row)
        return {"payment_confirmation": scout_service.payment_out(row)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/scout/tasks/{task_id}/payment-confirmation/ack")
async def acknowledge_scout_payment(
    task_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await scout_service.acknowledge_payment(db, vendor=vendor, task_id=task_id)
        await db.commit()
        await db.refresh(row)
        return {"payment_confirmation": scout_service.payment_out(row)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.post("/scout/tasks/{task_id}/dispute", status_code=201)
async def dispute_scout_task(
    task_id: uuid.UUID,
    body: ReasonIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        dispute = await scout_service.open_dispute(
            db, vendor=vendor, task_id=task_id, reason=body.reason,
        )
        await db.commit()
        return {"dispute": _dispute_out(dispute)}
    except CommerceError as exc:
        await db.rollback()
        _fail(exc)


@router.get("/scout/profile")
async def scout_profile(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await scout_service.profile(db, vendor)


@router.get("/scout/fees")
async def scout_fees(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return {
        "fees": await scout_service.fee_catalogue(db),
        "note": "Fees are percentages of the scout's payout, charged to the merchant on top. The scout receives the full payout.",
    }


# ── trust and disputes ──────────────────────────────────────────────────────

@router.get("/trust/me")
async def my_trust(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    payload = await trust_service.current(db, vendor.id, max_age_seconds=0)
    await db.commit()
    return payload


def _dispute_out(row: DisputeCase) -> dict:
    return {
        "id": str(row.id),
        "domain": row.domain,
        "subject_id": str(row.subject_id),
        "status": row.status,
        "reason": row.reason,
        "resolution": row.resolution,
        "opened_by_vendor_id": str(row.opened_by_vendor_id) if row.opened_by_vendor_id else None,
        "against_vendor_id": str(row.against_vendor_id) if row.against_vendor_id else None,
        "created_at": row.created_at.isoformat(),
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
    }


async def _dispute_participants(db: AsyncSession, domain: str, subject_id, vendor: Vendor):
    if domain == "receipt":
        receipt = (await db.execute(
            select(Receipt).where(Receipt.id == subject_id)
        )).scalar_one_or_none()
        if receipt is None:
            raise HTTPException(404, "That receipt was not found.")
        merchant = (await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.id == receipt.merchant_id)
        )).scalar_one_or_none() if receipt.merchant_id else None
        if vendor.id == receipt.vendor_id:
            return receipt, merchant.claimed_by_vendor_id if merchant else None
        if merchant is not None and merchant.claimed_by_vendor_id == vendor.id:
            return receipt, receipt.vendor_id
        raise HTTPException(403, "Only the customer or the shop can dispute this receipt.")
    if domain == "redemption":
        row = (await db.execute(
            select(ReceiptRedemption).where(ReceiptRedemption.id == subject_id)
        )).scalar_one_or_none()
        if row is None:
            raise HTTPException(404, "That redemption was not found.")
        if vendor.id in (row.vendor_id, row.redeemed_by_vendor_id):
            return row, row.redeemed_by_vendor_id if vendor.id == row.vendor_id else row.vendor_id
        raise HTTPException(403, "Only the customer or the shop can dispute this redemption.")
    if domain == "referral":
        conversion = (await db.execute(
            select(ReferralConversion).where(ReferralConversion.id == subject_id)
        )).scalar_one_or_none()
        if conversion is None:
            raise HTTPException(404, "That referral was not found.")
        if vendor.id in (conversion.actor_vendor_id, conversion.referrer_vendor_id):
            if (
                conversion.referrer_vendor_id
                and conversion.referrer_vendor_id != vendor.id
            ):
                against = conversion.referrer_vendor_id
            else:
                listing = (await db.execute(
                    select(ReferralListing).where(ReferralListing.id == conversion.listing_id)
                )).scalar_one_or_none()
                against = listing.owner_vendor_id if listing is not None else None
            return conversion, against
        raise HTTPException(403, "Only the people in this referral can dispute it.")
    raise HTTPException(422, "Use the task dispute endpoint for scout work.")


@router.post("/disputes", status_code=201)
async def open_dispute(
    body: DisputeIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    subject, against = await _dispute_participants(db, body.domain, body.subject_id, vendor)
    existing = (await db.execute(
        select(DisputeCase.id).where(
            DisputeCase.domain == body.domain,
            DisputeCase.subject_id == body.subject_id,
            DisputeCase.opened_by_vendor_id == vendor.id,
            DisputeCase.status.in_(("open", "reviewing")),
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "You already have an open dispute on this record.")
    dispute = DisputeCase(
        id=uuid.uuid4(),
        domain=body.domain, subject_id=body.subject_id,
        opened_by_vendor_id=vendor.id, against_vendor_id=against,
        reason=body.reason, status="open",
    )
    db.add(dispute)
    if body.domain == "referral":
        subject.status = "disputed"
    audit(
        db, action="dispute_opened", entity_type=f"{body.domain}_dispute",
        entity_id=subject.id, actor_vendor_id=vendor.id,
        payload={"domain": body.domain, "reason": body.reason[:120]},
    )
    await db.commit()
    await db.refresh(dispute)
    return {"dispute": _dispute_out(dispute)}


@router.get("/disputes/mine")
async def my_disputes(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    rows = list((await db.execute(
        select(DisputeCase)
        .where((DisputeCase.opened_by_vendor_id == vendor.id) | (DisputeCase.against_vendor_id == vendor.id))
        .order_by(DisputeCase.created_at.desc())
        .limit(100)
    )).scalars().all())
    return {"disputes": [_dispute_out(row) for row in rows]}

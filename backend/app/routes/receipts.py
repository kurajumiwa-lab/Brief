"""Receipt rewards API.

The shape of the product, in endpoint order:

  POST /api/receipts                    submit the raw QR; server parses and prices it
  GET  /api/receipts                    my ledger, my shops, my point balance
  GET  /api/receipts/insights           anonymised, cohort-gated region aggregates
  POST /api/receipts/merchants/{pin}/claim   a shopkeeper claims their shop
  GET  /api/receipts/offers             merchant-funded deals, public
  POST /api/receipts/offers/{id}/claim  spend points on a voucher
  GET  /api/receipts/vouchers           my vouchers, each with its fixed six characters
  POST /api/receipts/merchant/redeem    the shopkeeper's phone checks the code

No endpoint moves money, and no endpoint claims KRA confirmed a receipt. The QR
is evidence the paper carried; freshness is computed server-side from the receipt
date and the server clock, not from a client's word.
"""

from __future__ import annotations

import hashlib
import logging
import math
import secrets
import uuid
from datetime import datetime, time, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.notification import NotificationType
from app.models.receipts import Receipt, ReceiptMerchant, ReceiptOffer, ReceiptVoucher, TradeProof
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.routes.ops import require_operator
from app.modules.price_index import service as price_index_service
from app.services import merchant_claims as claims_service
from app.services import trade_proofs as trade_proof_service
from app.services.notification_service import create_notification
from app.services.og_cards import invite_card
from app.services.receipt_rewards import (
    clean_region, clean_text, is_valid_pin, parse_date, parse_receipt_payload,
    receipt_key, receipt_value, voucher_code, voucher_code_matches,
)

log = logging.getLogger("brief.receipts")

router = APIRouter()

MAX_TOTAL_KES = 1_000_000
MAX_PAYLOAD = 4000
VOUCHER_DAYS = 14
INSIGHT_MIN_RECEIPTS = 20
INSIGHT_MIN_MERCHANTS = 3
POINTS_STATUSES = ("issued", "redeemed")


# --- shared helpers ---------------------------------------------------------

def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _receipt_out(receipt: Receipt) -> dict:
    return {
        "id": str(receipt.id),
        "merchant_name": receipt.merchant_name,
        "merchant_pin": receipt.merchant_pin,
        "invoice_no": receipt.invoice_no,
        "total": receipt.total,
        "tax": receipt.tax,
        "issued_at": _iso(receipt.issued_at),
        "scanned_at": _iso(receipt.scanned_at),
        "status": receipt.status,
        "points": receipt.points,
        "base_points": receipt.base_points,
        "freshness": receipt.freshness_key,
        "source": receipt.source,
        "verification_url": receipt.verification_url,
        "region": receipt.region,
    }


def _merchant_out(merchant: ReceiptMerchant, *, offers: list[dict] | None = None) -> dict:
    status = merchant.claim_status
    payload = {
        "id": str(merchant.id),
        "pin": merchant.pin,
        "name": merchant.name,
        "region": merchant.region,
        "claim_status": status,
        "allow_spotted_deals": merchant.allow_spotted_deals,
        "claim_status_label": claims_service.status_label(status),
        "verified": status == "verified",
        "probationary": status == "probationary",
        "contested": status == "contested",
        "claim_path": merchant.claim_path,
        "claim_confidence": int(merchant.claim_confidence or 0),
        "probation_until": _iso(merchant.probation_until),
        "contest_deadline": _iso(merchant.contest_deadline),
        **claims_service.capabilities(status),
    }
    if offers is not None:
        payload["offers"] = offers
    return payload


async def _notify_claim_owner(
    db: AsyncSession, merchant: ReceiptMerchant, *,
    title: str, body: str, sender_id: uuid.UUID | None = None, data: dict | None = None,
) -> None:
    if merchant.claimed_by_vendor_id is None:
        return
    await create_notification(
        db,
        recipient_id=merchant.claimed_by_vendor_id,
        notification_type=NotificationType.SYSTEM,
        title=title[:200],
        body=body[:500],
        sender_id=sender_id,
        data={"merchant_pin": merchant.pin, "merchant_id": str(merchant.id), **(data or {})},
    )


async def _touch_claim_state(
    db: AsyncSession, merchant: ReceiptMerchant, now: datetime,
) -> bool:
    """Resolve a contest deadline and promote a finished probation.

    Called on the owner's read path and after a redemption. A GET may write here
    because the alternative is a scheduler the single-container deploy does not
    have; the write only advances a deadline that has already passed.
    """
    changed = claims_service.resolve_expired_contest(merchant, now)
    if await claims_service.maybe_promote(db, merchant, now):
        changed = True
        await _notify_claim_owner(
            db, merchant,
            title="Your shop is verified by trading history",
            body="Three customers redeemed vouchers and no dispute stayed open. Your shop can now confirm trade proofs.",
        )
    return changed


def _offer_out(offer: ReceiptOffer, merchant: ReceiptMerchant | None = None) -> dict:
    return {
        "id": str(offer.id),
        "merchant_id": str(offer.merchant_id),
        "merchant_name": merchant.name if merchant else None,
        "merchant_pin": merchant.pin if merchant else None,
        "merchant_region": merchant.region if merchant else None,
        "title": offer.title,
        "description": offer.description,
        "discount_kes": offer.discount_kes,
        "min_spend_kes": offer.min_spend_kes,
        "points_cost": offer.points_cost,
        "starts_at": _iso(offer.starts_at),
        "ends_at": _iso(offer.ends_at),
        "is_active": offer.is_active,
    }


def _voucher_confirmation(
    voucher: ReceiptVoucher,
    merchant: ReceiptMerchant | None,
    customer: Vendor | None,
) -> dict:
    """The receipt both phones should show after a redemption.

    One shape, computed once, so the customer's wallet and the shop's counter
    cannot tell two different stories about the same code.
    """
    return {
        "code": voucher_code(voucher.id, voucher.code_seed),
        "value_kes": voucher.value_kes,
        "reward": f"KES {voucher.value_kes:,} off",
        "merchant_name": merchant.name if merchant else "Local shop",
        "merchant_pin": merchant.pin if merchant else None,
        "customer": _person(customer),
        "redeemed_at": _iso(voucher.redeemed_at),
        # This is the customer's standing, not a trade invented by a discount.
        "verified_trades": int(getattr(customer, "confirmed_trade_proofs", 0) or 0) if customer else 0,
    }


def _voucher_out(
    voucher: ReceiptVoucher,
    merchant: ReceiptMerchant | None,
    now: datetime,
    customer: Vendor | None = None,
) -> dict:
    active = voucher.status == "issued" and voucher.expires_at > now
    return {
        "id": str(voucher.id),
        "offer_id": str(voucher.offer_id) if voucher.offer_id else None,
        "merchant_id": str(voucher.merchant_id),
        "merchant_name": merchant.name if merchant else None,
        "merchant_pin": merchant.pin if merchant else None,
        "value_kes": voucher.value_kes,
        "points_cost": voucher.points_cost,
        "status": voucher.status,
        "issued_at": _iso(voucher.issued_at),
        "expires_at": _iso(voucher.expires_at),
        "redeemed_at": _iso(voucher.redeemed_at),
        "code": voucher_code(voucher.id, voucher.code_seed) if active else None,
        "code_format": "HO-XXX",
        "confirmation": (
            _voucher_confirmation(voucher, merchant, customer)
            if voucher.status == "redeemed" else None
        ),
    }


def _person(vendor: Vendor | None) -> dict | None:
    if vendor is None:
        return None
    return {
        "id": str(vendor.id),
        "name": vendor.business_name,
        "handle": vendor.vendor_handle,
    }


def _proof_out(
    proof: TradeProof,
    viewer_id: uuid.UUID,
    people: dict[uuid.UUID, Vendor],
    receipt: Receipt | None = None,
    *,
    owned_merchants: list[ReceiptMerchant] | None = None,
) -> dict:
    seller = people.get(proof.seller_vendor_id) if proof.seller_vendor_id else None
    buyer = people.get(proof.buyer_vendor_id)
    role = "seller" if proof.seller_vendor_id == viewer_id else "buyer"
    locked_reason = None
    if role == "seller" and proof.status == "pending" and owned_merchants:
        for merchant in owned_merchants:
            if merchant.claim_status == "verified":
                continue
            if proof.merchant_pin and merchant.pin != proof.merchant_pin:
                continue
            locked_reason = (
                "Confirming trade proofs unlocks when your shop is verified, "
                "not while it is pending or probationary."
            )
            break
    return {
        "id": str(proof.id),
        "status": proof.status,
        "role": role,
        "merchant_name": proof.merchant_name,
        "merchant_pin": proof.merchant_pin,
        "amount": proof.amount,
        "created_at": _iso(proof.created_at),
        "confirmed_at": _iso(proof.confirmed_at),
        "disputed_at": _iso(proof.disputed_at),
        "dispute_reason": proof.dispute_reason,
        "buyer": _person(buyer),
        "seller": _person(seller),
        "can_confirm": role == "seller" and proof.status == "pending" and locked_reason is None,
        "can_dispute": role == "seller" and proof.status == "pending",
        "confirm_locked_reason": locked_reason,
        "receipt": {
            "id": str(receipt.id),
            "total": receipt.total,
            "scanned_at": _iso(receipt.scanned_at),
            "status": receipt.status,
        } if receipt is not None else None,
    }


async def _proof_context(
    db: AsyncSession, proofs: list[TradeProof],
) -> tuple[dict[uuid.UUID, Vendor], dict[uuid.UUID, Receipt]]:
    vendor_ids = {
        vendor_id
        for proof in proofs
        for vendor_id in (proof.buyer_vendor_id, proof.seller_vendor_id)
        if vendor_id is not None
    }
    people = {}
    if vendor_ids:
        rows = (
            await db.execute(select(Vendor).where(Vendor.id.in_(vendor_ids)))
        ).scalars().all()
        people = {vendor.id: vendor for vendor in rows}

    receipt_ids = [proof.receipt_id for proof in proofs]
    receipts = {}
    if receipt_ids:
        rows = (
            await db.execute(select(Receipt).where(Receipt.id.in_(receipt_ids)))
        ).scalars().all()
        receipts = {receipt.id: receipt for receipt in rows}
    return people, receipts


async def _expire_vouchers(db: AsyncSession, now: datetime, vendor_id: uuid.UUID | None = None) -> None:
    statement = (
        update(ReceiptVoucher)
        .where(ReceiptVoucher.status == "issued", ReceiptVoucher.expires_at <= now)
        .values(status="expired")
    )
    if vendor_id is not None:
        statement = statement.where(ReceiptVoucher.vendor_id == vendor_id)
    await db.execute(statement)


async def _points_balance(db: AsyncSession, vendor_id: uuid.UUID, now: datetime) -> dict:
    await _expire_vouchers(db, now, vendor_id)
    awarded = int(
        (await db.execute(
            select(func.coalesce(func.sum(Receipt.points), 0)).where(Receipt.vendor_id == vendor_id)
        )).scalar_one()
        or 0
    )
    spent = int(
        (await db.execute(
            select(func.coalesce(func.sum(ReceiptVoucher.points_cost), 0)).where(
                ReceiptVoucher.vendor_id == vendor_id,
                ReceiptVoucher.status.in_(POINTS_STATUSES),
            )
        )).scalar_one()
        or 0
    )
    return {"awarded": awarded, "spent": spent, "available": max(0, awarded - spent)}


async def _owned_merchants(
    db: AsyncSession, vendor_id: uuid.UUID, *, verified_only: bool = False,
) -> list[ReceiptMerchant]:
    statement = select(ReceiptMerchant).where(ReceiptMerchant.claimed_by_vendor_id == vendor_id)
    if verified_only:
        statement = statement.where(ReceiptMerchant.claim_status == "verified")
    return list((await db.execute(statement.order_by(ReceiptMerchant.name))).scalars().all())


async def _merchant_or_404(db: AsyncSession, pin: str) -> ReceiptMerchant:
    merchant = (
        await db.execute(select(ReceiptMerchant).where(ReceiptMerchant.pin == pin.upper()))
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network yet")
    return merchant


async def _offer_or_404(db: AsyncSession, offer_id: uuid.UUID) -> ReceiptOffer:
    offer = (await db.execute(select(ReceiptOffer).where(ReceiptOffer.id == offer_id))).scalar_one_or_none()
    if offer is None:
        raise HTTPException(404, "That offer does not exist")
    return offer


def _clean_title(value: str) -> str:
    title = clean_text(value)
    if not title:
        raise HTTPException(422, "Give the deal a short title")
    if len(title) > 160:
        raise HTTPException(422, "Keep the deal title under 160 characters")
    return title


# --- request bodies ---------------------------------------------------------

class ReceiptIn(BaseModel):
    payload: Optional[str] = Field(None, max_length=MAX_PAYLOAD)
    source: Literal["qr", "manual"] = "qr"
    merchant_name: Optional[str] = Field(None, max_length=200)
    merchant_pin: Optional[str] = Field(None, max_length=20)
    invoice_no: Optional[str] = Field(None, max_length=100)
    total: Optional[float] = Field(None, ge=1, le=MAX_TOTAL_KES)
    tax: Optional[float] = Field(None, ge=0, le=MAX_TOTAL_KES)
    region: Optional[str] = Field(None, max_length=80)


class MerchantClaimIn(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    region: Optional[str] = Field(None, max_length=80)
    phone: Optional[str] = Field(None, max_length=20)
    note: Optional[str] = Field(None, max_length=1000)


class ClaimEvidenceIn(BaseModel):
    payload: str = Field(..., min_length=8, max_length=MAX_PAYLOAD)


class ClaimVouchIn(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


class ClaimContestIn(BaseModel):
    reason: str = Field(..., min_length=10, max_length=1000)
    payload: str = Field(..., min_length=8, max_length=MAX_PAYLOAD)


class MerchantUpdateIn(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    region: Optional[str] = Field(None, max_length=80)
    phone: Optional[str] = Field(None, max_length=20)


class OfferIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=160)
    description: Optional[str] = Field(None, max_length=1000)
    discount_kes: int = Field(..., gt=0, le=MAX_TOTAL_KES)
    min_spend_kes: int = Field(0, ge=0, le=MAX_TOTAL_KES)
    points_cost: int = Field(..., ge=0, le=1_000_000)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None

    @field_validator("ends_at")
    @classmethod
    def _end_after_start(cls, value, info):
        start = info.data.get("starts_at")
        if value is not None and start is not None and value <= start:
            raise ValueError("ends_at must be after starts_at")
        return value


class OfferUpdateIn(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=160)
    description: Optional[str] = Field(None, max_length=1000)
    discount_kes: Optional[int] = Field(None, gt=0, le=MAX_TOTAL_KES)
    min_spend_kes: Optional[int] = Field(None, ge=0, le=MAX_TOTAL_KES)
    points_cost: Optional[int] = Field(None, ge=0, le=1_000_000)
    ends_at: Optional[datetime] = None
    is_active: Optional[bool] = None


class RedeemIn(BaseModel):
    code: str = Field(..., min_length=3, max_length=16)
    voucher_id: Optional[uuid.UUID] = None


class VerifyMerchantIn(BaseModel):
    approve: bool = True
    note: Optional[str] = Field(None, max_length=1000)


class DisputeProofIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=1000)


# --- receipts ---------------------------------------------------------------

@router.post("", status_code=201)
async def submit_receipt(
    body: ReceiptIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    region = clean_region(body.region)

    if body.source == "manual":
        total = int(round(body.total or 0))
        name = clean_text(body.merchant_name)
        if not name:
            raise HTTPException(422, "A merchant name and the amount paid are the minimum for a record")
        if total <= 0:
            raise HTTPException(422, "Enter the amount actually paid")
        parsed = {
            "pin": clean_text(body.merchant_pin).upper(),
            "invoice": clean_text(body.invoice_no),
            "merchant": name,
            "total": total,
            "tax": int(round(body.tax or 0)) or None,
            "issued_at": None,
            "token": "",
            "verification_url": None,
            "verified": False,
        }
        status = "manual"
        multiplier = 0.0
        issued_at = None
        raw_payload = None
    else:
        if not clean_text(body.payload):
            raise HTTPException(422, "Scan or paste the QR code on the receipt first")
        parsed_result = parse_receipt_payload(body.payload)
        if not parsed_result.get("ok"):
            raise HTTPException(422, parsed_result.get("error") or "That code is not a receipt")
        parsed = parsed_result["receipt"]
        total = parsed["total"]
        if total is None:
            total = int(round(body.total or 0))
        if total <= 0:
            raise HTTPException(422, "The total is missing. Enter the amount printed on the receipt")
        if parsed["total"] is not None and body.total is not None and int(round(body.total)) != parsed["total"]:
            raise HTTPException(422, "The total on the code does not match the total entered")
        if total > MAX_TOTAL_KES:
            raise HTTPException(422, "That total is above the receipt limit")
        if not clean_text(parsed["merchant"]):
            parsed["merchant"] = clean_text(body.merchant_name)
        if not parsed["invoice"]:
            parsed["invoice"] = clean_text(body.invoice_no)
        if not parsed["pin"]:
            parsed["pin"] = clean_text(body.merchant_pin).upper()
        issued_at = parsed["issued_at"]
        if issued_at is not None and issued_at > now + timedelta(minutes=5):
            raise HTTPException(422, "That receipt is dated in the future. Check the date on the paper")
        status = "verified" if (is_valid_pin(parsed["pin"]) and parsed["invoice"] and total) else "partial"
        multiplier = 1.0 if status == "verified" else 0.5
        raw_payload = clean_text(body.payload)[:MAX_PAYLOAD]

    dedupe = receipt_key(parsed)
    if not dedupe:
        if parsed["invoice"]:
            dedupe = f"invoice:{parsed['pin'] or 'nopin'}:{parsed['invoice']}"
        elif parsed["verification_url"]:
            dedupe = f"url:{parsed['verification_url']}"
        elif body.source == "manual":
            # A typed record earns nothing, so a unique key is safe and avoids
            # blocking two genuinely different cash purchases at the same shop.
            dedupe = f"manual:{vendor.id}:{uuid.uuid4()}"
        else:
            dedupe = f"payload:{hashlib.sha256(clean_text(body.payload).encode()).hexdigest()[:40]}"

    existing = (
        await db.execute(select(Receipt.id).where(Receipt.dedupe_key == dedupe))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "That receipt is already in the ledger. One receipt, one reward.")

    merchant = None
    if body.source != "manual" and is_valid_pin(parsed["pin"]):
        merchant = (
            await db.execute(
                select(ReceiptMerchant).where(ReceiptMerchant.pin == parsed["pin"]).with_for_update()
            )
        ).scalar_one_or_none()
        fallback_name = f"Merchant {parsed['pin'][-4:]}"
        if merchant is None:
            merchant = ReceiptMerchant(
                pin=parsed["pin"],
                name=clean_text(parsed["merchant"]) or fallback_name,
                region=region,
                claim_status="unclaimed",
            )
            db.add(merchant)
            await db.flush()
        else:
            # Do not let a scanner overwrite the name of a shop whose owner has
            # claimed it. An unclaimed row can be improved from the paper.
            if merchant.claim_status != "verified":
                if clean_text(parsed["merchant"]) and merchant.name.startswith("Merchant "):
                    merchant.name = clean_text(parsed["merchant"])[:200]
                if region and not merchant.region:
                    merchant.region = region
        region = merchant.region or region

    value = receipt_value(total, issued_at, now)
    points = int(math.floor(value["points"] * multiplier + 0.5)) if body.source != "manual" else 0

    receipt = Receipt(
        vendor_id=vendor.id,
        merchant_id=merchant.id if merchant else None,
        merchant_pin=parsed["pin"] or None,
        merchant_name=(merchant.name if merchant else (clean_text(parsed["merchant"]) or "Local merchant"))[:200],
        invoice_no=parsed["invoice"] or None,
        total=total,
        tax=int(round(parsed["tax"] or 0)) or None,
        issued_at=issued_at,
        scanned_at=now,
        source=body.source,
        status=status,
        freshness_key=value["freshness"],
        base_points=value["base"],
        points=points,
        token=parsed["token"] or None,
        verification_url=parsed["verification_url"] or None,
        raw_payload=raw_payload,
        dedupe_key=dedupe,
        region=region,
    )
    db.add(receipt)
    try:
        await db.flush()
        # A QR is one side of a trade. The proof waits for the shop; a typed
        # receipt never produces one because it has no QR evidence.
        await trade_proof_service.create_for_receipt(
            db, receipt=receipt, buyer=vendor, merchant=merchant,
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "That receipt is already in the ledger. One receipt, one reward.")
    await db.refresh(receipt)

    # A referral is a second economic engine on the same evidence. This runs in
    # its own transaction after the receipt is already saved: a failing referral
    # lookup must never discard a valid receipt.
    referral = None
    receipt_id = receipt.id
    try:
        from app.modules.referrals import service as referral_service

        referral = await referral_service.qualify_verified_receipt(
            db, receipt=receipt, buyer=vendor,
        )
        await db.commit()
    except Exception:  # pragma: no cover - defensive, and never loses the receipt
        await db.rollback()
        log.exception("referral qualification failed for receipt %s", receipt_id)

    await db.refresh(receipt)
    balance = await _points_balance(db, vendor.id, now)
    return {
        "receipt": _receipt_out(receipt),
        "points_awarded": receipt.points,
        "balance": balance,
        "referral": referral,
        "message": (
            "Recorded. A typed receipt earns no points."
            if status == "manual"
            else "Recorded. Fresh receipts are worth more."
        ),
    }


@router.get("")
async def my_receipts(
    limit: int = Query(100, ge=1, le=500),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    receipts = (
        await db.execute(
            select(Receipt).where(Receipt.vendor_id == vendor.id)
            .order_by(Receipt.scanned_at.desc()).limit(limit)
        )
    ).scalars().all()

    totals = (
        await db.execute(
            select(
                func.count(Receipt.id),
                func.coalesce(func.sum(Receipt.total), 0),
                func.coalesce(func.sum(Receipt.points), 0),
                func.count(func.distinct(func.coalesce(Receipt.merchant_pin, Receipt.merchant_name))),
                func.count(Receipt.id).filter(Receipt.freshness_key == "fresh"),
            ).where(Receipt.vendor_id == vendor.id)
        )
    ).one()

    rows = (
        await db.execute(
            select(
                Receipt.merchant_pin,
                Receipt.merchant_name,
                func.count(Receipt.id),
                func.coalesce(func.sum(Receipt.total), 0),
                func.coalesce(func.sum(Receipt.points), 0),
                func.max(Receipt.scanned_at),
            )
            .where(Receipt.vendor_id == vendor.id)
            .group_by(Receipt.merchant_pin, Receipt.merchant_name)
            .order_by(func.coalesce(func.sum(Receipt.total), 0).desc())
        )
    ).all()

    return {
        "receipts": [_receipt_out(receipt) for receipt in receipts],
        "summary": {
            "receipts": int(totals[0] or 0),
            "spend": int(totals[1] or 0),
            "points": int(totals[2] or 0),
            "merchants": int(totals[3] or 0),
            "fresh": int(totals[4] or 0),
        },
        "balance": await _points_balance(db, vendor.id, now),
        "merchants": [
            {
                "pin": pin,
                "name": name,
                "visits": int(visits),
                "spend": int(spend or 0),
                "points": int(points or 0),
                "last_at": _iso(last_at),
            }
            for pin, name, visits, spend, points, last_at in rows
        ],
    }


@router.get("/summary")
async def my_summary(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    totals = (
        await db.execute(
            select(
                func.count(Receipt.id),
                func.coalesce(func.sum(Receipt.total), 0),
                func.coalesce(func.sum(Receipt.points), 0),
                func.count(func.distinct(func.coalesce(Receipt.merchant_pin, Receipt.merchant_name))),
            ).where(Receipt.vendor_id == vendor.id)
        )
    ).one()
    return {
        "receipts": int(totals[0] or 0),
        "spend": int(totals[1] or 0),
        "points": int(totals[2] or 0),
        "merchants": int(totals[3] or 0),
        "balance": await _points_balance(db, vendor.id, now),
    }


# --- receipt-backed trades --------------------------------------------------

@router.get("/trade-proofs")
async def my_trade_proofs(
    status: Optional[str] = Query(None, pattern="^(pending|confirmed|disputed|unmatched)$"),
    limit: int = Query(100, ge=1, le=200),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The buyer's waiting questions and the seller's confirmation queue.

    Only the two participants ever see a proof. The response says which side
    the viewer is on, because the same row is "waiting for the shop" on one
    phone and "confirm this" on the other.
    """
    proofs = await trade_proof_service.proofs_for(db, vendor.id, status=status, limit=limit)
    people, receipts = await _proof_context(db, proofs)
    owned = await _owned_merchants(db, vendor.id)
    out = [
        _proof_out(
            proof,
            vendor.id,
            people,
            receipts.get(proof.receipt_id),
            owned_merchants=owned,
        )
        for proof in proofs
    ]
    return {
        "proofs": out,
        "summary": {
            "pending_for_me": sum(1 for row in out if row["can_confirm"]),
            "waiting_for_shop": sum(
                1 for row in out if row["role"] == "buyer" and row["status"] == "pending"
            ),
            "confirmed": sum(1 for row in out if row["status"] == "confirmed"),
            "unmatched": sum(1 for row in out if row["status"] == "unmatched"),
        },
        "confirmed_trade_proofs": int(vendor.confirmed_trade_proofs or 0),
    }


@router.post("/trade-proofs/{proof_id}/confirm")
async def confirm_trade_proof(
    proof_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    proof = (
        await db.execute(select(TradeProof).where(TradeProof.id == proof_id).with_for_update())
    ).scalar_one_or_none()
    if proof is None:
        raise HTTPException(404, "That trade proof does not exist")
    if proof.seller_vendor_id != vendor.id:
        raise HTTPException(403, "Only the shop named on the receipt can confirm it")
    if proof.status != "pending":
        raise HTTPException(409, "That trade is not waiting for confirmation")

    # Probation is deliberately not allowed to confirm receipts. Otherwise a
    # fake owner could manufacture standing for colluding buyers without ever
    # proving the till, and the 14-day rule would be decorative.
    for merchant in await _owned_merchants(db, vendor.id):
        if merchant.claim_status == "verified":
            continue
        if proof.merchant_pin and merchant.pin != proof.merchant_pin:
            continue
        raise HTTPException(
            403,
            "Confirming trade proofs unlocks when your shop is verified, "
            "not while it is pending or probationary.",
        )

    buyer = await db.get(Vendor, proof.buyer_vendor_id)
    if buyer is None:
        raise HTTPException(409, "The buyer account no longer exists")

    await trade_proof_service.confirm(db, proof=proof, seller=vendor, buyer=buyer)
    await db.commit()
    # The index is allowed to be a few seconds stale, but a confirmation is
    # exactly the event that changes it. Best-effort: never fail a real trade
    # because a derived snapshot could not be rebuilt.
    try:
        await price_index_service.refresh_indices(db)
        await db.commit()
    except Exception:
        await db.rollback()
        log.exception("corridor price index refresh after trade confirmation failed")
    await db.refresh(proof)
    await db.refresh(vendor)
    await db.refresh(buyer)
    people = {vendor.id: vendor, buyer.id: buyer}
    receipt = await db.get(Receipt, proof.receipt_id)
    return {
        "proof": _proof_out(proof, vendor.id, people, receipt),
        "confirmed_trade_proofs": {
            "mine": int(vendor.confirmed_trade_proofs or 0),
            "buyer": int(buyer.confirmed_trade_proofs or 0),
        },
    }


@router.post("/trade-proofs/{proof_id}/dispute")
async def dispute_trade_proof(
    proof_id: uuid.UUID,
    body: DisputeProofIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    proof = (
        await db.execute(select(TradeProof).where(TradeProof.id == proof_id).with_for_update())
    ).scalar_one_or_none()
    if proof is None:
        raise HTTPException(404, "That trade proof does not exist")
    if proof.seller_vendor_id != vendor.id:
        raise HTTPException(403, "Only the shop named on the receipt can question it")
    if proof.status != "pending":
        raise HTTPException(409, "That trade is not waiting for confirmation")
    buyer = await db.get(Vendor, proof.buyer_vendor_id)
    if buyer is None:
        raise HTTPException(409, "The buyer account no longer exists")

    await trade_proof_service.dispute(
        db, proof=proof, seller=vendor, buyer=buyer, reason=body.reason,
    )
    await db.commit()
    await db.refresh(proof)
    people = {vendor.id: vendor, buyer.id: buyer}
    receipt = await db.get(Receipt, proof.receipt_id)
    return {"proof": _proof_out(proof, vendor.id, people, receipt)}


# --- public merchant discovery / offers -------------------------------------

@router.get("/merchants")
async def list_merchants(
    region: Optional[str] = Query(None, max_length=80),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    statement = select(ReceiptMerchant).where(
        ReceiptMerchant.claim_status.in_(("verified", "probationary"))
    )
    slug = clean_region(region)
    if slug:
        statement = statement.where(ReceiptMerchant.region == slug)
    merchants = (
        await db.execute(statement.order_by(ReceiptMerchant.name).limit(limit))
    ).scalars().all()
    return {"merchants": [_merchant_out(merchant) for merchant in merchants]}


@router.get("/merchants/me")
async def my_merchants(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    merchants = await _owned_merchants(db, vendor.id)
    for merchant in merchants:
        await _touch_claim_state(db, merchant, now)
    await db.commit()
    return {"merchants": [_merchant_out(merchant) for merchant in merchants]}


@router.get("/merchants/{pin}")
async def merchant_card(pin: str, db: AsyncSession = Depends(get_db)):
    merchant = await _merchant_or_404(db, pin)
    now = datetime.utcnow()
    if claims_service.resolve_expired_contest(merchant, now):
        await db.commit()
    offers = (
        await db.execute(
            select(ReceiptOffer).where(
                ReceiptOffer.merchant_id == merchant.id,
                ReceiptOffer.is_active.is_(True),
                ReceiptOffer.starts_at <= now,
                (ReceiptOffer.ends_at.is_(None)) | (ReceiptOffer.ends_at > now),
            ).order_by(ReceiptOffer.discount_kes.desc())
        )
    ).scalars().all()
    return _merchant_out(merchant, offers=[_offer_out(offer, merchant) for offer in offers])


@router.post("/merchants/{pin}/claim", status_code=201)
async def claim_merchant(
    pin: str,
    body: MerchantClaimIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Start a claim. It stays pending until a challenge sale or a vouch arrives.

    A claim alone unlocks nothing. The claimant can ring a random test amount at
    the shop's till, or collect two independent Level 3+ vouches, to enter the
    capped probationary state without waiting for a person.
    """
    normalized = clean_text(pin).upper()
    if not is_valid_pin(normalized):
        raise HTTPException(422, "A shop PIN looks like P051234567X. Check the receipt.")
    merchant = (
        await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.pin == normalized).with_for_update()
        )
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network yet")

    owned_by_viewer = merchant.claimed_by_vendor_id == vendor.id
    if merchant.claim_status in ("verified", "probationary", "contested", "suspended"):
        if not owned_by_viewer:
            raise HTTPException(409, "That shop already has an owner or an open ownership contest")
        return {
            "merchant": _merchant_out(merchant),
            "message": "You already run this shop on the network",
        }
    if merchant.claim_status == "pending" and not owned_by_viewer:
        raise HTTPException(409, "Somebody has already applied to claim that shop")

    fresh = not owned_by_viewer or merchant.claim_status in ("unclaimed", "rejected")
    now = datetime.utcnow()
    merchant.claimed_by_vendor_id = vendor.id
    merchant.claim_status = "pending"
    merchant.claimed_at = now if fresh or merchant.claimed_at is None else merchant.claimed_at
    merchant.claim_note = clean_text(body.note)[:1000] or merchant.claim_note
    if fresh:
        merchant.claim_path = None
        merchant.claim_confidence = 0
        merchant.claim_evidence = {}
        merchant.claim_receipt_key = None
        merchant.probation_until = None
        merchant.contest_deadline = None
        merchant.verified_at = None
    if clean_text(body.name):
        merchant.name = clean_text(body.name)[:200]
    if clean_region(body.region):
        merchant.region = clean_region(body.region)
    if clean_text(body.phone):
        merchant.phone = clean_text(body.phone)[:20]
    await db.commit()
    await db.refresh(merchant)
    return {
        "merchant": _merchant_out(merchant),
        "message": (
            "Claim saved. Ring a test sale now to start selling today, "
            "or wait for review."
        ),
    }


@router.post("/merchants/{pin}/claim/challenge", status_code=201)
async def merchant_claim_challenge(
    pin: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Issue one random KSh 1–99 test amount, valid for ten minutes.

    The amount is server-generated and cannot be chosen by the client. Repeating
    the call while it is live returns the same amount, so a shopkeeper already
    at the till is not sent back to ring a different sale.
    """
    normalized = clean_text(pin).upper()
    if not is_valid_pin(normalized):
        raise HTTPException(422, "A shop PIN looks like P051234567X.")
    merchant = (
        await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.pin == normalized).with_for_update()
        )
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network yet")
    if merchant.claimed_by_vendor_id != vendor.id:
        raise HTTPException(403, "Claim the shop before asking for a test amount")
    if merchant.claim_status == "verified":
        raise HTTPException(409, "That shop is already verified")
    if merchant.claim_status != "pending":
        raise HTTPException(409, "That claim is not waiting for a test sale")

    now = datetime.utcnow()
    challenge = claims_service.issue_challenge(merchant, now)
    await db.commit()
    expires = challenge.get("expires_at")
    return {
        "challenge": {
            "amount_kes": int(challenge["amount_kes"]),
            "issued_at": challenge.get("issued_at"),
            "expires_at": expires,
            "seconds_left": max(
                0,
                int((datetime.fromisoformat(expires.replace("Z", "+00:00")).replace(tzinfo=None) - now).total_seconds()),
            ) if expires else 0,
        },
        "merchant": _merchant_out(merchant),
        "message": "Ring this exact amount at the shop's till, then submit the receipt.",
    }


@router.post("/merchants/{pin}/claim/evidence", status_code=200)
async def merchant_claim_evidence(
    pin: str,
    body: ClaimEvidenceIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Answer the challenge sale. This unlocks probation, never a verified badge.

    The server parses the raw QR itself. A client cannot post an amount, a score
    or a "verified" flag. The receipt must carry the shop's PIN, the exact test
    amount and an issue time inside the challenge window. The payload is hashed
    and discarded; only the hash, invoice suffix and total are kept.
    """
    normalized = clean_text(pin).upper()
    merchant = (
        await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.pin == normalized).with_for_update()
        )
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network yet")
    if merchant.claimed_by_vendor_id != vendor.id:
        raise HTTPException(403, "Only the claimant can answer this challenge")
    if merchant.claim_status != "pending":
        if merchant.claim_status == "probationary":
            raise HTTPException(409, "This shop is already on probation")
        raise HTTPException(409, "That claim is not waiting for a test receipt")

    now = datetime.utcnow()
    evidence, error = claims_service.receipt_for_challenge(merchant, body.payload, now)
    if error or evidence is None:
        raise HTTPException(422, error or "That receipt did not answer the challenge")

    digest = evidence["receipt"]["payload_sha256"]
    replay = (
        await db.execute(
            select(ReceiptMerchant.id).where(
                ReceiptMerchant.claim_receipt_key == digest,
                ReceiptMerchant.id != merchant.id,
            )
        )
    ).first()
    if replay is not None:
        raise HTTPException(409, "That receipt has already been used for another shop claim")

    claims_service.mark_challenge_used(merchant, evidence, digest, now)
    merchant.claim_path = "receipt_challenge"
    merchant.claim_confidence = 45
    merchant.claim_status = "probationary"
    merchant.probation_until = claims_service.promotion_window(now)
    merchant.verified_at = None
    await db.commit()
    await db.refresh(merchant)
    return {
        "merchant": _merchant_out(merchant),
        "unlocked": [
            "Check customer voucher codes",
            f"Publish up to {settings.MERCHANT_CLAIM_ACTIVE_OFFER_CAP} active offer",
            f"Issue at most {settings.MERCHANT_CLAIM_WEEKLY_VOUCHER_CAP} vouchers a week",
        ],
        "locked": [
            "Confirming trade proofs stays locked until the shop is verified",
            "The badge says Probationary owner, never Verified owner",
        ],
        "message": (
            "Probationary owner. Your shop can trade now; "
            "trade-proof confirmation waits for verification."
        ),
    }


@router.post("/merchants/{pin}/claim/vouch", status_code=201)
async def merchant_claim_vouch(
    pin: str,
    body: ClaimVouchIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """One independent Level 3+ neighbour vouches. Two move a claim to probation."""
    normalized = clean_text(pin).upper()
    merchant = (
        await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.pin == normalized).with_for_update()
        )
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network yet")
    if merchant.claim_status not in ("pending", "probationary"):
        raise HTTPException(409, "That claim is not open for vouches")
    claimant = (
        await db.get(Vendor, merchant.claimed_by_vendor_id)
        if merchant.claimed_by_vendor_id else None
    )
    now = datetime.utcnow()
    result, error = await claims_service.add_vouch(db, merchant, vendor, now, claimant)
    if error:
        raise HTTPException(422, error)
    if merchant.claim_status == "probationary" and merchant.claim_path == "peer_vouch":
        await _notify_claim_owner(
            db, merchant,
            title="Two neighbours vouched for your shop",
            body="Your shop is probationary: vouchers and one active offer are unlocked. Trade proofs stay locked.",
            sender_id=vendor.id,
        )
    merchant.claim_note = clean_text(body.note)[:1000] or merchant.claim_note
    await db.commit()
    await db.refresh(merchant)
    return {
        "merchant": _merchant_out(merchant),
        "vouch": result,
        "message": (
            "Vouch recorded. One more independent Level 3+ neighbour unlocks probation."
            if result and result.get("vouches", 0) < 2
            else "Vouch recorded. The shop can operate on probation."
        ),
    }


@router.post("/merchants/{pin}/claim/contest", status_code=201)
async def merchant_claim_contest(
    pin: str,
    body: ClaimContestIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Freeze a claimed shop with a receipt from that shop, not a bare accusation.

    The owner has 48 hours to answer with a fresh receipt. Until then new offers
    stop and already-issued vouchers remain redeemable, so customers are not
    punished for an ownership dispute.
    """
    normalized = clean_text(pin).upper()
    merchant = (
        await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.pin == normalized).with_for_update()
        )
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network yet")
    if merchant.claim_status not in ("pending", "probationary", "verified"):
        raise HTTPException(409, "That shop has no active owner claim to contest")
    if merchant.claimed_by_vendor_id == vendor.id:
        raise HTTPException(409, "You cannot contest your own shop")
    if merchant.contest_deadline is not None and merchant.contest_deadline > datetime.utcnow():
        raise HTTPException(409, "An ownership contest is already open for this shop")

    now = datetime.utcnow()
    evidence, error = await claims_service.contest_evidence(db, merchant, body.payload, now)
    if error or evidence is None:
        raise HTTPException(422, error or "That receipt cannot open a contest")

    claims_service.start_contest(merchant, vendor, evidence, body.reason, now)
    # A contest freezes new offers. Existing vouchers stay redeemable, so this
    # does not cancel a customer's discount.
    await db.execute(
        update(ReceiptOffer)
        .where(ReceiptOffer.merchant_id == merchant.id, ReceiptOffer.is_active.is_(True))
        .values(is_active=False)
    )
    await _notify_claim_owner(
        db, merchant,
        title="Somebody contested your shop",
        body="New offers are frozen. Add a fresh receipt from the shop within 48 hours or the claim returns to review.",
        sender_id=vendor.id,
        data={"reason": clean_text(body.reason)[:500]},
    )
    await db.commit()
    await db.refresh(merchant)
    return {
        "merchant": _merchant_out(merchant),
        "message": "Contest opened. The owner has 48 hours to answer; vouchers already issued still work.",
    }


@router.post("/merchants/{pin}/claim/contest/answer", status_code=200)
async def merchant_claim_contest_answer(
    pin: str,
    body: ClaimEvidenceIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The owner answers a contest with a fresh receipt from the shop."""
    normalized = clean_text(pin).upper()
    merchant = (
        await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.pin == normalized).with_for_update()
        )
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network yet")
    if merchant.claimed_by_vendor_id != vendor.id:
        raise HTTPException(403, "Only the shop's current owner can answer a contest")
    now = datetime.utcnow()
    if merchant.claim_status != "contested":
        raise HTTPException(409, "That shop has no contest to answer")
    if claims_service.resolve_expired_contest(merchant, now):
        await db.commit()
        raise HTTPException(409, "The 48-hour answer window has passed; the claim is back in review")

    evidence, error = await claims_service.contest_evidence(db, merchant, body.payload, now)
    if error or evidence is None:
        raise HTTPException(422, error or "That receipt cannot answer the contest")
    started = claims_service.contest_started_at(merchant)
    issued = parse_date(evidence.get("issued_at"))
    if started is None or issued is None or issued < started - timedelta(minutes=5):
        raise HTTPException(422, "The receipt must be dated after the contest opened.")

    previous = claims_service.answer_contest(merchant, evidence, now)
    await db.commit()
    await db.refresh(merchant)
    return {
        "merchant": _merchant_out(merchant),
        "message": (
            "Contest answered. Your previous shop status is restored."
            if previous != "pending"
            else "Contest answered. The claim is back in review."
        ),
    }


@router.patch("/merchants/{merchant_id}")
async def update_my_merchant(
    merchant_id: uuid.UUID,
    body: MerchantUpdateIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    merchant = (
        await db.execute(select(ReceiptMerchant).where(ReceiptMerchant.id == merchant_id))
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network")
    if merchant.claimed_by_vendor_id != vendor.id or merchant.claim_status not in (
        "verified", "probationary",
    ):
        raise HTTPException(403, "Only the current owner can edit this shop")
    if body.name is not None:
        merchant.name = _clean_title(body.name)
    if body.region is not None:
        merchant.region = clean_region(body.region)
    if body.phone is not None:
        merchant.phone = clean_text(body.phone)[:20] or None
    await db.commit()
    await db.refresh(merchant)
    return _merchant_out(merchant)


@router.get("/offers")
async def list_offers(
    region: Optional[str] = Query(None, max_length=80),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    statement = (
        select(ReceiptOffer, ReceiptMerchant)
        .join(ReceiptMerchant, ReceiptOffer.merchant_id == ReceiptMerchant.id)
        .where(
            ReceiptOffer.is_active.is_(True),
            ReceiptOffer.starts_at <= now,
            (ReceiptOffer.ends_at.is_(None)) | (ReceiptOffer.ends_at > now),
            ReceiptMerchant.claim_status.in_(("verified", "probationary")),
        )
        .order_by(ReceiptOffer.points_cost.asc(), ReceiptOffer.discount_kes.desc())
        .limit(limit)
    )
    slug = clean_region(region)
    if slug:
        statement = statement.where(ReceiptMerchant.region == slug)
    rows = (await db.execute(statement)).all()
    return {"offers": [_offer_out(offer, merchant) for offer, merchant in rows]}


@router.post("/offers", status_code=201)
async def create_offer(
    body: OfferIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    merchants = await _owned_merchants(db, vendor.id)
    eligible = [
        merchant for merchant in merchants
        if claims_service.can_publish_offers(merchant.claim_status)
    ]
    if not eligible:
        raise HTTPException(403, "Claim your shop and complete a test sale before publishing a deal")
    merchant = eligible[0]
    now = datetime.utcnow()
    if merchant.claim_status == "probationary":
        live = await claims_service.active_offers(db, merchant, now)
        if live >= settings.MERCHANT_CLAIM_ACTIVE_OFFER_CAP:
            raise HTTPException(
                409,
                f"A probationary shop can run {settings.MERCHANT_CLAIM_ACTIVE_OFFER_CAP} "
                "active offer. Pause the current one first.",
            )
    starts_at = body.starts_at or now
    if body.ends_at is not None and body.ends_at <= starts_at:
        raise HTTPException(422, "The deal must end after it starts")
    offer = ReceiptOffer(
        merchant_id=merchant.id,
        title=_clean_title(body.title),
        description=clean_text(body.description) or None,
        discount_kes=body.discount_kes,
        min_spend_kes=body.min_spend_kes,
        points_cost=body.points_cost,
        starts_at=starts_at,
        ends_at=body.ends_at,
        is_active=True,
        created_by_vendor_id=vendor.id,
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return _offer_out(offer, merchant)


@router.patch("/offers/{offer_id}")
async def update_offer(
    offer_id: uuid.UUID,
    body: OfferUpdateIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    offer = await _offer_or_404(db, offer_id)
    merchant = (
        await db.execute(select(ReceiptMerchant).where(ReceiptMerchant.id == offer.merchant_id))
    ).scalar_one_or_none()
    if merchant is None or merchant.claimed_by_vendor_id != vendor.id:
        raise HTTPException(403, "Only the shop that published the deal can change it")
    if not claims_service.can_publish_offers(merchant.claim_status):
        raise HTTPException(403, "That shop cannot publish offers right now")
    if (
        merchant.claim_status == "probationary"
        and body.is_active is True
        and not offer.is_active
    ):
        live = await claims_service.active_offers(db, merchant, datetime.utcnow())
        if live >= settings.MERCHANT_CLAIM_ACTIVE_OFFER_CAP:
            raise HTTPException(
                409,
                f"A probationary shop can run {settings.MERCHANT_CLAIM_ACTIVE_OFFER_CAP} "
                "active offer.",
            )
    if body.title is not None:
        offer.title = _clean_title(body.title)
    if body.description is not None:
        offer.description = clean_text(body.description) or None
    if body.discount_kes is not None:
        offer.discount_kes = body.discount_kes
    if body.min_spend_kes is not None:
        offer.min_spend_kes = body.min_spend_kes
    if body.points_cost is not None:
        offer.points_cost = body.points_cost
    if body.ends_at is not None:
        if body.ends_at <= offer.starts_at:
            raise HTTPException(422, "The deal must end after it starts")
        offer.ends_at = body.ends_at
    if body.is_active is not None:
        offer.is_active = body.is_active
    await db.commit()
    await db.refresh(offer)
    return _offer_out(offer, merchant)


@router.get("/offers/mine")
async def my_offers(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    merchants = await _owned_merchants(db, vendor.id)
    if not merchants:
        return {"offers": []}
    by_id = {merchant.id: merchant for merchant in merchants}
    offers = (
        await db.execute(
            select(ReceiptOffer).where(ReceiptOffer.merchant_id.in_(list(by_id)))
            .order_by(ReceiptOffer.created_at.desc())
        )
    ).scalars().all()
    return {"offers": [_offer_out(offer, by_id.get(offer.merchant_id)) for offer in offers]}


@router.get("/invites/{slug}")
async def public_shop_invite(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """The public half of an unmatched-shop invite. No account, no receipt rows.

    It returns the shop name, region, claim state and an aggregate count of
    verified receipts. It never returns a buyer, an invoice number or a phone.
    """
    card = await invite_card(db, slug, str(request.base_url).rstrip("/"))
    if card is None:
        raise HTTPException(404, "That shop invite does not exist")
    return {
        "shop": {
            "name": card["name"],
            "pin": card["pin"],
            "region": card["place"] or None,
            "claim_status": card["claim_status"],
            "verified": card["claim_status"] == "verified",
        },
        "receipts": card["receipts"],
        "title": card["title"],
        "description": card["description"],
        "invite_path": f"/invite/{slug}",
    }


# --- vouchers ---------------------------------------------------------------

@router.post("/offers/{offer_id}/claim", status_code=201)
async def claim_voucher(
    offer_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    # Serialise one person's claims so two taps cannot spend the same points.
    await db.execute(select(Vendor.id).where(Vendor.id == vendor.id).with_for_update())

    offer = await _offer_or_404(db, offer_id)
    merchant = (
        await db.execute(select(ReceiptMerchant).where(ReceiptMerchant.id == offer.merchant_id))
    ).scalar_one_or_none()
    if merchant is None or not claims_service.can_publish_offers(merchant.claim_status):
        raise HTTPException(409, "That shop cannot publish offers right now")
    if not offer.is_active or offer.starts_at > now or (offer.ends_at is not None and offer.ends_at <= now):
        raise HTTPException(409, "That deal is not running right now")
    if merchant.claim_status == "probationary":
        issued = await claims_service.vouchers_this_week(db, merchant, now)
        if issued >= settings.MERCHANT_CLAIM_WEEKLY_VOUCHER_CAP:
            raise HTTPException(
                409,
                f"This probationary shop has issued {settings.MERCHANT_CLAIM_WEEKLY_VOUCHER_CAP} "
                "vouchers this week. It can issue again next week.",
            )

    start_of_day = datetime.combine(now.date(), time.min)
    already = (
        await db.execute(
            select(ReceiptVoucher.id).where(
                ReceiptVoucher.offer_id == offer.id,
                ReceiptVoucher.vendor_id == vendor.id,
                ReceiptVoucher.issued_at >= start_of_day,
                ReceiptVoucher.status.in_(POINTS_STATUSES),
            )
        )
    ).first()
    if already is not None:
        raise HTTPException(409, "You already claimed this deal today")

    await _expire_vouchers(db, now, vendor.id)
    balance = await _points_balance(db, vendor.id, now)
    if offer.points_cost > balance["available"]:
        raise HTTPException(
            402,
            f"Not enough points. This voucher costs {offer.points_cost}; you have {balance['available']} available.",
        )

    expires_at = now + timedelta(days=VOUCHER_DAYS)
    if offer.ends_at is not None:
        expires_at = min(expires_at, offer.ends_at)
    # A three-character suffix has enough room for a counter, not for a global
    # namespace. Uniqueness only has to hold among the vouchers this one shop
    # can redeem, so a collision is resolved before the voucher exists.
    active = (
        await db.execute(
            select(ReceiptVoucher.id, ReceiptVoucher.code_seed).where(
                ReceiptVoucher.merchant_id == merchant.id,
                ReceiptVoucher.status == "issued",
                ReceiptVoucher.expires_at > now,
            )
        )
    ).all()
    taken = {voucher_code(row.id, row.code_seed) for row in active}
    voucher_id = uuid.uuid4()
    code_seed = secrets.token_hex(24)
    for _ in range(12):
        if voucher_code(voucher_id, code_seed) not in taken:
            break
        code_seed = secrets.token_hex(24)
    else:
        raise HTTPException(409, "Too many open vouchers at this shop. Use one before claiming another.")

    voucher = ReceiptVoucher(
        id=voucher_id,
        offer_id=offer.id,
        merchant_id=merchant.id,
        vendor_id=vendor.id,
        value_kes=offer.discount_kes,
        points_cost=offer.points_cost,
        code_seed=code_seed,
        status="issued",
        issued_at=now,
        expires_at=expires_at,
    )
    db.add(voucher)
    await db.commit()
    await db.refresh(voucher)
    return {
        "voucher": _voucher_out(voucher, merchant, now, customer=vendor),
        "balance": await _points_balance(db, vendor.id, now),
        "message": "Show the six characters at the counter. The code works without a signal.",
    }


@router.get("/vouchers")
async def my_vouchers(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    await _expire_vouchers(db, now, vendor.id)
    await db.commit()
    rows = (
        await db.execute(
            select(ReceiptVoucher, ReceiptMerchant)
            .join(ReceiptMerchant, ReceiptVoucher.merchant_id == ReceiptMerchant.id)
            .where(ReceiptVoucher.vendor_id == vendor.id)
            .order_by(ReceiptVoucher.issued_at.desc())
        )
    ).all()
    return {
        "vouchers": [_voucher_out(voucher, merchant, now, customer=vendor) for voucher, merchant in rows],
        "balance": await _points_balance(db, vendor.id, now),
    }


@router.get("/vouchers/{voucher_id}")
async def my_voucher(
    voucher_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    row = (
        await db.execute(
            select(ReceiptVoucher, ReceiptMerchant)
            .join(ReceiptMerchant, ReceiptVoucher.merchant_id == ReceiptMerchant.id)
            .where(ReceiptVoucher.id == voucher_id, ReceiptVoucher.vendor_id == vendor.id)
        )
    ).first()
    if row is None:
        raise HTTPException(404, "That voucher is not in your wallet")
    return _voucher_out(row[0], row[1], now, customer=vendor)


@router.post("/vouchers/{voucher_id}/cancel")
async def cancel_voucher(
    voucher_id: uuid.UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    voucher = (
        await db.execute(
            select(ReceiptVoucher).where(
                ReceiptVoucher.id == voucher_id, ReceiptVoucher.vendor_id == vendor.id,
            ).with_for_update()
        )
    ).scalar_one_or_none()
    if voucher is None:
        raise HTTPException(404, "That voucher is not in your wallet")
    if voucher.status != "issued":
        raise HTTPException(409, "Only an unused voucher can be cancelled")
    voucher.status = "cancelled"
    await db.commit()
    return {"cancelled": True, "balance": await _points_balance(db, vendor.id, datetime.utcnow())}


@router.post("/merchant/redeem")
async def redeem_voucher(
    body: RedeemIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The counter side: a verified, probationary or contested shop checks a code.

    A contest freezes new offers and new vouchers, but a customer already holding
    one must still be able to use it.
    """
    now = datetime.utcnow()
    merchants = [
        merchant for merchant in await _owned_merchants(db, vendor.id)
        if claims_service.can_redeem(merchant.claim_status)
    ]
    if not merchants:
        raise HTTPException(403, "Only the shop's current owner can check a voucher")
    merchant_ids = [merchant.id for merchant in merchants]

    statement = select(ReceiptVoucher).where(
        ReceiptVoucher.merchant_id.in_(merchant_ids),
        ReceiptVoucher.status == "issued",
        ReceiptVoucher.expires_at > now,
    )
    if body.voucher_id is not None:
        statement = statement.where(ReceiptVoucher.id == body.voucher_id)
    vouchers = (
        await db.execute(statement.with_for_update())
    ).scalars().all()

    matches = [
        voucher for voucher in vouchers
        if voucher_code_matches(voucher.id, voucher.code_seed, body.code)
    ]
    if not matches:
        raise HTTPException(400, "That code is not valid at this shop. Check the six characters on the customer's screen.")
    if len(matches) > 1:
        raise HTTPException(409, "That code matches more than one open voucher. Enter the voucher reference.")

    voucher = matches[0]
    merchant = next(merchant for merchant in merchants if merchant.id == voucher.merchant_id)
    customer = (
        await db.execute(select(Vendor).where(Vendor.id == voucher.vendor_id))
    ).scalar_one_or_none()
    voucher.status = "redeemed"
    voucher.redeemed_at = now
    voucher.redeemed_by_vendor_id = vendor.id
    # A redemption is the only real signal that a shop has customers. Check the
    # 14-day / 3-customer rule here so a finished probation promotes promptly.
    await _touch_claim_state(db, merchant, now)
    await db.commit()
    await db.refresh(voucher)
    return {
        "redeemed": True,
        "voucher": _voucher_out(voucher, merchant, now, customer=customer),
        "confirmation": _voucher_confirmation(voucher, merchant, customer),
        "message": f"KES {voucher.value_kes:,} off applied. Nothing was paid out in cash.",
    }


# --- operator review of claims ---------------------------------------------

@router.get("/ops/merchants")
async def ops_merchants(
    status: str = Query(
        "pending",
        pattern="^(pending|probationary|verified|contested|suspended|rejected|unclaimed)$",
    ),
    _operator: Vendor = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    merchants = (
        await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.claim_status == status)
            .order_by(ReceiptMerchant.claimed_at.desc().nullslast()).limit(200)
        )
    ).scalars().all()
    return {"merchants": [_merchant_out(merchant) for merchant in merchants]}


@router.post("/ops/merchants/{merchant_id}/verify")
async def verify_merchant(
    merchant_id: uuid.UUID,
    body: VerifyMerchantIn,
    _operator: Vendor = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    merchant = (
        await db.execute(select(ReceiptMerchant).where(ReceiptMerchant.id == merchant_id).with_for_update())
    ).scalar_one_or_none()
    if merchant is None:
        raise HTTPException(404, "That shop is not in the receipt network")
    if merchant.claim_status not in ("pending", "probationary", "contested", "suspended"):
        raise HTTPException(409, "Only an open claim can be reviewed")
    now = datetime.utcnow()
    merchant.claim_status = "verified" if body.approve else "rejected"
    merchant.verified_at = now if body.approve else None
    merchant.probation_until = None
    merchant.contest_deadline = None
    merchant.claim_path = "operator" if body.approve else merchant.claim_path
    merchant.claim_confidence = 100 if body.approve else merchant.claim_confidence
    merchant.claim_note = clean_text(body.note)[:1000] or merchant.claim_note
    await db.commit()
    await db.refresh(merchant)
    return {"merchant": _merchant_out(merchant)}


# --- anonymised regional insight -------------------------------------------

@router.get("/insights")
async def region_insights(
    region: str = Query(..., min_length=2, max_length=80),
    days: int = Query(30, ge=7, le=90),
    _viewer: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Aggregates only: no person, no receipt, no invoice leaves this endpoint.

    A cohort floor keeps a small region from being a lookup service for one
    person's shopping. Below it the answer is an explanation, not a number.
    """
    slug = clean_region(region)
    now = datetime.utcnow()
    since = now - timedelta(days=days)
    base = (
        select(Receipt.id, Receipt.merchant_id, Receipt.total, Receipt.scanned_at)
        .join(ReceiptMerchant, Receipt.merchant_id == ReceiptMerchant.id)
        .where(
            ReceiptMerchant.region == slug,
            Receipt.scanned_at >= since,
            Receipt.total > 0,
            Receipt.status != "manual",
        )
        .subquery()
    )

    cohort = (
        await db.execute(
            select(
                func.count(base.c.id),
                func.count(func.distinct(base.c.merchant_id)),
            ).select_from(base)
        )
    ).one()
    receipt_count, merchant_count = int(cohort[0] or 0), int(cohort[1] or 0)
    if receipt_count < INSIGHT_MIN_RECEIPTS or merchant_count < INSIGHT_MIN_MERCHANTS:
        return {
            "available": False,
            "region": slug,
            "days": days,
            "reason": "Not enough receipts in this region yet to aggregate without exposing anyone.",
            "cohort": {"receipts": receipt_count, "merchants": merchant_count},
            "minimum": {"receipts": INSIGHT_MIN_RECEIPTS, "merchants": INSIGHT_MIN_MERCHANTS},
        }

    stats = (
        await db.execute(
            select(
                func.count(base.c.id),
                func.count(func.distinct(base.c.merchant_id)),
                func.coalesce(func.sum(base.c.total), 0),
                func.avg(base.c.total),
                func.percentile_cont(0.5).within_group(base.c.total.asc()),
                func.count(base.c.id).filter(base.c.total < 200),
                func.count(base.c.id).filter(base.c.total >= 200, base.c.total < 500),
                func.count(base.c.id).filter(base.c.total >= 500, base.c.total < 1000),
                func.count(base.c.id).filter(base.c.total >= 1000, base.c.total < 2500),
                func.count(base.c.id).filter(base.c.total >= 2500),
            ).select_from(base)
        )
    ).one()

    hours = (
        await db.execute(
            select(func.extract("hour", base.c.scanned_at), func.count(base.c.id))
            .select_from(base)
            .group_by(func.extract("hour", base.c.scanned_at))
        )
    ).all()
    weekdays = (
        await db.execute(
            select(func.extract("isodow", base.c.scanned_at), func.count(base.c.id))
            .select_from(base)
            .group_by(func.extract("isodow", base.c.scanned_at))
        )
    ).all()
    top = (
        await db.execute(
            select(
                ReceiptMerchant.name,
                func.count(Receipt.id),
                func.coalesce(func.sum(Receipt.total), 0),
            )
            .join(ReceiptMerchant, Receipt.merchant_id == ReceiptMerchant.id)
            .where(
                ReceiptMerchant.region == slug,
                Receipt.scanned_at >= since,
                Receipt.total > 0,
                Receipt.status != "manual",
            )
            .group_by(ReceiptMerchant.id, ReceiptMerchant.name)
            .order_by(func.count(Receipt.id).desc())
            .limit(5)
        )
    ).all()

    return {
        "available": True,
        "region": slug,
        "days": days,
        "generated_at": _iso(now),
        "cohort": {"receipts": int(stats[0]), "merchants": int(stats[1])},
        "basket": {
            "spend_kes": int(stats[2] or 0),
            "average_kes": int(round(float(stats[3] or 0))),
            "median_kes": int(round(float(stats[4] or 0))),
            "bands": {
                "under_200": int(stats[5] or 0),
                "200_499": int(stats[6] or 0),
                "500_999": int(stats[7] or 0),
                "1000_2499": int(stats[8] or 0),
                "2500_plus": int(stats[9] or 0),
            },
        },
        "by_hour": {str(int(hour)): int(count) for hour, count in hours},
        "by_weekday": {str(int(day)): int(count) for day, count in weekdays},
        "top_merchants": [
            {"name": name, "receipts": int(count), "spend_kes": int(spend or 0)}
            for name, count, spend in top
        ],
        "line_items": False,
        "note": "Aggregated from receipts; no person or individual receipt is identifiable.",
    }

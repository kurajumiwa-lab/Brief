"""Receipt rewards API.

The shape of the product, in endpoint order:

  POST /api/receipts                    submit the raw QR; server parses and prices it
  GET  /api/receipts                    my ledger, my shops, my point balance
  GET  /api/receipts/insights           anonymised, cohort-gated region aggregates
  POST /api/receipts/merchants/{pin}/claim   a shopkeeper claims their shop
  GET  /api/receipts/offers             merchant-funded deals, public
  POST /api/receipts/offers/{id}/claim  spend points on a voucher
  GET  /api/receipts/vouchers           my vouchers, with the current four digits
  POST /api/receipts/merchant/redeem    the shopkeeper's phone checks the code

No endpoint moves money, and no endpoint claims KRA confirmed a receipt. The QR
is evidence the paper carried; freshness is computed server-side from the receipt
date and the server clock, not from a client's word.
"""

from __future__ import annotations

import hashlib
import math
import secrets
import uuid
from datetime import datetime, time, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.receipts import Receipt, ReceiptMerchant, ReceiptOffer, ReceiptVoucher
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.routes.ops import require_operator
from app.services.receipt_rewards import (
    clean_region, clean_text, is_valid_pin, parse_receipt_payload, receipt_key,
    receipt_value, voucher_code, voucher_code_matches,
)

router = APIRouter()

MAX_TOTAL_KES = 1_000_000
MAX_PAYLOAD = 4000
CODE_WINDOW_SECONDS = 60
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
    payload = {
        "id": str(merchant.id),
        "pin": merchant.pin,
        "name": merchant.name,
        "region": merchant.region,
        "claim_status": merchant.claim_status,
        "verified": merchant.claim_status == "verified",
    }
    if offers is not None:
        payload["offers"] = offers
    return payload


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


def _voucher_out(voucher: ReceiptVoucher, merchant: ReceiptMerchant | None, now: datetime) -> dict:
    code = None
    refresh_in = None
    if voucher.status == "issued" and voucher.expires_at > now:
        code = voucher_code(voucher.id, voucher.code_seed, now, CODE_WINDOW_SECONDS)
        refresh_in = CODE_WINDOW_SECONDS - int(now.timestamp()) % CODE_WINDOW_SECONDS
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
        "code": code,
        "code_refresh_in": refresh_in,
        "code_window_seconds": CODE_WINDOW_SECONDS,
    }


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
    code: str = Field(..., min_length=4, max_length=8)
    voucher_id: Optional[uuid.UUID] = None


class VerifyMerchantIn(BaseModel):
    approve: bool = True
    note: Optional[str] = Field(None, max_length=1000)


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
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "That receipt is already in the ledger. One receipt, one reward.")
    await db.refresh(receipt)
    balance = await _points_balance(db, vendor.id, now)
    return {
        "receipt": _receipt_out(receipt),
        "points_awarded": receipt.points,
        "balance": balance,
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


# --- public merchant discovery / offers -------------------------------------

@router.get("/merchants")
async def list_merchants(
    region: Optional[str] = Query(None, max_length=80),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    statement = select(ReceiptMerchant).where(ReceiptMerchant.claim_status == "verified")
    slug = clean_region(region)
    if slug:
        statement = statement.where(ReceiptMerchant.region == slug)
    merchants = (
        await db.execute(statement.order_by(ReceiptMerchant.name).limit(limit))
    ).scalars().all()
    return {"merchants": [_merchant_out(merchant) for merchant in merchants]}


@router.get("/merchants/me")
async def my_merchants(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"merchants": [_merchant_out(merchant) for merchant in await _owned_merchants(db, vendor.id)]}


@router.get("/merchants/{pin}")
async def merchant_card(pin: str, db: AsyncSession = Depends(get_db)):
    merchant = await _merchant_or_404(db, pin)
    now = datetime.utcnow()
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
    normalized = clean_text(pin).upper()
    if not is_valid_pin(normalized):
        raise HTTPException(422, "A shop PIN looks like P051234567X. Check the receipt.")
    merchant = await _merchant_or_404(db, normalized)
    if merchant.claim_status == "verified" and merchant.claimed_by_vendor_id != vendor.id:
        raise HTTPException(409, "That shop has already been claimed")
    if merchant.claim_status == "pending" and merchant.claimed_by_vendor_id != vendor.id:
        raise HTTPException(409, "Somebody has already applied to claim that shop")
    if merchant.claimed_by_vendor_id == vendor.id and merchant.claim_status == "verified":
        return {"merchant": _merchant_out(merchant), "message": "You already run this shop on the network"}

    merchant.claimed_by_vendor_id = vendor.id
    merchant.claim_status = "pending"
    merchant.claimed_at = datetime.utcnow()
    merchant.claim_note = clean_text(body.note)[:1000] or None
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
        "message": "Claim received. Offers and redemption unlock after review.",
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
    if merchant.claimed_by_vendor_id != vendor.id or merchant.claim_status != "verified":
        raise HTTPException(403, "Only the verified owner can edit this shop")
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
            ReceiptMerchant.claim_status == "verified",
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
    merchants = await _owned_merchants(db, vendor.id, verified_only=True)
    if not merchants:
        raise HTTPException(403, "Claim and verify your shop before publishing a deal")
    merchant = merchants[0]
    now = datetime.utcnow()
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
    if merchant.claim_status != "verified":
        raise HTTPException(403, "That shop is not verified yet")
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
    if merchant is None or merchant.claim_status != "verified":
        raise HTTPException(409, "That shop has not been verified for offers yet")
    if not offer.is_active or offer.starts_at > now or (offer.ends_at is not None and offer.ends_at <= now):
        raise HTTPException(409, "That deal is not running right now")

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
    voucher = ReceiptVoucher(
        offer_id=offer.id,
        merchant_id=merchant.id,
        vendor_id=vendor.id,
        value_kes=offer.discount_kes,
        points_cost=offer.points_cost,
        code_seed=secrets.token_hex(24),
        status="issued",
        issued_at=now,
        expires_at=expires_at,
    )
    db.add(voucher)
    await db.commit()
    await db.refresh(voucher)
    return {
        "voucher": _voucher_out(voucher, merchant, now),
        "balance": await _points_balance(db, vendor.id, now),
        "message": "Show the four digits at the counter. They change every minute.",
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
        "vouchers": [_voucher_out(voucher, merchant, now) for voucher, merchant in rows],
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
    return _voucher_out(row[0], row[1], now)


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
    """The counter side: a verified shop checks the code and marks it used."""
    now = datetime.utcnow()
    merchants = await _owned_merchants(db, vendor.id, verified_only=True)
    if not merchants:
        raise HTTPException(403, "Only a verified shop can check a voucher")
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
        if voucher_code_matches(voucher.id, voucher.code_seed, body.code, now, CODE_WINDOW_SECONDS)
    ]
    if not matches:
        raise HTTPException(400, "That code is not valid at this minute. Ask for the current four digits.")
    if len(matches) > 1:
        raise HTTPException(409, "That code matches more than one voucher. Enter the voucher reference.")

    voucher = matches[0]
    merchant = next(merchant for merchant in merchants if merchant.id == voucher.merchant_id)
    voucher.status = "redeemed"
    voucher.redeemed_at = now
    voucher.redeemed_by_vendor_id = vendor.id
    await db.commit()
    await db.refresh(voucher)
    return {
        "redeemed": True,
        "voucher": _voucher_out(voucher, merchant, now),
        "message": f"{voucher.value_kes} KES off applied. Nothing was paid out in cash.",
    }


# --- operator review of claims ---------------------------------------------

@router.get("/ops/merchants")
async def ops_merchants(
    status: str = Query("pending", pattern="^(pending|verified|rejected|unclaimed)$"),
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
    if merchant.claim_status != "pending":
        raise HTTPException(409, "Only a pending claim can be reviewed")
    merchant.claim_status = "verified" if body.approve else "rejected"
    merchant.verified_at = datetime.utcnow() if body.approve else None
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

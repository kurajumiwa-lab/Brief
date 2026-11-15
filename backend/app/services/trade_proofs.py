"""Receipt → a trade both sides confirmed.

A scanned receipt is one side of a trade. The buyer has the paper; the seller
has the till. Until the shop says "yes, that was mine" the row is a question,
not a completed trade. This module answers three questions and nothing else:

  · which Home Office account, if any, is the shop on this receipt?
  · how does a confirmed purchase become a fact on both profiles?
  · how does the other side hear about it?

No money moves, and no stock movement is created. The counter lives separately
from `movements_completed`, which is recomputed from `stock_movements`.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import NotificationType
from app.models.receipts import Receipt, ReceiptMerchant, TradeProof
from app.models.vendor import Vendor, VendorProfile
from app.services.notification_service import create_notification


def normalize_name(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _normalize_pin(value: object) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


async def match_seller(
    db: AsyncSession,
    *,
    pin: str | None,
    merchant_name: str | None,
    merchant: ReceiptMerchant | None,
    buyer_vendor_id: UUID,
) -> Optional[Vendor]:
    """Find the Home Office account behind the shop on the receipt.

    Order of evidence, strongest first:

      1. a verified merchant record already bound to a vendor account;
      2. the KRA PIN matching the vendor's own tax id;
      3. the printed business name matching exactly after punctuation is removed.

    A name match must be unique. Guessing between two similarly named shops
    would put a confirmation request in the wrong inbox, and a wrong trade is
    worse than an unmatched one. The buyer is never the seller.
    """
    if merchant is not None and merchant.claim_status == "verified" and merchant.claimed_by_vendor_id:
        if merchant.claimed_by_vendor_id != buyer_vendor_id:
            seller = await db.get(Vendor, merchant.claimed_by_vendor_id)
            if seller is not None:
                return seller

    normalized_pin = _normalize_pin(pin)
    if normalized_pin:
        rows = (
            await db.execute(
                select(Vendor)
                .join(VendorProfile, VendorProfile.vendor_id == Vendor.id)
                .where(
                    func.upper(func.replace(VendorProfile.tax_id, " ", "")) == normalized_pin,
                    Vendor.id != buyer_vendor_id,
                )
                .limit(2)
            )
        ).scalars().all()
        if len(rows) == 1:
            return rows[0]

    normalized_name = normalize_name(merchant_name)
    if normalized_name:
        rows = (
            await db.execute(
                select(Vendor)
                .where(
                    Vendor.id != buyer_vendor_id,
                    func.regexp_replace(func.lower(Vendor.business_name), "[^a-z0-9]", "", "g")
                    == normalized_name,
                )
                .limit(2)
            )
        ).scalars().all()
        if len(rows) == 1:
            return rows[0]

    return None


async def create_for_receipt(
    db: AsyncSession,
    *,
    receipt: Receipt,
    buyer: Vendor,
    merchant: ReceiptMerchant | None,
) -> Optional[TradeProof]:
    """Create the pending proof (or an unmatched one) for a scanned receipt.

    Called inside the receipt's transaction. A manual record never creates a
    proof: it has no QR evidence, and a typed row must not manufacture a trade.
    """
    if receipt.source == "manual":
        return None

    seller = await match_seller(
        db,
        pin=receipt.merchant_pin,
        merchant_name=receipt.merchant_name,
        merchant=merchant,
        buyer_vendor_id=buyer.id,
    )
    proof = TradeProof(
        receipt_id=receipt.id,
        buyer_vendor_id=buyer.id,
        seller_vendor_id=seller.id if seller else None,
        merchant_pin=receipt.merchant_pin,
        merchant_name=receipt.merchant_name,
        amount=receipt.total,
        status="pending" if seller else "unmatched",
    )
    db.add(proof)
    await db.flush()

    if seller is not None:
        await create_notification(
            db,
            recipient_id=seller.id,
            notification_type=NotificationType.TRADE_PROOF_REQUEST,
            title=f"Confirm a trade at {receipt.merchant_name}",
            body=(
                f"{buyer.business_name} scanned a receipt for KES {receipt.total:,}. "
                "Confirm it was your shop to make it a completed trade for both of you."
            ),
            sender_id=buyer.id,
            data={
                "trade_proof_id": proof.id,
                "receipt_id": receipt.id,
                "buyer_handle": buyer.vendor_handle,
                "amount": receipt.total,
                "merchant_name": receipt.merchant_name,
            },
        )
    return proof


async def confirm(
    db: AsyncSession,
    *,
    proof: TradeProof,
    seller: Vendor,
    buyer: Vendor,
) -> TradeProof:
    """Both sides now agree. Credit each profile exactly once."""
    proof.status = "confirmed"
    proof.confirmed_at = datetime.utcnow()
    await db.execute(
        update(Vendor)
        .where(Vendor.id.in_({proof.buyer_vendor_id, seller.id}))
        .values(confirmed_trade_proofs=Vendor.confirmed_trade_proofs + 1)
    )
    await create_notification(
        db,
        recipient_id=buyer.id,
        notification_type=NotificationType.TRADE_PROOF_CONFIRMED,
        title=f"{seller.business_name} confirmed your trade",
        body=(
            f"KES {proof.amount:,} at {proof.merchant_name} is now a completed trade. "
            "It counts towards Trading level for both of you."
        ),
        sender_id=seller.id,
        data={
            "trade_proof_id": proof.id,
            "receipt_id": proof.receipt_id,
            "seller_handle": seller.vendor_handle,
        },
    )
    return proof


async def dispute(
    db: AsyncSession,
    *,
    proof: TradeProof,
    seller: Vendor,
    buyer: Vendor,
    reason: str,
) -> TradeProof:
    proof.status = "disputed"
    proof.disputed_at = datetime.utcnow()
    proof.dispute_reason = reason[:1000]
    await create_notification(
        db,
        recipient_id=buyer.id,
        notification_type=NotificationType.TRADE_PROOF_DISPUTED,
        title=f"{seller.business_name} questioned a receipt",
        body=reason[:500],
        sender_id=seller.id,
        data={"trade_proof_id": proof.id, "receipt_id": proof.receipt_id},
    )
    return proof


async def seller_for(db: AsyncSession, proof: TradeProof) -> Optional[Vendor]:
    if proof.seller_vendor_id is None:
        return None
    return await db.get(Vendor, proof.seller_vendor_id)


async def buyer_for(db: AsyncSession, proof: TradeProof) -> Optional[Vendor]:
    return await db.get(Vendor, proof.buyer_vendor_id)


async def proofs_for(
    db: AsyncSession, vendor_id: UUID, *, status: str | None = None, limit: int = 100,
) -> list[TradeProof]:
    statement = select(TradeProof).where(
        or_(
            TradeProof.buyer_vendor_id == vendor_id,
            TradeProof.seller_vendor_id == vendor_id,
        )
    )
    if status:
        statement = statement.where(TradeProof.status == status)
    return list(
        (await db.execute(statement.order_by(TradeProof.created_at.desc()).limit(limit))).scalars().all()
    )

"""Receipt capture with OCR line items and merchant-funded priority rewards.

The existing receipt route remains the QR/manual entry point. This service adds
what the town layer needs without changing its rules:

  · a photo can be read into items (description, quantity, unit price, total);
  · the 15-minute window is surfaced explicitly and gets the merchant's bonus;
  · rewards are funded from the shop's prepaid credit, never minted;
  · duplicate, altered, expired and self-dealt receipts are flagged or refused.

An OCR line is evidence, not a fact. Every item keeps its confidence, and the
receipt records that the numbers came from a photograph or pasted text.
"""

from __future__ import annotations

import hashlib
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.receipts import Receipt, ReceiptMerchant
from app.models.vendor import Vendor
from app.modules.town import credits as credit_service
from app.modules.town.audit import audit
from app.modules.town.errors import CommerceError
from app.modules.town.models import MerchantRewardPolicy, ReceiptItem
from app.services.receipt_rewards import (
    clean_region, clean_text, is_valid_pin, parse_amount, parse_date,
    parse_receipt_payload, receipt_key, receipt_value,
)

MAX_TOTAL_KES = 1_000_000
MAX_ITEMS = 60
PRIORITY_MINUTES = 15
DEFAULT_RATE = 2
DEFAULT_CAP = 500

TOTAL_WORDS = ("total", "amount due", "grand total", "balance due", "net total")
SUBTOTAL_WORDS = ("subtotal", "sub total", "vat", "tax", "change", "cash", "card", "tender")
SKIP_MERCHANT_WORDS = (
    "kra", "pin", "invoice", "receipt", "total", "subtotal", "tax", "vat", "cash",
    "change", "card", "date", "time", "tel", "phone", "www", "thank", "welcome",
)
DATE_RE = re.compile(
    r"(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?"
    r"|\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)"
)
INVOICE_RE = re.compile(
    r"\b((?:INV|RCP|BILL)[-:/][A-Z0-9][A-Z0-9/_-]{1,40})\b"
    r"|(?:invoice|inv|receipt|bill|control|cuin|ti)\s*(?:no\.?|number|#|:|-)?\s*"
    r"([A-Z0-9][A-Z0-9/_-]{2,40})",
    re.I,
)
PIN_RE = re.compile(r"\b([AP]\d{9}[A-Z])\b", re.I)
MONEY_RE = re.compile(r"(?:kes|ksh|shs?)?\s*([\d][\d,]*(?:\.\d{1,2})?)\s*(?:kes|ksh|shs?)?", re.I)
QTY_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(?:x|@|\*)\s*", re.I)


def _decimal(value: Any, default: str = "0") -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def _money_lines(lines: Iterable[str]) -> list[float]:
    found: list[float] = []
    for line in lines:
        for match in MONEY_RE.finditer(line):
            amount = parse_amount(match.group(1))
            if amount is not None:
                found.append(float(amount))
    return found


def _item_from_line(line: str) -> dict[str, Any] | None:
    """Read one receipt line only when it ends in prices.

    Scanning from the right avoids treating a pack size ("500mg", "2kg") as a
    quantity or a price. The final number is the line total; the number before
    it is the unit price when there are two.
    """
    low = line.lower()
    if any(word in low for word in (
        "total", "subtotal", "sub total", "tax", "vat", "change", "cash", "card",
        "tender", "balance", "rounding", "pin", "invoice", "receipt no", "date",
        "tel", "phone", "thank", "welcome", "loyalty", "points", "discount",
    )):
        return None
    tokens = line.split()
    price_indexes: list[int] = []
    for index in range(len(tokens) - 1, -1, -1):
        token = tokens[index].strip(".,;:")
        token = re.sub(r"(?i)^(kes|ksh|shs?)(?=\d)", "", token)
        token = re.sub(r"(?i)(kes|ksh|shs?)$", "", token)
        if re.fullmatch(r"\d[\d,]*(?:\.\d{1,2})?", token):
            price_indexes.insert(0, index)
            continue
        if price_indexes:
            break
    if not price_indexes:
        return None
    prices = [parse_amount(tokens[i].strip(".,;:")) for i in price_indexes]
    prices = [int(p) for p in prices if p is not None and p > 0]
    if not prices:
        return None
    total_price = prices[-1]
    unit_price = prices[0] if len(prices) >= 2 else total_price
    if total_price <= 0 or total_price > MAX_TOTAL_KES:
        return None
    prefix = " ".join(tokens[:price_indexes[0]])
    qty = Decimal("1")
    qty_match = re.search(r"(\d+(?:\.\d+)?)\s*[xX@*]\s*$", prefix)
    if qty_match:
        qty = _decimal(qty_match.group(1), "1")
        prefix = prefix[:qty_match.start()].strip(" .:-|")
    elif len(prices) >= 2 and unit_price > 0 and total_price > unit_price:
        candidate = Decimal(total_price) / Decimal(unit_price)
        if candidate == candidate.to_integral_value() and candidate <= 10000:
            qty = candidate
    if qty <= 0 or qty > 10000:
        qty = Decimal("1")
    description = " ".join(prefix.split()).strip(" .:-|")
    if len(re.sub(r"[^A-Za-z]", "", description)) < 2:
        return None
    if len(prices) < 2:
        unit_price = int(round(total_price / float(qty)))
    confidence = 78
    if len(description) < 4:
        confidence -= 20
    if qty_match:
        confidence += 4
    if len(prices) >= 2:
        confidence += 6
    return {
        "description": description[:200] or "Item",
        "quantity": float(qty),
        "unit_price_kes": max(0, int(round(unit_price))),
        "total_price_kes": total_price,
        "confidence": max(0, min(100, confidence)),
    }


def parse_ocr_lines(lines: Iterable[str], *, engine: str | None = None) -> dict[str, Any]:
    """Read a receipt's text into fields and line items.

    This is intentionally conservative. A line becomes an item only when it has
    a description and a trailing price. The total is taken from a line that says
    TOTAL, not from the largest number on the page (which is often a phone
    number or a loyalty balance).
    """
    cleaned: list[str] = []
    for raw in lines or []:
        line = " ".join(str(raw or "").split())
        if line:
            cleaned.append(line[:240])
    text = "\n".join(cleaned)

    pin = ""
    pin_match = PIN_RE.search(text)
    if pin_match:
        pin = pin_match.group(1).upper()

    invoice = ""
    invoice_match = INVOICE_RE.search(text)
    if invoice_match:
        candidate = (invoice_match.group(1) or invoice_match.group(2) or "").strip(" .:-")
        if candidate and not re.fullmatch(r"\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}", candidate):
            invoice = candidate[:100]

    date_match = DATE_RE.search(text)
    issued_at = parse_date(date_match.group(1)) if date_match else None

    total = None
    tax = None
    for line in cleaned:
        low = line.lower()
        if any(word in low for word in TOTAL_WORDS) and not any(word in low for word in SUBTOTAL_WORDS[:2]):
            amounts = _money_lines([line])
            if amounts:
                total = int(round(amounts[-1]))
        if ("tax" in low or "vat" in low) and tax is None:
            amounts = _money_lines([line])
            if amounts:
                tax = int(round(amounts[-1]))
    if total is None:
        # A receipt without the word TOTAL still often ends with a paid amount.
        for line in reversed(cleaned):
            if any(word in line.lower() for word in ("paid", "payment", "amount")):
                amounts = _money_lines([line])
                if amounts:
                    total = int(round(amounts[-1]))
                    break

    merchant = ""
    for line in cleaned[:10]:
        letters = re.sub(r"[^A-Za-z]", "", line)
        if len(letters) < 3:
            continue
        low = line.lower()
        if any(word in low for word in SKIP_MERCHANT_WORDS):
            continue
        if MONEY_RE.search(line) and len(letters) < 6:
            continue
        merchant = line[:200]
        break

    items: list[dict[str, Any]] = []
    for line in cleaned:
        parsed_item = _item_from_line(line)
        if parsed_item is None:
            continue
        items.append(parsed_item)
        if len(items) >= MAX_ITEMS:
            break

    items_total = sum(item["total_price_kes"] for item in items)
    warnings: list[str] = []
    if not total:
        warnings.append("No TOTAL line was read. Enter the amount printed on the receipt.")
    if not items:
        warnings.append("No item lines were read. Add them by hand if the paper is faded.")
    if items_total and total and abs(items_total - total) > max(50, int(total * 0.08)):
        warnings.append("The item lines do not add up to the printed total.")

    return {
        "merchant_name": merchant,
        "merchant_pin": pin,
        "invoice_no": invoice,
        "issued_at": issued_at.isoformat() if issued_at else None,
        "total_kes": total,
        "tax_kes": tax,
        "items": items,
        "items_total_kes": items_total,
        "confidence": int(round(sum(i["confidence"] for i in items) / len(items))) if items else 0,
        "engine": engine or "text",
        "warnings": warnings,
        "line_count": len(cleaned),
        "raw_preview": text[:400],
    }


async def _merchant_for(
    db: AsyncSession, *, pin: str, name: str, region: str | None,
) -> ReceiptMerchant | None:
    if not is_valid_pin(pin):
        return None
    merchant = (
        await db.execute(
            select(ReceiptMerchant).where(ReceiptMerchant.pin == pin).with_for_update()
        )
    ).scalar_one_or_none()
    if merchant is None:
        merchant = ReceiptMerchant(
            pin=pin,
            name=(name or f"Merchant {pin[-4:]}")[:200],
            region=clean_region(region),
            claim_status="unclaimed",
        )
        db.add(merchant)
        await db.flush()
        return merchant
    if merchant.claim_status != "verified":
        if name and merchant.name.startswith("Merchant "):
            merchant.name = name[:200]
        if region and not merchant.region:
            merchant.region = clean_region(region)
    return merchant


async def _policy_for(db: AsyncSession, merchant_id) -> MerchantRewardPolicy:
    policy = (
        await db.execute(
            select(MerchantRewardPolicy).where(MerchantRewardPolicy.merchant_id == merchant_id)
        )
    ).scalar_one_or_none()
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


def _dedupe_for(
    parsed: dict[str, Any], *, source: str, vendor_id, merchant_name: str,
) -> str:
    key = receipt_key(parsed)
    if key:
        return key
    invoice = clean_text(parsed.get("invoice"))
    if invoice:
        return f"invoice:{clean_text(parsed.get('pin')) or clean_text(merchant_name) or 'nopin'}:{invoice}"
    url = clean_text(parsed.get("verification_url"))
    if url:
        return f"url:{url}"
    if source == "manual":
        return f"manual:{vendor_id}:{uuid.uuid4()}"
    # A photo or pasted text with no invoice number cannot be deduplicated
    # safely without blocking two genuinely different purchases. Keep it unique
    # and flag the near-duplicate instead.
    return f"{source}:{vendor_id}:{uuid.uuid4()}"


def _is_priority(issued_at: datetime | None, scanned_at: datetime) -> bool:
    if issued_at is None:
        return False
    age = (scanned_at - issued_at).total_seconds() / 60
    return 0 <= age <= PRIORITY_MINUTES


async def capture(
    db: AsyncSession,
    *,
    vendor: Vendor,
    payload: str | None = None,
    source: str = "photo",
    merchant_name: str | None = None,
    merchant_pin: str | None = None,
    invoice_no: str | None = None,
    total_kes: int | None = None,
    tax_kes: int | None = None,
    issued_at: datetime | None = None,
    region: str | None = None,
    photo_url: str | None = None,
    ocr_engine: str | None = None,
    items: list[dict[str, Any]] | None = None,
    consent: bool = False,
    extraction: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create one receipt from a photo draft or QR payload.

    The caller must already have established that the photo uploader consented
    to storing the image. Without consent, `photo_url` is dropped, while the OCR
    text may still be used because it is not a photograph of a person.
    """
    now = datetime.utcnow()
    source = (source or "photo").strip().lower()
    if source not in ("photo", "text", "qr", "manual"):
        raise CommerceError("Use a photo, pasted text, QR payload or manual record.", 422)

    parsed: dict[str, Any] = {
        "pin": clean_text(merchant_pin).upper(),
        "invoice": clean_text(invoice_no),
        "merchant": clean_text(merchant_name),
        "total": int(total_kes) if total_kes is not None else None,
        "tax": int(tax_kes) if tax_kes is not None else None,
        "issued_at": issued_at,
        "token": "",
        "verification_url": None,
        "verified": False,
    }

    if clean_text(payload):
        result = parse_receipt_payload(payload)
        if not result.get("ok"):
            raise CommerceError(result.get("error") or "That QR code is not a receipt.", 422)
        qr = result["receipt"]
        if parsed["total"] and qr.get("total") and int(parsed["total"]) != int(qr["total"]):
            raise CommerceError("The total on the code does not match the total on the receipt.", 422)
        for field in ("pin", "invoice", "merchant", "total", "tax", "issued_at", "token",
                      "verification_url", "verified"):
            if parsed.get(field) in (None, "") and qr.get(field) not in (None, ""):
                parsed[field] = qr[field]
        source = "qr"

    total = int(parsed.get("total") or 0)
    if total <= 0:
        raise CommerceError("Enter the amount actually paid.", 422)
    if total > MAX_TOTAL_KES:
        raise CommerceError("That total is above the receipt limit.", 422)
    issued = parsed.get("issued_at")
    if issued is not None and getattr(issued, "tzinfo", None) is not None:
        issued = issued.astimezone(timezone.utc).replace(tzinfo=None)
        parsed["issued_at"] = issued
    if issued is not None and issued > now + timedelta(minutes=5):
        raise CommerceError("That receipt is dated in the future. Check the date on the paper.", 422)

    merchant = await _merchant_for(
        db, pin=parsed.get("pin") or "", name=parsed.get("merchant") or "",
        region=region,
    )
    display_name = (
        merchant.name if merchant is not None
        else (clean_text(parsed.get("merchant")) or "Local merchant")
    )[:200]
    region_final = clean_region((merchant.region if merchant is not None else None) or region)

    status = "manual" if source == "manual" else (
        "verified" if (is_valid_pin(parsed.get("pin")) and parsed.get("invoice") and total)
        else "partial"
    )

    previous = (await db.execute(
        select(Receipt)
        .where(
            Receipt.vendor_id == vendor.id,
            Receipt.total == total,
            Receipt.scanned_at >= now - timedelta(hours=24),
            Receipt.merchant_name == display_name,
        )
        .limit(1)
    )).scalar_one_or_none()
    key = _dedupe_for(parsed, source=source, vendor_id=vendor.id, merchant_name=display_name)
    duplicate = (await db.execute(
        select(Receipt.id).where(Receipt.dedupe_key == key)
    )).scalar_one_or_none()
    if duplicate is not None:
        raise CommerceError("That receipt is already in the ledger. One receipt, one reward.", 409)

    clean_items: list[dict[str, Any]] = []
    for index, item in enumerate(items or [], start=1):
        description = " ".join(str(item.get("description") or "").split())[:200]
        qty = _decimal(item.get("quantity"), "1")
        unit = int(item.get("unit_price_kes") or 0)
        line_total = int(item.get("total_price_kes") or 0)
        if not description or qty <= 0 or line_total < 0:
            continue
        clean_items.append({
            "line_no": len(clean_items) + 1,
            "description": description,
            "quantity": float(qty),
            "unit_price_kes": max(0, unit),
            "total_price_kes": max(0, line_total),
            "confidence": max(0, min(100, int(item.get("confidence") or 0))),
        })
        if len(clean_items) >= MAX_ITEMS:
            break

    items_total = sum(item["total_price_kes"] for item in clean_items)
    # Kenyan receipts usually print line items exclusive of VAT and a total that
    # includes it. Compare like with like; a missing tax line is a read failure,
    # not proof of tampering, so only impossible arithmetic blocks the reward.
    tax_parsed = int(parsed.get("tax") or 0)
    items_target = total - tax_parsed if 0 < tax_parsed < total * 0.35 else total
    items_tolerance = max(50, int(items_target * 0.08))
    items_mismatch = bool(items_total) and abs(items_total - items_target) > items_tolerance
    items_impossible = bool(items_total) and (
        items_total > total + items_tolerance or items_total < total * 0.5
    )
    value = receipt_value(total, issued, now)
    priority = _is_priority(issued, now)

    policy = await _policy_for(db, merchant.id) if merchant is not None else None
    rate = int(policy.points_per_100_kes) if policy is not None else DEFAULT_RATE
    cap = int(policy.max_points_per_receipt) if policy is not None else DEFAULT_CAP
    base = int(math.floor(total * rate / 100.0))
    calculated = int(math.floor(base * float(value["multiplier"]) + 0.5))
    if priority and policy is not None and int(policy.priority_bonus_pct or 0) > 0:
        calculated += int(math.floor(calculated * int(policy.priority_bonus_pct) / 100))

    flags: list[str] = []
    if issued is None:
        flags.append("undated")
    if value["freshness"] == "expired":
        flags.append("expired")
    if priority:
        flags.append("priority_15_min")
    if source != "qr" and not parsed.get("pin"):
        flags.append("no_merchant_pin")
    if previous is not None:
        flags.append("possible_duplicate")
    if items_mismatch:
        flags.append("item_total_mismatch")
    if clean_items:
        avg_conf = sum(item["confidence"] for item in clean_items) / len(clean_items)
        if avg_conf < 50:
            flags.append("low_ocr_confidence")
    if merchant is not None and merchant.claimed_by_vendor_id == vendor.id:
        flags.append("self_receipt")
    if source == "manual":
        flags.append("manual_record")
    if source == "text":
        flags.append("ocr_text")

    blocked = {"self_receipt", "expired"}
    if items_impossible:
        blocked.add("item_total_mismatch")
    points = 0 if (source == "manual" or blocked.intersection(flags)) else max(0, min(cap, calculated))

    receipt_id = uuid.uuid4()
    funded = 0
    if points > 0 and merchant is not None:
        funded = await credit_service.spend(
            db,
            merchant_id=merchant.id,
            amount_kes=points,
            idempotency_key=f"receipt:{receipt_id}",
            reference_type="receipt",
            reference_id=receipt_id,
            note="Priority receipt reward funded from prepaid credit." if priority else "Receipt reward funded from prepaid credit.",
        )
    # A reward is only redeemable when a shop actually funded it. The calculated
    # amount stays in `extraction` so the merchant dashboard can show the gap.
    awarded = funded if source != "manual" else 0

    if photo_url and not consent:
        photo_url = None
    extraction_out = {
        **(extraction or {}),
        "source": source,
        "ocr_engine": ocr_engine,
        "items_total_kes": items_total or None,
        "priority_window_minutes": PRIORITY_MINUTES,
        "priority": priority,
        "calculated_points": calculated,
        "funded_points": funded,
        "unfunded_points": max(0, calculated - funded),
        "reward_rate_points_per_100_kes": rate,
        "reward_cap": cap,
        "photo_consent": bool(consent),
    }

    receipt = Receipt(
        id=receipt_id,
        vendor_id=vendor.id,
        merchant_id=merchant.id if merchant is not None else None,
        merchant_pin=(parsed.get("pin") or None),
        merchant_name=display_name,
        invoice_no=(parsed.get("invoice") or None),
        total=total,
        tax=int(parsed.get("tax") or 0) or None,
        issued_at=issued,
        scanned_at=now,
        source=source,
        status=status,
        freshness_key=value["freshness"],
        base_points=base,
        points=awarded,
        token=(parsed.get("token") or None),
        verification_url=(parsed.get("verification_url") or None),
        raw_payload=(clean_text(payload)[:4000] or None),
        dedupe_key=key,
        region=region_final,
        photo_url=photo_url,
        ocr_engine=ocr_engine,
        extraction=extraction_out,
        items_total_kes=items_total or None,
        fraud_flags=flags,
        reward_funded_kes=awarded,
    )
    db.add(receipt)
    for item in clean_items:
        db.add(ReceiptItem(receipt_id=receipt_id, **item))
    audit(
        db, action="receipt_captured", entity_type="receipt", entity_id=receipt_id,
        actor_vendor_id=vendor.id,
        payload={
            "source": source, "status": status, "total_kes": total,
            "points": awarded, "calculated_points": calculated,
            "merchant_id": merchant.id if merchant is not None else None,
            "flags": ",".join(flags),
        },
    )
    await db.flush()
    await db.commit()
    await db.refresh(receipt)

    # The trade proof and referral qualification run after the receipt is safe.
    # A failing side engine must never discard a valid receipt.
    referral = None
    try:
        if merchant is not None and source != "manual":
            from app.services import trade_proofs as trade_proof_service

            await trade_proof_service.create_for_receipt(
                db, receipt=receipt, buyer=vendor, merchant=merchant,
            )
            from app.modules.referrals import service as referral_service

            referral = await referral_service.qualify_verified_receipt(
                db, receipt=receipt, buyer=vendor,
            )
            await db.commit()
    except Exception:  # pragma: no cover - defensive side-engine isolation
        await db.rollback()

    return {
        "receipt": receipt,
        "points_awarded": awarded,
        "calculated_points": calculated,
        "funded_points": funded,
        "unfunded_points": max(0, calculated - funded),
        "fraud_flags": flags,
        "priority": priority,
        "freshness": value["freshness"],
        "items": clean_items,
        "referral": referral,
        "note": (
            "Points are redeemable only when a merchant prepaid credit. "
            "The calculated amount is shown separately so nothing is promised that is not funded."
        ),
    }

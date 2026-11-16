"""The merchant claim engine.

A shop is a public KRA PIN on a piece of paper. Claiming it is not the same as
proving ownership, so this module keeps three honest states apart:

  pending       claimed, waiting for evidence or a person
  probationary  a fresh challenge sale answered; capped operations unlocked
  verified      a high-trust proof or 14 days of real redemptions

A challenge sale is **presence evidence**: the claimant rang a specific amount
at the shop's till inside a short window. It does not verify KRA's signature and
must never be called cryptographic proof-of-possession. The server only moves a
shop to `probationary`; `verified` waits for the authority adapter or the
trading-history rule.

No raw SMS is stored here. Receipt evidence is reduced to a hash, the amount,
the invoice suffix and the verification host.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.receipts import Receipt, ReceiptMerchant, ReceiptOffer, ReceiptVoucher, TradeProof
from app.models.vendor import Vendor
from app.services.receipt_rewards import (
    clean_region, clean_text, parse_date, parse_receipt_payload, receipt_key,
)

CHALLENGE_MIN_KES = 1
CHALLENGE_MAX_KES = 99
CHALLENGE_GRACE_SECONDS = 120

#: A merchant's receipt region is a corridor slug; a vendor's location is free
#: text ("Kondele, Kisumu"). Map the common towns before comparing, so a real
#: neighbour is not refused a vouch because the two fields use different shapes.
REGION_TOWNS = {
    "nairobi-metro": {
        "nairobi", "kiambu", "machakos", "kajiado", "thika", "ruiru", "westlands",
        "cbd", "gikomba", "marikiti", "wakulima",
    },
    "coast": {
        "mombasa", "kilifi", "malindi", "watamu", "diani", "lamu", "taita", "taveta",
        "kongowea",
    },
    "nyanza": {
        "kisumu", "kisii", "siaya", "homa-bay", "migori", "bondo", "ahero", "kibuye",
        "kondele",
    },
    "western": {
        "kakamega", "bungoma", "busia", "webuye", "vihiga", "kisumu-road",
    },
    "rift-valley": {
        "nakuru", "eldoret", "kericho", "naivasha", "kitale", "narok", "bomet",
    },
    "central": {
        "nyeri", "thika", "muranga", "karatina", "nyahururu", "kirinyaga", "kerugoya",
    },
    "eastern": {
        "machakos", "meru", "embu", "kitui", "makueni", "wote", "isiolo",
    },
    "north-eastern": {"garissa", "wajir", "mandera", "dadaab"},
    "kampala": {"kampala", "entebbe", "mukono", "jinja", "wakiso", "masaka"},
}


def corridor(value: Any) -> str:
    slug = clean_region(value)
    if not slug:
        return ""
    for region, towns in REGION_TOWNS.items():
        if slug == region or slug.startswith(f"{region}-") or region in slug:
            return region
        if any(town in slug.split("-") for town in towns):
            return region
    return slug


STATUS_LABELS = {
    "unclaimed": "Not claimed",
    "pending": "Claim under review",
    "probationary": "Probationary owner",
    "verified": "Verified owner",
    "contested": "Ownership contested",
    "suspended": "Suspended",
    "rejected": "Not confirmed",
}


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def status_label(status: str) -> str:
    return STATUS_LABELS.get(status, "Claim under review")


def can_redeem(status: str) -> bool:
    """A contest freezes new offers, but already-issued vouchers stay usable."""
    return status in ("verified", "probationary", "contested")


def can_publish_offers(status: str) -> bool:
    return status in ("verified", "probationary")


def can_confirm_trade_proofs(status: str) -> bool:
    return status == "verified"


def capabilities(status: str) -> dict:
    return {
        "can_redeem": can_redeem(status),
        "can_publish_offers": can_publish_offers(status),
        "can_confirm_trade_proofs": can_confirm_trade_proofs(status),
        "active_offer_cap": (
            settings.MERCHANT_CLAIM_ACTIVE_OFFER_CAP
            if status == "probationary" else None
        ),
        "weekly_voucher_cap": (
            settings.MERCHANT_CLAIM_WEEKLY_VOUCHER_CAP
            if status == "probationary" else None
        ),
    }


def _evidence(merchant: ReceiptMerchant) -> dict:
    value = merchant.claim_evidence
    return dict(value) if isinstance(value, dict) else {}


def _save_evidence(merchant: ReceiptMerchant, evidence: dict) -> None:
    # Reassign the whole document so SQLAlchemy sees the JSONB change.
    merchant.claim_evidence = evidence


def _challenge_window(now: datetime) -> datetime:
    return now + timedelta(minutes=max(1, settings.MERCHANT_CLAIM_CHALLENGE_MINUTES))


def issue_challenge(merchant: ReceiptMerchant, now: datetime) -> dict:
    """Return one live challenge, or issue a fresh random amount.

    Repeating the call while a challenge is live must not move the goalposts:
    the shopkeeper may already be at the till ringing the first amount.
    """
    evidence = _evidence(merchant)
    current = evidence.get("challenge")
    if isinstance(current, dict) and not current.get("used_at"):
        expires = parse_date(current.get("expires_at"))
        if expires is not None and expires > now:
            return current

    amount = secrets.randbelow(CHALLENGE_MAX_KES - CHALLENGE_MIN_KES + 1) + CHALLENGE_MIN_KES
    challenge = {
        "amount_kes": amount,
        "issued_at": iso(now),
        "expires_at": iso(_challenge_window(now)),
        "used_at": None,
    }
    evidence["challenge"] = challenge
    _save_evidence(merchant, evidence)
    return challenge


def _challenge_error(message: str) -> tuple[None, str]:
    return None, message


def receipt_for_challenge(
    merchant: ReceiptMerchant, payload: str, now: datetime,
) -> tuple[Optional[dict], Optional[str]]:
    """Parse a submitted receipt and check it against the live challenge.

    Returns `(evidence, None)` or `(None, reason)`. The raw payload is hashed
    after this function returns; it is never written to the database.
    """
    evidence = _evidence(merchant)
    challenge = evidence.get("challenge")
    if not isinstance(challenge, dict):
        return _challenge_error("Ask for a test amount first.")
    if challenge.get("used_at"):
        return _challenge_error("That test amount has already been used. Ask for a new one.")

    issued = parse_date(challenge.get("issued_at"))
    expires = parse_date(challenge.get("expires_at"))
    if expires is None or expires <= now:
        return _challenge_error("The test amount expired. Ask for a new one.")
    if issued is None:
        return _challenge_error("The test amount is not readable. Ask for a new one.")

    parsed = parse_receipt_payload(payload)
    if not parsed.get("ok"):
        return _challenge_error(parsed.get("error") or "That receipt could not be read.")
    receipt = parsed["receipt"]

    if clean_text(receipt.get("pin")).upper() != merchant.pin:
        return _challenge_error("That receipt is from a different shop PIN.")
    if not receipt.get("invoice"):
        return _challenge_error("The receipt has no invoice number, so it cannot be used once.")

    amount = int(challenge.get("amount_kes") or 0)
    if int(receipt.get("total") or 0) != amount:
        return _challenge_error(f"Ring exactly KSh {amount:,} at this shop's till, then submit that receipt.")

    issued_at = parse_date(receipt.get("issued_at"))
    if issued_at is None:
        return _challenge_error("The receipt has no issue time. A test sale must be dated.")
    if issued_at < issued - timedelta(seconds=CHALLENGE_GRACE_SECONDS):
        return _challenge_error("That receipt was issued before the test amount.")
    if issued_at > expires + timedelta(seconds=CHALLENGE_GRACE_SECONDS):
        return _challenge_error("That receipt was issued after the test window.")
    if issued_at > now + timedelta(seconds=CHALLENGE_GRACE_SECONDS):
        return _challenge_error("That receipt is dated in the future.")

    key = receipt_key(receipt)
    if not key:
        return _challenge_error("The receipt has no stable invoice or token.")
    digest = hashlib.sha256(key.encode()).hexdigest()
    if merchant.claim_receipt_key == digest:
        return _challenge_error("That receipt has already been used for this claim.")

    host = ""
    if receipt.get("verification_url"):
        try:
            host = urlparse(str(receipt["verification_url"])).netloc.lower()[:120]
        except ValueError:
            host = ""

    return {
        "challenge": challenge,
        "receipt": {
            "total": amount,
            "invoice_suffix": clean_text(receipt.get("invoice"))[-8:],
            "issued_at": iso(issued_at),
            "verification_host": host,
            "payload_sha256": digest,
        },
    }, None


def mark_challenge_used(merchant: ReceiptMerchant, evidence: dict, digest: str, now: datetime) -> None:
    document = _evidence(merchant)
    challenge = dict(document.get("challenge") or {})
    challenge["used_at"] = iso(now)
    document["challenge"] = challenge
    document["receipt"] = evidence["receipt"]
    history = list(document.get("history") or [])
    history.append({
        "path": "receipt_challenge",
        "at": iso(now),
        "confidence": 45,
        "amount_kes": evidence["receipt"]["total"],
    })
    document["history"] = history[-20:]
    _save_evidence(merchant, document)
    merchant.claim_receipt_key = digest


def authority_verified(receipt: dict) -> bool:
    """Reserved for a server-side KRA/DigiTax fetch.

    Deliberately fails closed. A real adapter must use a host allowlist, a
    timeout, and compare the returned PIN, invoice and total. Until then a
    challenge sale is presence evidence and the shop stays probationary.
    """
    if not settings.MERCHANT_CLAIM_AUTHORITY_VERIFY:
        return False
    return False


def promotion_window(now: datetime) -> datetime:
    return now + timedelta(days=max(1, settings.MERCHANT_CLAIM_PROBATION_DAYS))


async def _distinct_customers(
    db: AsyncSession, merchant: ReceiptMerchant, excluded: set[uuid.UUID], start: datetime,
) -> int:
    statement = (
        select(func.count(func.distinct(ReceiptVoucher.vendor_id)))
        .select_from(ReceiptVoucher)
        .where(
            ReceiptVoucher.merchant_id == merchant.id,
            ReceiptVoucher.status == "redeemed",
            ReceiptVoucher.redeemed_at.is_not(None),
            ReceiptVoucher.redeemed_at >= start,
        )
    )
    if excluded:
        statement = statement.where(ReceiptVoucher.vendor_id.notin_(excluded))
    return int((await db.execute(statement)).scalar_one() or 0)


async def _open_disputes(db: AsyncSession, merchant: ReceiptMerchant) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(TradeProof)
                .where(
                    TradeProof.merchant_pin == merchant.pin,
                    TradeProof.status == "disputed",
                )
            )
        ).scalar_one()
        or 0
    )


def _vouch_ids(merchant: ReceiptMerchant) -> set[uuid.UUID]:
    evidence = _evidence(merchant)
    found = set()
    for row in evidence.get("vouches") or []:
        try:
            found.add(uuid.UUID(str(row.get("vendor_id"))))
        except (TypeError, ValueError, AttributeError):
            continue
    return found


async def maybe_promote(
    db: AsyncSession, merchant: ReceiptMerchant, now: datetime,
) -> bool:
    """Probationary → verified only after the full trading-history test.

    Three distinct paying customers, fourteen days, no open dispute and no live
    contest. The claimant and the peer vouchers do not count as customers.
    """
    if merchant.claim_status != "probationary":
        return False
    if merchant.probation_until is None or merchant.probation_until > now:
        return False
    start = merchant.probation_until - timedelta(
        days=max(1, settings.MERCHANT_CLAIM_PROBATION_DAYS)
    )
    excluded = _vouch_ids(merchant)
    if merchant.claimed_by_vendor_id:
        excluded.add(merchant.claimed_by_vendor_id)
    customers = await _distinct_customers(db, merchant, excluded, start)
    if customers < max(1, settings.MERCHANT_CLAIM_REQUIRED_CUSTOMERS):
        return False
    if await _open_disputes(db, merchant):
        return False
    if merchant.contest_deadline is not None:
        return False

    evidence = _evidence(merchant)
    history = list(evidence.get("history") or [])
    history.append({
        "path": "trading_history",
        "at": iso(now),
        "confidence": 70,
        "customers": customers,
    })
    evidence["history"] = history[-20:]
    _save_evidence(merchant, evidence)
    merchant.claim_path = "trading_history"
    merchant.claim_confidence = 70
    merchant.claim_status = "verified"
    merchant.verified_at = now
    merchant.probation_until = None
    merchant.contest_deadline = None
    return True


def resolve_expired_contest(merchant: ReceiptMerchant, now: datetime) -> bool:
    """A contest the owner did not answer returns the shop to the review queue."""
    if merchant.claim_status != "contested":
        return False
    if merchant.contest_deadline is None or merchant.contest_deadline > now:
        return False
    evidence = _evidence(merchant)
    contest = dict(evidence.get("contest") or {})
    contest["state"] = "unanswered"
    contest["closed_at"] = iso(now)
    evidence["contest"] = contest
    _save_evidence(merchant, evidence)
    merchant.claim_status = "pending"
    merchant.contest_deadline = None
    merchant.probation_until = None
    return True


async def active_offers(db: AsyncSession, merchant: ReceiptMerchant, now: datetime) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(ReceiptOffer)
                .where(
                    ReceiptOffer.merchant_id == merchant.id,
                    ReceiptOffer.is_active.is_(True),
                    ReceiptOffer.starts_at <= now,
                    or_(ReceiptOffer.ends_at.is_(None), ReceiptOffer.ends_at > now),
                )
            )
        ).scalar_one()
        or 0
    )


def week_start(now: datetime) -> datetime:
    return now - timedelta(days=7)


async def vouchers_this_week(
    db: AsyncSession, merchant: ReceiptMerchant, now: datetime,
) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(ReceiptVoucher)
                .where(
                    ReceiptVoucher.merchant_id == merchant.id,
                    ReceiptVoucher.issued_at >= week_start(now),
                )
            )
        ).scalar_one()
        or 0
    )


def vendor_level(vendor: Vendor) -> int:
    """The same 0–3 part of the ladder the public rank uses.

    Level 3 is enough to vouch: a live page, a usable contact route and one
    completed movement or confirmed trade proof.
    """
    if not (clean_text(vendor.business_name) and clean_text(vendor.vendor_handle)):
        return 0
    contact = bool(
        getattr(vendor, "phone_verified_at", None)
        or (clean_text(getattr(vendor, "phone", None)) and getattr(vendor, "allow_direct_calls", False))
    )
    if not contact:
        return 1
    trades = int(getattr(vendor, "movements_completed", 0) or 0) + int(
        getattr(vendor, "confirmed_trade_proofs", 0) or 0
    )
    return 3 if trades >= 1 else 2


def same_region(merchant: ReceiptMerchant, vendor: Vendor) -> bool:
    shop = corridor(merchant.region)
    person = corridor(getattr(vendor, "physical_location", None))
    if not shop or not person:
        return False
    return shop in person or person in shop


async def receipts_at(db: AsyncSession, merchant: ReceiptMerchant, vendor_id: uuid.UUID) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(Receipt)
                .where(
                    Receipt.merchant_id == merchant.id,
                    Receipt.vendor_id == vendor_id,
                    Receipt.status.in_(("verified", "partial")),
                )
            )
        ).scalar_one()
        or 0
    )


async def previously_traded(
    db: AsyncSession, first: uuid.UUID, second: uuid.UUID,
) -> bool:
    row = (
        await db.execute(
            select(TradeProof.id)
            .where(
                or_(
                    (TradeProof.buyer_vendor_id == first) & (TradeProof.seller_vendor_id == second),
                    (TradeProof.buyer_vendor_id == second) & (TradeProof.seller_vendor_id == first),
                )
            )
            .limit(1)
        )
    ).first()
    return row is not None


async def add_vouch(
    db: AsyncSession, merchant: ReceiptMerchant, voucher: Vendor, now: datetime,
    claimant: Optional[Vendor],
) -> tuple[Optional[dict], Optional[str]]:
    """Record one independent Level 3+ vouch. Two move a pending claim to probation."""
    if claimant is not None and voucher.id == claimant.id:
        return None, "The claimant cannot vouch for their own shop."
    if vendor_level(voucher) < 3:
        return None, "A vouch needs Level 3: a live page, a contact route and one real trade."
    if not same_region(merchant, voucher):
        return None, "A vouch must come from the shop's own region."
    if await receipts_at(db, merchant, voucher.id) < 2:
        return None, "A vouch needs at least two receipts at this shop."
    joined = getattr(voucher, "joined_at", None)
    if joined is not None and (now - joined).days < 30:
        return None, "A voucher account must be at least 30 days old."
    if claimant is not None:
        created = joined or now
        claim_created = getattr(claimant, "joined_at", None) or now
        if abs((created - claim_created).total_seconds()) < 24 * 3600:
            return None, "The voucher and the claimant opened their accounts too close together."

    evidence = _evidence(merchant)
    vouches = list(evidence.get("vouches") or [])
    if any(str(row.get("vendor_id")) == str(voucher.id) for row in vouches):
        return None, "You have already vouched for this shop."
    if claimant is not None and await previously_traded(db, voucher.id, claimant.id):
        return None, "A voucher cannot have traded with the claimant."

    vouches.append({
        "vendor_id": str(voucher.id),
        "at": iso(now),
        "region": corridor(getattr(voucher, "physical_location", None)),
    })
    evidence["vouches"] = vouches
    _save_evidence(merchant, evidence)

    if len(vouches) >= 2 and merchant.claim_status == "pending":
        merchant.claim_status = "probationary"
        merchant.claim_path = "peer_vouch"
        merchant.claim_confidence = 30
        merchant.probation_until = promotion_window(now)
        merchant.verified_at = None
    return {"vouches": len(vouches), "needed": 2}, None


async def contest_evidence(
    db: AsyncSession, merchant: ReceiptMerchant, payload: str, now: datetime,
) -> tuple[Optional[dict], Optional[str]]:
    """A contest needs a fresh receipt from the shop, not a bare accusation."""
    parsed = parse_receipt_payload(payload)
    if not parsed.get("ok"):
        return None, parsed.get("error") or "Attach a receipt from this shop."
    receipt = parsed["receipt"]
    if clean_text(receipt.get("pin")).upper() != merchant.pin:
        return None, "That receipt is from a different shop PIN."
    if not receipt.get("invoice"):
        return None, "The receipt has no invoice number."
    issued_at = parse_date(receipt.get("issued_at"))
    if issued_at is None or issued_at < now - timedelta(days=30):
        return None, "The contest receipt must be dated within the last 30 days."
    key = receipt_key(receipt)
    return {
        "total": int(receipt.get("total") or 0),
        "invoice_suffix": clean_text(receipt.get("invoice"))[-8:],
        "issued_at": iso(issued_at),
        "payload_sha256": hashlib.sha256(key.encode()).hexdigest() if key else "",
    }, None


def start_contest(
    merchant: ReceiptMerchant, contestant: Vendor, evidence: dict, reason: str, now: datetime,
) -> None:
    document = _evidence(merchant)
    document["contest"] = {
        "by_vendor_id": str(contestant.id),
        "state": "open",
        "reason": clean_text(reason)[:1000],
        "at": iso(now),
        "deadline": iso(now + timedelta(hours=max(1, settings.MERCHANT_CLAIM_CONTEST_HOURS))),
        "previous_status": merchant.claim_status,
        "receipt": evidence,
    }
    _save_evidence(merchant, document)
    merchant.claim_status = "contested"
    merchant.contest_deadline = now + timedelta(
        hours=max(1, settings.MERCHANT_CLAIM_CONTEST_HOURS)
    )


def contest_started_at(merchant: ReceiptMerchant) -> Optional[datetime]:
    evidence = _evidence(merchant)
    contest = evidence.get("contest")
    if not isinstance(contest, dict):
        return None
    return parse_date(contest.get("at"))


def answer_contest(
    merchant: ReceiptMerchant, receipt: dict, now: datetime,
) -> Optional[str]:
    document = _evidence(merchant)
    contest = dict(document.get("contest") or {})
    previous = contest.get("previous_status")
    if previous not in ("probationary", "verified"):
        previous = "pending"
    contest["state"] = "answered"
    contest["answered_at"] = iso(now)
    contest["answer_receipt"] = receipt
    document["contest"] = contest
    _save_evidence(merchant, document)
    merchant.claim_status = previous
    merchant.contest_deadline = None
    if previous != "verified":
        merchant.probation_until = promotion_window(now)
    return previous

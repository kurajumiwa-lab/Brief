"""Signals for social sellers: bio links, stock-in-hand photos, delivery reports.

What each record proves, in words the product must use:

  bio-link match   "A server fetch on <date> saw /p/<handle> in the public bio."
  stock-in-hand    "A photo was uploaded beside today's code, valid 48 hours."
  delivery report  "A buyer who traded with this seller says it did not arrive."

None of them is a KRA, bank or platform verification. None adds standing. The
copy in `SIGNAL_NOTES` is part of the API contract, not decoration.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.notification import NotificationType
from app.models.receipts import TradeProof
from app.models.stock import StockMovement
from app.models.vendor import Vendor
from app.modules.routines.models import RecurringRoutine
from app.modules.routines.service import public_routines
from app.modules.social_trust.models import (
    PLATFORM_LABELS, PLATFORMS, SIGNAL_NOTE, SellerDeliveryReport, SocialBioCheck,
    StockInHandProof,
)
from app.services.notification_service import create_notification

NAIROBI = ZoneInfo("Africa/Nairobi")
PROOF_TTL_HOURS = 48
BIO_TIMEOUT_SECONDS = 5.0
BIO_MAX_BYTES = 512 * 1024
HANDLE_RE = re.compile(r"^[A-Za-z0-9._-]{2,100}$")

# Deliberately exact. A lookalike (tiktok.com.evil.example) fails the set test,
# not a substring test.
ALLOWED_HOSTS = {
    "tiktok.com", "www.tiktok.com", "m.tiktok.com",
    "instagram.com", "www.instagram.com", "m.instagram.com",
    "facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com",
    "mbasic.facebook.com",
}

SIGNAL_NOTES = {
    "bio_link": "A server fetch saw your page link in the public bio on the date shown. "
                "It is a signal, not a verification of the business, and it awards no standing credit.",
    "stock_in_hand": "A photograph uploaded beside the daily code. It proves a photo was taken "
                     "with that code, not ownership or stock quantity, and awards no standing credit.",
    "delivery_reports": "Reports come from buyers who traded with this seller. They are unresolved "
                        "claims, not findings, and award no standing credit either way.",
    "delivery_count": "Counted from completed stock movements and shop-confirmed receipts. "
                      "It is a record of trades, not a guarantee.",
    "routine": "A weekly schedule the seller publishes. Reliability is not verified by it.",
}

BANNER_MIN_REPORTS = 2


class TrustError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _normalise_handle(value) -> str:
    handle = str(value or "").strip().lstrip("@")
    if not HANDLE_RE.fullmatch(handle):
        raise TrustError("A handle has 2–100 letters, numbers, dots, dashes or underscores.", 422)
    return handle


# ── daily stock-in-hand challenge ─────────────────────────────────────────────

def challenge_prefix(vendor: Vendor) -> str:
    raw = str(getattr(vendor, "physical_location", "") or "").strip()
    letters = re.sub(r"[^A-Za-z]", "", raw).upper()
    return (letters[:3] or "KE").ljust(3, "X")


def challenge_code_for(user_id, day: date, prefix: str = "KE") -> str:
    """Deterministic per user per EAT day: e.g. `KSM-92`.

    The server can recompute it for any date, so the code on a handwritten note
    is checkable without storing a secret the seller could choose.
    """
    digest = hmac.new(
        settings.SECRET_KEY.encode(), f"stock:{user_id}:{day.isoformat()}".encode(),
        hashlib.sha256,
    ).digest()
    number = 10 + (digest[0] * 256 + digest[1]) % 90
    return f"{prefix}-{number:02d}"


def today_eat() -> date:
    return now_utc().astimezone(NAIROBI).date()


def daily_challenge(vendor: Vendor) -> dict:
    day = today_eat()
    code = challenge_code_for(vendor.id, day, challenge_prefix(vendor))
    return {
        "challenge_code": code,
        "date": day.isoformat(),
        "expires_at": (datetime.combine(day + timedelta(days=1), datetime.min.time(),
                                         tzinfo=NAIROBI)).isoformat(),
        "instructions": (
            "Write the code and /p/{handle} on a note, place it beside the physical "
            "product, and photograph both in one frame."
        ).format(handle=vendor.vendor_handle),
        "validity": "Published for 48 hours. A new code is issued each day.",
        "signal_note": SIGNAL_NOTES["stock_in_hand"],
    }


# ── bio-link verification ────────────────────────────────────────────────────

def validate_profile_url(platform: str, value: str) -> str:
    """Allowlist by exact host and https. No redirects are followed."""
    url = str(value or "").strip()
    if len(url) > 500:
        raise TrustError("That profile URL is too long.", 422)
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise TrustError("Use the full https:// profile link.", 422)
    if parts.hostname.lower() not in ALLOWED_HOSTS:
        raise TrustError("Only TikTok, Instagram and Facebook profile links are supported.", 422)
    expected_host = {"tiktok": "tiktok.com", "instagram": "instagram.com",
                     "facebook": "facebook.com"}[platform]
    if not (parts.hostname.lower() == expected_host
            or parts.hostname.lower().endswith("." + expected_host)):
        raise TrustError(f"That link is not a {PLATFORM_LABELS[platform]} profile.", 422)
    return url


def expected_path(handle: str) -> str:
    return f"/p/{handle.lower()}"


async def _fetch_public_bio(url: str) -> tuple[int, str]:
    """Fetch a public profile page: 5s, no redirects, 512 kB cap.

    Split out so the tests can replace it. The production path never follows a
    redirect — an allowlisted host must not bounce the server somewhere else.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; HomeOfficeBioCheck/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en",
    }
    async with httpx.AsyncClient(timeout=BIO_TIMEOUT_SECONDS, follow_redirects=False,
                                 headers=headers) as client:
        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                return response.status_code, ""
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > BIO_MAX_BYTES:
                    break
                chunks.append(chunk)
            return response.status_code, b"".join(chunks).decode("utf-8", errors="ignore")


def _link_entry(vendor: Vendor, platform: str) -> Optional[dict]:
    for entry in list(vendor.social_links or []):
        if isinstance(entry, dict) and entry.get("platform") == platform:
            return entry
    return None


def _save_links(vendor: Vendor, links: list[dict]):
    vendor.social_links = links


def validate_links(payload: list[dict]) -> list[dict]:
    if not isinstance(payload, list) or len(payload) > 3:
        raise TrustError("Add up to three social links.", 422)
    seen = set()
    cleaned = []
    for item in payload:
        if not isinstance(item, dict):
            raise TrustError("Each social link needs a platform, handle and URL.", 422)
        platform = str(item.get("platform") or "").strip().lower()
        if platform not in PLATFORMS:
            raise TrustError("Platform must be tiktok, instagram or facebook.", 422)
        if platform in seen:
            raise TrustError("Add one link per platform.", 422)
        seen.add(platform)
        handle = _normalise_handle(item.get("handle"))
        url = validate_profile_url(platform, item.get("profile_url"))
        cleaned.append({
            "platform": platform,
            "handle": handle,
            "profile_url": url,
            "bio_verified": False,
            "checked_at": None,
            "bio_match_on": None,
        })
    return cleaned


async def verify_bio(db: AsyncSession, vendor: Vendor, platform: str) -> dict:
    platform = str(platform or "").strip().lower()
    if platform not in PLATFORMS:
        raise TrustError("Platform must be tiktok, instagram or facebook.", 422)
    links = [dict(entry) for entry in list(vendor.social_links or [])
             if isinstance(entry, dict)]
    entry = next((e for e in links if e.get("platform") == platform), None)
    if entry is None:
        raise TrustError("Add that profile link first.", 404)
    path = expected_path(entry["handle"])
    status = None
    matched = False
    reason = None
    try:
        status, html = await _fetch_public_bio(entry["profile_url"])
        if status == 200 and html:
            matched = path.lower() in html.lower()
            if not matched:
                reason = "LINK_NOT_IN_BIO"
        elif status in (301, 302, 303, 307, 308):
            reason = "LOGIN_WALL_OR_REDIRECT"
        else:
            reason = f"HTTP_{status}"
    except (httpx.TimeoutException, httpx.HTTPError):
        reason = "FETCH_FAILED"
    except Exception:
        reason = "FETCH_FAILED"

    checked_at = now_utc()
    db.add(SocialBioCheck(
        user_id=vendor.id, platform=platform, profile_url=entry["profile_url"],
        expected_path=path, matched=bool(matched), http_status=status,
        failure_reason=reason, checked_at=checked_at,
    ))
    entry["bio_verified"] = bool(matched)
    entry["checked_at"] = checked_at.isoformat()
    entry["bio_match_on"] = today_eat().isoformat() if matched else None
    entry["last_check_result"] = (
        f"Matched {path}" if matched else
        "The page did not show the link when checked" if reason else "No match found"
    )
    _save_links(vendor, links)
    await db.flush()
    return {
        "platform": platform,
        "handle": entry["handle"],
        "bio_verified": bool(matched),
        "matched": bool(matched),
        "expected_path": path,
        "http_status": status,
        "failure_reason": reason,
        "checked_at": checked_at.isoformat(),
        "message": (
            f"Matched on {checked_at.astimezone(NAIROBI):%d %b %Y at %H:%M} EAT. "
            "A bio match is a signal, not a verification of the business, and it awards no standing credit."
            if matched else
            "No match yet. Put the full link in your public bio, save it on the platform, then check again. "
            "Some platforms show a login wall to servers; that is not a failure of your link."
        ),
        "signal_note": SIGNAL_NOTES["bio_link"],
    }


# ── stock-in-hand proof ──────────────────────────────────────────────────────

async def publish_stock_proof(db: AsyncSession, vendor: Vendor, *, challenge_code: str,
                              item_title: str, price_kes, image_url: str) -> dict:
    day = today_eat()
    expected = challenge_code_for(vendor.id, day, challenge_prefix(vendor))
    supplied = re.sub(r"\s", "", str(challenge_code or "")).upper()
    if supplied != expected.upper():
        raise TrustError(
            "That code is not today's. Refresh the code and write the new one on the note.", 422
        )
    title = " ".join(str(item_title or "").split())
    if not 3 <= len(title) <= 120:
        raise TrustError("Name the item in 3 to 120 characters.", 422)
    if price_kes not in (None, ""):
        try:
            price_kes = Decimal(str(price_kes))
        except Exception:
            raise TrustError("Price must be a number.", 422)
        if price_kes < 0 or price_kes > 10_000_000:
            raise TrustError("Price is out of range.", 422)
    else:
        price_kes = None
    image = str(image_url or "").strip()
    from app.services.storage import MEDIA_KEY, storage

    if not image.startswith("/static/") or not MEDIA_KEY.fullmatch(image[len("/static/"):]):
        raise TrustError("Upload the photograph first.", 422)
    media = await storage.read(image[len("/static/"):])
    if not media or not str(media[1]).startswith("image/"):
        raise TrustError("That photograph could not be found. Upload it again.", 422)

    now = now_utc()
    # Retire the previous photo first: the partial unique index allows one ACTIVE row.
    await db.execute(
        update(StockInHandProof)
        .where(StockInHandProof.user_id == vendor.id, StockInHandProof.status == "ACTIVE")
        .values(status="EXPIRED")
    )
    await db.flush()
    proof = StockInHandProof(
        user_id=vendor.id, challenge_code=supplied, challenge_date=day,
        item_title=title, price_kes=price_kes, proof_image_url=image,
        status="ACTIVE", expires_at=now + timedelta(hours=PROOF_TTL_HOURS), created_at=now,
    )
    db.add(proof)
    try:
        await db.flush()
    except IntegrityError:
        # Two phones can post at once; the partial unique index keeps one ACTIVE
        # photo. Rolling back the whole request is right here: there is exactly
        # one insert, so nothing else is lost.
        raise TrustError("Another photo was just published. Refresh and try again.", 409)
    return stock_proof_out(proof, now)


def stock_proof_out(proof: Optional[StockInHandProof], now: Optional[datetime] = None) -> Optional[dict]:
    if proof is None:
        return None
    now = now or now_utc()
    expired = proof.status != "ACTIVE" or _aware(proof.expires_at) <= now
    return {
        "id": str(proof.id),
        "challenge_code": proof.challenge_code,
        "item_title": proof.item_title,
        "price_kes": float(proof.price_kes) if proof.price_kes is not None else None,
        "image_url": proof.proof_image_url,
        "status": proof.status,
        "is_valid": not expired,
        "created_at": _aware(proof.created_at).isoformat(),
        "expires_at": _aware(proof.expires_at).isoformat(),
        "label": f"Stock-in-Hand Photo • Code {proof.challenge_code} (Valid 48h)",
        "signal_note": SIGNAL_NOTES["stock_in_hand"],
    }


async def current_proof(db: AsyncSession, user_id, now: Optional[datetime] = None):
    now = now or now_utc()
    await db.execute(
        update(StockInHandProof)
        .where(StockInHandProof.user_id == user_id, StockInHandProof.status == "ACTIVE",
               StockInHandProof.expires_at <= now)
        .values(status="EXPIRED")
    )
    return (await db.execute(
        select(StockInHandProof).where(
            StockInHandProof.user_id == user_id, StockInHandProof.status == "ACTIVE",
            StockInHandProof.expires_at > now,
        ).order_by(StockInHandProof.created_at.desc())
    )).scalars().first()


# ── delivery reports ─────────────────────────────────────────────────────────

async def _level_for(db: AsyncSession, vendor: Vendor) -> int:
    from app.services.og_cards import _level_for as level_for

    return int(await level_for(db, vendor))


async def _trade_evidence(db: AsyncSession, reporter: Vendor, seller: Vendor):
    """The newest real trade between the two, or None.

    A report must be anchored to a trade row. Without this, a competitor could
    raise the warning banner on any seller in the network.
    """
    proof = (await db.execute(
        select(TradeProof).where(
            TradeProof.buyer_vendor_id == reporter.id,
            TradeProof.seller_vendor_id == seller.id,
            TradeProof.status == "confirmed",
        ).order_by(TradeProof.confirmed_at.desc().nullslast()).limit(1)
    )).scalars().first()
    if proof is not None:
        return {"trade_proof_id": proof.id, "stock_movement_id": None}
    movement = (await db.execute(
        select(StockMovement).where(
            StockMovement.from_vendor_id == seller.id,
            StockMovement.to_vendor_id == reporter.id,
            StockMovement.status.in_(("confirmed", "shipped", "received")),
        ).order_by(StockMovement.created_at.desc()).limit(1)
    )).scalars().first()
    if movement is not None:
        return {"trade_proof_id": None, "stock_movement_id": movement.id}
    return None


async def submit_delivery_report(db: AsyncSession, reporter: Vendor, *,
                                 seller_handle: str, note: str) -> dict:
    handle = str(seller_handle or "").strip().lstrip("@").lower()
    seller = (await db.execute(select(Vendor).where(Vendor.vendor_handle == handle))).scalar_one_or_none()
    if seller is None:
        raise TrustError("That seller was not found.", 404)
    if seller.id == reporter.id:
        raise TrustError("You cannot report your own page.", 403)
    if reporter.fraud_suspended_at:
        raise TrustError("This account cannot file reports right now.", 403)
    level = await _level_for(db, reporter)
    if level < 2:
        raise TrustError(
            "Only Level 2+ buyers can file a delivery report. Standing is earned from "
            "completed trades — this is not something you can pay to unlock.", 403
        )
    text = " ".join(str(note or "").split())
    if len(text) < 15:
        raise TrustError("Describe what did not arrive, in at least 15 characters.", 422)
    evidence = await _trade_evidence(db, reporter, seller)
    if evidence is None:
        raise TrustError(
            "A delivery report must point to a trade you actually made with this seller.", 403
        )
    existing = (await db.execute(
        select(SellerDeliveryReport).where(
            SellerDeliveryReport.seller_user_id == seller.id,
            SellerDeliveryReport.reporter_user_id == reporter.id,
            SellerDeliveryReport.status == "OPEN",
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise TrustError("You already have an open report with this seller.", 409)
    report = SellerDeliveryReport(
        seller_user_id=seller.id, reporter_user_id=reporter.id,
        note=text[:1000], status="OPEN", created_at=now_utc(),
        **evidence,
    )
    db.add(report)
    await db.flush()
    await create_notification(
        db, seller.id, NotificationType.SYSTEM, "A buyer reported a missing delivery",
        "A buyer who traded with you says a delivery did not arrive. Resolve it with them; "
        "two unresolved reports show a warning on your page. This is a report, not a finding.",
        sender_id=reporter.id, data={"delivery_report_id": str(report.id)},
    )
    return {"id": str(report.id), "status": report.status,
            "message": "Report recorded. The seller can respond and resolve it.",
            "signal_note": SIGNAL_NOTES["delivery_reports"]}


async def resolve_delivery_report(db: AsyncSession, seller: Vendor, report_id,
                                  note: str) -> dict:
    report = (await db.execute(
        select(SellerDeliveryReport).where(SellerDeliveryReport.id == report_id).with_for_update()
    )).scalar_one_or_none()
    if report is None or report.seller_user_id != seller.id:
        raise TrustError("That report was not found.", 404)
    if report.status != "OPEN":
        raise TrustError("That report is already closed.", 409)
    text = " ".join(str(note or "").split())
    if len(text) < 10:
        raise TrustError("Say how it was resolved — at least 10 characters.", 422)
    report.status = "RESOLVED"
    report.resolved_at = now_utc()
    report.resolution_note = text[:1000]
    await db.flush()
    return {"id": str(report.id), "status": report.status,
            "resolved_at": report.resolved_at.isoformat(),
            "message": "Marked resolved. This closes the warning if fewer than two open reports remain."}


async def open_report_stats(db: AsyncSession, seller_id, now: Optional[datetime] = None) -> dict:
    """Open reports from distinct Level 2+ reporters — the banner's only input."""
    now = now or now_utc()
    rows = (await db.execute(
        select(SellerDeliveryReport, Vendor)
        .join(Vendor, Vendor.id == SellerDeliveryReport.reporter_user_id)
        .where(SellerDeliveryReport.seller_user_id == seller_id,
               SellerDeliveryReport.status == "OPEN")
        .order_by(SellerDeliveryReport.created_at.desc())
    )).all()
    qualified = []
    for report, reporter in rows:
        if await _level_for(db, reporter) >= 2:
            qualified.append(report)
    distinct = {report.reporter_user_id for report in qualified}
    count = len(distinct)
    return {
        "open_count": len(rows),
        "qualified_count": count,
        "warning": count >= BANNER_MIN_REPORTS,
        "warning_text": (
            f"⚠ {count} Unresolved Delivery Reports — Inspect Before Paying"
            if count >= BANNER_MIN_REPORTS else None
        ),
        "reports": [{
            "id": str(report.id),
            "note": report.note,
            "created_at": _aware(report.created_at).isoformat(),
            "has_trade_evidence": bool(report.trade_proof_id or report.stock_movement_id),
        } for report in qualified],
    }


async def delivery_count(db: AsyncSession, seller_id) -> int:
    movements = (await db.execute(
        select(func.count()).select_from(StockMovement).where(
            StockMovement.from_vendor_id == seller_id,
            StockMovement.status == "received",
        )
    )).scalar_one()
    proofs = (await db.execute(
        select(func.count()).select_from(TradeProof).where(
            TradeProof.seller_vendor_id == seller_id,
            TradeProof.status == "confirmed",
        )
    )).scalar_one()
    return int(movements) + int(proofs)


def trust_reply(handle: str, origin: str) -> str:
    base = str(origin or "").rstrip("/")
    return (
        "Check my verified delivery record & stock-in-hand proof before ordering: "
        f"{base}/p/{handle}"
    )


async def public_card(db: AsyncSession, vendor: Vendor, origin: str) -> dict:
    now = now_utc()
    deliveries = await delivery_count(db, vendor.id)
    reports = await open_report_stats(db, vendor.id, now)
    proof = await current_proof(db, vendor.id, now)
    routines = (await db.execute(
        select(RecurringRoutine).where(
            RecurringRoutine.owner_user_id == vendor.id, RecurringRoutine.is_active.is_(True)
        ).order_by(RecurringRoutine.day_of_week)
    )).scalars().all()
    level = await _level_for(db, vendor)
    links = []
    for entry in list(vendor.social_links or []):
        if not isinstance(entry, dict):
            continue
        links.append({
            "platform": entry.get("platform"),
            "platform_label": PLATFORM_LABELS.get(entry.get("platform"), entry.get("platform")),
            "handle": entry.get("handle"),
            "profile_url": entry.get("profile_url"),
            "bio_verified": bool(entry.get("bio_verified")),
            "checked_at": entry.get("checked_at"),
            "bio_match_on": entry.get("bio_match_on"),
            "signal_note": SIGNAL_NOTES["bio_link"],
        })
    return {
        "handle": vendor.vendor_handle,
        "name": vendor.business_name,
        "account_kind": getattr(vendor, "account_kind", None) or "business",
        "standing_level": level,
        "account_age_days": max(0, (now.replace(tzinfo=None) - vendor.joined_at).days)
        if vendor.joined_at else 0,
        "verified_deliveries": deliveries,
        "verified_deliveries_label": f"{deliveries} completed deliver{'y' if deliveries == 1 else 'ies'}",
        "delivery_note": SIGNAL_NOTES["delivery_count"],
        "dispute": {
            "open_reports": reports["qualified_count"],
            "raw_open_reports": reports["open_count"],
            "ratio_label": f"{reports['qualified_count']} unresolved",
            "warning": reports["warning"],
            "warning_text": reports["warning_text"],
            "signal_note": SIGNAL_NOTES["delivery_reports"],
        },
        "bio_links": links,
        "stock_proof": stock_proof_out(proof, now),
        "routines": public_routines(list(routines)),
        "routine_note": SIGNAL_NOTES["routine"],
        "trust_reply": trust_reply(vendor.vendor_handle, origin),
        "page_url": f"{str(origin or '').rstrip('/')}/p/{vendor.vendor_handle}",
        "signals_note": SIGNAL_NOTE,
    }


async def owner_state(db: AsyncSession, vendor: Vendor) -> dict:
    now = now_utc()
    reports = await open_report_stats(db, vendor.id, now)
    proof = await current_proof(db, vendor.id, now)
    routines = (await db.execute(
        select(RecurringRoutine).where(RecurringRoutine.owner_user_id == vendor.id)
        .order_by(RecurringRoutine.created_at.desc())
    )).scalars().all()
    return {
        "handle": vendor.vendor_handle,
        "social_links": list(vendor.social_links or []),
        "challenge": daily_challenge(vendor),
        "stock_proof": stock_proof_out(proof, now),
        "delivery": reports,
        "routines": public_routines(list(routines)) if routines else [],
        "copy_reply_hint": "Open your public page and tap Copy Trust Reply.",
        "signals_note": SIGNAL_NOTE,
    }

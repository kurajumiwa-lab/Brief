"""The rules of standing — importable without FastAPI.

This module owns what it means to claim, evidence, verify, reject, expire and
withdraw a business fact, and what a readiness checklist honestly says about
a business. The router is a translator; jobs and other modules (the trade
matching engine, the passport surface) call these functions directly.

Rules refuse with `StandingError(message, status)` so the HTTP layer stays a
mapping, not a second brain — the same shape as `trade.RequestFlowError`.

The line this module will not cross: **verified evidence is not a verdict**.
Nothing here computes a single score that could be read as "reliable". The
readiness payload counts documents and states their condition, and the
passport carries the wording that keeps that honest.
"""

import logging
from datetime import date, datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.standing import catalog
from app.modules.standing.models import (
    BusinessClaim,
    ClaimEvent,
    ClaimMethod,
    ClaimStatus,
    StandingProfile,
)
from app.platform.event_outbox import emit
from app.services.notification_service import create_notification, notify_many

log = logging.getLogger("brief.standing")

# How far ahead the renewal reminders fire. Window labels are stored on the
# claim, so each window is announced once — a worker pass every hour is safe.
REMINDER_WINDOWS = (30, 14, 7)

# A passport shows at most this many facts; more than a screenful is a document
# dump, not a profile.
MAX_FACTS = 40

# One business can follow this many standing questions before the bell becomes
# noise. The cap is a product decision, and the API says so when it is hit.
MAX_WATCHES = 10

PASSPORT_DISCLAIMER = (
    "A verified claim means a named person saw the document or checked the reference on the "
    "date shown. It is not a statement that the business is compliant today, or that it is "
    "reliable, solvent or trustworthy."
)


class StandingError(Exception):
    """A rule of standing refused an action. `status` is the HTTP code the
    adapter should return; jobs and other modules can catch this without
    knowing HTTP exists."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ─────────────────────────────────────────────────────────────────────────────
# serialization — one shape for the API, the passport and any future consumer
# ─────────────────────────────────────────────────────────────────────────────

def _iso(value) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def today() -> date:
    """One place where 'today' is decided, so tests can reason about expiry."""
    return datetime.utcnow().date()


def claim_state(claim: BusinessClaim, *, today_: Optional[date] = None) -> str:
    """The state a reader needs, including expiry that has not been swept yet.

    The sweeper flips rows to `expired` on its own schedule; a passport must
    not wait for it to be honest. A row whose printed date has passed reads
    as expired the moment it does.
    """
    day = today_ or today()
    if claim.status == ClaimStatus.VERIFIED and claim.expires_on and claim.expires_on < day:
        return ClaimStatus.EXPIRED.value
    if claim.status in (ClaimStatus.DECLARED, ClaimStatus.DOCUMENTED) \
            and claim.expires_on and claim.expires_on < day:
        return ClaimStatus.EXPIRED.value
    return claim.status.value


def claim_out(claim: BusinessClaim, *, mine: bool = False,
              today_: Optional[date] = None) -> dict:
    """One claim on the wire.

    `mine=True` adds what only the owner (and a verifier) may see: the file
    link, the verifier's note, the rejection reason, the owner's own note.
    """
    spec = catalog.claim_spec(claim.claim_key)
    state = claim_state(claim, today_=today_)
    out = {
        "id": str(claim.id),
        "claim_key": claim.claim_key,
        "label": spec.label if spec else claim.claim_key,
        "issuer": spec.issuer if spec else None,
        "group": spec.group if spec else "other",
        "attribute": spec.attribute if spec else False,
        "status": state,
        "method": claim.method.value if hasattr(claim.method, "value") else str(claim.method),
        "reference": claim.reference if claim.share_reference else None,
        "issued_on": _iso(claim.issued_on),
        "expires_on": _iso(claim.expires_on),
        "verified_at": _iso(claim.verified_at),
        "evidence_attached": bool(claim.evidence_url),
        "has_expiry": bool(claim.expires_on),
    }
    if mine:
        out.update({
            "evidence_url": claim.evidence_url,
            "evidence_name": claim.evidence_name,
            "note": claim.note,
            "share_reference": claim.share_reference,
            "verification_note": claim.verification_note,
            "rejection_reason": claim.rejection_reason,
            "verified_by": claim.verified_by_vendor_id and str(claim.verified_by_vendor_id),
            "verification_requested_at": _iso(claim.verification_requested_at),
            "reminded_windows": claim.reminded_windows or [],
            "created_at": _iso(claim.created_at),
            "updated_at": _iso(claim.updated_at),
        })
    return out


def _record(db: AsyncSession, claim: BusinessClaim, action: str, *,
            actor: Optional[Vendor] = None, actor_type: str = "owner",
            note: Optional[str] = None, payload: Optional[dict] = None) -> None:
    """Append one line of history in the caller's transaction — the change and
    the record of it commit together, or neither does."""
    db.add(ClaimEvent(
        claim_id=claim.id, action=action, actor_vendor_id=actor.id if actor else None,
        actor_type=actor_type, note=(note or None), payload=payload or {},
    ))


async def _get_own(db: AsyncSession, vendor: Vendor, claim_id: UUID) -> BusinessClaim:
    claim = await db.get(BusinessClaim, claim_id)
    if not claim:
        raise StandingError("Claim not found", status=404)
    if claim.vendor_id != vendor.id:
        raise StandingError("That claim belongs to another business", status=403)
    return claim


# ─────────────────────────────────────────────────────────────────────────────
# claiming
# ─────────────────────────────────────────────────────────────────────────────

def _parse_date(value, field_name: str) -> Optional[date]:
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise StandingError(f"{field_name} must be an ISO date (YYYY-MM-DD)")


async def upsert_claim(
    db: AsyncSession,
    vendor: Vendor,
    claim_key: str,
    *,
    reference: Optional[str] = None,
    issued_on=None,
    expires_on=None,
    note: Optional[str] = None,
    share_reference: bool = True,
    evidence_url: Optional[str] = None,
    evidence_name: Optional[str] = None,
) -> BusinessClaim:
    """Create or update one of my claims.

    Evidence is uploaded by the router (the storage call needs the upload
    object); this function decides the resulting state:

        no file, no reference      → declared
        a reference or a file      → documented
        an updated fact            → verification is cleared: a human checked
                                     the old paper, not the new one
    """
    spec = catalog.claim_spec(claim_key)
    if not spec:
        raise StandingError(f"Unknown claim '{claim_key}' — see GET /api/passport/catalog", status=404)
    if note and len(note) > 1000:
        raise StandingError("note must be 1000 characters or fewer")
    if reference and len(reference) > 120:
        raise StandingError("reference must be 120 characters or fewer")

    seen = _parse_date(issued_on, "issued_on") or today()
    expiry = _parse_date(expires_on, "expires_on")
    if expiry is None:
        expiry = catalog.default_expiry(claim_key, seen)
    if expiry and expiry < seen:
        raise StandingError("expires_on cannot be before issued_on")

    claim = (await db.execute(
        select(BusinessClaim).where(
            BusinessClaim.vendor_id == vendor.id,
            BusinessClaim.claim_key == claim_key,
        ))).scalars().first()
    created = claim is None
    if created:
        claim = BusinessClaim(vendor_id=vendor.id, claim_key=claim_key)
        db.add(claim)
        await db.flush()   # the id every history line needs

    # Changing the paper invalidates what a human checked before: the note,
    # the date and the verifier all go, and the event trail says why.
    was_verified = claim.status in (ClaimStatus.VERIFIED, ClaimStatus.REJECTED)
    claim.reference = (reference or "").strip() or None
    claim.issued_on = seen
    claim.expires_on = expiry
    claim.note = (note or "").strip() or None
    claim.share_reference = bool(share_reference)
    if evidence_url:
        claim.evidence_url = evidence_url
        claim.evidence_name = evidence_name
    has_evidence = bool(claim.evidence_url)
    claim.status = ClaimStatus.DOCUMENTED if (has_evidence or claim.reference) else ClaimStatus.DECLARED
    claim.method = (ClaimMethod.DOCUMENT_UPLOAD if has_evidence
                    else ClaimMethod.DOCUMENT_REFERENCE if claim.reference
                    else ClaimMethod.SELF_DECLARED)
    if was_verified:
        claim.verified_by_vendor_id = None
        claim.verified_at = None
        claim.verification_note = None
    claim.rejection_reason = None
    claim.verification_requested_at = None
    claim.reminded_windows = []
    claim.updated_at = datetime.utcnow()

    _record(db, claim, "created" if created else "updated", actor=vendor,
            payload={"status": claim.status.value, "evidence": has_evidence})
    if evidence_url:
        _record(db, claim, "evidence_attached", actor=vendor,
                note=evidence_name, payload={"reference": claim.reference})
    if was_verified:
        _record(db, claim, "reopened", actor=vendor,
                note="New documents supersede the earlier verification")
    emit(db, "standing.claim.updated", {
        "claim_id": str(claim.id), "vendor_id": str(vendor.id),
        "claim_key": claim_key, "status": claim.status.value,
    })
    await db.commit()
    await db.refresh(claim)
    return claim


async def withdraw_claim(db: AsyncSession, vendor: Vendor, claim_id: UUID) -> BusinessClaim:
    """Take a claim down. The row and its history stay — a passport that
    erases what it once said is not a record anyone can rely on."""
    claim = await _get_own(db, vendor, claim_id)
    claim.status = ClaimStatus.WITHDRAWN
    claim.verification_requested_at = None
    claim.updated_at = datetime.utcnow()
    _record(db, claim, "withdrawn", actor=vendor)
    await db.commit()
    await db.refresh(claim)
    return claim


async def request_verification(db: AsyncSession, vendor: Vendor, claim_id: UUID) -> BusinessClaim:
    """Ask a human verifier to look. Declarations with nothing behind them do
    not queue — there is nothing to look at yet."""
    claim = await _get_own(db, vendor, claim_id)
    if claim.status == ClaimStatus.EXPIRED or (
            claim.expires_on and claim.expires_on < today()):
        raise StandingError("Add the renewed document first — the current one has expired")
    if not claim.evidence_url and not claim.reference:
        raise StandingError("Attach the document or give its reference number before asking for a check")
    claim.verification_requested_at = datetime.utcnow()
    claim.updated_at = datetime.utcnow()
    _record(db, claim, "verification_requested", actor=vendor)
    await notify_verifiers(db, claim, vendor)
    await db.commit()
    await db.refresh(claim)
    return claim


async def notify_verifiers(db: AsyncSession, claim: BusinessClaim, vendor: Vendor) -> int:
    """Tell the configured verifier accounts there is something in the queue.
    They are ordinary vendors with a handle in VERIFIER_HANDLES, so the request
    reaches them in the same bell as everything else."""
    handles = settings.verifier_handles
    if not handles:
        return 0
    verifiers = (await db.execute(
        select(Vendor).where(Vendor.vendor_handle.in_(handles))
    )).scalars().all()
    spec = catalog.claim_spec(claim.claim_key)
    return await notify_many(
        db, [v.id for v in verifiers if v.id != vendor.id],
        NotificationType.CLAIM_VERIFICATION_REQUESTED,
        title=f"{vendor.business_name} asked for a check: {spec.label if spec else claim.claim_key}",
        body="Open the passport queue to review the evidence.",
        sender_id=vendor.id,
        data={"claim_id": str(claim.id), "vendor": vendor.vendor_handle},
    )


# ─────────────────────────────────────────────────────────────────────────────
# verification (the operator side)
# ─────────────────────────────────────────────────────────────────────────────

async def queue(db: AsyncSession, *, limit: int = 50) -> list[dict]:
    """Claims waiting for a human, oldest request first, with the owner's
    handle so a verifier knows who is waiting."""
    rows = (await db.execute(
        select(BusinessClaim, Vendor)
        .join(Vendor, Vendor.id == BusinessClaim.vendor_id)
        .where(
            BusinessClaim.verification_requested_at.isnot(None),
            BusinessClaim.status.in_([ClaimStatus.DECLARED, ClaimStatus.DOCUMENTED]),
        )
        .order_by(BusinessClaim.verification_requested_at.asc())
        .limit(limit)
    )).all()
    out = []
    for claim, vendor in rows:
        item = claim_out(claim, mine=True)
        item["vendor"] = {
            "handle": vendor.vendor_handle,
            "business_name": vendor.business_name,
            "location": vendor.physical_location,
        }
        item["waiting_since"] = _iso(claim.verification_requested_at)
        out.append(item)
    return out


async def verify_claim(
    db: AsyncSession,
    verifier: Vendor,
    claim_id: UUID,
    *,
    method: str = ClaimMethod.REGISTRY_CHECK.value,
    expires_on=None,
    note: Optional[str] = None,
) -> BusinessClaim:
    """Record that a named human checked this document or reference.

    Refused when: the claim is the verifier's own (nobody verifies their own
    paperwork), it has been withdrawn, or it has expired (a lapsed document is
    evidence of nothing current). The verifier's note is stored verbatim and
    shown to the owner.
    """
    if method not in {m.value for m in ClaimMethod}:
        raise StandingError(f"method must be one of {', '.join(m.value for m in ClaimMethod)}")
    claim = await db.get(BusinessClaim, claim_id)
    if not claim:
        raise StandingError("Claim not found", status=404)
    if claim.vendor_id == verifier.id:
        raise StandingError("A business cannot verify its own documents", status=403)
    if claim.status == ClaimStatus.WITHDRAWN:
        raise StandingError("The owner withdrew this claim", status=409)
    if not claim.evidence_url and not claim.reference:
        raise StandingError("There is nothing to verify — no document and no reference", status=409)

    explicit = _parse_date(expires_on, "expires_on")
    seen = today()
    expiry = explicit or claim.expires_on
    if expiry and expiry < seen:
        raise StandingError("That document has already expired — ask for the renewed copy")
    if expiry is None:
        expiry = catalog.default_expiry(claim.claim_key, claim.issued_on or seen)

    claim.status = ClaimStatus.VERIFIED
    claim.method = ClaimMethod(method)
    claim.expires_on = expiry
    claim.verified_by_vendor_id = verifier.id
    claim.verified_at = datetime.utcnow()
    claim.verification_note = (note or "").strip() or None
    claim.rejection_reason = None
    claim.verification_requested_at = None
    claim.reminded_windows = []
    claim.updated_at = datetime.utcnow()
    _record(db, claim, "verified", actor=verifier, actor_type="verifier", note=claim.verification_note,
            payload={"method": method, "expires_on": _iso(expiry)})
    emit(db, "standing.claim.verified", {
        "claim_id": str(claim.id), "vendor_id": str(claim.vendor_id),
        "claim_key": claim.claim_key, "verifier_id": str(verifier.id),
    })
    spec = catalog.claim_spec(claim.claim_key)
    await create_notification(
        db, claim.vendor_id, NotificationType.CLAIM_VERIFIED,
        title=f"Verified: {spec.label if spec else claim.claim_key}",
        body=(note or "").strip() or "A verifier checked your document.",
        sender_id=verifier.id,
        data={"claim_id": str(claim.id)},
    )
    await db.commit()
    await db.refresh(claim)
    return claim


async def reject_claim(db: AsyncSession, verifier: Vendor, claim_id: UUID, reason: str) -> BusinessClaim:
    """Refuse a claim with a reason the owner can act on. The document stays on
    the record so the owner can replace it without starting over."""
    if not (reason or "").strip():
        raise StandingError("A rejection must say what was wrong — the owner cannot fix 'no'")
    claim = await db.get(BusinessClaim, claim_id)
    if not claim:
        raise StandingError("Claim not found", status=404)
    if claim.vendor_id == verifier.id:
        raise StandingError("A business cannot review its own documents", status=403)
    if claim.status == ClaimStatus.WITHDRAWN:
        raise StandingError("The owner withdrew this claim", status=409)

    claim.status = ClaimStatus.REJECTED
    claim.rejection_reason = reason.strip()[:500]
    claim.verified_by_vendor_id = None
    claim.verified_at = None
    claim.verification_requested_at = None
    claim.updated_at = datetime.utcnow()
    _record(db, claim, "rejected", actor=verifier, actor_type="verifier", note=claim.rejection_reason)
    spec = catalog.claim_spec(claim.claim_key)
    await create_notification(
        db, claim.vendor_id, NotificationType.CLAIM_REJECTED,
        title=f"Needs attention: {spec.label if spec else claim.claim_key}",
        body=claim.rejection_reason,
        sender_id=verifier.id,
        data={"claim_id": str(claim.id)},
    )
    await db.commit()
    await db.refresh(claim)
    return claim


# ─────────────────────────────────────────────────────────────────────────────
# the clock: expiry and renewal reminders (called by the scheduler loops)
# ─────────────────────────────────────────────────────────────────────────────

async def expire_due(db: AsyncSession, *, now: Optional[date] = None) -> int:
    """Flip claims whose printed date has passed to `expired`.

    Only rows a person had already stood behind (verified/documented) are
    flipped: a bare declaration going stale is not news. Idempotent — a claim
    is flipped once, and its history records the day.
    """
    day = now or today()
    rows = (await db.execute(
        select(BusinessClaim).where(
            BusinessClaim.expires_on.isnot(None),
            BusinessClaim.expires_on < day,
            BusinessClaim.status.in_([ClaimStatus.VERIFIED, ClaimStatus.DOCUMENTED]),
        )
    )).scalars().all()
    for claim in rows:
        claim.status = ClaimStatus.EXPIRED
        claim.updated_at = datetime.utcnow()
        _record(db, claim, "expired", actor_type="system",
                note=f"The document's expiry date ({claim.expires_on.isoformat()}) passed")
    if rows:
        await db.commit()
    return len(rows)


async def remind_expiring(db: AsyncSession, *, windows: tuple[int, ...] = REMINDER_WINDOWS,
                          now: Optional[date] = None) -> int:
    """Warn owners before a document lapses — 30, 14 and 7 days out, once each.

    A lapsed TCC discovered on bid day is the most expensive paperwork
    mistake a small supplier makes; this is the cheapest fix the platform has.
    Returns the number of notifications queued (the caller commits).
    """
    day = now or today()
    sent = 0
    for window in sorted(windows, reverse=True):
        horizon = day + timedelta(days=window)
        rows = (await db.execute(
            select(BusinessClaim).where(
                BusinessClaim.expires_on.isnot(None),
                BusinessClaim.expires_on >= day,
                BusinessClaim.expires_on <= horizon,
                BusinessClaim.status.in_([ClaimStatus.VERIFIED, ClaimStatus.DOCUMENTED]),
            )
        )).scalars().all()
        for claim in rows:
            already = {str(w) for w in (claim.reminded_windows or [])}
            if str(window) in already:
                continue
            spec = catalog.claim_spec(claim.claim_key)
            claim.reminded_windows = sorted(already | {str(window)})
            sent += 1 if await create_notification(
                db, claim.vendor_id, NotificationType.CLAIM_EXPIRING,
                title=f"Renew soon: {spec.label if spec else claim.claim_key}",
                body=f"Expires {claim.expires_on.isoformat()} — {window} days left. "
                     "Upload the renewed document before it lapses.",
                data={"claim_id": str(claim.id), "expires_on": claim.expires_on.isoformat()},
            ) else 0
    if sent:
        await db.commit()
    return sent


# ─────────────────────────────────────────────────────────────────────────────
# reading: the passport, and readiness against a checklist
# ─────────────────────────────────────────────────────────────────────────────

async def my_claims(db: AsyncSession, vendor_id: UUID) -> list[BusinessClaim]:
    return (await db.execute(
        select(BusinessClaim)
        .where(BusinessClaim.vendor_id == vendor_id)
        .order_by(BusinessClaim.claim_key.asc())
    )).scalars().all()


async def claim_map(db: AsyncSession, vendor_id: UUID) -> dict[str, BusinessClaim]:
    """Every claim this business has, keyed — the shape the matcher wants."""
    return {c.claim_key: c for c in await my_claims(db, vendor_id)}


async def standing_profile(db: AsyncSession, vendor_id: UUID) -> StandingProfile:
    profile = await db.get(StandingProfile, vendor_id)
    if not profile:
        profile = StandingProfile(vendor_id=vendor_id, published_checklists=[])
    return profile


async def update_standing_profile(db: AsyncSession, vendor: Vendor, *,
                                  headline: Optional[str] = None,
                                  published_checklists: Optional[list] = None) -> StandingProfile:
    """The owner's words, and which checklists may travel.

    Only real checklist keys are accepted: publishing a checklist that does
    not exist would put a promise on the passport that nothing backs.
    """
    allowed = set(catalog.CHECKLIST_INDEX)
    wanted = [k for k in (published_checklists or []) if k in allowed]
    profile = await db.get(StandingProfile, vendor.id)
    if not profile:
        profile = StandingProfile(vendor_id=vendor.id, published_checklists=[])
        db.add(profile)
    if headline is not None:
        profile.headline = (headline or "").strip()[:200] or None
    if published_checklists is not None:
        profile.published_checklists = wanted
    profile.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(profile)
    return profile


def _item_state(claims: dict[str, BusinessClaim], item: catalog.ChecklistItem,
                *, today_: Optional[date]) -> tuple[str, Optional[BusinessClaim]]:
    """met | needs_confirmation | missing — and, when one exists, the claim
    that decided it. `needs_confirmation` covers everything short of a live
    verified document: declared, documented, rejected, expired."""
    best = None
    for key in item.keys():
        claim = claims.get(key)
        if not claim:
            continue
        state = claim_state(claim, today_=today_)
        if state == ClaimStatus.VERIFIED.value:
            return "met", claim
        if state != ClaimStatus.WITHDRAWN.value and best is None:
            best = claim
    if best is not None:
        return "needs_confirmation", best
    return "missing", None


async def evaluate(db: AsyncSession, vendor_id: UUID, checklist_key: str,
                   *, today_: Optional[date] = None) -> dict:
    """Grade one checklist for one business, item by item, with next steps.

    Returns counts, not a score: `met` is verified facts, `needs_confirmation`
    is paperwork that exists but has not been checked (or has lapsed), and
    `missing` is nothing on file. Every line carries the action that would
    move it.
    """
    spec = catalog.checklist_spec(checklist_key)
    if not spec:
        raise StandingError(f"Unknown checklist '{checklist_key}'", status=404)
    claims = await claim_map(db, vendor_id)
    day = today_ or today()

    items, met, pending, missing, must_gaps = [], 0, 0, 0, []
    for item in spec.items:
        state, claim = _item_state(claims, item, today_=day)
        if state == "met":
            met += 1
        elif state == "needs_confirmation":
            pending += 1
        else:
            missing += 1
        if item.must_have and state != "met":
            must_gaps.append(item.label)

        if state == "met":
            next_step = ("Keep it current — expires " + claim.expires_on.isoformat()
                         if claim and claim.expires_on else "Nothing to do")
        elif state == "needs_confirmation" and claim is not None:
            gap = claim_state(claim, today_=day)
            if gap == ClaimStatus.EXPIRED.value:
                next_step = "Renewed document needed — this one has lapsed"
            elif gap == ClaimStatus.REJECTED.value:
                next_step = f"Fix and re-upload: {(claim.rejection_reason or '')[:160]}"
            else:
                next_step = "Ask for a check in the Passport"
        else:
            next_step = item.hint or "Add this to your Passport"

        primary = claim or (claims.get(item.keys()[0]) if item.keys() else None)
        items.append({
            "label": item.label,
            "claim_keys": list(item.keys()),
            "claim_key": primary.claim_key if primary else (item.claim or (item.any_of[0] if item.any_of else None)),
            "state": state,
            "must_have": item.must_have,
            "hint": item.hint,
            "next_step": next_step,
            "has_evidence": bool(primary and primary.evidence_url),
            "expires_on": _iso(primary.expires_on) if primary else None,
        })

    return {
        "checklist": spec.key,
        "label": spec.label,
        "audience": spec.audience,
        "note": spec.note,
        "items": items,
        "summary": {
            "total": len(spec.items),
            "met": met,
            "needs_confirmation": pending,
            "missing": missing,
        },
        "must_have_gaps": must_gaps,
        "eligible_on_paper": not must_gaps,
        "sentence": _sentence(met, pending, missing, must_gaps),
    }


def _sentence(met: int, pending: int, missing: int, must_gaps: list[str]) -> str:
    """The plain-language summary. Deliberately never says "you qualify" —
    only what the documents support."""
    parts = [f"{met} verified out of {met + pending + missing}"]
    if pending:
        parts.append(f"{pending} still need confirmation")
    if missing:
        parts.append(f"{missing} not on file")
    line = "; ".join(parts) + "."
    if must_gaps:
        line += " Required documents not yet verified: " + ", ".join(must_gaps[:4]) + "."
    return line


async def passport(db: AsyncSession, vendor: Vendor, *, public: bool) -> dict:
    """A business's standing, as its owner sees it, or as the network sees it.

    Public: live verified facts, the published checklists, and the disclaimer.
    Owner: everything, including declared rows, rejections, expiring
    documents and unpublished checklists.
    """
    claims = await my_claims(db, vendor.id)
    day = today()
    profile = await standing_profile(db, vendor.id)
    published = list(profile.published_checklists or [])

    facts, counts = [], {"verified": 0, "expired": 0, "needs_confirmation": 0}
    for claim in claims:
        state = claim_state(claim, today_=day)
        if state == ClaimStatus.WITHDRAWN.value:
            continue
        if public and state != ClaimStatus.VERIFIED.value:
            continue
        if state == ClaimStatus.VERIFIED.value:
            counts["verified"] += 1
        elif state == ClaimStatus.EXPIRED.value:
            counts["expired"] += 1
        elif state in (ClaimStatus.DECLARED.value, ClaimStatus.DOCUMENTED.value):
            counts["needs_confirmation"] += 1
        facts.append(claim_out(claim, mine=not public, today_=day))
        if len(facts) >= MAX_FACTS:
            break

    payload = {
        "vendor": {
            "handle": vendor.vendor_handle,
            "business_name": vendor.business_name,
            "categories": vendor.business_categories or [],
            "location": vendor.physical_location,
            "joined_at": _iso(vendor.joined_at),
        },
        "headline": profile.headline,
        "facts": facts,
        "counts": counts,
        "published_checklists": published,
        "disclaimer": PASSPORT_DISCLAIMER,
    }
    if not public:
        expiring = [
            claim_out(c, mine=True, today_=day) for c in claims
            if c.expires_on and day <= c.expires_on <= day + timedelta(days=30)
            and c.status in (ClaimStatus.VERIFIED, ClaimStatus.DOCUMENTED)
        ]
        payload["expiring_soon"] = expiring
        payload["readiness"] = [await evaluate(db, vendor.id, k, today_=day) for k in published]
        payload["all_checklists"] = [c.key for c in catalog.CHECKLISTS]
    else:
        payload["readiness"] = [await evaluate(db, vendor.id, k, today_=day) for k in published]
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# the fact map other modules read — the matching engine's only interface here
# ─────────────────────────────────────────────────────────────────────────────

async def verified_keys(db: AsyncSession, vendor_id: UUID, *,
                        today_: Optional[date] = None) -> set[str]:
    """Claim keys this business holds a *live verified* fact for. This is what
    a requirement is checked against — declared or lapsed paperwork never
    counts as met, which is the whole point of asking for documents."""
    return {c.claim_key for c in await my_claims(db, vendor_id)
            if claim_state(c, today_=today_) == ClaimStatus.VERIFIED.value}

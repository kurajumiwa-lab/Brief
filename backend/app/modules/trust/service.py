"""MarketTrust rules: branches, verification, tokens, reviews, points, reputation.

Rules that matter, in one place:
  · a branch is public only after a staff verification approves it;
  · a business cannot review its own branch;
  · a review may carry a one-time transaction token, which makes it a
    confirmed-transaction review (weight 1.00). Without one it is unverified
    (weight 0.25). The reviewer never sets the weight;
  · one current review per person per branch;
  · every accepted review earns the same points, whatever the star rating;
  · points are not money. The platform holds no funds and points have no cash
    value. The only use is an exchange for services listed in
    the catalogue in `catalogue.py`, which stays empty until it is approved;
  · every trust action writes an audit event in the same transaction.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.trust import catalogue
from app.modules.trust.models import (
    COUNTRY_CODES, AuditEvent, BusinessReview, BranchVerification, PointsEntry, ReviewFlag, ReviewIdentity,
    ReviewModeration, TransactionToken, TrustBranch,
)


class TrustError(Exception):
    """A rule was broken. `status` is the HTTP code the router returns."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


# ── constants ─────────────────────────────────────────────────────────────────

COUNTRIES = {
    "KE": {"name": "Kenya", "currency": "KES"},
    "ET": {"name": "Ethiopia", "currency": "ETB"},
    "UG": {"name": "Uganda", "currency": "UGX"},
}

TOKEN_TTL = timedelta(hours=2)
REVIEW_POINTS = 20  # the same for 1 star and 5 stars
REVIEW_REASON = "accepted_review"

# Verification method -> verification level (0-4) given on approval.
METHOD_LEVEL = {"community_corroboration": 2, "document": 2, "storefront_photo": 3, "field_visit": 3}

# Evidence weights. Starting values from the MarketTrust spec; a proposal, not final.
WEIGHT_CONFIRMED = 1.00
WEIGHT_UNVERIFIED = 0.25
TIER_CONFIRMED = "confirmed_token"
TIER_UNVERIFIED = "unverified"

# Customer review rules (fraud and duplicate detection). Held reviews are not refused:
# they stay out of the public rating until a staff member checks them.
VELOCITY_HOLD_PER_DAY = 3      # this many reviews in 24 hours -> held
VELOCITY_REFUSE_PER_DAY = 5    # this many already today -> refused
FAST_CODE_SECONDS = 10         # code used this soon after it was made -> held
DUPLICATE_LOOKBACK_DAYS = 60   # same wording on the same shop in this window -> held
MIN_REVIEW_KEY_LEN = 16
FLAG_TEXT = {
    "velocity_day": "Several reviews in one day",
    "code_used_too_fast": "Till code used within seconds of being made",
    "duplicate_comment": "Same wording as another review of this shop",
}

# Reputation parameters. Proposals, to be calibrated on real data.
REP_METHOD = "rep-v1"
REP_M = 5          # confidence parameter: reviews of pull toward the baseline
REP_C = 3.5        # category baseline (single category until categories are set)



# ── helpers ───────────────────────────────────────────────────────────────────

def now() -> datetime:
    return datetime.utcnow()  # naive UTC, as the models use


def hash_token(token: str) -> str:
    return hashlib.sha256(token.strip().upper().encode()).hexdigest()


def new_token() -> str:
    raw = secrets.token_hex(4).upper()
    return f"TKN-{raw[:4]}-{raw[4:]}-{secrets.token_hex(2).upper()}"


def require_country(code: str) -> str:
    code = (code or "").upper()
    if code not in COUNTRY_CODES:
        raise TrustError("Brief works in Kenya, Ethiopia and Uganda only.", status=422)
    return code


async def audit(db: AsyncSession, actor: Optional[Vendor], action: str, entity_type: str,
                entity_id: uuid.UUID, country: Optional[str], payload: Optional[dict] = None) -> None:
    db.add(AuditEvent(
        actor_vendor_id=actor.id if actor else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        country_code=country,
        payload=payload or {},
        created_at=now(),
    ))


async def _lock_vendor(db: AsyncSession, vendor_id: uuid.UUID) -> None:
    """Serialise points writes for one account inside the current transaction."""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"points:{vendor_id}"})


# ── branches ──────────────────────────────────────────────────────────────────

async def add_branch(db: AsyncSession, owner: Vendor, *, country: str, branch_name: str, address_text: str,
                     latitude: Optional[float], longitude: Optional[float]) -> TrustBranch:
    country = require_country(country)
    branch = TrustBranch(
        vendor_id=owner.id,
        country_code=country,
        branch_name=branch_name.strip(),
        address_text=address_text.strip(),
        latitude=latitude,
        longitude=longitude,
        status="pending",
        verification_level=0,
        created_at=now(),
        updated_at=now(),
    )
    db.add(branch)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise TrustError("You already have a branch with that name.", status=409)
    await audit(db, owner, "branch_added", "business_branch", branch.id, country, {"name": branch.branch_name})
    return branch


async def get_branch(db: AsyncSession, branch_id: uuid.UUID) -> TrustBranch:
    branch = await db.get(TrustBranch, branch_id)
    if branch is None or branch.status == "removed":
        raise TrustError("That branch was not found.", status=404)
    return branch


async def branches_by_status(db: AsyncSession, status: str) -> list[TrustBranch]:
    rows = await db.execute(select(TrustBranch).where(TrustBranch.status == status)
                            .order_by(TrustBranch.created_at).limit(200))
    return list(rows.scalars().all())


async def my_branches(db: AsyncSession, owner: Vendor) -> list[TrustBranch]:
    rows = await db.execute(select(TrustBranch).where(TrustBranch.vendor_id == owner.id, TrustBranch.status != "removed")
                            .order_by(TrustBranch.created_at))
    return list(rows.scalars().all())


# ── delivery ──────────────────────────────────────────────────────────────────

#: Pick-up is always available. A rider the buyer already knows is the only other option for now.
DELIVERY_OPTIONS = ("pickup", "known_rider")
#: Dialling prefix used to read a local number such as 0712 345 678 for each country.
PHONE_PREFIX = {"KE": "254", "ET": "251", "UG": "256"}


def normalise_phone(raw: str, country: str) -> str:
    """Return +<country digits> for a Kenyan, Ethiopian or Ugandan mobile number, or refuse it."""
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    prefix = PHONE_PREFIX[country]
    if digits.startswith("0") and len(digits) == 10:
        digits = prefix + digits[1:]
    if not (digits.startswith(prefix) and 11 <= len(digits) <= 13):
        raise TrustError(f"Enter the rider's phone number with the {country} code, or a local number.", status=422)
    return "+" + digits


def delivery_out(branch: TrustBranch) -> dict:
    """What a buyer sees. The fee is never here: it is agreed between buyer and rider.

    A rider's personal number is never in this public payload. There is no rider consent
    flag yet, so no public contact is possible until one exists (next milestone).
    """
    options = list(branch.delivery_options or ["pickup"])
    rider = "known_rider" in options
    return {
        "options": options,
        "rider": {"area": branch.delivery_area, "name": branch.rider_name, "phone": None}
        if rider else None,
        "fee_note": "The rider agrees the fee with you. Brief does not set or hold it.",
        "rider_checked_by_brief": False,
    }


async def set_delivery(db: AsyncSession, owner: Vendor, branch_id: uuid.UUID, *, options: list[str],
                       area: Optional[str], rider_name: Optional[str],
                       rider_phone: Optional[str]) -> TrustBranch:
    """Only the owner changes how a shop delivers. Every change is written to the audit log."""
    branch = await get_branch(db, branch_id)
    if branch.vendor_id != owner.id:
        raise TrustError("Only the owner of this shop can change how it delivers.", status=403)
    chosen = sorted(set(options or []))
    if not chosen:
        raise TrustError("Choose at least one way to deliver. Pick-up at the shop is always there.", status=422)
    unknown = [o for o in chosen if o not in DELIVERY_OPTIONS]
    if unknown:
        raise TrustError("That delivery option is not offered on Brief.", status=422)
    before = {"options": list(branch.delivery_options or ["pickup"]), "area": branch.delivery_area,
              "rider_name": branch.rider_name, "rider_phone_last3": (branch.rider_phone or "")[-3:]}
    # Pick-up is always kept, so a shop can always be found at its own door.
    final = sorted(set(chosen) | {"pickup"})
    if "known_rider" in final:
        area = (area or "").strip()
        rider_name = (rider_name or "").strip()
        if not 3 <= len(area) <= 120:
            raise TrustError("Say where the rider works, such as the town or estate (3 to 120 characters).", status=422)
        if not 2 <= len(rider_name) <= 60:
            raise TrustError("Enter the rider's name (2 to 60 characters).", status=422)
        phone = normalise_phone(rider_phone or "", branch.country_code)
        branch.delivery_options = final
        branch.delivery_area = area
        branch.rider_name = rider_name
        branch.rider_phone = phone
    else:
        branch.delivery_options = final
        branch.delivery_area = None
        branch.rider_name = None
        branch.rider_phone = None
    branch.updated_at = now()
    await db.flush()
    await audit(db, owner, "delivery_updated", "business_branch", branch.id, branch.country_code,
                {"before": before, "after": {"options": final, "area": branch.delivery_area,
                                             "rider_name": branch.rider_name,
                                             "rider_phone_last3": (branch.rider_phone or "")[-3:]}})
    return branch


async def public_branches(db: AsyncSession, *, country: Optional[str] = None, lat: Optional[float] = None,
                          lng: Optional[float] = None, radius_m: int = 5000, limit: int = 50) -> list[TrustBranch]:
    q = select(TrustBranch).where(TrustBranch.status == "active")
    if country:
        q = q.where(TrustBranch.country_code == require_country(country))
    if lat is not None and lng is not None:
        # Rough box filter first (cheap, indexed), then exact distance in Python.
        deg = radius_m / 111_000
        q = q.where(TrustBranch.latitude.between(lat - deg, lat + deg),
                    TrustBranch.longitude.between(lng - deg, lng + deg))
    limit = max(1, min(limit, 100))
    rows = list((await db.execute(q.order_by(TrustBranch.branch_name))).scalars().all())
    if lat is not None and lng is not None:
        rows = [b for b in rows if b.latitude is not None
                and distance_m(lat, lng, float(b.latitude), float(b.longitude)) <= radius_m]
    return rows[:limit]


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres (haversine)."""
    import math
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


async def decide_verification(db: AsyncSession, staff: Vendor, branch_id: uuid.UUID, *, method: str,
                              result: str, note: Optional[str]) -> TrustBranch:
    if method not in METHOD_LEVEL:
        raise TrustError("Unknown verification method.", status=422)
    if result not in ("approved", "rejected"):
        raise TrustError("Decision must be approved or rejected.", status=422)
    branch = await get_branch(db, branch_id)
    if branch.vendor_id == staff.id:
        raise TrustError("You cannot verify a branch that belongs to your own business.", status=403)
    if result == "rejected" and len((note or "").strip()) < 10:
        raise TrustError("Give a reason of at least 10 characters for a rejection.", status=422)

    db.add(BranchVerification(
        branch_id=branch.id, method=method, result=result, verifier_vendor_id=staff.id,
        note=(note or "").strip() or None, created_at=now(),
    ))
    if result == "approved":
        branch.status = "active"
        branch.verification_level = max(branch.verification_level, METHOD_LEVEL[method])
    branch.updated_at = now()
    await audit(db, staff, f"branch_{result}", "business_branch", branch.id, branch.country_code,
                {"method": method})
    return branch


# ── transaction tokens ────────────────────────────────────────────────────────

async def issue_token(db: AsyncSession, owner: Vendor, branch_id: uuid.UUID,
                      receipt_ref: str) -> tuple[str, datetime]:
    """The owner gets a one-time code for one sale. Shown once, never stored in clear."""
    receipt_ref = (receipt_ref or "").strip()
    if not 3 <= len(receipt_ref) <= 40:
        raise TrustError("Enter the receipt or sale reference (3 to 40 characters).", status=422)
    branch = await get_branch(db, branch_id)
    if branch.vendor_id != owner.id:
        raise TrustError("Only the owner of this branch can issue codes for it.", status=403)
    if branch.status != "active":
        raise TrustError("This branch is not public yet, so it cannot issue codes.", status=409)
    token = new_token()
    expires = now() + TOKEN_TTL
    db.add(TransactionToken(
        branch_id=branch.id, token_hash=hash_token(token), receipt_ref=receipt_ref,
        issued_by_vendor_id=owner.id, expires_at=expires, created_at=now(),
    ))
    await db.flush()
    await audit(db, owner, "token_issued", "business_branch", branch.id, branch.country_code,
                {"receipt_ref": receipt_ref})
    return token, expires


async def _consume_token(db: AsyncSession, branch: TrustBranch, token: str,
                         consumer_vendor_id: Optional[uuid.UUID] = None) -> tuple[uuid.UUID, datetime]:
    row = (await db.execute(select(TransactionToken).where(TransactionToken.token_hash == hash_token(token)))).scalar_one_or_none()
    if row is None or row.branch_id != branch.id:
        raise TrustError("That code does not match this branch.", status=422)
    # Atomic: only one request can flip consumed_at from NULL.
    result = await db.execute(
        update(TransactionToken)
        .where(TransactionToken.id == row.id, TransactionToken.consumed_at.is_(None),
               TransactionToken.expires_at > now())
        .values(consumed_at=now(), consumed_by_vendor_id=consumer_vendor_id)
        .returning(TransactionToken.id)
    )
    if result.first() is None:
        raise TrustError("That code has already been used or has expired.", status=422)
    return row.id, row.created_at


# ── reviews ───────────────────────────────────────────────────────────────────

async def submit_review(db: AsyncSession, reviewer: Vendor, branch_id: uuid.UUID, *, rating: int,
                        token: Optional[str]) -> BusinessReview:
    branch = await get_branch(db, branch_id)
    if branch.status != "active":
        raise TrustError("This branch is not public yet.", status=409)
    if branch.vendor_id == reviewer.id:
        raise TrustError("A business cannot review its own branch.", status=403)
    if not 1 <= rating <= 5:
        raise TrustError("Rating must be from 1 to 5 stars.", status=422)

    existing = await db.execute(select(BusinessReview.id).where(
        BusinessReview.branch_id == branch.id, BusinessReview.reviewer_vendor_id == reviewer.id,
        BusinessReview.is_current.is_(True)))
    if existing.first() is not None:
        raise TrustError("You have already rated this branch.", status=409)

    token_id, tier, weight = None, TIER_UNVERIFIED, WEIGHT_UNVERIFIED
    if token:
        token_id, _made = await _consume_token(db, branch, token, reviewer.id)
        tier, weight = TIER_CONFIRMED, WEIGHT_CONFIRMED

    review = BusinessReview(
        branch_id=branch.id, reviewer_vendor_id=reviewer.id, token_id=token_id, stage="quick",
        rating=rating, evidence_tier=tier, evidence_weight=weight, status="published",
        version=1, is_current=True, created_at=now(),
    )
    db.add(review)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise TrustError("You have already rated this branch.", status=409)

    await _lock_vendor(db, reviewer.id)
    db.add(PointsEntry(
        vendor_id=reviewer.id, country_code=branch.country_code, entry_type="earn", points=REVIEW_POINTS,
        reason_key=REVIEW_REASON, reference_type="business_review", reference_id=review.id, created_at=now(),
    ))
    await audit(db, reviewer, "review_published", "business_review", review.id, branch.country_code,
                {"rating": rating, "tier": tier})
    return review


async def branch_reviews(db: AsyncSession, branch_id: uuid.UUID, *, verified_only: bool = False) -> list[BusinessReview]:
    q = select(BusinessReview).where(BusinessReview.branch_id == branch_id, BusinessReview.is_current.is_(True),
                                     BusinessReview.status == "published")
    if verified_only:
        q = q.where(BusinessReview.evidence_tier == TIER_CONFIRMED)
    return list((await db.execute(q.order_by(BusinessReview.created_at.desc()).limit(200))).scalars().all())


# ── customer reviews (no account: a device key plus a till code) ──────────────

def _normalise_text(text_: str) -> str:
    return " ".join("".join(ch for ch in text_.lower() if ch.isalnum() or ch.isspace()).split())


async def identity_for_key(db: AsyncSession, raw_key: Optional[str]) -> ReviewIdentity:
    """The customer's device identity. Created on first use; only a hash of the key is stored."""
    if not raw_key or not (MIN_REVIEW_KEY_LEN <= len(raw_key) <= 200):
        raise TrustError("Your review profile key is missing. Reload the page and try again.", status=400)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    async def _find():
        return (await db.execute(select(ReviewIdentity).where(ReviewIdentity.key_hash == key_hash))).scalar_one_or_none()

    row = await _find()
    if row is None:
        row = ReviewIdentity(key_hash=key_hash, status="active", created_at=now())
        try:
            async with db.begin_nested():
                db.add(row)
                await db.flush()
        except IntegrityError:
            row = await _find()  # another request created it first
    if row.status != "active":
        raise TrustError("This review profile is paused. Contact Brief.", status=403)
    return row


async def customer_review(db: AsyncSession, identity: ReviewIdentity, branch_id: uuid.UUID, *,
                          token: str, service: int, product: int, overall: int,
                          comment: Optional[str]) -> tuple[BusinessReview, list[str]]:
    branch = await get_branch(db, branch_id)
    if branch.status != "active":
        raise TrustError("This shop is not public yet.", status=409)
    for label, value in (("Service", service), ("Product", product), ("Overall", overall)):
        if not 1 <= value <= 5:
            raise TrustError(f"{label} rating must be from 1 to 5 stars.", status=422)
    if not token or not token.strip():
        raise TrustError("To review a shop you need the till code it shows you after your purchase.", status=422)
    comment = (comment or "").strip()[:500] or None

    current = await db.execute(select(BusinessReview.id).where(
        BusinessReview.branch_id == branch.id, BusinessReview.review_identity_id == identity.id,
        BusinessReview.is_current.is_(True)))
    if current.first() is not None:
        raise TrustError("You have already reviewed this shop.", status=409)

    day_ago = now() - timedelta(days=1)
    today = (await db.execute(select(func.count()).select_from(BusinessReview).where(
        BusinessReview.review_identity_id == identity.id, BusinessReview.created_at >= day_ago))).scalar_one()
    if today >= VELOCITY_REFUSE_PER_DAY:
        raise TrustError("You have reviewed several shops today. Please try again tomorrow.", status=429)

    token_id, made_at = await _consume_token(db, branch, token)

    reasons: list[str] = []
    if today + 1 >= VELOCITY_HOLD_PER_DAY:
        reasons.append("velocity_day")
    if (now() - made_at).total_seconds() < FAST_CODE_SECONDS:
        reasons.append("code_used_too_fast")
    if comment and len(_normalise_text(comment)) >= 12:
        since = now() - timedelta(days=DUPLICATE_LOOKBACK_DAYS)
        others = (await db.execute(select(BusinessReview.comment).where(
            BusinessReview.branch_id == branch.id, BusinessReview.created_at >= since,
            BusinessReview.comment.isnot(None)).limit(500))).scalars().all()
        target = _normalise_text(comment)
        if any(_normalise_text(o) == target for o in others):
            reasons.append("duplicate_comment")

    review = BusinessReview(
        branch_id=branch.id, reviewer_vendor_id=None, review_identity_id=identity.id, token_id=token_id,
        stage="quick", rating=overall, service_rating=service, product_rating=product, comment=comment,
        evidence_tier=TIER_CONFIRMED, evidence_weight=WEIGHT_CONFIRMED,
        status="hidden_pending_review" if reasons else "published",
        version=1, is_current=True, created_at=now(),
    )
    db.add(review)
    try:
        await db.flush()
    except IntegrityError:
        raise TrustError("You have already reviewed this shop.", status=409)
    for reason in reasons:
        db.add(ReviewFlag(review_id=review.id, reason_key=reason, detail=FLAG_TEXT[reason], created_at=now()))
    await audit(db, None, "review_held" if reasons else "review_published", "business_review", review.id,
                branch.country_code, {"tier": TIER_CONFIRMED, "overall": overall, "flags": reasons})
    return review, reasons


async def customer_history(db: AsyncSession, identity: ReviewIdentity) -> list[dict]:
    rows = await db.execute(
        select(BusinessReview, TrustBranch).join(TrustBranch, TrustBranch.id == BusinessReview.branch_id)
        .where(BusinessReview.review_identity_id == identity.id)
        .order_by(BusinessReview.created_at.desc()).limit(200))
    out = []
    for review, branch in rows.all():
        out.append({
            "id": str(review.id), "branch_id": str(branch.id), "branch_name": branch.branch_name,
            "country_code": branch.country_code, "overall": review.rating,
            "service": review.service_rating, "product": review.product_rating,
            "status": review.status, "created_at": review.created_at.isoformat(),
        })
    return out


async def set_display_name(db: AsyncSession, identity: ReviewIdentity, name: Optional[str]) -> None:
    name = (name or "").strip()
    if name and not (2 <= len(name) <= 40):
        raise TrustError("Display name must be 2 to 40 characters, or empty.", status=422)
    identity.display_name = name or None


async def display_names(db: AsyncSession, reviews: list) -> dict:
    ids = {r.review_identity_id for r in reviews if r.review_identity_id}
    if not ids:
        return {}
    rows = await db.execute(select(ReviewIdentity.id, ReviewIdentity.display_name).where(ReviewIdentity.id.in_(ids)))
    return {str(i): n for i, n in rows.all()}


async def flagged_reviews(db: AsyncSession) -> list[dict]:
    rows = await db.execute(
        select(BusinessReview, TrustBranch).join(TrustBranch, TrustBranch.id == BusinessReview.branch_id)
        .where(BusinessReview.status == "hidden_pending_review")
        .order_by(BusinessReview.created_at).limit(200))
    out = []
    for review, branch in rows.all():
        reasons = (await db.execute(select(ReviewFlag.reason_key).where(ReviewFlag.review_id == review.id))).scalars().all()
        out.append({
            "id": str(review.id), "branch_id": str(branch.id), "branch_name": branch.branch_name,
            "country_code": branch.country_code, "overall": review.rating,
            "service": review.service_rating, "product": review.product_rating,
            "comment": review.comment, "reasons": sorted(set(reasons)),
            "created_at": review.created_at.isoformat(),
        })
    return out


async def moderate_review(db: AsyncSession, staff: Vendor, review_id: uuid.UUID, *, action: str,
                          reason: str) -> BusinessReview:
    if action not in ("publish", "remove"):
        raise TrustError("Action must be publish or remove.", status=422)
    if len((reason or "").strip()) < 10:
        raise TrustError("Give a reason of at least 10 characters.", status=422)
    review = await db.get(BusinessReview, review_id)
    if review is None:
        raise TrustError("That review was not found.", status=404)
    if review.status != "hidden_pending_review":
        raise TrustError("This review is not waiting for a check.", status=409)
    branch = await db.get(TrustBranch, review.branch_id)
    if branch.vendor_id == staff.id:
        raise TrustError("You cannot moderate reviews of your own business.", status=403)
    review.status = "published" if action == "publish" else "removed"
    db.add(ReviewModeration(review_id=review.id, staff_vendor_id=staff.id, action=action,
                            reason=reason.strip(), created_at=now()))
    await audit(db, staff, f"review_{action}ed", "business_review", review.id, branch.country_code,
                {"reason_len": len(reason.strip())})
    return review


# ── reputation ────────────────────────────────────────────────────────────────

def reputation(reviews: list) -> dict:
    """Confidence-adjusted score from the spec, computed from the reviews given.

      R_w = sum(w_i r_i) / sum(w_i)
      S   = (n R_w + m C) / (n + m),  n = sum(w_i)

    The score uses the overall rating. Service and product averages are shown beside it.
    Pure and reproducible: the same reviews always give the same `input_hash`.
    With no reviews every score is None and the message says why.
    """
    rows = sorted(
        ((str(r.id), int(r.rating), float(r.evidence_weight), r.evidence_tier,
          getattr(r, "service_rating", None), getattr(r, "product_rating", None)) for r in reviews),
        key=lambda t: t[0],
    )
    digest = hashlib.sha256(repr(rows).encode()).hexdigest()
    if not rows:
        return {
            "score": None, "raw_average": None, "verified_average": None, "service_average": None,
            "product_average": None, "confidence": None, "review_count": 0, "verified_review_count": 0,
            "method_version": REP_METHOD, "input_hash": digest, "message": "Not enough reviews yet.",
        }
    n = sum(w for _, _, w, _, _, _ in rows)
    r_w = sum(w * rating for _, rating, w, _, _, _ in rows) / n
    score = (n * r_w + REP_M * REP_C) / (n + REP_M)
    verified = [rating for _, rating, _, tier, _, _ in rows if tier == TIER_CONFIRMED]
    services = [sv for *_, sv, _ in rows if sv is not None]
    products = [pv for *_, pv in rows if pv is not None]
    return {
        "score": round(score, 2),
        "raw_average": round(sum(rating for _, rating, _, _, _, _ in rows) / len(rows), 2),
        "verified_average": round(sum(verified) / len(verified), 2) if verified else None,
        "service_average": round(sum(services) / len(services), 2) if services else None,
        "product_average": round(sum(products) / len(products), 2) if products else None,
        "confidence": round(n / (n + REP_M), 2),
        "review_count": len(rows),
        "verified_review_count": len(verified),
        "method_version": REP_METHOD,
        "input_hash": digest,
        "message": None,
    }


async def branch_reputation(db: AsyncSession, branch_id: uuid.UUID) -> dict:
    return reputation(await branch_reviews(db, branch_id))


async def business_reputation(db: AsyncSession, vendor_id: uuid.UUID) -> dict:
    rows = await db.execute(
        select(BusinessReview).join(TrustBranch, TrustBranch.id == BusinessReview.branch_id)
        .where(TrustBranch.vendor_id == vendor_id, TrustBranch.status == "active",
               BusinessReview.is_current.is_(True), BusinessReview.status == "published"))
    return reputation(list(rows.scalars().all()))


# ── points ────────────────────────────────────────────────────────────────────

async def points_summary(db: AsyncSession, vendor: Vendor) -> dict:
    total = (await db.execute(select(func.coalesce(func.sum(PointsEntry.points), 0))
                              .where(PointsEntry.vendor_id == vendor.id))).scalar_one()
    rows = await db.execute(select(PointsEntry).where(PointsEntry.vendor_id == vendor.id)
                            .order_by(PointsEntry.created_at.desc()).limit(50))
    return {
        "balance_points": int(total),
        "note": "Points are not money. They have no cash value and cannot be withdrawn.",
        "entries": [
            {"entry_type": e.entry_type, "points": e.points, "reason_key": e.reason_key,
             "country_code": e.country_code, "created_at": e.created_at.isoformat()}
            for e in rows.scalars().all()
        ],
    }


def services_for(country: Optional[str] = None) -> list[dict]:
    out = []
    if not catalogue.CATALOGUE_APPROVED:
        return []
    for key, svc in catalogue.SERVICES.items():
        if country and country not in svc.get("countries", []):
            continue
        out.append({"service_key": key, "title": svc["title"], "points_cost": svc["points_cost"],
                    "countries": svc.get("countries", [])})
    return out


async def redeem(db: AsyncSession, vendor: Vendor, *, service_key: str, country: str,
                 idempotency_key: str) -> dict:
    """Exchange points for a listed service. Same key twice = one redemption."""
    if not idempotency_key or len(idempotency_key) < 8:
        raise TrustError("A redemption needs an Idempotency-Key header of at least 8 characters.", status=400)
    country = require_country(country)
    if not catalogue.CATALOGUE_APPROVED:
        raise TrustError("Points cannot be exchanged yet. The service list is still being agreed.", status=409)
    svc = catalogue.SERVICES.get(service_key)
    if svc is None:
        raise TrustError("That service is not available for points yet.", status=404)
    if country not in svc.get("countries", []):
        raise TrustError("That service is not available in this country.", status=422)

    reference = uuid.uuid5(uuid.NAMESPACE_URL, f"redeem:{vendor.id}:{idempotency_key}")
    await _lock_vendor(db, vendor.id)

    done = (await db.execute(select(PointsEntry).where(
        PointsEntry.reference_type == "redemption", PointsEntry.reference_id == reference,
        PointsEntry.entry_type == "redeem"))).scalar_one_or_none()
    if done is not None:
        return {"status": "already_redeemed", "points_spent": -done.points, "service_key": service_key}

    balance = (await db.execute(select(func.coalesce(func.sum(PointsEntry.points), 0))
                                .where(PointsEntry.vendor_id == vendor.id))).scalar_one()
    cost = int(svc["points_cost"])
    if int(balance) < cost:
        raise TrustError(f"You need {cost} points for this. You have {int(balance)}.", status=422)

    db.add(PointsEntry(
        vendor_id=vendor.id, country_code=country, entry_type="redeem", points=-cost,
        reason_key=f"service:{service_key}", reference_type="redemption", reference_id=reference,
        created_at=now(),
    ))
    await audit(db, vendor, "points_redeemed", "points_redemption", reference, country,
                {"service_key": service_key, "points": cost})
    return {"status": "redeemed", "points_spent": cost, "service_key": service_key}

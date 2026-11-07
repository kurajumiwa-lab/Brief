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
    `REDEEMABLE_SERVICES`, which is empty until services are confirmed;
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
from app.modules.trust.models import (
    COUNTRY_CODES, AuditEvent, BusinessReview, BranchVerification, PointsEntry, TransactionToken, TrustBranch,
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

# Reputation parameters. Proposals, to be calibrated on real data.
REP_METHOD = "rep-v1"
REP_M = 5          # confidence parameter: reviews of pull toward the baseline
REP_C = 3.5        # category baseline (single category until categories are set)

# Redeemable services: real help Brief already gives, delivered by the Brief team.
# Chosen so points can never buy a trust rating or a ranking. Costs are multiples of
# the 20 points one review earns. Shape: {"service_key": {"title", "points_cost", "countries"}}
REDEEMABLE_SERVICES: dict = {
    "booking_setup": {
        "title": "Booking page set-up help from the Brief team",
        "points_cost": 40,  # two reviews
        "countries": ["KE", "ET", "UG"],
    },
    "directory_listing": {
        "title": "One seminar or course listed in the Brief directory",
        "points_cost": 100,  # five reviews
        "countries": ["KE", "ET", "UG"],
    },
}


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


async def my_branches(db: AsyncSession, owner: Vendor) -> list[TrustBranch]:
    rows = await db.execute(select(TrustBranch).where(TrustBranch.vendor_id == owner.id, TrustBranch.status != "removed")
                            .order_by(TrustBranch.created_at))
    return list(rows.scalars().all())


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

async def issue_token(db: AsyncSession, owner: Vendor, branch_id: uuid.UUID) -> tuple[str, datetime]:
    """The owner gets a one-time code to show at the till. Shown once, never stored in clear."""
    branch = await get_branch(db, branch_id)
    if branch.vendor_id != owner.id:
        raise TrustError("Only the owner of this branch can issue codes for it.", status=403)
    if branch.status != "active":
        raise TrustError("This branch is not public yet, so it cannot issue codes.", status=409)
    token = new_token()
    expires = now() + TOKEN_TTL
    db.add(TransactionToken(
        branch_id=branch.id, token_hash=hash_token(token), issued_by_vendor_id=owner.id,
        expires_at=expires, created_at=now(),
    ))
    await db.flush()
    await audit(db, owner, "token_issued", "business_branch", branch.id, branch.country_code)
    return token, expires


async def _consume_token(db: AsyncSession, reviewer: Vendor, branch: TrustBranch, token: str) -> uuid.UUID:
    row = (await db.execute(select(TransactionToken).where(TransactionToken.token_hash == hash_token(token)))).scalar_one_or_none()
    if row is None or row.branch_id != branch.id:
        raise TrustError("That code does not match this branch.", status=422)
    # Atomic: only one request can flip consumed_at from NULL.
    result = await db.execute(
        update(TransactionToken)
        .where(TransactionToken.id == row.id, TransactionToken.consumed_at.is_(None),
               TransactionToken.expires_at > now())
        .values(consumed_at=now(), consumed_by_vendor_id=reviewer.id)
        .returning(TransactionToken.id)
    )
    if result.first() is None:
        raise TrustError("That code has already been used or has expired.", status=422)
    return row.id


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
        token_id = await _consume_token(db, reviewer, branch, token)
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


# ── reputation ────────────────────────────────────────────────────────────────

def reputation(reviews: list) -> dict:
    """Confidence-adjusted score from the spec, computed from the reviews given.

      R_w = sum(w_i r_i) / sum(w_i)
      S   = (n R_w + m C) / (n + m),  n = sum(w_i)

    Pure and reproducible: the same reviews always give the same `input_hash`.
    With no reviews every score is None and the message says why.
    """
    rows = sorted(
        ((str(r.id), int(r.rating), float(r.evidence_weight), r.evidence_tier) for r in reviews),
        key=lambda t: t[0],
    )
    digest = hashlib.sha256(repr(rows).encode()).hexdigest()
    if not rows:
        return {
            "score": None, "raw_average": None, "verified_average": None, "confidence": None,
            "review_count": 0, "verified_review_count": 0, "method_version": REP_METHOD,
            "input_hash": digest, "message": "Not enough reviews yet.",
        }
    n = sum(w for _, _, w, _ in rows)
    r_w = sum(w * rating for _, rating, w, _ in rows) / n
    score = (n * r_w + REP_M * REP_C) / (n + REP_M)
    verified = [rating for _, rating, _, tier in rows if tier == TIER_CONFIRMED]
    return {
        "score": round(score, 2),
        "raw_average": round(sum(rating for _, rating, _, _ in rows) / len(rows), 2),
        "verified_average": round(sum(verified) / len(verified), 2) if verified else None,
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
    for key, svc in REDEEMABLE_SERVICES.items():
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
    svc = REDEEMABLE_SERVICES.get(service_key)
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

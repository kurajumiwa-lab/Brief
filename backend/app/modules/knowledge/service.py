"""Knowledge directory rules.

- Only a verified business can host (membership verification).
- A listing must state its promised outcomes before it is published.
- Registering is open to any signed-in business. No money is taken here; the
  price is shown only.
- Check-in is done by the organiser. Only checked-in people can review.
- After the event date the organiser writes what was delivered. Until then the
  listing shows promises only, and the page says so.
"""

import uuid
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.knowledge.models import KnowledgeListing, KnowledgeRegistration, KnowledgeReview
from app.modules.membership.models import MemberProfile
from app.modules.schedule.service import nairobi_now

# The sectors a buyer can filter by. A listing must pick exactly one.
SECTORS = [
    ("agriculture", "Agriculture"),
    ("retail", "Retail"),
    ("manufacturing", "Manufacturing"),
    ("hospitality", "Hospitality"),
    ("beauty", "Beauty and personal care"),
    ("technology", "Technology"),
    ("construction", "Construction"),
    ("transport", "Transport and logistics"),
    ("health", "Health services"),
    ("education", "Education and training"),
    ("finance", "Finance and bookkeeping"),
    ("professional", "Professional services"),
]
SECTOR_KEYS = {key for key, _ in SECTORS}
KINDS = {"seminar", "course", "mentor_session"}
MIN_PROMISE = 20
MIN_DELIVERED = 20


def _bad(message: str, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=message)


async def _is_verified(db: AsyncSession, vendor_id: uuid.UUID) -> bool:
    status = (await db.execute(select(MemberProfile.verification_status).where(
        MemberProfile.vendor_id == vendor_id))).scalar_one_or_none()
    return status == "verified"


async def get_owned(db: AsyncSession, organiser_id: uuid.UUID, listing_id: uuid.UUID) -> KnowledgeListing:
    listing = (await db.execute(select(KnowledgeListing).where(
        KnowledgeListing.id == listing_id, KnowledgeListing.organiser_vendor_id == organiser_id))).scalar_one_or_none()
    if listing is None:
        raise _bad("Listing not found.", 404)
    return listing


async def get_public(db: AsyncSession, listing_id: uuid.UUID) -> KnowledgeListing:
    listing = (await db.execute(select(KnowledgeListing).where(
        KnowledgeListing.id == listing_id,
        KnowledgeListing.status.in_(("published", "completed"))))).scalar_one_or_none()
    if listing is None:
        raise _bad("Listing not found.", 404)
    return listing


async def create_listing(db: AsyncSession, organiser_id: uuid.UUID, data: dict) -> KnowledgeListing:
    if not await _is_verified(db, organiser_id):
        raise _bad("Get verified as a business before you host a seminar, course or mentor session.", 403)
    if data["sector"] not in SECTOR_KEYS:
        raise _bad("Pick one of the listed sectors.", 422)
    if data["kind"] not in KINDS:
        raise _bad("Pick seminar, course or mentor session.", 422)
    if len(data["promised_outcomes"].strip()) < MIN_PROMISE:
        raise _bad("Say what attendees will get, in at least a sentence.", 422)
    listing = KnowledgeListing(organiser_vendor_id=organiser_id, status="draft", **data)
    db.add(listing)
    await db.flush()
    return listing


async def publish(db: AsyncSession, listing: KnowledgeListing) -> KnowledgeListing:
    if listing.status != "draft":
        raise _bad("Only a draft can be published.", 409)
    if len(listing.promised_outcomes.strip()) < MIN_PROMISE:
        raise _bad("Say what attendees will get before publishing.", 422)
    listing.status = "published"
    await db.flush()
    return listing


async def cancel(db: AsyncSession, listing: KnowledgeListing) -> KnowledgeListing:
    if listing.status not in ("draft", "published"):
        raise _bad("This listing can no longer be cancelled.", 409)
    listing.status = "cancelled"
    await db.flush()
    return listing


async def deliver(db: AsyncSession, listing: KnowledgeListing, text: str) -> KnowledgeListing:
    if listing.status != "published":
        raise _bad("Only a published listing can record what was delivered.", 409)
    if listing.starts_at is not None and listing.starts_at > nairobi_now().replace(tzinfo=None):
        raise _bad("Record what was delivered after the session date.", 400)
    if len(text.strip()) < MIN_DELIVERED:
        raise _bad("Describe what was actually delivered, in at least a sentence.", 422)
    listing.delivered_outcomes = text.strip()
    listing.delivered_at = datetime.utcnow()
    listing.status = "completed"
    await db.flush()
    return listing


async def _registration(db: AsyncSession, listing_id: uuid.UUID, vendor_id: uuid.UUID):
    return (await db.execute(select(KnowledgeRegistration).where(
        KnowledgeRegistration.listing_id == listing_id,
        KnowledgeRegistration.vendor_id == vendor_id))).scalar_one_or_none()


async def register(db: AsyncSession, listing: KnowledgeListing, vendor_id: uuid.UUID) -> KnowledgeRegistration:
    if listing.status != "published":
        raise _bad("Registration is closed for this listing.", 409)
    if listing.organiser_vendor_id == vendor_id:
        raise _bad("You are hosting this listing.", 400)
    existing = await _registration(db, listing.id, vendor_id)
    if existing is not None:
        return existing
    if listing.capacity is not None:
        taken = (await db.execute(select(func.count()).select_from(KnowledgeRegistration).where(
            KnowledgeRegistration.listing_id == listing.id))).scalar_one()
        if taken >= listing.capacity:
            raise _bad("This listing is full.", 409)
    row = KnowledgeRegistration(listing_id=listing.id, vendor_id=vendor_id)
    db.add(row)
    await db.flush()
    return row


async def unregister(db: AsyncSession, listing: KnowledgeListing, vendor_id: uuid.UUID) -> bool:
    row = await _registration(db, listing.id, vendor_id)
    if row is None:
        return False
    if row.checked_in_at is not None:
        raise _bad("You were checked in, so you cannot leave this listing.", 409)
    await db.delete(row)
    await db.flush()
    return True


async def check_in(db: AsyncSession, listing: KnowledgeListing, vendor_id: uuid.UUID) -> KnowledgeRegistration:
    row = await _registration(db, listing.id, vendor_id)
    if row is None:
        raise _bad("That business is not registered for this listing.", 404)
    if row.checked_in_at is None:
        row.checked_in_at = datetime.utcnow()
        await db.flush()
    return row


async def review(db: AsyncSession, listing: KnowledgeListing, vendor_id: uuid.UUID,
                 rating: int, comment: str | None) -> KnowledgeReview:
    if listing.organiser_vendor_id == vendor_id:
        raise _bad("You cannot review your own listing.", 400)
    row = await _registration(db, listing.id, vendor_id)
    if row is None or row.checked_in_at is None:
        raise _bad("Only people who attended (were checked in) can review.", 403)
    existing = (await db.execute(select(KnowledgeReview).where(
        KnowledgeReview.listing_id == listing.id, KnowledgeReview.vendor_id == vendor_id))).scalar_one_or_none()
    if existing is not None:
        raise _bad("You have already reviewed this listing.", 409)
    item = KnowledgeReview(listing_id=listing.id, vendor_id=vendor_id, rating=rating,
                           comment=(comment or "").strip() or None)
    db.add(item)
    await db.flush()
    return item


async def browse(db: AsyncSession, sector: str | None = None, kind: str | None = None,
                 q: str | None = None, limit: int = 30) -> list[dict]:
    """Public directory. Published and completed listings only; drafts and cancelled stay hidden."""
    rating_avg = select(func.avg(KnowledgeReview.rating)).where(
        KnowledgeReview.listing_id == KnowledgeListing.id).scalar_subquery()
    review_count = select(func.count(KnowledgeReview.id)).where(
        KnowledgeReview.listing_id == KnowledgeListing.id).scalar_subquery()
    attendees = select(func.count(KnowledgeRegistration.id)).where(
        KnowledgeRegistration.listing_id == KnowledgeListing.id).scalar_subquery()
    query = (
        select(KnowledgeListing, Vendor, rating_avg.label("avg"), review_count.label("reviews"),
               attendees.label("attendees"),
               exists().where(MemberProfile.vendor_id == Vendor.id,
                              MemberProfile.verification_status == "verified").label("verified"))
        .join(Vendor, Vendor.id == KnowledgeListing.organiser_vendor_id)
        .where(KnowledgeListing.status.in_(("published", "completed")))
        .order_by(KnowledgeListing.status.asc(), KnowledgeListing.starts_at.asc().nulls_last(),
                  KnowledgeListing.created_at.desc())
        .limit(min(max(limit, 1), 100))
    )
    if sector:
        query = query.where(KnowledgeListing.sector == sector)
    if kind:
        query = query.where(KnowledgeListing.kind == kind)
    if q and q.strip():
        query = query.where(KnowledgeListing.title.ilike(f"%{q.strip()}%"))
    rows = (await db.execute(query)).all()
    return [listing_card(l, v, avg, reviews, attendees, {v.id} if verified else set())
            for l, v, avg, reviews, attendees, verified in rows]


def listing_card(listing: KnowledgeListing, organiser: Vendor, avg, reviews, attendees, verified_ids) -> dict:
    return {
        "id": str(listing.id),
        "kind": listing.kind,
        "title": listing.title,
        "sector": listing.sector,
        "summary": listing.summary,
        "price_kes": listing.price_kes,
        "starts_at": listing.starts_at.isoformat() if listing.starts_at else None,
        "location": listing.location,
        "capacity": listing.capacity,
        "spaces_left": (listing.capacity - (attendees or 0)) if listing.capacity else None,
        "status": listing.status,
        "promised_outcomes": listing.promised_outcomes,
        "delivered_outcomes": listing.delivered_outcomes,
        "delivered_at": listing.delivered_at.isoformat() if listing.delivered_at else None,
        "rating": round(float(avg), 1) if avg is not None else None,
        "review_count": int(reviews or 0),
        "attendee_count": int(attendees or 0),
        "organiser": {
            "id": str(organiser.id),
            "handle": organiser.vendor_handle,
            "name": organiser.business_name,
            "verified": organiser.id in verified_ids,
        },
    }


async def detail(db: AsyncSession, listing: KnowledgeListing) -> dict:
    organiser = (await db.execute(select(Vendor).where(
        Vendor.id == listing.organiser_vendor_id))).scalar_one()
    avg, reviews = (await db.execute(select(func.avg(KnowledgeReview.rating), func.count(KnowledgeReview.id))
                                     .where(KnowledgeReview.listing_id == listing.id))).one()
    attendees = (await db.execute(select(func.count(KnowledgeRegistration.id)).where(
        KnowledgeRegistration.listing_id == listing.id))).scalar_one()
    verified = await _is_verified(db, organiser.id)
    card = listing_card(listing, organiser, avg, reviews, attendees, {organiser.id} if verified else set())
    rows = (await db.execute(
        select(KnowledgeReview, Vendor.business_name)
        .join(Vendor, Vendor.id == KnowledgeReview.vendor_id)
        .where(KnowledgeReview.listing_id == listing.id)
        .order_by(KnowledgeReview.created_at.desc()).limit(50)
    )).all()
    card["reviews"] = [{"rating": r.rating, "comment": r.comment, "by": name,
                        "created_at": r.created_at.isoformat()} for r, name in rows]
    card["record_status"] = (
        "Promised only. The organiser has not yet recorded what was delivered."
        if listing.status == "published" else "Delivered record published by the organiser."
    )
    return card


async def my_state(db: AsyncSession, listing: KnowledgeListing, vendor_id: uuid.UUID) -> dict:
    reg = await _registration(db, listing.id, vendor_id)
    reviewed = (await db.execute(select(exists().where(
        KnowledgeReview.listing_id == listing.id, KnowledgeReview.vendor_id == vendor_id)))).scalar()
    return {
        "is_organiser": listing.organiser_vendor_id == vendor_id,
        "registered": reg is not None,
        "checked_in": bool(reg and reg.checked_in_at),
        "can_review": bool(reg and reg.checked_in_at) and not reviewed and listing.organiser_vendor_id != vendor_id,
        "reviewed": bool(reviewed),
    }

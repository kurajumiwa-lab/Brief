"""
Vendor-list reviews (Directive v2.1 §4.2).

A list's reputation is written by the vendors who are actually on it. Only an
approved member may post one review (one per vendor per list); the poster may
edit or delete their own; the network marks reviews helpful. Every write
refreshes the denormalised `avg_rating` / `review_count` on the list so browse
can rank on them without an aggregate join.

    POST   /api/vendor-lists/{id}/reviews                 write your review
    GET    /api/vendor-lists/{id}/reviews                 read them (+distribution)
    PUT    /api/vendor-lists/{id}/reviews/mine            edit your review
    DELETE /api/vendor-lists/{id}/reviews/mine            remove your review
    POST   /api/vendor-lists/{id}/reviews/{review_id}/helpful
    GET    /api/vendor-lists/{id}/rating                  the aggregate only
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.notification import NotificationType
from app.models.reviews import VendorListReview
from app.models.vendor import Vendor
from app.models.vendor_list import Patron, VendorList, VendorListMembership
from app.routes.auth import get_current_vendor
from app.services.notification_service import create_notification

router = APIRouter()


class ReviewCreate(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    title: Optional[str] = Field(None, max_length=160)
    body: Optional[str] = Field(None, max_length=4000)


def _review_out(review: VendorListReview, reviewer: Vendor, me: Vendor) -> dict:
    return {
        "id": str(review.id),
        "rating": review.rating,
        "title": review.title,
        "body": review.body,
        "verified_member": review.verified_member,
        "helpful_count": review.helpful_count,
        "created_at": review.created_at.isoformat(),
        "updated_at": review.updated_at.isoformat() if review.updated_at else None,
        "reviewer": {
            "vendor_id": str(reviewer.id),
            "vendor_handle": reviewer.vendor_handle,
            "business_name": reviewer.business_name,
            "business_categories": reviewer.business_categories or [],
            "is_patron": reviewer.is_patron,
        },
        "mine": reviewer.id == me.id,
        "can_edit": reviewer.id == me.id,
        "marked_helpful": str(me.id) in [str(v) for v in (review.helpful_voters or [])],
    }


async def _membership(db: AsyncSession, list_id: UUID, vendor_id: UUID) -> Optional[VendorListMembership]:
    return (await db.execute(select(VendorListMembership).where(
        VendorListMembership.vendor_list_id == list_id,
        VendorListMembership.vendor_id == vendor_id,
    ))).scalar_one_or_none()


async def _refresh_aggregate(db: AsyncSession, vendor_list_id: UUID) -> tuple[float, int]:
    avg, count = (await db.execute(
        select(func.avg(VendorListReview.rating), func.count(VendorListReview.id))
        .where(VendorListReview.vendor_list_id == vendor_list_id)
    )).one()
    vlist = await db.get(VendorList, vendor_list_id)
    if vlist is not None:
        vlist.avg_rating = round(float(avg or 0), 2)
        vlist.review_count = int(count or 0)
    return vlist.avg_rating if vlist else 0.0, int(count or 0)


@router.get("/{list_id}/reviews")
async def list_reviews(
    list_id: UUID,
    sort: str = Query("recent", pattern="^(recent|rating|helpful)$"),
    limit: int = Query(50, ge=1, le=200),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Reviews of a list, with the rating distribution and your own review."""
    vlist = await db.get(VendorList, list_id)
    if not vlist:
        raise HTTPException(404, "Vendor list not found")

    order = {
        "recent": VendorListReview.created_at.desc(),
        "rating": VendorListReview.rating.desc(),
        "helpful": VendorListReview.helpful_count.desc(),
    }[sort]
    rows = (await db.execute(
        select(VendorListReview, Vendor)
        .join(Vendor, Vendor.id == VendorListReview.reviewer_vendor_id)
        .where(VendorListReview.vendor_list_id == list_id)
        .order_by(order).limit(limit)
    )).all()

    distribution = {str(star): 0 for star in range(5, 0, -1)}
    counts = (await db.execute(
        select(VendorListReview.rating, func.count(VendorListReview.id))
        .where(VendorListReview.vendor_list_id == list_id).group_by(VendorListReview.rating)
    )).all()
    for rating, count in counts:
        distribution[str(rating)] = int(count)

    membership = await _membership(db, list_id, vendor.id)
    can_review = bool(membership and membership.status == "approved") and not any(
        r.reviewer_vendor_id == vendor.id for r, _ in rows)

    return {
        "list_id": str(vlist.id),
        "list_name": vlist.name,
        "avg_rating": vlist.avg_rating,
        "review_count": vlist.review_count,
        "distribution": distribution,
        "can_review": can_review,
        "my_status": membership.status if membership else None,
        "reviews": [_review_out(r, v, vendor) for r, v in rows],
    }


@router.get("/{list_id}/rating")
async def list_rating(
    list_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    vlist = await db.get(VendorList, list_id)
    if not vlist:
        raise HTTPException(404, "Vendor list not found")
    return {"list_id": str(vlist.id), "avg_rating": vlist.avg_rating, "review_count": vlist.review_count}


@router.post("/{list_id}/reviews", status_code=201)
async def write_review(
    list_id: UUID,
    data: ReviewCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Only an approved member of the list may review it."""
    vlist = await db.get(VendorList, list_id)
    if not vlist:
        raise HTTPException(404, "Vendor list not found")

    membership = await _membership(db, list_id, vendor.id)
    if not membership or membership.status != "approved":
        raise HTTPException(403, "Only vendors on the list can review it")

    existing = (await db.execute(select(VendorListReview).where(
        VendorListReview.vendor_list_id == list_id,
        VendorListReview.reviewer_vendor_id == vendor.id,
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "You have already reviewed this list — edit your review instead")

    review = VendorListReview(
        vendor_list_id=list_id,
        reviewer_vendor_id=vendor.id,
        rating=data.rating,
        title=data.title,
        body=data.body,
        verified_member=True,
    )
    db.add(review)
    await db.flush()
    avg, count = await _refresh_aggregate(db, list_id)

    if vlist.patron_id:
        patron = await db.get(Patron, vlist.patron_id)
        if patron:
            await create_notification(
                db, patron.vendor_id, NotificationType.LIST_REVIEW,
                f"@{vendor.vendor_handle} rated {vlist.name} {data.rating}/5",
                (data.title or data.body or "A member shared their experience.")[:200],
                sender_id=vendor.id,
                data={"list_id": vlist.id, "review_id": review.id, "rating": data.rating,
                      "avg_rating": avg, "review_count": count},
            )
    await db.commit()
    return {"message": "Review recorded", "review_id": str(review.id),
            "avg_rating": avg, "review_count": count}


@router.get("/{list_id}/reviews/mine")
async def my_review(
    list_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Your own review of this list — 404 when you have not written one yet."""
    review = (await db.execute(select(VendorListReview).where(
        VendorListReview.vendor_list_id == list_id,
        VendorListReview.reviewer_vendor_id == vendor.id,
    ))).scalar_one_or_none()
    if not review:
        raise HTTPException(404, "You have not reviewed this list")
    return _review_out(review, vendor, vendor)


@router.put("/{list_id}/reviews/mine")
async def edit_review(
    list_id: UUID,
    data: ReviewCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    review = (await db.execute(select(VendorListReview).where(
        VendorListReview.vendor_list_id == list_id,
        VendorListReview.reviewer_vendor_id == vendor.id,
    ))).scalar_one_or_none()
    if not review:
        raise HTTPException(404, "You have not reviewed this list")
    review.rating = data.rating
    review.title = data.title
    review.body = data.body
    review.updated_at = datetime.utcnow()
    avg, count = await _refresh_aggregate(db, list_id)
    await db.commit()
    return {"message": "Review updated", "avg_rating": avg, "review_count": count}


@router.delete("/{list_id}/reviews/mine")
async def delete_review(
    list_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    review = (await db.execute(select(VendorListReview).where(
        VendorListReview.vendor_list_id == list_id,
        VendorListReview.reviewer_vendor_id == vendor.id,
    ))).scalar_one_or_none()
    if not review:
        raise HTTPException(404, "You have not reviewed this list")
    await db.delete(review)
    await db.flush()
    avg, count = await _refresh_aggregate(db, list_id)
    await db.commit()
    return {"message": "Review removed", "avg_rating": avg, "review_count": count}


@router.post("/{list_id}/reviews/{review_id}/helpful")
async def mark_helpful(
    list_id: UUID,
    review_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Mark someone else's review as useful — once per vendor, ever."""
    review = await db.get(VendorListReview, review_id)
    if not review or review.vendor_list_id != list_id:
        raise HTTPException(404, "Review not found")
    if review.reviewer_vendor_id == vendor.id:
        raise HTTPException(400, "You cannot mark your own review helpful")

    voters = [str(v) for v in (review.helpful_voters or [])]
    if str(vendor.id) in voters:
        raise HTTPException(400, "You already marked this review helpful")
    voters.append(str(vendor.id))
    review.helpful_voters = voters
    review.helpful_count = len(voters)
    await db.commit()
    return {"message": "Marked helpful", "helpful_count": review.helpful_count}

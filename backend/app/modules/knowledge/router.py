"""Knowledge directory API.

Public (no account):
    GET  /api/knowledge/sectors
    GET  /api/knowledge/listings               browse published and completed listings
    GET  /api/knowledge/listings/{id}          one listing, its record and reviews

Signed in:
    GET  /api/knowledge/mine                   listings I host, including drafts
    POST /api/knowledge/listings               create a draft (verified businesses only)
    POST /api/knowledge/listings/{id}/publish
    POST /api/knowledge/listings/{id}/cancel
    POST /api/knowledge/listings/{id}/deliver  record what was delivered (after the session date)
    GET  /api/knowledge/listings/{id}/attendees        organiser only
    POST /api/knowledge/listings/{id}/check-in/{vendor_id}   organiser only
    POST /api/knowledge/listings/{id}/register
    DELETE /api/knowledge/listings/{id}/register       only before check-in
    POST /api/knowledge/listings/{id}/review
    GET  /api/knowledge/listings/{id}/me               my state for this listing
"""

import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.knowledge import service
from app.modules.knowledge.models import KnowledgeListing, KnowledgeRegistration
from app.routes.auth import get_current_vendor

router = APIRouter()


class ListingIn(BaseModel):
    kind: Literal["seminar", "course", "mentor_session"] = "seminar"
    title: str = Field(min_length=4, max_length=200)
    sector: str = Field(min_length=2, max_length=40)
    summary: Optional[str] = Field(default=None, max_length=2000)
    price_kes: Optional[int] = Field(default=None, ge=0)
    starts_at: Optional[datetime] = None
    location: Optional[str] = Field(default=None, max_length=300)
    capacity: Optional[int] = Field(default=None, ge=1, le=5000)
    promised_outcomes: str = Field(min_length=20, max_length=4000)


class DeliverIn(BaseModel):
    delivered_outcomes: str = Field(min_length=20, max_length=4000)


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=1000)


def _naive(value: Optional[datetime]) -> Optional[datetime]:
    return value.replace(tzinfo=None) if value is not None and value.tzinfo is not None else value


@router.get("/sectors")
async def sectors():
    return {"sectors": [{"key": k, "label": label} for k, label in service.SECTORS]}


@router.get("/listings")
async def browse(sector: Optional[str] = None,
                 kind: Optional[Literal["seminar", "course", "mentor_session"]] = None,
                 q: Optional[str] = Query(None, max_length=120),
                 limit: int = Query(30, ge=1, le=100),
                 db: AsyncSession = Depends(get_db)):
    return {"listings": await service.browse(db, sector=sector, kind=kind, q=q, limit=limit)}


@router.get("/listings/{listing_id}")
async def listing(listing_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    item = await service.get_public(db, listing_id)
    return await service.detail(db, item)


@router.get("/mine")
async def mine(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(KnowledgeListing).where(
        KnowledgeListing.organiser_vendor_id == vendor.id)
        .order_by(KnowledgeListing.created_at.desc()).limit(100))).scalars().all()
    return {"listings": [{"id": str(l.id), "title": l.title, "status": l.status, "sector": l.sector,
                          "kind": l.kind, "starts_at": l.starts_at.isoformat() if l.starts_at else None}
                         for l in rows]}


@router.post("/listings", status_code=201)
async def create(data: ListingIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    values = data.model_dump()
    values["starts_at"] = _naive(values["starts_at"])
    item = await service.create_listing(db, vendor.id, values)
    await db.commit()
    return {"id": str(item.id), "status": item.status}


@router.post("/listings/{listing_id}/publish")
async def publish(listing_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    item = await service.get_owned(db, vendor.id, listing_id)
    await service.publish(db, item)
    await db.commit()
    return {"id": str(item.id), "status": item.status}


@router.post("/listings/{listing_id}/cancel")
async def cancel(listing_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    item = await service.get_owned(db, vendor.id, listing_id)
    await service.cancel(db, item)
    await db.commit()
    return {"id": str(item.id), "status": item.status}


@router.post("/listings/{listing_id}/deliver")
async def deliver(listing_id: uuid.UUID, data: DeliverIn, vendor: Vendor = Depends(get_current_vendor),
                  db: AsyncSession = Depends(get_db)):
    item = await service.get_owned(db, vendor.id, listing_id)
    await service.deliver(db, item, data.delivered_outcomes)
    await db.commit()
    return {"id": str(item.id), "status": item.status}


@router.get("/listings/{listing_id}/attendees")
async def attendees(listing_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                    db: AsyncSession = Depends(get_db)):
    item = await service.get_owned(db, vendor.id, listing_id)
    rows = (await db.execute(
        select(KnowledgeRegistration, Vendor.business_name, Vendor.id)
        .join(Vendor, Vendor.id == KnowledgeRegistration.vendor_id)
        .where(KnowledgeRegistration.listing_id == item.id)
        .order_by(KnowledgeRegistration.registered_at.asc())
    )).all()
    return {"attendees": [{"vendor_id": str(vid), "business": name,
                           "checked_in": reg.checked_in_at is not None} for reg, name, vid in rows]}


@router.post("/listings/{listing_id}/check-in/{attendee_id}")
async def check_in(listing_id: uuid.UUID, attendee_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    item = await service.get_owned(db, vendor.id, listing_id)
    row = await service.check_in(db, item, attendee_id)
    await db.commit()
    return {"vendor_id": str(attendee_id), "checked_in": row.checked_in_at is not None}


@router.post("/listings/{listing_id}/register")
async def register(listing_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    item = await service.get_public(db, listing_id)
    await service.register(db, item, vendor.id)
    await db.commit()
    return await service.my_state(db, item, vendor.id)


@router.delete("/listings/{listing_id}/register")
async def unregister(listing_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                     db: AsyncSession = Depends(get_db)):
    item = await service.get_public(db, listing_id)
    removed = await service.unregister(db, item, vendor.id)
    await db.commit()
    return {"removed": removed}


@router.post("/listings/{listing_id}/review", status_code=201)
async def review(listing_id: uuid.UUID, data: ReviewIn, vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    item = await service.get_public(db, listing_id)
    await service.review(db, item, vendor.id, data.rating, data.comment)
    await db.commit()
    return await service.my_state(db, item, vendor.id)


@router.get("/listings/{listing_id}/me")
async def my_state(listing_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                   db: AsyncSession = Depends(get_db)):
    item = await service.get_public(db, listing_id)
    return await service.my_state(db, item, vendor.id)

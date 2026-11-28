"""Seller-reported quotes: no independent verification or payment implied."""
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import or_, select, update, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor, VendorRole
from app.modules.market_opportunities.models import MarketOpportunity, OpportunityConversation
from app.modules.outside.models import OutsideContentReport
from app.routes.auth import get_current_vendor
from app.models.chat import ChatRoom, ChatRoomType, chat_room_participants
from app.services.discovery_visibility import discoverable

router = APIRouter()
Text160 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Unit = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Amount = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2, allow_inf_nan=False)]
LIFETIME = timedelta(days=7)


class OpportunityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Text160
    location: Text160
    quantity: Amount
    unit: Unit
    price_kes: Amount


class StatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["available", "reserved", "unavailable"]


def serialize(row, seller, viewer):
    stale = row.updated_at < datetime.utcnow() - LIFETIME
    discoverable_owner = (seller.current_role != VendorRole.DORMANT and
                          (seller.public_page or {}).get("discoverable", True) is not False and
                          seller.fraud_suspended_at is None)
    return {"id": str(row.id), "title": row.title, "location": row.location,
            "quantity": str(row.quantity), "unit": row.unit, "price_kes": str(row.price_kes),
            "updated_at": row.updated_at.isoformat() + "Z",
            "expires_at": (row.updated_at + LIFETIME).isoformat() + "Z",
            "source": "Seller-reported", "status": "unavailable" if not row.active else "reserved" if row.reserved else "available",
            "stale": stale, "visible_to_others": bool(row.active and not stale and discoverable_owner),
            "seller": {"id": str(seller.id), "name": seller.business_name, "handle": seller.vendor_handle},
            "is_owner": seller.id == viewer.id}


async def owner_row(db, opportunity_id, vendor):
    row = (await db.execute(select(MarketOpportunity).where(
        MarketOpportunity.id == opportunity_id, MarketOpportunity.seller_id == vendor.id).with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Opportunity not found")
    return row


def blocked_by(viewer):
    return select(OutsideContentReport.target_vendor_id).where(
        OutsideContentReport.reporter_vendor_id == viewer.id,
        OutsideContentReport.is_block.is_(True),
        OutsideContentReport.target_vendor_id.is_not(None))


@router.post("", status_code=201)
async def create(body: OpportunityIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row = MarketOpportunity(seller_id=vendor.id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return serialize(row, vendor, vendor)


@router.get("")
async def browse(q: str = Query("", max_length=160), market: str = Query("", max_length=160),
                 offset: int = Query(0, ge=0, le=10000), limit: int = Query(20, ge=1, le=50),
                 vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    stmt = (select(MarketOpportunity, Vendor).join(Vendor, Vendor.id == MarketOpportunity.seller_id)
            .where(MarketOpportunity.active.is_(True), MarketOpportunity.updated_at >= datetime.utcnow() - LIFETIME,
                   or_(discoverable(Vendor), Vendor.id == vendor.id), Vendor.fraud_suspended_at.is_(None),
                   Vendor.id.not_in(blocked_by(vendor))))
    def pattern(value):
        return "%" + value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    if q.strip():
        stmt = stmt.where(or_(MarketOpportunity.title.ilike(pattern(q), escape="\\"),
                              MarketOpportunity.location.ilike(pattern(q), escape="\\")))
    if market.strip():
        stmt = stmt.where(MarketOpportunity.location.ilike(pattern(market), escape="\\"))
    rows = (await db.execute(stmt.order_by(MarketOpportunity.updated_at.desc(), MarketOpportunity.id.desc()).offset(offset).limit(limit + 1))).all()
    return {"items": [serialize(o, s, vendor) for o, s in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


@router.get("/mine")
async def mine(offset: int = Query(0, ge=0, le=10000), limit: int = Query(20, ge=1, le=50),
               vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(MarketOpportunity).where(MarketOpportunity.seller_id == vendor.id)
            .order_by(MarketOpportunity.updated_at.desc(), MarketOpportunity.id.desc()).offset(offset).limit(limit + 1))).scalars().all()
    return {"items": [serialize(row, vendor, vendor) for row in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


@router.put("/{opportunity_id}")
async def edit(opportunity_id: UUID, body: OpportunityIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row = await owner_row(db, opportunity_id, vendor)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    # Saving is an explicit confirmation of the quote, but never reopens a closed offer.
    row.updated_at = datetime.utcnow()
    await db.commit()
    return serialize(row, vendor, vendor)


@router.post("/{opportunity_id}/renew")
async def renew(opportunity_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row = await owner_row(db, opportunity_id, vendor)
    row.active, row.reserved, row.updated_at = True, False, datetime.utcnow()
    await db.commit()
    return serialize(row, vendor, vendor)


@router.put("/{opportunity_id}/status")
async def change_status(opportunity_id: UUID, body: StatusIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row = await owner_row(db, opportunity_id, vendor)
    if not row.active and body.status != "unavailable":
        raise HTTPException(409, "Renew the opportunity to make it available again.")
    # State changes do not assert the price is fresh; preserve the confirmation timestamp.
    await db.execute(update(MarketOpportunity).where(MarketOpportunity.id == row.id).values(
        active=body.status != "unavailable", reserved=body.status == "reserved", updated_at=row.updated_at))
    await db.commit()
    await db.refresh(row)
    return serialize(row, vendor, vendor)


@router.delete("/{opportunity_id}", status_code=204)
async def close(opportunity_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row = await owner_row(db, opportunity_id, vendor)
    await db.execute(update(MarketOpportunity).where(MarketOpportunity.id == row.id).values(active=False, reserved=False, updated_at=row.updated_at))
    await db.commit()


@router.get("/metrics")
async def metrics(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    # Aggregates are seller-only. Drafts/room opens are deliberately excluded.
    rows = (await db.execute(select(
        OpportunityConversation.opportunity_id,
        func.count().label("enquiries"),
        func.sum(case((OpportunityConversation.first_reply_at.is_not(None), 1), else_=0)).label("replies"),
        func.sum(case((OpportunityConversation.buyer_confirmed_at.is_not(None) & OpportunityConversation.seller_confirmed_at.is_not(None), 1), else_=0)).label("confirmed_sales"),
        func.sum(OpportunityConversation.buyer_messages + OpportunityConversation.seller_messages).label("messages"),
    ).where(OpportunityConversation.seller_id == vendor.id, OpportunityConversation.first_enquiry_at.is_not(None))
      .group_by(OpportunityConversation.opportunity_id))).all()
    return {"items": [{"opportunity_id": str(r.opportunity_id), "enquiries": r.enquiries,
                       "replies": int(r.replies or 0), "confirmed_sales": int(r.confirmed_sales or 0),
                       "messages": int(r.messages or 0)} for r in rows]}


def conversation_view(c, viewer):
    return {"room_id": str(c.room_id), "opportunity_id": str(c.opportunity_id), "title": c.title_snapshot,
            "has_enquiry": c.first_enquiry_at is not None, "has_reply": c.first_reply_at is not None,
            "buyer_confirmed": c.buyer_confirmed_at is not None, "seller_confirmed": c.seller_confirmed_at is not None,
            "my_role": "buyer" if c.buyer_id == viewer.id else "seller"}


async def participant_conversation(db, room_id, vendor, lock=False):
    query = select(OpportunityConversation).where(OpportunityConversation.room_id == room_id,
        or_(OpportunityConversation.buyer_id == vendor.id, OpportunityConversation.seller_id == vendor.id))
    if lock:
        query = query.with_for_update()
    row = (await db.execute(query)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Opportunity conversation not found")
    return row


@router.get("/conversations/{room_id}")
async def get_conversation(room_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return conversation_view(await participant_conversation(db, room_id, vendor), vendor)


@router.put("/conversations/{room_id}/sale")
async def confirm_sale(room_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    c = await participant_conversation(db, room_id, vendor, lock=True)
    if not c.first_enquiry_at:
        raise HTTPException(409, "Send an enquiry before reporting a sale.")
    if c.buyer_id == vendor.id and c.buyer_confirmed_at is None:
        c.buyer_confirmed_at = datetime.utcnow()
    if c.seller_id == vendor.id and c.seller_confirmed_at is None:
        c.seller_confirmed_at = datetime.utcnow()
    await db.commit()
    return conversation_view(c, vendor)


@router.delete("/conversations/{room_id}/sale")
async def withdraw_sale(room_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    c = await participant_conversation(db, room_id, vendor, lock=True)
    if c.buyer_id == vendor.id:
        c.buyer_confirmed_at = None
    else:
        c.seller_confirmed_at = None
    await db.commit()
    return conversation_view(c, vendor)


@router.post("/{opportunity_id}/enquiry")
async def enquiry(opportunity_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    # Lock serializes creation for this opportunity, avoiding duplicate rooms for the same buyer.
    row = (await db.execute(select(MarketOpportunity, Vendor).join(Vendor, Vendor.id == MarketOpportunity.seller_id)
           .where(MarketOpportunity.id == opportunity_id, MarketOpportunity.active.is_(True),
                  MarketOpportunity.reserved.is_(False), MarketOpportunity.updated_at >= datetime.utcnow() - LIFETIME,
                  Vendor.id != vendor.id, discoverable(Vendor), Vendor.fraud_suspended_at.is_(None),
                  Vendor.id.not_in(blocked_by(vendor))).with_for_update(of=MarketOpportunity))).one_or_none()
    if row is None:
        raise HTTPException(404, "This opportunity is no longer available. Refresh the market list.")
    offer, seller = row
    c = (await db.execute(select(OpportunityConversation).where(
        OpportunityConversation.opportunity_id == offer.id, OpportunityConversation.buyer_id == vendor.id))).scalar_one_or_none()
    if c is None:
        room = ChatRoom(name=f"Opportunity: {offer.title}", room_type=ChatRoomType.DIRECT,
                        created_by=vendor.id, participant_count=2)
        db.add(room)
        await db.flush()
        await db.execute(chat_room_participants.insert().values([
            {"room_id": room.id, "vendor_id": vendor.id}, {"room_id": room.id, "vendor_id": seller.id}]))
        c = OpportunityConversation(opportunity_id=offer.id, buyer_id=vendor.id, seller_id=seller.id,
                                    room_id=room.id, title_snapshot=offer.title)
        db.add(c)
        await db.commit()
    return {"room_id": str(c.room_id), "opportunity": serialize(offer, seller, vendor)}

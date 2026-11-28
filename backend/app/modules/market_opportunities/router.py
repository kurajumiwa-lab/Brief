"""A narrow market-offer workflow. Prices are seller quotes, never verified facts."""
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing import Annotated
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.market_opportunities.models import MarketOpportunity
from app.modules.outside.models import OutsideContentReport
from app.routes.auth import get_current_vendor
from app.services.discovery_visibility import discoverable

router = APIRouter()
Text160 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Unit = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Amount = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2, allow_inf_nan=False)]


class OpportunityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Text160
    location: Text160
    quantity: Amount
    unit: Unit
    price_kes: Amount


def serialize(row, seller, viewer):
    return {"id": str(row.id), "title": row.title, "location": row.location,
            "quantity": str(row.quantity), "unit": row.unit, "price_kes": str(row.price_kes),
            "updated_at": row.updated_at.isoformat() + "Z", "source": "Seller-reported",
            "seller": {"id": str(seller.id), "name": seller.business_name, "handle": seller.vendor_handle},
            "is_owner": seller.id == viewer.id}


@router.post("", status_code=201)
async def create(body: OpportunityIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row = MarketOpportunity(seller_id=vendor.id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return serialize(row, vendor, vendor)


@router.get("")
async def browse(q: str = Query("", max_length=160), offset: int = Query(0, ge=0, le=10000),
                 limit: int = Query(20, ge=1, le=50), vendor: Vendor = Depends(get_current_vendor),
                 db: AsyncSession = Depends(get_db)):
    # Hide stale offers rather than letting an old quote pose as current.
    stmt = (select(MarketOpportunity, Vendor).join(Vendor, Vendor.id == MarketOpportunity.seller_id)
            .where(MarketOpportunity.active.is_(True), MarketOpportunity.updated_at >= datetime.utcnow() - timedelta(days=7),
                   or_(discoverable(Vendor), Vendor.id == vendor.id), Vendor.fraud_suspended_at.is_(None)))
    blocked = select(OutsideContentReport.target_vendor_id).where(
        OutsideContentReport.reporter_vendor_id == vendor.id,
        OutsideContentReport.is_block.is_(True),
        OutsideContentReport.target_vendor_id.is_not(None),
    )
    stmt = stmt.where(Vendor.id.not_in(blocked))
    if q.strip():
        term = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(or_(MarketOpportunity.title.ilike(f"%{term}%", escape="\\"),
                              MarketOpportunity.location.ilike(f"%{term}%", escape="\\")))
    rows = (await db.execute(stmt.order_by(MarketOpportunity.updated_at.desc(), MarketOpportunity.id.desc()).offset(offset).limit(limit + 1))).all()
    return {"items": [serialize(o, s, vendor) for o, s in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


@router.delete("/{opportunity_id}", status_code=204)
async def close(opportunity_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row = await db.get(MarketOpportunity, opportunity_id)
    if row is None or row.seller_id != vendor.id:
        raise HTTPException(404, "Opportunity not found")
    row.active = False
    await db.commit()

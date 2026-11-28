"""Authenticated general marketing marketplace; offers are private to participants."""
from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.campaigns.models import Campaign, CampaignOffer
from app.modules.outside.models import OutsideContentReport
from app.routes.auth import get_current_vendor
from app.services.discovery_visibility import discoverable

router = APIRouter()
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Long = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
Amount = Annotated[int, Field(strict=True, gt=0, le=100_000_000)]

class BriefIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: Short
    brief: Long
    location: Short
    budget_kes: Amount

class OfferIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    message: Long
    price_kes: Amount


def campaign_out(row, owner, viewer):
    return {'id': str(row.id), 'title': row.title, 'brief': row.brief, 'location': row.location,
            'budget_kes': row.budget_kes, 'status': row.status, 'created_at': row.created_at.isoformat() + 'Z',
            'owner': {'id': str(owner.id), 'name': owner.business_name, 'handle': owner.vendor_handle},
            'is_owner': row.owner_id == viewer.id}


def offer_out(row, vendor):
    return {'id': str(row.id), 'message': row.message, 'price_kes': row.price_kes, 'status': row.status,
            'created_at': row.created_at.isoformat() + 'Z', 'vendor': {'id': str(vendor.id), 'name': vendor.business_name, 'handle': vendor.vendor_handle}}


def blocked(viewer):
    return select(OutsideContentReport.target_vendor_id).where(OutsideContentReport.reporter_vendor_id == viewer.id,
        OutsideContentReport.is_block.is_(True), OutsideContentReport.target_vendor_id.is_not(None))

async def campaign_for(db, campaign_id, vendor, lock=False):
    query = select(Campaign, Vendor).join(Vendor, Vendor.id == Campaign.owner_id).where(Campaign.id == campaign_id)
    if lock:
        query = query.with_for_update(of=Campaign)
    result = (await db.execute(query)).first()
    if not result:
        raise HTTPException(404, 'Campaign not found')
    campaign, owner = result
    if owner.id != vendor.id:
        visible = (await db.execute(select(Vendor.id).where(Vendor.id == owner.id, discoverable(Vendor),
            Vendor.fraud_suspended_at.is_(None), Vendor.id.not_in(blocked(vendor))))).first()
        if not visible:
            raise HTTPException(404, 'Campaign not found')
    return campaign, owner

@router.post('', status_code=201)
async def create(body: BriefIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row = Campaign(owner_id=vendor.id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return campaign_out(row, vendor, vendor)

@router.get('')
async def browse(offset: int = Query(0, ge=0, le=10000), limit: int = Query(20, ge=1, le=50),
                 vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    query = select(Campaign, Vendor).join(Vendor, Vendor.id == Campaign.owner_id).where(
        or_(Campaign.owner_id == vendor.id, (Campaign.status == 'open') & discoverable(Vendor) & Vendor.fraud_suspended_at.is_(None) & Vendor.id.not_in(blocked(vendor))))
    rows = (await db.execute(query.order_by(Campaign.created_at.desc(), Campaign.id.desc()).offset(offset).limit(limit + 1))).all()
    return {'items': [campaign_out(row, owner, vendor) for row, owner in rows[:limit]], 'next_offset': offset + limit if len(rows) > limit else None}

@router.get('/my-offers')
async def my_offers(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CampaignOffer, Campaign, Vendor).join(Campaign, Campaign.id == CampaignOffer.campaign_id)
        .join(Vendor, Vendor.id == Campaign.owner_id).where(CampaignOffer.vendor_id == vendor.id,
            or_(discoverable(Vendor), Vendor.id == vendor.id), Vendor.fraud_suspended_at.is_(None),
            Vendor.id.not_in(blocked(vendor))).order_by(CampaignOffer.created_at.desc()).limit(100))).all()
    return {'items': [{'campaign': campaign_out(campaign, owner, vendor), 'offer': offer_out(offer, vendor)} for offer, campaign, owner in rows]}

@router.get('/{campaign_id}')
async def detail(campaign_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row, owner = await campaign_for(db, campaign_id, vendor)
    if row.status != 'open' and row.owner_id != vendor.id:
        mine = (await db.execute(select(CampaignOffer.id).where(CampaignOffer.campaign_id == row.id, CampaignOffer.vendor_id == vendor.id))).first()
        if not mine:
            raise HTTPException(404, 'Campaign not found')
    query = select(CampaignOffer, Vendor).join(Vendor, Vendor.id == CampaignOffer.vendor_id).where(CampaignOffer.campaign_id == row.id)
    if row.owner_id != vendor.id:
        query = query.where(CampaignOffer.vendor_id == vendor.id)
    offers = (await db.execute(query.order_by(CampaignOffer.created_at))).all()
    return {'campaign': campaign_out(row, owner, vendor), 'offers': [offer_out(offer, who) for offer, who in offers]}

@router.post('/{campaign_id}/offers', status_code=201)
async def offer(campaign_id: UUID, body: OfferIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row, _ = await campaign_for(db, campaign_id, vendor, lock=True)
    if row.owner_id == vendor.id or row.status != 'open':
        raise HTTPException(400, 'Cannot offer on this campaign')
    old = (await db.execute(select(CampaignOffer).where(CampaignOffer.campaign_id == row.id, CampaignOffer.vendor_id == vendor.id))).scalar_one_or_none()
    if old:
        raise HTTPException(409, 'You already submitted an offer for this campaign')
    item = CampaignOffer(campaign_id=row.id, vendor_id=vendor.id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return offer_out(item, vendor)

@router.post('/{campaign_id}/close')
async def close(campaign_id: UUID, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row, owner = await campaign_for(db, campaign_id, vendor, lock=True)
    if row.owner_id != vendor.id:
        raise HTTPException(404, 'Campaign not found')
    if row.status != 'open':
        raise HTTPException(409, 'Campaign is not open')
    row.status = 'closed'
    await db.commit()
    return campaign_out(row, owner, vendor)

@router.post('/{campaign_id}/offers/{offer_id}/{action}')
async def decide(campaign_id: UUID, offer_id: UUID, action: Literal['accept', 'withdraw'], vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    row, _ = await campaign_for(db, campaign_id, vendor, lock=True)
    item = (await db.execute(select(CampaignOffer).where(CampaignOffer.id == offer_id, CampaignOffer.campaign_id == row.id))).scalar_one_or_none()
    if not item or (action == 'accept' and row.owner_id != vendor.id) or (action == 'withdraw' and item.vendor_id != vendor.id):
        raise HTTPException(404, 'Offer not found')
    if row.status != 'open' or item.status != 'submitted':
        raise HTTPException(409, 'Offer or campaign is no longer open')
    item.status = 'accepted' if action == 'accept' else 'withdrawn'
    if action == 'accept':
        row.status = 'awarded'
    await db.commit()
    return {'status': item.status}

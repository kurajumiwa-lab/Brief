"""Community-spotted sale board. QR fields and sightings are unverified signals."""
from datetime import datetime, timedelta
from decimal import Decimal
import hashlib
import hmac
import ipaddress
from collections import Counter
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.receipts import Receipt, ReceiptMerchant, TradeProof
from app.models.spotted_deals import SpottedDeal, SpottedDealFlag, SpottedDealSeenTap, SpottedDealCooldown, SpottedDealJuryAssignment, SpottedOptOutAttempt
from app.models.stock import StockMovement
from app.models.vendor import Vendor
from app.models.notification import NotificationType
from app.routes.auth import get_current_vendor, vendor_id_from_token
from app.services.merchant_claims import corridor
from app.services.notification_service import create_notification
from app.services.og_cards import _level_for
from app.services.spotted_deal_policy import public_visibility, flag_weight, exclusive_relationship, jury_outcome, PUBLIC_STATUSES
from app.services.storage import MEDIA_KEY

router = APIRouter()

class CreateDeal(BaseModel):
    merchant_id: UUID
    region_slug: str = Field(min_length=1,max_length=64,pattern=r'^[a-z0-9-]+$')
    town: str = Field(min_length=1,max_length=64)
    title: str = Field(min_length=1,max_length=140)
    discount_summary: str | None = Field(default=None,max_length=80)
    image_url: str = Field(min_length=1,max_length=500)
    capture_signals: dict = Field(default_factory=dict)

class FlagIn(BaseModel):
    flag_type: str

class ReceiptIn(BaseModel):
    receipt_id: UUID

class OptOutIn(BaseModel):
    opt_out_all_future: bool = False
    adopt: bool = False

class VoteIn(BaseModel):
    decision: str


def _ip_hash(request: Request, day):
    # Never trust X-Forwarded-For here. ASGI's client is used after the server's
    # configured trusted-proxy processing; a shared proxy conservatively shares
    # a limit rather than granting attackers spoofable identities.
    try:
        ip = ipaddress.ip_address(request.client.host)
    except (ValueError, AttributeError):
        raise HTTPException(503, 'Client network unavailable; removal request cannot be rate-limited safely')
    subnet = str(ipaddress.ip_network(f'{ip}/{24 if ip.version == 4 else 48}', strict=False))
    daily_key = hmac.new(settings.SECRET_KEY.encode(), f'spotted:{day.isoformat()}'.encode(), hashlib.sha256).digest()
    return hmac.new(daily_key, subnet.encode(), hashlib.sha256).hexdigest()


async def _optional_vendor(request, db):
    header = request.headers.get('authorization', '')
    if not header.lower().startswith('bearer '):
        return None
    vid = vendor_id_from_token(header[7:])
    if not vid:
        raise HTTPException(401, 'Invalid session')
    person = await db.get(Vendor, vid)
    if not person or person.fraud_suspended_at or person.vendor_handle.startswith('closed_'):
        raise HTTPException(401, 'Invalid session')
    return person


async def _locked_deal(db, deal_id):
    deal = await db.get(SpottedDeal, deal_id, with_for_update=True)
    if not deal:
        raise HTTPException(404, 'Deal not found')
    return deal


def _live(deal, shop, now):
    if deal.status not in PUBLIC_STATUSES or deal.expires_at <= now or not shop.allow_spotted_deals:
        raise HTTPException(409, 'Deal is not visible or has expired')


def _output(deal, shop, seen=False):
    return dict(id=str(deal.id), feed_kind='SPOTTED_DEAL', kind='spotted_deal', merchant_id=str(shop.id),
        merchant_name=shop.name, poster_user_id=str(deal.poster_user_id), region_slug=deal.region_slug,
        town=deal.town, title=deal.title, discount_summary=deal.discount_summary, image_url=deal.image_url,
        status=deal.status, expires_at=deal.expires_at.isoformat()+'Z', seen_in_store_count=deal.seen_in_store_count,
        user_has_seen=seen, claim_status=shop.claim_status, claim_url=f'/invite/{shop.pin}')


async def _trade_partners(db, vendor_id, now):
    cutoff = now-timedelta(days=90)
    proofs = (await db.execute(select(TradeProof.buyer_vendor_id, TradeProof.seller_vendor_id).where(
        TradeProof.status == 'confirmed', TradeProof.confirmed_at >= cutoff,
        or_(TradeProof.buyer_vendor_id == vendor_id, TradeProof.seller_vendor_id == vendor_id)))).all()
    moves = (await db.execute(select(StockMovement.from_vendor_id, StockMovement.to_vendor_id).where(
        StockMovement.status == 'received', StockMovement.completed_at >= cutoff,
        or_(StockMovement.from_vendor_id == vendor_id, StockMovement.to_vendor_id == vendor_id)))).all()
    return Counter(b if a == vendor_id else a for a,b in [*proofs,*moves] if a and b and a != b)


async def _receipt(db, receipt_id, owner_id, merchant_id, earliest, latest=None):
    r = await db.get(Receipt, receipt_id)
    if not r or r.vendor_id != owner_id:
        raise HTTPException(404, 'Your receipt not found')
    if r.merchant_id != merchant_id or r.status != 'verified' or r.source not in ('qr', 'qr_link') or not r.issued_at:
        raise HTTPException(422, 'A parsed QR receipt matched to this shop with an issue time is required')
    if r.issued_at < earliest or (latest and r.issued_at > latest) or r.issued_at > datetime.utcnow():
        raise HTTPException(422, 'Receipt issue time is outside the allowed window')
    return r


@router.get('')
async def list_deals(region_slug: str = Query(..., max_length=64), q: str = Query('',max_length=140), db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    now = datetime.utcnow()
    query = select(SpottedDeal, ReceiptMerchant).join(ReceiptMerchant, SpottedDeal.merchant_id == ReceiptMerchant.id).where(public_visibility(now), SpottedDeal.region_slug == region_slug)
    if q.strip():
        query = query.where(SpottedDeal.title.ilike('%'+q.strip().replace('%', r'\%').replace('_',r'\_')+'%'))
    rows = (await db.execute(query.order_by(SpottedDeal.created_at.desc()).limit(100))).all()
    seen = set((await db.execute(select(SpottedDealSeenTap.deal_id).where(SpottedDealSeenTap.user_id == vendor.id, SpottedDealSeenTap.deal_id.in_([d.id for d,_ in rows])))).scalars().all())
    return [_output(d,m,d.id in seen) for d,m in rows]


@router.get('/shops')
async def available_shops(region_slug: str = Query(..., max_length=64), q: str = Query('', max_length=100), db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    # Shop records are already public via invite pages. Never return a PIN here.
    query = select(ReceiptMerchant).where(ReceiptMerchant.allow_spotted_deals.is_(True), ReceiptMerchant.region == region_slug)
    if q.strip():
        query = query.where(ReceiptMerchant.name.ilike('%' + q.strip().replace('%', r'\%').replace('_', r'\_') + '%'))
    shops = (await db.execute(query.order_by(ReceiptMerchant.name).limit(100))).scalars().all()
    return [{'id': str(m.id), 'name': m.name, 'region': m.region, 'claim_status': m.claim_status} for m in shops]


@router.get('/mine')
async def my_deals(db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    rows = (await db.execute(select(SpottedDeal, ReceiptMerchant).join(ReceiptMerchant, SpottedDeal.merchant_id == ReceiptMerchant.id).where(SpottedDeal.poster_user_id == vendor.id, SpottedDeal.status.in_(['PAUSED_OPT_OUT','DISPUTED_REVIEW'])).order_by(SpottedDeal.updated_at.desc()).limit(100))).all()
    return [{**_output(d,m), 'opt_out_deadline': d.opt_out_deadline.isoformat() + 'Z' if d.opt_out_deadline else None} for d,m in rows]


@router.post('', status_code=201)
async def create_deal(data: CreateDeal, db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    now = datetime.utcnow()
    poster = await db.get(Vendor, vendor.id, with_for_update=True)
    level = await _level_for(db, poster)
    if level < 1 or poster.fraud_suspended_at:
        raise HTTPException(403, 'Eligible standing required')
    cooldown = await db.get(SpottedDealCooldown, poster.id)
    if cooldown and cooldown.locked_until and cooldown.locked_until > now:
        raise HTTPException(429, {'error':'COOLDOWN_ACTIVE','locked_until':cooldown.locked_until.isoformat()+'Z'})
    shop = await db.get(ReceiptMerchant, data.merchant_id, with_for_update=True)
    if not shop or not shop.allow_spotted_deals:
        raise HTTPException(409, 'Shop does not allow spotted deals')
    if shop.region and corridor(shop.region) != corridor(data.region_slug):
        raise HTTPException(422, 'Region does not match shop')
    if not data.image_url.startswith('/static/') or not MEDIA_KEY.fullmatch(data.image_url[len('/static/'):]):
        raise HTTPException(422, 'Upload a shop image first')
    from app.services.storage import storage
    media = await storage.read(data.image_url[len('/static/'):])
    if not media or not media[1].startswith('image/'):
        raise HTTPException(422, 'Image not found')
    active = (await db.execute(select(func.count()).select_from(SpottedDeal).where(SpottedDeal.poster_user_id==poster.id, SpottedDeal.status=='LIVE_UNVERIFIED', SpottedDeal.expires_at>now))).scalar_one()
    if active >= (5 if level >= 3 else 2):
        raise HTTPException(409, 'ACTIVE_DEAL_CAP_REACHED')
    signals = {key: str(data.capture_signals[key])[:100] for key in ('capture_mode','exif_ts','client_submitted_at') if key in data.capture_signals}
    deal = SpottedDeal(merchant_id=shop.id, poster_user_id=poster.id, region_slug=data.region_slug, town=data.town.strip(), title=data.title.strip(), discount_summary=data.discount_summary, image_url=data.image_url, capture_signals=signals, created_at=now, updated_at=now, expires_at=now+timedelta(hours=72))
    if not deal.title or not deal.town:
        raise HTTPException(422,'Title and town are required')
    db.add(deal); await db.flush(); out = _output(deal,shop); await db.commit(); return out


@router.get('/jury-assignments')
async def jury_assignments(db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    now = datetime.utcnow()
    rows = (await db.execute(select(SpottedDealJuryAssignment,SpottedDeal,ReceiptMerchant,Receipt).join(SpottedDeal,SpottedDeal.id==SpottedDealJuryAssignment.deal_id).join(ReceiptMerchant,ReceiptMerchant.id==SpottedDeal.merchant_id).join(Receipt,Receipt.id==SpottedDeal.dispute_receipt_id).where(SpottedDealJuryAssignment.juror_user_id==vendor.id,SpottedDeal.status=='DISPUTED_REVIEW',SpottedDeal.jury_review_deadline>now))).all()
    result=[]
    for a,d,m,r in rows:
        votes = (await db.execute(select(SpottedDealJuryAssignment.decision,func.count()).where(SpottedDealJuryAssignment.deal_id==d.id,SpottedDealJuryAssignment.decision.is_not(None)).group_by(SpottedDealJuryAssignment.decision))).all(); tally=dict(votes)
        result.append(dict(assignment_id=str(a.id),deal_id=str(d.id),is_publicly_hidden=True,review_deadline=d.jury_review_deadline.isoformat()+'Z',merchant_name=m.name,town=d.town,title=d.title,discount_summary=d.discount_summary,deal_image_url=d.image_url,timeline={'deal_posted_at':d.created_at.isoformat()+'Z','opt_out_requested_at':d.opt_out_requested_at.isoformat()+'Z','dispute_receipt_issued_at':r.issued_at.isoformat()+'Z'},redacted_receipt={'merchant_record_matched':r.merchant_id==m.id,'issued_after_opt_out':r.issued_at>=d.opt_out_requested_at,'source_type':'Parsed QR (not KRA verified)'},votes={'uphold_opt_out':tally.get('UPHOLD_OPT_OUT',0),'uphold_deal':tally.get('UPHOLD_DEAL',0),'majority_needed':2},my_decision=a.decision))
    return result


@router.post('/{deal_id}/seen')
async def seen(deal_id: UUID, db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    now=datetime.utcnow(); d=await _locked_deal(db,deal_id); shop=await db.get(ReceiptMerchant,d.merchant_id); _live(d,shop,now)
    if not await db.get(SpottedDealSeenTap,(d.id,vendor.id)):
        db.add(SpottedDealSeenTap(deal_id=d.id,user_id=vendor.id)); d.seen_in_store_count+=1
    await db.commit(); return {'seen_in_store_count':d.seen_in_store_count}


@router.post('/{deal_id}/confirm-receipt')
async def link_receipt(deal_id: UUID, body: ReceiptIn, db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    now=datetime.utcnow(); d=await _locked_deal(db,deal_id); shop=await db.get(ReceiptMerchant,d.merchant_id); _live(d,shop,now)
    if d.status != 'LIVE_UNVERIFIED' or d.poster_user_id==vendor.id:
        raise HTTPException(409,'Only a separate shopper may link one receipt')
    r=await _receipt(db,body.receipt_id,vendor.id,d.merchant_id,d.created_at,d.expires_at)
    d.confirmed_receipt_id=r.id; d.confirmed_by_user_id=vendor.id; d.confirmed_at=now; d.status='RECEIPT_LINKED'; d.updated_at=now
    try: await db.commit()
    except IntegrityError:
        await db.rollback(); raise HTTPException(409,'Receipt is already linked')
    return {'status':d.status, 'message':'Parsed QR linked; not KRA-verified and earns no standing credit.'}


@router.post('/{deal_id}/flags')
async def flag(deal_id: UUID, body: FlagIn, request: Request, db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    now=datetime.utcnow()
    poster_id=(await db.execute(select(SpottedDeal.poster_user_id).where(SpottedDeal.id==deal_id))).scalar_one_or_none()
    if poster_id is None: raise HTTPException(404,'Deal not found')
    await db.get(Vendor,poster_id,with_for_update=True)
    d=await _locked_deal(db,deal_id); shop=await db.get(ReceiptMerchant,d.merchant_id,with_for_update=True); _live(d,shop,now)
    if d.poster_user_id==vendor.id or vendor.fraud_suspended_at:
        raise HTTPException(403,'Cannot flag this deal')
    level=await _level_for(db,vendor)
    if body.flag_type != 'DEAL_ENDED' and (vendor.movements_completed or 0)+(vendor.confirmed_trade_proofs or 0)<1:
        raise HTTPException(403,'A completed trade is required for an abuse flag')
    peers=(await db.execute(select(SpottedDealFlag).where(SpottedDealFlag.deal_id==d.id))).scalars().all()
    if any(f.flagger_user_id==vendor.id for f in peers):
        raise HTTPException(409,'Already flagged')
    net=_ip_hash(request,now.date()); partners=await _trade_partners(db,vendor.id,now)
    dampened=exclusive_relationship(partners.get(d.poster_user_id,0),sum(partners.values()),len(partners)) or any(f.ip_subnet_hash==net and f.created_at.date()==now.date() for f in peers)
    if not dampened and len(partners)==1:
        dampened=any(f.flagger_user_id in partners for f in peers)
    try: weight=flag_weight(body.flag_type,level,dampened)
    except ValueError: raise HTTPException(403,'Flag type or standing not permitted')
    db.add(SpottedDealFlag(deal_id=d.id,flagger_user_id=vendor.id,flag_type=body.flag_type,weight=weight,ip_subnet_hash=net,created_at=now)); await db.flush()
    total=(await db.execute(select(func.sum(SpottedDealFlag.weight)).where(SpottedDealFlag.deal_id==d.id,SpottedDealFlag.flag_type==body.flag_type))).scalar_one() or Decimal('0')
    threshold=Decimal('3') if body.flag_type=='DEAL_ENDED' else Decimal('2')
    reached=total>=threshold
    if reached:
        d.status='EXPIRED' if body.flag_type=='DEAL_ENDED' else 'PAUSED_FLAGGED'; d.updated_at=now
        if body.flag_type!='DEAL_ENDED' and not d.strike_counted:
            # Serializes strike updates across different deals by the same poster.
            await db.get(Vendor,d.poster_user_id,with_for_update=True)
            d.strike_counted=True; d.strike_at=now; await db.flush()
            n60=(await db.execute(select(func.count()).select_from(SpottedDeal).where(SpottedDeal.poster_user_id==d.poster_user_id,SpottedDeal.strike_counted.is_(True),SpottedDeal.strike_at>=now-timedelta(days=60)))).scalar_one()
            n30=(await db.execute(select(func.count()).select_from(SpottedDeal).where(SpottedDeal.poster_user_id==d.poster_user_id,SpottedDeal.strike_counted.is_(True),SpottedDeal.strike_at>=now-timedelta(days=30)))).scalar_one()
            cd=await db.get(SpottedDealCooldown,d.poster_user_id)
            if cd is None:
                cd=SpottedDealCooldown(user_id=d.poster_user_id); db.add(cd)
            cd.strike_count_60d=n60; cd.updated_at=now
            lock=now+timedelta(days=60 if n60>=3 else 14) if n60>=3 or n30>=2 else None
            if lock and (not cd.locked_until or cd.locked_until<lock): cd.locked_until=lock
    await db.commit(); return {'status':d.status,'applied_weight':float(weight),'threshold_reached':reached}


@router.post('/{deal_id}/opt-out')
async def opt_out(deal_id: UUID, body: OptOutIn, request: Request, db: AsyncSession = Depends(get_db)):
    now=datetime.utcnow(); actor=await _optional_vendor(request,db); d=await _locked_deal(db,deal_id); shop=await db.get(ReceiptMerchant,d.merchant_id,with_for_update=True)
    owner=actor and shop.claimed_by_vendor_id==actor.id and shop.claim_status in ('verified','probationary')
    if owner:
        if body.adopt:
            if d.status not in ('PAUSED_OPT_OUT','DISPUTED_REVIEW') or d.expires_at<=now or not shop.allow_spotted_deals:
                raise HTTPException(409,'Cannot restore this deal')
            d.status='RECEIPT_LINKED' if d.confirmed_receipt_id else 'LIVE_UNVERIFIED'
        else:
            d.status='OPTED_OUT'
            if body.opt_out_all_future:
                shop.allow_spotted_deals=False; shop.spotted_opt_out_at=now; shop.spotted_opt_out_by=actor.id
        d.updated_at=now; await db.commit(); return {'status':d.status,'opt_out_deadline':None}
    if shop.claim_status not in ('unclaimed','rejected') or shop.claimed_by_vendor_id:
        raise HTTPException(403,'The claimed shop owner must manage this listing')
    if body.opt_out_all_future or body.adopt:
        raise HTTPException(403,'Only a claimed shop owner may do that')
    _live(d,shop,now)
    today=_ip_hash(request,now.date()); yesterday=_ip_hash(request,(now-timedelta(days=1)).date())
    # Lock per network across concurrent requests and rolling midnight boundary.
    # Hash rotation means a midnight request uses another key, so use a single
    # transaction-wide lock for this small public takedown endpoint.
    await db.execute(text("SELECT pg_advisory_xact_lock(83190622)"))
    count=(await db.execute(select(func.count()).select_from(SpottedOptOutAttempt).where(SpottedOptOutAttempt.subnet_hash.in_([today,yesterday]),SpottedOptOutAttempt.created_at>now-timedelta(hours=24)))).scalar_one()
    if count>=3: raise HTTPException(429,'Removal request limit reached. Try again later.')
    db.add(SpottedOptOutAttempt(subnet_hash=today,created_at=now)); d.opt_out_subnet_hash=today; d.status='PAUSED_OPT_OUT'; d.opt_out_requested_at=now; d.opt_out_deadline=now+timedelta(hours=48); d.opt_out_requester_user_id=actor.id if actor else None; d.updated_at=now
    await create_notification(db,d.poster_user_id,NotificationType.SYSTEM,'A shop requested removal',f'The listing {d.title} is hidden. You can submit a parsed receipt for review within 48 hours.',sender_id=actor.id if actor else None,data={'deal_id':str(d.id)})
    await db.commit(); return {'status':d.status,'opt_out_deadline':d.opt_out_deadline.isoformat()+'Z'}


@router.post('/{deal_id}/dispute')
async def dispute(deal_id: UUID, body: ReceiptIn, db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    now=datetime.utcnow(); d=await _locked_deal(db,deal_id); shop=await db.get(ReceiptMerchant,d.merchant_id,with_for_update=True)
    if d.poster_user_id!=vendor.id: raise HTTPException(403,'Only the poster may dispute')
    if d.status!='PAUSED_OPT_OUT' or not d.opt_out_deadline or now>=d.opt_out_deadline: raise HTTPException(409,'Dispute window is closed')
    if shop.claimed_by_vendor_id and shop.claim_status in ('probationary','verified'): raise HTTPException(409,'The claimed shop owner controls this listing')
    r=await _receipt(db,body.receipt_id,vendor.id,d.merchant_id,d.opt_out_requested_at)
    d.status='DISPUTED_REVIEW'; d.dispute_receipt_id=r.id; d.disputed_at=now; d.jury_review_deadline=now+timedelta(hours=24); d.updated_at=now
    # Random server-side selection; exclude known 90-day counterparties of both parties.
    excluded={d.poster_user_id}
    if d.opt_out_requester_user_id: excluded.add(d.opt_out_requester_user_id)
    for party in list(excluded): excluded.update((await _trade_partners(db,party,now)).keys())
    candidates=(await db.execute(select(Vendor).where(Vendor.joined_at<=now-timedelta(days=60),Vendor.fraud_suspended_at.is_(None),Vendor.id.not_in(excluded)).order_by(func.random()).limit(1000))).scalars().all()
    selected=[]
    for person in candidates:
        if corridor(person.physical_location)!=corridor(d.region_slug) or await _level_for(db,person)<4: continue
        cd=await db.get(SpottedDealCooldown,person.id)
        if cd and cd.locked_until and cd.locked_until>now: continue
        selected.append(person)
        if len(selected)==3: break
    for person in selected:
        db.add(SpottedDealJuryAssignment(deal_id=d.id,juror_user_id=person.id,expires_at=d.jury_review_deadline))
        await create_notification(db,person.id,NotificationType.SYSTEM,'Corridor review requested','A spotted sale is hidden pending your review. Parsed receipts do not verify a discount.',data={'deal_id':str(d.id)})
    try: await db.commit()
    except IntegrityError:
        await db.rollback(); raise HTTPException(409,'Receipt already used for another dispute')
    return {'status':d.status,'review_deadline':d.jury_review_deadline.isoformat()+'Z','message':'Parsed receipt is unverified and does not prove the advertised sale.'}


@router.post('/{deal_id}/dispute/vote')
async def vote(deal_id: UUID, body: VoteIn, db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    if body.decision not in ('UPHOLD_OPT_OUT','UPHOLD_DEAL'): raise HTTPException(422,'Invalid decision')
    now=datetime.utcnow(); d=await _locked_deal(db,deal_id); shop=await db.get(ReceiptMerchant,d.merchant_id,with_for_update=True)
    assignment=(await db.execute(select(SpottedDealJuryAssignment).where(SpottedDealJuryAssignment.deal_id==d.id,SpottedDealJuryAssignment.juror_user_id==vendor.id))).scalar_one_or_none()
    if not assignment or vendor.fraud_suspended_at: raise HTTPException(403,'Not an assigned reviewer')
    cooldown = await db.get(SpottedDealCooldown, vendor.id)
    conflicts = {d.poster_user_id, d.opt_out_requester_user_id}
    partners = await _trade_partners(db, vendor.id, now)
    if (await _level_for(db, vendor) < 4 or vendor.joined_at > now - timedelta(days=60) or corridor(vendor.physical_location) != corridor(d.region_slug) or (cooldown and cooldown.locked_until and cooldown.locked_until > now) or vendor.id in conflicts or any(p in conflicts for p in partners)):
        raise HTTPException(403, 'Reviewer is no longer eligible')
    if d.status!='DISPUTED_REVIEW' or now>=d.jury_review_deadline or now>=assignment.expires_at or assignment.decision:
        raise HTTPException(409,'Review is closed or vote already recorded')
    assignment.decision=body.decision; assignment.decided_at=now; await db.flush()
    votes=dict((await db.execute(select(SpottedDealJuryAssignment.decision,func.count()).where(SpottedDealJuryAssignment.deal_id==d.id,SpottedDealJuryAssignment.decision.is_not(None)).group_by(SpottedDealJuryAssignment.decision))).all())
    outcome=jury_outcome(votes.get('UPHOLD_OPT_OUT',0),votes.get('UPHOLD_DEAL',0),d.expires_at,d.jury_review_deadline,now,d.confirmed_receipt_id is not None)
    if outcome:
        # A newly claimed owner or shop-wide opt-out has precedence over jurors.
        d.status = 'OPTED_OUT' if not shop.allow_spotted_deals or (shop.claimed_by_vendor_id and shop.claim_status in ('probationary','verified')) else outcome
        d.updated_at=now
    await db.commit(); return {'status':d.status,'votes':{'uphold_opt_out':votes.get('UPHOLD_OPT_OUT',0),'uphold_deal':votes.get('UPHOLD_DEAL',0),'majority_needed':2}}


@router.post('/merchants/{merchant_id}/settings')
async def shop_settings(merchant_id: UUID, body: OptOutIn, db: AsyncSession = Depends(get_db), vendor: Vendor = Depends(get_current_vendor)):
    shop=await db.get(ReceiptMerchant,merchant_id,with_for_update=True)
    if not shop or shop.claimed_by_vendor_id!=vendor.id or shop.claim_status not in ('verified','probationary'):
        raise HTTPException(403,'Only the claimed shop owner can change this')
    shop.allow_spotted_deals=not body.opt_out_all_future
    shop.spotted_opt_out_at=datetime.utcnow() if body.opt_out_all_future else None
    shop.spotted_opt_out_by=vendor.id if body.opt_out_all_future else None
    await db.commit(); return {'allow_spotted_deals':shop.allow_spotted_deals}

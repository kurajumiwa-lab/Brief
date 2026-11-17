import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.database import async_session
from app.models.receipts import ReceiptMerchant
from app.models.spotted_deals import SpottedDeal, SpottedDealSeenTap
from app.services.spotted_deal_policy import public_visibility
from tests.test_smoke import _register

pytestmark = pytest.mark.asyncio


async def test_canonical_visibility_and_unique_seen_taps(client):
    poster = await _register(client, 'spot_poster', ['food'])
    viewer = await _register(client, 'spot_viewer', ['food'])
    now = datetime.utcnow()
    async with async_session() as db:
        shop = ReceiptMerchant(pin='P' + uuid.uuid4().hex[:9].upper() + 'A', name='Town shop')
        db.add(shop)
        await db.flush()
        def deal(status, expires):
            return SpottedDeal(merchant_id=shop.id, poster_user_id=uuid.UUID(poster['vendor_id']), region_slug='nyanza', town='Kisumu', title='Window sale', image_url='/static/example', status=status, expires_at=expires)
        active = deal('LIVE_UNVERIFIED', now + timedelta(hours=1))
        db.add_all([active, deal('LIVE_UNVERIFIED', now - timedelta(seconds=1)), deal('PAUSED_OPT_OUT', now + timedelta(hours=1))])
        await db.flush()
        rows = (await db.execute(select(SpottedDeal.id).join(ReceiptMerchant, SpottedDeal.merchant_id == ReceiptMerchant.id).where(public_visibility(now), SpottedDeal.merchant_id == shop.id))).scalars().all()
        assert rows == [active.id]
        shop.allow_spotted_deals = False
        await db.flush()
        rows = (await db.execute(select(SpottedDeal.id).join(ReceiptMerchant, SpottedDeal.merchant_id == ReceiptMerchant.id).where(public_visibility(now), SpottedDeal.merchant_id == shop.id))).scalars().all()
        assert rows == []
        db.add(SpottedDealSeenTap(deal_id=active.id, user_id=uuid.UUID(viewer['vendor_id'])))
        await db.commit()
        db.add(SpottedDealSeenTap(deal_id=active.id, user_id=uuid.UUID(viewer['vendor_id'])))
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()


async def test_confirmed_status_requires_evidence(client):
    poster = await _register(client, 'spot_constraints', ['food'])
    async with async_session() as db:
        shop = ReceiptMerchant(pin='P' + uuid.uuid4().hex[:9].upper() + 'A', name='Shop')
        db.add(shop)
        await db.flush()
        db.add(SpottedDeal(merchant_id=shop.id, poster_user_id=uuid.UUID(poster['vendor_id']), region_slug='nyanza', town='Kisumu', title='Sale', image_url='/static/example', status='RECEIPT_LINKED', expires_at=datetime.utcnow() + timedelta(days=1)))
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()

async def test_expiry_sweep_only_transitions_due_states(client):
    from app.services.spotted_deal_policy import sweep_expired
    poster = await _register(client, 'sweep_poster', ['food'])
    now = datetime.utcnow()
    async with async_session() as db:
        shop = ReceiptMerchant(pin='P' + uuid.uuid4().hex[:9].upper() + 'A', name='Sweep shop')
        db.add(shop)
        await db.flush()
        def make(status):
            return SpottedDeal(merchant_id=shop.id, poster_user_id=uuid.UUID(poster['vendor_id']), region_slug='nyanza', town='Kisumu', title='Sale', image_url='/static/example', status=status, expires_at=now - timedelta(seconds=1), opt_out_deadline=now - timedelta(seconds=1), jury_review_deadline=now - timedelta(seconds=1))
        live, paused, review, flagged = [make(x) for x in ('LIVE_UNVERIFIED', 'PAUSED_OPT_OUT', 'DISPUTED_REVIEW', 'PAUSED_FLAGGED')]
        db.add_all([live, paused, review, flagged])
        await db.flush()
        await sweep_expired(db, now)
        for item in (live, paused, review, flagged):
            await db.refresh(item)
        assert [x.status for x in (live, paused, review, flagged)] == ['EXPIRED', 'OPTED_OUT', 'OPTED_OUT', 'PAUSED_FLAGGED']
        await db.rollback()

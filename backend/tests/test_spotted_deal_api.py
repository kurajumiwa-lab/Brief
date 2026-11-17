import io
import uuid
from datetime import datetime, timedelta
from PIL import Image
import pytest
from app.database import async_session
from app.models.receipts import ReceiptMerchant, Receipt
from app.models.spotted_deals import SpottedDeal, SpottedDealJuryAssignment
from app.models.vendor import Vendor
from tests.test_smoke import _register, _auth
pytestmark = pytest.mark.asyncio

async def test_sale_link_seen_and_removal(client):
    host, buyer = [await _register(client, x, ['food']) for x in ('spot_host','spot_buyer')]
    h, b = _auth(host['access_token']), _auth(buyer['access_token'])
    async with async_session() as db:
        m=ReceiptMerchant(pin='P'+uuid.uuid4().hex[:9].upper()+'A',name='Sample shop',region='nyanza')
        db.add(m); await db.commit(); mid=str(m.id)
    picture=io.BytesIO(); Image.new('RGB',(30,30),'green').save(picture,'JPEG')
    upload=await client.post('/api/files/upload',headers=h,files={'file':('banner.jpg',picture.getvalue(),'image/jpeg')})
    assert upload.status_code==201,upload.text
    payload={'merchant_id':mid,'region_slug':'nyanza','town':'Kisumu','title':'Window sale','image_url':upload.json()['url'],'capture_signals':{'capture_mode':'camera'}}
    created=await client.post('/api/spotted-deals',headers=h,json=payload)
    assert created.status_code==201,created.text
    did=created.json()['id']; url='/api/spotted-deals/'+did
    listing=await client.get('/api/spotted-deals?region_slug=nyanza',headers=b)
    assert any(x['id']==did for x in listing.json())
    for _ in range(2):
        assert (await client.post(url+'/seen',headers=b)).json()['seen_in_store_count']==1
    async with async_session() as db:
        r=Receipt(vendor_id=uuid.UUID(buyer['vendor_id']),merchant_id=uuid.UUID(mid),merchant_pin='P123456789A',merchant_name='Sample shop',invoice_no='test',total=500,issued_at=datetime.utcnow(),source='qr',status='verified',freshness_key='test',dedupe_key=uuid.uuid4().hex)
        db.add(r); await db.commit(); rid=str(r.id)
    assert (await client.post(url+'/confirm-receipt',headers=h,json={'receipt_id':rid})).status_code==409
    linked=await client.post(url+'/confirm-receipt',headers=b,json={'receipt_id':rid})
    assert linked.status_code==200,linked.text
    assert linked.json()['status']=='RECEIPT_LINKED' and 'not KRA-verified' in linked.json()['message']
    removed=await client.post(url+'/opt-out',json={})
    assert removed.status_code==200,removed.text
    assert removed.json()['status']=='PAUSED_OPT_OUT'
    listing=await client.get('/api/spotted-deals?region_slug=nyanza',headers=b)
    assert all(x['id']!=did for x in listing.json())
    assert (await client.get('/api/spotted-deals/mine',headers=h)).json()[0]['id']==did

async def test_jury_vote_preserves_link_and_checks_assignment(client):
    host, juror, second, intruder=[await _register(client,x,['food']) for x in ('juryhost','juryone','jurytwo','jurybad')]
    now=datetime.utcnow()
    async with async_session() as db:
        for person in (juror, second):
            member = await db.get(Vendor, uuid.UUID(person['vendor_id']))
            member.joined_at = now - timedelta(days=90); member.physical_location='Kisumu'; member.phone_verified_at=now; member.movements_completed=5
        m=ReceiptMerchant(pin='P'+uuid.uuid4().hex[:9].upper()+'A',name='Jury shop',region='nyanza');db.add(m);await db.flush()
        r=Receipt(vendor_id=uuid.UUID(host['vendor_id']),merchant_id=m.id,merchant_name='Jury shop',total=200,issued_at=now,source='qr',status='verified',freshness_key='test',dedupe_key=uuid.uuid4().hex);db.add(r);await db.flush()
        d=SpottedDeal(merchant_id=m.id,poster_user_id=uuid.UUID(host['vendor_id']),region_slug='nyanza',town='Kisumu',title='Sale',image_url='/static/example',status='DISPUTED_REVIEW',expires_at=now+timedelta(days=1),opt_out_requested_at=now-timedelta(minutes=1),opt_out_deadline=now+timedelta(hours=47),dispute_receipt_id=r.id,disputed_at=now,jury_review_deadline=now+timedelta(hours=24));db.add(d);await db.flush()
        for person in (juror,second): db.add(SpottedDealJuryAssignment(deal_id=d.id,juror_user_id=uuid.UUID(person['vendor_id']),expires_at=d.jury_review_deadline))
        await db.commit(); did=str(d.id)
    url=f'/api/spotted-deals/{did}/dispute/vote'
    assert (await client.post(url,headers=_auth(intruder['access_token']),json={'decision':'UPHOLD_DEAL'})).status_code==403
    first=await client.post(url,headers=_auth(juror['access_token']),json={'decision':'UPHOLD_DEAL'})
    assert first.status_code==200 and first.json()['status']=='DISPUTED_REVIEW'
    assert (await client.post(url,headers=_auth(juror['access_token']),json={'decision':'UPHOLD_DEAL'})).status_code==409
    final=await client.post(url,headers=_auth(second['access_token']),json={'decision':'UPHOLD_DEAL'})
    assert final.status_code==200 and final.json()['status']=='LIVE_UNVERIFIED'

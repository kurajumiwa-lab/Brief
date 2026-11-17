from datetime import datetime, timedelta
from uuid import UUID
import pytest
from app.database import async_session
from app.models.vendor import Vendor
from tests.test_public_share import _register
pytestmark = pytest.mark.asyncio

async def test_handle_rename_redirect_cooldown_and_reserved(client):
    auth, vid, old = await _register(client, 'rename')
    ua={'User-Agent':'WhatsApp/2.23.20.0'}
    new = 'shop-' + vid[:8]
    assert (await client.patch('/api/profile/handle',headers=auth,json={'new_handle':'api'})).status_code == 422
    assert (await client.patch('/api/profile/handle',headers=auth,json={'new_handle':'bad--handle'})).status_code == 422
    response = await client.patch('/api/profile/handle',headers=auth,json={'new_handle':new.upper()})
    assert response.status_code == 200, response.text
    assert response.json()['handle'] == new
    response = await client.get('/p/'+old,headers=ua,follow_redirects=False)
    assert response.status_code == 301 and response.headers['location'] == '/p/'+new
    card = await client.get('/p/'+old,headers=ua,follow_redirects=True)
    assert card.status_code == 200 and 'property="og:title"' in card.text
    assert (await client.get('/api/profiles/'+old)).json() == {'redirect_to':new}
    assert (await client.patch('/api/profile/handle',headers=auth,json={'new_handle':'second-name'})).status_code == 429
    async with async_session() as db:
        vendor=await db.get(Vendor,UUID(vid)); vendor.handle_changed_at=datetime.utcnow()-timedelta(days=31); await db.commit()
    # Reclaim an owned alias and redirect the intermediate name to the current one.
    # Old legacy handles can contain underscores, so reclaim a valid hyphen name instead.
    other = 'new-' + vid[:8]
    assert (await client.patch('/api/profile/handle',headers=auth,json={'new_handle':other})).status_code == 200
    async with async_session() as db:
        vendor=await db.get(Vendor,UUID(vid)); vendor.handle_changed_at=datetime.utcnow()-timedelta(days=31); await db.commit()
    assert (await client.patch('/api/profile/handle',headers=auth,json={'new_handle':new})).status_code == 200
    assert (await client.get('/api/profiles/'+other)).json()['redirect_to']==new
    assert (await client.get('/api/profiles/'+old)).json()['redirect_to']==new

async def test_alias_cannot_be_taken_via_signup_or_other_account(client):
    auth, vid, old = await _register(client, 'alias')
    second, _, _ = await _register(client,'other')
    assert (await client.patch('/api/profile/handle',headers=auth,json={'new_handle':'new-'+vid[:8]})).status_code == 200
    taken=await client.patch('/api/profile/handle',headers=second,json={'new_handle':'new-'+vid[:8]})
    assert taken.status_code == 409 and taken.json()['detail'] == 'HANDLE_TAKEN'
    # Legacy underscore alias remains reserved by signup as well.
    body={'business_name':'Imposter','vendor_handle':old,'email':f'{vid}@example.com','password':'Correct-horse-9'}
    assert (await client.post('/api/auth/register',json=body)).status_code == 409

async def test_whatsapp_preview_excludes_private_data_and_alias_redirects(client):
    from app.models.receipts import ReceiptMerchant, ReceiptOffer, ReceiptVoucher
    from app.models.events import Event, EventRegistration
    from app.routes.receipts import voucher_code
    from tests.test_public_share import _meta
    auth, vid, old = await _register(client, 'crawler')
    guest_auth, guest, _ = await _register(client, 'privateattendee')
    now = datetime.utcnow()
    async with async_session() as db:
        owner = await db.get(Vendor, UUID(vid)); owner.phone='+254712345678'; owner.phone_verified_at=None
        owner.allow_direct_calls=False
        guest_row = await db.get(Vendor, UUID(guest)); guest_row.business_name='Secret Attendee Name'
        shop = ReceiptMerchant(pin='P'+vid.replace('-','')[:9].upper()+'A', name='Preview Shop', claim_status='probationary', claimed_by_vendor_id=owner.id)
        db.add(shop); await db.flush()
        offer=ReceiptOffer(merchant_id=shop.id,title='Public offer',discount_kes=50,points_cost=10,starts_at=now)
        db.add(offer); await db.flush()
        voucher=ReceiptVoucher(merchant_id=shop.id,offer_id=offer.id,vendor_id=UUID(guest),value_kes=50,points_cost=10,code_seed='private'+vid,expires_at=now+timedelta(days=1))
        event=Event(organizer_id=owner.id,title='Public walk',start_date=now+timedelta(days=1),end_date=now+timedelta(days=1,hours=1),status='upcoming')
        db.add_all([voucher,event]); await db.flush()
        secret=voucher_code(voucher.id,voucher.code_seed)
        db.add(EventRegistration(event_id=event.id,vendor_id=UUID(guest),booking_status='CONFIRMED'))
        await db.commit()
    ua={'User-Agent':'WhatsApp/2.23.20.0'}
    response=await client.get('/p/'+old,headers=ua)
    assert response.status_code==200
    for prop in ('og:title','og:description','og:image'): assert _meta(response.text,prop)
    for private in (secret,'+254712345678','Secret Attendee Name'):
        assert private not in response.text
    new='preview-'+vid[:8]
    assert (await client.patch('/api/profile/handle',headers=auth,json={'new_handle':new})).status_code==200
    redirect=await client.get('/p/'+old,headers=ua,follow_redirects=False)
    assert redirect.status_code==301 and redirect.headers['location']=='/p/'+new
    canonical=await client.get(redirect.headers['location'],headers=ua)
    assert _meta(canonical.text,'og:url').endswith('/p/'+new)
    for private in (secret,'+254712345678','Secret Attendee Name'): assert private not in canonical.text

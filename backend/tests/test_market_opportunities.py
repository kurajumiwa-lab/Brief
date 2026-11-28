import uuid
from datetime import datetime, timedelta

import pytest
from app.database import async_session
from app.modules.market_opportunities.models import MarketOpportunity

pytestmark = pytest.mark.asyncio


async def account(client):
    suffix = uuid.uuid4().hex[:10]
    r = await client.post('/api/auth/register', json={'business_name': f'Trader {suffix}', 'vendor_handle': f'm_{suffix}', 'email': f'{suffix}@example.com', 'password': 'Correct-horse-9', 'business_categories': ['groceries']})
    assert r.status_code == 201, r.text
    return {'Authorization': f"Bearer {r.json()['access_token']}"}


async def test_publish_discover_enquire_close(client):
    seller, buyer = await account(client), await account(client)
    payload = {'title': 'Beans available', 'location': 'Busia', 'quantity': '100', 'unit': '90 kg bag', 'price_kes': '5000'}
    for field in payload:
        invalid = dict(payload); invalid.pop(field)
        assert (await client.post('/api/market-opportunities', headers=seller, json=invalid)).status_code == 422
    assert (await client.post('/api/market-opportunities', headers=seller, json={**payload, 'quantity': 0})).status_code == 422
    created = await client.post('/api/market-opportunities', headers=seller, json=payload)
    assert created.status_code == 201, created.text
    card = created.json()
    assert card['source'] == 'Seller-reported' and card['is_owner']
    assert card['updated_at'].endswith('Z')
    found = await client.get('/api/market-opportunities', headers=buyer, params={'q': 'Busia'})
    item = next(i for i in found.json()['items'] if i['id'] == card['id'])
    assert item['unit'] == '90 kg bag' and item['price_kes'] == '5000.00' and not item['is_owner']
    room = await client.post('/api/chat/direct/' + item['seller']['id'], headers=buyer)
    assert room.status_code == 200 and room.json()['room_id']
    assert (await client.delete('/api/market-opportunities/' + card['id'], headers=buyer)).status_code == 404
    assert (await client.delete('/api/market-opportunities/' + card['id'], headers=seller)).status_code == 204
    assert card['id'] not in [i['id'] for i in (await client.get('/api/market-opportunities', headers=buyer)).json()['items']]


async def test_stale_and_hidden_do_not_appear(client):
    seller, buyer = await account(client), await account(client)
    payload = {'title': 'Maize', 'location': 'Busia', 'quantity': '2', 'unit': 'bags', 'price_kes': '50'}
    created = (await client.post('/api/market-opportunities', headers=seller, json=payload)).json()
    async with async_session() as db:
        row = await db.get(MarketOpportunity, uuid.UUID(created['id']))
        row.updated_at = datetime.utcnow() - timedelta(days=8)
        await db.commit()
    result = await client.get('/api/market-opportunities', headers=buyer, params={'q': 'Maize'})
    assert created['id'] not in [i['id'] for i in result.json()['items']]
    fresh = (await client.post('/api/market-opportunities', headers=seller, json=payload)).json()
    response = await client.put('/api/professional/me/page', headers=seller, json={'discoverable': False})
    assert response.status_code == 200
    result = await client.get('/api/market-opportunities', headers=buyer, params={'q': 'Maize'})
    assert fresh['id'] not in [i['id'] for i in result.json()['items']]


async def test_manage_stale_status_and_enquiry_loop(client):
    seller, buyer, stranger = await account(client), await account(client), await account(client)
    payload = {'title': 'Beans', 'location': 'Busia', 'quantity': '100', 'unit': '90 kg bag', 'price_kes': '5000'}
    card = (await client.post('/api/market-opportunities', headers=seller, json=payload)).json()
    path = '/api/market-opportunities/' + card['id']
    assert (await client.put(path, headers=buyer, json=payload)).status_code == 404
    assert (await client.post(path + '/renew', headers=buyer)).status_code == 404
    assert (await client.put(path + '/status', headers=buyer, json={'status': 'reserved'})).status_code == 404
    market = await client.get('/api/market-opportunities', headers=buyer, params={'market': 'Busia', 'q': 'Beans'})
    assert card['id'] in [r['id'] for r in market.json()['items']]
    market = await client.get('/api/market-opportunities', headers=buyer, params={'market': 'Mombasa', 'q': 'Beans'})
    assert card['id'] not in [r['id'] for r in market.json()['items']]
    result = await client.put(path, headers=seller, json={**payload, 'price_kes': '5100'})
    assert result.status_code == 200 and result.json()['price_kes'] == '5100'
    confirmed = result.json()['updated_at']
    reserved = await client.put(path + '/status', headers=seller, json={'status': 'reserved'})
    assert reserved.json()['status'] == 'reserved' and reserved.json()['updated_at'] == confirmed
    assert (await client.post(path + '/enquiry', headers=buyer)).status_code == 404
    assert (await client.put(path + '/status', headers=seller, json={'status': 'available'})).json()['updated_at'] == confirmed
    enquiry = await client.post(path + '/enquiry', headers=buyer)
    assert enquiry.status_code == 200, enquiry.text
    assert enquiry.json()['opportunity']['price_kes'] == '5100.00'
    room = enquiry.json()['room_id']
    assert (await client.post(f'/api/chat/{room}/message', headers=buyer, json={'content': 'Is the Busia beans offer available?', 'message_type': 'text'})).status_code == 201
    assert (await client.post(f'/api/chat/{room}/message', headers=seller, json={'content': 'Yes, available.', 'message_type': 'text'})).status_code == 201
    assert (await client.post(f'/api/chat/{room}/message', headers=stranger, json={'content': 'Not a participant', 'message_type': 'text'})).status_code == 403
    assert (await client.put(path + '/status', headers=seller, json={'status': 'unavailable'})).status_code == 200
    assert (await client.post(path + '/enquiry', headers=buyer)).status_code == 404
    assert (await client.put(path + '/status', headers=seller, json={'status': 'available'})).status_code == 409
    async with async_session() as db:
        row = await db.get(MarketOpportunity, uuid.UUID(card['id']))
        row.updated_at = datetime.utcnow() - timedelta(days=8)
        await db.commit()
    mine = await client.get('/api/market-opportunities/mine', headers=seller)
    old = next(x for x in mine.json()['items'] if x['id'] == card['id'])
    assert old['stale'] and old['status'] == 'unavailable' and not old['visible_to_others']
    renewed = await client.post(path + '/renew', headers=seller)
    assert renewed.json()['status'] == 'available' and not renewed.json()['stale'] and renewed.json()['visible_to_others']
    assert (await client.post(path + '/enquiry', headers=buyer)).status_code == 200


async def test_enquiry_rechecks_hidden_and_stale(client):
    seller, buyer = await account(client), await account(client)
    card = (await client.post('/api/market-opportunities', headers=seller, json={'title': 'Beans', 'location': 'Busia', 'quantity': 1, 'unit': 'bag', 'price_kes': 50})).json()
    path = '/api/market-opportunities/' + card['id']
    await client.put('/api/professional/me/page', headers=seller, json={'discoverable': False})
    assert (await client.post(path + '/enquiry', headers=buyer)).status_code == 404
    mine = await client.get('/api/market-opportunities/mine', headers=seller)
    assert not next(x for x in mine.json()['items'] if x['id'] == card['id'])['visible_to_others']
    await client.put('/api/professional/me/page', headers=seller, json={'discoverable': True})
    async with async_session() as db:
        row = await db.get(MarketOpportunity, uuid.UUID(card['id']))
        row.updated_at = datetime.utcnow() - timedelta(days=8)
        await db.commit()
    assert (await client.post(path + '/enquiry', headers=buyer)).status_code == 404


async def test_blocked_seller_is_not_discoverable_or_enquirable(client):
    from app.models.vendor import Vendor
    from app.modules.outside.models import OutsideContentReport
    from sqlalchemy import select
    seller, buyer = await account(client), await account(client)
    card = (await client.post('/api/market-opportunities', headers=seller, json={'title': 'Cabbage', 'location': 'Busia', 'quantity': 1, 'unit': 'bag', 'price_kes': 50})).json()
    buyer_me = (await client.get('/api/vendors/me', headers=buyer)).json()
    async with async_session() as db:
        seller_row = (await db.execute(select(Vendor).where(Vendor.id == uuid.UUID(card['seller']['id'])))).scalar_one()
        db.add(OutsideContentReport(reporter_vendor_id=uuid.UUID(buyer_me['id']), target_vendor_id=seller_row.id, content_kind='person', content_id=str(seller_row.id), reason='other', is_block=True))
        await db.commit()
    result = await client.get('/api/market-opportunities', headers=buyer, params={'q': 'Cabbage'})
    assert card['id'] not in [r['id'] for r in result.json()['items']]
    assert (await client.post('/api/market-opportunities/' + card['id'] + '/enquiry', headers=buyer)).status_code == 404


async def test_public_profile_api_is_accessible_without_login(client):
    seller = await account(client)
    me = (await client.get('/api/vendors/me', headers=seller)).json()
    response = await client.get('/api/professional/page/' + me['vendor_handle'])
    assert response.status_code == 200 and response.json()['handle'] == me['vendor_handle']


async def test_metrics_count_real_messages_and_both_participant_reports(client):
    seller, buyer, outsider = await account(client), await account(client), await account(client)
    offer = (await client.post('/api/market-opportunities', headers=seller, json={'title': 'Coffee', 'location': 'Busia', 'quantity': 5, 'unit': 'bag', 'price_kes': 600})).json()
    path = '/api/market-opportunities/' + offer['id'] + '/enquiry'
    first = (await client.post(path, headers=buyer)).json()
    assert (await client.post(path, headers=buyer)).json()['room_id'] == first['room_id']
    room = first['room_id']
    seller_id = offer['seller']['id']
    generic = await client.post('/api/chat/direct/' + seller_id, headers=buyer)
    assert generic.status_code == 200 and generic.json()['room_id'] != room
    metrics = '/api/market-opportunities/metrics'
    detail = '/api/market-opportunities/conversations/' + room
    assert (await client.get(metrics, headers=seller)).json()['items'] == []
    assert (await client.put(detail + '/sale', headers=seller)).status_code == 409
    assert (await client.get(detail, headers=outsider)).status_code == 404
    assert (await client.put(detail + '/sale', headers=outsider)).status_code == 404
    assert (await client.post(f'/api/chat/{room}/message', headers=buyer, json={'content': 'Is coffee available?'})).status_code == 201
    m = (await client.get(metrics, headers=seller)).json()['items'][0]
    assert (m['enquiries'], m['replies'], m['confirmed_sales'], m['messages']) == (1, 0, 0, 1)
    assert (await client.get(metrics, headers=buyer)).json()['items'] == []
    assert (await client.post(f'/api/chat/{room}/message', headers=seller, json={'content': 'Yes'})).status_code == 201
    m = (await client.get(metrics, headers=seller)).json()['items'][0]
    assert (m['enquiries'], m['replies'], m['confirmed_sales'], m['messages']) == (1, 1, 0, 2)
    assert (await client.put(detail + '/sale', headers=seller)).json()['seller_confirmed']
    assert (await client.put(detail + '/sale', headers=seller)).json()['seller_confirmed']
    assert (await client.get(metrics, headers=seller)).json()['items'][0]['confirmed_sales'] == 0
    assert (await client.put(detail + '/sale', headers=buyer)).json()['buyer_confirmed']
    assert (await client.get(metrics, headers=seller)).json()['items'][0]['confirmed_sales'] == 1
    assert (await client.delete(detail + '/sale', headers=buyer)).status_code == 200
    assert (await client.get(metrics, headers=seller)).json()['items'][0]['confirmed_sales'] == 0


async def test_public_portfolio_shows_gallery_without_private_account_data(client):
    seller = await account(client)
    me = (await client.get('/api/vendors/me', headers=seller)).json()
    result = await client.put('/api/vendors/me/profile', headers=seller, json={
        'gallery_items': [{'image_url': '/static/test.jpg', 'caption': 'Market stall', 'tag': 'premises'}],
        'work_items': [{'title': 'Our work', 'summary': 'A project'}], 'warehouse_address': 'private location',
    })
    assert result.status_code == 200, result.text
    result = await client.get('/api/profiles/' + me['vendor_handle'])
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['gallery_items'][0]['caption'] == 'Market stall'
    assert data['work_items'][0]['title'] == 'Our work'
    for key in ('email', 'phone', 'tax_id', 'warehouse_address', 'supply_capacity', 'geo_lat', 'geo_lng'):
        assert key not in data

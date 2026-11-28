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

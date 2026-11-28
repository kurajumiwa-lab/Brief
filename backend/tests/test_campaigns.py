import pytest
from tests.test_offerings import _register

pytestmark = pytest.mark.asyncio


async def test_general_campaign_private_offers_and_award(client):
    _, _, owner = await _register(client, 'campaignowner')
    _, _, creator = await _register(client, 'creator')
    _, _, stranger = await _register(client, 'othercreator')
    payload = {'title': 'Promote our bags', 'brief': 'Two short videos', 'location': 'Nairobi', 'budget_kes': 5000}
    assert (await client.post('/api/campaigns', json=payload)).status_code in (401, 403)
    response = await client.post('/api/campaigns', headers=owner, json=payload)
    assert response.status_code == 201, response.text
    cid = response.json()['id']
    assert any(item['id'] == cid for item in (await client.get('/api/campaigns', headers=creator)).json()['items'])
    assert (await client.post(f'/api/campaigns/{cid}/offers', headers=owner, json={'message': 'own', 'price_kes': 100})).status_code == 400
    offer = await client.post(f'/api/campaigns/{cid}/offers', headers=creator, json={'message': 'My proposal', 'price_kes': 4500})
    assert offer.status_code == 201, offer.text
    oid = offer.json()['id']
    assert (await client.post(f'/api/campaigns/{cid}/offers', headers=creator, json={'message': 'Again', 'price_kes': 4500})).status_code == 409
    assert (await client.get(f'/api/campaigns/{cid}', headers=stranger)).json()['offers'] == []
    assert (await client.get(f'/api/campaigns/{cid}', headers=owner)).json()['offers'][0]['message'] == 'My proposal'
    assert (await client.post(f'/api/campaigns/{cid}/offers/{oid}/accept', headers=stranger)).status_code == 404
    assert (await client.post(f'/api/campaigns/{cid}/offers/{oid}/accept', headers=owner)).json()['status'] == 'accepted'
    assert (await client.get(f'/api/campaigns/{cid}', headers=stranger)).status_code == 404
    assert (await client.get(f'/api/campaigns/{cid}', headers=creator)).json()['offers'][0]['status'] == 'accepted'
    assert any(i['campaign']['id'] == cid for i in (await client.get('/api/campaigns/my-offers', headers=creator)).json()['items'])
    assert (await client.post(f'/api/campaigns/{cid}/offers/{oid}/withdraw', headers=creator)).status_code == 409


async def test_close_and_validation(client):
    _, _, owner = await _register(client, 'closeowner')
    _, _, creator = await _register(client, 'closecreator')
    payload = {'title': 'Campaign', 'brief': 'A brief', 'location': 'Mombasa', 'budget_kes': 0}
    assert (await client.post('/api/campaigns', headers=owner, json=payload)).status_code == 422
    payload['budget_kes'] = 2000
    cid = (await client.post('/api/campaigns', headers=owner, json=payload)).json()['id']
    assert (await client.post(f'/api/campaigns/{cid}/close', headers=creator)).status_code == 404
    assert (await client.post(f'/api/campaigns/{cid}/close', headers=owner)).json()['status'] == 'closed'
    assert (await client.post(f'/api/campaigns/{cid}/offers', headers=creator, json={'message':'hello', 'price_kes': 100})).status_code == 400

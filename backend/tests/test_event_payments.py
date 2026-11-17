from datetime import datetime, timedelta
import pytest
from tests.test_smoke import _auth, _register
from app.services.mpesa_parser import parse_mpesa_sms

pytestmark = pytest.mark.asyncio

def test_parser():
    note = parse_mpesa_sms('UKG8X2Y4Z1 Confirmed. Ksh 500.00 sent to Wallace Chege', 'Wallace Chege', 1000)
    assert note.code == 'UKG8X2Y4Z1' and note.amount == 500
    assert note.recipient_matched and note.amount_is_partial and note.risk_level == 'medium'

async def test_paid_booking_waitlist_confirmation_and_dedup(client):
    host, a, b = [await _register(client, name, ['food']) for name in ('eventhost', 'eventguest', 'eventwait')]
    h, ah, bh = (_auth(x['access_token']) for x in (host, a, b))
    start = datetime.utcnow() + timedelta(days=2)
    body = {'title': 'Test trip', 'start_date': start.isoformat(), 'end_date': (start + timedelta(hours=4)).isoformat(), 'max_vendors': 1, 'entry_fee': 1000, 'payment_method': 'TILL', 'payment_number': '12345', 'payment_recipient_name': 'Wallace Chege'}
    created = await client.post('/api/events/create', headers=h, json=body)
    assert created.status_code == 201, created.text
    eid = created.json()['event_id']
    url = f'/api/events/{eid}'
    one = await client.post(url + '/register', headers=ah)
    assert one.status_code == 200, one.text
    assert one.json()['booking_status'] == 'PENDING_PAYMENT'
    two = await client.post(url + '/register', headers=bh)
    assert two.json()['booking_status'] == 'WAITLISTED'
    agenda = await client.get('/api/outside/agenda', headers=ah)
    item = next(x for x in agenda.json()['items'] if x['kind'] == 'event' and x['title'] == 'Test trip')
    assert not item['passable'] and item['pass_code'] is None
    note = 'UKG8X2Y4Z1 Confirmed. Ksh 500.00 sent to Wallace Chege'
    submitted = await client.post(url + '/submit-payment', headers=ah, json={'raw_text': note})
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()['amount_is_partial']
    queue = await client.get('/api/events/payment-queue', headers=h)
    assert queue.status_code == 200 and queue.json()[0]['amount_is_partial']
    rid = submitted.json()['registration']['id']
    forbidden = await client.post(url + f'/confirm-payment/{rid}', headers=bh)
    assert forbidden.status_code == 404
    confirmed = await client.post(url + f'/confirm-payment/{rid}', headers=h)
    assert confirmed.status_code == 200, confirmed.text
    agenda = await client.get('/api/outside/agenda', headers=ah)
    item = next(x for x in agenda.json()['items'] if x['kind'] == 'event' and x['title'] == 'Test trip')
    assert item['passable'] and item['pass_code'] == confirmed.json()['pass_code']
    cancelled = await client.post(url + '/cancel-registration', headers=ah)
    assert cancelled.status_code == 200
    promoted = await client.get(url, headers=bh)
    assert promoted.json()['my_booking_status'] == 'PENDING_PAYMENT'
    duplicate = await client.post(url + '/submit-payment', headers=bh, json={'raw_text': note})
    assert duplicate.status_code == 409, duplicate.text

async def test_expiry_promotes_oldest_and_does_not_overbook(client):
    from app.database import async_session
    from app.models.events import EventRegistration
    from sqlalchemy import select
    from uuid import UUID
    host, a, b, c = [await _register(client, name, ['food']) for name in ('holdhost', 'holdone', 'holdtwo', 'holdthree')]
    h, ah, bh, ch = (_auth(x['access_token']) for x in (host, a, b, c))
    start = datetime.utcnow() + timedelta(days=2)
    event = await client.post('/api/events/create', headers=h, json={'title': 'Hold test', 'start_date': start.isoformat(), 'end_date': (start + timedelta(hours=4)).isoformat(), 'max_vendors': 1, 'entry_fee': 300, 'payment_method': 'TILL', 'payment_number': '123'})
    url = '/api/events/' + event.json()['event_id']
    assert (await client.post(url + '/register', headers=ah)).json()['booking_status'] == 'PENDING_PAYMENT'
    assert (await client.post(url + '/register', headers=bh)).json()['registration']['waitlist_position'] == 1
    assert (await client.post(url + '/register', headers=ch)).json()['registration']['waitlist_position'] == 2
    async with async_session() as db:
        row = (await db.execute(select(EventRegistration).where(EventRegistration.event_id == UUID(event.json()['event_id']), EventRegistration.vendor_id == UUID(a['vendor_id'])))).scalar_one()
        row.hold_expires_at = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()
    second = await client.get(url, headers=bh)
    assert second.json()['my_booking_status'] == 'PENDING_PAYMENT'
    assert second.json()['spots_left'] == 0
    third = await client.get(url, headers=ch)
    assert third.json()['my_registration']['waitlist_position'] == 1
    first = await client.get(url, headers=ah)
    assert first.json()['my_booking_status'] == 'EXPIRED'

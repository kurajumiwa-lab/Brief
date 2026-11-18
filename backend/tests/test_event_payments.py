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


async def test_a_price_without_a_rail_cannot_issue_a_pass(client):
    """The bug: a priced event with no payment method confirmed every guest."""
    host, guest = [await _register(client, name, ['food']) for name in ('norailhost', 'norailguest')]
    h, gh = (_auth(x['access_token']) for x in (host, guest))
    start = datetime.utcnow() + timedelta(days=2)
    created = await client.post('/api/events/create', headers=h, json={
        'title': 'Priced but no rail', 'start_date': start.isoformat(),
        'end_date': (start + timedelta(hours=2)).isoformat(), 'entry_fee': 500,
    })
    assert created.status_code == 422, created.text
    assert 'pay' in created.text.lower()


async def test_legacy_priced_event_without_a_rail_refuses_booking(client):
    """Old rows exist. They are not free events; they are unfinished ones."""
    from uuid import UUID
    from app.database import async_session
    from app.models.events import Event
    host, guest = [await _register(client, name, ['food']) for name in ('legacyhost', 'legacyguest')]
    h, gh = (_auth(x['access_token']) for x in (host, guest))
    start = datetime.utcnow() + timedelta(days=2)
    created = await client.post('/api/events/create', headers=h, json={
        'title': 'Legacy priced', 'start_date': start.isoformat(),
        'end_date': (start + timedelta(hours=2)).isoformat(), 'entry_fee': 0,
    })
    eid = created.json()['event_id']
    async with async_session() as db:
        ev = await db.get(Event, UUID(eid))
        ev.entry_fee = 500
        await db.commit()
    booked = await client.post(f'/api/events/{eid}/register', headers=gh)
    assert booked.status_code == 409, booked.text
    assert 'payment method' in booked.text.lower()
    detail = await client.get(f'/api/events/{eid}', headers=h)
    assert detail.json()['payment_ready'] is False


async def test_cash_booking_is_host_confirmed_and_issues_the_pass(client):
    host, guest = [await _register(client, name, ['food']) for name in ('cashhost', 'cashguest')]
    h, gh = (_auth(x['access_token']) for x in (host, guest))
    start = datetime.utcnow() + timedelta(days=2)
    created = await client.post('/api/events/create', headers=h, json={
        'title': 'Cash workshop', 'start_date': start.isoformat(),
        'end_date': (start + timedelta(hours=3)).isoformat(), 'entry_fee': 400,
        'payment_method': 'CASH',
    })
    assert created.status_code == 201, created.text
    eid = created.json()['event_id']
    url = f'/api/events/{eid}'
    booked = await client.post(url + '/register', headers=gh)
    assert booked.status_code == 200, booked.text
    assert booked.json()['booking_status'] == 'PENDING_PAYMENT'
    rid = booked.json()['registration']['id']
    queue = await client.get('/api/events/payment-queue', headers=h)
    row = next(x for x in queue.json() if x['registration_id'] == rid)
    assert row['cash_due'] is True and row['payment_method'] == 'CASH'
    assert (await client.post(url + '/submit-payment', headers=gh,
                              json={'raw_text': 'UKG8X2Y4Z1 Confirmed. Ksh 400.00'})).status_code == 409
    confirmed = await client.post(url + f'/confirm-payment/{rid}', headers=h)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()['pass_code'].startswith('HO-')
    agenda = await client.get('/api/outside/agenda', headers=gh)
    item = next(x for x in agenda.json()['items'] if x['kind'] == 'event' and x['title'] == 'Cash workshop')
    assert item['passable'] and item['pass_code'] == confirmed.json()['pass_code']


async def test_organiser_can_add_a_paybill_after_publishing(client):
    host, guest = [await _register(client, name, ['food']) for name in ('payedit', 'payeditguest')]
    h, gh = (_auth(x['access_token']) for x in (host, guest))
    start = datetime.utcnow() + timedelta(days=2)
    created = await client.post('/api/events/create', headers=h, json={
        'title': 'Pay later', 'start_date': start.isoformat(),
        'end_date': (start + timedelta(hours=3)).isoformat(), 'entry_fee': 0,
    })
    eid = created.json()['event_id']
    updated = await client.patch(f'/api/events/{eid}/payment', headers=h, json={
        'entry_fee': 750, 'payment_method': 'PAYBILL', 'payment_number': '522522',
        'payment_account': 'WORKSHOP', 'payment_recipient_name': 'Host Ltd',
    })
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body['entry_fee'] == 750 and body['payment_method'] == 'PAYBILL'
    assert body['payment_account'] == 'WORKSHOP' and body['payment_ready'] is True
    booked = await client.post(f'/api/events/{eid}/register', headers=gh)
    assert booked.json()['booking_status'] == 'PENDING_PAYMENT'
    # A guest cannot edit the organiser's rail.
    assert (await client.patch(f'/api/events/{eid}/payment', headers=gh, json={
        'entry_fee': 1, 'payment_method': 'CASH',
    })).status_code == 404
    # And an organiser cannot edit a priced event back into "no rail".
    stripped = await client.patch(f'/api/events/{eid}/payment', headers=h, json={
        'entry_fee': 750, 'payment_method': None,
    })
    assert stripped.status_code == 422, stripped.text
    assert 'pay' in stripped.text.lower()

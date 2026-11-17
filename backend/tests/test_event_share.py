import io
import uuid
from datetime import datetime, timedelta
import pytest
from PIL import Image
from app.database import async_session
from app.modules.ledger.models import LocalActivity
from tests.test_public_share import _register, _meta
pytestmark = pytest.mark.asyncio

async def test_event_share_is_public_fresh_and_size_bounded(client):
    host, _, _ = await _register(client, 'oghost')
    guest, _, _ = await _register(client, 'ogguest')
    other, _, _ = await _register(client, 'ogother')
    start = datetime.utcnow() + timedelta(days=3)
    response = await client.post('/api/events/create', headers=host, json={
        'title': 'Day Hike', 'start_date': start.isoformat(), 'end_date': (start + timedelta(hours=5)).isoformat(),
        'max_vendors': 1, 'entry_fee': 2240, 'meeting_point': 'Kencom', 'departure_time': '06:30 AM',
        'payment_method': 'TILL', 'payment_number': '1897219', 'payment_recipient_name': 'Host',
    })
    assert response.status_code == 201, response.text
    slug, event_id = response.json()['slug'], response.json()['event_id']
    page = await client.get('/e/' + slug, headers={'user-agent': 'WhatsApp/2.0'})
    assert page.status_code == 200
    assert 'KSh 2,240' in _meta(page.text, 'og:title')
    assert 'Kencom' in _meta(page.text, 'og:description') and '1897219' in _meta(page.text, 'og:description')
    assert _meta(page.text, 'og:image').endswith('/api/og/events/' + slug + '.jpg')
    assert page.headers['cache-control'] == 'public, max-age=120, s-maxage=120'
    image = await client.get('/api/og/events/' + slug + '.jpg')
    assert image.status_code == 200 and image.headers['content-type'] == 'image/jpeg'
    assert image.headers['cache-control'] == 'public, max-age=120, s-maxage=120'
    assert len(image.content) < 150_000 and Image.open(io.BytesIO(image.content)).size == (1200,630)
    head = await client.head('/api/og/events/' + slug + '.jpg')
    assert head.status_code == 200 and int(head.headers['content-length']) == len(image.content) and not head.content
    resolved = await client.get('/api/og/events/' + slug)
    assert resolved.json() == {'id': event_id, 'kind': 'event'}
    assert (await client.post(f'/api/events/{event_id}/register', headers=guest)).status_code == 200
    assert (await client.post(f'/api/events/{event_id}/register', headers=other)).json()['booking_status'] == 'WAITLISTED'
    page = await client.get('/e/' + slug)
    assert 'Full (1 on Waitlist)' in _meta(page.text, 'og:title')
    image2 = await client.get('/api/og/events/' + slug + '.jpg')
    assert image2.content != image.content
    assert (await client.get('/e/' + event_id)).status_code == 200

async def test_bulk_buy_public_only(client):
    _, host_id, _ = await _register(client, 'bulkhost')
    async with async_session() as db:
        activity = LocalActivity(organizer_vendor_id=uuid.UUID(host_id), posting_type='scheduled', inferred_template='group_sourcing', title='Bulk maize', body='A shared maize buy', visibility='public', capacity=5, spots_confirmed=2, area_name='Kisumu', price_kes=600)
        db.add(activity)
        await db.commit()
        aid = str(activity.id)
    page = await client.get('/e/' + aid)
    assert page.status_code == 200 and '2/5 Spots Filled' in _meta(page.text, 'og:title')
    assert (await client.get('/api/og/events/' + aid)).json()['kind'] == 'bulk_buy'
    image = await client.get('/api/og/events/' + aid + '.jpg')
    assert image.status_code == 200 and len(image.content) < 150_000
    async with async_session() as db:
        activity = await db.get(LocalActivity, uuid.UUID(aid))
        activity.visibility = 'private'
        await db.commit()
    assert (await client.get('/e/' + aid)).status_code == 404
    assert (await client.get('/api/og/events/' + aid + '.jpg')).status_code == 404

async def test_draft_events_do_not_leak(client):
    _, host_id, _ = await _register(client, 'privateog')
    async with async_session() as db:
        from app.models.events import Event
        event = Event(organizer_id=uuid.UUID(host_id), title='Secret draft', start_date=datetime.utcnow(), end_date=datetime.utcnow(), status='draft', slug='secret-draft-test')
        db.add(event)
        await db.commit()
    assert (await client.get('/e/secret-draft-test')).status_code == 404
    assert (await client.get('/api/og/events/secret-draft-test.jpg')).status_code == 404
    assert (await client.get('/api/og/events/secret-draft-test')).status_code == 404


def test_large_photo_card_remains_under_limit():
    import random
    from app.services.event_og import render_event_card
    random.seed(1)
    photo = Image.frombytes('RGB', (760, 190), random.randbytes(760*190*3))
    source = io.BytesIO()
    photo.save(source, format='PNG')
    card = {'palette': 1, 'region': 'Nyanza', 'kind': 'event', 'name': 'A shared event', 'date': '5 Dec 2026', 'departure': '06:30 AM', 'meeting': 'Kencom', 'handle': 'host', 'level': 3, 'rank': 'Trading', 'price': 'KSh 2,240', 'payment': 'Buy Goods Till: 1897219', 'closed': False, 'full': False, 'capacity': 20, 'confirmed': 16, 'occupied': 18, 'waiting': 0}
    result = render_event_card(card, source.getvalue())
    assert len(result) < 150_000
    assert Image.open(io.BytesIO(result)).size == (1200,630)

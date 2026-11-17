"""Public Page editor: only the owner writes their Page; the owner's tagline and About text reach
the public Page; a switched-off section is removed from the public response, not only hidden; a blank
About falls back to the business description; limits are enforced."""

import uuid

import pytest

from app.config import settings as live_settings
from app.database import async_session
from app.models.vendor import Vendor
from app.modules.schedule.models import BookableService

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _who(client, tag, description=None):
    handle = f"pe_{tag}_{uuid.uuid4().hex[:6]}"
    body = {
        "business_name": handle.title(), "vendor_handle": handle, "email": f"{handle}@example.com",
        "password": PASSWORD, "business_categories": ["textiles"], "physical_location": "Kisumu",
    }
    if description:
        body["business_description"] = description
    r = await client.post("/api/auth/register", json=body)
    assert r.status_code == 201, r.text
    tok = r.json()
    return tok["vendor_id"], handle, {"Authorization": f"Bearer {tok['access_token']}"}


async def _service(vid, name):
    async with async_session() as db:
        db.add(BookableService(vendor_id=uuid.UUID(vid), name=name, duration_minutes=30,
                               price_kes=200, price_mode="fixed", is_active=True))
        await db.commit()


@pytest.fixture(autouse=True)
def _on(monkeypatch):
    monkeypatch.setattr(live_settings, "PROFESSIONAL_PROFILE_ENABLED", True)


async def test_editor_needs_sign_in(client):
    assert (await client.get("/api/professional/me/page")).status_code == 401
    assert (await client.put("/api/professional/me/page", json={})).status_code == 401


async def test_defaults_are_everything_on_and_blank(client):
    _, _, h = await _who(client, "def")
    r = await client.get("/api/professional/me/page", headers=h)
    assert r.status_code == 200, r.text
    result = r.json()
    assert {k: result[k] for k in ("tagline", "about", "show_offers", "show_hours", "show_credentials")} == {"tagline": None, "about": None, "show_offers": True, "show_hours": True, "show_credentials": True}
    assert result["preset"] == "service" and result["discoverable"] and not result["show_whatsapp"]


async def test_owner_saves_and_public_page_reflects_it(client):
    _, handle, h = await _who(client, "pub", description="Business description")
    r = await client.put("/api/professional/me/page", headers=h, json={
        "tagline": "  Tailoring for Kisumu  ", "about": "We alter and make suits.",
        "show_offers": True, "show_hours": True, "show_credentials": True,
    })
    assert r.status_code == 200, r.text
    assert r.json()["tagline"] == "Tailoring for Kisumu"  # trimmed
    pub = (await client.get(f"/api/professional/page/{handle}")).json()
    assert pub["tagline"] == "Tailoring for Kisumu"
    assert pub["description"] == "We alter and make suits."


async def test_blank_about_falls_back_to_business_description(client):
    _, handle, h = await _who(client, "fb", description="From the profile")
    await client.put("/api/professional/me/page", headers=h, json={"about": "   "})
    pub = (await client.get(f"/api/professional/page/{handle}")).json()
    assert pub["description"] == "From the profile"


async def test_switched_off_section_is_removed_from_public_response(client):
    vid, handle, h = await _who(client, "hide")
    await _service(vid, "Hemming")
    before = (await client.get(f"/api/professional/page/{handle}")).json()
    assert [s["name"] for s in before["services"]] == ["Hemming"]

    await client.put("/api/professional/me/page", headers=h, json={"show_offers": False, "show_hours": False})
    pub = (await client.get(f"/api/professional/page/{handle}")).json()
    assert pub["services"] == []
    assert pub["hours"] == []
    assert pub["sections"] == {"offers": False, "hours": False, "credentials": True}


async def test_one_owner_cannot_change_another_page(client):
    _, handle_a, ha = await _who(client, "ownA")
    _, _, hb = await _who(client, "ownB")
    await client.put("/api/professional/me/page", headers=hb, json={"tagline": "B was here"})
    pub = (await client.get(f"/api/professional/page/{handle_a}")).json()
    assert pub["tagline"] is None
    assert (await client.get("/api/professional/me/page", headers=ha)).json()["tagline"] is None


async def test_limits_and_unknown_fields_refused(client):
    _, _, h = await _who(client, "lim")
    long_tag = "x" * 141
    assert (await client.put("/api/professional/me/page", headers=h, json={"tagline": long_tag})).status_code == 422
    assert (await client.put("/api/professional/me/page", headers=h, json={"about": "x" * 1001})).status_code == 422
    assert (await client.put("/api/professional/me/page", headers=h, json={"rogue": True})).status_code == 422


async def test_flag_off_hides_editor(client, monkeypatch):
    monkeypatch.setattr(live_settings, "PROFESSIONAL_PROFILE_ENABLED", False)
    _, _, h = await _who(client, "off")
    assert (await client.get("/api/professional/me/page", headers=h)).status_code == 404


async def test_contact_preset_and_visibility_are_owner_controlled(client):
    vid, handle, h = await _who(client, "contact")
    async with async_session() as db:
        vendor = await db.get(Vendor, uuid.UUID(vid))
        from datetime import datetime
        vendor.phone = "+254722000000"; vendor.phone_verified_at = datetime.utcnow()
        await db.commit()
    invalid = await client.put("/api/professional/me/page", headers=h, json={"phone": "0700oops"})
    assert invalid.status_code == 422
    response = await client.put("/api/professional/me/page", headers=h, json={"phone":"0712 345 678", "display_name":"Daktari", "town":"Kisii", "preset":"shop", "discoverable":False, "show_whatsapp":True})
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "+254712345678"
    async with async_session() as db:
        assert (await db.get(Vendor, uuid.UUID(vid))).phone_verified_at is None
    public = (await client.get(f"/api/professional/page/{handle}")).json()
    assert public["whatsapp_phone"] == "+254712345678" and public["preset"] == "shop"
    assert public["name"] == "Daktari" and public["location"] == "Kisii"
    # Older clients preserve the privacy and discovery settings.
    await client.put("/api/professional/me/page", headers=h, json={"tagline":"Hi"})
    assert not (await client.get("/api/professional/me/page",headers=h)).json()["discoverable"]
    await client.put("/api/professional/me/page", headers=h, json={"show_whatsapp":False})
    assert (await client.get(f"/api/professional/page/{handle}")).json()["whatsapp_phone"] is None


async def test_host_public_page_only_includes_live_public_events(client):
    from datetime import datetime, timedelta
    from app.models.events import Event, EventRegistration
    host, handle, h = await _who(client, "hostpreset")
    guest, _, _ = await _who(client, "hostguest")
    await client.put('/api/professional/me/page',headers=h,json={'preset':'host'})
    now = datetime.utcnow()
    async with async_session() as db:
        upcoming = Event(organizer_id=uuid.UUID(host),title='Public hike',start_date=now+timedelta(days=1),end_date=now+timedelta(days=1,hours=4),max_vendors=10,meeting_point='Town stage',status='upcoming')
        stale = Event(organizer_id=uuid.UUID(host),title='Past hike',start_date=now-timedelta(days=2),end_date=now-timedelta(days=2,hours=-1),status='upcoming')
        db.add_all([upcoming,stale]); await db.flush()
        db.add(EventRegistration(event_id=upcoming.id,vendor_id=uuid.UUID(guest),booking_status='CONFIRMED'))
        await db.commit()
    page = await client.get(f'/api/professional/page/{handle}')
    assert page.status_code == 200, page.text
    rounds = page.json()['preset_content']['rounds']
    assert [r['title'] for r in rounds] == ['Public hike']
    assert rounds[0]['joined'] == 1 and rounds[0]['capacity'] == 10
    assert 'pass_code' not in page.text and 'email' not in page.text


async def test_shop_public_content_never_exposes_voucher_codes(client):
    from datetime import datetime, timedelta
    from app.models.receipts import ReceiptMerchant, ReceiptOffer, ReceiptVoucher
    host, handle, h = await _who(client, 'shoppreset')
    await client.put('/api/professional/me/page', headers=h, json={'preset':'shop'})
    async with async_session() as db:
        shop=ReceiptMerchant(pin='P'+uuid.uuid4().hex[:9].upper()+'A',name='The shop',claim_status='probationary',claimed_by_vendor_id=uuid.UUID(host))
        db.add(shop); await db.flush()
        offer=ReceiptOffer(merchant_id=shop.id,title='Tea offer',discount_kes=50,points_cost=20,starts_at=datetime.utcnow()-timedelta(days=1))
        db.add(offer); await db.commit()
    page=await client.get(f'/api/professional/page/{handle}')
    assert page.status_code==200, page.text
    content=page.json()['preset_content']
    assert content['shops'][0]['status']=='probationary'
    assert content['offers'][0]['title']=='Tea offer'
    assert 'HO-' not in page.text
    await client.put('/api/professional/me/page',headers=h,json={'show_offers':False})
    assert (await client.get(f'/api/professional/page/{handle}')).json()['preset_content']['offers']==[]


async def test_shop_payment_tag_is_explicit_and_validated(client):
    _, handle, h = await _who(client, 'shoppay')
    assert (await client.put('/api/professional/me/page', headers=h, json={'preset':'shop','payment_type':'till','payment_number':'invalid'})).status_code == 422
    saved = await client.put('/api/professional/me/page', headers=h, json={'preset':'shop','payment_type':'paybill','payment_number':'123456','payment_account':'SHOP01'})
    assert saved.status_code == 200, saved.text
    page = (await client.get(f'/api/professional/page/{handle}')).json()
    assert page['payment_tag'] == {'type':'paybill','number':'123456','account':'SHOP01'}
    await client.put('/api/professional/me/page', headers=h, json={'preset':'host'})
    assert (await client.get(f'/api/professional/page/{handle}')).json()['payment_tag'] is None
    await client.put('/api/professional/me/page', headers=h, json={'payment_type':None})
    assert (await client.get('/api/professional/me/page',headers=h)).json()['payment_number'] is None

async def test_visibility_hides_network_search_but_not_direct_page(client):
    _, handle, h = await _who(client, 'network_hidden_unique')
    _, _, viewer = await _who(client, 'network_viewer')
    search = '/api/search/network'
    before = await client.get(search, headers=viewer, params={'q':handle})
    assert before.status_code == 200, before.text
    assert any(v['vendor_handle'] == handle for v in before.json()['suppliers'])
    await client.put('/api/professional/me/page', headers=h, json={'discoverable':False})
    after = await client.get(search, headers=viewer, params={'q':handle})
    assert not any(v['vendor_handle'] == handle for v in after.json()['suppliers'])
    assert (await client.get(f'/api/professional/page/{handle}')).status_code == 200

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
    assert r.json() == {"tagline": None, "about": None, "show_offers": True,
                        "show_hours": True, "show_credentials": True}


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

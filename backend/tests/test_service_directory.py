"""Service providers are one card per Page, not one card per service.

The product rule: a nurse or barber is available continuously, so their eight
services must not become eight rows in a goods feed. These tests pin the route,
the grouping and the privacy boundary.
"""

import uuid

import pytest

from tests.test_smoke import _auth

pytestmark = pytest.mark.asyncio


async def _provider(client, name, location="Kondele, Kisumu", **extra):
    handle = f"svc_{name}_{uuid.uuid4().hex[:5]}"
    r = await client.post("/api/auth/register", json={
        "business_name": f"{name.title()} Services",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": "Correct-horse-9",
        "business_categories": ["health"],
        "physical_location": location,
        **extra,
    })
    assert r.status_code == 201, r.text
    return r.json()


async def _add_service(client, headers, name, price=1500, **extra):
    r = await client.post("/api/schedule/services", headers=headers, json={
        "name": name,
        "duration_minutes": 60,
        "price_kes": price,
        "price_unit": "visit",
        "domain": "healthcare_care",
        "delivery_home": True,
        **extra,
    })
    assert r.status_code == 201, r.text
    return r.json()


async def test_a_provider_with_several_services_is_one_row(client):
    provider = await _provider(client, "amina")
    viewer = await _provider(client, "viewer", location="Nairobi")
    ph, vh = _auth(provider["access_token"]), _auth(viewer["access_token"])
    await _add_service(client, ph, "Home nursing", 1500)
    await _add_service(client, ph, "Wound dressing", 800)
    await _add_service(client, ph, "Postnatal visit", 2000)

    r = await client.get("/api/service-providers", headers=vh, params={"region_slug": "nyanza"})
    assert r.status_code == 200, r.text
    body = r.json()
    rows = [p for p in body["providers"] if p["handle"] == provider["vendor_handle"]]
    assert len(rows) == 1
    row = rows[0]
    assert row["service_count"] == 3
    assert row["starting_price_kes"] == 800
    assert row["is_bookable"] is True
    assert row["owner"]["handle"] == provider["vendor_handle"]
    assert {o["name"] for o in row["offerings"]} == {"Home nursing", "Wound dressing", "Postnatal visit"}
    assert "phone" not in row and "email" not in row


async def test_your_own_services_are_not_in_your_directory(client):
    me = await _provider(client, "self")
    h = _auth(me["access_token"])
    await _add_service(client, h, "My own service", 500)

    r = await client.get("/api/service-providers", headers=h)
    assert r.status_code == 200
    assert all(p["handle"] != me["vendor_handle"] for p in r.json()["providers"])


async def test_search_matches_a_service_name_and_corridor_filters_hold(client):
    provider = await _provider(client, "baraka")
    viewer = await _provider(client, "seeker", location="Nairobi")
    ph, vh = _auth(provider["access_token"]), _auth(viewer["access_token"])
    await _add_service(client, ph, "Mobile barber", 300)

    found = await client.get("/api/service-providers", headers=vh, params={"q": "barber"})
    assert any(p["handle"] == provider["vendor_handle"] for p in found.json()["providers"])

    coast = await client.get("/api/service-providers", headers=vh, params={"region_slug": "coast"})
    assert all(p["handle"] != provider["vendor_handle"] for p in coast.json()["providers"])

    town = await client.get("/api/service-providers", headers=vh, params={"town": "kondele"})
    assert any(p["handle"] == provider["vendor_handle"] for p in town.json()["providers"])


async def test_a_page_that_switched_discovery_off_disappears(client):
    provider = await _provider(client, "quiet")
    viewer = await _provider(client, "browser", location="Nairobi")
    ph, vh = _auth(provider["access_token"]), _auth(viewer["access_token"])
    await _add_service(client, ph, "Quiet massage", 1000)
    await client.put("/api/professional/me/page", headers=ph, json={"discoverable": False})

    r = await client.get("/api/service-providers", headers=vh)
    assert all(p["handle"] != provider["vendor_handle"] for p in r.json()["providers"])


async def test_no_services_is_an_empty_answer_not_an_invented_row(client):
    viewer = await _provider(client, "emptyviewer", location="Nairobi")
    vh = _auth(viewer["access_token"])
    r = await client.get("/api/service-providers", headers=vh, params={"q": "nothing-matches-this"})
    assert r.status_code == 200
    assert r.json()["providers"] == []
    assert r.json()["total"] == 0
    assert "one card per provider" in r.json()["note"].lower()

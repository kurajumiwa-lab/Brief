"""Dormancy is a user journey, not a field assignment.

The browser asks before taking a business off the market. These tests prove
that the backend enforces the same decision independently: both write paths
require a role-bound confirmation, discovery surfaces use one visibility
predicate, the owner's separate front-door setting survives the switch, and
deliberately shared direct links stay reachable.
"""

import uuid

import pytest
from sqlalchemy import update

from app.database import async_session
from app.models.stock import StockItem
from app.models.vendor import Vendor

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"
HERE = (-0.0917, 34.7680)
NEAR = (-0.0930, 34.7700)


async def _register(client, label):
    suffix = uuid.uuid4().hex[:6]
    handle = f"{label}_{suffix}"
    r = await client.post("/api/auth/register", json={
        "business_name": handle.title(),
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["textiles"],
        "physical_location": "Kisumu",
    })
    assert r.status_code == 201, r.text
    token = r.json()
    return token["vendor_id"], {"Authorization": f"Bearer {token['access_token']}"}, handle


async def _place(vendor_id, lat, lng, *, visible=False, score=0):
    async with async_session() as db:
        await db.execute(
            update(Vendor)
            .where(Vendor.id == uuid.UUID(vendor_id))
            .values(
                geo_lat=lat,
                geo_lng=lng,
                front_door_visible=visible,
                network_score=score,
            )
        )
        await db.commit()


async def _offer(vendor_id):
    async with async_session() as db:
        db.add(StockItem(
            vendor_id=uuid.UUID(vendor_id),
            name="Kitenge fabric",
            category="textiles",
            quantity_in_stock=10,
            quantity_available=10,
            unit_of_measure="piece",
            unit_price=1200,
            visible_to_network=True,
        ))
        await db.commit()


async def _my_role(client, headers):
    r = await client.get("/api/vendors/me", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["current_role"]


async def _challenge(client, headers):
    r = await client.post("/api/vendors/switch-role/dormant/confirmation", headers=headers)
    assert r.status_code == 200, r.text
    assert r.headers.get("cache-control") == "no-store"
    return r.json()


def _confirmed_switch(challenge):
    return {
        "expected_current_role": challenge["current_role"],
        "confirm_dormant": True,
        "confirmation_token": challenge["confirmation_token"],
    }


async def _network_ids(client, headers):
    r = await client.get("/api/vendors/network", headers=headers, params={"limit": 200})
    assert r.status_code == 200, r.text
    return {row["id"] for row in r.json()}


async def _discover_ids(client, headers):
    r = await client.get("/api/vendors/discover", headers=headers, params={"limit": 50})
    assert r.status_code == 200, r.text
    return {row["vendor_id"] for row in r.json()}


async def _front_door_ids(client, headers):
    r = await client.get("/api/nearby/front-doors", headers=headers, params={"radius_km": 3})
    assert r.status_code == 200, r.text
    return {row["id"] for row in r.json()["front_doors"]}


async def test_dedicated_role_endpoint_refuses_unconfirmed_dormancy(client):
    vendor_id, headers, _ = await _register(client, "guard_direct")
    assert await _my_role(client, headers) == "both"

    # A bare POST is exactly what the old drawer sent, and exactly what a stale
    # tab or a direct API client could still send. No mutation may occur.
    r = await client.post("/api/vendors/switch-role/dormant", headers=headers)
    assert r.status_code == 428, r.text
    assert r.json()["detail"]["code"] == "dormancy_confirmation_required"
    assert await _my_role(client, headers) == "both"

    # Even an explicit client-side flag is not enough without the server's
    # signed, role-bound token.
    r = await client.post("/api/vendors/switch-role/dormant", headers=headers, json={
        "expected_current_role": "both",
        "confirm_dormant": True,
    })
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "invalid_dormancy_confirmation"
    assert await _my_role(client, headers) == "both"
    assert vendor_id  # the fixture's id is intentionally available to callers


async def test_general_profile_update_uses_the_same_guard(client):
    vendor_id, headers, _ = await _register(client, "guard_put")
    challenge = await _challenge(client, headers)

    r = await client.put("/api/vendors/me", headers=headers, json={
        "current_role": "dormant",
        "expected_current_role": challenge["current_role"],
        "confirm_dormant": True,
        # A typo or dropped field must not become a silent delisting.
        "confirmation_token": None,
    })
    assert r.status_code == 409, r.text
    assert await _my_role(client, headers) == "both"

    r = await client.put("/api/vendors/me", headers=headers, json={
        "current_role": "dormant",
        **_confirmed_switch(challenge),
    })
    assert r.status_code == 200, r.text
    assert await _my_role(client, headers) == "dormant"
    assert vendor_id


async def test_confirmation_cannot_cross_accounts_or_survive_a_role_change(client):
    owner_id, owner, _ = await _register(client, "guard_owner")
    _, other, _ = await _register(client, "guard_other")
    other_challenge = await _challenge(client, other)

    # A token issued to one vendor must never authorise another vendor's
    # delisting, even if both accounts are in the same starting role.
    r = await client.post("/api/vendors/switch-role/dormant", headers=owner,
                          json=_confirmed_switch(other_challenge))
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "invalid_dormancy_confirmation"
    assert await _my_role(client, owner) == "both"

    # A valid token belongs to one transition only. After switching to an
    # active role and back out of dormant, the old "both -> dormant" intent is
    # stale rather than a second consent.
    challenge = await _challenge(client, owner)
    r = await client.post("/api/vendors/switch-role/dormant", headers=owner,
                          json=_confirmed_switch(challenge))
    assert r.status_code == 200, r.text
    r = await client.post("/api/vendors/switch-role/selling", headers=owner)
    assert r.status_code == 200, r.text
    r = await client.post("/api/vendors/switch-role/dormant", headers=owner,
                          json=_confirmed_switch(challenge))
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "stale_role"
    assert await _my_role(client, owner) == "selling"
    assert owner_id


async def test_dormancy_hides_browse_and_discovery_but_preserves_links_and_settings(client):
    observer_id, observer, _ = await _register(client, "guard_observer")
    target_id, target, handle = await _register(client, "guard_target")
    await _place(observer_id, *HERE, visible=False)
    await _place(target_id, *NEAR, visible=True, score=1000)
    await _offer(target_id)

    # Before: the business is present in network browse, ranked discovery and
    # nearby front doors. The separate page/door settings stay intact.
    assert target_id in await _network_ids(client, observer)
    assert target_id in await _discover_ids(client, observer)
    assert target_id in await _front_door_ids(client, observer)
    public = await client.get(f"/p/{handle}")
    assert public.status_code == 200, public.text[:200]
    profile = await client.get(f"/api/vendors/{handle}", headers=observer)
    assert profile.status_code == 200, profile.text

    challenge = await _challenge(client, target)
    r = await client.post("/api/vendors/switch-role/dormant", headers=target,
                          json=_confirmed_switch(challenge))
    assert r.status_code == 200, r.text
    assert r.json()["previous_role"] == "both"

    # After: one common predicate removes it from every discovery surface.
    assert target_id not in await _network_ids(client, observer)
    assert target_id not in await _discover_ids(client, observer)
    assert target_id not in await _front_door_ids(client, observer)

    # Dormancy is not deletion. Direct links, the owner's own records and the
    # separately chosen front-door visibility all remain.
    assert (await client.get(f"/p/{handle}")).status_code == 200
    assert (await client.get(f"/api/vendors/{handle}", headers=observer)).status_code == 200
    assert await _my_role(client, target) == "dormant"
    setting = await client.get("/api/nearby/front-door", headers=target)
    assert setting.status_code == 200 and setting.json()["front_door_visible"] is True

    # Switching back is one step and restores discovery without asking the
    # owner to reconfigure the door.
    r = await client.post("/api/vendors/switch-role/selling", headers=target)
    assert r.status_code == 200, r.text
    assert target_id in await _network_ids(client, observer)
    assert target_id in await _front_door_ids(client, observer)
    assert (await client.get("/api/nearby/front-door", headers=target)).json()["front_door_visible"] is True


async def test_page_discoverable_setting_still_hides_only_browse(client):
    observer_id, observer, _ = await _register(client, "guard_page_observer")
    target_id, target, handle = await _register(client, "guard_page_target")
    await _place(observer_id, *HERE)
    await _place(target_id, *NEAR, visible=True, score=1000)
    await _offer(target_id)

    async with async_session() as db:
        await db.execute(
            update(Vendor)
            .where(Vendor.id == uuid.UUID(target_id))
            .values(public_page={"discoverable": False})
        )
        await db.commit()

    assert target_id not in await _network_ids(client, observer)
    assert target_id not in await _front_door_ids(client, observer)
    assert (await client.get(f"/p/{handle}")).status_code == 200
    assert (await client.get(f"/api/vendors/{handle}", headers=observer)).status_code == 200
    assert target

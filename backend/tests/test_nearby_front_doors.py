"""Nearby front doors: members around a point who currently offer something.

Checks: only people with a visible offering are listed; distance is a filter, not a
promise; your own door is never listed; the kind filter works; no phone numbers leak;
no location says so honestly; hidden offerings do not count.
"""

import uuid

import pytest
from sqlalchemy import update

from app.database import async_session
from app.models.stock import StockItem
from app.models.vendor import Vendor
from app.modules.schedule.models import BookableService

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"
HERE = (-0.0917, 34.7680)      # Kisumu centre
NEAR = (-0.0930, 34.7700)      # ~0.3 km away
FAR = (-0.5000, 35.2000)       # ~55 km away


async def _register(client, handle):
    suffix = uuid.uuid4().hex[:6]
    r = await client.post("/api/auth/register", json={
        "business_name": handle.title(), "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com", "password": PASSWORD,
        "business_categories": ["textiles"], "physical_location": "Kisumu",
    })
    assert r.status_code == 201, r.text
    tok = r.json()
    return tok["vendor_id"], {"Authorization": f"Bearer {tok['access_token']}"}


async def _place(vid, lat, lng, phone=None):
    async with async_session() as db:
        values = {"geo_lat": lat, "geo_lng": lng}
        if phone is not None:
            values["phone"] = phone
        await db.execute(update(Vendor).where(Vendor.id == uuid.UUID(vid)).values(**values))
        await db.commit()


async def _offer(vid, *, goods=0, services=0, visible=True, active=True):
    async with async_session() as db:
        for i in range(goods):
            db.add(StockItem(vendor_id=uuid.UUID(vid), name=f"Good {i}", category="produce",
                             quantity_in_stock=3, quantity_available=3, unit_of_measure="kg",
                             unit_price=100.0, visible_to_network=visible))
        for i in range(services):
            db.add(BookableService(vendor_id=uuid.UUID(vid), name=f"Svc {i}", duration_minutes=30,
                                   price_kes=200, is_active=active))
        await db.commit()


async def _doors(client, h, **params):
    r = await client.get("/api/nearby/front-doors", headers=h, params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def test_lists_nearby_people_who_offer_and_skips_the_rest(client):
    me, hme = await _register(client, "fd_me")
    await _place(me, *HERE)
    open_id, _ = await _register(client, "fd_open")
    await _place(open_id, *NEAR)
    await _offer(open_id, goods=1)
    quiet_id, _ = await _register(client, "fd_quiet")       # nearby, offers nothing
    await _place(quiet_id, *NEAR)
    far_id, _ = await _register(client, "fd_far")           # offers, but far away
    await _place(far_id, *FAR)
    await _offer(far_id, goods=1)

    body = await _doors(client, hme, radius_km=3)
    ids = {d["id"] for d in body["front_doors"]}
    assert open_id in ids
    assert quiet_id not in ids and far_id not in ids
    assert body["anchor"] == "you" and body["reason"] is None
    mine_row = next(d for d in body["front_doors"] if d["id"] == open_id)
    assert mine_row["offers"] == {"goods": 1}
    assert mine_row["distance_km"] < 1.0


async def test_never_lists_yourself(client):
    me, hme = await _register(client, "fd_self")
    await _place(me, *HERE)
    await _offer(me, goods=2)
    body = await _doors(client, hme, radius_km=3)
    assert all(d["id"] != me for d in body["front_doors"])


async def test_kind_filter(client):
    me, hme = await _register(client, "fd_kind_me")
    await _place(me, *HERE)
    goods_id, _ = await _register(client, "fd_kind_goods")
    await _place(goods_id, *NEAR)
    await _offer(goods_id, goods=1)
    svc_id, _ = await _register(client, "fd_kind_svc")
    await _place(svc_id, *NEAR)
    await _offer(svc_id, services=1)

    only_services = await _doors(client, hme, radius_km=3, kind="service")
    svc_ids = {d["id"] for d in only_services["front_doors"]}
    assert svc_id in svc_ids and goods_id not in svc_ids
    only_goods = await _doors(client, hme, radius_km=3, kind="goods")
    goods_ids = {d["id"] for d in only_goods["front_doors"]}
    assert goods_id in goods_ids and svc_id not in goods_ids


async def test_hidden_and_inactive_offerings_do_not_count(client):
    me, hme = await _register(client, "fd_hidden_me")
    await _place(me, *HERE)
    hid, _ = await _register(client, "fd_hidden")
    await _place(hid, *NEAR)
    await _offer(hid, goods=2, visible=False)     # not on the network
    await _offer(hid, services=1, active=False)   # switched off
    body = await _doors(client, hme, radius_km=3)
    assert all(d["id"] != hid for d in body["front_doors"])


async def test_no_phone_numbers_in_the_response(client):
    me, hme = await _register(client, "fd_privacy_me")
    await _place(me, *HERE)
    other, _ = await _register(client, "fd_privacy_other")
    await _place(other, *NEAR, phone="+254700000123")
    await _offer(other, goods=1)
    body = await _doors(client, hme, radius_km=3)
    assert body["front_doors"], "the nearby person should be listed"
    assert "+254700000123" not in str(body)
    assert "phone" not in body["front_doors"][0]


async def test_no_location_says_so_and_returns_nothing(client):
    _, h = await _register(client, "fd_noloc")     # no geo set
    body = await _doors(client, h, radius_km=3)
    assert body["anchor"] is None
    assert body["reason"] == "no_location"
    assert body["front_doors"] == []


def far_id_not_listed(body, me):
    return all(d["id"] != me for d in body["front_doors"])


async def test_explicit_point_overrides_own_location(client):
    me, hme = await _register(client, "fd_point_me")
    await _place(me, *FAR)                          # I am far away...
    other, _ = await _register(client, "fd_point_other")
    await _place(other, *NEAR)
    await _offer(other, goods=1)
    body = await _doors(client, hme, lat=HERE[0], lng=HERE[1], radius_km=3)
    assert body["anchor"] == "point"
    ids = {d["id"] for d in body["front_doors"]}
    assert other in ids and far_id_not_listed(body, me)


async def test_needs_sign_in(client):
    r = await client.get("/api/nearby/front-doors")
    assert r.status_code in (401, 403)

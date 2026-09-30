"""Daily Flash MOQ qualification, one-day roll and exact-volume supplier quotes."""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.config import settings
from app.services.market_locks import daily_flash_times, minimum_bid_quantity

pytestmark = pytest.mark.asyncio

EAT = ZoneInfo("Africa/Nairobi")
PASSWORD = "Correct-horse-9"


async def _register(client, prefix: str) -> tuple[dict, str]:
    suffix = uuid.uuid4().hex[:8]
    handle = f"{prefix}_{suffix}"
    response = await client.post("/api/auth/register", json={
        "business_name": f"{prefix.title()} {suffix[:4]}", "vendor_handle": handle,
        "email": f"{handle}@example.com", "password": PASSWORD,
        "business_categories": ["fresh produce"], "physical_location": "Nairobi",
    })
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, handle


def _staff_roles(monkeypatch, **assignments):
    monkeypatch.setattr(settings, "MARKET_OPS_ROLES", ",".join(f"{role}:{handle}" for role, handle in assignments.items()))


async def _zone_product(client, admin):
    zone_response = await client.post("/api/locks/ops/zones", headers=admin, json={
        "name": f"Pilot {uuid.uuid4().hex[:5]}", "city": "Nairobi", "walkable_ring": "Test ring",
    })
    assert zone_response.status_code == 201, zone_response.text
    product_response = await client.post("/api/locks/ops/products", headers=admin, json={
        "name": f"Test tomatoes {uuid.uuid4().hex[:5]}", "category": "produce", "unit_of_measure": "crates",
    })
    assert product_response.status_code == 201, product_response.text
    return zone_response.json(), product_response.json()


async def _offer(client, headers, supplier_handle, zone, product, moq):
    response = await client.post("/api/locks/ops/offers", headers=headers, json={
        "supplier_handle": supplier_handle, "zone_id": zone["id"], "product_id": product["id"],
        "minimum_order_quantity": moq, "notes": "checked test sheet",
    })
    assert response.status_code == 201, response.text
    return response.json()


async def _window(client, admin, zone, *, close_in=timedelta(hours=2)):
    now = datetime.now(timezone.utc)
    day = now.astimezone(EAT).date().isoformat()
    opens = now + timedelta(seconds=2)
    closes = now + close_in
    delivery = closes + timedelta(hours=8)
    response = await client.post("/api/locks/ops/windows", headers=admin, json={
        "zone_id": zone["id"], "local_date": day,
        "opens_at": opens.isoformat(), "closes_at": closes.isoformat(), "delivery_at": delivery.isoformat(),
    })
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("moq,expected", [(1, 1), (10, 9), (11, 10), (40, 34), (101, 86)])
async def test_bid_floor_uses_integer_ceiling_of_85_percent(moq, expected):
    assert minimum_bid_quantity(moq) == expected


async def test_daily_flash_times_are_3pm_to_8pm_eat_and_next_day_delivery():
    today = datetime.now(EAT).date()
    opens, closes, delivery = daily_flash_times(today)
    assert opens.replace(tzinfo=timezone.utc).astimezone(EAT).hour == 15
    assert closes.replace(tzinfo=timezone.utc).astimezone(EAT).hour == 20
    local_delivery = delivery.replace(tzinfo=timezone.utc).astimezone(EAT)
    assert local_delivery.hour == 5 and local_delivery.date() == today + timedelta(days=1)


async def test_vendor_zone_assignment_enforces_thirty_day_change_cooldown(client, monkeypatch):
    admin, admin_handle = await _register(client, "zoneadmin")
    vendor, _ = await _register(client, "zonebuyer")
    _staff_roles(monkeypatch, admin=admin_handle)
    zone_a, _ = await _zone_product(client, admin)
    zone_b_response = await client.post("/api/locks/ops/zones", headers=admin, json={
        "name": f"Other {uuid.uuid4().hex[:5]}", "city": "Nairobi",
    })
    assert zone_b_response.status_code == 201, zone_b_response.text
    zone_b = zone_b_response.json()

    first = await client.post("/api/locks/me/zone", headers=vendor, json={"zone_id": zone_a["id"]})
    assert first.status_code == 200, first.text
    home = await client.get("/api/locks/me", headers=vendor)
    assert home.status_code == 200 and home.json()["vendor_zone"]["id"] == zone_a["id"]
    assert home.json()["can_change_zone"] is False
    denied = await client.post("/api/locks/me/zone", headers=vendor, json={"zone_id": zone_b["id"]})
    assert denied.status_code == 409


async def test_pooled_zone_demand_qualifies_and_negotiator_selects_lowest_exact_volume_quote(client, monkeypatch):
    admin, admin_handle = await _register(client, "lockadmin")
    supplier_a, supplier_a_handle = await _register(client, "supplier_a")
    supplier_b, supplier_b_handle = await _register(client, "supplier_b")
    vendor_a, _ = await _register(client, "buyer_a")
    vendor_b, _ = await _register(client, "buyer_b")
    outside_vendor, _ = await _register(client, "outside")
    _staff_roles(monkeypatch, admin=admin_handle, negotiator=admin_handle)

    zone, product = await _zone_product(client, admin)
    offer_a = await _offer(client, admin, supplier_a_handle, zone, product, 10)  # threshold 9
    offer_b = await _offer(client, admin, supplier_b_handle, zone, product, 10)  # threshold 9
    window = await _window(client, admin, zone)
    await asyncio.sleep(2.1)  # The API correctly rejects picks before the configured open time.

    for headers in (vendor_a, vendor_b):
        assigned = await client.post("/api/locks/me/zone", headers=headers, json={"zone_id": zone["id"]})
        assert assigned.status_code == 200, assigned.text
    denied = await client.post(f"/api/locks/windows/{window['id']}/picks", headers=outside_vendor, json={
        "product_id": product["id"], "quantity": 9,
    })
    assert denied.status_code == 403

    first = await client.post(f"/api/locks/windows/{window['id']}/picks", headers=vendor_a, json={
        "product_id": product["id"], "quantity": 4,
    })
    assert first.status_code == 201, first.text
    second = await client.post(f"/api/locks/windows/{window['id']}/picks", headers=vendor_b, json={
        "product_id": product["id"], "quantity": 5,
    })
    assert second.status_code == 201, second.text
    cluster_id = second.json()["cluster"]["id"]
    assert second.json()["cluster"]["quantity"] == 9
    assert second.json()["cluster"]["vendor_count"] == 2

    evaluated = await client.post(f"/api/locks/ops/windows/{window['id']}/close", headers=admin)
    assert evaluated.status_code == 200, evaluated.text
    assert evaluated.json()["qualified"] == 1
    assert evaluated.json()["status"] == "closed"
    board = (await client.get("/api/locks/ops/board", headers=admin)).json()
    cluster = next(c for w in board["windows"] for c in w["clusters"] if c["id"] == cluster_id)
    assert cluster["status"] == "bidding" and cluster["bid_quantity"] == 9
    assert {offer["id"] for offer in cluster["supplier_offers"] if offer["eligible"]} == {offer_a["id"], offer_b["id"]}

    wrong_volume = await client.post(f"/api/locks/ops/clusters/{cluster_id}/quotes", headers=admin, json={
        "supplier_moq_id": offer_a["id"], "quoted_quantity": 10, "unit_price": 500,
    })
    assert wrong_volume.status_code == 400
    quote_a = await client.post(f"/api/locks/ops/clusters/{cluster_id}/quotes", headers=admin, json={
        "supplier_moq_id": offer_a["id"], "quoted_quantity": 9, "unit_price": 500,
    })
    quote_b = await client.post(f"/api/locks/ops/clusters/{cluster_id}/quotes", headers=admin, json={
        "supplier_moq_id": offer_b["id"], "quoted_quantity": 9, "unit_price": 450,
    })
    assert quote_a.status_code == quote_b.status_code == 201

    selected = await client.post(f"/api/locks/ops/clusters/{cluster_id}/select/{quote_a.json()['id']}", headers=admin)
    assert selected.status_code == 200, selected.text
    # The human negotiator can weigh recorded terms beyond price alone; both offers
    # are for the same actual volume, and the backend does not auto-pick cheapest.
    assert selected.json()["quantity"] == 9 and selected.json()["unit_price"] == 500
    assert selected.json()["supplier_handle"] == supplier_a_handle
    assert (await client.get("/api/locks/ops/board", headers=admin)).status_code == 200


async def test_below_threshold_rolls_once_for_24_hours_then_dissolves(client, monkeypatch):
    admin, admin_handle = await _register(client, "rolladmin")
    supplier, supplier_handle = await _register(client, "rollsupplier")
    vendor, _ = await _register(client, "rollbuyer")
    _staff_roles(monkeypatch, admin=admin_handle)
    zone, product = await _zone_product(client, admin)
    await _offer(client, admin, supplier_handle, zone, product, 10)  # floor 9
    window = await _window(client, admin, zone)
    await asyncio.sleep(2.1)
    assert (await client.post("/api/locks/me/zone", headers=vendor, json={"zone_id": zone["id"]})).status_code == 200
    pick = await client.post(f"/api/locks/windows/{window['id']}/picks", headers=vendor, json={
        "product_id": product["id"], "quantity": 8,
    })
    assert pick.status_code == 201, pick.text

    rolled = await client.post(f"/api/locks/ops/windows/{window['id']}/close", headers=admin)
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["status"] == "rolling" and rolled.json()["roll_count"] == 1
    board = (await client.get("/api/locks/ops/board", headers=admin)).json()
    rolled_window = next(w for w in board["windows"] if w["id"] == window["id"])
    assert (datetime.fromisoformat(rolled_window["closes_at"].replace("Z", "+00:00")) - datetime.fromisoformat(window["closes_at"].replace("Z", "+00:00"))) == timedelta(days=1)
    assert rolled_window["clusters"][0]["status"] == "collecting"

    dissolved = await client.post(f"/api/locks/ops/windows/{window['id']}/close", headers=admin)
    assert dissolved.status_code == 200, dissolved.text
    assert dissolved.json()["status"] == "closed" and dissolved.json()["dissolved"] == 1
    board = (await client.get("/api/locks/ops/board", headers=admin)).json()
    final_window = next(w for w in board["windows"] if w["id"] == window["id"])
    assert final_window["clusters"][0]["status"] == "dissolved"

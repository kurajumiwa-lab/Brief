"""Pulse windows and the atomic, inventory-capped flash drop."""

from datetime import datetime

import pytest

from app.modules.pulse.service import pulse, round_tiers
from tests.test_smoke import _auth, _register

pytestmark = pytest.mark.asyncio


def test_payday_mid_month_and_weekend_windows():
    payday = pulse(datetime(2026, 11, 25, 10, 0))
    assert payday["active"]["key"] == "payday"
    assert payday["active"]["rail_color"] == "#E65100"
    assert "25" in payday["active"]["starts_at"]

    # The 15th is both mid-month and a Sunday; mid-month wins.
    mid = pulse(datetime(2026, 11, 15, 10, 0))
    assert mid["active"]["key"] == "mid_month"

    friday = pulse(datetime(2026, 11, 20, 10, 0))  # 13:00 Nairobi
    assert friday["active"]["key"] == "weekend"
    assert friday["active"]["ends_at"].endswith("+03:00")

    quiet = pulse(datetime(2026, 11, 19, 10, 0))  # Thursday
    assert quiet["active"] is None
    assert quiet["next"]["key"] == "weekend"
    assert "11-20T12:00:00+03:00" in quiet["next"]["starts_at"]


def test_group_round_ladder_unlocks_at_five_and_fifteen():
    starter = round_tiers(3, 100)
    assert starter["current_tier"]["key"] == "starter"
    assert starter["next_tier"]["key"] == "group"
    assert starter["units_to_next_tier"] == 2
    assert starter["tiers"][0]["price_per_unit"] == 115.0

    group = round_tiers(14, 100)
    assert group["current_tier"]["key"] == "group"
    assert group["next_tier"]["key"] == "best"
    assert group["units_to_next_tier"] == 1

    best = round_tiers(20, 100)
    assert best["current_tier"]["key"] == "best"
    assert best["next_tier"] is None
    assert best["tiers"][2]["price_per_unit"] == 85.0


async def test_flash_drop_claim_is_one_unit_per_person_and_capped(client):
    seller, buyer, other, third = [await _register(client, name, ["food"])
                                   for name in ("drop_seller", "drop_buyer", "drop_other", "drop_third")]
    sh, bh, oh, th = (_auth(x["access_token"]) for x in (seller, buyer, other, third))

    too_long = await client.post("/api/pulse/flash-drops", headers=sh, json={
        "label": "Mandazi box", "capacity": 2, "duration_minutes": 61, "price_kes": 200,
    })
    assert too_long.status_code == 422

    made = await client.post("/api/pulse/flash-drops", headers=sh, json={
        "label": "Mandazi box", "description": "Eight pieces, fried at 4pm.",
        "capacity": 2, "duration_minutes": 60, "price_kes": 200,
    })
    assert made.status_code == 201, made.text
    drop_id = made.json()["drop"]["id"]
    assert made.json()["drop"]["remaining"] == 2

    own = await client.post(f"/api/pulse/flash-drops/{drop_id}/claim", headers=sh)
    assert own.status_code == 409

    public = await client.get("/api/pulse/flash-drops")
    assert public.status_code == 200
    assert [d["id"] for d in public.json()["drops"]] == [drop_id]

    first = await client.post(f"/api/pulse/flash-drops/{drop_id}/claim", headers=bh)
    assert first.status_code == 200, first.text
    assert first.json()["claimed"] is True
    assert first.json()["drop"]["remaining"] == 1
    assert "next drop" in first.json()["message"].lower()

    again = await client.post(f"/api/pulse/flash-drops/{drop_id}/claim", headers=bh)
    assert again.status_code == 200
    assert again.json()["claimed"] is False
    assert "already" in again.json()["message"].lower()
    assert (await client.get("/api/pulse/flash-drops")).json()["drops"][0]["remaining"] == 1

    second = await client.post(f"/api/pulse/flash-drops/{drop_id}/claim", headers=oh)
    assert second.json()["claimed"] is True
    assert second.json()["drop"]["remaining"] == 0
    assert (await client.get("/api/pulse/flash-drops")).json()["drops"] == []

    sold_out = await client.post(f"/api/pulse/flash-drops/{drop_id}/claim", headers=th)
    assert sold_out.status_code == 409

    mine = await client.get("/api/pulse/flash-drops/mine", headers=bh)
    assert mine.status_code == 200
    assert len(mine.json()["claims"]) == 1
    assert mine.json()["claims"][0]["drop"]["label"] == "Mandazi box"

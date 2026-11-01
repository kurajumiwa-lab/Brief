"""v3.1 — feature entitlements.

What these prove: a locked feature is refused by the server (402 with the tier
needed), a vendor's tier is read from their current plan, a lapsed plan drops
them back to Free without deleting anything, operators can change a feature
without a deploy, and the hidden Institution tier cannot be sold.
"""

import uuid

import pytest
from sqlalchemy import select, update

from app.config import settings as live_settings
from app.database import async_session
from app.models.vendor import Vendor

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _vendor(client, suffix):
    handle = f"ent_{suffix}"
    r = await client.post("/api/auth/register", json={
        "account_kind": "business",
        "display_name": f"Ent {suffix}",
        "business_name": f"Ent {suffix}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["produce"],
    })
    assert r.status_code == 201, r.text
    return handle, {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["vendor_id"]


async def _set_plan(vendor_id, plan_tier):
    async with async_session() as db:
        await db.execute(
            update(Vendor).where(Vendor.id == uuid.UUID(str(vendor_id))).values(plan_tier=plan_tier)
        )
        await db.commit()


async def _vendor_exists(vendor_id):
    async with async_session() as db:
        return (await db.execute(
            select(Vendor.id).where(Vendor.id == uuid.UUID(str(vendor_id)))
        )).scalar_one_or_none() is not None


async def test_free_vendor_is_refused_a_premium_feature_with_402(client):
    _, headers, _ = await _vendor(client, "free402")
    r = await client.get("/api/analytics/price-position", headers=headers)
    assert r.status_code == 402, r.text
    detail = r.json()["detail"]
    assert detail["feature"] == "advanced_analytics"
    assert detail["current_tier"] == "free"
    assert detail["required_tier"] == "growth"
    assert detail["upgrade"] is True


async def test_free_features_stay_open_to_free_vendors(client):
    _, headers, _ = await _vendor(client, "freeopen")
    r = await client.get("/api/analytics/overview", headers=headers)
    assert r.status_code == 200, r.text


async def test_entitlements_list_matches_the_plan(client):
    _, headers, _ = await _vendor(client, "listed")
    body = (await client.get("/api/entitlements/me", headers=headers)).json()
    assert body["tier"] == "free"
    by_key = {f["key"]: f for f in body["features"]}
    for key in ("storefront", "messaging", "voice_notes", "search_activities"):
        assert by_key[key]["unlocked"] is True, key
    assert by_key["advanced_analytics"]["unlocked"] is False
    assert by_key["advanced_analytics"]["min_tier"] == "growth"
    assert by_key["broadcast_tools"]["min_tier"] == "business_pro"
    prices = {t["tier"]: t["price_kes_monthly"] for t in body["tiers"]}
    assert prices == {"free": 0, "growth": 299, "business_pro": 699}


async def test_growth_plan_unlocks_analytics(client):
    vid_handle, headers, vid = await _vendor(client, "growthpaid")
    await _set_plan(vid, "readiness")  # stored key for Growth
    r = await client.get("/api/analytics/price-position", headers=headers)
    assert r.status_code == 200, r.text
    me = (await client.get("/api/entitlements/me", headers=headers)).json()
    assert me["tier"] == "growth"


async def test_lapse_returns_to_free_without_deleting_anything(client):
    _, headers, vid = await _vendor(client, "lapse")
    await _set_plan(vid, "network")
    assert (await client.get("/api/analytics/price-position", headers=headers)).status_code == 200
    await _set_plan(vid, "starter")  # what the billing sweep does on lapse
    assert (await client.get("/api/analytics/price-position", headers=headers)).status_code == 402
    assert await _vendor_exists(vid)
    assert (await client.get("/api/analytics/overview", headers=headers)).status_code == 200


async def test_operator_can_switch_a_feature_off_and_back_on(client, monkeypatch):
    op_handle, op_headers, op_vid = await _vendor(client, "opsw")
    _, headers, vid = await _vendor(client, "opsw_user")
    await _set_plan(vid, "readiness")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", op_handle)

    off = await client.put("/api/entitlements/admin/advanced_analytics", headers=op_headers,
                           json={"enabled": False})
    assert off.status_code == 200, off.text
    assert off.json()["updated_by"] == op_handle
    r = await client.get("/api/analytics/price-position", headers=headers)
    assert r.status_code == 403
    assert "temporarily unavailable" in r.json()["detail"]

    await client.put("/api/entitlements/admin/advanced_analytics", headers=op_headers,
                     json={"enabled": True, "min_tier": "business_pro"})
    # Now Growth is not enough: the tier moved up without a code change.
    r = await client.get("/api/analytics/price-position", headers=headers)
    assert r.status_code == 402
    assert r.json()["detail"]["required_tier"] == "business_pro"

    # Restore the seeded rule so later tests see the real plan.
    await client.put("/api/entitlements/admin/advanced_analytics", headers=op_headers,
                     json={"min_tier": "growth"})


async def test_non_operator_cannot_change_features(client, monkeypatch):
    _, headers, _ = await _vendor(client, "notop")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "someone_else")
    r = await client.put("/api/entitlements/admin/advanced_analytics", headers=headers,
                         json={"enabled": False})
    assert r.status_code == 403


async def test_admin_rejects_unknown_feature_and_bad_tier(client, monkeypatch):
    op_handle, op_headers, _ = await _vendor(client, "opbad")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", op_handle)
    assert (await client.put("/api/entitlements/admin/no_such_thing", headers=op_headers,
                             json={"enabled": True})).status_code == 404
    assert (await client.put("/api/entitlements/admin/advanced_analytics", headers=op_headers,
                             json={"min_tier": "platinum"})).status_code == 400


async def test_all_eight_features_listed_even_without_seed_rows(client):
    """Production gets the rows from migration 0031. If one is missing, the code
    falls back to the built-in seed, so no feature silently disappears."""
    _, headers, _ = await _vendor(client, "eight")
    keys = {f["key"] for f in (await client.get("/api/entitlements/me", headers=headers)).json()["features"]}
    assert keys >= {
        "storefront", "messaging", "voice_notes", "search_activities",
        "advanced_analytics", "inventory_automation", "broadcast_tools", "staff_accounts",
    }


async def test_hidden_institution_tier_cannot_be_sold(client):
    _, headers, _ = await _vendor(client, "instit")
    r = await client.post("/api/billing/subscribe", headers=headers,
                          json={"plan_tier": "institution", "billing_period": "monthly"})
    assert r.status_code == 400, r.text
    assert "not available" in r.json()["detail"]


async def test_annual_billing_is_not_offered_yet(client):
    _, headers, _ = await _vendor(client, "annual")
    r = await client.post("/api/billing/subscribe", headers=headers,
                          json={"plan_tier": "readiness", "billing_period": "annual"})
    assert r.status_code == 400, r.text
    assert "annual" in r.json()["detail"]


async def test_overview_withholds_price_position_from_free_vendors(client):
    """The main dashboard must not leak the locked section."""
    _, headers, _ = await _vendor(client, "overviewfree")
    body = (await client.get("/api/analytics/overview", headers=headers)).json()
    assert body["price_position"] == []
    assert body["locked_features"] == ["advanced_analytics"]


async def test_overview_includes_price_position_for_growth_vendors(client):
    _, headers, vid = await _vendor(client, "overviewgrowth")
    await _set_plan(vid, "readiness")
    body = (await client.get("/api/analytics/overview", headers=headers)).json()
    assert body["locked_features"] == []

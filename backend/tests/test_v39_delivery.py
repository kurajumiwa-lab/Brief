"""v3.9 — How a shop delivers: pick-up, or a rider the buyer already knows.

What these prove:
- pick-up is always offered, and a shop cannot remove it;
- only the owner changes delivery, and only with a valid rider name, area and number;
- the rider's number is normalised for KE, ET and UG, and a wrong one is refused;
- every change is written to the audit log with before and after values;
- the delivery block carries no fee or money field, and says Brief has not checked the rider;
- the public shop page shows the rider only from an approved, public shop.
"""

import uuid

import pytest
from sqlalchemy import select

from app.database import async_session
from app.modules.trust import service as svc
from app.modules.trust.models import AuditEvent
from tests.test_v38_market_trust import _active_branch, _branch, _business, _staff  # noqa: F401
from tests.test_v35_offers import ops  # noqa: F401 (fixture reuse)

RIDER = {"options": ["pickup", "known_rider"], "area": "Kisii town, Nyanchwa",
         "rider_name": "Otieno", "rider_phone": "0712 345 678"}


@pytest.mark.asyncio
async def test_phone_numbers_are_normalised_per_country():
    assert svc.normalise_phone("0712 345 678", "KE") == "+254712345678"
    assert svc.normalise_phone("+254 712 345 678", "KE") == "+254712345678"
    assert svc.normalise_phone("0911 234 567", "ET") == "+251911234567"
    assert svc.normalise_phone("0772 123 456", "UG") == "+256772123456"
    for bad in ("", "12345", "0712", "+1 555 0100"):
        with pytest.raises(svc.TrustError):
            svc.normalise_phone(bad, "KE")


@pytest.mark.asyncio
async def test_pick_up_is_the_default_and_always_kept(client, ops):
    _, owner, _ = await _business(client, "dlv1")
    bid = await _branch(client, owner)
    mine = (await client.get("/api/trust/branches/mine", headers=owner)).json()["branches"][0]
    assert mine["delivery"]["options"] == ["pickup"]
    assert mine["delivery"]["rider"] is None
    r = await client.put(f"/api/trust/branches/{bid}/delivery", headers=owner, json={"options": ["known_rider"]})
    assert r.status_code == 422  # a rider needs an area, name and number
    r = await client.put(f"/api/trust/branches/{bid}/delivery", headers=owner, json={"options": []})
    assert r.status_code == 422
    r = await client.put(f"/api/trust/branches/{bid}/delivery", headers=owner, json={"options": ["courier_api"]})
    assert r.status_code == 422  # not an option Brief offers
    r = await client.put(f"/api/trust/branches/{bid}/delivery", headers=owner, json={"options": ["known_rider"],
                                                                                    "area": "Ki", "rider_name": "Otieno",
                                                                                    "rider_phone": "0712345678"})
    assert r.status_code == 422  # area too short


@pytest.mark.asyncio
async def test_owner_saves_a_known_rider_and_the_buyer_sees_it_on_an_active_shop(client, ops):
    _, owner, _ = await _business(client, "dlv2")
    _, staff, _ = await _staff(client, None, ops, "dlv2staff")
    bid = await _active_branch(client, owner, staff, country="KE")
    r = await client.put(f"/api/trust/branches/{bid}/delivery", headers=owner, json=RIDER)
    assert r.status_code == 200, r.text
    assert "not checked" in r.json()["detail"].lower()
    pub = (await client.get(f"/api/trust/public/branches/{bid}")).json()["branch"]["delivery"]
    assert set(pub["options"]) == {"pickup", "known_rider"}
    # the rider's personal number is never public: no consent flag exists yet
    assert pub["rider"] == {"area": "Kisii town, Nyanchwa", "name": "Otieno", "phone": None}
    assert "254712345678" not in str(pub)
    assert pub["rider_checked_by_brief"] is False
    text = str(pub).lower()
    assert "fee" in pub["fee_note"].lower() and "fee_kes" not in text and "price" not in text


@pytest.mark.asyncio
async def test_only_the_owner_can_change_delivery(client, ops):
    _, owner, _ = await _business(client, "dlv3")
    _, other, _ = await _business(client, "dlv3other")
    bid = await _branch(client, owner)
    r = await client.put(f"/api/trust/branches/{bid}/delivery", headers=other, json=RIDER)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_switching_back_to_pick_up_clears_the_rider_and_is_audited(client, ops):
    _, owner, _ = await _business(client, "dlv4")
    bid = await _branch(client, owner)
    assert (await client.put(f"/api/trust/branches/{bid}/delivery", headers=owner, json=RIDER)).status_code == 200
    r = await client.put(f"/api/trust/branches/{bid}/delivery", headers=owner, json={"options": ["pickup"]})
    assert r.status_code == 200, r.text
    mine = (await client.get("/api/trust/branches/mine", headers=owner)).json()["branches"][0]
    assert mine["delivery"]["rider"] is None and mine["delivery"]["options"] == ["pickup"]
    async with async_session() as db:
        rows = (await db.execute(select(AuditEvent).where(
            AuditEvent.entity_id == uuid.UUID(bid), AuditEvent.action == "delivery_updated"))).scalars().all()
    assert len(rows) == 2
    before_after = sorted([(r.payload["before"]["options"], r.payload["after"]["options"]) for r in rows])
    assert any(a == ["pickup"] for _, a in before_after) and any("known_rider" in a for _, a in before_after)


@pytest.mark.asyncio
async def test_delivery_never_touches_money(client, ops):
    _, owner, _ = await _business(client, "dlv5")
    bid = await _branch(client, owner)
    body = (await client.put(f"/api/trust/branches/{bid}/delivery", headers=owner, json=RIDER)).json()
    blob = str(body).lower()
    for word in ("fee_kes", "price", "payout", "commission", "wallet", "balance"):
        assert word not in blob
    assert body["delivery"]["rider_checked_by_brief"] is False

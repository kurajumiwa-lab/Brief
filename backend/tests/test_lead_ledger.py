"""Verified lead ledger: dedupe, direct settlement, scout credit and statement."""

from datetime import datetime

import pytest

from tests.test_referrals import _campaign, _link, _register, _shop

pytestmark = pytest.mark.asyncio


async def test_one_handshake_per_person_and_a_monthly_statement(client):
    merchant, merchant_id, _ = await _register(client, "lead_merchant")
    buyer, buyer_id, _ = await _register(client, "lead_buyer")
    scout, scout_id, scout_handle = await _register(client, "lead_scout")

    shop = await _shop(merchant_id)
    campaign = await _campaign(client, merchant, shop)
    link = await _link(client, scout, campaign["id"])

    first = await client.post("/api/leads/record", headers=buyer, json={
        "target_kind": "vendor", "target_id": merchant_id, "action": "call",
        "scout_code": link["code"].lower(), "details": {"source": "public rate card"},
    })
    assert first.status_code == 200, first.text
    assert first.json()["recorded"] is True
    assert first.json()["scout_credited"] is True
    lead = first.json()["lead"]
    assert lead["fee_kes"] == 5 and lead["bounty_kes"] == 1
    assert lead["scout"]["handle"] == scout_handle

    # A second tap by the same person is the same handshake, not a second bill.
    again = await client.post("/api/leads/record", headers=buyer, json={
        "target_kind": "vendor", "target_id": merchant_id, "action": "whatsapp",
        "scout_code": link["code"],
    })
    assert again.status_code == 200
    assert again.json()["recorded"] is False
    assert again.json()["lead"]["id"] == lead["id"]

    month = datetime.utcnow().strftime("%Y-%m")
    statement = await client.get(f"/api/leads/statement?month={month}", headers=merchant)
    assert statement.status_code == 200, statement.text
    body = statement.json()
    assert body["verified_leads"] == 1
    assert body["unique_people"] == 1
    assert body["due_kes"] == 5
    assert body["scout_bounty_kes"] == 1
    assert body["scouts_credited"] == 1
    assert body["by_target_kind"] == {"vendor": 1}
    assert body["statement"][0]["scout"]["handle"] == scout_handle
    assert "never holds" in body["note"].lower()

    scout_statement = await client.get(f"/api/leads/scouted?month={month}", headers=scout)
    assert scout_statement.status_code == 200
    assert scout_statement.json()["leads"] == 1
    assert scout_statement.json()["earned_kes"] == 1

    # A buyer cannot bill their own business.
    own = await client.post("/api/leads/record", headers=buyer, json={
        "target_kind": "vendor", "target_id": buyer_id, "action": "call",
    })
    assert own.status_code == 409

    # A bad code records the handshake but does not invent a scout.
    unknown = await client.post("/api/leads/record", headers=buyer, json={
        "target_kind": "vendor", "target_id": scout_id, "action": "visit",
        "scout_code": "NOPE999",
    })
    assert unknown.status_code == 200
    assert unknown.json()["recorded"] is True
    assert unknown.json()["scout_credited"] is False

    bad_action = await client.post("/api/leads/record", headers=buyer, json={
        "target_kind": "vendor", "target_id": merchant_id, "action": "lick",
    })
    assert bad_action.status_code == 422

    missing = await client.post("/api/leads/record", headers=buyer, json={
        "target_kind": "vendor", "target_id": "00000000-0000-0000-0000-000000000000",
        "action": "call",
    })
    assert missing.status_code == 404

    bad_month = await client.get("/api/leads/mine?month=2026-13", headers=merchant)
    assert bad_month.status_code == 422


async def test_event_leads_credit_the_organiser(client):
    organiser, _organiser_id, _ = await _register(client, "lead_organiser")
    guest, _guest_id, _ = await _register(client, "lead_guest")
    start = datetime.utcnow().replace(microsecond=0)
    event = await client.post("/api/events/create", headers=organiser, json={
        "title": "Lead source tasting",
        "start_date": start.isoformat(),
        "end_date": start.isoformat(),
        "event_type": "networking",
        "entry_fee": 0,
    })
    assert event.status_code == 201, event.text
    event_id = event.json()["event_id"]

    recorded = await client.post("/api/leads/record", headers=guest, json={
        "target_kind": "event", "target_id": event_id, "action": "book",
    })
    assert recorded.status_code == 200, recorded.text
    assert recorded.json()["lead"]["target_label"] == "Lead source tasting"

    mine = await client.get("/api/leads/mine", headers=organiser)
    assert mine.status_code == 200
    assert mine.json()["recent"][0]["target_kind"] == "event"
    assert mine.json()["recent"][0]["target_id"] == event_id
    assert mine.json()["due_kes"] == 5

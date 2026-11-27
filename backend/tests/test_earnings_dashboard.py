"""My Opportunities & Earnings — the member's economic evidence.

These tests pin the three properties that make the dashboard honest:

  * every number is a count or a sum of rows that exist (no estimates
    sneak in, and the one labelled estimate is labelled);
  * pending, due and paid are never mixed; points are never money;
  * a member sees only their own record — a neighbour's completed contract
    never appears in my totals.
"""

import uuid
from datetime import datetime, timedelta

import pytest

from app.database import async_session
from app.models.events import Event, EventRegistration
from app.models.hustle import HustleContract, HustleJobCall
from app.modules.knowledge.models import KnowledgeListing
from app.modules.referrals.models import Referral
from app.modules.town.models import ReferralConversion, ReferralListing
from app.modules.trade.models import (
    BusinessRequest,
    OfferStatus,
    RequestOffer,
    RequestType,
)
from tests.test_referrals import _campaign, _register, _shop

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _mine(client, label):
    headers, vendor_id, handle = await _register(client, label)
    return headers, uuid.UUID(vendor_id)


async def _seed_records(client, me, me_id, other, other_id, referred_id):
    now = datetime.utcnow()

    # 6a. A shop-campaign referral for me that the merchant already marked paid.
    shop = await _shop(str(other_id), name="Earnings Test Shop")
    campaign = await _campaign(client, other, shop, reward_kes=500, reward_points=120,
                               title="Earnings test bounty")
    async with async_session() as db:
        db.add(Referral(
            campaign_id=uuid.UUID(campaign["id"]), referrer_vendor_id=me_id,
            referred_vendor_id=referred_id, status="qualified",
            reward_points=120, bounty_kes=500, bounty_status="paid",
            qualified_at=now, bounty_marked_at=now,
        ))
        await db.commit()

    async with async_session() as db:
        # 1. A completed squad contract with a confirmed payout.
        call = HustleJobCall(
            vendor_id=me_id, title="Door repaint", task_type="craft", skill="painting",
            pay_kes=3000, expires_at=now + timedelta(days=7),
        )
        db.add(call)
        await db.flush()
        db.add(HustleContract(
            job_call_id=call.id, player_vendor_id=me_id, agreed_pay_kes=3000,
            status="completed", completed_at=now, payout_status="completed",
        ))

        # 2a. A town-referral conversion verified by the funder, bounty due.
        listing = ReferralListing(
            owner_vendor_id=other_id, provider="Safaricom", category="services",
            title="Refer a new home fibre line", bounty_kes=250,
        )
        db.add(listing)
        await db.flush()
        db.add(ReferralConversion(
            listing_id=listing.id, actor_vendor_id=referred_id, referrer_vendor_id=me_id,
            status="verified", bounty_kes=250, bounty_status="due",
            reward_points=30, verified_at=now,
        ))
        # 2b. A second town conversion, still awaiting review — pending is not due.
        pending_listing = ReferralListing(
            owner_vendor_id=other_id, provider="Twiga-style wholesaler", category="retail",
            title="Refer a monthly bulk buyer", bounty_kes=100,
        )
        db.add(pending_listing)
        await db.flush()
        db.add(ReferralConversion(
            listing_id=pending_listing.id, actor_vendor_id=referred_id, referrer_vendor_id=me_id,
            status="pending", bounty_kes=100, bounty_status="not_due",
        ))

        # 3a. An event of mine, ticket KES 500, two confirmed seats.
        event = Event(
            organizer_id=me_id, title="Nairobi supplier breakfast",
            start_date=now + timedelta(days=14), end_date=now + timedelta(days=14, hours=3),
            entry_fee=500.0,
        )
        db.add(event)
        await db.flush()
        for seat in range(2):
            db.add(EventRegistration(
                event_id=event.id, vendor_id=other_id if seat == 0 else referred_id,
                booking_status="CONFIRMED", status="registered",
            ))
        # 3b. Someone else's event that I attended — counts as one connection for me.
        their_event = Event(
            organizer_id=referred_id, title="Kisumu market visits",
            start_date=now + timedelta(days=7), end_date=now + timedelta(days=7, hours=4),
        )
        db.add(their_event)
        await db.flush()
        db.add(EventRegistration(
            event_id=their_event.id, vendor_id=me_id,
            booking_status="CONFIRMED", status="attended",
        ))

        # 4. A completed consulting listing.
        db.add(KnowledgeListing(
            organiser_vendor_id=me_id, kind="seminar", sector="retail",
            title="Pricing your maize flour", promised_outcomes="A price you can defend",
            delivered_outcomes="Delivered", price_kes=1000, status="completed",
            delivered_at=now,
        ))

        # 5. My open request, and my pending offer on theirs.
        db.add(BusinessRequest(
            requester_vendor_id=me_id, request_type=RequestType.STOCK,
            description="Need 20 bags of maize flour, 2kg, delivered weekly",
            location="Kisumu market", needed_by="this_week",
        ))
        their_request = BusinessRequest(
            requester_vendor_id=referred_id, request_type=RequestType.SERVICE,
            description="Need a branded truck tarpaulin re-sewn",
            location="Kisumu", needed_by="flexible",
        )
        db.add(their_request)
        await db.flush()
        db.add(RequestOffer(
            request_id=their_request.id, responder_vendor_id=me_id,
            note="Can deliver and re-sew this week", price_kes=4500,
            status=OfferStatus.OFFERED,
        ))
        await db.commit()


async def test_earnings_me_aggregates_own_record(client):
    me_headers, me_id = await _mine(client, "earnings_me")
    other_headers, other_id = await _mine(client, "earnings_other")
    _, referred_id = await _mine(client, "earnings_referred")

    await _seed_records(client, me_headers, me_id, other_headers, other_id, referred_id)

    r = await client.get("/api/earnings/me", headers=me_headers)
    assert r.status_code == 200, r.text
    body = r.json()

    summary = body["summary"]
    assert summary["completed_projects"] == 1
    # one town conversion verified + one shop campaign referral qualified
    assert summary["successful_referrals"] == 2
    assert summary["event_connections"] == 3
    assert summary["active_opportunities"] == 2

    commissions = body["commissions"]
    assert commissions["pending_kes"] == 100 and commissions["pending_count"] == 1
    assert commissions["due_kes"] == 250 and commissions["due_count"] == 1
    assert commissions["paid_kes"] == 500 and commissions["paid_count"] == 1
    assert commissions["reward_points"] == 150
    assert commissions["project_payouts_recorded_kes"] == 3000
    assert commissions["event_value_estimate_kes"] == 1000

    keys = [c["key"] for c in body["channels"]]
    assert keys == ["projects", "referrals", "events", "partnerships", "knowledge", "rentals"]
    by_key = {c["key"]: c for c in body["channels"]}
    assert by_key["projects"]["count"] == 1
    assert by_key["referrals"]["count"] == 2
    assert by_key["partnerships"]["count"] is None
    assert by_key["rentals"]["count"] is None
    assert by_key["knowledge"]["count"] == 1

    assert body["not_measured"] and all("why" in item for item in body["not_measured"])
    assert "pending" in body["note"].lower() and "points" in body["note"].lower()


async def test_earnings_excludes_neighbours(client):
    me_headers, me_id = await _mine(client, "earn_iso_me")
    other_headers, other_id = await _mine(client, "earn_iso_other")
    _, referred_id = await _mine(client, "earn_iso_referred")

    # The neighbour does the completing, the referring and the hosting.
    await _seed_records(client, other_headers, other_id, me_headers, me_id, referred_id)

    r = await client.get("/api/earnings/me", headers=me_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"] == {
        "completed_projects": 0,
        "successful_referrals": 0,
        "event_connections": 0,
        "active_opportunities": 0,
    }
    assert body["commissions"]["due_kes"] == 0 and body["commissions"]["paid_kes"] == 0
    assert body["recent"] == []


async def test_earnings_requires_sign_in(client):
    r = await client.get("/api/earnings/me")
    assert r.status_code in (401, 403)


async def test_earnings_empty_state_is_honest(client):
    headers, _ = await _mine(client, "earn_fresh")
    r = await client.get("/api/earnings/me", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"] == {
        "completed_projects": 0,
        "successful_referrals": 0,
        "event_connections": 0,
        "active_opportunities": 0,
    }
    assert body["commissions"]["paid_kes"] == 0
    assert body["recent"] == []
    # The honest page still tells the reader what it cannot count.
    assert len(body["not_measured"]) >= 4

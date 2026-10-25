"""v2.15 — subscription billing (Track 2).

The point of these tests is not that a vendor can buy a plan. It is that a plan
can only be granted by a *verified provider event*, that a replayed event cannot
settle twice, and that a lapse returns the account to Starter without touching
records or verification.

Mock provider throughout: these tests prove the state machine. They are not
evidence that recurring billing is live, and `billing.live` is asserted false
for exactly that reason.
"""

import json
import uuid

import pytest
from sqlalchemy import select

from app.config import settings as live_settings
from app.database import async_session
from app.modules.billing.models import Subscription, SubscriptionInvoice
from app.services.psp_client import sign_webhook

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _vendor(client, suffix):
    handle = f"bill_{suffix}"
    r = await client.post("/api/auth/register", json={
        "account_kind": "business",
        "display_name": f"Bill {suffix}",
        "business_name": f"Bill {suffix}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["produce"],
    })
    assert r.status_code == 201, r.text
    return handle, {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["vendor_id"]


async def _sub_row(vendor_id):
    async with async_session() as db:
        return (await db.execute(
            select(Subscription).where(Subscription.vendor_id == uuid.UUID(str(vendor_id)))
            .order_by(Subscription.created_at.desc()).limit(1)
        )).scalar_one_or_none()


async def _invoice_rows(sub_id):
    async with async_session() as db:
        return (await db.execute(
            select(SubscriptionInvoice).where(SubscriptionInvoice.subscription_id == sub_id)
            .order_by(SubscriptionInvoice.issued_at)
        )).scalars().all()


# --- what the platform may and may not claim ---------------------------------

async def test_billing_says_it_is_not_live_on_the_mock_provider(client):
    _, headers, _ = await _vendor(client, "live_flag")
    body = (await client.get("/api/billing/me", headers=headers)).json()
    assert body["billing"]["live"] is False
    assert "mock" in body["billing"]["provider"]
    assert body["billing"]["reason"]
    assert body["subscription"] is None
    assert any(p["tier"] == "readiness" for p in body["catalogue"])


async def test_free_tier_cannot_be_subscribed_to(client):
    _, headers, _ = await _vendor(client, "free_tier")
    r = await client.post("/api/billing/subscribe", json={"plan_tier": "starter"}, headers=headers)
    assert r.status_code == 400
    assert "free" in r.json()["detail"].lower()


async def test_unknown_tier_is_rejected(client):
    _, headers, _ = await _vendor(client, "bad_tier")
    r = await client.post("/api/billing/subscribe", json={"plan_tier": "platinum"}, headers=headers)
    assert r.status_code == 400


# --- the happy path, and the duplicate that must not double-charge ------------

async def test_paid_invoice_activates_the_plan_exactly_once(client):
    handle, headers, vendor_id = await _vendor(client, "happy")

    r = await client.post("/api/billing/subscribe",
                          json={"plan_tier": "readiness", "billing_period": "monthly"},
                          headers=headers)
    assert r.status_code == 201, r.text
    body = r.json()
    invoice_id = body["invoice"]["id"]
    reference = body["invoice"]["psp_reference"]
    assert body["subscription"]["status"] == "trialing"
    assert body["invoice"]["status"] == "pending"

    # A verified provider event settles it.
    raw = json.dumps({"type": "subscription.paid", "api_ref": reference,
                      "amount": body["invoice"]["amount_kes"], "id": "MOCK-1"}).encode()
    signed = await client.post("/api/payments/webhook", content=raw, headers={
        "Content-Type": "application/json",
        "X-Webhook-Signature": sign_webhook(raw),
    })
    assert signed.status_code == 200, signed.text

    after = (await client.get("/api/billing/me", headers=headers)).json()
    assert after["subscription"]["status"] == "active"
    assert after["invoices"][0]["status"] == "paid"
    assert after["plan"]["tier"] == "readiness"

    # Replay: identical body, identical reference. Nothing may move twice.
    replay = await client.post("/api/payments/webhook", content=raw, headers={
        "Content-Type": "application/json",
        "X-Webhook-Signature": sign_webhook(raw),
    })
    assert replay.status_code == 200
    rows = await _invoice_rows(uuid.UUID(body["subscription"]["id"]))
    assert len(rows) == 1
    assert rows[0].status == "paid"
    assert rows[0].paid_at is not None

    sub = await _sub_row(vendor_id)
    assert sub.current_period_end > sub.current_period_start


async def test_a_mismatched_amount_does_not_settle(client):
    _, headers, _ = await _vendor(client, "amount")
    body = (await client.post("/api/billing/subscribe", json={"plan_tier": "readiness"},
                              headers=headers)).json()
    raw = json.dumps({"type": "subscription.paid", "api_ref": body["invoice"]["psp_reference"],
                      "amount": 1, "id": "MOCK-BAD"}).encode()
    r = await client.post("/api/payments/webhook", content=raw, headers={
        "Content-Type": "application/json", "X-Webhook-Signature": sign_webhook(raw)})
    # The handler refuses to apply it, so the PSP is told to retry rather than
    # the platform silently accepting a KES 1 payment for a KES 2,900 plan.
    assert r.status_code == 502
    after = (await client.get("/api/billing/me", headers=headers)).json()
    assert after["invoices"][0]["status"] == "pending"


async def test_a_forged_subscription_event_is_rejected_at_the_door(client):
    handle, headers, _ = await _vendor(client, "forged_sub")
    await client.post("/api/billing/subscribe", json={"plan_tier": "readiness"}, headers=headers)
    raw = json.dumps({"type": "subscription.paid", "api_ref": "SUBINV-FORGED-1-AAAAAA",
                      "amount": 2900}).encode()
    r = await client.post("/api/payments/webhook", content=raw, headers={
        "Content-Type": "application/json", "X-Webhook-Signature": "0" * 64})
    assert r.status_code == 401


# --- failure, grace, lapse ----------------------------------------------------

async def test_failed_charge_enters_grace_then_lapses_to_starter(client, monkeypatch):
    handle, headers, vendor_id = await _vendor(client, "lapse")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", handle)

    body = (await client.post("/api/billing/subscribe", json={"plan_tier": "readiness"},
                              headers=headers)).json()
    reference = body["invoice"]["psp_reference"]

    raw = json.dumps({"type": "subscription.failed", "api_ref": reference,
                      "reason": "Insufficient funds"}).encode()
    r = await client.post("/api/payments/webhook", content=raw, headers={
        "Content-Type": "application/json", "X-Webhook-Signature": sign_webhook(raw)})
    assert r.status_code == 200

    after = (await client.get("/api/billing/me", headers=headers)).json()
    assert after["subscription"]["status"] == "past_due"
    assert after["subscription"]["grace_until"]
    assert after["invoices"][0]["status"] == "failed"
    assert after["invoices"][0]["failure_reason"] == "Insufficient funds"
    # Grace keeps the features the vendor is already relying on.
    assert after["plan"]["tier"] == "readiness"

    # Force the clock past grace and run the sweep the scheduler would run.
    sub = await _sub_row(vendor_id)
    from datetime import datetime, timedelta
    from app.modules.billing import service as billing

    async with async_session() as db:
        row = await db.get(Subscription, sub.id)
        row.grace_until = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()
        result = await billing.run_lifecycle_sweep(db)
    assert result["expired_past_due"] >= 1

    final = (await client.get("/api/billing/me", headers=headers)).json()
    assert final["subscription"]["status"] == "expired"
    assert final["plan"]["tier"] == "starter"
    # The plan changed; the account and its records did not disappear.
    me = await client.get("/api/vendors/me", headers=headers)
    assert me.status_code == 200


async def test_cancel_at_period_end_keeps_the_plan_until_the_period_ends(client, monkeypatch):
    handle, headers, vendor_id = await _vendor(client, "cancel")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", handle)

    body = (await client.post("/api/billing/subscribe", json={"plan_tier": "readiness"},
                              headers=headers)).json()
    # Settle it first so the vendor is on a paid period, not a trial.
    await client.post(f"/api/billing/invoices/{body['invoice']['id']}/simulate", headers=headers)

    cancel = await client.post("/api/billing/cancel", json={}, headers=headers)
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["subscription"]["cancel_at_period_end"] is True
    # Still on the plan they paid for.
    assert (await client.get("/api/billing/me", headers=headers)).json()["plan"]["tier"] == "readiness"

    from datetime import datetime, timedelta
    from app.modules.billing import service as billing

    sub = await _sub_row(vendor_id)
    async with async_session() as db:
        row = await db.get(Subscription, sub.id)
        row.current_period_start = datetime.utcnow() - timedelta(days=31)
        row.current_period_end = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()
        result = await billing.run_lifecycle_sweep(db)
    assert result["cancelled_at_period_end"] >= 1

    final = (await client.get("/api/billing/me", headers=headers)).json()
    assert final["subscription"]["status"] == "cancelled"
    assert final["plan"]["tier"] == "starter"


# --- the mock affordance must not exist on a live provider -------------------

async def test_simulate_is_unavailable_once_a_real_provider_is_configured(client, monkeypatch):
    _, headers, _ = await _vendor(client, "no_sim")
    body = (await client.post("/api/billing/subscribe", json={"plan_tier": "readiness"},
                              headers=headers)).json()
    monkeypatch.setattr(live_settings, "PSP_PROVIDER", "intasend")
    r = await client.post(f"/api/billing/invoices/{body['invoice']['id']}/simulate", headers=headers)
    assert r.status_code == 404
    assert "verified webhook" in r.json()["detail"]


async def test_sweep_is_operator_only(client, monkeypatch):
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", "somebody_else")
    _, headers, _ = await _vendor(client, "sweep")
    assert (await client.post("/api/billing/sweep", headers=headers)).status_code == 403
    assert (await client.post("/api/billing/sweep")).status_code == 401


async def test_mock_provider_cannot_grant_a_plan_in_production(client, monkeypatch):
    """A mock PSP must not sell a plan in production — same rule as payments."""
    from app.config import settings as cfg

    _, headers, _ = await _vendor(client, "prod_mock")
    monkeypatch.setattr(cfg, "ENVIRONMENT", "production")
    r = await client.post("/api/billing/subscribe", json={"plan_tier": "readiness"}, headers=headers)
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]
    body = (await client.get("/api/billing/me", headers=headers)).json()
    assert body["subscription"] is None


async def test_a_settled_invoice_leaves_revenue_evidence(client):
    """Billing history must be auditable: a paid invoice is also a revenue event."""
    from sqlalchemy import select

    from app.models.governance import RevenueEvent

    _, headers, _ = await _vendor(client, "revenue")
    body = (await client.post("/api/billing/subscribe", json={"plan_tier": "readiness"},
                              headers=headers)).json()
    await client.post(f"/api/billing/invoices/{body['invoice']['id']}/simulate", headers=headers)

    async with async_session() as db:
        events = (await db.execute(
            select(RevenueEvent).where(RevenueEvent.source_type == "subscription",
                                       RevenueEvent.source_reference == body["invoice"]["id"])
        )).scalars().all()
    assert len(events) == 1
    event = events[0]
    assert int(event.net_amount_ksh) == body["invoice"]["amount_kes"]
    # Evidence names the provider and the reference it can be reconciled against.
    assert "mock" in event.evidence_note.lower()
    assert body["invoice"]["psp_reference"] in event.evidence_note

"""Referral engine contract.

The promises under test:

  · a campaign belongs to a shop the merchant has actually claimed;
  · a code alone moves nothing — the referral stays pending;
  · only a server-verified receipt at that shop qualifies it;
  · a person who was already a customer is rejected, not rewarded;
  · points are an append-only reward, and a cash bounty is a direct payment
    the merchant records, never a platform balance;
  · the public invite card opens without an account, but claiming needs one.
"""

import uuid
from datetime import datetime, timedelta

import pytest

from app.database import async_session
from app.models.receipts import ReceiptMerchant

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


def _pin() -> str:
    number = uuid.uuid4().int % 1_000_000_000
    return f"P{number:09d}{chr(65 + uuid.uuid4().int % 26)}"


def _invoice() -> str:
    return f"INV-{uuid.uuid4().hex[:10].upper()}"


def _qr(pin: str, invoice: str, total: int = 1250, name: str = "Kisumu Chemist") -> str:
    when = datetime.utcnow() - timedelta(minutes=5)
    return (
        f"MerchantName={name}&TraderSystemPin={pin}"
        f"&ControlUnitInvoiceNumber={invoice}&TotalAmount={total}"
        f"&IssuedAt={when.isoformat()}"
    )


async def _register(client, label: str) -> tuple[dict, str, str]:
    suffix = uuid.uuid4().hex[:6]
    handle = f"{label}_{suffix}"
    response = await client.post("/api/auth/register", json={
        "business_name": f"{label.title()} Ltd",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["receipts"],
        "physical_location": "Kisumu",
        "account_kind": "person",
    })
    assert response.status_code == 201, response.text
    body = response.json()
    return (
        {"Authorization": f"Bearer {body['access_token']}"},
        body["vendor_id"],
        body["vendor_handle"],
    )


async def _shop(owner_id: str, *, status: str = "verified", name: str = "Kisumu Chemist") -> ReceiptMerchant:
    async with async_session() as db:
        shop = ReceiptMerchant(
            pin=_pin(), name=name, region="nyanza", claim_status=status,
            claimed_by_vendor_id=uuid.UUID(owner_id), verified_at=datetime.utcnow(),
        )
        db.add(shop)
        await db.commit()
        await db.refresh(shop)
        return shop


async def _campaign(client, owner, shop, **overrides):
    body = {
        "shop_id": str(shop.id),
        "title": "Bring a new customer",
        "description": "A new customer who buys anything counts.",
        "region_slug": "nyanza",
        "reward_points": 40,
        "reward_kes": 150,
        "max_referrals": 5,
    }
    body.update(overrides)
    response = await client.post("/api/referrals/campaigns", json=body, headers=owner)
    assert response.status_code == 201, response.text
    return response.json()["campaign"]


async def _link(client, referrer, campaign_id):
    response = await client.post(f"/api/referrals/campaigns/{campaign_id}/link", headers=referrer)
    assert response.status_code == 201, response.text
    return response.json()["link"]


async def test_campaign_link_and_verified_receipt_release_points_and_bounty(client):
    owner, owner_id, _ = await _register(client, "ref_owner")
    referrer, _referrer_id, _ = await _register(client, "ref_person")
    customer, _customer_id, _ = await _register(client, "ref_new")

    shop = await _shop(owner_id)
    campaign = await _campaign(client, owner, shop)
    assert campaign["merchant"]["pin"] == shop.pin
    assert campaign["reward_points"] == 40
    assert campaign["reward_kes"] == 150
    assert campaign["budget_kes"] == 750  # 5 places × KSh 150, a ceiling not a wallet

    link = await _link(client, referrer, campaign["id"])
    assert link["code"].startswith("R")
    assert link["path"] == f"/r/{link['code']}"

    # The WhatsApp card opens with no bearer token.
    public = await client.get(f"/api/referrals/public/codes/{link['code']}")
    assert public.status_code == 200, public.text
    assert public.json()["campaign"]["title"] == "Bring a new customer"
    assert public.json()["referrer"]["handle"]

    # Claiming is authenticated and the claim is not a conversion.
    claim = await client.post("/api/referrals/claim", json={"code": link["code"]}, headers=customer)
    assert claim.status_code == 201, claim.text
    referral_id = claim.json()["referral"]["id"]
    assert claim.json()["referral"]["status"] == "pending"
    assert claim.json()["already_linked"] is False

    pending = await client.get("/api/referrals/me", headers=referrer)
    assert pending.status_code == 200, pending.text
    assert pending.json()["summary"]["pending"] == 1
    assert pending.json()["summary"]["qualified"] == 0
    assert pending.json()["summary"]["points_earned"] == 0

    # A typed receipt earns nothing and must not qualify a referral.
    manual = await client.post("/api/receipts", json={
        "source": "manual", "merchant_name": shop.name, "total": 1250,
        "region": "nyanza", "merchant_pin": shop.pin,
    }, headers=customer)
    assert manual.status_code == 201, manual.text
    assert manual.json()["receipt"]["status"] == "manual"
    assert manual.json()["referral"] is None

    # The verified receipt is the evidence. The same response names the referral.
    scan = await client.post("/api/receipts", json={
        "payload": _qr(shop.pin, _invoice()), "region": "nyanza",
    }, headers=customer)
    assert scan.status_code == 201, scan.text
    assert scan.json()["receipt"]["status"] == "verified"
    assert scan.json()["referral"]["status"] == "qualified"
    assert scan.json()["referral"]["id"] == referral_id

    earned = await client.get("/api/referrals/me", headers=referrer)
    assert earned.status_code == 200, earned.text
    data = earned.json()
    assert data["summary"]["pending"] == 0
    assert data["summary"]["qualified"] == 1
    assert data["summary"]["points_earned"] == 40
    assert data["summary"]["bounty_due_kes"] == 150
    assert data["referrals"][0]["bounty_status"] == "due"
    assert data["referrals"][0]["evidence"]["receipt_total"] == 1250

    points = await client.get("/api/trust/points", headers=referrer)
    assert points.status_code == 200, points.text
    assert points.json()["balance_points"] == 40
    assert points.json()["entries"][0]["reason_key"] == "referral_verified"

    # A second verified receipt at the same shop does not double-pay.
    second = await client.post("/api/receipts", json={
        "payload": _qr(shop.pin, _invoice()), "region": "nyanza",
    }, headers=customer)
    assert second.status_code == 201, second.text
    assert second.json()["referral"] is None
    still = await client.get("/api/referrals/me", headers=referrer)
    assert still.json()["summary"]["points_earned"] == 40

    # Only the shop that funds the campaign can record the direct payment.
    forbidden = await client.post(f"/api/referrals/{referral_id}/paid", json={"note": "not my campaign"}, headers=referrer)
    assert forbidden.status_code == 403

    paid = await client.post(f"/api/referrals/{referral_id}/paid", json={
        "note": "Send Money QK72 test",
    }, headers=owner)
    assert paid.status_code == 200, paid.text
    assert paid.json()["referral"]["bounty_status"] == "paid"
    assert paid.json()["referral"]["bounty_note"] == "Send Money QK72 test"

    after = await client.get("/api/referrals/me", headers=referrer)
    assert after.json()["summary"]["bounty_due_kes"] == 0
    assert after.json()["summary"]["bounty_paid_kes"] == 150

    # The merchant sees the person who came in and the receipt total.
    owner_view = await client.get("/api/referrals/me", headers=owner)
    assert owner_view.status_code == 200, owner_view.text
    assert owner_view.json()["received"][0]["referred"]["handle"]
    assert owner_view.json()["received"][0]["bounty_status"] == "paid"


async def test_existing_customer_is_rejected_and_a_pending_claim_is_safe(client):
    owner, owner_id, _ = await _register(client, "ref_owner2")
    referrer, _referrer_id, _ = await _register(client, "ref_person2")
    returning, _returning_id, _ = await _register(client, "ref_returning")

    shop = await _shop(owner_id, name="Milimani Shop")
    campaign = await _campaign(client, owner, shop, reward_points=10, reward_kes=0)
    link = await _link(client, referrer, campaign["id"])

    # This person was a customer before the invitation existed.
    before = await client.post("/api/receipts", json={
        "payload": _qr(shop.pin, _invoice(), name=shop.name), "region": "nyanza",
    }, headers=returning)
    assert before.status_code == 201, before.text

    claim = await client.post("/api/referrals/claim", json={"code": link["code"]}, headers=returning)
    assert claim.status_code == 201, claim.text
    assert claim.json()["referral"]["status"] == "pending"

    after = await client.post("/api/receipts", json={
        "payload": _qr(shop.pin, _invoice(), name=shop.name), "region": "nyanza",
    }, headers=returning)
    assert after.status_code == 201, after.text
    assert after.json()["referral"]["status"] == "rejected"
    assert "already a customer" in after.json()["referral"]["rejected_reason"].lower()

    points = await client.get("/api/trust/points", headers=referrer)
    assert points.json()["balance_points"] == 0


async def test_campaign_needs_an_owned_publishable_shop_and_a_reward(client):
    owner, _owner_id, _ = await _register(client, "ref_owner3")
    other, other_id, _ = await _register(client, "ref_owner4")
    shop = await _shop(other_id, status="pending")

    stranger = await client.post("/api/referrals/campaigns", json={
        "shop_id": str(shop.id), "title": "Not mine", "reward_points": 10,
    }, headers=owner)
    assert stranger.status_code == 404

    pending = await client.post("/api/referrals/campaigns", json={
        "shop_id": str(shop.id), "title": "Not verified yet", "reward_points": 10,
    }, headers=other)
    assert pending.status_code == 403

    verified = await _shop(other_id, name="Verified Shop")
    free = await client.post("/api/referrals/campaigns", json={
        "shop_id": str(verified.id), "title": "Free work", "reward_points": 0, "reward_kes": 0,
    }, headers=other)
    assert free.status_code == 422

    made = await client.post("/api/referrals/campaigns", json={
        "shop_id": str(verified.id), "title": "A real reward", "reward_points": 10,
    }, headers=other)
    assert made.status_code == 201, made.text

    # The funder cannot claim their own campaign's bounty.
    own = await client.post(f"/api/referrals/campaigns/{made.json()['campaign']['id']}/link", headers=other)
    assert own.status_code == 409

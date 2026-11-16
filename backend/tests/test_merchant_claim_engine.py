"""The probationary claim engine.

The promises under test:

  · a fresh challenge sale unlocks probation immediately, never `verified`;
  · the amount is server-chosen, exact and single-use;
  · a probationary owner can redeem vouchers and run one capped offer;
  · a probationary owner cannot confirm trade proofs (no standing farming);
  · two independent Level 3+ neighbours can unlock probation, but collusion is
    refused;
  · a contest freezes new offers while keeping issued vouchers redeemable;
  · 14 days plus three paying customers promotes to verified, with no operator.
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.database import async_session
from app.models.receipts import Receipt, ReceiptMerchant, ReceiptOffer, ReceiptVoucher
from app.models.vendor import Vendor, VendorProfile

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


def _pin() -> str:
    return f"P{uuid.uuid4().int % 1_000_000_000:09d}{chr(65 + uuid.uuid4().int % 26)}"


def _invoice() -> str:
    return f"INV-{uuid.uuid4().hex[:10].upper()}"


def _qr(pin, invoice, total, *, issued_at=None, name="Kakamega Hardware Hub"):
    when = issued_at or datetime.utcnow()
    return (
        f"MerchantName={name}&TraderSystemPin={pin}"
        f"&ControlUnitInvoiceNumber={invoice}&TotalAmount={total}"
        f"&IssuedAt={when.isoformat()}"
    )


async def _register(client, label):
    suffix = uuid.uuid4().hex[:6]
    handle = f"{label}_{suffix}"
    response = await client.post("/api/auth/register", json={
        "business_name": f"{label.title()} Ltd",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["receipts"],
        "physical_location": "Kakamega, Western",
    })
    assert response.status_code == 201, response.text
    body = response.json()
    return (
        {"Authorization": f"Bearer {body['access_token']}"},
        uuid.UUID(body["vendor_id"]),
        handle,
    )


async def _claimed_shop(client, *, region="western", name=None):
    shop_name = name or f"Kakamega Hardware {uuid.uuid4().hex[:6]}"
    owner, owner_id, _ = await _register(client, "claim_owner")
    pin, invoice = _pin(), _invoice()
    scanned = await client.post("/api/receipts", headers=owner, json={
        "payload": _qr(pin, invoice, 1250, name=shop_name), "region": region,
    })
    assert scanned.status_code == 201, scanned.text
    claim = await client.post(f"/api/receipts/merchants/{pin}/claim", headers=owner, json={
        "name": shop_name, "region": region, "phone": "0712000111",
    })
    assert claim.status_code == 201, claim.text
    assert claim.json()["merchant"]["claim_status"] == "pending"
    return owner, owner_id, pin, claim.json()["merchant"]["id"]


async def _challenge(client, headers, pin):
    response = await client.post(f"/api/receipts/merchants/{pin}/claim/challenge", headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["challenge"]


async def _answer_challenge(client, headers, pin, amount, *, total=None, issued_at=None, invoice=None):
    return await client.post(
        f"/api/receipts/merchants/{pin}/claim/evidence",
        headers=headers,
        json={"payload": _qr(pin, invoice or _invoice(), total if total is not None else amount,
                             issued_at=issued_at or datetime.utcnow())},
    )


async def test_fresh_challenge_sale_unlocks_probation_not_verified(client):
    owner, _owner_id, pin, _merchant_id = await _claimed_shop(client)
    challenge = await _challenge(client, owner, pin)
    assert 1 <= challenge["amount_kes"] <= 99
    assert challenge["expires_at"]

    wrong = await _answer_challenge(client, owner, pin, challenge["amount_kes"], total=challenge["amount_kes"] + 1)
    assert wrong.status_code == 422
    assert "exactly" in wrong.text.lower()

    wrong_pin = await client.post(
        f"/api/receipts/merchants/{pin}/claim/evidence",
        headers=owner,
        json={"payload": _qr(_pin(), _invoice(), challenge["amount_kes"])},
    )
    assert wrong_pin.status_code == 422
    assert "pin" in wrong_pin.text.lower()

    stale = await _answer_challenge(
        client, owner, pin, challenge["amount_kes"],
        total=challenge["amount_kes"], issued_at=datetime.utcnow() - timedelta(minutes=30),
    )
    assert stale.status_code == 422
    assert "before the test amount" in stale.text.lower() or "window" in stale.text.lower()

    accepted = await _answer_challenge(client, owner, pin, challenge["amount_kes"])
    assert accepted.status_code == 200, accepted.text
    merchant = accepted.json()["merchant"]
    assert merchant["claim_status"] == "probationary"
    assert merchant["verified"] is False
    assert merchant["probationary"] is True
    assert merchant["can_redeem"] is True
    assert merchant["can_publish_offers"] is True
    assert merchant["can_confirm_trade_proofs"] is False
    assert merchant["probation_until"]

    # One receipt answers one challenge. The shop is already probationary, so a
    # second submission cannot silently reset or extend it.
    replay = await _answer_challenge(client, owner, pin, challenge["amount_kes"])
    assert replay.status_code == 409


async def test_probation_caps_offers_and_vouchers(client):
    owner, _owner_id, pin, _merchant_id = await _claimed_shop(client)
    challenge = await _challenge(client, owner, pin)
    assert (await _answer_challenge(client, owner, pin, challenge["amount_kes"])).status_code == 200

    first = await client.post("/api/receipts/offers", headers=owner, json={
        "title": "KES 20 off", "discount_kes": 20, "points_cost": 0,
    })
    assert first.status_code == 201, first.text
    second = await client.post("/api/receipts/offers", headers=owner, json={
        "title": "KES 30 off", "discount_kes": 30, "points_cost": 0,
    })
    assert second.status_code == 409
    assert "one" in second.text.lower() or "1" in second.text

    offer_id = first.json()["id"]
    customers = [await _register(client, f"claim_customer_{index}") for index in range(6)]
    for headers, _vid, _handle in customers[:5]:
        claimed = await client.post(f"/api/receipts/offers/{offer_id}/claim", headers=headers)
        assert claimed.status_code == 201, claimed.text
    capped = await client.post(f"/api/receipts/offers/{offer_id}/claim", headers=customers[5][0])
    assert capped.status_code == 409
    assert "five" in capped.text.lower() or "5" in capped.text


async def test_probation_cannot_confirm_trade_proofs(client):
    owner, owner_id, pin, _merchant_id = await _claimed_shop(client, name="Claim Shop Ltd")
    challenge = await _challenge(client, owner, pin)
    assert (await _answer_challenge(client, owner, pin, challenge["amount_kes"])).status_code == 200

    async with async_session() as db:
        owner_row = await db.get(Vendor, owner_id)
        owner_name = owner_row.business_name
        # The seller is found by the shop PIN even while the merchant row is
        # probationary; that is exactly the path the guard must block.
        profile = (await db.execute(
            select(VendorProfile).where(VendorProfile.vendor_id == owner_id)
        )).scalar_one_or_none()
        if profile is None:
            db.add(VendorProfile(vendor_id=owner_id, tax_id=pin))
        else:
            profile.tax_id = pin
        await db.commit()

    buyer, _buyer_id, _ = await _register(client, "claim_buyer")
    scanned = await client.post("/api/receipts", headers=buyer, json={
        "payload": _qr(pin, _invoice(), 700, name=owner_name), "region": "western",
    })
    assert scanned.status_code == 201, scanned.text

    proof = (await client.get("/api/receipts/trade-proofs", headers=owner)).json()["proofs"][0]
    assert proof["status"] == "pending"
    assert proof["can_confirm"] is False
    assert "verified" in (proof.get("confirm_locked_reason") or "").lower()
    denied = await client.post(f"/api/receipts/trade-proofs/{proof['id']}/confirm", headers=owner)
    assert denied.status_code == 403
    assert "verified" in denied.text.lower()


async def test_two_independent_vouches_unlock_probation(client):
    owner, owner_id, pin, _merchant_id = await _claimed_shop(client)
    now = datetime.utcnow()

    async def make_voucher(label):
        headers, vid, _ = await _register(client, label)
        async with async_session() as db:
            row = await db.get(Vendor, vid)
            row.phone = "0712000222"
            row.allow_direct_calls = True
            row.movements_completed = 1
            row.joined_at = now - timedelta(days=40)
            merchant = (await db.execute(
                ReceiptMerchant.__table__.select().where(ReceiptMerchant.pin == pin)
            )).first()
            for index in range(2):
                db.add(Receipt(
                    vendor_id=vid, merchant_id=merchant.id, merchant_pin=pin,
                    merchant_name="Kakamega Hardware Hub", invoice_no=f"V-{uuid.uuid4().hex[:8]}",
                    total=200, issued_at=now - timedelta(minutes=10),
                    scanned_at=now - timedelta(minutes=5), source="qr", status="verified",
                    freshness_key="fresh", base_points=4, points=4,
                    dedupe_key=f"VO-{uuid.uuid4().hex}", region="western",
                ))
            await db.commit()
        return headers, vid

    first_headers, first_id = await make_voucher("vouch_one")
    first = await client.post(f"/api/receipts/merchants/{pin}/claim/vouch", headers=first_headers, json={})
    assert first.status_code == 201, first.text
    assert first.json()["merchant"]["claim_status"] == "pending"
    assert first.json()["vouch"] == {"vouches": 1, "needed": 2}

    duplicate = await client.post(f"/api/receipts/merchants/{pin}/claim/vouch", headers=first_headers, json={})
    assert duplicate.status_code == 422

    second_headers, _second_id = await make_voucher("vouch_two")
    second = await client.post(f"/api/receipts/merchants/{pin}/claim/vouch", headers=second_headers, json={})
    assert second.status_code == 201, second.text
    assert second.json()["merchant"]["claim_status"] == "probationary"
    assert second.json()["merchant"]["claim_path"] == "peer_vouch"
    assert second.json()["merchant"]["can_confirm_trade_proofs"] is False

    # The claimant cannot vouch for themselves.
    self_vouch = await client.post(f"/api/receipts/merchants/{pin}/claim/vouch", headers=owner, json={})
    assert self_vouch.status_code == 422
    assert "cannot vouch" in self_vouch.text.lower()


async def test_contest_freezes_new_offers_but_keeps_vouchers_redeemable(client):
    owner, _owner_id, pin, _merchant_id = await _claimed_shop(client)
    challenge = await _challenge(client, owner, pin)
    assert (await _answer_challenge(client, owner, pin, challenge["amount_kes"])).status_code == 200

    offer = await client.post("/api/receipts/offers", headers=owner, json={
        "title": "KES 20 off", "discount_kes": 20, "points_cost": 0,
    })
    assert offer.status_code == 201, offer.text
    customer, _customer_id, _ = await _register(client, "contest_customer")
    voucher = (await client.post(
        f"/api/receipts/offers/{offer.json()['id']}/claim", headers=customer,
    )).json()["voucher"]

    contestant, _contestant_id, _ = await _register(client, "contestant")
    contest = await client.post(f"/api/receipts/merchants/{pin}/claim/contest", headers=contestant, json={
        "reason": "I own the till and this claim is not mine.",
        "payload": _qr(pin, _invoice(), 350, issued_at=datetime.utcnow()),
    })
    assert contest.status_code == 201, contest.text
    assert contest.json()["merchant"]["claim_status"] == "contested"

    frozen = await client.post("/api/receipts/offers", headers=owner, json={
        "title": "Another deal", "discount_kes": 10, "points_cost": 0,
    })
    assert frozen.status_code == 403

    # An already-issued voucher is a customer's property; it still works.
    redeemed = await client.post("/api/receipts/merchant/redeem", headers=owner, json={
        "code": voucher["code"], "voucher_id": voucher["id"],
    })
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json()["voucher"]["status"] == "redeemed"

    answered = await client.post(f"/api/receipts/merchants/{pin}/claim/contest/answer", headers=owner, json={
        "payload": _qr(pin, _invoice(), 120, issued_at=datetime.utcnow()),
    })
    assert answered.status_code == 200, answered.text
    assert answered.json()["merchant"]["claim_status"] == "probationary"
    assert answered.json()["merchant"]["contest_deadline"] is None


async def test_unanswered_contest_returns_to_review(client):
    owner, _owner_id, pin, _merchant_id = await _claimed_shop(client)
    challenge = await _challenge(client, owner, pin)
    assert (await _answer_challenge(client, owner, pin, challenge["amount_kes"])).status_code == 200
    contestant, _contestant_id, _ = await _register(client, "contest_expire")
    assert (await client.post(f"/api/receipts/merchants/{pin}/claim/contest", headers=contestant, json={
        "reason": "This is not the real owner of the shop.",
        "payload": _qr(pin, _invoice(), 90, issued_at=datetime.utcnow()),
    })).status_code == 201

    async with async_session() as db:
        merchant = (await db.execute(
            ReceiptMerchant.__table__.select().where(ReceiptMerchant.pin == pin)
        )).first()
        row = await db.get(ReceiptMerchant, merchant.id)
        row.contest_deadline = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()

    mine = await client.get("/api/receipts/merchants/me", headers=owner)
    assert mine.status_code == 200, mine.text
    assert mine.json()["merchants"][0]["claim_status"] == "pending"


async def test_fourteen_days_and_three_customers_promote_to_verified(client):
    owner, owner_id, pin, merchant_id = await _claimed_shop(client)
    challenge = await _challenge(client, owner, pin)
    assert (await _answer_challenge(client, owner, pin, challenge["amount_kes"])).status_code == 200

    now = datetime.utcnow()
    customer_ids = []
    for index in range(3):
        _headers, customer_id, _handle = await _register(client, f"promote_customer_{index}")
        customer_ids.append(customer_id)
    async with async_session() as db:
        merchant = await db.get(ReceiptMerchant, uuid.UUID(merchant_id))
        merchant.probation_until = now - timedelta(days=1)
        for index, customer_id in enumerate(customer_ids):
            db.add(ReceiptVoucher(
                merchant_id=merchant.id, vendor_id=customer_id,
                value_kes=20, points_cost=0, code_seed=f"promote-{index}-{uuid.uuid4().hex}",
                status="redeemed", issued_at=now - timedelta(days=2),
                expires_at=now + timedelta(days=10), redeemed_at=now - timedelta(days=1),
            ))
        await db.commit()

    mine = await client.get("/api/receipts/merchants/me", headers=owner)
    assert mine.status_code == 200, mine.text
    row = mine.json()["merchants"][0]
    assert row["claim_status"] == "verified"
    assert row["claim_path"] == "trading_history"
    assert row["can_confirm_trade_proofs"] is True

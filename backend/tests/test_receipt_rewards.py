"""Receipt rewards server contract.

The tests are written from the product's promises, not the schema:

  · a QR is parsed by the server; a client cannot post points
  · freshness is decided by the server clock
  · one invoice is one reward across every account
  · a typed receipt records but earns nothing
  · a merchant cannot publish or redeem until the claim is verified
  · a voucher code is four digits, changes every minute, and is single-use
  · region insight is aggregate-only and refuses a small cohort
"""

import uuid
from datetime import datetime, timedelta

import pytest

from app.config import settings
from app.database import async_session
from app.models.receipts import Receipt, ReceiptMerchant
from app.models.vendor import Vendor

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


def _pin() -> str:
    number = uuid.uuid4().int % 1_000_000_000
    return f"P{number:09d}{chr(65 + uuid.uuid4().int % 26)}"


def _invoice() -> str:
    return f"INV-{uuid.uuid4().hex[:10].upper()}"


def _qr(pin: str, invoice: str, total: int, issued_at: datetime | None = None, name: str = "Milimani Chemist") -> str:
    when = issued_at or (datetime.utcnow() - timedelta(minutes=5))
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
    })
    assert response.status_code == 201, response.text
    body = response.json()
    return (
        {"Authorization": f"Bearer {body['access_token']}"},
        body["vendor_id"],
        body["vendor_handle"],
    )


async def _submit(client, headers, payload: str, **extra):
    return await client.post("/api/receipts", json={"payload": payload, **extra}, headers=headers)


async def test_verified_qr_is_priced_by_the_server_and_deduped_across_accounts(client):
    pin, invoice = _pin(), _invoice()
    owner, _owner_id, _ = await _register(client, "rr_owner")
    other, _other_id, _ = await _register(client, "rr_other")

    response = await _submit(client, owner, _qr(pin, invoice, 1250), region="nyanza")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["receipt"]["status"] == "verified"
    assert body["receipt"]["points"] == 25
    assert body["receipt"]["freshness"] == "fresh"
    assert body["points_awarded"] == 25
    assert body["balance"]["available"] == 25

    ledger = await client.get("/api/receipts", headers=owner)
    assert ledger.status_code == 200, ledger.text
    data = ledger.json()
    assert data["summary"]["receipts"] == 1
    assert data["summary"]["merchants"] == 1
    assert data["merchants"][0]["pin"] == pin
    assert data["merchants"][0]["name"] == "Milimani Chemist"

    # The same paper cannot be a second reward on another account.
    duplicate = await _submit(client, other, _qr(pin, invoice, 1250))
    assert duplicate.status_code == 409
    assert "one receipt, one reward" in duplicate.text.lower()

    # ...or on the same one.
    assert (await _submit(client, owner, _qr(pin, invoice, 1250))).status_code == 409


async def test_freshness_falls_with_the_receipt_clock_not_the_client(client):
    headers, _vid, _ = await _register(client, "rr_time")

    hour_old = await _submit(
        client, headers, _qr(_pin(), _invoice(), 1250, datetime.utcnow() - timedelta(minutes=30)),
    )
    assert hour_old.status_code == 201, hour_old.text
    assert hour_old.json()["receipt"]["freshness"] == "hour"
    assert hour_old.json()["receipt"]["points"] == 18  # 25 * 0.7

    day_old = await _submit(
        client, headers, _qr(_pin(), _invoice(), 1250, datetime.utcnow() - timedelta(hours=12)),
    )
    assert day_old.status_code == 201, day_old.text
    assert day_old.json()["receipt"]["freshness"] == "day"
    assert day_old.json()["receipt"]["points"] == 10  # 25 * 0.4

    expired = await _submit(
        client, headers, _qr(_pin(), _invoice(), 1250, datetime.utcnow() - timedelta(days=8)),
    )
    assert expired.status_code == 201, expired.text
    assert expired.json()["receipt"]["freshness"] == "expired"
    assert expired.json()["receipt"]["points"] == 0


async def test_manual_receipt_is_recorded_but_earns_nothing(client):
    headers, _vid, _ = await _register(client, "rr_manual")
    response = await client.post("/api/receipts", json={
        "source": "manual", "merchant_name": "Kondele Kiosk", "total": 500,
        "region": "nyanza",
    }, headers=headers)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["receipt"]["status"] == "manual"
    assert body["receipt"]["points"] == 0
    assert body["balance"]["available"] == 0
    assert "typed receipt earns no points" in body["message"]


async def test_partial_digilink_earns_half_and_invented_codes_are_refused(client):
    headers, _vid, _ = await _register(client, "rr_partial")
    invoice = _invoice()
    response = await _submit(client, headers, f"https://etims.ke/r/42/{invoice}?TotalAmount=900")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["receipt"]["status"] == "partial"
    # 18 base * 0.5 for partial evidence * 0.5 because the link carries no date.
    assert body["receipt"]["points"] == 5

    assert (await _submit(client, headers, "not a receipt")).status_code == 422
    # An opaque KRA link with no total asks for the printed amount; without it,
    # nothing is stored and nothing is invented.
    assert (await _submit(client, headers, "https://etims.kra.go.ke/x?Data=P051234567XAB")).status_code == 422


async def test_merchant_claim_offer_voucher_and_single_use_redemption(client, monkeypatch):
    pin, invoice = _pin(), _invoice()
    owner, _owner_id, owner_handle = await _register(client, "rr_shop")
    operator, _op_id, operator_handle = await _register(client, "rr_ops")
    customer, _cust_id, _ = await _register(client, "rr_customer")
    monkeypatch.setattr(settings, "OPERATOR_HANDLES", operator_handle)

    # A scan creates the shop, unclaimed.
    assert (await _submit(client, owner, _qr(pin, invoice, 1250, name="Milimani Chemist"), region="nyanza")).status_code == 201
    card = await client.get(f"/api/receipts/merchants/{pin}")
    assert card.status_code == 200, card.text
    assert card.json()["claim_status"] == "unclaimed"

    claim = await client.post(f"/api/receipts/merchants/{pin}/claim", json={
        "name": "Milimani Chemist", "region": "nyanza", "phone": "0712000111",
        "note": "Owner, till at the counter",
    }, headers=owner)
    assert claim.status_code == 201, claim.text
    merchant_id = claim.json()["merchant"]["id"]
    assert claim.json()["merchant"]["claim_status"] == "pending"

    # A claim alone does not unlock publishing.
    blocked = await client.post("/api/receipts/offers", json={
        "title": "KES 50 off", "discount_kes": 50, "points_cost": 10,
    }, headers=owner)
    assert blocked.status_code == 403

    reviewed = await client.post(f"/api/receipts/ops/merchants/{merchant_id}/verify", json={
        "approve": True, "note": "Called the shop",
    }, headers=operator)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["merchant"]["claim_status"] == "verified"

    offer = await client.post("/api/receipts/offers", json={
        "title": "KES 50 off your next basket", "discount_kes": 50,
        "min_spend_kes": 500, "points_cost": 10,
    }, headers=owner)
    assert offer.status_code == 201, offer.text
    offer_id = offer.json()["id"]

    public = await client.get("/api/receipts/offers?region=nyanza")
    assert public.status_code == 200, public.text
    assert [row["id"] for row in public.json()["offers"]] == [offer_id]

    # The customer needs points of their own.
    assert (await _submit(client, customer, _qr(_pin(), _invoice(), 1250))).status_code == 201

    claimed = await client.post(f"/api/receipts/offers/{offer_id}/claim", headers=customer)
    assert claimed.status_code == 201, claimed.text
    voucher = claimed.json()["voucher"]
    assert voucher["status"] == "issued"
    assert len(voucher["code"]) == 4 and voucher["code"].isdigit()
    assert claimed.json()["balance"]["available"] == 15
    voucher_id = voucher["id"]
    code = voucher["code"]

    # One deal per person per day, even if they have the points.
    assert (await client.post(f"/api/receipts/offers/{offer_id}/claim", headers=customer)).status_code == 409

    # Only the verified shop can check a code.
    stranger = await _register(client, "rr_stranger")
    assert (await client.post("/api/receipts/merchant/redeem", json={"code": code}, headers=stranger[0])).status_code == 403

    redeemed = await client.post("/api/receipts/merchant/redeem", json={
        "code": code, "voucher_id": voucher_id,
    }, headers=owner)
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json()["voucher"]["status"] == "redeemed"
    assert redeemed.json()["voucher"]["code"] is None

    # Single use.
    again = await client.post("/api/receipts/merchant/redeem", json={
        "code": code, "voucher_id": voucher_id,
    }, headers=owner)
    assert again.status_code == 400

    wallet = await client.get("/api/receipts/vouchers", headers=customer)
    assert wallet.status_code == 200, wallet.text
    assert wallet.json()["vouchers"][0]["status"] == "redeemed"
    assert wallet.json()["balance"]["available"] == 15

    # A deal that costs more than the balance is refused before any voucher exists.
    expensive = await client.post("/api/receipts/offers", json={
        "title": "KES 500 off", "discount_kes": 500, "points_cost": 500,
    }, headers=owner)
    assert expensive.status_code == 201, expensive.text
    assert (await client.post(f"/api/receipts/offers/{expensive.json()['id']}/claim", headers=customer)).status_code == 402


async def test_region_insight_is_aggregate_only_and_cohort_gated(client):
    headers, vendor_id, _ = await _register(client, "rr_insight")
    vendor_uuid = uuid.UUID(vendor_id)
    now = datetime.utcnow()

    async with async_session() as db:
        merchants = [
            ReceiptMerchant(pin=_pin(), name=f"Rift Shop {index}", region="rift-valley",
                            claim_status="verified")
            for index in range(3)
        ]
        db.add_all(merchants)
        await db.flush()
        for index in range(21):
            total = (index + 1) * 100
            db.add(Receipt(
                vendor_id=vendor_uuid,
                merchant_id=merchants[index % 3].id,
                merchant_pin=merchants[index % 3].pin,
                merchant_name=merchants[index % 3].name,
                invoice_no=f"INS-{index}",
                total=total,
                issued_at=now - timedelta(minutes=10),
                scanned_at=now - timedelta(minutes=5),
                source="qr",
                status="verified",
                freshness_key="fresh",
                base_points=max(1, total // 50),
                points=max(1, total // 50),
                dedupe_key=f"INS:{index}",
                region="rift-valley",
            ))
        # A second region that cannot yet meet the floor.
        small = ReceiptMerchant(pin=_pin(), name="Tiny Coast Shop", region="coast",
                                claim_status="verified")
        db.add(small)
        await db.flush()
        for index in range(2):
            db.add(Receipt(
                vendor_id=vendor_uuid, merchant_id=small.id, merchant_pin=small.pin,
                merchant_name=small.name, invoice_no=f"COAST-{index}", total=300,
                issued_at=now - timedelta(minutes=10), scanned_at=now - timedelta(minutes=5),
                source="qr", status="verified", freshness_key="fresh",
                base_points=6, points=6, dedupe_key=f"COAST:{index}", region="coast",
            ))
        await db.commit()

    insight = await client.get("/api/receipts/insights?region=rift-valley", headers=headers)
    assert insight.status_code == 200, insight.text
    body = insight.json()
    assert body["available"] is True
    assert body["cohort"] == {"receipts": 21, "merchants": 3}
    assert body["basket"]["spend_kes"] == sum((index + 1) * 100 for index in range(21))
    assert body["basket"]["median_kes"] == 1100
    assert body["line_items"] is False
    assert len(body["top_merchants"]) == 3
    assert "vendor_id" not in insight.text and "invoice" not in insight.text

    small = await client.get("/api/receipts/insights?region=coast", headers=headers)
    assert small.status_code == 200, small.text
    assert small.json()["available"] is False
    assert small.json()["cohort"]["receipts"] == 2


async def test_receipt_becomes_a_two_sided_trade_and_moves_both_counters(client):
    buyer, buyer_id, _ = await _register(client, "tp_buyer")
    seller, seller_id, _ = await _register(client, "tp_seller")

    # The seller's registered name is the name printed on the receipt.
    async with async_session() as db:
        seller_row = await db.get(Vendor, uuid.UUID(seller_id))
        seller_name = seller_row.business_name
        await db.commit()

    response = await _submit(
        client, buyer, _qr(_pin(), _invoice(), 800, name=seller_name), region="nyanza",
    )
    assert response.status_code == 201, response.text

    buyer_view = await client.get("/api/receipts/trade-proofs", headers=buyer)
    assert buyer_view.status_code == 200, buyer_view.text
    body = buyer_view.json()
    assert body["summary"]["waiting_for_shop"] == 1
    proof = body["proofs"][0]
    assert proof["role"] == "buyer"
    assert proof["status"] == "pending"
    assert proof["can_confirm"] is False
    assert proof["seller"]["id"] == seller_id
    proof_id = proof["id"]

    seller_view = await client.get("/api/receipts/trade-proofs", headers=seller)
    assert seller_view.status_code == 200, seller_view.text
    incoming = seller_view.json()["proofs"][0]
    assert incoming["role"] == "seller"
    assert incoming["can_confirm"] is True
    assert incoming["buyer"]["id"] == buyer_id

    stranger, _stranger_id, _ = await _register(client, "tp_stranger")
    denied = await client.post(f"/api/receipts/trade-proofs/{proof_id}/confirm", headers=stranger)
    assert denied.status_code == 403

    confirmed = await client.post(f"/api/receipts/trade-proofs/{proof_id}/confirm", headers=seller)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["proof"]["status"] == "confirmed"
    assert confirmed.json()["confirmed_trade_proofs"] == {"mine": 1, "buyer": 1}

    again = await client.post(f"/api/receipts/trade-proofs/{proof_id}/confirm", headers=seller)
    assert again.status_code == 409

    async with async_session() as db:
        buyer_row = await db.get(Vendor, uuid.UUID(buyer_id))
        seller_row = await db.get(Vendor, uuid.UUID(seller_id))
        assert buyer_row.confirmed_trade_proofs == 1
        assert seller_row.confirmed_trade_proofs == 1

    # The publication of the count is what the rank ladder reads.
    profile = await client.get("/api/vendors/me", headers=buyer)
    assert profile.status_code == 200, profile.text
    assert profile.json()["confirmed_trade_proofs"] == 1


async def test_a_shop_can_dispute_and_an_unmatched_shop_does_not_invent_a_trade(client):
    buyer, _buyer_id, _ = await _register(client, "tp_dispute_buyer")
    seller, seller_id, _ = await _register(client, "tp_dispute_seller")

    async with async_session() as db:
        seller_name = (await db.get(Vendor, uuid.UUID(seller_id))).business_name
        await db.commit()

    assert (await _submit(
        client, buyer, _qr(_pin(), _invoice(), 600, name=seller_name),
    )).status_code == 201
    proof = (await client.get("/api/receipts/trade-proofs", headers=seller)).json()["proofs"][0]

    disputed = await client.post(
        f"/api/receipts/trade-proofs/{proof['id']}/dispute",
        json={"reason": "This receipt is from another shop with a similar name."},
        headers=seller,
    )
    assert disputed.status_code == 200, disputed.text
    assert disputed.json()["proof"]["status"] == "disputed"
    assert "another shop" in disputed.json()["proof"]["dispute_reason"]

    async with async_session() as db:
        assert (await db.get(Vendor, uuid.UUID(seller_id))).confirmed_trade_proofs == 0

    # A shop that is not on Home Office cannot be confirmed. The buyer sees a
    # real unmatched row, not a fabricated trade.
    assert (await _submit(
        client, buyer, _qr(_pin(), _invoice(), 300, name="A Shop Not On This Network"),
    )).status_code == 201
    unmatched = (await client.get("/api/receipts/trade-proofs?status=unmatched", headers=buyer)).json()
    assert len(unmatched["proofs"]) == 1
    assert unmatched["proofs"][0]["seller"] is None
    assert unmatched["proofs"][0]["status"] == "unmatched"


async def test_a_typed_receipt_never_creates_a_trade_proof(client):
    buyer, _buyer_id, _ = await _register(client, "tp_manual")
    response = await client.post("/api/receipts", json={
        "source": "manual", "merchant_name": "Some Shop", "total": 400,
    }, headers=buyer)
    assert response.status_code == 201, response.text
    assert (await client.get("/api/receipts/trade-proofs", headers=buyer)).json()["proofs"] == []

"""Town commerce contract: receipt funding, referral exchange and scout records.

The promises under test:

  · a receipt reward is funded from the shop's prepaid credit, never minted;
  · the 15-minute window is explicit and expired/altered/self receipts earn 0;
  · a credit purchase is pending until an operator confirms an external payment;
  · a referral conversion is pending until an operator verifies the action;
  · an owner cannot verify their own referral or earn on their own listing;
  · a scout payment is a reported signal until the merchant acknowledges it;
  · fee percentages are read from runtime settings, not hardcoded.

Nothing here moves money. The tests check the record, not a wallet.
"""

import uuid
from datetime import datetime, timedelta

import pytest

from app.config import settings
from app.database import async_session
from app.models.receipts import ReceiptMerchant
from app.models.vendor import Vendor
from app.modules.town.models import (
    MerchantCreditAccount, MerchantCreditEntry, MerchantRewardPolicy,
)
from tests.test_smoke import _auth, _register
from tests.test_wfh_tasks import _make_level_two, _task_body

pytestmark = pytest.mark.asyncio


def _pin() -> str:
    number = uuid.uuid4().int % 1_000_000_000
    return f"P{number:09d}{chr(65 + uuid.uuid4().int % 26)}"


def _invoice() -> str:
    return f"INV-{uuid.uuid4().hex[:10].upper()}"


async def _shop(owner_id: str, *, available: int = 1000, name: str = "Kisumu Chemist"):
    async with async_session() as db:
        shop = ReceiptMerchant(
            pin=_pin(), name=name, region="nyanza", claim_status="verified",
            claimed_by_vendor_id=uuid.UUID(owner_id), verified_at=datetime.utcnow(),
        )
        db.add(shop)
        await db.flush()
        db.add(MerchantCreditAccount(
            merchant_id=shop.id, purchased_kes=available, available_kes=available,
            spent_kes=0, expired_kes=0, outstanding_kes=0,
            expires_at=datetime.utcnow() + timedelta(days=365),
        ))
        if available:
            db.add(MerchantCreditEntry(
                merchant_id=shop.id, entry_type="purchase", amount_kes=available,
                idempotency_key=f"seed:{shop.id}", note="test seed",
            ))
        await db.commit()
        await db.refresh(shop)
        return shop


def _capture(shop, *, total: int = 1000, minutes_ago: int = 5, invoice: str | None = None):
    return {
        "source": "photo",
        "merchant_name": shop.name,
        "merchant_pin": shop.pin,
        "invoice_no": invoice or _invoice(),
        "total_kes": total,
        "issued_at": (datetime.utcnow() - timedelta(minutes=minutes_ago)).isoformat(),
        "region": "nyanza",
        "ocr_engine": "text",
        "photo_consent": False,
        "items": [
            {"description": "Paracetamol 500mg", "quantity": 2,
             "unit_price_kes": 250, "total_price_kes": 500, "confidence": 88},
            {"description": "Cough syrup", "quantity": 1,
             "unit_price_kes": 500, "total_price_kes": 500, "confidence": 84},
        ],
    }


async def test_receipt_priority_reward_is_funded_and_duplicate_is_refused(client):
    owner, customer = [await _register(client, name, ["receipts"]) for name in ("town_owner", "town_customer")]
    oh, ch = _auth(owner["access_token"]), _auth(customer["access_token"])
    shop = await _shop(owner["vendor_id"], available=1000)
    invoice = _invoice()

    first = await client.post("/api/town/receipts/capture", headers=ch,
                              json=_capture(shop, total=1000, invoice=invoice))
    assert first.status_code == 201, first.text
    payload = first.json()
    assert payload["priority"] is True
    assert payload["points_awarded"] > 0
    # 2 points per KES 100 at full freshness = 20 points, all funded by the shop.
    assert payload["calculated_points"] == 20
    assert payload["funded_points"] == payload["points_awarded"] == 20
    assert payload["receipt"]["funded_kes"] == 20
    assert len(payload["receipt"]["items"]) == 2
    assert "priority_15_min" in payload["fraud_flags"]

    async with async_session() as db:
        account = (await db.execute(
            __import__("sqlalchemy").select(MerchantCreditAccount).where(
                MerchantCreditAccount.merchant_id == shop.id
            )
        )).scalar_one()
        assert account.available_kes == 980
        assert account.outstanding_kes == 20
        assert account.spent_kes == 20
        assert account.purchased_kes == 1000

    duplicate = await client.post("/api/town/receipts/capture", headers=ch,
                                  json=_capture(shop, total=1000, invoice=invoice))
    assert duplicate.status_code == 409
    assert "one reward" in duplicate.json()["detail"].lower()

    expired = await client.post("/api/town/receipts/capture", headers=ch,
                                json=_capture(shop, total=900, minutes_ago=60 * 24 * 8))
    assert expired.status_code == 201, expired.text
    assert expired.json()["points_awarded"] == 0
    assert "expired" in expired.json()["fraud_flags"]

    # Pasted text is its own source: it can earn, and it is labelled as text.
    text_body = _capture(shop, total=1000)
    text_body["source"] = "text"
    text_body["ocr_engine"] = "text"
    text = await client.post("/api/town/receipts/capture", headers=ch, json=text_body)
    assert text.status_code == 201, text.text
    assert text.json()["receipt"]["source"] == "text"
    assert "ocr_text" in text.json()["fraud_flags"]
    assert text.json()["points_awarded"] > 0

    # VAT is normal: items exclusive of tax still add up to the tax-inclusive total.
    vat_body = _capture(shop, total=1160)
    vat_body["tax_kes"] = 160
    vat_body["items"] = [
        {"description": "Paracetamol 500mg", "quantity": 2,
         "unit_price_kes": 250, "total_price_kes": 500, "confidence": 88},
        {"description": "Cough syrup", "quantity": 1,
         "unit_price_kes": 500, "total_price_kes": 500, "confidence": 84},
    ]
    vat = await client.post("/api/town/receipts/capture", headers=ch, json=vat_body)
    assert vat.status_code == 201, vat.text
    assert "item_total_mismatch" not in vat.json()["fraud_flags"]
    assert vat.json()["points_awarded"] > 0

    # Items that cannot possibly sum to the total are refused, not just flagged.
    impossible_body = _capture(shop, total=900)
    impossible_body["items"] = [{
        "description": "One sachet", "quantity": 1,
        "unit_price_kes": 100, "total_price_kes": 100, "confidence": 90,
    }]
    impossible = await client.post("/api/town/receipts/capture", headers=ch, json=impossible_body)
    assert impossible.status_code == 201, impossible.text
    assert "item_total_mismatch" in impossible.json()["fraud_flags"]
    assert impossible.json()["points_awarded"] == 0

    # A shopkeeper cannot farm their own counter.
    self_dealt = await client.post("/api/town/receipts/capture", headers=oh,
                                   json=_capture(shop, total=800))
    assert self_dealt.status_code == 201, self_dealt.text
    assert self_dealt.json()["points_awarded"] == 0
    assert "self_receipt" in self_dealt.json()["fraud_flags"]


async def test_credit_purchase_needs_operator_confirmation_and_dashboard_tracks_obligations(client, monkeypatch):
    owner, operator = [await _register(client, name, ["receipts"]) for name in ("credit_owner", "credit_ops")]
    oh, op_h = _auth(owner["access_token"]), _auth(operator["access_token"])
    monkeypatch.setattr(settings, "OPERATOR_HANDLES", operator["vendor_handle"])
    shop = await _shop(owner["vendor_id"], available=0)

    requested = await client.post(
        f"/api/town/merchant/{shop.id}/credits/purchase", headers=oh,
        json={"amount_kes": 1500, "payment_reference": "QK12ABCDEF",
              "idempotency_key": "purchase-001"},
    )
    assert requested.status_code == 201, requested.text
    purchase = requested.json()["purchase"]
    assert purchase["status"] == "pending"
    assert requested.json()["credits"]["available_kes"] == 0

    # Replaying the same key returns the same pending row, not a second purchase.
    replay = await client.post(
        f"/api/town/merchant/{shop.id}/credits/purchase", headers=oh,
        json={"amount_kes": 1500, "payment_reference": "QK12ABCDEF",
              "idempotency_key": "purchase-001"},
    )
    assert replay.json()["purchase"]["id"] == purchase["id"]

    confirmed = await client.post(
        f"/api/ops/commerce/credits/purchases/{purchase['id']}/review", headers=op_h,
        json={"approve": True, "note": "M-Pesa statement matched"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["credited"] is True

    dashboard = await client.get(f"/api/town/merchant/{shop.id}/dashboard", headers=oh)
    assert dashboard.status_code == 200, dashboard.text
    body = dashboard.json()
    assert body["credits"]["purchased_kes"] == 1500
    assert body["credits"]["available_kes"] == 1500
    assert body["credits"]["outstanding_kes"] == 0
    assert body["analytics"]["premium"] is False
    assert "obligation" in body["obligations_note"].lower()

    # A non-operator cannot confirm the next purchase.
    monkeypatch.setattr(settings, "OPERATOR_HANDLES", "somebody_else")
    second = await client.post(
        f"/api/town/merchant/{shop.id}/credits/purchase", headers=oh,
        json={"amount_kes": 500, "payment_reference": "QK99ZZZ",
              "idempotency_key": "purchase-002"},
    )
    denied = await client.post(
        f"/api/ops/commerce/credits/purchases/{second.json()['purchase']['id']}/review",
        headers=oh, json={"approve": True},
    )
    assert denied.status_code == 403


async def test_referral_exchange_owner_cannot_verify_and_public_share_is_labelled(client, monkeypatch):
    owner, actor, operator = [
        await _register(client, name, ["receipts"])
        for name in ("ref_owner", "ref_actor", "ref_ops")
    ]
    oh, ah, op_h = (_auth(x["access_token"]) for x in (owner, actor, operator))
    monkeypatch.setattr(settings, "OPERATOR_HANDLES", operator["vendor_handle"])
    await _make_level_two(actor["vendor_id"])
    await _make_level_two(owner["vendor_id"])

    created = await client.post("/api/town/referral-index/listings", headers=oh, json={
        "provider": "Uber",
        "category": "ride_hailing",
        "title": "Uber driver sign-up, Kisumu",
        "description": "New driver accounts only.",
        "referral_code": "UBER-KSM-9",
        "bounty_kes": 200,
        "budget_kes": 1000,
        "bounty_points": 50,
        "offer_terms": "The driver must complete the provider's onboarding.",
        "verification_method": "transaction_ref",
        "trust_level_required": 1,
    })
    assert created.status_code == 201, created.text
    listing = created.json()["listing"]
    assert listing["verification_status"] == "unverified"
    lid = listing["id"]

    # Betting has advertising and age-gate obligations; it is off by default.
    betting = await client.post("/api/town/referral-index/listings", headers=oh, json={
        "provider": "Betika", "category": "betting",
        "title": "Betika sign-up, Kisumu", "referral_code": "BET-KSM",
        "bounty_kes": 100, "budget_kes": 1000,
    })
    assert betting.status_code == 422
    public_index = await client.get("/api/town/referral-index/public/listings")
    assert "betting" not in public_index.json()["categories"]

    # An owner cannot refer themselves or share their own bounty.
    self_claim = await client.post(f"/api/town/referral-index/listings/{lid}/claim", headers=oh,
                                   json={"proof_type": "transaction_ref", "proof_reference": "TX-1234"})
    assert self_claim.status_code == 403
    self_share = await client.post(f"/api/town/referral-index/listings/{lid}/share", headers=oh)
    assert self_share.status_code == 403

    share = await client.post(f"/api/town/referral-index/listings/{lid}/share", headers=ah)
    assert share.status_code == 200, share.text
    code = share.json()["share"]["code"]

    public = await client.get(f"/api/town/referral-index/public/go/{code}")
    assert public.status_code == 200, public.text
    assert public.json()["listing"]["provider"] == "Uber"
    assert "bounty if your action is independently verified" in public.json()["disclosure"]

    # The referrer cannot claim their own link; a different person must act.
    own_link = await client.post(f"/api/town/referral-index/listings/{lid}/claim", headers=ah, json={
        "proof_type": "transaction_ref", "proof_reference": "UBER-ACCT-0091",
        "share_code": code,
    })
    assert own_link.status_code == 403

    referred = await _register(client, "ref_referred", ["receipts"])
    await _make_level_two(referred["vendor_id"])
    rh = _auth(referred["access_token"])
    claimed = await client.post(f"/api/town/referral-index/listings/{lid}/claim", headers=rh, json={
        "proof_type": "transaction_ref", "proof_reference": "UBER-ACCT-0091",
        "share_code": code, "click_token": public.json()["click_token"],
        "code_used": "UBER-KSM-9",
    })
    assert claimed.status_code == 201, claimed.text
    conversion = claimed.json()["conversion"]
    assert conversion["status"] == "pending"
    assert conversion["bounty_status"] == "not_due"

    # The listing owner has an incentive; approval is reserved for an operator.
    owner_verify = await client.post(
        f"/api/town/referral-index/conversions/{conversion['id']}/verify",
        headers=oh, json={"approve": True, "note": "Looks fine"},
    )
    assert owner_verify.status_code == 403
    assert "operator" in owner_verify.json()["detail"].lower()

    verified = await client.post(
        f"/api/ops/commerce/conversions/{conversion['id']}/verify",
        headers=op_h, json={"approve": True, "note": "Provider reference matched"},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["conversion"]["status"] == "verified"
    assert verified.json()["conversion"]["bounty_status"] == "due"

    paid = await client.post(
        f"/api/town/referral-index/conversions/{conversion['id']}/paid",
        headers=oh, json={"note": "M-Pesa QK77PAID to the referrer"},
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["conversion"]["bounty_status"] == "paid"

    # A screenshot alone is not verification, even for an operator's queue.
    second_actor = await _register(client, "ref_actor2", ["receipts"])
    await _make_level_two(second_actor["vendor_id"])
    a2h = _auth(second_actor["access_token"])
    screenshot = await client.post(f"/api/town/referral-index/listings/{lid}/claim", headers=a2h, json={
        "proof_type": "screenshot", "proof_reference": "IMG-1",
        "proof_payload": {"screenshot_url": "https://example.com/proof.png"},
    })
    assert screenshot.status_code == 201, screenshot.text


async def test_scout_rating_and_payment_are_signals_not_payouts(client):
    poster, scout = [await _register(client, name, ["produce"]) for name in ("scout_merchant", "scout_worker")]
    ph, sh = _auth(poster["access_token"]), _auth(scout["access_token"])
    await _make_level_two(scout["vendor_id"])
    await _make_level_two(poster["vendor_id"])

    created = await client.post("/api/tasks", headers=ph, json=_task_body(
        task_type="CUSTOMER_ACQUISITION",
        title="Bring five new customers to the shop",
    ))
    assert created.status_code == 201, created.text
    task = created.json()
    assert task["task_type"] == "CUSTOMER_ACQUISITION"
    assert task["fee_pct"] == 8.0
    tid = task["id"]

    assert (await client.post(f"/api/tasks/{tid}/claim", headers=sh)).status_code == 200
    assert (await client.post(f"/api/tasks/{tid}/proof", headers=sh, json={
        "note": "Five customers signed up at the counter.",
        "payout_tag": {"method": "SEND_MONEY", "number": "0712345678", "name": "Scout"},
    })).status_code == 200
    approved = await client.post(f"/api/tasks/{tid}/approve", headers=ph)
    assert approved.status_code == 200, approved.text

    rated = await client.post(f"/api/town/scout/tasks/{tid}/rating", headers=ph,
                              json={"rating": 5, "note": "Fast and polite."})
    assert rated.status_code == 201, rated.text
    assert rated.json()["rating"]["rating"] == 5
    assert (await client.post(f"/api/town/scout/tasks/{tid}/rating", headers=ph,
                              json={"rating": 4})).status_code == 409

    reported = await client.post(
        f"/api/town/scout/tasks/{tid}/payment-confirmation", headers=sh,
        json={"amount_kes": 250, "payment_reference": "QK55SCOUT", "note": "Received"},
    )
    assert reported.status_code == 201, reported.text
    assert reported.json()["payment_confirmation"]["status"] == "reported"
    assert "unverified" in reported.json()["payment_confirmation"]["note"].lower()

    acknowledged = await client.post(
        f"/api/town/scout/tasks/{tid}/payment-confirmation/ack", headers=ph,
    )
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json()["payment_confirmation"]["status"] == "confirmed"

    profile = await client.get("/api/town/scout/profile", headers=sh)
    assert profile.status_code == 200, profile.text
    assert profile.json()["completed_tasks"] >= 1
    assert profile.json()["rating_avg"] == 5.0
    assert "never holds" in profile.json()["settlement"]

    fees = await client.get("/api/town/scout/fees", headers=sh)
    types = {row["task_type"] for row in fees.json()["fees"]}
    assert {"QR_DISTRIBUTION", "CUSTOMER_ACQUISITION"} <= types

    # A completed task keeps its completion; a payment problem is a dispute row.
    disputed = await client.post(f"/api/town/scout/tasks/{tid}/dispute", headers=sh, json={
        "reason": "The merchant has not sent the agreed payout to my number.",
    })
    assert disputed.status_code == 201, disputed.text
    detail = await client.get(f"/api/town/scout/tasks/{tid}", headers=sh)
    assert detail.status_code == 200, detail.text
    assert detail.json()["status"] == "COMPLETED"


async def test_runtime_percentage_changes_lead_fee(client, monkeypatch):
    owner, actor, operator = [
        await _register(client, name, ["receipts"])
        for name in ("rate_owner", "rate_actor", "rate_ops")
    ]
    oh, ah, op_h = (_auth(x["access_token"]) for x in (owner, actor, operator))
    monkeypatch.setattr(settings, "OPERATOR_HANDLES", operator["vendor_handle"])
    monkeypatch.setattr(settings, "FREE_FOR_NOW", False)
    monkeypatch.setattr(settings, "FEES_ENABLED", True)
    await _make_level_two(actor["vendor_id"])

    changed = await client.patch("/api/ops/commerce/settings", headers=op_h,
                                 json={"lead_fee_pct": 7.5, "note": "Pilot rate"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["settings"]["referral_lead_fee"]["pct"] == 7.5

    listing = (await client.post("/api/town/referral-index/listings", headers=oh, json={
        "provider": "Ena Coach",
        "category": "transport",
        "title": "Ena Coach referral, Kisii route",
        "referral_code": "ENA-KISII",
        "bounty_kes": 400,
        "budget_kes": 4000,
        "verification_method": "transaction_ref",
    })).json()["listing"]
    claim = await client.post(f"/api/town/referral-index/listings/{listing['id']}/claim", headers=ah,
                              json={"proof_type": "transaction_ref", "proof_reference": "ENA-TX-9001"})
    assert claim.status_code == 201, claim.text
    cid = claim.json()["conversion"]["id"]
    assert (await client.post(f"/api/ops/commerce/conversions/{cid}/verify", headers=op_h,
                              json={"approve": True, "note": "Ticket matched"})).status_code == 200

    async with async_session() as db:
        from app.modules.town.models import PlatformFeeEntry
        from sqlalchemy import select

        row = (await db.execute(
            select(PlatformFeeEntry).where(PlatformFeeEntry.source_type == "referral_conversion")
        )).scalars().all()
    assert row, "expected a lead fee entry"
    entry = row[-1]
    assert float(entry.fee_pct) == 7.5
    assert int(entry.fee_kes) == 30  # 7.5% of KES 400


async def test_ocr_text_extracts_items_and_warns_on_mismatch(client):
    user = await _register(client, "ocr_reader", ["receipts"])
    h = _auth(user["access_token"])
    text = """KISUMU CHEMIS COMMUNITY PHARMACY
P051234567X
INV-778812
DATE 17/11/2026 10:12
Paracetamol 500mg 2 x 250.00 500.00
Cough syrup 1 x 500.00 500.00
SUBTOTAL 1000.00
VAT 16.00
TOTAL 1300.00
CASH 1300.00
CHANGE 0.00"""
    response = await client.post("/api/town/receipts/ocr/text", headers=h,
                                 json={"text": text, "consent": False})
    assert response.status_code == 200, response.text
    draft = response.json()["draft"]
    assert draft["total_kes"] == 1300
    assert draft["merchant_pin"] == "P051234567X"
    assert draft["invoice_no"] == "INV-778812"
    assert len(draft["items"]) == 2
    assert draft["items"][0]["quantity"] == 2
    assert draft["items_total_kes"] == 1000
    assert any("do not add up" in warning for warning in draft["warnings"])


async def test_sponsored_placement_records_the_bid_as_revenue(client, monkeypatch):
    """A sponsored slot is bought, not a percentage of a sale.

    The winning bid is platform revenue; the listing's verification is separate
    and cannot be bought. While fees are off, the slot is still labelled but no
    revenue is recognised.
    """
    owner = await _register(client, "sponsor_owner", ["receipts"])
    oh = _auth(owner["access_token"])
    monkeypatch.setattr(settings, "FREE_FOR_NOW", False)
    monkeypatch.setattr(settings, "FEES_ENABLED", True)

    async def _listing(title: str):
        response = await client.post("/api/town/referral-index/listings", headers=oh, json={
            "provider": "Uber", "category": "ride_hailing", "title": title,
            "referral_code": "UBER-SPONSOR", "bounty_kes": 1000, "budget_kes": 5000,
            "verification_method": "transaction_ref",
        })
        assert response.status_code == 201, response.text
        return response.json()["listing"]

    first = await _listing("Uber driver sign-up, sponsored")
    placed = await client.post(
        f"/api/town/referral-index/listings/{first['id']}/sponsor", headers=oh,
        json={"bid_kes": 300, "days": 14, "payment_reference": "QK-SPONSOR-1"},
    )
    assert placed.status_code == 200, placed.text
    assert placed.json()["listing"]["sponsored"] is True

    from sqlalchemy import select
    from app.modules.town.models import PlatformFeeEntry

    async with async_session() as db:
        rows = (await db.execute(select(PlatformFeeEntry).where(
            PlatformFeeEntry.source_type == "sponsorship"
        ))).scalars().all()
    entry = [row for row in rows if str(row.source_id) == first["id"]]
    assert len(entry) == 1
    assert float(entry[0].fee_pct) == 100.0
    assert int(entry[0].fee_kes) == 300

    # FREE_FOR_NOW suppresses collection but never the label.
    monkeypatch.setattr(settings, "FREE_FOR_NOW", True)
    second = await _listing("Uber driver sign-up, free period")
    free = await client.post(
        f"/api/town/referral-index/listings/{second['id']}/sponsor", headers=oh,
        json={"bid_kes": 300, "days": 14, "payment_reference": "QK-SPONSOR-2"},
    )
    assert free.status_code == 200, free.text
    async with async_session() as db:
        rows = (await db.execute(select(PlatformFeeEntry).where(
            PlatformFeeEntry.source_type == "sponsorship"
        ))).scalars().all()
    assert not [row for row in rows if str(row.source_id) == second["id"]]


async def test_scout_fee_percentage_is_runtime_configurable(client, monkeypatch):
    """Scout fees are percentages too; changing one changes the next task only."""
    poster, operator = [await _register(client, name, ["produce"]) for name in ("fee_poster", "fee_ops")]
    ph, op_h = _auth(poster["access_token"]), _auth(operator["access_token"])
    monkeypatch.setattr(settings, "OPERATOR_HANDLES", operator["vendor_handle"])

    changed = await client.patch("/api/ops/commerce/settings", headers=op_h,
                                 json={"scout_fee_customer_acquisition_pct": 9.5,
                                       "note": "Pilot scout rate"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["settings"]["scout_fee_customer_acquisition"]["pct"] == 9.5

    created = await client.post("/api/tasks", headers=ph, json=_task_body(
        task_type="CUSTOMER_ACQUISITION",
        title="Bring five new customers after the rate change",
    ))
    assert created.status_code == 201, created.text
    assert created.json()["fee_pct"] == 9.5
    assert created.json()["platform_fee_kes"] == 23.75  # 9.5% of KES 250

    catalogue = await client.get("/api/town/scout/fees", headers=ph)
    row = next(r for r in catalogue.json()["fees"] if r["task_type"] == "CUSTOMER_ACQUISITION")
    assert row["fee_pct"] == 9.5

"""Pillar 3 — social seller trust signals.

Three boundaries are under test:
  * a bio check records what a fetch saw, never a verification badge;
  * a stock-in-hand photo only publishes against today's server code, for 48h;
  * the warning banner needs two unrelated Level 2+ buyers with a real trade —
    and a seller resolution clears it.
"""

import io
import uuid
from datetime import datetime, timedelta

import pytest
from PIL import Image
from sqlalchemy import select

from app.database import async_session
from app.models.receipts import Receipt, ReceiptMerchant, TradeProof
from app.models.vendor import Vendor
from app.modules.social_trust import service as trust_service
from tests.test_smoke import _auth, _register

pytestmark = pytest.mark.asyncio


async def _level_two(vendor_id: str):
    async with async_session() as db:
        person = await db.get(Vendor, uuid.UUID(vendor_id))
        person.phone_verified_at = datetime.utcnow()
        await db.commit()


async def _trade(db, buyer_id: str, seller_id: str):
    merchant = ReceiptMerchant(pin="P" + uuid.uuid4().hex[:9].upper(), name="Sample shop")
    db.add(merchant)
    await db.flush()
    receipt = Receipt(
        vendor_id=uuid.UUID(buyer_id), merchant_id=merchant.id, merchant_name="Sample shop",
        total=1200, issued_at=datetime.utcnow(), source="qr", status="verified",
        freshness_key="test", dedupe_key=uuid.uuid4().hex,
    )
    db.add(receipt)
    await db.flush()
    proof = TradeProof(
        receipt_id=receipt.id, buyer_vendor_id=uuid.UUID(buyer_id),
        seller_vendor_id=uuid.UUID(seller_id), merchant_name="Sample shop",
        amount=1200, status="confirmed", confirmed_at=datetime.utcnow(),
    )
    db.add(proof)
    await db.commit()
    return proof.id


async def _upload(client, headers):
    picture = io.BytesIO()
    Image.new("RGB", (40, 40), "green").save(picture, "JPEG")
    response = await client.post("/api/files/upload", headers=headers,
                                 files={"file": ("stock.jpg", picture.getvalue(), "image/jpeg")})
    assert response.status_code == 201, response.text
    return response.json()["url"]


async def test_bio_link_check_is_recorded_as_a_signal(client, monkeypatch):
    seller = await _register(client, "bio_seller", ["fashion"])
    h = _auth(seller["access_token"])
    handle = seller["vendor_handle"]

    saved = await client.put("/api/social-trust/links", headers=h, json={"links": [{
        "platform": "tiktok", "handle": f"@{handle}",
        "profile_url": f"https://www.tiktok.com/@{handle}",
    }]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["social_links"][0]["bio_verified"] is False

    async def matched(url):
        return 200, f"<html><head><meta name='description' content='/p/{handle}'></head></html>"

    monkeypatch.setattr(trust_service, "_fetch_public_bio", matched)
    verified = await client.post("/api/social-trust/verify-bio", headers=h,
                                 json={"platform": "tiktok"})
    assert verified.status_code == 200, verified.text
    body = verified.json()
    assert body["bio_verified"] is True and body["matched"] is True
    assert "awards no standing credit" in body["signal_note"]

    async def missing(url):
        return 200, "<html><body>Nothing here</body></html>"

    monkeypatch.setattr(trust_service, "_fetch_public_bio", missing)
    failed = await client.post("/api/social-trust/verify-bio", headers=h,
                               json={"platform": "tiktok"})
    assert failed.status_code == 200
    assert failed.json()["bio_verified"] is False
    assert failed.json()["failure_reason"] == "LINK_NOT_IN_BIO"

    # History is kept: the earlier success is not rewritten.
    async with async_session() as db:
        from app.modules.social_trust.models import SocialBioCheck

        rows = (await db.execute(select(SocialBioCheck).order_by(SocialBioCheck.checked_at))).scalars().all()
        assert [row.matched for row in rows] == [True, False]

    # A lookalike host is refused before any fetch.
    rejected = await client.put("/api/social-trust/links", headers=h, json={"links": [{
        "platform": "tiktok", "handle": "x",
        "profile_url": "https://tiktok.com.evil.example/@x",
    }]})
    assert rejected.status_code == 422


async def test_stock_in_hand_requires_todays_code_and_expires(client):
    seller = await _register(client, "stock_seller", ["fashion"])
    h = _auth(seller["access_token"])
    first = await client.get("/api/social-trust/challenge", headers=h)
    second = await client.get("/api/social-trust/challenge", headers=h)
    assert first.status_code == 200
    code = first.json()["challenge_code"]
    assert code == second.json()["challenge_code"]
    assert code.count("-") == 1 and len(code.split("-")[1]) == 2
    assert "48 hours" in first.json()["validity"]

    image = await _upload(client, h)
    wrong = await client.post("/api/social-trust/stock-proof", headers=h, json={
        "challenge_code": "ZZZ-00", "item_title": "Nike Air Max 90",
        "price_kes": 4500, "image_url": image,
    })
    assert wrong.status_code == 422
    assert "not today's" in wrong.json()["detail"]

    published = await client.post("/api/social-trust/stock-proof", headers=h, json={
        "challenge_code": code.lower(), "item_title": "Nike Air Max 90",
        "price_kes": 4500, "image_url": image,
    })
    assert published.status_code == 201, published.text
    proof = published.json()
    assert proof["status"] == "ACTIVE" and proof["is_valid"] is True
    assert proof["label"] == f"Stock-in-Hand Photo • Code {code} (Valid 48h)"
    expires = datetime.fromisoformat(proof["expires_at"].replace("Z", "+00:00"))
    assert timedelta(hours=47) < expires - datetime.now(expires.tzinfo) <= timedelta(hours=48)

    # Publishing again retires the previous photo rather than stacking them.
    replacement = await client.post("/api/social-trust/stock-proof", headers=h, json={
        "challenge_code": code, "item_title": "Nike Air Max 95", "image_url": image,
    })
    assert replacement.status_code == 201
    state = await client.get("/api/social-trust/me", headers=h)
    assert state.json()["stock_proof"]["item_title"] == "Nike Air Max 95"

    card = await client.get(f"/api/social-trust/public/{seller['vendor_handle']}")
    assert card.status_code == 200
    data = card.json()
    assert data["stock_proof"]["item_title"] == "Nike Air Max 95"
    assert "Valid 48h" in data["stock_proof"]["label"]
    assert "awards no standing credit" in data["stock_proof"]["signal_note"]
    assert data["trust_reply"].endswith(f"/p/{seller['vendor_handle']}")


async def test_two_unrelated_buyers_raise_the_banner_and_resolution_clears_it(client):
    seller = await _register(client, "warn_seller", ["electronics"])
    first = await _register(client, "warn_buyer_one", ["electronics"])
    second = await _register(client, "warn_buyer_two", ["electronics"])
    stranger = await _register(client, "warn_stranger", ["electronics"])
    h, b1, b2, sh = (_auth(x["access_token"])
                     for x in (seller, first, second, stranger))
    for person in (first, second, stranger):
        await _level_two(person["vendor_id"])

    async with async_session() as db:
        await _trade(db, first["vendor_id"], seller["vendor_id"])
        await _trade(db, second["vendor_id"], seller["vendor_id"])

    # A stranger with no trade cannot raise the banner.
    no_trade = await client.post("/api/social-trust/delivery-reports", headers=sh, json={
        "seller_handle": seller["vendor_handle"], "note": "Nothing arrived at all.",
    })
    assert no_trade.status_code == 403
    assert "trade you actually made" in no_trade.json()["detail"]

    one = await client.post("/api/social-trust/delivery-reports", headers=b1, json={
        "seller_handle": seller["vendor_handle"],
        "note": "Paid in full, the parcel never arrived.",
    })
    assert one.status_code == 201, one.text
    assert "not a finding" in one.json()["message"] or "report" in one.json()["message"].lower()

    duplicate = await client.post("/api/social-trust/delivery-reports", headers=b1, json={
        "seller_handle": seller["vendor_handle"], "note": "Still not here after a week.",
    })
    assert duplicate.status_code == 409

    # One report is not a banner.
    card = await client.get(f"/api/social-trust/public/{seller['vendor_handle']}")
    assert card.json()["dispute"]["warning"] is False
    assert card.json()["dispute"]["open_reports"] == 1

    two = await client.post("/api/social-trust/delivery-reports", headers=b2, json={
        "seller_handle": seller["vendor_handle"],
        "note": "Two weeks late and no reply to messages.",
    })
    assert two.status_code == 201, two.text

    card = await client.get(f"/api/social-trust/public/{seller['vendor_handle']}")
    dispute = card.json()["dispute"]
    assert dispute["warning"] is True
    assert dispute["warning_text"] == "⚠ 2 Unresolved Delivery Reports — Inspect Before Paying"

    # The warning is on the public page a crawler reads, and on the OG title.
    page = await client.get(f"/p/{seller['vendor_handle']}")
    assert page.status_code == 200
    assert "Unresolved Delivery Reports" in page.text
    assert "home-office-safety" in page.text

    # The seller can close one report; the banner then disappears.
    seller_queue = await client.get("/api/social-trust/delivery-reports", headers=h)
    report_id = seller_queue.json()["reports"][0]["id"]
    forbidden = await client.post(
        f"/api/social-trust/delivery-reports/{report_id}/resolve", headers=b1,
        json={"note": "Trying to close my own report."})
    assert forbidden.status_code == 404
    resolved = await client.post(
        f"/api/social-trust/delivery-reports/{report_id}/resolve", headers=h,
        json={"note": "Refunded in full over M-Pesa and confirmed with the buyer."})
    assert resolved.status_code == 200, resolved.text
    card = await client.get(f"/api/social-trust/public/{seller['vendor_handle']}")
    assert card.json()["dispute"]["warning"] is False


async def test_report_requires_level_two_and_an_honest_card(client):
    seller = await _register(client, "honest_seller", ["food"])
    buyer = await _register(client, "honest_buyer", ["food"])
    async with async_session() as db:
        await _trade(db, buyer["vendor_id"], seller["vendor_id"])

    blocked = await client.post("/api/social-trust/delivery-reports",
                                headers=_auth(buyer["access_token"]), json={
        "seller_handle": seller["vendor_handle"],
        "note": "Never delivered the order I paid for.",
    })
    assert blocked.status_code == 403
    assert "Level 2+" in blocked.json()["detail"]

    card = await client.get(f"/api/social-trust/public/{seller['vendor_handle']}")
    body = card.json()
    # The confirmed trade the report is anchored to is a real completed delivery.
    assert body["verified_deliveries"] == 1
    assert body["dispute"]["ratio_label"] == "0 unresolved"
    assert body["signals_note"].startswith("A signal")
    assert "not a guarantee" in body["delivery_note"]
    assert body["bio_links"] == []

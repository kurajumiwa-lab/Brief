"""0069 — the Live Corridor Price Index.

The index is allowed to say nothing. These tests protect that: five independent
confirmed points make a range, four make silence, a colluding pair never counts,
and the badge is tied to the corridor median rather than to a platform opinion.
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.database import async_session
from app.models.events import Event, EventRegistration
from app.models.receipts import Receipt, ReceiptMerchant, TradeProof
from app.models.vendor import Vendor
from app.modules.ledger.models import ActivityBooking, LocalActivity
from app.modules.price_index import service
from app.modules.price_index.models import CorridorPriceIndex

pytestmark = pytest.mark.asyncio


def _unique(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


async def _vendor(db, prefix: str, location: str) -> Vendor:
    handle = _unique(prefix)
    person = Vendor(
        business_name=handle.replace("_", " ").title(),
        vendor_handle=handle,
        email=f"{handle}@price.test",
        password_hash="not-used-in-tests",
        physical_location=location,
    )
    db.add(person)
    await db.flush()
    return person


async def _trade(db, buyer: Vendor, seller: Vendor, amount: int, when: datetime,
                 merchant_name: str, status: str = "confirmed") -> TradeProof:
    merchant = ReceiptMerchant(pin="P" + uuid.uuid4().hex[:9].upper(), name=merchant_name)
    db.add(merchant)
    await db.flush()
    receipt = Receipt(
        vendor_id=buyer.id, merchant_id=merchant.id, merchant_name=merchant_name,
        total=amount, issued_at=when, scanned_at=when, source="qr", status="verified",
        freshness_key="price-test", dedupe_key=uuid.uuid4().hex,
    )
    db.add(receipt)
    await db.flush()
    proof = TradeProof(
        receipt_id=receipt.id, buyer_vendor_id=buyer.id, seller_vendor_id=seller.id,
        merchant_name=merchant_name, amount=amount, status=status,
        confirmed_at=when if status == "confirmed" else None,
    )
    db.add(proof)
    await db.flush()
    return proof


async def _refresh():
    async with async_session() as db:
        result = await service.refresh_indices(db)
        await db.commit()
    return result


async def _row(region: str, category: str, town: str = "ALL"):
    async with async_session() as db:
        return (await db.execute(
            select(CorridorPriceIndex).where(
                CorridorPriceIndex.region_slug == region,
                CorridorPriceIndex.town == town,
                CorridorPriceIndex.category_slug == category,
            )
        )).scalar_one_or_none()


async def test_five_confirmed_trades_build_a_range_and_a_hint(client):
    region = _unique("price-region").replace("_", "-")
    now = datetime.utcnow()
    async with async_session() as db:
        seller = await _vendor(db, "price_seller", region)
        first = await _vendor(db, "price_buyer_a", "Kisumu")
        second = await _vendor(db, "price_buyer_b", "Kisumu")
        await _trade(db, first, seller, 400, now - timedelta(days=5), "Kisumu Grocers")
        await _trade(db, first, seller, 450, now - timedelta(days=4), "Kondele Grocery")
        await _trade(db, first, seller, 500, now - timedelta(days=3), "Kisumu Grocers")
        await _trade(db, second, seller, 600, now - timedelta(days=2), "Oginga Grocery")
        await _trade(db, second, seller, 650, now - timedelta(days=1), "Kisumu Grocers")
        await db.commit()

    await _refresh()
    row = await _row(region, "groceries")
    assert row is not None
    assert row.sample_count == 5
    assert float(row.p25_kes) == 450
    assert float(row.median_kes) == 500
    assert float(row.p75_kes) == 600

    hint = await client.get(
        f"/api/corridors/{region}/price-hint",
        params={"category": "Groceries bulk purchase", "town": "Kisumu"},
    )
    assert hint.status_code == 200, hint.text
    body = hint.json()
    assert body["available"] is True
    # No town-level row exists, so the corridor fallback is the honest answer.
    assert body["town"] == "ALL"
    assert body["sample_count"] == 5
    assert body["p25_kes"] == 450 and body["median_kes"] == 500 and body["p75_kes"] == 600
    assert body["fair_price_ceiling_kes"] == 525
    assert "Groceries & Food" in body["scope_label"]
    assert "not a valuation" in body["signal_note"]


async def test_four_points_stay_silent_and_town_falls_back_to_the_corridor(client):
    now = datetime.utcnow()
    async with async_session() as db:
        seller = await _vendor(db, "edu_seller", "Kisumu")
        first = await _vendor(db, "edu_buyer_a", "Kisumu")
        second = await _vendor(db, "edu_buyer_b", "Kisumu")
        seller_id, second_id = seller.id, second.id
        for index, amount in enumerate((300, 350, 400)):
            await _trade(db, first, seller, amount, now - timedelta(days=6 - index),
                         "Kisumu Tutors")
        await _trade(db, second, seller, 450, now - timedelta(days=2), "Kisumu Tutors")
        await db.commit()

    await _refresh()
    assert await _row("nyanza", "education", town="kisumu") is None
    missing = await client.get(
        "/api/corridors/nyanza/price-hint",
        params={"category": "School tutoring", "town": "Kisumu"},
    )
    assert missing.status_code == 200
    assert missing.json()["available"] is False
    assert "Fewer than 5" in missing.json()["reason"]

    async with async_session() as db:
        seller = await db.get(Vendor, seller_id)
        buyer = await db.get(Vendor, second_id)
        await _trade(db, buyer, seller, 500, now - timedelta(days=1), "Kisumu Tutors")
        await db.commit()

    await _refresh()
    town_row = await _row("nyanza", "education", town="kisumu")
    assert town_row is not None and town_row.sample_count == 5
    assert float(town_row.median_kes) == 400

    in_town = await client.get(
        "/api/corridors/nyanza/price-hint",
        params={"category": "School tutoring", "town": "Kisumu"},
    )
    assert in_town.json()["town"] == "kisumu"
    assert in_town.json()["median_kes"] == 400

    fallback = await client.get(
        "/api/corridors/nyanza/price-hint",
        params={"category": "School tutoring", "town": "Kisii"},
    )
    assert fallback.json()["available"] is True
    assert fallback.json()["town"] == "ALL"


async def test_collusion_pending_old_and_receipt_sources_are_handled_honestly():
    region = _unique("price-honest").replace("_", "-")
    now = datetime.utcnow()
    async with async_session() as db:
        seller = await _vendor(db, "honest_seller", region)
        first = await _vendor(db, "honest_buyer_a", "Kisumu")
        second = await _vendor(db, "honest_buyer_b", "Kisumu")
        await _trade(db, first, seller, 400, now - timedelta(days=5), "Kisumu Grocers")
        await _trade(db, first, seller, 450, now - timedelta(days=4), "Kisumu Grocers")
        await _trade(db, first, seller, 500, now - timedelta(days=3), "Kisumu Grocers")
        await _trade(db, second, seller, 600, now - timedelta(days=2), "Kisumu Grocers")
        await _trade(db, second, seller, 650, now - timedelta(days=1), "Kisumu Grocers")
        # Excluded: not confirmed.
        await _trade(db, first, seller, 9999, now - timedelta(hours=1),
                     "Kisumu Grocers", status="pending")
        # Excluded: outside the 45-day window. Same pair but a different day.
        await _trade(db, first, seller, 9999, now - timedelta(days=60), "Kisumu Grocers")

        # Eligible third source: a verified receipt with no trade proof yet.
        merchant = ReceiptMerchant(pin="P" + uuid.uuid4().hex[:9].upper(),
                                   name="Kisumu Grocers")
        db.add(merchant)
        await db.flush()
        db.add(Receipt(
            vendor_id=second.id, merchant_id=merchant.id, merchant_name="Kisumu Grocers",
            total=700, issued_at=now, scanned_at=now, source="qr", status="verified",
            freshness_key="price-test", dedupe_key=uuid.uuid4().hex, region=region,
        ))
        await db.commit()

    # A pair that only ever trades with each other is not a market sample.
    exclusive_region = _unique("price-exclusive").replace("_", "-").replace("_", "-")
    async with async_session() as db:
        seller = await _vendor(db, "exclusive_seller", exclusive_region)
        buyer = await _vendor(db, "exclusive_buyer", exclusive_region)
        for index, amount in enumerate((1000, 1100, 1200, 1300, 1400)):
            await _trade(db, buyer, seller, amount, now - timedelta(days=10 - index),
                         "Kisumu Hardware")
        await db.commit()

    await _refresh()
    row = await _row(region, "groceries")
    assert row is not None
    # Five confirmed trades + one unlinked receipt; pending and old are absent.
    assert row.sample_count == 6
    assert float(row.median_kes) == 550
    assert await _row(exclusive_region, "construction") is None


async def test_completed_booking_is_a_price_point_and_fair_badge_uses_the_ceiling():
    region = _unique("price-booking").replace("_", "-")
    now = datetime.utcnow()
    async with async_session() as db:
        seller = await _vendor(db, "booking_seller", region)
        first = await _vendor(db, "booking_buyer_a", "Kisumu")
        second = await _vendor(db, "booking_buyer_b", "Kisumu")
        await _trade(db, first, seller, 400, now - timedelta(days=5), "Kisumu Grocers")
        await _trade(db, first, seller, 450, now - timedelta(days=4), "Kisumu Grocers")
        await _trade(db, second, seller, 600, now - timedelta(days=3), "Kisumu Grocers")
        await _trade(db, second, seller, 650, now - timedelta(days=2), "Kisumu Grocers")

        activity = LocalActivity(
            organizer_vendor_id=seller.id, posting_type="scheduled",
            inferred_template="group_sourcing", category="Groceries",
            title="Saturday bulk maize", body="A shared bulk purchase for the estate.",
            area_name=region, lifecycle_status="completed", price_kes=500,
        )
        db.add(activity)
        await db.flush()
        db.add(ActivityBooking(
            activity_id=activity.id, organizer_vendor_id=seller.id,
            participant_vendor_id=first.id, agreed_scope="Two sacks of maize",
            agreed_price_kes=500, status="completed", completed_at=now - timedelta(days=1),
        ))
        await db.commit()

    await _refresh()
    row = await _row(region, "groceries")
    assert row is not None and row.sample_count == 5
    assert float(row.median_kes) == 500

    async with async_session() as db:
        items = [
            {"price_kes": 500, "category": "Groceries bulk purchase", "location": region},
            {"price_kes": 552, "category": "Groceries", "location": region},
            {"price_kes": 400, "category": "Food produce", "location": region},
            {"price_kes": 500, "category": "", "location": region},
            {"price_kes": 500, "category": "Groceries", "location": "unknown place"},
        ]
        decorated = await service.decorate_items(db, items)
    assert decorated == 3
    assert items[0]["is_fair_corridor_price"] is True
    assert items[0]["corridor_median_kes"] == 500
    # Ceiling is median × 1.05 = 525, so 552 misses it comfortably.
    assert items[1]["is_fair_corridor_price"] is False
    assert items[2]["is_fair_corridor_price"] is True
    assert "corridor_median_kes" not in items[3]
    assert "corridor_median_kes" not in items[4]

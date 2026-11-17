"""The Live Corridor Price Index.

What this engine is allowed to say
----------------------------------
A corridor benchmark is a **range from real, confirmed local transactions**,
not a valuation and not a platform price. Below five independent points the
honest answer is silence: `available: false`, no badge, no hint. The index is
therefore allowed to be missing, and the UI must never fill that gap with a
guess.

Eligible points (45-day window)
-------------------------------
* confirmed `TradeProof` rows with a positive amount;
* `ActivityBooking` rows completed by both sides with an agreed price;
* `EventRegistration` rows with `booking_status = 'CONFIRMED'` and an amount;
* receipts that are not already represented by a trade proof.

Excluded
--------
* pending/disputed/unmatched trades, cancelled bookings, zero-price posts;
* self-trades and pairs that only ever trade with each other (exclusive
  1-to-1);
* more than one point per buyer/seller/day — the deterministic stand-in for a
  matching daily subnet, because this deployment stores no IP or device
  fingerprint and inventing one would be dishonest.

Percentiles are computed by PostgreSQL `percentile_cont` over a JSON payload
of normalised points. Location and category normalisation stay in Python so a
free-text place ("Kondele, Kisumu") and a merchant name ("Kisumu Grocers") are
classified by one shared, deterministic vocabulary.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable, Optional

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.events import Event, EventRegistration
from app.models.receipts import Receipt, ReceiptMerchant, TradeProof
from app.models.vendor import Vendor
from app.modules.ledger.models import ActivityBooking, LocalActivity
from app.modules.price_index.models import CorridorPriceIndex
from app.services.merchant_claims import REGION_TOWNS, corridor

WINDOW_DAYS = 45
MIN_SAMPLES = 5
FAIR_TOLERANCE = Decimal("1.05")
MAX_PRICE_KES = 10_000_000

#: One vocabulary for free-text categories, merchant names and activity
#: templates. Order matters: "hardware repair" is a repair, not hardware.
CATEGORY_LABELS = {
    "groceries": "Groceries & Food",
    "health": "Health & Nursing",
    "repairs": "Repairs & Artisans",
    "events": "Events & Catering",
    "transport": "Transport & Delivery",
    "construction": "Construction & Hardware",
    "beauty": "Beauty & Salon",
    "education": "Education & Training",
    "household": "Household & Home",
}

CATEGORY_RULES = (
    ("repairs", (
        "repair", "plumb", "electric", "fundi", "mechanic", "weld", "carpent",
        "tailor", "cobbler", "shoe", "phone", "appliance", "fridge", "solar",
        "borehole", "painter", "fundi", "stitch", "watch",
    )),
    ("health", (
        "health", "nurse", "clinic", "hospital", "doctor", "medical", "pharm",
        "dawa", "dental", "lab", "physio", "counsel", "ambulance", "midwife",
        "maternity", "optic",
    )),
    ("events", (
        "event", "party", "wedding", "funeral", "catering", "venue", "dj",
        "sound", "photo", "conference", "seminar", "concert", "harambee",
    )),
    ("transport", (
        "transport", "delivery", "courier", "boda", "logistic", "lorry",
        "travel", "bus", "matatu", "taxi", "fuel", "movers",
    )),
    ("construction", (
        "construction", "cement", "hardware", "timber", "iron", "steel",
        "block", "sand", "ballast", "roof", "tile", "paint", "plumber",
    )),
    ("beauty", (
        "beauty", "salon", "barber", "hair", "spa", "nail", "makeup",
        "cosmetic", "braid",
    )),
    ("education", (
        "school", "tutor", "education", "training", "college", "lesson",
        "book", "stationery", "exam",
    )),
    ("household", (
        "household", "cleaning", "laundry", "water", "gas", "charcoal",
        "firewood", "furniture", "mattress", "cooking",
    )),
    ("groceries", (
        "grocer", "grocery", "food", "produce", "vegetable", "fruit", "maize",
        "unga", "flour", "rice", "milk", "market", "butcher", "cereal",
        "sukuma", "tomato", "onion", "cabbage", "banana", "avocado", "egg",
        "chicken", "fish", "beans", "lentil", "sugar", "salt", "oil",
    )),
)


def now_utc() -> datetime:
    return datetime.utcnow()


def _slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")


def normalise_category(value: Any) -> str:
    """Free text → one of the corridor categories, or '' when unsure."""
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    key = _slug(raw)
    if key in CATEGORY_LABELS:
        return key
    tokens = set(re.split(r"[^a-z0-9]+", raw))
    for category, fragments in CATEGORY_RULES:
        for fragment in fragments:
            # Short fragments ("lab", "dj", "gas") must be whole words; longer
            # stems ("plumb", "grocer") may match inside a merchant name.
            matched = (fragment in tokens) if len(fragment) <= 3 else (fragment in raw or fragment in key)
            if matched:
                return category
    return ""


def category_label(category_slug: str) -> str:
    return CATEGORY_LABELS.get(category_slug, str(category_slug or "").replace("-", " ").title())


def region_label(region_slug: str) -> str:
    return str(region_slug or "").replace("-", " ").title()


def normalise_town(value: Any) -> str:
    key = _slug(value)
    return "" if key in ("", "all", "corridor") else key


def place_parts(value: Any) -> tuple[str, str]:
    """Free-text place → (region_slug, town_slug).

    "Kondele, Kisumu" → ("nyanza", "kondele"); "nyanza" → ("nyanza", "").
    An unknown place returns ("", "") rather than guessing a corridor.
    """
    raw = str(value or "").strip()
    if not raw:
        return "", ""
    region = corridor(raw)
    if not region:
        return "", ""
    tokens = [token for token in re.split(r"[^a-z0-9]+", raw.lower()) if token]
    towns = REGION_TOWNS.get(region, set())
    town = next((token for token in tokens if token in towns), "")
    return region, town


def _sane_price(value: Any) -> Optional[int]:
    try:
        price = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    if price <= 0 or price > MAX_PRICE_KES:
        return None
    return price


def _point(region: str, town: str, category: str, price: Any, source: str) -> Optional[dict]:
    amount = _sane_price(price)
    if not region or not category or amount is None:
        return None
    return {
        "region_slug": region,
        "town": town or "",
        "category_slug": category,
        "price_kes": amount,
        "source": source,
    }


async def _trade_points(db: AsyncSession, cutoff: datetime) -> list[dict]:
    seller = aliased(Vendor)
    buyer = aliased(Vendor)
    rows = (await db.execute(
        select(
            TradeProof.id, TradeProof.buyer_vendor_id, TradeProof.seller_vendor_id,
            TradeProof.amount, TradeProof.confirmed_at, TradeProof.merchant_name,
            seller.physical_location.label("seller_location"),
            buyer.physical_location.label("buyer_location"),
        )
        .join(seller, seller.id == TradeProof.seller_vendor_id)
        .outerjoin(buyer, buyer.id == TradeProof.buyer_vendor_id)
        .where(
            TradeProof.status == "confirmed",
            TradeProof.confirmed_at.isnot(None),
            TradeProof.confirmed_at >= cutoff,
            TradeProof.amount > 0,
            TradeProof.buyer_vendor_id != TradeProof.seller_vendor_id,
        )
        .order_by(TradeProof.confirmed_at)
    )).all()
    if not rows:
        return []

    # Exclusive 1-to-1 relationships are excluded using all confirmed history,
    # not only the window: a pair that only trades with each other is not an
    # independent market sample even if each point looks recent.
    pairs = (await db.execute(
        select(TradeProof.buyer_vendor_id, TradeProof.seller_vendor_id)
        .where(TradeProof.status == "confirmed")
    )).all()
    sellers_by_buyer: dict = defaultdict(set)
    buyers_by_seller: dict = defaultdict(set)
    for buyer_id, seller_id in pairs:
        if buyer_id is None or seller_id is None or buyer_id == seller_id:
            continue
        sellers_by_buyer[buyer_id].add(seller_id)
        buyers_by_seller[seller_id].add(buyer_id)

    seen: set[tuple] = set()
    points: list[dict] = []
    for row in rows:
        buyer_id, seller_id = row.buyer_vendor_id, row.seller_vendor_id
        if len(sellers_by_buyer[buyer_id]) == 1 and len(buyers_by_seller[seller_id]) == 1:
            continue
        day = row.confirmed_at.date()
        key = (buyer_id, seller_id, day)
        if key in seen:
            continue
        seen.add(key)
        category = normalise_category(row.merchant_name)
        region, town = place_parts(row.seller_location or row.buyer_location)
        point = _point(region, town, category, row.amount, "trade_proof")
        if point:
            points.append(point)
    return points


async def _booking_points(db: AsyncSession, cutoff: datetime) -> list[dict]:
    rows = (await db.execute(
        select(
            ActivityBooking.agreed_price_kes, ActivityBooking.completed_at,
            ActivityBooking.organizer_vendor_id, ActivityBooking.participant_vendor_id,
            LocalActivity.category, LocalActivity.inferred_template,
            LocalActivity.area_name, Vendor.physical_location,
        )
        .join(LocalActivity, LocalActivity.id == ActivityBooking.activity_id)
        .join(Vendor, Vendor.id == ActivityBooking.organizer_vendor_id)
        .where(
            ActivityBooking.status == "completed",
            ActivityBooking.completed_at.isnot(None),
            ActivityBooking.completed_at >= cutoff,
            ActivityBooking.agreed_price_kes.isnot(None),
            ActivityBooking.agreed_price_kes > 0,
            ActivityBooking.organizer_vendor_id != ActivityBooking.participant_vendor_id,
        )
        .order_by(ActivityBooking.completed_at)
    )).all()
    points = []
    seen: set[tuple] = set()
    for row in rows:
        day = row.completed_at.date()
        key = (row.organizer_vendor_id, row.participant_vendor_id, day)
        if key in seen:
            continue
        seen.add(key)
        category = normalise_category(row.category) or normalise_category(row.inferred_template)
        region, town = place_parts(row.area_name or row.physical_location)
        point = _point(region, town, category, row.agreed_price_kes, "activity_booking")
        if point:
            points.append(point)
    return points


async def _event_points(db: AsyncSession, cutoff: datetime) -> list[dict]:
    amount = func.coalesce(EventRegistration.mpesa_amount, Event.entry_fee)
    occurred = func.coalesce(EventRegistration.mpesa_submitted_at, EventRegistration.registered_at)
    rows = (await db.execute(
        select(amount, occurred, Event.location)
        .join(Event, Event.id == EventRegistration.event_id)
        .where(
            EventRegistration.booking_status == "CONFIRMED",
            amount.isnot(None),
            amount > 0,
            occurred >= cutoff,
            EventRegistration.vendor_id != Event.organizer_id,
        )
        .order_by(occurred)
    )).all()
    points = []
    for paid, _occurred, location in rows:
        region, town = place_parts(location)
        point = _point(region, town, "events", paid, "event_booking")
        if point:
            points.append(point)
    return points


async def _receipt_points(db: AsyncSession, cutoff: datetime) -> list[dict]:
    represented = select(TradeProof.id).where(TradeProof.receipt_id == Receipt.id).exists()
    rows = (await db.execute(
        select(
            Receipt.total, Receipt.scanned_at, Receipt.merchant_name, Receipt.region,
            Receipt.vendor_id,
        )
        .outerjoin(ReceiptMerchant, ReceiptMerchant.id == Receipt.merchant_id)
        .where(
            Receipt.status.in_(("verified", "partial")),
            Receipt.total > 0,
            Receipt.scanned_at >= cutoff,
            ~represented,
            # A shop owner scanning their own till is not a market sample.
            or_(ReceiptMerchant.claimed_by_vendor_id.is_(None),
                ReceiptMerchant.claimed_by_vendor_id != Receipt.vendor_id),
        )
        .order_by(Receipt.scanned_at)
    )).all()
    points = []
    seen: set[tuple] = set()
    for total, scanned, merchant_name, region_value, vendor_id in rows:
        # One shopper's basket is one signal per day, not five market samples.
        key = (vendor_id, scanned.date())
        if key in seen:
            continue
        seen.add(key)
        category = normalise_category(merchant_name)
        region, town = place_parts(region_value)
        point = _point(region, town, category, total, "receipt")
        if point:
            points.append(point)
    return points


async def collect_points(db: AsyncSession, now: Optional[datetime] = None) -> list[dict]:
    now = now or now_utc()
    cutoff = now - timedelta(days=WINDOW_DAYS)
    points = []
    points.extend(await _trade_points(db, cutoff))
    points.extend(await _booking_points(db, cutoff))
    points.extend(await _event_points(db, cutoff))
    points.extend(await _receipt_points(db, cutoff))
    return points


_REFRESH_SQL = text("""
WITH points AS (
    SELECT
        elem->>'region_slug' AS region_slug,
        elem->>'town' AS town,
        elem->>'category_slug' AS category_slug,
        (elem->>'price_kes')::numeric AS price_kes
    FROM jsonb_array_elements(CAST(:payload AS jsonb)) AS elem
),
expanded AS (
    -- One town-level series and one corridor-wide series from the same points.
    SELECT region_slug, town, category_slug, price_kes
    FROM points WHERE town <> ''
    UNION ALL
    SELECT region_slug, NULL, category_slug, price_kes
    FROM points
),
grouped AS (
    SELECT
        region_slug,
        COALESCE(town, 'ALL') AS town,
        category_slug,
        COUNT(*)::int AS sample_count,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY price_kes) AS p25,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY price_kes) AS median,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY price_kes) AS p75
    FROM expanded
    GROUP BY region_slug, COALESCE(town, 'ALL'), category_slug
    HAVING COUNT(*) >= :min_samples
)
INSERT INTO corridor_price_indices (
    id, region_slug, town, category_slug, sample_count,
    p25_kes, median_kes, p75_kes, computed_at
)
SELECT
    gen_random_uuid(), region_slug, town, category_slug, sample_count,
    ROUND(p25::numeric, 2), ROUND(median::numeric, 2), ROUND(p75::numeric, 2), now()
FROM grouped
ON CONFLICT (region_slug, town, category_slug) DO UPDATE
SET sample_count = EXCLUDED.sample_count,
    p25_kes = EXCLUDED.p25_kes,
    median_kes = EXCLUDED.median_kes,
    p75_kes = EXCLUDED.p75_kes,
    computed_at = EXCLUDED.computed_at
""")


async def refresh_indices(db: AsyncSession, now: Optional[datetime] = None) -> dict:
    """Rebuild the snapshot. Safe to call hourly and after a confirmation."""
    now = now or now_utc()
    points = await collect_points(db, now)
    # A full replace keeps stale scopes from surviving a quiet week. The delete
    # and insert are one transaction, so readers keep seeing the old snapshot
    # until the new one commits.
    await db.execute(text("DELETE FROM corridor_price_indices"))
    written = 0
    if points:
        result = await db.execute(_REFRESH_SQL, {
            "payload": json.dumps(points),
            "min_samples": MIN_SAMPLES,
        })
        written = int(result.rowcount or 0)
    return {
        "points": len(points),
        "rows_written": written,
        "computed_at": now.isoformat(),
        "window_days": WINDOW_DAYS,
        "min_samples": MIN_SAMPLES,
    }


def _row_payload(row: CorridorPriceIndex) -> dict:
    town = row.town or "ALL"
    scope = (
        f"{region_label(row.region_slug)} corridor"
        if town == "ALL"
        else f"{town.title()} • {region_label(row.region_slug)}"
    )
    return {
        "available": True,
        "scope": scope,
        "scope_label": f"{scope} • {category_label(row.category_slug)}",
        "region_slug": row.region_slug,
        "town": town,
        "category_slug": row.category_slug,
        "category_label": category_label(row.category_slug),
        "sample_count": int(row.sample_count),
        "p25_kes": float(row.p25_kes),
        "median_kes": float(row.median_kes),
        "p75_kes": float(row.p75_kes),
        "fair_price_ceiling_kes": round(float(row.median_kes) * float(FAIR_TOLERANCE), 2),
        "window_days": WINDOW_DAYS,
        "signal_note": (
            "A guide from confirmed local trades in the last 45 days. "
            "It is not a valuation, and it awards no standing credit."
        ),
    }


async def lookup_hint(db: AsyncSession, region_slug: str, category: str,
                      town: Optional[str] = None) -> dict:
    region = corridor(region_slug)
    category_slug = normalise_category(category)
    if not region or not category_slug:
        return {"available": False, "reason": "No matching corridor category yet."}
    candidates = [candidate for candidate in (normalise_town(town), "ALL") if candidate]
    for candidate in dict.fromkeys(candidates):
        query = select(CorridorPriceIndex).where(
            CorridorPriceIndex.region_slug == region,
            CorridorPriceIndex.category_slug == category_slug,
            func.lower(CorridorPriceIndex.town) == candidate.lower(),
        )
        row = (await db.execute(query)).scalar_one_or_none()
        if row is not None:
            return _row_payload(row)
    return {
        "available": False,
        "reason": (
            f"Fewer than {MIN_SAMPLES} confirmed {CATEGORY_LABELS[category_slug]} "
            f"trades in this corridor yet. No price is shown rather than guessing."
        ),
    }


async def decorate_items(db: AsyncSession, items: Iterable[dict]) -> int:
    """Attach the Fair Corridor Price signal to priced feed items in place.

    The badge says the asking price is at or below the corridor median (within
    5%). It does not say the item is cheap in absolute terms, and it is not a
    platform endorsement.
    """
    items = list(items)
    keys = set()
    for item in items:
        if _sane_price(item.get("price_kes")) is None:
            continue
        region, town = place_parts(item.get("location") or item.get("area_name"))
        category = normalise_category(item.get("category"))
        if region and category:
            keys.add((region, town, category))
    if not keys:
        return 0

    regions = {region for region, _town, _category in keys}
    rows = (await db.execute(
        select(CorridorPriceIndex).where(CorridorPriceIndex.region_slug.in_(regions))
    )).scalars().all()
    index = {(row.region_slug, (row.town or "ALL").lower(), row.category_slug): row for row in rows}

    decorated = 0
    for item in items:
        price = _sane_price(item.get("price_kes"))
        if price is None:
            continue
        region, town = place_parts(item.get("location") or item.get("area_name"))
        category = normalise_category(item.get("category"))
        if not region or not category:
            continue
        row = index.get((region, town, category)) if town else None
        if row is None:
            row = index.get((region, "all", category))
        if row is None:
            continue
        median = float(row.median_kes)
        ceiling = round(median * float(FAIR_TOLERANCE), 2)
        item["corridor_category_slug"] = category
        item["corridor_town"] = row.town
        item["corridor_region_slug"] = row.region_slug
        item["corridor_sample_count"] = int(row.sample_count)
        item["corridor_p25_kes"] = float(row.p25_kes)
        item["corridor_median_kes"] = median
        item["corridor_p75_kes"] = float(row.p75_kes)
        item["corridor_scope_label"] = _row_payload(row)["scope"]
        item["is_fair_corridor_price"] = price <= ceiling
        decorated += 1
    return decorated

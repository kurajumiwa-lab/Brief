"""Activation and usage measurement (v2.15).

The brief's last gate is "measure what deserves to scale" — but a metric is only
worth arguing about if its definition is written down. So every number this
module returns carries the rule that produced it, and anything the platform
cannot honestly measure is listed in ``not_measured`` with the reason, rather
than being estimated and then quoted.

Read-only: this module issues SELECTs and nothing else. It is reachable only
through ``GET /api/ops/measurement``, which is behind the operator gate.
"""

from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatMessage
from app.models.payments import PaymentIntent
from app.models.stock import StockItem, StockMovement
from app.models.vendor import Vendor
from app.modules.trade.models import BusinessRequest, RequestOffer

# A vendor whose handle starts with this was closed through /api/vendors/me/close.
CLOSED_PREFIX = "closed_"

# A benchmark is only worth publishing if no row in it can be traced to one
# business, and if there is enough trade to say anything at all. These are the
# thresholds the brief asked for; they are checked here rather than remembered.
BENCHMARK_MIN_VENDORS = 25          # distinct vendors with settled trade in the window
BENCHMARK_MIN_CATEGORIES = 3        # categories that can be published at all
BENCHMARK_MIN_VENDORS_PER_CELL = 5  # k-anonymity: no cell describes fewer than 5 vendors
BENCHMARK_MIN_WINDOW_DAYS = 30

DEFINITIONS = {
    "registered": "Vendor rows that have not been closed through the data-rights workflow.",
    "activated": (
        "Registered vendors with at least one owned record: a stock item, a request, "
        "an offer, a stock movement, or a payment intent. Created is not activated; "
        "a record exists or it does not."
    ),
    "repeated": (
        "Registered vendors active on at least two distinct calendar days inside the "
        "window. Activity = any of: stock item created, request created, offer made, "
        "message sent, movement created or received, payment intent created."
    ),
    "completion_rate": (
        "completed / (completed + failed + expired) payment intents in the window. "
        "Pending intents are excluded: they have not finished yet and counting them "
        "as failures would punish a vendor for the PSP's queue."
    ),
    "active_last_7_days": "Vendors with any of the activity records above in the last 7 days.",
}

ACTIVITY_SOURCES = (
    "stock_items.created_at",
    "business_requests.created_at",
    "request_offers.created_at",
    "chat_messages.sent_at",
    "stock_movements.created_at",
    "payment_intents.created_at",
)


def _rate(part: int, whole: int) -> float:
    return round(part / whole, 4) if whole else 0.0


async def _active_days(db: AsyncSession, since: datetime) -> dict[str, set]:
    """vendor_id -> set of calendar dates with activity since ``since``."""
    days: dict[str, set] = {}

    def add(rows: Iterable) -> None:
        for vendor_id, day in rows:
            if vendor_id is None or day is None:
                continue
            days.setdefault(str(vendor_id), set()).add(day)

    add((await db.execute(
        select(StockItem.vendor_id, func.date(StockItem.created_at))
        .where(StockItem.created_at >= since)
    )).all())

    add((await db.execute(
        select(BusinessRequest.requester_vendor_id, func.date(BusinessRequest.created_at))
        .where(BusinessRequest.created_at >= since)
    )).all())

    add((await db.execute(
        select(RequestOffer.responder_vendor_id, func.date(RequestOffer.created_at))
        .where(RequestOffer.created_at >= since)
    )).all())

    add((await db.execute(
        select(ChatMessage.sender_id, func.date(ChatMessage.sent_at))
        .where(ChatMessage.sent_at >= since)
    )).all())

    # Both sides of a movement are working; credit both.
    for column in (StockMovement.from_vendor_id, StockMovement.to_vendor_id):
        add((await db.execute(
            select(column, func.date(StockMovement.created_at))
            .where(StockMovement.created_at >= since)
        )).all())

    add((await db.execute(
        select(PaymentIntent.vendor_id, func.date(PaymentIntent.created_at))
        .where(PaymentIntent.created_at >= since)
    )).all())

    return days


async def _ever_activated_ids(db: AsyncSession) -> set[str]:
    """Vendors with at least one owned record, at any point."""
    ids: set[str] = set()
    for column in (
        StockItem.vendor_id,
        BusinessRequest.requester_vendor_id,
        RequestOffer.responder_vendor_id,
        StockMovement.from_vendor_id,
        StockMovement.to_vendor_id,
        PaymentIntent.vendor_id,
    ):
        rows = (await db.execute(select(distinct(column)))).scalars().all()
        ids.update(str(r) for r in rows if r is not None)
    return ids


async def benchmark_gate(db: AsyncSession, since: datetime, days: int) -> dict:
    """Whether a price/volume benchmark would be credible *and* safe to publish.

    Two different failures, reported separately because they need different
    answers: not enough trade yet (wait), or cells that would identify a single
    business (suppress, never publish).
    """
    rows = (await db.execute(
        select(
            StockItem.category,
            func.count(distinct(StockMovement.from_vendor_id)).label("vendors"),
            func.count(StockMovement.id).label("movements"),
        )
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .where(
            StockMovement.created_at >= since,
            StockMovement.status == "received",
            StockItem.category.isnot(None),
        )
        .group_by(StockItem.category)
    )).all()

    total_vendors = (await db.execute(
        select(func.count(distinct(StockMovement.from_vendor_id)))
        .where(StockMovement.created_at >= since, StockMovement.status == "received")
    )).scalar_one()

    publishable = [r for r in rows if r.vendors >= BENCHMARK_MIN_VENDORS_PER_CELL]
    suppressed = [
        {"category": r.category, "vendors": r.vendors}
        for r in rows if r.vendors < BENCHMARK_MIN_VENDORS_PER_CELL
    ]

    reasons = []
    if days < BENCHMARK_MIN_WINDOW_DAYS:
        reasons.append(f"The window is {days} days; a benchmark needs at least {BENCHMARK_MIN_WINDOW_DAYS}.")
    if total_vendors < BENCHMARK_MIN_VENDORS:
        reasons.append(
            f"{total_vendors} vendor(s) with settled trade; at least {BENCHMARK_MIN_VENDORS} are needed "
            "before a comparison means anything."
        )
    if len(publishable) < BENCHMARK_MIN_CATEGORIES:
        reasons.append(
            f"{len(publishable)} categor{'y' if len(publishable) == 1 else 'ies'} can be published at "
            f"{BENCHMARK_MIN_VENDORS_PER_CELL} vendors or more; {BENCHMARK_MIN_CATEGORIES} are needed."
        )

    return {
        "eligible": not reasons,
        "reasons": reasons,
        "thresholds": {
            "min_vendors": BENCHMARK_MIN_VENDORS,
            "min_categories": BENCHMARK_MIN_CATEGORIES,
            "min_vendors_per_cell": BENCHMARK_MIN_VENDORS_PER_CELL,
            "min_window_days": BENCHMARK_MIN_WINDOW_DAYS,
        },
        "observed": {
            "vendors_with_settled_trade": total_vendors,
            "categories_considered": len(rows),
            "categories_publishable": len(publishable),
        },
        # Named, not silently dropped: a supplier whose category is suppressed
        # should be able to see why their numbers are not in the comparison.
        "suppressed_categories": suppressed,
        "k_anonymity_rule": (
            "No published cell describes fewer than "
            f"{BENCHMARK_MIN_VENDORS_PER_CELL} vendors. Cells below that are suppressed, never rounded."
        ),
    }


async def build(db: AsyncSession, days: int = 30) -> dict:
    now = datetime.utcnow()
    days = max(1, min(int(days), 180))
    since = now - timedelta(days=days)
    week_ago = now - timedelta(days=7)

    registered_rows = (await db.execute(
        select(Vendor.id, Vendor.joined_at)
        .where(~Vendor.vendor_handle.startswith(CLOSED_PREFIX))
    )).all()
    registered_ids = {str(r[0]) for r in registered_rows}
    new_in_window = sum(1 for r in registered_rows if r[1] and r[1] >= since)

    activated_ever = await _ever_activated_ids(db)
    activated_ids = {i for i in activated_ever if i in registered_ids}

    days_map = await _active_days(db, since)
    repeated_ids = {v for v, d in days_map.items() if len(d) >= 2 and v in registered_ids}
    active_7d = {v for v, d in days_map.items()
                 if any(day >= week_ago.date() for day in d) and v in registered_ids}

    intent_rows = (await db.execute(
        select(PaymentIntent.status, func.count())
        .where(PaymentIntent.created_at >= since)
        .group_by(PaymentIntent.status)
    )).all()
    intents = {status: count for status, count in intent_rows}
    settled = intents.get("completed", 0)
    settled_scope = settled + intents.get("failed", 0) + intents.get("expired", 0)

    movement_rows = (await db.execute(
        select(StockMovement.status, func.count())
        .where(StockMovement.created_at >= since)
        .group_by(StockMovement.status)
    )).all()
    movements = {status: count for status, count in movement_rows}

    requests_created = (await db.execute(
        select(func.count()).select_from(BusinessRequest)
        .where(BusinessRequest.created_at >= since)
    )).scalar_one()
    offers_made = (await db.execute(
        select(func.count()).select_from(RequestOffer)
        .where(RequestOffer.created_at >= since)
    )).scalar_one()
    stock_items_created = (await db.execute(
        select(func.count()).select_from(StockItem)
        .where(StockItem.created_at >= since)
    )).scalar_one()

    return {
        "generated_at": now.isoformat() + "Z",
        "window_days": days,
        "window_start": since.isoformat() + "Z",
        "definitions": DEFINITIONS,
        "activity_sources": list(ACTIVITY_SOURCES),
        "funnel": {
            "registered": len(registered_ids),
            "registered_in_window": new_in_window,
            "activated": len(activated_ids),
            "activation_rate": _rate(len(activated_ids), len(registered_ids)),
            "repeated": len(repeated_ids),
            "repeat_rate": _rate(len(repeated_ids), len(activated_ids)),
            "active_last_7_days": len(active_7d),
        },
        "commerce": {
            "payment_intents": intents,
            "completion_rate": _rate(settled, settled_scope),
            "completion_scope": settled_scope,
            "movements": movements,
            "stock_items_created": stock_items_created,
            "requests_created": requests_created,
            "offers_made": offers_made,
        },
        "benchmark_gate": await benchmark_gate(db, since, days),
        "not_measured": [
            {
                "metric": "cost_per_vendor",
                "reason": "Needs hosting, PSP and SMS invoices, which this service cannot read. "
                          "Deriving it from request counts would be an estimate dressed as a measurement.",
            },
            {
                "metric": "brief_opens",
                "reason": "There is no client event store. Adding one is a consent and retention "
                          "decision, not a code change; until then, brief usage is not claimed.",
            },
            {
                "metric": "revenue",
                "reason": "Payment intents prove a vendor used a payment rail; they say nothing "
                          "about platform revenue, which only the PSP and bank statements can confirm.",
            },
        ],
    }

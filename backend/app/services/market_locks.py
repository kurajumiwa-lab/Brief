"""Deterministic Daily Flash scheduling and MOQ threshold rules."""

import logging
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.market_locks import LockCluster, LockPick, LockProduct, LockWindow, MarketZone, SupplierMOQ
from app.models.notification import NotificationType
from app.services.notification_service import create_notification, notify_many

log = logging.getLogger("brief.market_locks")
MARKET_TZ = ZoneInfo("Africa/Nairobi")
DAILY_FLASH_OPENS = time(15, 0)
DAILY_FLASH_CLOSES = time(20, 0)
DAILY_FLASH_DELIVERY = time(5, 0)
THRESHOLD_PERCENT = 85


def as_utc_naive(value: datetime) -> datetime:
    """Store UTC in this project’s existing naive-UTC DateTime convention."""
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def minimum_bid_quantity(moq: int) -> int:
    """Ceiling(MOQ × 0.85), using integer arithmetic so no float edge cases leak."""
    return (int(moq) * THRESHOLD_PERCENT + 99) // 100


def daily_flash_times(day: date) -> tuple[datetime, datetime, datetime]:
    """Return the fixed 15:00–20:00 EAT pick window and next-day 05:00 delivery in UTC."""
    opens = datetime.combine(day, DAILY_FLASH_OPENS, tzinfo=MARKET_TZ)
    closes = datetime.combine(day, DAILY_FLASH_CLOSES, tzinfo=MARKET_TZ)
    delivery = datetime.combine(day + timedelta(days=1), DAILY_FLASH_DELIVERY, tzinfo=MARKET_TZ)
    return tuple(v.astimezone(timezone.utc).replace(tzinfo=None) for v in (opens, closes, delivery))


async def ensure_daily_flash_windows(db: AsyncSession, now: datetime | None = None) -> int:
    """Create today's scheduled window per active zone. Safe to run repeatedly."""
    now = as_utc_naive(now or datetime.utcnow())
    local_now = now.replace(tzinfo=timezone.utc).astimezone(MARKET_TZ)
    if local_now.time().replace(tzinfo=None) >= DAILY_FLASH_CLOSES:
        return 0  # don't create a missed window if the scheduler was down all evening
    zones = (await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True)))).scalars().all()
    created = 0
    for zone in zones:
        exists = (await db.execute(select(LockWindow.id).where(
            LockWindow.zone_id == zone.id, LockWindow.local_date == local_now.date(),
        ))).scalar_one_or_none()
        if exists:
            continue
        opens, closes, delivery = daily_flash_times(local_now.date())
        db.add(LockWindow(
            zone_id=zone.id, local_date=local_now.date(), opens_at=opens, closes_at=closes,
            delivery_at=delivery, status="open", roll_count=0,
        ))
        created += 1
    if created:
        await db.flush()
    return created


async def _cluster_demand(db: AsyncSession, cluster_id) -> tuple[int, int, list]:
    total, count = (await db.execute(
        select(func.coalesce(func.sum(LockPick.quantity), 0), func.count(LockPick.id))
        .where(LockPick.cluster_id == cluster_id, LockPick.status == "submitted")
    )).one()
    vendor_ids = list((await db.execute(select(LockPick.vendor_id).where(
        LockPick.cluster_id == cluster_id, LockPick.status == "submitted",
    ))).scalars())
    return int(total or 0), int(count or 0), vendor_ids


async def evaluate_window(db: AsyncSession, window: LockWindow, now: datetime | None = None) -> dict:
    """Evaluate product clusters at close. Unmet products get one 24h roll, then dissolve."""
    now = as_utc_naive(now or datetime.utcnow())
    if window.status not in ("open", "rolling"):
        return {"qualified": 0, "dissolved": 0, "rolled": False}

    zone = await db.get(MarketZone, window.zone_id)
    clusters = (await db.execute(select(LockCluster).where(
        LockCluster.window_id == window.id, LockCluster.status == "collecting",
    ).with_for_update())).scalars().all()
    qualified = dissolved = 0
    pending_roll = False
    for cluster in clusters:
        quantity, vendor_count, vendor_ids = await _cluster_demand(db, cluster.id)
        offers = (await db.execute(select(SupplierMOQ).where(
            SupplierMOQ.zone_id == window.zone_id,
            SupplierMOQ.product_id == cluster.product_id,
            SupplierMOQ.is_active.is_(True),
        ))).scalars().all()
        eligible_offers = [offer for offer in offers if quantity >= minimum_bid_quantity(offer.minimum_order_quantity)]
        if quantity > 0 and eligible_offers:
            cluster.status = "bidding"
            cluster.bid_quantity = quantity
            cluster.evaluated_at = now
            cluster.dissolved_reason = None
            qualified += 1
            product = await db.get(LockProduct, cluster.product_id)
            await notify_many(
                db, vendor_ids, NotificationType.COLLECTIVE_UPDATE,
                f"Lock ready for bids: {product.name if product else 'product'}",
                f"{quantity} units from {vendor_count} vendors in {zone.name if zone else 'the market zone'} cleared a supplier’s 85% MOQ threshold. A negotiator can now collect bids.",
                data={"market_lock_cluster_id": cluster.id, "window_id": window.id, "zone_id": window.zone_id},
            )
        elif window.roll_count == 0:
            pending_roll = True
            cluster.dissolved_reason = "No supplier MOQ is configured" if not offers else "Demand is below the supplier MOQ threshold"

    rolled = False
    if pending_roll and window.roll_count == 0:
        window.roll_count = 1
        window.status = "rolling"
        window.closes_at = window.closes_at + timedelta(days=1)
        window.delivery_at = window.delivery_at + timedelta(days=1)
        rolled = True
        pickers = list((await db.execute(
            select(LockPick.vendor_id).join(LockCluster).where(
                LockCluster.window_id == window.id, LockPick.status == "submitted",
            ).distinct()
        )).scalars())
        await notify_many(
            db, pickers, NotificationType.COLLECTIVE_UPDATE,
            f"Daily Flash rolled once in {zone.name if zone else 'the market zone'}",
            "Some product totals are still below supplier thresholds. Existing picks stay open for one more day; no new products can be added to this window.",
            data={"window_id": window.id, "zone_id": window.zone_id},
        )
    else:
        for cluster in clusters:
            if cluster.status == "collecting":
                cluster.status = "dissolved"
                cluster.evaluated_at = now
                cluster.dissolved_reason = cluster.dissolved_reason or "Below supplier MOQ after the one-day roll"
                dissolved += 1
        window.status = "closed"

    await db.flush()
    return {"qualified": qualified, "dissolved": dissolved, "rolled": rolled}


async def process_due_windows_in_session(db: AsyncSession, now: datetime | None = None) -> int:
    """Run the scheduler pass in the caller's transaction."""
    now = as_utc_naive(now or datetime.utcnow())
    created = await ensure_daily_flash_windows(db, now)
    due = (await db.execute(select(LockWindow).where(
        LockWindow.status.in_(("open", "rolling")), LockWindow.closes_at <= now,
    ).with_for_update(skip_locked=True))).scalars().all()
    processed = 0
    for window in due:
        result = await evaluate_window(db, window, now)
        processed += 1
        if result["qualified"] or result["dissolved"] or result["rolled"]:
            log.info("Daily Flash %s: %s", window.id, result)
    return created + processed


async def process_due_windows(session_factory, now: datetime | None = None) -> int:
    """Standalone scheduler entry point for tests and one-off worker calls."""
    async with session_factory() as db:
        n = await process_due_windows_in_session(db, now)
        await db.commit()
        return n

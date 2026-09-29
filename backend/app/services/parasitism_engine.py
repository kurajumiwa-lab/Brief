"""
Live Parasitism Engine v2.1 (Directive §4.3)

The core concept: vendors benefit from each other's businesses.
- A textile vendor sources from a cotton vendor → cotton vendor benefits
- The textile vendor sells to a fashion vendor → fashion vendor benefits
- The fashion vendor's popup shop needs a transport vendor → transport vendor benefits

Pair score (0-100), recalculated after every received movement:
  - bidirectional trade-volume balance      40%
  - trade-frequency balance                 30%
  - category complementarity                20%
  - recency (trades in the last 30 days)    10%

Only movements that reached `received` count: a reservation is a promise,
not a benefit. Callers commit.
"""

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import MovementStatus, StockMovement
from app.models.vendor import Vendor, vendor_connections

RECEIVED = MovementStatus.RECEIVED.value


async def _flow(db: AsyncSession, src: UUID, dst: UUID) -> tuple[int, float]:
    """(count, value) of received movements from src to dst."""
    row = (await db.execute(
        select(func.count(StockMovement.id), func.coalesce(func.sum(StockMovement.total_value), 0.0)).where(
            StockMovement.from_vendor_id == src,
            StockMovement.to_vendor_id == dst,
            StockMovement.status == RECEIVED,
        )
    )).one()
    return int(row[0] or 0), float(row[1] or 0.0)


def _pair(vendor_a_id: UUID, vendor_b_id: UUID):
    return or_(
        and_(vendor_connections.c.vendor_a_id == vendor_a_id, vendor_connections.c.vendor_b_id == vendor_b_id),
        and_(vendor_connections.c.vendor_a_id == vendor_b_id, vendor_connections.c.vendor_b_id == vendor_a_id),
    )


async def recalculate_parasitism(vendor_a_id: UUID, vendor_b_id: UUID, db: AsyncSession) -> float:
    """Mutual-benefit score between two vendors, 0-100."""
    cnt_ab, vol_ab = await _flow(db, vendor_a_id, vendor_b_id)
    cnt_ba, vol_ba = await _flow(db, vendor_b_id, vendor_a_id)

    total_cnt = cnt_ab + cnt_ba
    if total_cnt == 0:
        return 0.0

    # 1. Volume balance (1.0 = perfectly balanced, 0.0 = one-sided) — 40 pts
    total_vol = vol_ab + vol_ba
    vol_balance = 1 - abs(vol_ab - vol_ba) / total_vol if total_vol > 0 else 0.0
    volume_score = vol_balance * 40

    # 2. Frequency balance — 30 pts
    freq_balance = 1 - abs(cnt_ab - cnt_ba) / max(total_cnt, 1)
    frequency_score = freq_balance * 30

    # 3. Category complementarity — 20 pts (low overlap = they need each other)
    vendor_a = await db.get(Vendor, vendor_a_id)
    vendor_b = await db.get(Vendor, vendor_b_id)
    cats_a = set(c.lower() for c in (vendor_a.business_categories or [])) if vendor_a else set()
    cats_b = set(c.lower() for c in (vendor_b.business_categories or [])) if vendor_b else set()
    if cats_a and cats_b:
        overlap = len(cats_a & cats_b) / len(cats_a | cats_b)
        complementarity = (1 - overlap) * 20
    else:
        complementarity = 10.0  # neutral if unknown

    # 4. Recency — 10 pts (2 per trade in the last 30 days)
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    recent_count = (await db.execute(
        select(func.count(StockMovement.id)).where(
            or_(
                and_(StockMovement.from_vendor_id == vendor_a_id, StockMovement.to_vendor_id == vendor_b_id),
                and_(StockMovement.from_vendor_id == vendor_b_id, StockMovement.to_vendor_id == vendor_a_id),
            ),
            StockMovement.status == RECEIVED,
            StockMovement.completed_at >= thirty_days_ago,
        )
    )).scalar() or 0
    recency_score = min(recent_count * 2, 10)

    total_score = volume_score + frequency_score + complementarity + recency_score
    return round(min(total_score, 100.0), 2)


# The pre-2.1 name, kept for callers.
calculate_parasitism_score = recalculate_parasitism


async def stored_connection_score(vendor_a_id: UUID, vendor_b_id: UUID, db: AsyncSession) -> float:
    """The pair score as last written to the connection row (0 if never scored)."""
    row = (await db.execute(select(vendor_connections.c.parasitism_score).where(_pair(vendor_a_id, vendor_b_id)))).first()
    return float(row[0] or 0.0) if row else 0.0


async def update_connection_score(vendor_a_id: UUID, vendor_b_id: UUID, db: AsyncSession) -> float:
    """Recompute the pair score, store it on the connection row (creating the
    connection if trade happened before anyone pressed Connect), and refresh
    both vendors' parasitism index."""
    score = await recalculate_parasitism(vendor_a_id, vendor_b_id, db)
    pair = _pair(vendor_a_id, vendor_b_id)
    existing = (await db.execute(select(vendor_connections.c.vendor_a_id).where(pair))).first()
    if existing:
        await db.execute(update(vendor_connections).where(pair).values(parasitism_score=score))
    else:
        await db.execute(vendor_connections.insert().values(
            vendor_a_id=vendor_a_id, vendor_b_id=vendor_b_id,
            connection_type="trade", parasitism_score=score,
        ))
    for vid in (vendor_a_id, vendor_b_id):
        await update_parasitism_index(vid, db)
    return score


async def update_parasitism_index(vendor_id: UUID, db: AsyncSession) -> None:
    """A vendor's parasitism index is the mean pair score across their
    connections — how mutually useful their relationships are, on average."""
    vendor = await db.get(Vendor, vendor_id)
    if not vendor:
        return
    avg = (await db.execute(
        select(func.avg(vendor_connections.c.parasitism_score)).where(
            or_(vendor_connections.c.vendor_a_id == vendor_id, vendor_connections.c.vendor_b_id == vendor_id)
        )
    )).scalar()
    vendor.parasitism_index = round(float(avg or 0.0), 2)


async def update_vendor_network_score(vendor_id: UUID, db: AsyncSession) -> None:
    """Network score = activity + balance between sourcing and supplying +
    the vendor's parasitism index (v2.1 formula)."""
    vendor = await db.get(Vendor, vendor_id)
    if not vendor:
        return
    supplied = (await db.execute(select(func.count(StockMovement.id)).where(
        StockMovement.from_vendor_id == vendor_id, StockMovement.status == RECEIVED,
    ))).scalar() or 0
    sourced = (await db.execute(select(func.count(StockMovement.id)).where(
        StockMovement.to_vendor_id == vendor_id, StockMovement.status == RECEIVED,
    ))).scalar() or 0

    activity = supplied + sourced
    balance = 1 - abs(supplied - sourced) / max(activity, 1)
    vendor.network_score = round((activity * 5) + (balance * 50) + float(vendor.parasitism_index or 0.0), 2)
    vendor.total_supplied = supplied
    vendor.total_sourced = sourced


async def update_all_vendor_scores(vendor_id: UUID, db: AsyncSession) -> None:
    """Recompute every connection a vendor has, then their index and network
    score. Used after a deal settles and by the nightly sweep."""
    vendor = await db.get(Vendor, vendor_id)
    if not vendor:
        return
    rows = (await db.execute(select(vendor_connections).where(
        or_(vendor_connections.c.vendor_a_id == vendor_id, vendor_connections.c.vendor_b_id == vendor_id)
    ))).all()
    total = 0.0
    for conn in rows:
        other_id = conn.vendor_b_id if conn.vendor_a_id == vendor_id else conn.vendor_a_id
        score = await recalculate_parasitism(vendor_id, other_id, db)
        total += score
        await db.execute(
            update(vendor_connections)
            .where(vendor_connections.c.vendor_a_id == conn.vendor_a_id,
                   vendor_connections.c.vendor_b_id == conn.vendor_b_id)
            .values(parasitism_score=score)
        )
    vendor.parasitism_index = round(total / len(rows), 2) if rows else 0.0
    await update_vendor_network_score(vendor_id, db)

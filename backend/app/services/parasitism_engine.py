"""
Vendor Mutual Parasitism Engine

The core concept: vendors benefit from each other's businesses.
- A textile vendor sources from a cotton vendor → cotton vendor benefits
- The textile vendor sells to a fashion vendor → fashion vendor benefits
- The fashion vendor's popup shop needs a transport vendor → transport vendor benefits
- The transport vendor buys fuel from... and so on.

This engine tracks and scores these mutual benefit relationships. Only movements
that reached `received` count: a reservation is a promise, not a benefit.
"""

from uuid import UUID

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import MovementStatus, StockMovement
from app.models.vendor import Vendor, vendor_connections


async def _flow(db: AsyncSession, src: UUID, dst: UUID) -> tuple[int, float]:
    """(count, total value) of received movements src → dst."""
    row = (await db.execute(
        select(func.count(StockMovement.id), func.coalesce(func.sum(StockMovement.total_value), 0.0)).where(
            StockMovement.from_vendor_id == src,
            StockMovement.to_vendor_id == dst,
            StockMovement.status == MovementStatus.RECEIVED.value,
        )
    )).one()
    return int(row[0] or 0), float(row[1] or 0.0)


async def calculate_parasitism_score(vendor_a_id: UUID, vendor_b_id: UUID, db: AsyncSession) -> float:
    """
    Calculate mutual benefit score between two vendors.
    Higher score = more mutually beneficial relationship.
    """
    a_to_b_count, a_to_b_val = await _flow(db, vendor_a_id, vendor_b_id)
    b_to_a_count, b_to_a_val = await _flow(db, vendor_b_id, vendor_a_id)

    # Score formula:
    # - Bidirectional deals count more (true parasitism)
    # - Balanced value flow scores higher
    total_deals = a_to_b_count + b_to_a_count
    if total_deals == 0:
        return 0.0

    bidirectional_bonus = min(a_to_b_count, b_to_a_count) * 2
    total_value = a_to_b_val + b_to_a_val

    # Balance ratio (1.0 = perfectly balanced, 0 = one-sided)
    balance = 1 - abs(a_to_b_val - b_to_a_val) / total_value if total_value > 0 else 0

    score = (total_deals * 10) + (bidirectional_bonus * 25) + (balance * 50)
    return round(score, 2)


async def update_vendor_network_score(vendor_id: UUID, db: AsyncSession) -> None:
    """Update a vendor's overall network score. Caller commits."""
    vendor = await db.get(Vendor, vendor_id)
    if not vendor:
        return

    supplied_count = (await db.execute(
        select(func.count(StockMovement.id)).where(
            StockMovement.from_vendor_id == vendor_id,
            StockMovement.status == MovementStatus.RECEIVED.value,
        )
    )).scalar() or 0
    sourced_count = (await db.execute(
        select(func.count(StockMovement.id)).where(
            StockMovement.to_vendor_id == vendor_id,
            StockMovement.status == MovementStatus.RECEIVED.value,
        )
    )).scalar() or 0

    # Network score = activity + balance between sourcing and supplying
    activity = supplied_count + sourced_count
    role_balance = 1 - abs(supplied_count - sourced_count) / activity if activity > 0 else 0

    vendor.network_score = round((activity * 5) + (role_balance * 100), 2)
    vendor.total_supplied = supplied_count
    vendor.total_sourced = sourced_count


async def update_connection_score(vendor_a_id: UUID, vendor_b_id: UUID, db: AsyncSession) -> float:
    """Recompute the pair score, store it on the connection row (creating the
    connection if trade happened before anyone pressed Connect), and refresh
    both vendors' parasitism index. Caller commits."""
    score = await calculate_parasitism_score(vendor_a_id, vendor_b_id, db)

    pair = or_(
        and_(vendor_connections.c.vendor_a_id == vendor_a_id, vendor_connections.c.vendor_b_id == vendor_b_id),
        and_(vendor_connections.c.vendor_a_id == vendor_b_id, vendor_connections.c.vendor_b_id == vendor_a_id),
    )
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

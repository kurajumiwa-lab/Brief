"""
Vendor Network — who is connected to whom, and who should be.

Suggestions are complementary, not similar: the vendors worth meeting are the
ones whose stock matches what you source, or who source what you stock.
"""

from uuid import UUID

from sqlalchemy import Text, and_, func, or_, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockItem
from app.models.vendor import Vendor, VendorProfile, vendor_connections


async def list_connections(db: AsyncSession, vendor_id: UUID) -> list[dict]:
    """Every vendor connected to `vendor_id`, with the pair's parasitism score."""
    vc = vendor_connections
    rows = (await db.execute(
        select(vc.c.vendor_a_id, vc.c.vendor_b_id, vc.c.connection_type, vc.c.parasitism_score, vc.c.created_at)
        .where(or_(vc.c.vendor_a_id == vendor_id, vc.c.vendor_b_id == vendor_id))
    )).all()
    if not rows:
        return []
    other_ids = [r.vendor_b_id if r.vendor_a_id == vendor_id else r.vendor_a_id for r in rows]
    vendors = {v.id: v for v in (await db.execute(select(Vendor).where(Vendor.id.in_(other_ids)))).scalars()}
    out = []
    for r in rows:
        oid = r.vendor_b_id if r.vendor_a_id == vendor_id else r.vendor_a_id
        v = vendors.get(oid)
        if not v:
            continue
        out.append({
            "vendor_id": str(v.id),
            "vendor_handle": v.vendor_handle,
            "business_name": v.business_name,
            "business_categories": v.business_categories or [],
            "current_role": v.current_role.value,
            "connection_type": r.connection_type,
            "parasitism_score": float(r.parasitism_score or 0.0),
            "connected_at": r.created_at.isoformat() if r.created_at else None,
        })
    out.sort(key=lambda c: -c["parasitism_score"])
    return out


async def are_connected(db: AsyncSession, a: UUID, b: UUID) -> bool:
    vc = vendor_connections
    row = (await db.execute(select(vc.c.vendor_a_id).where(or_(
        and_(vc.c.vendor_a_id == a, vc.c.vendor_b_id == b),
        and_(vc.c.vendor_a_id == b, vc.c.vendor_b_id == a),
    )))).first()
    return row is not None


async def suggest_vendors(db: AsyncSession, vendor: Vendor, limit: int = 10) -> list[dict]:
    """Vendors who stock what this vendor sources, or source what it stocks.
    Falls back to same-category neighbours when no profile interests exist."""
    profile = (await db.execute(select(VendorProfile).where(VendorProfile.vendor_id == vendor.id))).scalars().first()
    interests = [s.lower() for s in ((profile.sourcing_interests if profile else None) or [])]
    goods = [s.lower() for s in ((profile.primary_goods if profile else None) or [])]
    categories = [s.lower() for s in (vendor.business_categories or [])]

    connected = {c["vendor_id"] for c in await list_connections(db, vendor.id)}
    suggestions: dict[UUID, dict] = {}

    def add(v: Vendor, reason: str) -> None:
        if v.id == vendor.id or str(v.id) in connected:
            return
        entry = suggestions.setdefault(v.id, {
            "vendor_id": str(v.id), "vendor_handle": v.vendor_handle, "business_name": v.business_name,
            "business_categories": v.business_categories or [], "current_role": v.current_role.value,
            "network_score": v.network_score, "reasons": [],
        })
        if reason not in entry["reasons"]:
            entry["reasons"].append(reason)

    # They stock what I source.
    if interests:
        q = (select(Vendor, StockItem.category)
             .join(StockItem, StockItem.vendor_id == Vendor.id)
             .where(StockItem.visible_to_network.is_(True), StockItem.quantity_available > 0,
                    func.lower(StockItem.category).in_(interests))
             .limit(limit * 3))
        for v, cat in (await db.execute(q)).all():
            add(v, f"stocks {cat}, which you source")

    # They source what I stock.
    if goods:
        q = (select(Vendor, VendorProfile.sourcing_interests)
             .join(VendorProfile, VendorProfile.vendor_id == Vendor.id)
             .limit(limit * 6))
        for v, wants in (await db.execute(q)).all():
            overlap = sorted(set(goods) & {w.lower() for w in (wants or [])})
            if overlap:
                add(v, f"sources {overlap[0]}, which you stock")

    # Same trade, nearby in the graph.
    if categories and len(suggestions) < limit:
        q = (select(Vendor)
             .where(Vendor.business_categories.has_any(array(categories, type_=Text)))
             .order_by(Vendor.network_score.desc())
             .limit(limit * 2))
        for v in (await db.execute(q)).scalars():
            add(v, "same trade")

    ranked = sorted(suggestions.values(), key=lambda s: (-len(s["reasons"]), -s["network_score"]))
    return ranked[:limit]


async def network_graph(db: AsyncSession, vendor_id: UUID, depth: int = 2, cap: int = 60) -> dict:
    """The connection graph around a vendor, for the parasitism map."""
    vc = vendor_connections
    seen: set[UUID] = {vendor_id}
    frontier: set[UUID] = {vendor_id}
    edges: list[dict] = []
    for _ in range(depth):
        if not frontier or len(seen) >= cap:
            break
        rows = (await db.execute(
            select(vc.c.vendor_a_id, vc.c.vendor_b_id, vc.c.parasitism_score)
            .where(or_(vc.c.vendor_a_id.in_(frontier), vc.c.vendor_b_id.in_(frontier)))
        )).all()
        nxt: set[UUID] = set()
        for a, b, score in rows:
            edges.append({"source": str(a), "target": str(b), "score": float(score or 0.0)})
            for x in (a, b):
                if x not in seen and len(seen) < cap:
                    seen.add(x)
                    nxt.add(x)
        frontier = nxt
    vendors = (await db.execute(select(Vendor).where(Vendor.id.in_(seen)))).scalars().all()
    nodes = [{
        "id": str(v.id), "handle": v.vendor_handle, "business_name": v.business_name,
        "role": v.current_role.value, "network_score": v.network_score,
        "parasitism_index": v.parasitism_index, "is_me": v.id == vendor_id,
    } for v in vendors]
    # De-duplicate edges (a pair may be picked up from both frontiers).
    uniq = {tuple(sorted((e["source"], e["target"]))): e for e in edges}
    return {"nodes": nodes, "edges": list(uniq.values())}

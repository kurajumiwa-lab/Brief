"""
Vendor Discovery (Directive v2.1 §4.5) — who a vendor should meet next, and why.

The algorithm is deliberately explainable. Every candidate gets a 0-100 score
made of six named factors, and each factor that fired contributes a human
sentence to `reasons`. Nothing is a black box: a vendor can read why a name
was put in front of them, and an operator can see which factor drove a match.

    complementarity  25  they stock / trade what I source
    reciprocity      20  they source what I stock
    trade_evidence   20  live, verified, available stock in my categories
    proximity        15  geographic closeness (geo columns, else location text)
    graph            10  second-degree connection, shared group or vendor list
    reputation       10  network score, fulfilment rate, verification

Connected vendors are excluded by default — discovery is for the unmet half of
the network. `include_connected=True` re-admits them (used by the profile page
to explain an existing relationship).
"""

import math
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.groups import GroupMembership
from app.models.stock import QualityStatus, StockItem
from app.models.vendor import Vendor, VendorProfile, vendor_connections
from app.models.vendor_list import VendorListMembership
from app.services.stock_engine import fulfillment_rate

WEIGHTS = {
    "complementarity": 25,
    "reciprocity": 20,
    "trade_evidence": 20,
    "proximity": 15,
    "graph": 10,
    "reputation": 10,
}

CANDIDATE_POOL = 300  # score at most this many vendors per call


def _tokens(text: Optional[str]) -> set[str]:
    return {t for t in (text or "").lower().replace(",", " ").split() if len(t) > 2}


def _haversine_km(lat1, lng1, lat2, lng2) -> Optional[float]:
    if None in (lat1, lng1, lat2, lng2):
        return None
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(a)), 2)


async def _my_context(db: AsyncSession, vendor: Vendor) -> dict:
    """Everything about the viewer the scorer needs — four small queries."""
    profile = (await db.execute(
        select(VendorProfile).where(VendorProfile.vendor_id == vendor.id)
    )).scalars().first()

    my_stock_categories = {
        c for (c,) in (await db.execute(
            select(func.distinct(StockItem.category)).where(
                StockItem.vendor_id == vendor.id, StockItem.category.isnot(None),
            )
        )).all()
    }

    my_group_ids = {
        g for (g,) in (await db.execute(
            select(GroupMembership.group_id).where(GroupMembership.vendor_id == vendor.id)
        )).all()
    }
    my_list_ids = {
        l for (l,) in (await db.execute(
            select(VendorListMembership.vendor_list_id).where(
                VendorListMembership.vendor_id == vendor.id,
                VendorListMembership.status == "approved",
            )
        )).all()
    }

    vc = vendor_connections
    first_degree = {
        (b if a == vendor.id else a) for a, b in (await db.execute(
            select(vc.c.vendor_a_id, vc.c.vendor_b_id).where(
                or_(vc.c.vendor_a_id == vendor.id, vc.c.vendor_b_id == vendor.id)
            )
        )).all()
    }
    second_degree: set[UUID] = set()
    if first_degree:
        second_degree = {
            (b if a in first_degree else a) for a, b in (await db.execute(
                select(vc.c.vendor_a_id, vc.c.vendor_b_id).where(
                    or_(vc.c.vendor_a_id.in_(first_degree), vc.c.vendor_b_id.in_(first_degree))
                )
            )).all()
        } - first_degree - {vendor.id}

    return {
        "wants": {s.lower() for s in ((profile.sourcing_interests if profile else None) or [])},
        "goods": {s.lower() for s in ((profile.primary_goods if profile else None) or [])},
        "regions": {s.lower() for s in ((profile.preferred_regions if profile else None) or [])},
        "stock_categories": {c.lower() for c in my_stock_categories},
        "categories": {c.lower() for c in (vendor.business_categories or [])},
        "groups": my_group_ids,
        "lists": my_list_ids,
        "first_degree": first_degree,
        "second_degree": second_degree,
        "location_tokens": _tokens(vendor.physical_location),
        "lat": vendor.geo_lat,
        "lng": vendor.geo_lng,
    }


async def discover(
    db: AsyncSession,
    vendor: Vendor,
    limit: int = 12,
    category: Optional[str] = None,
    location: Optional[str] = None,
    role: Optional[str] = None,
    min_score: float = 0.0,
    include_connected: bool = False,
    explain: bool = True,
) -> list[dict]:
    """Score and rank vendors for `vendor`. Returns plain dicts ready for JSON."""
    ctx = await _my_context(db, vendor)

    query = select(Vendor).where(Vendor.id != vendor.id, Vendor.current_role != "dormant")
    if category:
        query = query.where(Vendor.business_categories.contains([category]))
    if location:
        query = query.where(Vendor.physical_location.ilike(f"%{location}%"))
    if role:
        query = query.where(Vendor.current_role == role)
    candidates = (await db.execute(
        query.order_by(Vendor.network_score.desc(), Vendor.joined_at.desc()).limit(CANDIDATE_POOL)
    )).scalars().all()
    if include_connected is False:
        candidates = [c for c in candidates if c.id not in ctx["first_degree"]]
    if not candidates:
        return []

    ids = [c.id for c in candidates]

    # What each candidate has on the shelf right now (visible, available).
    stock_rows = (await db.execute(
        select(
            StockItem.vendor_id,
            StockItem.category,
            func.count(StockItem.id),
            func.coalesce(func.sum(StockItem.quantity_available), 0),
            func.sum(case((StockItem.quality_status != QualityStatus.UNVERIFIED, 1), else_=0)),
        )
        .where(StockItem.vendor_id.in_(ids), StockItem.visible_to_network.is_(True),
               StockItem.quantity_available > 0)
        .group_by(StockItem.vendor_id, StockItem.category)
    )).all()
    stock: dict[UUID, dict] = {}
    for vid, cat, lines, units, verified in stock_rows:
        entry = stock.setdefault(vid, {"categories": set(), "lines": 0, "units": 0, "verified": 0})
        entry["lines"] += int(lines or 0)
        entry["units"] += int(units or 0)
        entry["verified"] += int(verified or 0)
        if cat:
            entry["categories"].add(cat.lower())

    profile_rows = (await db.execute(
        select(VendorProfile).where(VendorProfile.vendor_id.in_(ids))
    )).scalars().all()
    profiles = {p.vendor_id: p for p in profile_rows}

    group_rows = (await db.execute(
        select(GroupMembership.vendor_id, GroupMembership.group_id).where(GroupMembership.vendor_id.in_(ids))
    )).all()
    shared_groups: dict[UUID, set] = {}
    for vid, gid in group_rows:
        if gid in ctx["groups"]:
            shared_groups.setdefault(vid, set()).add(gid)

    list_rows = (await db.execute(
        select(VendorListMembership.vendor_id, VendorListMembership.vendor_list_id).where(
            VendorListMembership.vendor_id.in_(ids), VendorListMembership.status == "approved",
        )
    )).all()
    shared_lists: dict[UUID, set] = {}
    for vid, lid in list_rows:
        if lid in ctx["lists"]:
            shared_lists.setdefault(vid, set()).add(lid)

    results = []
    for c in candidates:
        profile = profiles.get(c.id)
        their_wants = {s.lower() for s in ((profile.sourcing_interests if profile else None) or [])}
        their_goods = {s.lower() for s in ((profile.primary_goods if profile else None) or [])}
        their_categories = {s.lower() for s in (c.business_categories or [])}
        shelf = stock.get(c.id, {"categories": set(), "lines": 0, "units": 0, "verified": 0})

        factors: dict[str, float] = {}
        reasons: list[str] = []

        # 1. complementarity — they stock what I source
        match = (their_categories | shelf["categories"]) & ctx["wants"]
        cat_match = their_categories & ctx["categories"]
        if match:
            factors["complementarity"] = WEIGHTS["complementarity"]
            reasons.append(f"stocks {', '.join(sorted(match)[:3])}, which you source")
        elif cat_match:
            factors["complementarity"] = WEIGHTS["complementarity"] * 0.6
            reasons.append(f"trades in your categories ({', '.join(sorted(cat_match)[:2])})")
        else:
            factors["complementarity"] = 0.0

        # 2. reciprocity — they source what I stock
        overlap = their_wants & (ctx["goods"] | ctx["stock_categories"] | ctx["categories"])
        if overlap:
            factors["reciprocity"] = WEIGHTS["reciprocity"]
            reasons.append(f"sources {', '.join(sorted(overlap)[:3])}, which you stock")
        else:
            factors["reciprocity"] = 0.0

        # 3. trade_evidence — a real, visible shelf in the categories that matter
        # (a full shelf of something you will never trade is not evidence).
        relevant = shelf["categories"] & (ctx["wants"] | ctx["categories"])
        if shelf["lines"] and relevant:
            depth = min(shelf["lines"], 20) / 20
            units = min(shelf["units"], 500) / 500
            verified = min(shelf["verified"], 5) / 5
            factors["trade_evidence"] = round(
                WEIGHTS["trade_evidence"] * (0.45 * depth + 0.35 * units + 0.20 * verified), 1)
            reasons.append(f"{shelf['lines']} live line{'s' if shelf['lines'] != 1 else ''} "
                           f"({shelf['units']} units) offered to the network")
            if shelf["verified"]:
                reasons.append(f"{shelf['verified']} batch{'es' if shelf['verified'] != 1 else ''} with quality provenance")
        else:
            factors["trade_evidence"] = 0.0

        # 4. proximity — kilometres when both sides have coordinates, text otherwise
        distance = _haversine_km(ctx["lat"], ctx["lng"], c.geo_lat, c.geo_lng)
        if distance is not None:
            if distance <= 10:
                factors["proximity"] = WEIGHTS["proximity"]
            elif distance <= 30:
                factors["proximity"] = WEIGHTS["proximity"] * 0.75
            elif distance <= 75:
                factors["proximity"] = WEIGHTS["proximity"] * 0.5
            elif distance <= 200:
                factors["proximity"] = WEIGHTS["proximity"] * 0.25
            else:
                factors["proximity"] = 0.0
            if factors["proximity"]:
                reasons.append(f"{distance:g} km away")
        else:
            shared = _tokens(c.physical_location) & ctx["location_tokens"]
            factors["proximity"] = WEIGHTS["proximity"] * 0.5 if shared else 0.0
            if shared:
                reasons.append(f"same area ({c.physical_location})")

        # 5. graph — people your people know, or shared rooms
        if c.id in ctx["second_degree"]:
            factors["graph"] = WEIGHTS["graph"]
            reasons.append("trades with vendors you already trade with")
        elif c.id in shared_groups or c.id in shared_lists:
            factors["graph"] = WEIGHTS["graph"] * 0.7
            where = []
            if c.id in shared_groups:
                where.append("a group")
            if c.id in shared_lists:
                where.append("a vendor list")
            reasons.append(f"you share {' and '.join(where)}")
        else:
            factors["graph"] = 0.0

        # 6. reputation — activity plus reliability, never raw popularity alone
        score_part = min(float(c.network_score or 0), 100) / 100
        rate = fulfillment_rate(c)
        reliability = (rate / 100) if rate is not None else 0.5
        verified = 0.15 if c.is_verified else 0.0
        patron = 0.10 if c.is_patron else 0.0
        factors["reputation"] = round(
            WEIGHTS["reputation"] * min(1.0, 0.45 * score_part + 0.35 * reliability + verified + patron), 1)
        if patron:
            reasons.append("runs a vendor list (patron)")
        elif c.is_verified:
            reasons.append("verified business")

        total = round(sum(factors.values()), 1)
        if total < min_score:
            continue
        if not reasons:
            reasons.append("active in the network")

        results.append({
            "vendor_id": str(c.id),
            "vendor_handle": c.vendor_handle,
            "business_name": c.business_name,
            "business_categories": c.business_categories or [],
            "current_role": c.current_role.value,
            "physical_location": c.physical_location,
            "network_score": c.network_score,
            "parasitism_index": c.parasitism_index,
            "fulfillment_rate": rate,
            "movements_completed": int(getattr(c, "movements_completed", 0) or 0),
            "is_patron": c.is_patron,
            "is_verified": c.is_verified,
            "has_pos_connected": c.has_pos_connected,
            "distance_km": distance,
            "connected": c.id in ctx["first_degree"],
            "score": total,
            "factors": factors if explain else None,
            "reasons": reasons if explain else [],
        })

    results.sort(key=lambda r: (-r["score"], -(r["network_score"] or 0)))
    return results[:limit]


def factor_weights() -> dict:
    """Exposed so the UI can explain the scoring without hardcoding it."""
    return dict(WEIGHTS)

"""
Patron Service — the tiers written on `PatronTier`, enforced.

  STARTER      1 list,  up to 20 vendors per list
  ESTABLISHED  5 lists, up to 100 vendors per list
  MOGUL        unlimited lists, arranges events

Tiers are earned by what a patron has actually done: vendors approved onto
their lists and events organised for them.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.models.vendor_list import Patron, PatronTier, VendorList, VendorListMembership

TIER_LIMITS: dict[PatronTier, dict[str, Optional[int]]] = {
    PatronTier.STARTER: {"max_lists": 1, "max_vendors_per_list": 20},
    PatronTier.ESTABLISHED: {"max_lists": 5, "max_vendors_per_list": 100},
    PatronTier.MOGUL: {"max_lists": None, "max_vendors_per_list": None},
    PatronTier.LEGEND: {"max_lists": None, "max_vendors_per_list": None},
}

# Progression criteria (Directive v2.1 §5.1). A tier is earned, never taken back.
TIER_REQUIREMENTS: dict[PatronTier, dict[str, float]] = {
    PatronTier.ESTABLISHED: {"min_vendors_managed": 20, "min_events_organized": 3, "min_reputation": 50},
    PatronTier.MOGUL: {"min_vendors_managed": 100, "min_events_organized": 10, "min_reputation": 80},
    PatronTier.LEGEND: {"min_vendors_managed": 500, "min_events_organized": 25, "min_reputation": 95},
}
TIER_ORDER = [PatronTier.STARTER, PatronTier.ESTABLISHED, PatronTier.MOGUL, PatronTier.LEGEND]


class PatronError(Exception):
    def __init__(self, message: str, status_code: int = 403):
        super().__init__(message)
        self.status_code = status_code


async def get_patron(db: AsyncSession, vendor: Vendor) -> Optional[Patron]:
    return (await db.execute(select(Patron).where(Patron.vendor_id == vendor.id))).scalars().first()


async def require_patron(db: AsyncSession, vendor: Vendor) -> Patron:
    patron = await get_patron(db, vendor)
    if not vendor.is_patron or patron is None:
        raise PatronError("Must be a patron to do this. POST /api/vendors/become-patron first.")
    return patron


async def become_patron(db: AsyncSession, vendor: Vendor) -> Patron:
    if vendor.is_patron and await get_patron(db, vendor):
        raise PatronError("Already a patron", 400)
    patron = Patron(vendor_id=vendor.id, tier=PatronTier.STARTER,
                    specialization=list(vendor.business_categories or []))
    vendor.is_patron = True
    db.add(patron)
    return patron


def effective_max_vendors(patron: Patron, requested: int) -> int:
    cap = TIER_LIMITS[patron.tier]["max_vendors_per_list"]
    return requested if cap is None else min(requested, cap)


async def assert_can_create_list(db: AsyncSession, patron: Patron) -> None:
    cap = TIER_LIMITS[patron.tier]["max_lists"]
    if cap is None:
        return
    count = (await db.execute(
        select(func.count(VendorList.id)).where(VendorList.patron_id == patron.id)
    )).scalar() or 0
    if count >= cap:
        raise PatronError(
            f"{patron.tier.value} patrons can run {cap} list{'s' if cap != 1 else ''}. "
            "Approve more vendors to reach the next tier."
        )


async def record_approval(db: AsyncSession, patron: Patron) -> None:
    """Called when a vendor is approved onto one of the patron's lists."""
    patron.total_vendors_managed = (await db.execute(
        select(func.count(VendorListMembership.id))
        .join(VendorList, VendorList.id == VendorListMembership.vendor_list_id)
        .where(VendorList.patron_id == patron.id, VendorListMembership.status == "approved")
    )).scalar() or 0
    await check_patron_promotion(patron.id, db, patron=patron)


def compute_reputation(patron: Patron) -> float:
    """0-100. Vendors managed and events organised, weighted toward events:
    20 vendors + 3 events ≈ 50 (Established), 100 vendors + 10 events ≈ 80
    (Mogul), 500 vendors + 25 events → 100."""
    managed = patron.total_vendors_managed or 0
    events = patron.total_events_organized or 0
    return round(min(100.0, managed * 1.0 + events * 10.0), 2)


def recompute_tier(patron: Patron) -> Optional[PatronTier]:
    """Promotion only; a tier is not taken back. Returns the new tier when one
    was earned (callers notify), else None."""
    patron.reputation_score = compute_reputation(patron)
    current_idx = TIER_ORDER.index(patron.tier) if patron.tier in TIER_ORDER else 0
    promoted = None
    for next_tier in TIER_ORDER[current_idx + 1:]:
        reqs = TIER_REQUIREMENTS[next_tier]
        if (
            (patron.total_vendors_managed or 0) >= reqs["min_vendors_managed"]
            and (patron.total_events_organized or 0) >= reqs["min_events_organized"]
            and (patron.reputation_score or 0) >= reqs["min_reputation"]
        ):
            patron.tier = next_tier
            promoted = next_tier
        else:
            break
    return promoted


async def check_patron_promotion(patron_id: UUID, db: AsyncSession, patron: Optional[Patron] = None) -> Optional[PatronTier]:
    """Check whether a patron qualifies for the next tier; promote and notify.
    Caller commits."""
    patron = patron or await db.get(Patron, patron_id)
    if not patron:
        return None
    promoted = recompute_tier(patron)
    if promoted:
        from app.models.notification import NotificationType
        from app.services.notification_service import create_notification

        await create_notification(
            db, patron.vendor_id, NotificationType.PATRON_PROMOTION,
            f"🎉 Promoted to {promoted.value.title()} Patron!",
            "Your vendor community contributions have earned you a new tier.",
            data={"tier": promoted.value, **{k: v for k, v in TIER_LIMITS[promoted].items()}},
        )
    return promoted


async def patron_for_list(db: AsyncSession, vlist: VendorList) -> Optional[Patron]:
    if not vlist.patron_id:
        return None
    return await db.get(Patron, vlist.patron_id)


def limits_for(patron: Patron) -> dict:
    return {"tier": patron.tier.value, **TIER_LIMITS[patron.tier]}


async def owns_list(db: AsyncSession, vendor: Vendor, vlist: VendorList) -> bool:
    patron = await get_patron(db, vendor)
    return bool(patron and vlist.patron_id == patron.id)

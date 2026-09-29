"""
Patron Service — the tiers written on `PatronTier`, enforced.

  STARTER      1 list,  up to 20 vendors per list
  ESTABLISHED  5 lists, up to 100 vendors per list
  MOGUL        unlimited lists, arranges events

Tiers are earned by what a patron has actually done: vendors approved onto
their lists and events organised for them.
"""

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.models.vendor_list import Patron, PatronTier, VendorList, VendorListMembership

TIER_LIMITS: dict[PatronTier, dict[str, Optional[int]]] = {
    PatronTier.STARTER: {"max_lists": 1, "max_vendors_per_list": 20},
    PatronTier.ESTABLISHED: {"max_lists": 5, "max_vendors_per_list": 100},
    PatronTier.MOGUL: {"max_lists": None, "max_vendors_per_list": None},
}


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
    recompute_tier(patron)


def recompute_tier(patron: Patron) -> None:
    """Promotion only; a tier is not taken back."""
    managed = patron.total_vendors_managed or 0
    events = patron.total_events_organized or 0
    if managed >= 100 and events >= 3:
        patron.tier = PatronTier.MOGUL
    elif managed >= 20 and patron.tier == PatronTier.STARTER:
        patron.tier = PatronTier.ESTABLISHED
    # Reputation: vendors managed plus events organised, weighted toward events.
    patron.reputation_score = round(managed * 1.0 + events * 10.0, 2)


async def patron_for_list(db: AsyncSession, vlist: VendorList) -> Optional[Patron]:
    if not vlist.patron_id:
        return None
    return await db.get(Patron, vlist.patron_id)


def limits_for(patron: Patron) -> dict:
    return {"tier": patron.tier.value, **TIER_LIMITS[patron.tier]}


async def owns_list(db: AsyncSession, vendor: Vendor, vlist: VendorList) -> bool:
    patron = await get_patron(db, vendor)
    return bool(patron and vlist.patron_id == patron.id)

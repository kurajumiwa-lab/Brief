"""The backend check. A locked feature returns 402, whatever the interface shows."""

from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.entitlements.models import FeatureEntitlement
from app.modules.entitlements.rules import (
    PLAN_TO_TIER, SEED_BY_KEY, TIER_RANK, TIER_TO_PLAN, TIERS,
)
from app.modules.growth.rules import PLAN_CATALOG
from app.routes.auth import get_current_vendor


def tier_for_vendor(vendor: Vendor) -> str:
    """The commercial tier this vendor is on right now.

    Read from the stored plan on every check, so a lapsed subscription (which the
    billing sweep moves back to ``starter``) drops the vendor to Free at once,
    and nothing they created is deleted.
    """
    plan = (getattr(vendor, "plan_tier", None) or "starter").strip().lower()
    return PLAN_TO_TIER.get(plan, "free")


def _row_or_seed(row: Optional[FeatureEntitlement], key: str) -> tuple[str, bool]:
    """(min_tier, enabled) from the table, or from the seed if the row is missing."""
    if row is not None:
        return row.min_tier, bool(row.enabled)
    seed = SEED_BY_KEY.get(key)
    return (seed[2] if seed else "business_pro"), True


async def _rows(db: AsyncSession) -> dict[str, FeatureEntitlement]:
    return {r.feature_key: r for r in (await db.execute(select(FeatureEntitlement))).scalars().all()}


async def status_for(db: AsyncSession, vendor: Vendor) -> list[dict]:
    """Every feature, with whether this vendor can use it right now."""
    rows = await _rows(db)
    tier = tier_for_vendor(vendor)
    out = []
    keys = list(SEED_BY_KEY) + [k for k in rows if k not in SEED_BY_KEY]
    for key in keys:
        min_tier, enabled = _row_or_seed(rows.get(key), key)
        label, desc, _ = SEED_BY_KEY.get(key, (key, "", min_tier))
        if key in rows:
            label, desc = rows[key].label, rows[key].description or desc
        unlocked = enabled and TIER_RANK[tier] >= TIER_RANK[min_tier]
        out.append({
            "key": key,
            "label": label,
            "description": desc,
            "min_tier": min_tier,
            "enabled": enabled,
            "unlocked": unlocked,
        })
    return out


async def check(db: AsyncSession, vendor: Vendor, key: str) -> None:
    """Raise 402 (locked) or 403 (switched off) unless this vendor may use ``key``."""
    row = (await db.execute(
        select(FeatureEntitlement).where(FeatureEntitlement.feature_key == key)
    )).scalar_one_or_none()
    min_tier, enabled = _row_or_seed(row, key)
    if not enabled:
        raise HTTPException(403, "This feature is temporarily unavailable.")
    tier = tier_for_vendor(vendor)
    if TIER_RANK[tier] < TIER_RANK[min_tier]:
        needed = PLAN_CATALOG[TIER_TO_PLAN[min_tier]].name
        raise HTTPException(
            402,
            detail={
                "message": f"This needs the {needed} plan.",
                "feature": key,
                "current_tier": tier,
                "required_tier": min_tier,
                "upgrade": True,
            },
        )


async def is_unlocked(db: AsyncSession, vendor: Vendor, key: str) -> bool:
    """Non-raising form of ``check`` for endpoints that return partial data."""
    try:
        await check(db, vendor, key)
        return True
    except HTTPException:
        return False


def require_feature(key: str):
    """FastAPI dependency: the signed-in vendor, only if they may use ``key``."""

    async def _dependency(
        vendor: Vendor = Depends(get_current_vendor),
        db: AsyncSession = Depends(get_db),
    ) -> Vendor:
        await check(db, vendor, key)
        return vendor

    _dependency.__name__ = f"require_{key}"
    return _dependency


def tier_catalogue() -> list[dict]:
    """The sellable tiers with prices, taken from the plan catalogue."""
    out = []
    for tier in TIERS:
        spec = PLAN_CATALOG[TIER_TO_PLAN[tier]]
        out.append({
            "tier": tier,
            "name": spec.name,
            "price_kes_monthly": spec.price_kes_monthly,
            "public": spec.public_offer,
        })
    return out

"""Feature entitlement endpoints.

    GET /api/entitlements/me                 the signed-in vendor's tier and feature list
    PUT /api/entitlements/admin/{feature}    operator: change a feature's tier or switch
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.entitlements import service
from app.modules.entitlements.models import FeatureEntitlement
from app.modules.entitlements.rules import TIERS
from app.routes.auth import get_current_vendor
from app.routes.ops import require_operator

router = APIRouter()


class FeatureUpdate(BaseModel):
    enabled: Optional[bool] = None
    min_tier: Optional[str] = Field(default=None, max_length=16)


@router.get("/me")
async def my_entitlements(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return {
        "tier": service.tier_for_vendor(vendor),
        "tiers": service.tier_catalogue(),
        "features": await service.status_for(db, vendor),
    }


@router.put("/admin/{feature_key}")
async def update_feature(
    feature_key: str,
    body: FeatureUpdate,
    operator: Vendor = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
):
    """Change which tier unlocks a feature, or switch it off, with no code change."""
    if body.min_tier is not None and body.min_tier not in TIERS:
        raise HTTPException(400, f"min_tier must be one of {', '.join(TIERS)}")
    row = (await db.execute(
        select(FeatureEntitlement).where(FeatureEntitlement.feature_key == feature_key)
    )).scalar_one_or_none()
    if row is None:
        seed = service.SEED_BY_KEY.get(feature_key)
        if seed is None:
            raise HTTPException(404, "Unknown feature")
        row = FeatureEntitlement(
            feature_key=feature_key, label=seed[0], description=seed[1], min_tier=seed[2], enabled=True,
        )
        db.add(row)
    if body.enabled is not None:
        row.enabled = body.enabled
    if body.min_tier is not None:
        row.min_tier = body.min_tier
    row.updated_at = datetime.utcnow()
    row.updated_by = operator.vendor_handle
    await db.commit()
    return {
        "feature": feature_key,
        "min_tier": row.min_tier,
        "enabled": row.enabled,
        "updated_by": row.updated_by,
    }

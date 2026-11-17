"""Corridor price hints.

Mounted at /api/corridors. Public read: a price range is market information,
not personal data, and the Create screen may ask before a member is signed in
on a slow connection. The response never contains seller identities.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.modules.price_index import service

router = APIRouter()


@router.get("/{region_slug}/price-hint")
async def price_hint(
    region_slug: str,
    category: str = Query(..., min_length=2, max_length=100),
    town: Optional[str] = Query(None, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    return await service.lookup_hint(db, region_slug, category, town)

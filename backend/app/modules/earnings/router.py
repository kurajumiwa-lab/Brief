"""My Opportunities & Earnings — HTTP surface.

    GET /api/earnings/me   the caller's own economic evidence (auth required)

Read-only by construction: this router has no other verb and no other route.
It holds nothing, pays nothing out, and asserts nothing about money — it
returns the evidence and the honest list of what cannot be measured yet.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.earnings import service
from app.routes.auth import get_current_vendor

router = APIRouter()


@router.get("/me")
async def my_earnings(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.build(db, vendor)

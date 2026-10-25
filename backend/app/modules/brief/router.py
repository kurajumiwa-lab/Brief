"""Morning Brief router (v2.15).

One read-only endpoint. It takes no parameters: the vendor comes from the token,
so there is no id to tamper with and no cross-tenant path to get wrong.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.brief.service import build_brief
from app.routes.auth import get_current_vendor

router = APIRouter()


@router.get("/morning")
async def morning_brief(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """What needs your attention today, every line traced to a record you own."""
    return await build_brief(db, vendor)

"""Professional profile card (Phase 5). Signed-in members only. 404 while PROFESSIONAL_PROFILE_ENABLED is off."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.professional_card import service
from app.routes.auth import get_current_vendor


def _enabled() -> None:
    if not settings.PROFESSIONAL_PROFILE_ENABLED:
        raise HTTPException(404, "Not found")


router = APIRouter(dependencies=[Depends(_enabled)])


@router.get("/page/{handle}")
async def public_page(handle: str, db: AsyncSession = Depends(get_db)):
    """The public Page (/page/:handle). No sign-in. Same data as the card, nothing private."""
    vid = (await db.execute(select(Vendor.id).where(Vendor.vendor_handle == handle.lstrip("@").lower()))).scalar_one_or_none()
    if vid is None:
        raise HTTPException(404, "Business not found")
    card = await service.card_for_vendor(db, vid)
    # The Page shows verified registrations only. Self-declared ones stay on the signed-in card.
    card["registrations"] = [r for r in card["registrations"] if r["status"] == "verified"]
    return card


@router.get("/{handle}")
async def professional_card(handle: str, _viewer: Vendor = Depends(get_current_vendor),
                            db: AsyncSession = Depends(get_db)):
    vid = (await db.execute(select(Vendor.id).where(Vendor.vendor_handle == handle.lstrip("@")))).scalar_one_or_none()
    if vid is None:
        raise HTTPException(404, "Business not found")
    return await service.card_for_vendor(db, vid)

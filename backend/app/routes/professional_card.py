"""Professional profile card (Phase 5). Signed-in members only. 404 while PROFESSIONAL_PROFILE_ENABLED is off."""

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.professional_card import page_settings, service, preset_content
from app.routes.auth import get_current_vendor


def _enabled() -> None:
    if not settings.PROFESSIONAL_PROFILE_ENABLED:
        raise HTTPException(404, "Not found")


router = APIRouter(dependencies=[Depends(_enabled)])


@router.get("/me/page")
async def my_page_settings(vendor: Vendor = Depends(get_current_vendor)):
    return {**page_settings.view(vendor.public_page), "display_name": vendor.business_name, "town": vendor.physical_location, "phone": vendor.phone}


@router.put("/me/page")
async def save_my_page_settings(body: page_settings.PageSettingsIn, vendor: Vendor = Depends(get_current_vendor),
                                db: AsyncSession = Depends(get_db)):
    """Owner only: the signed-in vendor edits their own Page. Nobody else can write it."""
    raw = {**page_settings.view(vendor.public_page), **body.model_dump(exclude_unset=True)}
    supplied = body.model_fields_set
    if "display_name" in supplied:
        name = (body.display_name or "").strip()
        if not name: raise HTTPException(422, "Display name cannot be blank")
        vendor.business_name = name
    if "town" in supplied:
        vendor.physical_location = (body.town or "").strip() or None
    if "phone" in supplied:
        phone = (body.phone or "").strip()
        if phone:
            if re.search(r"[^0-9+\s()\-]", phone) or phone.count("+") > 1 or ("+" in phone and not phone.startswith("+")):
                raise HTTPException(422, "Enter a valid Kenyan mobile number")
            digits = re.sub(r"\D", "", phone)
            if re.fullmatch(r"0[17]\d{8}", digits): digits = "254" + digits[1:]
            if not re.fullmatch(r"254[17]\d{8}", digits):
                raise HTTPException(422, "Enter a Kenyan mobile number beginning 07, 01 or +254")
            phone = "+" + digits
        else:
            phone = None
        if phone != vendor.phone:
            vendor.phone = phone
            vendor.phone_verified_at = None
    payment_type = raw.get("payment_type")
    payment_number = (raw.get("payment_number") or "").strip()
    account = (raw.get("payment_account") or "").strip()
    if payment_type and not re.fullmatch(r"[0-9]{4,20}", payment_number):
        raise HTTPException(422, "Enter a 4–20 digit Till or Paybill number")
    if not payment_type:
        raw["payment_number"] = raw["payment_account"] = None
    elif payment_type != "paybill":
        raw["payment_account"] = None
    elif re.search(r"[\x00-\x1f\x7f]", account):
        raise HTTPException(422, "Invalid payment account reference")
    vendor.public_page = page_settings.clean(raw)
    await db.commit()
    await db.refresh(vendor)
    return {**page_settings.view(vendor.public_page), "display_name": vendor.business_name, "town": vendor.physical_location, "phone": vendor.phone}


@router.get("/page/{handle}")
async def public_page(handle: str, db: AsyncSession = Depends(get_db)):
    """The public Page (/page/:handle). No sign-in. Same data as the card, nothing private."""
    vendor = (await db.execute(select(Vendor).where(Vendor.vendor_handle == handle.lstrip("@").lower()))).scalar_one_or_none()
    if vendor is None:
        from app.services.profile_handles import resolve_alias
        from fastapi.responses import RedirectResponse
        canonical = await resolve_alias(db, handle)
        if canonical:
            return RedirectResponse(f"/api/professional/page/{canonical}", status_code=301, headers={"Cache-Control": "no-store"})
        raise HTTPException(404, "Business not found")
    card = await service.card_for_vendor(db, vendor.id)
    # The Page shows verified registrations only. Self-declared ones stay on the signed-in card.
    card["registrations"] = [r for r in card["registrations"] if r["status"] == "verified"]
    card = page_settings.apply_public(card, vendor.public_page)
    # A phone number is public only after an explicit Page opt-in.
    card["whatsapp_phone"] = vendor.phone if (vendor.public_page or {}).get("show_whatsapp") else None
    page = page_settings.view(vendor.public_page)
    card["payment_tag"] = {"type": page["payment_type"], "number": page["payment_number"], "account": page["payment_account"]} if card["preset"] == "shop" and page["payment_type"] and page["payment_number"] else None
    card["preset_content"] = await preset_content.content(db, vendor, card["preset"], card["sections"].get("offers", True))
    return card


@router.get("/{handle}")
async def professional_card(handle: str, _viewer: Vendor = Depends(get_current_vendor),
                            db: AsyncSession = Depends(get_db)):
    vid = (await db.execute(select(Vendor.id).where(Vendor.vendor_handle == handle.lstrip("@")))).scalar_one_or_none()
    if vid is None:
        raise HTTPException(404, "Business not found")
    return await service.card_for_vendor(db, vid)

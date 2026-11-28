"""Minimal, public portfolio projection: never return account or private contact fields."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.vendor import Vendor, VendorProfile
from app.services.gallery_showcase import public_gallery_items, tag_counts
from app.services.work_showcase import public_work_items

router = APIRouter()


@router.get('/{handle}')
async def portfolio(handle: str, db: AsyncSession = Depends(get_db)):
    target = (await db.execute(select(Vendor).where(Vendor.vendor_handle == handle.lstrip('@').lower()))).scalar_one_or_none()
    if target is None:
        from app.services.profile_handles import resolve_alias
        canonical = await resolve_alias(db, handle)
        if canonical:
            return RedirectResponse(f'/api/profiles/{canonical}', status_code=301, headers={'Cache-Control': 'no-store'})
        raise HTTPException(404, 'Business not found')
    profile = (await db.execute(select(VendorProfile).where(VendorProfile.vendor_id == target.id))).scalar_one_or_none()
    cap = (profile.supply_capacity or {}) if profile else {}
    identity = cap.get('chat_identity') or {}
    gallery = public_gallery_items(profile) if profile else []
    from app.models.receipts import ReceiptMerchant
    from app.services.merchant_claims import status_label
    merchants = (await db.execute(select(ReceiptMerchant).where(
        ReceiptMerchant.claimed_by_vendor_id == target.id,
        ReceiptMerchant.claim_status.in_(("pending", "probationary", "verified", "contested")),
    ).order_by(ReceiptMerchant.created_at.desc()))).scalars().all()
    claims = [{"pin": m.pin, "name": m.name, "region": m.region,
               "claim_status": m.claim_status, "claim_status_label": status_label(m.claim_status),
               "probationary": m.claim_status == "probationary", "contested": m.claim_status == "contested",
               "verified": m.claim_status == "verified"} for m in merchants]
    # Deliberate allowlist. Do not expose email, raw phone, location coordinates,
    # private supply capacity, subscription/finance fields or other account data.
    return {
        'id': str(target.id), 'vendor_handle': target.vendor_handle, 'business_name': target.business_name,
        'business_description': target.business_description, 'business_categories': target.business_categories or [],
        'physical_location': target.physical_location, 'account_kind': target.account_kind,
        'is_verified': bool(target.is_verified), 'movements_completed': target.movements_completed or 0,
        'confirmed_trade_proofs': target.confirmed_trade_proofs or 0,
        'allow_direct_calls': bool(target.allow_direct_calls),
        'contact_phone': target.phone if target.allow_direct_calls else None,
        'logo_url': (profile.logo_url or identity.get('logo_url')) if profile else None,
        'banner_url': profile.banner_url if profile else None,
        'avatar_url': (cap.get('avatar_url') or identity.get('avatar_url')) if profile else None,
        'work_items': public_work_items(profile) if profile else [],
        'gallery_items': gallery, 'gallery_tags': tag_counts(gallery), 'claimed_merchants': claims,
    }

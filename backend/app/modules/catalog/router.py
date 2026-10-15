"""HTTP adapter for the storefront catalogue & enquiries (v2.14).

    GET  /api/catalog                 public catalogue: offers, tiers, trial, BYOD (no auth)
    POST /api/catalog/enquiries       purchase / trial / quotation enquiry (vendor auth)
    GET  /api/catalog/enquiries/mine  my enquiries
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.catalog import service
from app.routes.auth import get_current_vendor

router = APIRouter()


class EnquiryIn(BaseModel):
    kind: str = Field("purchase", max_length=24)
    offer_key: Optional[str] = Field(None, max_length=64)
    tier_key: Optional[str] = Field(None, max_length=24)
    organisation_name: Optional[str] = Field(None, max_length=200)
    contact_name: Optional[str] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=40)
    notes: Optional[str] = Field(None, max_length=2000)
    acknowledged_first_charge: bool = False


@router.get("")
async def get_catalogue():
    """Public storefront data. Reading the catalogue never requires an
    account; enquiring does (an enquiry attaches to a vendor @handle so a
    human can follow up, and trial disclosure is recorded against it)."""
    return service.catalogue_payload()


@router.post("/enquiries", status_code=201)
async def create_enquiry(body: EnquiryIn, vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    try:
        return await service.create_enquiry(
            db, vendor, kind=body.kind, offer_key=body.offer_key, tier_key=body.tier_key,
            organisation_name=body.organisation_name, contact_name=body.contact_name,
            contact_phone=body.contact_phone, notes=body.notes,
            acknowledged_first_charge=body.acknowledged_first_charge)
    except service.CatalogError as exc:
        raise HTTPException(exc.status, str(exc))


@router.get("/enquiries/mine")
async def list_my_enquiries(vendor: Vendor = Depends(get_current_vendor),
                            db: AsyncSession = Depends(get_db)):
    return await service.my_enquiries(db, vendor)

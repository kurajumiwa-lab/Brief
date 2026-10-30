"""HTTP adapter for the business desk (v2.14 catalogue, v2.15 desk).

    GET   /api/catalog                 public: desks, offers, tiers, trial, BYOD
    POST  /api/catalog/enquiries       purchase / quotation / pilot / requirements /
                                       interest / trial / discovery (vendor auth)
    GET   /api/catalog/enquiries/mine  my enquiries
    GET   /api/catalog/enquiries       operator inbox (market-ops roles only)
    PATCH /api/catalog/enquiries/{id}  move an enquiry through its status (ops only)

Reading the desk never requires an account. Enquiring does — a request attaches
to a vendor @handle so a human can answer it. Reviewing enquiries is operator
work and is gated on the same configured market-ops roles the rest of the
console uses; there is no self-granted admin flag.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.catalog import service
from app.routes.auth import get_current_vendor

router = APIRouter()


class EnquiryIn(BaseModel):
    kind: str = Field("purchase", max_length=24)
    offer_key: Optional[str] = Field(None, max_length=64)
    # Which of the five buying needs the customer came through. Optional: an
    # offer key always decides the desk, and a request with neither belongs to
    # "custom business solutions".
    desk_key: Optional[str] = Field(None, max_length=32)
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
            acknowledged_first_charge=body.acknowledged_first_charge,
            desk_key=body.desk_key)
    except service.CatalogError as exc:
        raise HTTPException(exc.status, str(exc))


@router.get("/enquiries/mine")
async def list_my_enquiries(vendor: Vendor = Depends(get_current_vendor),
                            db: AsyncSession = Depends(get_db)):
    return await service.my_enquiries(db, vendor)


class StatusIn(BaseModel):
    status: str = Field(..., max_length=24)


def _require_ops(vendor: Vendor) -> None:
    """Enquiry review is operator work, not a vendor self-service screen."""
    role = settings.market_ops_role(vendor.vendor_handle)
    if role not in ("admin", "clerk"):
        raise HTTPException(403, "Enquiries are reviewed by operations staff")


@router.get("/enquiries")
async def enquiry_inbox(
    status: Optional[str] = None,
    desk_key: Optional[str] = None,
    limit: int = 100,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Incoming business requests, newest first, grouped by desk.

    One list for the person who answers them — the enquiry is the lead, the
    offer's fixed scope is what gets quoted, and nothing here moves money.
    """
    _require_ops(vendor)
    try:
        return await service.inbox(db, status=status, desk_key=desk_key, limit=limit)
    except service.CatalogError as exc:
        raise HTTPException(exc.status, str(exc))


@router.patch("/enquiries/{enquiry_id}")
async def move_enquiry(
    enquiry_id: uuid.UUID,
    body: StatusIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    _require_ops(vendor)
    try:
        return await service.set_status(db, enquiry_id, status=body.status)
    except service.CatalogError as exc:
        raise HTTPException(exc.status, str(exc))

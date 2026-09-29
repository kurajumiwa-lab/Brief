"""
Stock verification uploads (Directive v2.1 §3.1).

    POST /api/stock/{stock_id}/verify   multipart: batch_number*, origin_country,
                                        expiry_date, lab_certified, spec_sheet (file)
                                        or spec_sheet_url (already uploaded)

The owner self-declares a batch — or, with a certificate attached and
`lab_certified=true`, marks it lab-certified. Patron verification lives on
`POST /api/stock/{id}/patron-verify` (stock router), because only a patron
can grant it.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.stock import QualityStatus, StockItem
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.routes.stock import _naive_utc, stock_out
from app.services.storage import StorageError, is_public_url, max_bytes, safe_filename, storage

router = APIRouter()


@router.post("/{stock_id}/verify")
async def verify_stock(
    stock_id: UUID,
    batch_number: str = Form(..., min_length=1, max_length=100),
    origin_country: Optional[str] = Form(None, max_length=100),
    expiry_date: Optional[str] = Form(None),
    lab_certified: bool = Form(False),
    spec_sheet_url: Optional[str] = Form(None, max_length=500),
    spec_sheet: Optional[UploadFile] = File(None),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Vendor self-declares quality or uploads verification docs."""
    item = await db.get(StockItem, stock_id)
    if not item or item.vendor_id != vendor.id:
        raise HTTPException(404, "Stock item not found")

    if spec_sheet is not None and spec_sheet.filename:
        try:
            _, content_type = safe_filename(spec_sheet.filename, spec_sheet.content_type)
        except StorageError as exc:
            raise HTTPException(400, str(exc))
        content = await spec_sheet.read(max_bytes() + 1)
        if len(content) > max_bytes():
            raise HTTPException(413, f"File is larger than {max_bytes() // (1024 * 1024)} MB")
        if content:
            try:
                item.spec_sheet_url = await storage.upload(content, spec_sheet.filename, content_type)
            except Exception as exc:
                raise HTTPException(503, f"Storage unavailable: {type(exc).__name__}")
    elif spec_sheet_url:
        if not is_public_url(spec_sheet_url):
            raise HTTPException(400, "spec_sheet_url must be an uploaded file URL or https link")
        item.spec_sheet_url = spec_sheet_url

    try:
        expiry = _naive_utc(expiry_date) if expiry_date else None
    except ValueError:
        raise HTTPException(400, "expiry_date must be an ISO date")

    item.batch_number = batch_number.strip()
    item.origin_country = (origin_country or "").strip() or None
    item.expiry_date = expiry
    if lab_certified:
        if not item.spec_sheet_url:
            raise HTTPException(400, "lab_certified needs a certificate: attach spec_sheet or spec_sheet_url")
        item.quality_status = QualityStatus.LAB_CERTIFIED
    else:
        item.quality_status = QualityStatus.SELF_DECLARED
    # A new declaration supersedes an earlier patron verification of another batch.
    item.verified_by_vendor_id = None
    item.verified_at = None
    item.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(item)
    return {
        "message": "Stock verified",
        "quality_status": item.quality_status.value,
        "spec_sheet_url": item.spec_sheet_url,
        "item": stock_out(item, vendor).model_dump(),
    }

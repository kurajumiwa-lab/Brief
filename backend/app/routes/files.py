"""
File uploads (Directive v2.1 §2.4).

    POST /api/files/upload   multipart `file`  → {url, filename, content_type, size}

Spec sheets, product photos and CSVs come through here; the returned `url`
is what goes into `StockItem.spec_sheet_url` or a chat attachment.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.storage import ALLOWED_TYPES, StorageError, max_bytes, safe_filename, storage

router = APIRouter()


@router.post("/upload", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    vendor: Vendor = Depends(get_current_vendor),
):
    try:
        _, content_type = safe_filename(file.filename or "", file.content_type)
    except StorageError as exc:
        raise HTTPException(400, str(exc))

    limit = max_bytes()
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File is larger than {limit // (1024 * 1024)} MB")
    if not data:
        raise HTTPException(400, "Empty file")

    try:
        url = await storage.upload(data, file.filename or "file", content_type)
    except StorageError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:  # bucket misconfiguration etc.
        raise HTTPException(503, f"Storage unavailable: {type(exc).__name__}")
    return {"url": url, "filename": file.filename, "content_type": content_type, "size": len(data)}


@router.get("/limits")
async def upload_limits(vendor: Vendor = Depends(get_current_vendor)):
    return {"max_mb": max_bytes() // (1024 * 1024), "allowed": sorted(ALLOWED_TYPES), "backend": storage.name}

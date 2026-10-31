"""
File uploads (Directive v2.1 §2.4).

    POST /api/files/upload   multipart `file`  → {url, filename, content_type, size}

Spec sheets, product photos and CSVs come through here; the returned `url`
is what goes into `StockItem.spec_sheet_url` or a chat attachment.
"""

from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.images import UnsupportedImage, prepare_image, supported as image_support
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
    # Read generously: a 5 MB phone photo is fine if it downscales under the cap,
    # and refusing it before trying is how a legitimate upload became a mystery
    # 413. Ten times the cap is the point where it is genuinely not a photo.
    data = await file.read(limit * 10 + 1)
    if len(data) > limit * 10:
        raise HTTPException(413, f"File is larger than {limit * 10 // (1024 * 1024)} MB")
    if not data:
        raise HTTPException(400, "Empty file")

    try:
        data, stored_name, content_type = prepare_image(
            data, file.filename or "file", content_type, max_bytes=limit
        )
    except UnsupportedImage as exc:
        raise HTTPException(400, str(exc))

    try:
        url = await storage.upload(data, stored_name, content_type)
    except StorageError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:  # bucket misconfiguration etc.
        raise HTTPException(503, f"Storage unavailable: {type(exc).__name__}")
    return {"url": url, "filename": file.filename, "content_type": content_type, "size": len(data)}


# One picker, twelve photographs, one request. The single-file endpoint above
# stays for every caller that uploads one thing; this is what a phone gallery
# selection actually looks like, and sending it twelve times costs twelve
# round trips on a connection that is often 3G.
MAX_BATCH_UPLOADS = 12


@router.post("/upload-many", status_code=201)
async def upload_many(
    files: List[UploadFile] = File(default=[]),
    vendor: Vendor = Depends(get_current_vendor),
):
    """Store up to twelve files, and say which ones failed and why.

    A batch is not transactional: ten good photographs and one unreadable HEIC
    must save the ten and name the one. Failing the request would throw away
    uploads the person already waited for, and — because the person is holding a
    phone in a shop — they would not try again.
    """
    uploads = [f for f in (files or []) if f is not None]
    if not uploads:
        raise HTTPException(400, "No files were sent")
    if len(uploads) > MAX_BATCH_UPLOADS:
        raise HTTPException(400, f"Up to {MAX_BATCH_UPLOADS} files at a time")

    stored = []
    rejected = []
    limit = max_bytes()

    for upload in uploads:
        name = upload.filename or "file"
        try:
            _, content_type = safe_filename(name, upload.content_type)
        except StorageError as exc:
            rejected.append({"filename": name, "reason": str(exc)})
            continue

        data = await upload.read(limit * 10 + 1)
        if len(data) > limit * 10:
            rejected.append({
                "filename": name,
                "reason": f"larger than {limit * 10 // (1024 * 1024)} MB",
            })
            continue
        if not data:
            rejected.append({"filename": name, "reason": "the file was empty"})
            continue

        try:
            data, stored_name, content_type = prepare_image(
                data, name, content_type, max_bytes=limit
            )
        except UnsupportedImage as exc:
            rejected.append({"filename": name, "reason": str(exc)})
            continue

        try:
            url = await storage.upload(data, stored_name, content_type)
        except StorageError as exc:
            rejected.append({"filename": name, "reason": str(exc)})
            continue
        except Exception as exc:
            rejected.append({"filename": name, "reason": f"storage unavailable ({type(exc).__name__})"})
            continue

        stored.append({
            "url": url,
            "filename": stored_name,
            "content_type": content_type,
            "size": len(data),
        })

    if not stored:
        detail = "; ".join(f"{r['filename']}: {r['reason']}" for r in rejected[:3])
        raise HTTPException(
            400,
            f"None of those files could be stored. {detail}" if detail else "No files were sent",
        )

    return {"files": stored, "count": len(stored), "rejected": rejected}


@router.get("/limits")
async def upload_limits(vendor: Vendor = Depends(get_current_vendor)):
    """What this deployment accepts, before the person picks anything.

    `images.heif` is the honest answer to "will my iPhone photo work here", asked
    before the upload instead of after it fails.
    """
    return {
        "max_mb": max_bytes() // (1024 * 1024),
        "allowed": sorted(ALLOWED_TYPES),
        "backend": storage.name,
        "images": image_support(),
        "batch_max": MAX_BATCH_UPLOADS,
    }

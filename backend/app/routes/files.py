"""
File uploads (Directive v2.1 §2.4).

    POST /api/files/upload   multipart `file`  → {url, filename, content_type, size}

Spec sheets, product photos and CSVs come through here; the returned `url`
is what goes into `StockItem.spec_sheet_url` or a chat attachment.
"""

from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.images import UnsupportedImage, prepare_image, supported as image_support
from app.services.storage import (
    ALLOWED_TYPES,
    MEDIA_KEY,
    StorageError,
    max_bytes,
    safe_filename,
    storage,
)

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


@router.get("/audit")
async def audit_media(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Which of *your* recorded photos this deployment cannot serve.

    Written for the recovery after the bug this thread exists for: a deploy wrote
    uploads into the function's ephemeral /tmp, so the records kept their URLs and
    the bytes were gone by the next request. Every affected card showed the
    designed placeholder, which is indistinguishable from "never had a photo" —
    so the seller had no way to find the affected listings except by opening all
    of them.

    This answers that in one request, from data the seller already owns: a list of
    named records whose file is not on this deployment and not in the media store.
    Nothing is repaired here — the file really is gone, and re-uploading is the
    only way to get the photograph back. The endpoint's job is to say *which*.

    Absolute http(s) URLs are counted but not checked: verifying a third party's
    host would mean fetching it on every audit, and a slow CDN is not the same
    problem as a lost file.
    """
    from sqlalchemy import select

    from app.models.stock import StockItem
    from app.models.tools import ToolListing
    from app.models.vendor import VendorProfile

    refs: list[dict] = []

    stock_rows = (await db.execute(
        select(StockItem.id, StockItem.name, StockItem.images).where(StockItem.vendor_id == vendor.id)
    )).all()
    for stock_id, name, images in stock_rows:
        for url in images or []:
            refs.append({"where": "stock", "id": str(stock_id), "label": name, "url": url})

    tool_rows = (await db.execute(
        select(ToolListing.id, ToolListing.title, ToolListing.images).where(ToolListing.vendor_id == vendor.id)
    )).all()
    for tool_id, title, images in tool_rows:
        for url in images or []:
            refs.append({"where": "equipment", "id": str(tool_id), "label": title, "url": url})

    profile = (await db.execute(
        select(VendorProfile).where(VendorProfile.vendor_id == vendor.id)
    )).scalar_one_or_none()
    if profile is not None:
        for field, label in (("logo_url", "Business logo"), ("banner_url", "Shop banner")):
            url = getattr(profile, field)
            if url:
                refs.append({"where": field.replace("_url", ""), "id": str(profile.id), "label": label, "url": url})
        for url in profile.portfolio_images or []:
            refs.append({"where": "gallery", "id": str(profile.id), "label": "Shop gallery", "url": url})
        for index, work in enumerate(profile.work_items or []):
            url = (work or {}).get("image_url") if isinstance(work, dict) else None
            if url:
                refs.append({
                    "where": "work",
                    "id": str(profile.id),
                    "label": (work.get("title") or f"Selected work {index + 1}"),
                    "url": url,
                })

    # Normalise to the key the file route would serve, so the check matches what
    # a browser actually asks for.
    keys: dict[str, str] = {}
    ours = 0
    external = 0
    for ref in refs:
        url = str(ref["url"] or "").strip()
        if not url:
            continue
        if url.startswith("/static/"):
            key = url.removeprefix("/static/")
        elif url.startswith("uploads/"):
            key = url
        elif "/uploads/" in url:
            # An absolute URL minted while another host was this app; its path is
            # still this deployment's own media route.
            key = url[url.index("/uploads/") + 1:]
        else:
            external += 1
            continue
        if MEDIA_KEY.match(key):
            keys[key] = url
            ref["key"] = key
            ours += 1
        else:
            external += 1

    present = await storage.available(list(keys))
    missing = [ref for ref in refs if ref.get("key") and ref["key"] not in present]

    return {
        "store": storage.name,
        "durable": storage.name in ("db", "s3"),
        "checked": ours,
        "external": external,
        "missing": missing,
        "missing_count": len(missing),
        "advice": (
            "Re-upload the photos listed in `missing` — the files are gone, not "
            "hidden. Everything uploaded from now on is stored durably."
            if missing
            else "Every recorded photo this deployment owns can be served."
        ),
    }


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

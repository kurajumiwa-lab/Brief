"""HTTP adapter for market intake.

    POST  /api/intake/batches              upload 1–12 photographs (or paste text)
    GET   /api/intake/batches              recent batches            (ops)
    GET   /api/intake/batches/{id}         one batch + its rows      (ops)
    PATCH /api/intake/observations/{id}    confirm / reject one row  (ops)
    GET   /api/market-data/summary         counts and price ranges   (signed in)
    GET   /api/market-data/observations    confirmed rows, redacted  (signed in)
    POST  /api/market-data/presences/{virtual_id}/claim   (the seller joins)

The upload accepts photographs *and* text in the same request. Text is not a
fallback bolt-on: it is the path that works on a server with no OCR engine
installed, and the path a clerk uses to correct a photograph by hand.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.intake import ocr, service
from app.modules.intake.service import IntakeError
from app.routes.auth import get_current_vendor
from app.services.images import UnsupportedImage, prepare_image
from app.services.storage import StorageError, storage

router = APIRouter()


def _handle(exc: IntakeError):
    raise HTTPException(exc.status, exc.message)


class DecisionIn(BaseModel):
    status: str


class TextBatchIn(BaseModel):
    text: str
    market: Optional[str] = None
    note: Optional[str] = None


@router.post("/intake/batches", status_code=201)
async def create_batch(
    files: List[UploadFile] = File(default=[]),
    text: Optional[str] = Form(None),
    market: Optional[str] = Form(None),
    note: Optional[str] = Form(None),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        service.require_ops(vendor)
    except IntakeError as exc:
        _handle(exc)

    uploads = [f for f in (files or []) if f is not None]
    if len(uploads) > service.MAX_IMAGES_PER_BATCH:
        raise HTTPException(
            400, f"Up to {service.MAX_IMAGES_PER_BATCH} photographs at a time"
        )
    if not uploads and not (text or "").strip():
        raise HTTPException(400, "Add photographs or paste the text")

    lines: list[str] = []
    urls: list[str] = []
    unreadable: list[dict] = []
    engine = None
    for upload in uploads:
        data = await upload.read()
        if not data:
            continue
        name = upload.filename or "intake.jpg"
        # The same normalisation the upload endpoint applies: an iPhone HEIC or
        # a 12-megapixel camera photo is turned into a bounded JPEG first. The
        # reader is 4× faster on a 2000 px image, and the stored evidence is a
        # file a browser can open months later.
        try:
            data, stored_name, content_type = prepare_image(
                data, name, upload.content_type or "image/jpeg"
            )
        except UnsupportedImage as exc:
            unreadable.append({"filename": name, "reason": str(exc)})
            continue
        try:
            urls.append(await storage.upload(data, stored_name, content_type))
        except StorageError as exc:
            raise HTTPException(503, str(exc))
        read = ocr.read_lines(data)
        if read:
            engine = ocr.engine_name()
            lines.extend(read)

    if (text or "").strip():
        lines.extend(text.splitlines())
        engine = engine or "text"

    if not urls and unreadable and not (text or "").strip():
        raise HTTPException(
            400,
            "None of those photographs could be read. "
            + "; ".join(f"{u['filename']}: {u['reason']}" for u in unreadable[:3]),
        )

    try:
        result = await service.create_batch(
            db,
            vendor=vendor,
            lines=lines,
            image_urls=urls,
            ocr_engine=engine,
            market=(market or None),
            note=(note or None),
            source="screenshots" if urls else "text",
        )
    except IntakeError as exc:
        _handle(exc)
    return result


@router.post("/intake/batches/text", status_code=201)
async def create_batch_from_text(
    payload: TextBatchIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The same intake with no photograph — paste what the sign says."""
    try:
        service.require_ops(vendor)
        return await service.create_batch(
            db,
            vendor=vendor,
            lines=payload.text.splitlines(),
            image_urls=[],
            ocr_engine="text",
            market=payload.market,
            note=payload.note,
            source="text",
        )
    except IntakeError as exc:
        _handle(exc)


@router.get("/intake/batches")
async def list_batches(
    limit: int = 20,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        service.require_ops(vendor)
    except IntakeError as exc:
        _handle(exc)
    return await service.recent_batches(db, limit=limit)


@router.get("/intake/batches/{batch_id}")
async def get_batch(
    batch_id: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        service.require_ops(vendor)
    except IntakeError as exc:
        _handle(exc)
    try:
        return await service.batch_detail(db, batch_id)
    except IntakeError as exc:
        _handle(exc)


@router.patch("/intake/observations/{observation_id}")
async def decide_observation(
    observation_id: str,
    payload: DecisionIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        service.require_ops(vendor)
    except IntakeError as exc:
        _handle(exc)
    try:
        return await service.decide(
            db, vendor=vendor, observation_id=observation_id, status=payload.status
        )
    except IntakeError as exc:
        _handle(exc)


# ── the dataset ──────────────────────────────────────────────────────────────


@router.get("/market-data/summary")
async def market_summary(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return {"access": service.access_for(vendor), **await service.summary(db)}


@router.get("/market-data/observations")
async def market_observations(
    category: Optional[str] = None,
    market: Optional[str] = None,
    limit: int = 60,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.observations(
        db, viewer=vendor, category=category, market=market, limit=limit
    )


@router.post("/market-data/presences/{virtual_id}/claim")
async def claim_presence(
    virtual_id: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.claim_presence(db, vendor, virtual_id)
    except IntakeError as exc:
        _handle(exc)

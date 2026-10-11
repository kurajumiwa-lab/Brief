"""HTTP adapter for business standing and the passport (v2.11).

    GET    /api/passport                      my standing: facts, expiry, readiness
    GET    /api/passport/catalog              the claim and checklist vocabulary
    PUT    /api/passport/profile              my headline + which checklists travel
    POST   /api/passport/claims               add or update one fact (multipart, file optional)
    POST   /api/passport/claims/{id}/request-verification
    DELETE /api/passport/claims/{id}          withdraw a claim (history stays)
    GET    /api/passport/readiness/{key}      grade one checklist for my business
    GET    /api/passport/{handle}             another business's public passport
    GET    /api/passport/queue                verifier desk: waiting claims
    POST   /api/passport/claims/{id}/verify   record a check (verifier only)
    POST   /api/passport/claims/{id}/reject   refuse with a reason (verifier only)

Ordering note: the literal paths (`/catalog`, `/queue`, `/claims`, `/profile`)
are registered before `/{handle}`, because FastAPI matches in registration
order and a handle called "catalog" must not shadow the catalog.

Two roles exist here, and only two: the owner of a claim, and a configured
verifier (`VERIFIER_HANDLES`). Nobody verifies their own paperwork; nobody
sees another business's evidence file or rejection history, only the facts
that business chose to publish.
"""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.standing import catalog, service
from app.modules.standing.models import ClaimMethod, ClaimStatus
from app.routes.auth import get_current_vendor
from app.services.storage import StorageError, is_public_url, max_bytes, safe_filename, storage

router = APIRouter()


def require_verifier():
    """Gate the desk endpoints on the configured handle list, the same shape
    as the market-ops desk: a role is a setting, never a database grant that a
    bug could hand out."""

    async def dependency(vendor: Vendor = Depends(get_current_vendor)) -> Vendor:
        if not settings.is_verifier(vendor.vendor_handle):
            raise HTTPException(403, "Claim verification is not available to this account")
        return vendor

    return dependency


def _upload_or_400(content: bytes, filename: str, content_type: Optional[str]) -> tuple[str, str]:
    try:
        _, normalized = safe_filename(filename, content_type)
    except StorageError as exc:
        raise HTTPException(400, str(exc))
    return normalized, content_type or ""


@router.get("/catalog")
async def get_catalog(vendor: Vendor = Depends(get_current_vendor)):
    """The vocabulary: every claim a business can add, and the checklists a
    buyer type usually asks for. Static reference data, safe to cache."""
    return catalog.catalog_payload()


@router.get("")
async def my_passport(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    """My standing. Includes declared rows, rejections, what lapses in the
    next 30 days, and readiness for the checklists I publish."""
    return await service.passport(db, vendor, public=False)


@router.put("/profile")
async def set_profile(
    headline: Optional[str] = Form(None, max_length=200),
    published_checklists: Optional[str] = Form(None, description="comma-separated checklist keys"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """My words, and which checklists may travel on the public passport.

    A readiness checklist shows gaps as clearly as currency, so nothing is
    published until the business says so — and `published_checklists=""`
    takes them all down again.
    """
    keys = None
    if published_checklists is not None:
        keys = [k.strip() for k in published_checklists.split(",") if k.strip()]
    try:
        profile = await service.update_standing_profile(
            db, vendor, headline=headline, published_checklists=keys,
        )
    except service.StandingError as exc:
        raise HTTPException(exc.status, str(exc))
    return {
        "headline": profile.headline,
        "published_checklists": profile.published_checklists or [],
        "available_checklists": [c.key for c in catalog.CHECKLISTS],
    }


@router.post("/claims", status_code=201)
async def upsert_claim(
    claim_key: str = Form(..., max_length=60),
    reference: Optional[str] = Form(None, max_length=120),
    issued_on: Optional[str] = Form(None),
    expires_on: Optional[str] = Form(None),
    note: Optional[str] = Form(None, max_length=1000),
    share_reference: bool = Form(True),
    evidence_url: Optional[str] = Form(None, max_length=500),
    evidence: Optional[UploadFile] = File(None),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Add or update one fact.

    Evidence is a file (PDF/PNG/JPG/WEBP, same storage layer as spec sheets)
    or an already-uploaded URL. Whatever was verified before is cleared: a
    human checked the old paper, not the new one.
    """
    url, name = None, None
    if evidence is not None and evidence.filename:
        try:
            normalized, content_type = safe_filename(evidence.filename, evidence.content_type)
        except StorageError as exc:
            raise HTTPException(400, str(exc))
        content = await evidence.read(max_bytes() + 1)
        if len(content) > max_bytes():
            raise HTTPException(413, f"File is larger than {max_bytes() // (1024 * 1024)} MB")
        if content:
            try:
                url = await storage.upload(content, normalized, content_type)
                name = normalized
            except Exception as exc:  # storage is optional in dev; the claim is not
                raise HTTPException(503, f"Storage unavailable: {type(exc).__name__}")
    elif evidence_url:
        if not is_public_url(evidence_url):
            raise HTTPException(400, "evidence_url must be an uploaded file URL or https link")
        url, name = evidence_url, "linked"

    try:
        claim = await service.upsert_claim(
            db, vendor, claim_key,
            reference=reference, issued_on=issued_on, expires_on=expires_on,
            note=note, share_reference=share_reference,
            evidence_url=url, evidence_name=name,
        )
    except service.StandingError as exc:
        raise HTTPException(exc.status, str(exc))
    return service.claim_out(claim, mine=True)


@router.post("/claims/{claim_id}/request-verification")
async def request_verification(
    claim_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        claim = await service.request_verification(db, vendor, claim_id)
    except service.StandingError as exc:
        raise HTTPException(exc.status, str(exc))
    return service.claim_out(claim, mine=True)


@router.delete("/claims/{claim_id}")
async def withdraw_claim(
    claim_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        claim = await service.withdraw_claim(db, vendor, claim_id)
    except service.StandingError as exc:
        raise HTTPException(exc.status, str(exc))
    return service.claim_out(claim, mine=True)


@router.get("/readiness/{checklist_key}")
async def readiness(
    checklist_key: str,
    handle: Optional[str] = Query(None, description="leave empty for mine; someone else's must be published"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Grade one checklist. Mine is always available; another business's only
    when that business published it."""
    target = vendor
    if handle and handle.lower() != (vendor.vendor_handle or "").lower():
        from sqlalchemy import select
        target = (await db.execute(
            select(Vendor).where(Vendor.vendor_handle == handle.lower())
        )).scalars().first()
        if not target:
            raise HTTPException(404, "No such business")
        profile = await service.standing_profile(db, target.id)
        if checklist_key not in (profile.published_checklists or []):
            raise HTTPException(403, "That business has not published this checklist")
    try:
        return await service.evaluate(db, target.id, checklist_key)
    except service.StandingError as exc:
        raise HTTPException(exc.status, str(exc))


# ── the verifier desk ───────────────────────────────────────────────────────

@router.get("/queue")
async def verification_queue(
    limit: int = Query(50, ge=1, le=200),
    verifier: Vendor = Depends(require_verifier()),
    db: AsyncSession = Depends(get_db),
):
    """Claims waiting for a human, oldest request first. Evidence links are
    included here — and only here — because the work is to open them."""
    return {"queue": await service.queue(db, limit=limit)}


@router.post("/claims/{claim_id}/verify")
async def verify_claim(
    claim_id: UUID,
    method: str = Form(ClaimMethod.REGISTRY_CHECK.value),
    expires_on: Optional[str] = Form(None),
    note: Optional[str] = Form(None, max_length=1000),
    verifier: Vendor = Depends(require_verifier()),
    db: AsyncSession = Depends(get_db),
):
    """Record that a named human checked the document or the reference."""
    try:
        claim = await service.verify_claim(
            db, verifier, claim_id, method=method, expires_on=expires_on, note=note,
        )
    except service.StandingError as exc:
        raise HTTPException(exc.status, str(exc))
    return service.claim_out(claim, mine=True)


@router.post("/claims/{claim_id}/reject")
async def reject_claim(
    claim_id: UUID,
    reason: str = Form(..., min_length=4, max_length=500),
    verifier: Vendor = Depends(require_verifier()),
    db: AsyncSession = Depends(get_db),
):
    try:
        claim = await service.reject_claim(db, verifier, claim_id, reason)
    except service.StandingError as exc:
        raise HTTPException(exc.status, str(exc))
    return service.claim_out(claim, mine=True)


# ── public passport (registered last: it swallows anything else) ─────────────

@router.get("/{handle}")
async def public_passport(
    handle: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Another business's standing: its live verified facts, its published
    checklists, and the sentence that keeps both honest. Evidence files and
    unpublished rows never appear here."""
    from sqlalchemy import select
    target = None
    if (handle or "").lower() == (vendor.vendor_handle or "").lower():
        target = vendor
    else:
        target = (await db.execute(
            select(Vendor).where(Vendor.vendor_handle == handle.lower())
        )).scalars().first()
    if not target:
        raise HTTPException(404, "No such business")
    return await service.passport(db, target, public=True)

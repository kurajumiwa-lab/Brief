"""Credentials and licences (Phase 4).

User routes (/api/credentials): a provider lists and removes their own credentials.
Ops routes (/api/ops/credentials): platform operators review and decide. Operators are
checked with the same fail-closed require_operator the other ops routes use.
Member read (/api/credentials/of/{handle}, signed-in members only): self_declared and verified only, never rejected.
Everything returns 404 while CREDENTIALS_ENABLED is off.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.credentials import service
from app.routes.auth import get_current_vendor
from app.routes.ops import require_operator

def _enabled() -> None:
    if not settings.CREDENTIALS_ENABLED:
        raise HTTPException(404, "Not found")


# Router-level, so the flag is checked before any auth dependency on a route.
router = APIRouter(dependencies=[Depends(_enabled)])
ops_router = APIRouter(dependencies=[Depends(_enabled)])


class CredentialIn(BaseModel):
    issuing_body: str = Field(..., max_length=300)
    registration_number: str = Field(..., max_length=200)
    title: str = Field(..., max_length=300)


class RejectIn(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)



@router.get("")
async def my_credentials(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"credentials": await service.mine(db, vendor.id)}


@router.post("", status_code=201)
async def add_credential(body: CredentialIn, vendor: Vendor = Depends(get_current_vendor),
                         db: AsyncSession = Depends(get_db)):
    try:
        return await service.add(db, vendor.id, body.model_dump())
    except service.CredentialError as e:
        raise HTTPException(e.status, str(e))


@router.delete("/{credential_id}", status_code=204)
async def remove_credential(credential_id: uuid.UUID, vendor: Vendor = Depends(get_current_vendor),
                            db: AsyncSession = Depends(get_db)):
    try:
        await service.remove(db, vendor.id, credential_id)
    except service.CredentialError as e:
        raise HTTPException(e.status, str(e))


@router.get("/of/{handle}")
async def public_credentials(handle: str, _viewer: Vendor = Depends(get_current_vendor),
                             db: AsyncSession = Depends(get_db)):
    vid = (await db.execute(select(Vendor.id).where(Vendor.vendor_handle == handle.lstrip("@")))).scalar_one_or_none()
    if vid is None:
        raise HTTPException(404, "Business not found")
    return {"credentials": await service.public_for_handle_vendor(db, vid)}


@ops_router.get("")
async def review_queue(_op: Vendor = Depends(require_operator), db: AsyncSession = Depends(get_db)):
    return {"credentials": await service.review_queue(db)}


@ops_router.post("/{credential_id}/verify")
async def verify_credential(credential_id: uuid.UUID, op: Vendor = Depends(require_operator),
                            db: AsyncSession = Depends(get_db)):
    try:
        return await service.verify(db, op.id, credential_id)
    except service.CredentialError as e:
        raise HTTPException(e.status, str(e))


@ops_router.post("/{credential_id}/reject")
async def reject_credential(credential_id: uuid.UUID, body: RejectIn, op: Vendor = Depends(require_operator),
                            db: AsyncSession = Depends(get_db)):
    try:
        return await service.reject(db, op.id, credential_id, body.reason)
    except service.CredentialError as e:
        raise HTTPException(e.status, str(e))

"""Ecosystem integrations (P4). Off by default. Returns 404 while INTEGRATIONS_ENABLED is off.

User routes (/api/integrations): a business records its own facts with provenance and reads its e-GP links.
Ops routes (/api/ops/integrations): platform operators review declared facts and verify them.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.integrations import service
from app.routes.auth import get_current_vendor
from app.routes.ops import require_operator


def _enabled() -> None:
    if not settings.INTEGRATIONS_ENABLED:
        raise HTTPException(404, "Not found")


router = APIRouter(dependencies=[Depends(_enabled)])
ops_router = APIRouter(dependencies=[Depends(_enabled)])


class FactIn(BaseModel):
    fact_kind: str
    method: str
    outcome: str = "ok"
    reference: str | None = Field(default=None)
    note: str | None = Field(default=None)
    fetched_at: str | None = None


class VerifyIn(BaseModel):
    next_review_at: str | None = None


def _raise(exc: service.IntegrationError):
    raise HTTPException(exc.status, exc.message)


@router.get("/facts")
async def my_facts(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return await service.mine(db, vendor.id)


@router.post("/facts", status_code=201)
async def record_fact(body: FactIn, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    try:
        return await service.record(db, vendor.id, body.model_dump())
    except service.IntegrationError as exc:
        _raise(exc)


@router.get("/links")
async def egp_links(_vendor: Vendor = Depends(get_current_vendor)):
    """Official entry points only. We link out and never re-host or re-submit."""
    return {"links": service.links()}


@ops_router.get("/facts")
async def review_queue(_op: Vendor = Depends(require_operator), db: AsyncSession = Depends(get_db)):
    return {"facts": await service.review_queue(db)}


@ops_router.post("/facts/{fact_id}/verify")
async def verify_fact(fact_id: uuid.UUID, body: VerifyIn, op: Vendor = Depends(require_operator),
                      db: AsyncSession = Depends(get_db)):
    try:
        return await service.verify(db, fact_id, op.id, body.next_review_at)
    except service.IntegrationError as exc:
        _raise(exc)

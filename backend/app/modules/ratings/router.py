"""Post-trade ratings routes (Phase 7, PR 102). Mounted at /api/post-trade-ratings.

Off by default: while POST_TRADE_RATING_GATE_ENABLED is false, every route returns 404.
The flag check is a router-level dependency, so it runs before authentication.
"""

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor
from app.modules.ratings import service
from app.routes.auth import get_current_vendor


def _enabled() -> None:
    if not settings.POST_TRADE_RATING_GATE_ENABLED:
        raise HTTPException(404, "Not found")


router = APIRouter(dependencies=[Depends(_enabled)])


class RatingIn(BaseModel):
    subject_kind: Literal["appointment", "movement"]
    subject_id: uuid.UUID
    outcome: Literal["completed", "failed", "fraud"]
    stars: Optional[int] = Field(default=None, ge=1, le=5)
    note: Optional[str] = Field(default=None, max_length=500)


@router.post("", status_code=201)
async def record(
    body: RatingIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Rate a trade you were party to. Clients rate suppliers; suppliers record failed or fraud."""
    row = await service.record_rating(
        db, vendor, subject_kind=body.subject_kind, subject_id=body.subject_id,
        outcome=body.outcome, stars=body.stars, note=body.note,
    )
    return {"id": str(row.id), "subject_kind": row.subject_kind, "subject_id": str(row.subject_id),
            "rater_role": row.rater_role, "outcome": row.outcome, "stars": row.stars, "final": True}


@router.get("/status")
async def status(
    subject_kind: Literal["appointment", "movement"],
    subject_id: uuid.UUID = Query(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Whether a trade is final, and what you can do about it. Parties only."""
    return await service.status_for(db, vendor, subject_kind, subject_id)

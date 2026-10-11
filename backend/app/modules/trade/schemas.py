"""Wire shapes for the trade module — validated at the edge, nowhere else."""

from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class RequirementIn(BaseModel):
    """One thing the buyer asks a supplier to evidence.

    `key` is a claim key from /api/passport/catalog, or "stated" — the buyer's
    own words, which the platform labels as unverifiable everywhere it
    appears. `label` is only read for a stated requirement: claim labels come
    from the catalog so two requests for the same document read the same.
    """

    key: str = Field(min_length=2, max_length=60)
    label: Optional[str] = Field(default=None, max_length=160)
    must_have: bool = False


class RequestIn(BaseModel):
    request_type: str = Field(min_length=2, max_length=20)
    description: str = Field(min_length=8, max_length=2000)
    location: str = Field(min_length=2, max_length=300)
    needed_by: str = "flexible"
    budget_kes: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    zone_id: Optional[UUID] = None
    requirements: list[RequirementIn] = Field(default_factory=list, max_length=12)


class OfferIn(BaseModel):
    note: str = Field(min_length=4, max_length=1000)
    price_kes: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    lead_time: Optional[str] = Field(default=None, max_length=120)


class WatchIn(BaseModel):
    """A standing question about opportunities. At least one filter."""

    label: Optional[str] = Field(default=None, max_length=120)
    request_type: Optional[str] = Field(default=None, max_length=20)
    keywords: Optional[str] = Field(default=None, max_length=200)
    zone_id: Optional[UUID] = None
    min_budget_kes: Optional[int] = Field(default=None, ge=0, le=100_000_000)

"""Wire shapes for the trade module — validated at the edge, nowhere else."""

from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class RequestIn(BaseModel):
    request_type: str = Field(min_length=2, max_length=20)
    description: str = Field(min_length=8, max_length=2000)
    location: str = Field(min_length=2, max_length=300)
    needed_by: str = "flexible"
    budget_kes: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    zone_id: Optional[UUID] = None


class OfferIn(BaseModel):
    note: str = Field(min_length=4, max_length=1000)
    price_kes: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    lead_time: Optional[str] = Field(default=None, max_length=120)

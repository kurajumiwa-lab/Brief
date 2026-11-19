"""Request bodies for the referral engine.

The client never sends a status, a reward amount, a receipt id or a payout flag.
Those are decided by the server from ownership, budget and verified evidence.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class CampaignCreate(BaseModel):
    shop_id: uuid.UUID
    title: str = Field(..., min_length=3, max_length=160)
    description: Optional[str] = Field(None, max_length=2000)
    region_slug: Optional[str] = Field(None, max_length=60)
    reward_points: int = Field(0, ge=0, le=10000)
    reward_kes: int = Field(0, ge=0, le=100000)
    max_referrals: int = Field(10, ge=1, le=500)
    ends_at: Optional[datetime] = None

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str) -> str:
        value = " ".join((value or "").split())
        if len(value) < 3:
            raise ValueError("Give the invite a title of at least three characters.")
        return value

    @field_validator("description")
    @classmethod
    def _description(cls, value: Optional[str]) -> Optional[str]:
        value = (value or "").strip()
        return value[:2000] or None


class CampaignStatusIn(BaseModel):
    status: Literal["active", "paused"]


class ClaimIn(BaseModel):
    code: str = Field(..., min_length=5, max_length=16)

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        value = (value or "").strip().upper()
        if not value:
            raise ValueError("A referral code is required.")
        return value


class PaidIn(BaseModel):
    # A bare "paid" tick is another signal. A reference or note makes the row
    # auditable without pretending the platform observed the payment.
    note: str = Field(..., min_length=3, max_length=255)

    @field_validator("note")
    @classmethod
    def _note(cls, value: str) -> str:
        cleaned = " ".join((value or "").split())[:255]
        if len(cleaned) < 3:
            raise ValueError("Add a payment reference or note so this is not just a claim.")
        return cleaned

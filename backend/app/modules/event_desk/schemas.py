"""Validation for the event vendor desk.

`extra="forbid"` matters here: a client must not be able to send `organizer_id`,
`status` or `vendor_id` and have it accepted as truth. Ownership comes from the
signed-in vendor, never from the body.
"""

from datetime import datetime
from typing import Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.event_desk.models import EVENT_VENDOR_CATEGORIES, PAYERS, RATE_UNITS


class ProofLinkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=8, max_length=500)
    kind: str = Field(default="portfolio", max_length=32)

    @field_validator("url")
    @classmethod
    def https_only(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("Links must start with https://")
        return value


class ReachClaimIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform: str = Field(min_length=1, max_length=40)
    metric: str = Field(min_length=1, max_length=60)
    value: str = Field(min_length=1, max_length=40)
    note: str = Field(default="", max_length=200)


class RateCardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    headline: str = Field(min_length=2, max_length=200)
    summary: str = Field(default="", max_length=4000)
    event_categories: List[str] = Field(default_factory=list, max_length=12)
    proof_links: List[ProofLinkIn] = Field(default_factory=list, max_length=6)
    reach_claims: List[ReachClaimIn] = Field(default_factory=list, max_length=8)
    is_public: bool = True

    @field_validator("event_categories")
    @classmethod
    def known_categories(cls, values: List[str]) -> List[str]:
        cleaned: list[str] = []
        for value in values:
            key = str(value or "").strip().lower()
            if key and key not in EVENT_VENDOR_CATEGORIES:
                raise ValueError(f"Unknown event category: {key}")
            if key and key not in cleaned:
                cleaned.append(key)
        return cleaned


class PackageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Optional[UUID] = None
    name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=1000)
    price_kes: int = Field(ge=0, le=100_000_000)
    price_unit: str = Field(default="per_event", max_length=24)
    inclusions: List[str] = Field(default_factory=list, max_length=20)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=999)

    @field_validator("price_unit")
    @classmethod
    def known_unit(cls, value: str) -> str:
        if value not in RATE_UNITS:
            raise ValueError(f"price_unit must be one of {', '.join(RATE_UNITS)}")
        return value

    @field_validator("inclusions")
    @classmethod
    def short_inclusions(cls, values: List[str]) -> List[str]:
        return [str(v).strip()[:160] for v in values if str(v).strip()][:20]


class PackagesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    packages: List[PackageIn] = Field(default_factory=list, max_length=12)


class RequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=2, max_length=200)
    category: str = Field(min_length=2, max_length=40)
    brief: str = Field(default="", max_length=4000)
    budget_min_kes: int = Field(default=0, ge=0, le=100_000_000)
    budget_max_kes: int = Field(default=0, ge=0, le=100_000_000)
    payer: str = Field(default="organizer", max_length=16)
    requirements: Dict[str, str] = Field(default_factory=dict)
    response_deadline: datetime

    @field_validator("category")
    @classmethod
    def known_category(cls, value: str) -> str:
        key = value.strip().lower()
        if key not in EVENT_VENDOR_CATEGORIES:
            raise ValueError(f"category must be one of {', '.join(EVENT_VENDOR_CATEGORIES)}")
        return key

    @field_validator("payer")
    @classmethod
    def known_payer(cls, value: str) -> str:
        if value not in PAYERS:
            raise ValueError(f"payer must be one of {', '.join(PAYERS)}")
        return value

    @field_validator("requirements")
    @classmethod
    def small_requirements(cls, value: Dict[str, str]) -> Dict[str, str]:
        allowed = {"access_time", "power", "parking", "setup", "notes"}
        clean: dict[str, str] = {}
        for key, item in (value or {}).items():
            if key not in allowed:
                raise ValueError(f"Unknown requirement: {key}")
            text = str(item or "").strip()
            if text:
                clean[key] = text[:500]
        return clean

    @field_validator("budget_max_kes")
    @classmethod
    def budget_band(cls, value: int, info):
        minimum = info.data.get("budget_min_kes", 0)
        if value and value < minimum:
            raise ValueError("budget_max_kes must be at least budget_min_kes")
        return value


class RequestStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["closed", "cancelled"]


class QuoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_kes: int = Field(ge=1, le=100_000_000)
    package_id: Optional[UUID] = None
    message: str = Field(default="", max_length=2000)
    inclusions: List[str] = Field(default_factory=list, max_length=20)
    valid_until: Optional[datetime] = None

    @field_validator("inclusions")
    @classmethod
    def short_inclusions(cls, values: List[str]) -> List[str]:
        return [str(v).strip()[:160] for v in values if str(v).strip()][:20]


class QuoteStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["shortlisted", "accepted", "declined", "withdrawn"]


class PassResaleIn(BaseModel):
    registration_id: UUID
    price_kes: int = Field(0, ge=0, le=1000000)
    note: Optional[str] = Field(None, max_length=500)

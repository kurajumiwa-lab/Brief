"""Request bodies for the town commerce layer.

A client never sends a balance, a funded amount, a verification status or a
bounty-paid flag. The server computes those from credit, proof and operator
action.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class ReceiptItemIn(BaseModel):
    description: str = Field(..., min_length=1, max_length=200)
    quantity: float = Field(1, gt=0, le=10000)
    unit_price_kes: int = Field(0, ge=0, le=1_000_000)
    total_price_kes: int = Field(..., ge=0, le=1_000_000)
    confidence: int = Field(0, ge=0, le=100)


class ReceiptCaptureIn(BaseModel):
    source: Literal["photo", "text", "qr", "manual"] = "photo"
    payload: Optional[str] = Field(None, max_length=4000)
    merchant_name: Optional[str] = Field(None, max_length=200)
    merchant_pin: Optional[str] = Field(None, max_length=20)
    invoice_no: Optional[str] = Field(None, max_length=100)
    total_kes: Optional[int] = Field(None, ge=1, le=1_000_000)
    tax_kes: Optional[int] = Field(None, ge=0, le=1_000_000)
    issued_at: Optional[datetime] = None
    region: Optional[str] = Field(None, max_length=80)
    photo_url: Optional[str] = Field(None, max_length=1000)
    ocr_engine: Optional[str] = Field(None, max_length=32)
    photo_consent: bool = False
    items: list[ReceiptItemIn] = Field(default_factory=list, max_length=60)
    extraction: dict[str, Any] = Field(default_factory=dict)


class OcrTextIn(BaseModel):
    text: str = Field(..., min_length=3, max_length=20000)
    consent: bool = False

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        if not (value or "").strip():
            raise ValueError("Paste the text printed on the receipt.")
        return value[:20000]


class CreditPurchaseIn(BaseModel):
    amount_kes: int = Field(..., ge=100, le=500_000)
    payment_reference: str = Field(..., min_length=4, max_length=120)
    idempotency_key: str = Field(..., min_length=6, max_length=120)
    note: Optional[str] = Field(None, max_length=300)


class RewardPolicyIn(BaseModel):
    points_per_100_kes: int = Field(..., ge=1, le=100)
    max_points_per_receipt: int = Field(..., ge=0, le=1_000_000)
    priority_bonus_pct: int = Field(0, ge=0, le=100)


class ReferralListingIn(BaseModel):
    provider: str = Field(..., min_length=2, max_length=80)
    category: Literal["ride_hailing", "transport", "betting", "retail", "services", "other"]
    title: str = Field(..., min_length=5, max_length=160)
    description: Optional[str] = Field(None, max_length=4000)
    referral_code: Optional[str] = Field(None, max_length=80)
    referral_url: Optional[str] = Field(None, max_length=1000)
    offer_terms: Optional[str] = Field(None, max_length=4000)
    region_slug: Optional[str] = Field("nyanza", max_length=60, pattern=r"^[a-z0-9-]+$")
    country_code: str = Field("KE", min_length=2, max_length=2)
    bounty_kes: int = Field(0, ge=0, le=1_000_000)
    bounty_points: int = Field(0, ge=0, le=1_000_000)
    budget_kes: int = Field(0, ge=0, le=10_000_000)
    verification_method: Literal["manual", "provider_api", "transaction_ref", "merchant_confirmation"] = "manual"
    trust_level_required: int = Field(1, ge=1, le=5)
    expires_at: Optional[datetime] = None


class ReferralListingUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=5, max_length=160)
    description: Optional[str] = Field(None, max_length=4000)
    offer_terms: Optional[str] = Field(None, max_length=4000)
    referral_code: Optional[str] = Field(None, max_length=80)
    referral_url: Optional[str] = Field(None, max_length=1000)
    bounty_kes: Optional[int] = Field(None, ge=0, le=1_000_000)
    budget_kes: Optional[int] = Field(None, ge=0, le=10_000_000)
    status: Optional[Literal["active", "paused", "expired"]] = None


class ReferralClaimIn(BaseModel):
    proof_type: Literal["transaction_ref", "screenshot", "provider_api", "merchant_confirmation"] = "transaction_ref"
    proof_reference: Optional[str] = Field(None, max_length=200)
    proof_payload: dict[str, Any] = Field(default_factory=dict)
    share_code: Optional[str] = Field(None, max_length=20)
    click_token: Optional[str] = Field(None, max_length=40)
    code_used: Optional[str] = Field(None, max_length=80)


class ReferralVerifyIn(BaseModel):
    approve: bool = True
    note: Optional[str] = Field(None, max_length=500)


class SponsorIn(BaseModel):
    bid_kes: int = Field(..., ge=100, le=100_000)
    days: int = Field(7, ge=1, le=30)
    payment_reference: str = Field(..., min_length=4, max_length=120)


class BountyFundIn(BaseModel):
    amount_kes: int = Field(..., ge=1, le=10_000_000)
    payment_reference: str = Field(..., min_length=4, max_length=120)


class BountyPaidIn(BaseModel):
    note: str = Field(..., min_length=3, max_length=255)

    @field_validator("note")
    @classmethod
    def _note(cls, value: str) -> str:
        cleaned = " ".join((value or "").split())[:255]
        if len(cleaned) < 3:
            raise ValueError("Add the M-Pesa reference or a note so this is auditable.")
        return cleaned


class RatingIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    note: Optional[str] = Field(None, max_length=500)


class PaymentConfirmationIn(BaseModel):
    amount_kes: float = Field(..., gt=0, le=1_000_000)
    payment_reference: str = Field(..., min_length=3, max_length=120)
    note: Optional[str] = Field(None, max_length=300)


class SubscriptionIn(BaseModel):
    months: int = Field(1, ge=1, le=12)
    payment_reference: str = Field(..., min_length=4, max_length=120)


class CommerceSettingsIn(BaseModel):
    campaign_fee_pct: Optional[float] = Field(None, ge=0, le=100)
    lead_fee_pct: Optional[float] = Field(None, ge=0, le=100)
    credit_expiry_days: Optional[int] = Field(None, ge=7, le=3650)
    scout_fee_delivery_handoff_pct: Optional[float] = Field(None, ge=0, le=25)
    scout_fee_errand_pickup_pct: Optional[float] = Field(None, ge=0, le=25)
    scout_fee_deal_spot_check_pct: Optional[float] = Field(None, ge=0, le=25)
    scout_fee_merchant_onboard_pct: Optional[float] = Field(None, ge=0, le=25)
    scout_fee_qr_distribution_pct: Optional[float] = Field(None, ge=0, le=25)
    scout_fee_customer_acquisition_pct: Optional[float] = Field(None, ge=0, le=25)
    note: Optional[str] = Field(None, max_length=300)


class DisputeIn(BaseModel):
    domain: Literal["receipt", "referral", "task", "redemption"]
    subject_id: uuid.UUID
    reason: str = Field(..., min_length=10, max_length=2000)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        cleaned = " ".join((value or "").split())
        if len(cleaned) < 10:
            raise ValueError("Say what went wrong — at least 10 characters.")
        return cleaned[:2000]


class ReasonIn(BaseModel):
    reason: str = Field(..., min_length=10, max_length=2000)

    @field_validator("reason")
    @classmethod
    def _clean(cls, value: str) -> str:
        cleaned = " ".join((value or "").split())
        if len(cleaned) < 10:
            raise ValueError("Say what went wrong — at least 10 characters.")
        return cleaned[:2000]


class ResolveDisputeIn(BaseModel):
    status: Literal["resolved", "rejected"]
    resolution: str = Field(..., min_length=5, max_length=2000)


class PurchaseReviewIn(BaseModel):
    approve: bool = True
    note: Optional[str] = Field(None, max_length=300)

"""Validated request bodies for customer/supplier transaction actions."""

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


def _naive_utc(value):
    if isinstance(value, str) and value.strip():
        value = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


class PickupDetailsIn(BaseModel):
    address: str = Field(min_length=8, max_length=500)
    pickup_hours: Optional[str] = Field(default=None, max_length=300)
    instructions: Optional[str] = Field(default=None, max_length=1000)
    ready_for_collection: bool = False


class DeliveryRequestIn(BaseModel):
    provider_type: Literal["supplier_delivery", "courier", "errand", "scheduled"]
    courier_registration_id: Optional[UUID] = None
    destination_address: str = Field(min_length=4, max_length=500)
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    customer_note: Optional[str] = Field(default=None, max_length=1000)

    _start = field_validator("scheduled_start", mode="before")(_naive_utc)
    _end = field_validator("scheduled_end", mode="before")(_naive_utc)

    @model_validator(mode="after")
    def validate_provider(self):
        if self.provider_type == "supplier_delivery" and self.courier_registration_id:
            raise ValueError("supplier_delivery must not include a courier id")
        if self.provider_type != "supplier_delivery" and not self.courier_registration_id:
            raise ValueError("Choose a registered delivery provider")
        if self.provider_type == "scheduled" and (not self.scheduled_start or not self.scheduled_end):
            raise ValueError("Scheduled delivery needs a start and end window")
        if self.scheduled_start and self.scheduled_end and self.scheduled_end <= self.scheduled_start:
            raise ValueError("The scheduled window end must be after its start")
        return self


class DeliveryQuoteIn(BaseModel):
    price_ksh: int = Field(ge=0, le=100_000_000)
    eta_text: Optional[str] = Field(default=None, max_length=160)
    note: Optional[str] = Field(default=None, max_length=1000)


class OrderPaymentIn(BaseModel):
    phone: Optional[str] = Field(default=None, min_length=8, max_length=20)
    provider: Literal["MPESA"] = "MPESA"


class ReceiptCodeIn(BaseModel):
    receipt_code: str = Field(pattern=r"^\d{6}$")


class TrackingUpdateIn(BaseModel):
    status: Literal["picked_up", "in_transit", "out_for_delivery", "delivery_issue"]
    note: Optional[str] = Field(default=None, min_length=2, max_length=500)
    tracking_reference: Optional[str] = Field(default=None, max_length=100)
    tracking_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("tracking_url")
    @classmethod
    def secure_tracking_url(cls, value):
        if value and not value.strip().lower().startswith("https://"):
            raise ValueError("Tracking links must use HTTPS")
        return value.strip() if value else value


class OrderDisputeIn(BaseModel):
    category: Literal[
        "missing_goods", "incorrect_quantity", "damaged_goods", "cancellation",
        "payment_problem", "delivery_failure", "other",
    ]
    description: str = Field(min_length=8, max_length=3000)


class ResolveDisputeIn(BaseModel):
    outcome: Literal["release", "refund"]
    refund_amount_ksh: Optional[int] = Field(default=None, ge=1, le=100_000_000)
    refund_product_ksh: int = Field(default=0, ge=0, le=100_000_000)
    refund_delivery_ksh: int = Field(default=0, ge=0, le=100_000_000)
    refund_platform_fee_ksh: int = Field(default=0, ge=0, le=100_000_000)
    resolution_note: str = Field(min_length=4, max_length=2000)

    @model_validator(mode="after")
    def refund_allocations_match_amount(self):
        allocated = self.refund_product_ksh + self.refund_delivery_ksh + self.refund_platform_fee_ksh
        if self.outcome == "release" and (self.refund_amount_ksh is not None or allocated):
            raise ValueError("A release resolution cannot include a refund")
        if self.outcome == "refund" and allocated:
            if self.refund_amount_ksh is None:
                self.refund_amount_ksh = allocated
            elif allocated != self.refund_amount_ksh:
                raise ValueError("Refund component amounts must add up to refund_amount_ksh")
        elif self.outcome == "refund" and self.refund_amount_ksh is not None:
            raise ValueError("Allocate the refund across product, delivery and platform fee")
        return self

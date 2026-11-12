"""Credentials and licences (service-providers plan, Phase 4).

A credential is a provider's claim about a professional registration. Its status is the only
thing that says how far it has been checked:
    self_declared  the provider entered it; nobody has checked it
    pending_review queued for an operator
    verified       an operator checked it (verified_at and verified_by_vendor_id are set)
    rejected       an operator could not confirm it (rejection_reason says why)

A credential never changes whether a vendor is visible. Visibility and verification are separate.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

CREDENTIAL_STATUSES = ("self_declared", "pending_review", "verified", "rejected")
# What an operator still has to decide on.
REVIEW_QUEUE_STATUSES = ("self_declared", "pending_review")
# What the public may see. A rejected credential is never shown.
PUBLIC_STATUSES = ("self_declared", "verified")


class VendorCredential(Base):
    __tablename__ = "vendor_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    issuing_body = Column(String(150), nullable=False)
    registration_number = Column(String(100), nullable=False)
    title = Column(String(150), nullable=False)
    status = Column(String(20), nullable=False, default="self_declared", server_default="self_declared", index=True)
    verified_at = Column(DateTime, nullable=True)
    verified_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

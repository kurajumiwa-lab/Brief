"""Business standing — the claims a business makes, and who checked them (v2.11).

The network already has trust signals: fulfilment rate over completed
movements, patron tiers, a quality ladder on stock. What it never had is a
record of the *paperwork* a formal buyer asks for — and the difference
between "the owner says so" and "a human saw the document".

Three tables, all append-only in spirit:

    business_claims    one row per fact per business (BRS registration, TCC,
                       county permit …). `status` says how far it got:
                       declared → documented → verified, or rejected/expired.
                       Evidence is a file in the ordinary storage layer; the
                       row keeps the URL, the reference number on the paper
                       and the dates.
    claim_events       every change, forever: who did it, when, what they said.
                       History is never rewritten — a rejected document and
                       the re-upload that fixed it both stay visible.
    standing_profiles  the owner's voice on their own passport: a one-line
                       headline and which checklists they choose to publish.

What is deliberately NOT here: a trust score. A verified claim records
evidence, and the API says so in words. A "reliability number" would be a
judgement the platform cannot defend — and the brief is explicit that opaque
scores damage small businesses unfairly.

Statuses and methods are stored as their lowercase strings (PG enums match
the wire), the same convention as the trade module.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


def _enum_values(enum_class):
    """PG labels = the values ("verified"), not the member names ("VERIFIED")."""
    return [m.value for m in enum_class]


class ClaimStatus(str, enum.Enum):
    DECLARED = "declared"       # the owner says it exists; nothing seen yet
    DOCUMENTED = "documented"   # a file is attached; no human has checked it
    VERIFIED = "verified"       # a named human checked the document/reference
    REJECTED = "rejected"       # a human found a problem (reason is mandatory)
    EXPIRED = "expired"         # the printed expiry date has passed
    WITHDRAWN = "withdrawn"     # the owner took it down; history stays


class ClaimMethod(str, enum.Enum):
    SELF_DECLARED = "self_declared"            # typed, no file
    DOCUMENT_UPLOAD = "document_upload"        # the owner attached the paper
    DOCUMENT_REFERENCE = "document_reference"  # a number given, no file yet
    REGISTRY_CHECK = "registry_check"          # the verifier looked it up at the issuer
    COUNTERPARTY_CONFIRMED = "counterparty_confirmed"  # a buyer/association confirmed it


# The statuses that mean "an unexpired verified fact exists" everywhere else
# in the app (matching, passport display) — one constant, no scattered checks.
LIVE_VERIFIED = ClaimStatus.VERIFIED


class BusinessClaim(Base):
    """One document, one business. Re-claiming the same key updates this row
    (the history lives in `claim_events`), so the passport never shows a
    business holding two versions of the same certificate."""

    __tablename__ = "business_claims"
    # One row per fact: re-claiming the same key updates it, so a passport can
    # never show two versions of the same certificate.
    __table_args__ = (
        UniqueConstraint("vendor_id", "claim_key", name="uq_claim_vendor_key"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    claim_key = Column(String(60), nullable=False, index=True)   # catalog key

    status = Column(Enum(ClaimStatus, values_callable=_enum_values),
                    nullable=False, default=ClaimStatus.DECLARED, index=True)
    method = Column(Enum(ClaimMethod, values_callable=_enum_values),
                    nullable=False, default=ClaimMethod.SELF_DECLARED)

    # What the paper says. `reference` is the number a buyer can read back to
    # the issuer; the owner chooses whether it travels on the public passport.
    reference = Column(String(120), nullable=True)
    issued_on = Column(Date, nullable=True)     # the date on the document
    expires_on = Column(Date, nullable=True, index=True)  # when it stops being current

    # Evidence — same storage layer as spec sheets (public-by-unguessable-key,
    # S3 when configured). Never rendered on the public passport: a fact is
    # public, the scan of a business's papers is not.
    evidence_url = Column(String(500), nullable=True)
    evidence_name = Column(String(255), nullable=True)

    share_reference = Column(Boolean, nullable=False, default=True, server_default=sa_text("true"))
    note = Column(Text, nullable=True)          # the owner's own words

    # Verification: a named human, a time, and what they said. Never anonymous.
    verified_by_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True,
    )
    verified_at = Column(DateTime, nullable=True)
    verification_note = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    verification_requested_at = Column(DateTime, nullable=True, index=True)

    # Renewal reminders already sent, as the day-windows used ("30", "7") —
    # so a worker pass every hour never sends the same reminder twice.
    reminded_windows = Column(JSONB, nullable=False, server_default=sa_text("'[]'::jsonb"), default=list)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("Vendor", foreign_keys=[vendor_id])
    verifier = relationship("Vendor", foreign_keys=[verified_by_vendor_id])


class ClaimEvent(Base):
    """Append-only history of a claim: created, evidence attached, submitted,
    verified, rejected, expired, withdrawn. Same-transaction with the change it
    describes, never updated afterwards — the audit trail a verification
    product is judged on."""

    __tablename__ = "claim_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    claim_id = Column(
        UUID(as_uuid=True), ForeignKey("business_claims.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    action = Column(String(40), nullable=False)  # created | updated | evidence_attached
                                                 # | verification_requested | verified
                                                 # | rejected | expired | withdrawn
    actor_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    actor_type = Column(String(20), nullable=False, default="owner")  # owner | verifier | system
    note = Column(Text, nullable=True)            # what the actor said (rejection reason lives here too)
    payload = Column(JSONB, nullable=False, server_default=sa_text("'{}'::jsonb"), default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


class StandingProfile(Base):
    """The owner's side of the passport: one line in their own words, and the
    checklists they choose to publish.

    Nothing is published by default. A readiness checklist shows gaps as
    plainly as it shows currency, so it only travels when the business says so
    — and the owner can always see their own.
    """

    __tablename__ = "standing_profiles"

    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), primary_key=True,
    )
    headline = Column(String(200), nullable=True)
    published_checklists = Column(JSONB, nullable=False, server_default=sa_text("'[]'::jsonb"), default=list)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# opportunity alerts — the demand-side twin of a claim (v2.11)
#
# A watch is a standing question: "tell me when a request looks like this".
# It lives beside the requests it watches, in the trade module's territory —
# re-exported here only so `models/__init__` has one import site for the
# "standing" release. The rows themselves belong to `app.modules.trade.models`.
# ─────────────────────────────────────────────────────────────────────────────

__all__ = [
    "BusinessClaim", "ClaimEvent", "ClaimMethod", "ClaimStatus", "LIVE_VERIFIED",
    "StandingProfile",
]

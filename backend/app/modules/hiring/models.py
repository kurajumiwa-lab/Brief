"""Hiring: free broadcasts, free applications, and money only on a hire.

Four tables and one rule that shapes all four:

    The person looking for work never pays us anything, ever.

That rule is structural, not a promise in copy. `hiring_applications` has no
fee, no balance and no wallet column, and nothing in this module reads a payment
from an applicant. If a future feature ever needed one, it would have to change
the schema — which is exactly the diff a reviewer should see.

The money side (migration 0082):
    hiring_claims.status  accrued → payable → settled, or void

    accrued   the number exists. Nobody may be paid. Shown as
              "Accrued — payable when the hire is confirmed".
    payable   the hire was confirmed by the employer **and** one independent
              signal (a start-date check-in from the hiree, or a second
              confirmation in the same role for the same employer).
    settled   the payer recorded a direct M-Pesa reference. Evidence of a
              direct payment, never a platform transfer.
    void      the hire fell through inside the void window. The reason is kept.

Brief holds no money here, exactly as `referrals` documents: there is no wallet,
no balance and no payout instruction on any row.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

POSTER_KINDS = ("direct", "agency", "aggregator")
BROADCAST_STATUSES = ("open", "closed", "filled")
APPLICATION_STATUSES = ("applied", "shortlisted", "hired", "rejected", "withdrawn")
CLAIM_KINDS = ("hire_fee", "broadcaster_share")
CLAIM_STATUSES = ("accrued", "payable", "settled", "void")

#: Who may post for free. A direct employer is the business that will actually
#: employ the person; an intermediary is reselling our attention and already
#: charges its own clients.
FREE_POSTER_KINDS = ("direct",)
#: A broadcaster keeps this share of the hire fee. The rest is ours.
BROADCASTER_SHARE_PCT = 40
#: Recommended price: about half a week's pay, once, and only on a hire.
HIRE_FEE_OF_MONTHLY_SALARY = 0.115


class HiringBroadcast(Base):
    """One job, broadcast free by the employer that will hire into it."""

    __tablename__ = "hiring_broadcasts"
    __table_args__ = (
        CheckConstraint(
            "poster_kind IN ('direct','agency','aggregator')",
            name="ck_hiring_broadcasts_poster_kind",
        ),
        CheckConstraint("status IN ('open','closed','filled')",
                        name="ck_hiring_broadcasts_status"),
        CheckConstraint("salary_kes IS NULL OR salary_kes >= 0",
                        name="ck_hiring_broadcasts_salary"),
        CheckConstraint("hire_count >= 0", name="ck_hiring_broadcasts_hires"),
        CheckConstraint("length(btrim(role_title)) > 0", name="ck_hiring_broadcasts_title"),
        Index("ix_hiring_broadcasts_town_status", "region_slug", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    poster_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                              nullable=False)
    # The business the applicant would actually work for. Named even when the
    # poster is a person inside it, because a vacancy with no employer is a scam
    # signature.
    employer_name = Column(String(160), nullable=False)
    poster_kind = Column(String(12), nullable=False, default="direct", server_default="direct")
    role_title = Column(String(160), nullable=False)
    role_summary = Column(Text, nullable=False)
    town = Column(String(80), nullable=False)
    region_slug = Column(String(64), nullable=False, default="nyanza", server_default="nyanza")
    salary_kes = Column(Integer, nullable=True)
    salary_unit = Column(String(12), nullable=False, default="month", server_default="month")
    contact_note = Column(String(300), nullable=True)
    # The ?via= code that travels in a WhatsApp forward. First touch wins.
    via_code = Column(String(16), nullable=False, unique=True)
    status = Column(String(12), nullable=False, default="open", server_default="open")
    # A count of named hires, never a score.
    hire_count = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))
    closed_at = Column(DateTime, nullable=True)


class HiringApplication(Base):
    """One person applying. Free, forever, and there is nowhere to put a fee."""

    __tablename__ = "hiring_applications"
    __table_args__ = (
        CheckConstraint(
            "status IN ('applied','shortlisted','hired','rejected','withdrawn')",
            name="ck_hiring_applications_status",
        ),
        UniqueConstraint("broadcast_id", "applicant_vendor_id",
                         name="uq_hiring_applications_once"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    broadcast_id = Column(UUID(as_uuid=True),
                          ForeignKey("hiring_broadcasts.id", ondelete="CASCADE"),
                          nullable=False)
    applicant_vendor_id = Column(UUID(as_uuid=True),
                                 ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    # The broadcaster whose link brought them. First touch wins; shown to the
    # losing broadcaster rather than hidden from them.
    attributed_via = Column(String(16), nullable=True)
    cover_note = Column(String(1000), nullable=True)
    status = Column(String(16), nullable=False, default="applied", server_default="applied")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))
    hired_at = Column(DateTime, nullable=True)


class HiringClaim(Base):
    """A number that exists but pays nobody until a hire is confirmed."""

    __tablename__ = "hiring_claims"
    __table_args__ = (
        CheckConstraint("kind IN ('hire_fee','broadcaster_share')",
                        name="ck_hiring_claims_kind"),
        CheckConstraint("status IN ('accrued','payable','settled','void')",
                        name="ck_hiring_claims_status"),
        CheckConstraint("amount_kes >= 0", name="ck_hiring_claims_amount"),
        UniqueConstraint("application_id", "kind", "earner_vendor_id",
                         name="uq_hiring_claims_once"),
        Index("ix_hiring_claims_earner", "earner_vendor_id", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    broadcast_id = Column(UUID(as_uuid=True),
                          ForeignKey("hiring_broadcasts.id", ondelete="CASCADE"),
                          nullable=False)
    application_id = Column(UUID(as_uuid=True),
                            ForeignKey("hiring_applications.id", ondelete="CASCADE"),
                            nullable=False)
    earner_vendor_id = Column(UUID(as_uuid=True),
                              ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    payer_vendor_id = Column(UUID(as_uuid=True),
                             ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(20), nullable=False)
    amount_kes = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(String(12), nullable=False, default="accrued", server_default="accrued")
    # Evidence of a direct payment the payer made. Never a platform movement.
    payment_reference = Column(String(120), nullable=True)
    note = Column(String(300), nullable=True)
    settled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))


class ObservationReward(Base):
    """One person's price-gathering day. A task reward, never wages.

    `status` says what actually happened: `accrued` means the work was accepted
    and the number exists; `paid` means the payer recorded a direct reference.
    The payout never arrives from Brief.
    """

    __tablename__ = "observation_rewards"
    __table_args__ = (
        CheckConstraint("status IN ('accrued','paid','void')",
                        name="ck_observation_rewards_status"),
        CheckConstraint("accepted >= 0 AND amount_kes >= 0",
                        name="ck_observation_rewards_nonnegative"),
        UniqueConstraint("vendor_id", "work_date", "town",
                         name="uq_observation_rewards_day"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"),
                       nullable=True)
    work_date = Column(Date, nullable=False)
    town = Column(String(80), nullable=True)
    accepted = Column(Integer, nullable=False, default=0, server_default="0")
    required = Column(Integer, nullable=False, default=12, server_default="12")
    amount_kes = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(String(12), nullable=False, default="accrued", server_default="accrued")
    payment_reference = Column(String(120), nullable=True)
    reason = Column(String(300), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))

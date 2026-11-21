"""Merit: the Trust Score's inputs, its snapshots, and its exports.

Three tables, and the shape says what the module is for:

* ``trust_endorsements`` — one business vouching for another, weighted by the
  endorser's own tier at the time it was given. Append-only.
* ``mentorships`` — a Blue Chip business taking on a newcomer. Its milestones
  are what pay the mentor, and what the mentee may claim, capped, as uplift.
* ``merit_snapshots`` — the score as computed on a day, with the version and
  input hash that reproduce it. A public page shows the latest; a report shows
  the history.

There is no ledger here and no balance. Nothing in this module is money, and
nothing in this module can be bought: a score is only ever computed from things
that happened.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint, Column, Date, DateTime, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

ENDORSEMENT_STATUSES = ("active", "withdrawn")
MENTORSHIP_STATUSES = ("active", "completed", "ended")
#: What a mentor is paid for, and nothing else. "Signed up" is not on the list.
MENTORSHIP_MILESTONES = ("first_month_active", "first_paid_work", "first_receipt")


def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class TrustEndorsement(Base):
    """One business vouching for another. Not money, not a rating, not a review.

    It is a named claim with a reason, and the name is shown. An endorsement is
    worth what the endorser's own record is worth, computed once when it is
    given and stored, so a withdrawn endorsement ring cannot be re-scored into
    existence later.
    """

    __tablename__ = "trust_endorsements"
    __table_args__ = (
        CheckConstraint(_in("status", ENDORSEMENT_STATUSES), name="ck_trust_endorsement_status"),
        CheckConstraint("weight >= 0 AND weight <= 1", name="ck_trust_endorsement_weight"),
        CheckConstraint("endorser_vendor_id <> subject_vendor_id",
                        name="ck_trust_endorsement_not_self"),
        CheckConstraint("length(reason) >= 10", name="ck_trust_endorsement_reason"),
        # One business may vouch for another once. Withdrawing does not let it
        # be said twice.
        UniqueConstraint("endorser_vendor_id", "subject_vendor_id",
                         name="uq_trust_endorsement_once"),
        Index("ix_trust_endorsement_subject", "subject_vendor_id", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    endorser_vendor_id = Column(UUID(as_uuid=True),
                                ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    subject_vendor_id = Column(UUID(as_uuid=True),
                               ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    #: The endorser's score at the moment of endorsing, and the weight derived
    #: from it. Stored, never recomputed: the record of what was said stands.
    endorser_score = Column(Float, nullable=False, default=0.0, server_default="0")
    weight = Column(Float, nullable=False, default=0.2, server_default="0.2")
    reason = Column(Text, nullable=False)
    status = Column(String(12), nullable=False, default="active", server_default="active")
    #: What the subject did that the endorser names. Kept as words, not a
    #: taxonomy, so an endorsement cannot be gamed by picking a category.
    context = Column(String(160), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))
    withdrawn_at = Column(DateTime, nullable=True)


class Mentorship(Base):
    """A Blue Chip business taking a newcomer on.

    The mentor must already be Blue Chip *when they take the mentee on*, and the
    mentee must not be. That asymmetry is the mechanism: the perk is the pairing
    itself, and the reward is for the mentee actually keeping it up.
    """

    __tablename__ = "mentorships"
    __table_args__ = (
        CheckConstraint(_in("status", MENTORSHIP_STATUSES), name="ck_mentorship_status"),
        CheckConstraint("mentor_vendor_id <> mentee_vendor_id", name="ck_mentorship_not_self"),
        # One mentee per mentor at a time keeps this from becoming a pyramid:
        # a mentor with twenty mentees is not mentoring, they are recruiting.
        UniqueConstraint("mentor_vendor_id", "mentee_vendor_id", name="uq_mentorship_pair"),
        Index("ix_mentorship_mentor", "mentor_vendor_id", "status"),
        Index("ix_mentorship_mentee", "mentee_vendor_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    mentor_vendor_id = Column(UUID(as_uuid=True),
                              ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    mentee_vendor_id = Column(UUID(as_uuid=True),
                              ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(12), nullable=False, default="active", server_default="active")
    #: Which milestones have been reached, and when. Append-only in practice:
    #: the service only ever adds.
    milestones = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    #: Uplift actually granted to the mentee so far, in score points, never
    #: above `rules.MENTOR_UPLIFT_CAP`.
    uplift_granted = Column(Float, nullable=False, default=0.0, server_default="0")
    note = Column(String(300), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))
    ended_at = Column(DateTime, nullable=True)


class MeritSnapshot(Base):
    """A score on a day, reproducible from its version and input hash.

    Written when someone asks (the public page, the owner, a report) rather than
    on a schedule, so a quiet business does not accumulate thousands of identical
    rows. The latest row is what the ticker shows; the sequence is what a
    Pattern Report exports.
    """

    __tablename__ = "merit_snapshots"
    __table_args__ = (
        CheckConstraint("score >= 0 AND score <= 100", name="ck_merit_snapshot_score"),
        CheckConstraint(_in("tier", ("seed", "verified", "blue_chip")),
                        name="ck_merit_snapshot_tier"),
        # One row per business per day: recomputing is idempotent, which is what
        # makes the hash meaningful.
        UniqueConstraint("vendor_id", "as_of", name="uq_merit_snapshot_day"),
        Index("ix_merit_snapshot_vendor", "vendor_id", "as_of"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    vendor_id = Column(UUID(as_uuid=True),
                       ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    as_of = Column(Date, nullable=False)
    score = Column(Float, nullable=False)
    score_earned = Column(Float, nullable=False, default=0.0, server_default="0")
    tier = Column(String(12), nullable=False)
    families = Column(Integer, nullable=False, default=0, server_default="0")
    decay = Column(Float, nullable=False, default=1.0, server_default="1")
    #: The full component breakdown, so a card rendered a month later shows the
    #: reasons of the day rather than re-deriving them with new rules.
    breakdown = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    version = Column(String(24), nullable=False, default="merit-1", server_default="merit-1")
    input_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))

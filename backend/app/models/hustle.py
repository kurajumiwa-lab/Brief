"""Hustle League models — the real-work gamification layer.

The naming follows the game; the storage follows the house rule: nothing is
stored that can be derived from a row.

  * XP, level, division, streak and every skill-card tier are DERIVED from
    hustle_contracts (completed matches + ratings) — the same pattern as
    CircleDerived. A stored "level" that a bug or a grant could inflate is
    exactly the fake-progress this app refuses to build.
  * Gold balance is the SUM of hustle_gold_ledger rows — one source of truth.
  * The one thing stored that the game "invents": payout_status, which records
    what the money actually did. "direct" means the contract records an agreed
    pay the client pays by mobile money outside the app (this deployment has
    no PSP float); "queued/completed/failed" mean the PSP moved real money.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class HustleJobCall(Base):
    """A posted task — the 'call-up'. A client vendor pays real KES for it."""
    __tablename__ = "hustle_job_calls"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    task_type = Column(String(40), nullable=False)
    skill = Column(String(40), nullable=False)
    required_tier = Column(String(20), nullable=False, default="common")
    pay_kes = Column(Integer, nullable=False)
    location = Column(String(500), nullable=True)
    geo_lat = Column(Float, nullable=True)
    geo_lng = Column(Float, nullable=True)
    squad_id = Column(UUID(as_uuid=True), nullable=True)
    # 6 digits, generated when the first worker accepts. The client shows it;
    # the worker types it at completion. Real two-party proof, no GPS needed.
    otp_code = Column(String(6), nullable=True)
    status = Column(String(30), nullable=False, default="open", index=True)  # open, contracted, in_progress, proof_pending, completed, cancelled
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class HustleContract(Base):
    """An accepted call — the 'contract'. One row per played match."""
    __tablename__ = "hustle_contracts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_call_id = Column(UUID(as_uuid=True), ForeignKey("hustle_job_calls.id", ondelete="CASCADE"), nullable=False, index=True)
    player_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    agreed_pay_kes = Column(Integer, nullable=False)
    status = Column(String(30), nullable=False, default="accepted")  # accepted, in_progress, proof_pending, completed, disputed, cancelled
    otp_verified = Column(Boolean, nullable=False, default=False)
    proof_photo_url = Column(String(500), nullable=True)
    client_rating = Column(Integer, nullable=True)
    client_note = Column(String(300), nullable=True)
    worker_client_rating = Column(Integer, nullable=True)
    xp_earned = Column(Integer, nullable=False, default=0)
    gold_earned = Column(Integer, nullable=False, default=0)
    payout_status = Column(String(30), nullable=False, default="direct")  # direct, queued, completed, failed
    payout_ref = Column(String(80), nullable=True)
    cancel_reason = Column(String(300), nullable=True)
    accepted_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class HustleGoldLedger(Base):
    """Every Gold that ever moved. Balance = sum(amount)."""
    __tablename__ = "hustle_gold_ledger"
    __table_args__ = (UniqueConstraint("vendor_id", "reason", "ref", name="uq_gold_ledger_vendor_reason_ref"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    amount = Column(Integer, nullable=False)
    reason = Column(String(40), nullable=False)  # completion, daily_first, challenge, squad_split, redemption
    ref = Column(String(80), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class HustleSquad(Base):
    __tablename__ = "hustle_squads"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False)
    captain_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class HustleSquadMember(Base):
    __tablename__ = "hustle_squad_members"
    __table_args__ = (UniqueConstraint("squad_id", "vendor_id", name="uq_squad_member"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    squad_id = Column(UUID(as_uuid=True), ForeignKey("hustle_squads.id", ondelete="CASCADE"), nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(20), nullable=False, default="member")
    split_pct = Column(Integer, nullable=False, default=10)
    joined_at = Column(DateTime, nullable=False, default=datetime.utcnow)

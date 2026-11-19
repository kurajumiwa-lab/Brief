"""Work-from-home corridor tasks and their commission ledger (migration 0066).

A task is a small, local, verifiable errand: hand a parcel over, spot-check a
deal, onboard a merchant, pick something up. The worker is paid directly by the
creator over M-Pesa; the platform records a 5–8% fee on a ledger and holds no
money at any point.

Signals, not verification: a proof photo, a HO-XXX handoff code and a pasted
M-Pesa note are structured evidence for the creator to judge. Completing tasks
awards no standing level.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric,
    String, Text, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

TASK_TYPES = (
    "DELIVERY_HANDOFF", "DEAL_SPOT_CHECK", "MERCHANT_ONBOARD", "ERRAND_PICKUP",
    "QR_DISTRIBUTION", "CUSTOMER_ACQUISITION",
)
TASK_STATUSES = ("OPEN", "CLAIMED", "PROOF_SUBMITTED", "COMPLETED", "EXPIRED", "DISPUTED")

TASK_TYPE_LABELS = {
    "DELIVERY_HANDOFF": "Delivery handoff",
    "DEAL_SPOT_CHECK": "Shop check",
    "MERCHANT_ONBOARD": "Merchant onboarding",
    "ERRAND_PICKUP": "Errand pickup",
    "QR_DISTRIBUTION": "QR distribution",
    "CUSTOMER_ACQUISITION": "Customer acquisition",
}

STATUS_LABELS = {
    "OPEN": "Open",
    "CLAIMED": "Claimed",
    "PROOF_SUBMITTED": "Proof submitted",
    "COMPLETED": "Completed",
    "EXPIRED": "Expired",
    "DISPUTED": "Disputed",
}

# The deterministic platform commission per task type. It is a rule, not a
# negotiation, so the fee on the card is always the fee in the ledger.
FEE_PCT = {
    "DELIVERY_HANDOFF": 5,
    "ERRAND_PICKUP": 5,
    "DEAL_SPOT_CHECK": 7,
    "MERCHANT_ONBOARD": 8,
    "QR_DISTRIBUTION": 5,
    "CUSTOMER_ACQUISITION": 8,
}

# A claim auto-releases after this many hours so a stalled assignee cannot sit
# on an income opportunity.
CLAIM_TTL_HOURS = 4


class CorridorTask(Base):
    __tablename__ = "corridor_tasks"
    __table_args__ = (
        CheckConstraint(
            "task_type IN ('DELIVERY_HANDOFF','DEAL_SPOT_CHECK','MERCHANT_ONBOARD',"
            "'ERRAND_PICKUP','QR_DISTRIBUTION','CUSTOMER_ACQUISITION')",
            name="ck_corridor_task_type",
        ),
        CheckConstraint(
            "status IN ('OPEN','CLAIMED','PROOF_SUBMITTED','COMPLETED','EXPIRED','DISPUTED')",
            name="ck_corridor_task_status",
        ),
        CheckConstraint("worker_payout_kes > 0", name="ck_corridor_task_payout_positive"),
        CheckConstraint("platform_fee_kes >= 0", name="ck_corridor_task_fee_nonnegative"),
        CheckConstraint("fee_pct >= 0 AND fee_pct <= 25", name="ck_corridor_task_fee_pct"),
        CheckConstraint("min_standing_level BETWEEN 1 AND 4", name="ck_corridor_task_min_standing"),
        CheckConstraint("assignee_user_id IS NULL OR assignee_user_id <> creator_user_id",
                        name="ck_corridor_task_not_self_assigned"),
        Index("idx_corridor_tasks_inbox", "region_slug", "scheduled_date", "status"),
        Index("idx_corridor_tasks_creator", "creator_user_id", "created_at"),
        Index("idx_corridor_tasks_assignee", "assignee_user_id", "scheduled_date",
              postgresql_where=text("assignee_user_id IS NOT NULL")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    creator_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
                             nullable=False)
    assignee_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"),
                              nullable=True)
    region_slug = Column(String(64), nullable=False)
    town = Column(String(64), nullable=False)
    task_type = Column(String(32), nullable=False)
    title = Column(String(140), nullable=False)
    instructions = Column(Text, nullable=False)
    scheduled_date = Column(Date, nullable=False)
    due_at = Column(DateTime(timezone=True), nullable=False)

    worker_payout_kes = Column(Numeric(10, 2), nullable=False)
    platform_fee_kes = Column(Numeric(10, 2), nullable=False)
    fee_pct = Column(Numeric(5, 2), nullable=False)
    # The worker's M-Pesa/Pochi details, supplied at proof time and only shown
    # to the creator once they are ready to pay. Never public.
    payment_tag_snapshot = Column(JSONB, nullable=False, default=dict,
                                  server_default=text("'{}'::jsonb"))

    status = Column(String(24), nullable=False, default="OPEN", server_default="OPEN")
    min_standing_level = Column(Integer, nullable=False, default=2, server_default="2")
    proof_payload = Column(JSONB, nullable=False, default=dict,
                           server_default=text("'{}'::jsonb"))
    claim_expires_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    expired_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                        server_default=text("now()"))


class CorridorTaskFee(Base):
    """One append-only row per completed task. The platform's commission record.

    No custody: the row states what the creator owed the platform for
    introducing them to a worker, and how the worker was paid directly.
    """

    __tablename__ = "corridor_task_fee_ledger"
    __table_args__ = (
        CheckConstraint("platform_fee_kes >= 0", name="ck_corridor_fee_nonnegative"),
        CheckConstraint("worker_payout_kes > 0", name="ck_corridor_fee_payout_positive"),
        Index("idx_corridor_fee_creator", "creator_user_id", "recorded_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("gen_random_uuid()"))
    task_id = Column(UUID(as_uuid=True), ForeignKey("corridor_tasks.id", ondelete="CASCADE"),
                     nullable=False, unique=True)
    creator_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"),
                             nullable=True)
    worker_user_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"),
                            nullable=True)
    worker_payout_kes = Column(Numeric(10, 2), nullable=False)
    platform_fee_kes = Column(Numeric(10, 2), nullable=False)
    fee_pct = Column(Numeric(5, 2), nullable=False)
    settlement_mode = Column(String(24), nullable=False, default="direct_mpesa",
                             server_default="direct_mpesa")
    recorded_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow,
                         server_default=text("now()"))

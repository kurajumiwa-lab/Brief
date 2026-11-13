"""A fact a business has about itself that comes from an outside system (Ecosystem integrations, P4).

Every row says where the fact came from and how it was obtained (the fallback ladder in
app/modules/integrations/service.py). State is always labelled:
    declared  the business's own words, from an export, an attested upload or by hand. Not verified.
    verified  an operator checked it and set reviewed_at, reviewer and next_review_at.
    failed    an attempt was made and did not succeed. Stated as failed, never softened.
Facts are append-only: a new check adds a row. Nothing is overwritten.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

FACT_STATES = ("declared", "verified", "failed")
FACT_METHODS = ("api", "export", "attested_upload", "manual")


class ExternalFact(Base):
    __tablename__ = "external_facts"
    __table_args__ = (
        CheckConstraint("state IN ('declared', 'verified', 'failed')", name="ck_external_fact_state"),
        CheckConstraint("method IN ('api', 'export', 'attested_upload', 'manual')", name="ck_external_fact_method"),
        Index("ix_external_facts_vendor_kind", "vendor_id", "fact_kind"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    fact_kind = Column(String(40), nullable=False)
    state = Column(String(12), nullable=False)
    method = Column(String(20), nullable=False)
    source_system = Column(String(120), nullable=False)
    reference = Column(String(200), nullable=True)
    note = Column(Text, nullable=True)
    fetched_at = Column(DateTime, nullable=False)
    reviewer_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    next_review_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

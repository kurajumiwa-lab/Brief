"""Progress on free blueprints. Starting one is free; so is every step."""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class BlueprintStart(Base):
    __tablename__ = "blueprint_starts"
    __table_args__ = (UniqueConstraint("vendor_id", "blueprint_key", name="uq_blueprint_start"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    blueprint_key = Column(String(64), nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class BlueprintStepDone(Base):
    __tablename__ = "blueprint_step_done"
    __table_args__ = (UniqueConstraint("vendor_id", "blueprint_key", "step_key", name="uq_blueprint_step_done"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    blueprint_key = Column(String(64), nullable=False)
    step_key = Column(String(64), nullable=False)
    done_at = Column(DateTime, default=datetime.utcnow, nullable=False)

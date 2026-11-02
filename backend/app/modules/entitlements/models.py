"""One row per premium feature. Editable by operators without a code change."""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, String, Text, text as sa_text

from app.database import Base


class FeatureEntitlement(Base):
    __tablename__ = "feature_entitlements"
    __table_args__ = (
        CheckConstraint(
            "min_tier IN ('free','growth','business_pro')",
            name="ck_feature_entitlements_min_tier",
        ),
    )

    feature_key = Column(String(48), primary_key=True)
    label = Column(String(120), nullable=False)
    description = Column(Text, nullable=False, server_default="")
    # The lowest tier that unlocks the feature.
    min_tier = Column(String(16), nullable=False)
    # Switch a feature off for everyone without deleting it.
    enabled = Column(Boolean, nullable=False, default=True, server_default="true")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=sa_text("now()"))
    updated_by = Column(String(100), nullable=True)

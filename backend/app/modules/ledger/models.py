"""Local Activity Ledger models — seven additive tables.

Every local activity shares one lifecycle rather than disappearing into a feed:

    1. published            — Available, Wanted, Scheduled, or Opportunity
    2. notified             — Relevant local providers / watchers alerted
    3. responses_received   — Quotes, supply offers, group pledges, round stops
    4. booking_agreed       — Non-custodial scope, time, price & fulfilment agreed
    5. completed            — Mutual completion confirmation, agreed changes & feedback
    6. reusable_record      — Private history enabling repeat bookings while
                              keeping sensitive household directions private
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base

POSTING_TYPES = ("available", "wanted", "scheduled", "opportunity")

ACTIVITY_TEMPLATES = (
    "repair_artisan",
    "agricultural_produce_fodder",
    "tool_lending",
    "collection_point",
    "travelling_round",
    "community_learning",
    "supervised_youth_task",
    "group_sourcing",
    "general",
)

LOCATION_SCOPES = (
    "homestead_private",
    "estate",
    "neighbourhood",
    "ward",
    "town",
    "county",
)

ACTIVITY_GEO_PRECISIONS = ("approximate", "exact_for_confirmed", "exact", "none")

ACTIVITY_VISIBILITIES = ("public", "community", "saved_contacts", "private")

PRICE_BASES = ("quote_requested", "fixed", "per_unit", "cost_share", "free")

LIFECYCLE_STATUSES = (
    "published",
    "notified",
    "responses_received",
    "booking_agreed",
    "in_progress",
    "completed",
    "cancelled",
    "expired",
)

RESPONSE_TYPES = (
    "quote",
    "supply_offer",
    "round_stop_request",
    "group_pledge",
    "learning_enrolment",
    "youth_application",
)

GUARDIAN_CONSENT_STATUSES = ("not_required", "pending", "confirmed", "revoked")

RESPONSE_STATUSES = ("submitted", "shortlisted", "accepted", "declined", "withdrawn")

SETTLEMENT_METHODS = ("direct_mpesa", "direct_cash", "in_kind", "cost_share", "free")

BOOKING_STATUSES_LEDGER = (
    "agreed",
    "in_progress",
    "organizer_completed",
    "participant_completed",
    "completed",
    "cancelled",
)

FEEDBACK_OUTCOMES = ("completed_as_agreed", "completed_with_changes", "issue_reported")

RELATIONSHIP_KINDS = (
    "artisan",
    "supplier",
    "household",
    "institution",
    "service_provider",
    "collection_point",
)


class LocalActivity(Base):
    """Canonical record for Available, Wanted, Scheduled, and Opportunity postings."""

    __tablename__ = "local_activities"
    __table_args__ = (
        CheckConstraint("char_length(body) >= 8", name="ck_local_activities_body_len"),
        CheckConstraint(
            "posting_type IN ('available','wanted','scheduled','opportunity')",
            name="ck_local_activities_posting_type",
        ),
        CheckConstraint(
            "inferred_template IN ('repair_artisan','agricultural_produce_fodder',"
            "'tool_lending','collection_point','travelling_round','community_learning',"
            "'supervised_youth_task','group_sourcing','general')",
            name="ck_local_activities_template",
        ),
        CheckConstraint(
            "location_scope IN ('homestead_private','estate','neighbourhood','ward','town','county')",
            name="ck_local_activities_location_scope",
        ),
        CheckConstraint(
            "geo_precision IN ('approximate','exact_for_confirmed','exact','none')",
            name="ck_local_activities_geo_precision",
        ),
        CheckConstraint(
            "visibility IN ('public','community','saved_contacts','private')",
            name="ck_local_activities_visibility",
        ),
        CheckConstraint(
            "price_basis IN ('quote_requested','fixed','per_unit','cost_share','free')",
            name="ck_local_activities_price_basis",
        ),
        CheckConstraint(
            "lifecycle_status IN ('published','notified','responses_received',"
            "'booking_agreed','in_progress','completed','cancelled','expired')",
            name="ck_local_activities_lifecycle_status",
        ),
        CheckConstraint(
            "price_kes IS NULL OR price_kes >= 0",
            name="ck_local_activities_price_nonneg",
        ),
        Index("ix_local_activities_status_created", "lifecycle_status", "created_at"),
        Index("ix_local_activities_type_created", "posting_type", "created_at"),
        Index("ix_local_activities_geo", "geo_lat", "geo_lng"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )

    posting_type = Column(String(20), nullable=False, index=True)
    inferred_template = Column(String(40), nullable=False, default="general", server_default="general", index=True)
    category = Column(String(100), nullable=True, index=True)
    title = Column(String(220), nullable=False)
    body = Column(Text, nullable=False)
    media = Column(JSONB, nullable=False, default=list, server_default=sa_text("'[]'::jsonb"))
    tags = Column(JSONB, nullable=False, default=list, server_default=sa_text("'[]'::jsonb"))

    # Location & privacy
    area_name = Column(String(240), nullable=True, index=True)
    location_scope = Column(String(24), nullable=False, default="neighbourhood", server_default="neighbourhood")
    geo_lat = Column(Float, nullable=True)
    geo_lng = Column(Float, nullable=True)
    geo_precision = Column(String(24), nullable=False, default="approximate", server_default="approximate")
    private_directions = Column(Text, nullable=True)

    # Schedule & capacity
    starts_at = Column(DateTime, nullable=True, index=True)
    ends_at = Column(DateTime, nullable=True)
    schedule_label = Column(String(160), nullable=True)
    capacity = Column(Integer, nullable=True)
    spots_confirmed = Column(Integer, nullable=False, default=0, server_default="0")

    # Permissions & youth safety
    visibility = Column(String(24), nullable=False, default="public", server_default="public", index=True)
    permission_rules = Column(JSONB, nullable=False, default=dict, server_default=sa_text("'{}'::jsonb"))
    template_fields = Column(JSONB, nullable=False, default=dict, server_default=sa_text("'{}'::jsonb"))

    # Optional non-custodial price signal
    price_kes = Column(Integer, nullable=True)
    price_basis = Column(String(24), nullable=False, default="quote_requested", server_default="quote_requested")

    # Lifecycle counters
    lifecycle_status = Column(String(28), nullable=False, default="published", server_default="published", index=True)
    notified_count = Column(Integer, nullable=False, default=0, server_default="0")
    response_count = Column(Integer, nullable=False, default=0, server_default="0")
    reused_from_activity_id = Column(
        UUID(as_uuid=True), ForeignKey("local_activities.id", ondelete="SET NULL"), nullable=True
    )

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    organizer = relationship("Vendor", foreign_keys=[organizer_vendor_id])
    responses = relationship("ActivityResponse", back_populates="activity", cascade="all, delete-orphan")
    bookings = relationship("ActivityBooking", back_populates="activity", cascade="all, delete-orphan")


class ActivityResponse(Base):
    """A quote, supply offer, group-order pledge, area-round stop request, or enrolment."""

    __tablename__ = "activity_responses"
    __table_args__ = (
        UniqueConstraint("activity_id", "responder_vendor_id", name="uq_activity_response_responder"),
        CheckConstraint(
            "response_type IN ('quote','supply_offer','round_stop_request',"
            "'group_pledge','learning_enrolment','youth_application')",
            name="ck_activity_responses_type",
        ),
        CheckConstraint(
            "guardian_consent_status IN ('not_required','pending','confirmed','revoked')",
            name="ck_activity_responses_guardian_consent",
        ),
        CheckConstraint(
            "status IN ('submitted','shortlisted','accepted','declined','withdrawn')",
            name="ck_activity_responses_status",
        ),
        CheckConstraint(
            "quoted_price_kes IS NULL OR quoted_price_kes >= 0",
            name="ck_activity_responses_price_nonneg",
        ),
        CheckConstraint(
            "quantity IS NULL OR quantity > 0",
            name="ck_activity_responses_quantity_pos",
        ),
        Index("ix_activity_responses_activity_status", "activity_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id = Column(
        UUID(as_uuid=True), ForeignKey("local_activities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    responder_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )

    response_type = Column(String(28), nullable=False, default="quote", server_default="quote")
    quoted_price_kes = Column(Integer, nullable=True)
    quantity = Column(Float, nullable=True)  # Float supports 2.5 tonnes fodder, 0.5 bag, 15 bales
    unit = Column(String(40), nullable=True)
    availability_window = Column(String(160), nullable=True)
    proposed_completion_time = Column(String(160), nullable=True)
    relevant_experience = Column(Text, nullable=True)
    note = Column(Text, nullable=False)
    private_stop_directions = Column(Text, nullable=True)

    # Youth supervision & guardian consent fields
    guardian_consent_status = Column(
        String(24), nullable=False, default="not_required", server_default="not_required"
    )
    guardian_name_and_contact = Column(String(200), nullable=True)

    status = Column(String(20), nullable=False, default="submitted", server_default="submitted", index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    activity = relationship("LocalActivity", back_populates="responses")
    responder = relationship("Vendor", foreign_keys=[responder_vendor_id])


class ActivityBooking(Base):
    """Non-custodial booking agreement & two-party completion record.

    Settlement is always direct between participants (`direct_mpesa`,
    `direct_cash`, `in_kind`, `cost_share`, `free`). Platform custody does not
    exist on this table by design.
    """

    __tablename__ = "activity_bookings"
    __table_args__ = (
        CheckConstraint(
            "settlement_method IN ('direct_mpesa','direct_cash','in_kind','cost_share','free')",
            name="ck_activity_bookings_settlement_noncustodial",
        ),
        CheckConstraint(
            "status IN ('agreed','in_progress','organizer_completed',"
            "'participant_completed','completed','cancelled')",
            name="ck_activity_bookings_status",
        ),
        CheckConstraint(
            "agreed_price_kes IS NULL OR agreed_price_kes >= 0",
            name="ck_activity_bookings_price_nonneg",
        ),
        CheckConstraint(
            "agreed_quantity IS NULL OR agreed_quantity > 0",
            name="ck_activity_bookings_quantity_pos",
        ),
        Index("ix_activity_bookings_organizer_status", "organizer_vendor_id", "status"),
        Index("ix_activity_bookings_participant_status", "participant_vendor_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id = Column(
        UUID(as_uuid=True), ForeignKey("local_activities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    response_id = Column(
        UUID(as_uuid=True), ForeignKey("activity_responses.id", ondelete="SET NULL"), nullable=True
    )
    organizer_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    participant_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )

    agreed_scope = Column(Text, nullable=False)
    agreed_quantity = Column(Float, nullable=True)
    agreed_unit = Column(String(40), nullable=True)
    agreed_price_kes = Column(Integer, nullable=True)
    settlement_method = Column(String(24), nullable=False, default="direct_mpesa", server_default="direct_mpesa")

    scheduled_start = Column(DateTime, nullable=True, index=True)
    scheduled_end = Column(DateTime, nullable=True)
    slot_label = Column(String(120), nullable=True)
    stop_sequence = Column(Integer, nullable=True)  # Ordered stop index for travelling artisan rounds

    share_private_directions = Column(Boolean, nullable=False, default=False, server_default="false")
    agreed_changes = Column(JSONB, nullable=False, default=list, server_default=sa_text("'[]'::jsonb"))

    status = Column(String(28), nullable=False, default="agreed", server_default="agreed", index=True)
    organizer_confirmed_at = Column(DateTime, nullable=True)
    participant_confirmed_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True, index=True)

    source_booking_id = Column(
        UUID(as_uuid=True), ForeignKey("activity_bookings.id", ondelete="SET NULL"), nullable=True
    )

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    activity = relationship("LocalActivity", back_populates="bookings")
    organizer = relationship("Vendor", foreign_keys=[organizer_vendor_id])
    participant = relationship("Vendor", foreign_keys=[participant_vendor_id])
    feedback_entries = relationship("ActivityFeedback", back_populates="booking", cascade="all, delete-orphan")


class ActivityFeedback(Base):
    """Factual post-completion record from either party — no opaque composite grades."""

    __tablename__ = "activity_feedback"
    __table_args__ = (
        UniqueConstraint("booking_id", "author_vendor_id", name="uq_activity_feedback_author"),
        CheckConstraint(
            "outcome IN ('completed_as_agreed','completed_with_changes','issue_reported')",
            name="ck_activity_feedback_outcome",
        ),
        Index("ix_activity_feedback_target", "target_vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    booking_id = Column(
        UUID(as_uuid=True), ForeignKey("activity_bookings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False
    )
    target_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )

    outcome = Column(String(28), nullable=False)
    would_repeat = Column(Boolean, nullable=False, default=True, server_default="true")
    tags = Column(JSONB, nullable=False, default=list, server_default=sa_text("'[]'::jsonb"))
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    booking = relationship("ActivityBooking", back_populates="feedback_entries")


class ActivityLedgerEvent(Base):
    """Append-only lifecycle log for every state transition on an activity."""

    __tablename__ = "activity_ledger_events"
    __table_args__ = (
        Index("ix_activity_ledger_events_activity_created", "activity_id", "created_at"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    activity_id = Column(
        UUID(as_uuid=True), ForeignKey("local_activities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id = Column(
        UUID(as_uuid=True), ForeignKey("activity_bookings.id", ondelete="SET NULL"), nullable=True
    )
    actor_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    event_type = Column(String(40), nullable=False)
    summary = Column(String(280), nullable=False)
    payload = Column(JSONB, nullable=False, default=dict, server_default=sa_text("'{}'::jsonb"))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ActivityWatch(Base):
    """Preference-based local notification subscription."""

    __tablename__ = "activity_watches"
    __table_args__ = (
        CheckConstraint("radius_km >= 0.5 AND radius_km <= 200", name="ck_activity_watches_radius"),
        Index("ix_activity_watches_vendor_active", "vendor_id", "is_active"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label = Column(String(140), nullable=False)
    posting_types = Column(JSONB, nullable=False, default=list, server_default=sa_text("'[]'::jsonb"))
    categories = Column(JSONB, nullable=False, default=list, server_default=sa_text("'[]'::jsonb"))
    keywords = Column(String(200), nullable=True)
    area_name = Column(String(200), nullable=True)
    geo_lat = Column(Float, nullable=True)
    geo_lng = Column(Float, nullable=True)
    radius_km = Column(Float, nullable=False, default=10.0, server_default="10")
    days_of_week = Column(JSONB, nullable=False, default=list, server_default=sa_text("'[]'::jsonb"))
    only_youth_eligible = Column(Boolean, nullable=False, default=False, server_default="false")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    last_triggered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class SavedRelationship(Base):
    """Private trusted local contact (artisan, supplier, home, institution, provider)."""

    __tablename__ = "saved_relationships"
    __table_args__ = (
        UniqueConstraint("owner_vendor_id", "target_vendor_id", name="uq_saved_relationship_pair"),
        CheckConstraint(
            "relationship_kind IN ('artisan','supplier','household','institution',"
            "'service_provider','collection_point')",
            name="ck_saved_relationships_kind",
        ),
        Index("ix_saved_relationships_owner", "owner_vendor_id", "relationship_kind"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )

    relationship_kind = Column(
        String(28), nullable=False, default="service_provider", server_default="service_provider"
    )
    label = Column(String(120), nullable=True)
    categories = Column(JSONB, nullable=False, default=list, server_default=sa_text("'[]'::jsonb"))
    private_note = Column(Text, nullable=True)
    notify_when_active = Column(Boolean, nullable=False, default=True, server_default="true")
    last_booking_id = Column(
        UUID(as_uuid=True), ForeignKey("activity_bookings.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("Vendor", foreign_keys=[owner_vendor_id])
    target = relationship("Vendor", foreign_keys=[target_vendor_id])


__all__ = [
    "LocalActivity",
    "ActivityResponse",
    "ActivityBooking",
    "ActivityFeedback",
    "ActivityLedgerEvent",
    "ActivityWatch",
    "SavedRelationship",
    "POSTING_TYPES",
    "ACTIVITY_TEMPLATES",
    "LOCATION_SCOPES",
    "ACTIVITY_GEO_PRECISIONS",
    "ACTIVITY_VISIBILITIES",
    "PRICE_BASES",
    "LIFECYCLE_STATUSES",
    "RESPONSE_TYPES",
    "GUARDIAN_CONSENT_STATUSES",
    "RESPONSE_STATUSES",
    "SETTLEMENT_METHODS",
    "BOOKING_STATUSES_LEDGER",
    "FEEDBACK_OUTCOMES",
    "RELATIONSHIP_KINDS",
]

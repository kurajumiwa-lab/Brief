"""Local Activity Ledger & inclusive community participation.

Purely additive migration:
  * Adds `account_kind`, `hide_exact_location`, and `home_storefront_config`
    to `vendors` (existing rows default to `'business'`).
  * Adds `acted_upon_at` to `notifications` to track acted-upon local alerts.
  * Creates the 7 Local Activity Ledger tables (`local_activities`,
    `activity_responses`, `activity_bookings`, `activity_feedback`,
    `activity_ledger_events`, `activity_watches`, `saved_relationships`).

No existing column is dropped, renamed, or tightened. `downgrade -1` cleanly
reverses everything added here.

Revision ID: 0022_local_activity_ledger
Revises: 0021_outside_content
Create Date: 2026-10-23
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

from alembic import op

revision: str = "0022_local_activity_ledger"
down_revision: str = "0021_outside_content"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. inclusive account columns on vendors ────────────────────────────
    op.add_column(
        "vendors",
        sa.Column("account_kind", sa.String(24), nullable=False, server_default="business"),
    )
    op.create_check_constraint(
        "ck_vendors_account_kind",
        "vendors",
        "account_kind IN ('person','household','artisan','institution','business')",
    )
    op.create_index("ix_vendors_account_kind", "vendors", ["account_kind"])
    op.add_column(
        "vendors",
        sa.Column("hide_exact_location", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "vendors",
        sa.Column(
            "home_storefront_config",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )

    # ── 2. acted-upon tracking on notifications ────────────────────────────
    op.add_column(
        "notifications",
        sa.Column("acted_upon_at", sa.DateTime(), nullable=True),
    )

    # ── 3. local_activities ────────────────────────────────────────────────
    op.create_table(
        "local_activities",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "organizer_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("posting_type", sa.String(20), nullable=False),
        sa.Column("inferred_template", sa.String(40), nullable=False, server_default="general"),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("media", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("area_name", sa.String(240), nullable=True),
        sa.Column("location_scope", sa.String(24), nullable=False, server_default="neighbourhood"),
        sa.Column("geo_lat", sa.Float(), nullable=True),
        sa.Column("geo_lng", sa.Float(), nullable=True),
        sa.Column("geo_precision", sa.String(24), nullable=False, server_default="approximate"),
        sa.Column("private_directions", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("schedule_label", sa.String(160), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("spots_confirmed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("visibility", sa.String(24), nullable=False, server_default="public"),
        sa.Column("permission_rules", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("template_fields", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("price_kes", sa.Integer(), nullable=True),
        sa.Column("price_basis", sa.String(24), nullable=False, server_default="quote_requested"),
        sa.Column("lifecycle_status", sa.String(28), nullable=False, server_default="published"),
        sa.Column("notified_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("response_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "reused_from_activity_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("local_activities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("char_length(body) >= 8", name="ck_local_activities_body_len"),
        sa.CheckConstraint(
            "posting_type IN ('available','wanted','scheduled','opportunity')",
            name="ck_local_activities_posting_type",
        ),
        sa.CheckConstraint(
            "inferred_template IN ('repair_artisan','agricultural_produce_fodder',"
            "'tool_lending','collection_point','travelling_round','community_learning',"
            "'supervised_youth_task','group_sourcing','general')",
            name="ck_local_activities_template",
        ),
        sa.CheckConstraint(
            "location_scope IN ('homestead_private','estate','neighbourhood','ward','town','county')",
            name="ck_local_activities_location_scope",
        ),
        sa.CheckConstraint(
            "geo_precision IN ('approximate','exact_for_confirmed','exact','none')",
            name="ck_local_activities_geo_precision",
        ),
        sa.CheckConstraint(
            "visibility IN ('public','community','saved_contacts','private')",
            name="ck_local_activities_visibility",
        ),
        sa.CheckConstraint(
            "price_basis IN ('quote_requested','fixed','per_unit','cost_share','free')",
            name="ck_local_activities_price_basis",
        ),
        sa.CheckConstraint(
            "lifecycle_status IN ('published','notified','responses_received',"
            "'booking_agreed','in_progress','completed','cancelled','expired')",
            name="ck_local_activities_lifecycle_status",
        ),
        sa.CheckConstraint(
            "price_kes IS NULL OR price_kes >= 0",
            name="ck_local_activities_price_nonneg",
        ),
    )
    op.create_index("ix_local_activities_organizer_vendor_id", "local_activities", ["organizer_vendor_id"])
    op.create_index("ix_local_activities_posting_type", "local_activities", ["posting_type"])
    op.create_index("ix_local_activities_inferred_template", "local_activities", ["inferred_template"])
    op.create_index("ix_local_activities_category", "local_activities", ["category"])
    op.create_index("ix_local_activities_area_name", "local_activities", ["area_name"])
    op.create_index("ix_local_activities_starts_at", "local_activities", ["starts_at"])
    op.create_index("ix_local_activities_visibility", "local_activities", ["visibility"])
    op.create_index("ix_local_activities_lifecycle_status", "local_activities", ["lifecycle_status"])
    op.create_index("ix_local_activities_created_at", "local_activities", ["created_at"])
    op.create_index(
        "ix_local_activities_status_created", "local_activities", ["lifecycle_status", "created_at"]
    )
    op.create_index(
        "ix_local_activities_type_created", "local_activities", ["posting_type", "created_at"]
    )
    op.create_index("ix_local_activities_geo", "local_activities", ["geo_lat", "geo_lng"])

    # ── 4. activity_responses ──────────────────────────────────────────────
    op.create_table(
        "activity_responses",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "activity_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("local_activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "responder_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("response_type", sa.String(28), nullable=False, server_default="quote"),
        sa.Column("quoted_price_kes", sa.Integer(), nullable=True),
        sa.Column("quantity", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(40), nullable=True),
        sa.Column("availability_window", sa.String(160), nullable=True),
        sa.Column("proposed_completion_time", sa.String(160), nullable=True),
        sa.Column("relevant_experience", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("private_stop_directions", sa.Text(), nullable=True),
        sa.Column("guardian_consent_status", sa.String(24), nullable=False, server_default="not_required"),
        sa.Column("guardian_name_and_contact", sa.String(200), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="submitted"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("activity_id", "responder_vendor_id", name="uq_activity_response_responder"),
        sa.CheckConstraint(
            "response_type IN ('quote','supply_offer','round_stop_request',"
            "'group_pledge','learning_enrolment','youth_application')",
            name="ck_activity_responses_type",
        ),
        sa.CheckConstraint(
            "guardian_consent_status IN ('not_required','pending','confirmed','revoked')",
            name="ck_activity_responses_guardian_consent",
        ),
        sa.CheckConstraint(
            "status IN ('submitted','shortlisted','accepted','declined','withdrawn')",
            name="ck_activity_responses_status",
        ),
        sa.CheckConstraint(
            "quoted_price_kes IS NULL OR quoted_price_kes >= 0",
            name="ck_activity_responses_price_nonneg",
        ),
        sa.CheckConstraint(
            "quantity IS NULL OR quantity > 0",
            name="ck_activity_responses_quantity_pos",
        ),
    )
    op.create_index("ix_activity_responses_activity_id", "activity_responses", ["activity_id"])
    op.create_index("ix_activity_responses_responder_vendor_id", "activity_responses", ["responder_vendor_id"])
    op.create_index("ix_activity_responses_status", "activity_responses", ["status"])
    op.create_index(
        "ix_activity_responses_activity_status", "activity_responses", ["activity_id", "status"]
    )

    # ── 5. activity_bookings ───────────────────────────────────────────────
    op.create_table(
        "activity_bookings",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "activity_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("local_activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "response_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("activity_responses.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "organizer_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "participant_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("agreed_scope", sa.Text(), nullable=False),
        sa.Column("agreed_quantity", sa.Float(), nullable=True),
        sa.Column("agreed_unit", sa.String(40), nullable=True),
        sa.Column("agreed_price_kes", sa.Integer(), nullable=True),
        sa.Column("settlement_method", sa.String(24), nullable=False, server_default="direct_mpesa"),
        sa.Column("scheduled_start", sa.DateTime(), nullable=True),
        sa.Column("scheduled_end", sa.DateTime(), nullable=True),
        sa.Column("slot_label", sa.String(120), nullable=True),
        sa.Column("stop_sequence", sa.Integer(), nullable=True),
        sa.Column(
            "share_private_directions", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("agreed_changes", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(28), nullable=False, server_default="agreed"),
        sa.Column("organizer_confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("participant_confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column(
            "source_booking_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("activity_bookings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "settlement_method IN ('direct_mpesa','direct_cash','in_kind','cost_share','free')",
            name="ck_activity_bookings_settlement_noncustodial",
        ),
        sa.CheckConstraint(
            "status IN ('agreed','in_progress','organizer_completed',"
            "'participant_completed','completed','cancelled')",
            name="ck_activity_bookings_status",
        ),
        sa.CheckConstraint(
            "agreed_price_kes IS NULL OR agreed_price_kes >= 0",
            name="ck_activity_bookings_price_nonneg",
        ),
        sa.CheckConstraint(
            "agreed_quantity IS NULL OR agreed_quantity > 0",
            name="ck_activity_bookings_quantity_pos",
        ),
    )
    op.create_index("ix_activity_bookings_activity_id", "activity_bookings", ["activity_id"])
    op.create_index(
        "ix_activity_bookings_organizer_vendor_id", "activity_bookings", ["organizer_vendor_id"]
    )
    op.create_index(
        "ix_activity_bookings_participant_vendor_id", "activity_bookings", ["participant_vendor_id"]
    )
    op.create_index("ix_activity_bookings_scheduled_start", "activity_bookings", ["scheduled_start"])
    op.create_index("ix_activity_bookings_status", "activity_bookings", ["status"])
    op.create_index("ix_activity_bookings_completed_at", "activity_bookings", ["completed_at"])
    op.create_index(
        "ix_activity_bookings_organizer_status", "activity_bookings", ["organizer_vendor_id", "status"]
    )
    op.create_index(
        "ix_activity_bookings_participant_status", "activity_bookings", ["participant_vendor_id", "status"]
    )

    # ── 6. activity_feedback ───────────────────────────────────────────────
    op.create_table(
        "activity_feedback",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "booking_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("activity_bookings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("outcome", sa.String(28), nullable=False),
        sa.Column("would_repeat", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("booking_id", "author_vendor_id", name="uq_activity_feedback_author"),
        sa.CheckConstraint(
            "outcome IN ('completed_as_agreed','completed_with_changes','issue_reported')",
            name="ck_activity_feedback_outcome",
        ),
    )
    op.create_index("ix_activity_feedback_booking_id", "activity_feedback", ["booking_id"])
    op.create_index("ix_activity_feedback_target_vendor_id", "activity_feedback", ["target_vendor_id"])
    op.create_index(
        "ix_activity_feedback_target", "activity_feedback", ["target_vendor_id", "created_at"]
    )

    # ── 7. activity_ledger_events ──────────────────────────────────────────
    op.create_table(
        "activity_ledger_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "activity_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("local_activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "booking_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("activity_bookings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "actor_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("summary", sa.String(280), nullable=False),
        sa.Column("payload", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_activity_ledger_events_activity_id", "activity_ledger_events", ["activity_id"])
    op.create_index(
        "ix_activity_ledger_events_activity_created",
        "activity_ledger_events",
        ["activity_id", "created_at"],
    )

    # ── 8. activity_watches ────────────────────────────────────────────────
    op.create_table(
        "activity_watches",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(140), nullable=False),
        sa.Column("posting_types", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("categories", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("keywords", sa.String(200), nullable=True),
        sa.Column("area_name", sa.String(200), nullable=True),
        sa.Column("geo_lat", sa.Float(), nullable=True),
        sa.Column("geo_lng", sa.Float(), nullable=True),
        sa.Column("radius_km", sa.Float(), nullable=False, server_default="10"),
        sa.Column("days_of_week", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("only_youth_eligible", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_triggered_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("radius_km >= 0.5 AND radius_km <= 200", name="ck_activity_watches_radius"),
    )
    op.create_index("ix_activity_watches_vendor_id", "activity_watches", ["vendor_id"])
    op.create_index(
        "ix_activity_watches_vendor_active", "activity_watches", ["vendor_id", "is_active"]
    )

    # ── 9. saved_relationships ─────────────────────────────────────────────
    op.create_table(
        "saved_relationships",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_vendor_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("relationship_kind", sa.String(28), nullable=False, server_default="service_provider"),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("categories", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("private_note", sa.Text(), nullable=True),
        sa.Column("notify_when_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "last_booking_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("activity_bookings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("owner_vendor_id", "target_vendor_id", name="uq_saved_relationship_pair"),
        sa.CheckConstraint(
            "relationship_kind IN ('artisan','supplier','household','institution',"
            "'service_provider','collection_point')",
            name="ck_saved_relationships_kind",
        ),
    )
    op.create_index("ix_saved_relationships_owner_vendor_id", "saved_relationships", ["owner_vendor_id"])
    op.create_index("ix_saved_relationships_target_vendor_id", "saved_relationships", ["target_vendor_id"])
    op.create_index(
        "ix_saved_relationships_owner",
        "saved_relationships",
        ["owner_vendor_id", "relationship_kind"],
    )


def downgrade() -> None:
    op.drop_table("saved_relationships")
    op.drop_table("activity_watches")
    op.drop_table("activity_ledger_events")
    op.drop_table("activity_feedback")
    op.drop_table("activity_bookings")
    op.drop_table("activity_responses")
    op.drop_table("local_activities")
    op.drop_column("notifications", "acted_upon_at")
    op.drop_column("vendors", "home_storefront_config")
    op.drop_column("vendors", "hide_exact_location")
    op.drop_index("ix_vendors_account_kind", table_name="vendors")
    op.drop_constraint("ck_vendors_account_kind", "vendors", type_="check")
    op.drop_column("vendors", "account_kind")

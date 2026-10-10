"""Persist live marketplace order, fulfilment, payment and dispute details.

Revision ID: 0014_live_order_journey
Revises: 0013_trade_events_outbox
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014_live_order_journey"
down_revision = "0013_trade_events_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NotificationType stores Python enum member names in PostgreSQL.
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'DELIVERY_QUOTE_REQUEST'")

    op.add_column(
        "vendors",
        sa.Column("allow_direct_calls", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.add_column("chat_rooms", sa.Column("stock_movement_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_chat_rooms_stock_movement_id_stock_movements",
        "chat_rooms", "stock_movements", ["stock_movement_id"], ["id"], ondelete="CASCADE",
    )
    op.create_unique_constraint("uq_chat_rooms_stock_movement_id", "chat_rooms", ["stock_movement_id"])

    # PSP payment table constraints are expanded before order payments can be written.
    op.drop_constraint("ck_payment_intent_entity_type", "payment_intents", type_="check")
    op.create_check_constraint(
        "ck_payment_intent_entity_type", "payment_intents",
        "entity_type IN ('pick_deposit','pick_full_payment','chama_deposit','chama_loan_repayment',"
        "'sacco_savings','sacco_loan_repayment','pool_ride_share','murabaha_repayment',"
        "'musharakah_profit','stock_movement_payment')",
    )
    op.drop_constraint("ck_disbursement_entity_type", "disbursements", type_="check")
    op.create_check_constraint(
        "ck_disbursement_entity_type", "disbursements",
        "entity_type IN ('pick_settlement','pick_refund','chama_loan','chama_dividend','sacco_loan',"
        "'sacco_dividend','sacco_withdrawal','price_shield_credit','network_benefit',"
        "'pool_ride_transporter','movement_settlement','movement_delivery')",
    )
    op.create_index(
        "uq_order_payment_one_active_intent", "payment_intents", ["entity_id"], unique=True,
        postgresql_where=sa.text(
            "entity_type = 'stock_movement_payment' AND status IN ('pending','completed')"
        ),
    )

    op.create_table(
        "payment_refunds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("payment_intent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount_ksh", sa.Integer(), nullable=False),
        sa.Column("product_refund_ksh", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivery_refund_ksh", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("platform_fee_refund_ksh", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reason", sa.String(length=400), nullable=False),
        sa.Column("api_ref", sa.String(length=80), nullable=False, unique=True),
        sa.Column("psp_ref", sa.String(length=80), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("failure_reason", sa.String(length=400), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("amount_ksh > 0", name="ck_payment_refund_amount_positive"),
        sa.CheckConstraint(
            "product_refund_ksh >= 0 AND delivery_refund_ksh >= 0 AND platform_fee_refund_ksh >= 0",
            name="ck_payment_refund_allocation_nonnegative",
        ),
        sa.CheckConstraint("status IN ('pending','completed','failed')", name="ck_payment_refund_status"),
        sa.ForeignKeyConstraint(["payment_intent_id"], ["payment_intents.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_payment_refunds_intent", "payment_refunds", ["payment_intent_id", "created_at"])
    op.create_index(
        "uq_payment_refunds_one_pending_per_intent", "payment_refunds", ["payment_intent_id"],
        unique=True, postgresql_where=sa.text("status = 'pending'"),
    )

    op.create_table(
        "delivery_quote_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("movement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requester_vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("courier_registration_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider_type", sa.String(length=24), nullable=False),
        sa.Column("destination_address", sa.String(length=500), nullable=False),
        sa.Column("scheduled_start", sa.DateTime(), nullable=True),
        sa.Column("scheduled_end", sa.DateTime(), nullable=True),
        sa.Column("customer_note", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "provider_type IN ('supplier_delivery','courier','errand','scheduled')",
            name="ck_delivery_quote_request_provider_type",
        ),
        sa.CheckConstraint("status IN ('open','quoted','cancelled')", name="ck_delivery_quote_request_status"),
        sa.ForeignKeyConstraint(["movement_id"], ["stock_movements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requester_vendor_id"], ["vendors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["courier_registration_id"], ["courier_registrations.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_delivery_quote_requests_movement_id", "delivery_quote_requests", ["movement_id"])
    op.create_index("ix_delivery_quote_requests_status", "delivery_quote_requests", ["status", "created_at"])

    op.create_table(
        "delivery_quotes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("movement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider_vendor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("provider_type", sa.String(length=24), nullable=False),
        sa.Column("provider_name", sa.String(length=200), nullable=False),
        sa.Column("price_ksh", sa.Integer(), nullable=False),
        sa.Column("eta_text", sa.String(length=160), nullable=True),
        sa.Column("pickup_address", sa.String(length=500), nullable=True),
        sa.Column("destination_address", sa.String(length=500), nullable=True),
        sa.Column("ready_for_collection", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("collection_instructions", sa.String(length=1000), nullable=True),
        sa.Column("scheduled_start", sa.DateTime(), nullable=True),
        sa.Column("scheduled_end", sa.DateTime(), nullable=True),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="offered"),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "provider_type IN ('self_pickup','supplier_delivery','courier','errand','scheduled')",
            name="ck_delivery_quote_provider_type",
        ),
        sa.CheckConstraint("price_ksh >= 0", name="ck_delivery_quote_price_nonnegative"),
        sa.CheckConstraint("status IN ('offered','selected','withdrawn','expired')", name="ck_delivery_quote_status"),
        sa.ForeignKeyConstraint(["movement_id"], ["stock_movements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["request_id"], ["delivery_quote_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["provider_vendor_id"], ["vendors.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_delivery_quotes_movement_id", "delivery_quotes", ["movement_id"])
    op.create_index("ix_delivery_quotes_movement_status", "delivery_quotes", ["movement_id", "status"])

    op.create_table(
        "order_transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("movement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_amount_ksh", sa.Integer(), nullable=False),
        sa.Column("platform_fee_ksh", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("selected_quote_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("destination_address", sa.Text(), nullable=True),
        sa.Column("delivery_mode", sa.String(length=24), nullable=True),
        sa.Column("pickup_address", sa.Text(), nullable=True),
        sa.Column("pickup_instructions", sa.Text(), nullable=True),
        sa.Column("pickup_hours", sa.String(length=300), nullable=True),
        sa.Column("ready_for_collection", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pickup_ready_at", sa.DateTime(), nullable=True),
        sa.Column("receipt_code_hash", sa.String(length=128), nullable=True),
        sa.Column("receipt_code_expires_at", sa.DateTime(), nullable=True),
        sa.Column("settlement_status", sa.String(length=24), nullable=False, server_default="not_started"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("product_amount_ksh >= 0", name="ck_order_transaction_products_nonnegative"),
        sa.CheckConstraint("platform_fee_ksh >= 0", name="ck_order_transaction_fee_nonnegative"),
        sa.CheckConstraint(
            "settlement_status IN ('not_started','pending','pending_approval','settled',"
            "'blocked_by_dispute','refund_pending','refunded','failed','unavailable','not_applicable')",
            name="ck_order_transaction_settlement_status",
        ),
        sa.ForeignKeyConstraint(["movement_id"], ["stock_movements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["selected_quote_id"], ["delivery_quotes.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("movement_id", name="uq_order_transaction_movement"),
    )
    op.create_index("ix_order_transactions_movement_id", "order_transactions", ["movement_id"])

    op.create_table(
        "movement_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("movement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=48), nullable=False),
        sa.Column("actor_vendor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["movement_id"], ["stock_movements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_vendor_id"], ["vendors.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_movement_events_movement_created", "movement_events", ["movement_id", "created_at"])

    op.create_table(
        "order_disputes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("movement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("opened_by_vendor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("outcome", sa.String(length=24), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("resolved_by_vendor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "category IN ('missing_goods','incorrect_quantity','damaged_goods','cancellation',"
            "'payment_problem','delivery_failure','other')",
            name="ck_order_dispute_category",
        ),
        sa.CheckConstraint("status IN ('open','in_review','resolved')", name="ck_order_dispute_status"),
        sa.ForeignKeyConstraint(["movement_id"], ["stock_movements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["opened_by_vendor_id"], ["vendors.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by_vendor_id"], ["vendors.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_order_disputes_movement_id", "order_disputes", ["movement_id"])
    op.create_index("ix_order_disputes_movement_status", "order_disputes", ["movement_id", "status"])


def downgrade() -> None:
    # PostgreSQL enum additions are intentionally retained, as in earlier
    # revisions. Expanded payment/disbursement type checks also remain valid
    # when the API is rolled back; dropping them could reject existing rows.
    op.drop_index("uq_order_payment_one_active_intent", table_name="payment_intents")
    op.drop_table("order_disputes")
    op.drop_table("movement_events")
    op.drop_index("ix_order_transactions_movement_id", table_name="order_transactions")
    op.drop_table("order_transactions")
    op.drop_index("ix_delivery_quotes_movement_status", table_name="delivery_quotes")
    op.drop_index("ix_delivery_quotes_movement_id", table_name="delivery_quotes")
    op.drop_table("delivery_quotes")
    op.drop_index("ix_delivery_quote_requests_status", table_name="delivery_quote_requests")
    op.drop_index("ix_delivery_quote_requests_movement_id", table_name="delivery_quote_requests")
    op.drop_table("delivery_quote_requests")
    op.drop_index("uq_payment_refunds_one_pending_per_intent", table_name="payment_refunds")
    op.drop_index("ix_payment_refunds_intent", table_name="payment_refunds")
    op.drop_table("payment_refunds")
    op.drop_constraint("uq_chat_rooms_stock_movement_id", "chat_rooms", type_="unique")
    op.drop_constraint("fk_chat_rooms_stock_movement_id_stock_movements", "chat_rooms", type_="foreignkey")
    op.drop_column("chat_rooms", "stock_movement_id")
    op.drop_column("vendors", "allow_direct_calls")

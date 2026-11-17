"""Work-from-home task and commission board.

Revision ID: 0066_wfh_tasks
Revises: 0065_handle_redirects

No money is held here. A task records a peer-to-peer M-Pesa arrangement and a
platform fee *ledger*; the two parties settle directly. Nothing in this schema
confers standing or verification.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0066_wfh_tasks"
down_revision = "0065_handle_redirects"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "corridor_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("creator_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignee_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("region_slug", sa.String(64), nullable=False),
        sa.Column("town", sa.String(64), nullable=False),
        sa.Column("task_type", sa.String(32), nullable=False),
        sa.Column("title", sa.String(140), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("worker_payout_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("platform_fee_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("fee_pct", sa.Numeric(5, 2), nullable=False),
        sa.Column("payment_tag_snapshot", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(24), nullable=False, server_default="OPEN"),
        sa.Column("min_standing_level", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("proof_payload", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("claim_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint(
            "task_type IN ('DELIVERY_HANDOFF','DEAL_SPOT_CHECK','MERCHANT_ONBOARD','ERRAND_PICKUP')",
            name="ck_corridor_task_type",
        ),
        sa.CheckConstraint(
            "status IN ('OPEN','CLAIMED','PROOF_SUBMITTED','COMPLETED','EXPIRED','DISPUTED')",
            name="ck_corridor_task_status",
        ),
        sa.CheckConstraint("worker_payout_kes > 0", name="ck_corridor_task_payout_positive"),
        sa.CheckConstraint("platform_fee_kes >= 0", name="ck_corridor_task_fee_nonnegative"),
        sa.CheckConstraint("fee_pct >= 5 AND fee_pct <= 8", name="ck_corridor_task_fee_pct"),
        sa.CheckConstraint("min_standing_level BETWEEN 1 AND 4",
                           name="ck_corridor_task_min_standing"),
        sa.CheckConstraint("assignee_user_id IS NULL OR assignee_user_id <> creator_user_id",
                           name="ck_corridor_task_not_self_assigned"),
    )
    op.create_index("idx_corridor_tasks_inbox", "corridor_tasks",
                    ["region_slug", "scheduled_date", "status"])
    op.create_index("idx_corridor_tasks_creator", "corridor_tasks", ["creator_user_id", "created_at"])
    op.create_index("idx_corridor_tasks_assignee", "corridor_tasks",
                    ["assignee_user_id", "scheduled_date"],
                    postgresql_where=sa.text("assignee_user_id IS NOT NULL"))

    # Append-only fee ledger. One row per completed task: the commission the
    # platform earned, recorded on the creator's utility ledger. No funds move
    # through this table.
    op.create_table(
        "corridor_task_fee_ledger",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("task_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("corridor_tasks.id", ondelete="CASCADE"),
                  nullable=False, unique=True),
        sa.Column("creator_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("worker_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("worker_payout_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("platform_fee_kes", sa.Numeric(10, 2), nullable=False),
        sa.Column("fee_pct", sa.Numeric(5, 2), nullable=False),
        sa.Column("settlement_mode", sa.String(24), nullable=False,
                  server_default="direct_mpesa"),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("platform_fee_kes >= 0", name="ck_corridor_fee_nonnegative"),
        sa.CheckConstraint("worker_payout_kes > 0", name="ck_corridor_fee_payout_positive"),
    )
    op.create_index("idx_corridor_fee_creator", "corridor_task_fee_ledger",
                    ["creator_user_id", "recorded_at"])


def downgrade():
    op.drop_index("idx_corridor_fee_creator", table_name="corridor_task_fee_ledger")
    op.drop_table("corridor_task_fee_ledger")
    op.drop_index("idx_corridor_tasks_assignee", table_name="corridor_tasks")
    op.drop_index("idx_corridor_tasks_creator", table_name="corridor_tasks")
    op.drop_index("idx_corridor_tasks_inbox", table_name="corridor_tasks")
    op.drop_table("corridor_tasks")

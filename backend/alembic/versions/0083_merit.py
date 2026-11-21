"""Merit: endorsements, mentorship, snapshots and the bank-ready report.

Revision ID: 0083_merit
Revises: 0082_open_market

Additive only, three new tables, no change to anything that already exists:

* ``trust_endorsements`` — one business vouching for another, weighted by the
  endorser's own record when it was said, unique per pair.
* ``mentorships`` — a Blue Chip business taking a newcomer on; milestones are
  what pay the mentor, and the mentee's uplift is capped in code and stored here.
* ``merit_snapshots`` — one reproducible score per business per day.

No money: no balance, no ledger, no payout. The score is a count of things that
happened and the migration adds no way to buy one.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0083_merit"
down_revision: Union[str, None] = "0082_open_market"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "trust_endorsements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("endorser_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("endorser_score", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("weight", sa.Float(), nullable=False, server_default=sa.text("0.2")),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("context", sa.String(160), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("withdrawn_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('active','withdrawn')",
                           name="ck_trust_endorsement_status"),
        sa.CheckConstraint("weight >= 0 AND weight <= 1", name="ck_trust_endorsement_weight"),
        sa.CheckConstraint("endorser_vendor_id <> subject_vendor_id",
                           name="ck_trust_endorsement_not_self"),
        sa.CheckConstraint("length(reason) >= 10", name="ck_trust_endorsement_reason"),
        sa.UniqueConstraint("endorser_vendor_id", "subject_vendor_id",
                            name="uq_trust_endorsement_once"),
    )
    op.create_index("ix_trust_endorsement_subject", "trust_endorsements",
                    ["subject_vendor_id", "status", "created_at"])

    op.create_table(
        "mentorships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("mentor_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mentee_vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("milestones", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("uplift_granted", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("status IN ('active','completed','ended')",
                           name="ck_mentorship_status"),
        sa.CheckConstraint("mentor_vendor_id <> mentee_vendor_id",
                           name="ck_mentorship_not_self"),
        sa.UniqueConstraint("mentor_vendor_id", "mentee_vendor_id", name="uq_mentorship_pair"),
    )
    op.create_index("ix_mentorship_mentor", "mentorships", ["mentor_vendor_id", "status"])
    op.create_index("ix_mentorship_mentee", "mentorships", ["mentee_vendor_id", "status"])

    op.create_table(
        "merit_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("score_earned", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("tier", sa.String(12), nullable=False),
        sa.Column("families", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("decay", sa.Float(), nullable=False, server_default=sa.text("1")),
        sa.Column("breakdown", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("version", sa.String(24), nullable=False, server_default="merit-1"),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("score >= 0 AND score <= 100", name="ck_merit_snapshot_score"),
        sa.CheckConstraint("tier IN ('seed','verified','blue_chip')",
                           name="ck_merit_snapshot_tier"),
        sa.UniqueConstraint("vendor_id", "as_of", name="uq_merit_snapshot_day"),
    )
    op.create_index("ix_merit_snapshot_vendor", "merit_snapshots", ["vendor_id", "as_of"])


def downgrade() -> None:
    op.drop_index("ix_merit_snapshot_vendor", table_name="merit_snapshots")
    op.drop_table("merit_snapshots")
    op.drop_index("ix_mentorship_mentee", table_name="mentorships")
    op.drop_index("ix_mentorship_mentor", table_name="mentorships")
    op.drop_table("mentorships")
    op.drop_index("ix_trust_endorsement_subject", table_name="trust_endorsements")
    op.drop_table("trust_endorsements")

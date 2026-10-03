"""Hustle League: job calls, contracts, gold ledger, squads.

Revision ID: 0009_hustle_league
Revises: 0008_open_data
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0009_hustle_league'
down_revision: str = '0008_open_data'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Job calls: a client (any vendor) posts a real task with real pay ---
    op.create_table(
        'hustle_job_calls',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('vendor_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('task_type', sa.String(length=40), nullable=False),
        sa.Column('skill', sa.String(length=40), nullable=False),
        sa.Column('required_tier', sa.String(length=20), nullable=False,
                  server_default='common'),
        sa.Column('pay_kes', sa.Integer(), nullable=False),
        sa.Column('location', sa.String(length=500), nullable=True),
        sa.Column('geo_lat', sa.Float(), nullable=True),
        sa.Column('geo_lng', sa.Float(), nullable=True),
        # Plain column first — the squads table is created below; the FK is
        # attached after both exist (Postgres requires the referenced table).
        sa.Column('squad_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('otp_code', sa.String(length=6), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='open'),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_hustle_calls_status', 'hustle_job_calls', ['status'])
    op.create_index('ix_hustle_calls_vendor', 'hustle_job_calls', ['vendor_id'])

    # --- Contracts: an accepted call. The row is the record of the work,
    # the proof, the rating and the money — one row per completed match. ---
    op.create_table(
        'hustle_contracts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('job_call_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('hustle_job_calls.id', ondelete='CASCADE'), nullable=False),
        sa.Column('player_vendor_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('agreed_pay_kes', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='accepted'),
        sa.Column('otp_verified', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('proof_photo_url', sa.String(length=500), nullable=True),
        sa.Column('client_rating', sa.Integer(), nullable=True),
        sa.Column('client_note', sa.String(length=300), nullable=True),
        sa.Column('worker_client_rating', sa.Integer(), nullable=True),
        sa.Column('xp_earned', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('gold_earned', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('payout_status', sa.String(length=30), nullable=False,
                  server_default='direct'),
        sa.Column('payout_ref', sa.String(length=80), nullable=True),
        sa.Column('cancel_reason', sa.String(length=300), nullable=True),
        sa.Column('accepted_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_hustle_contracts_player', 'hustle_contracts', ['player_vendor_id'])
    op.create_index('ix_hustle_contracts_call', 'hustle_contracts', ['job_call_id'])
    op.create_index('ix_hustle_contracts_completed', 'hustle_contracts', ['completed_at'])

    # --- Gold ledger: the ONLY source of a Gold balance. Balance is a sum
    # of these rows — a balance that lives anywhere else is a second source
    # of truth and this schema does not allow one. ---
    op.create_table(
        'hustle_gold_ledger',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('vendor_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=40), nullable=False),
        sa.Column('ref', sa.String(length=80), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('vendor_id', 'reason', 'ref', name='uq_gold_ledger_vendor_reason_ref'),
    )
    op.create_index('ix_hustle_gold_vendor', 'hustle_gold_ledger', ['vendor_id'])

    # --- Squads: 5–10 youth who work and split together ---------------------
    op.create_table(
        'hustle_squads',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('captain_vendor_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )
    op.create_table(
        'hustle_squad_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('squad_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('hustle_squads.id', ondelete='CASCADE'), nullable=False),
        sa.Column('vendor_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False, server_default='member'),
        sa.Column('split_pct', sa.Integer(), nullable=False, server_default='10'),
        sa.Column('joined_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('squad_id', 'vendor_id', name='uq_squad_member'),
    )
    op.create_index('ix_hustle_squad_members_vendor', 'hustle_squad_members', ['vendor_id'])
    # Now both tables exist: attach the job-call → squad FK.
    op.execute(
        "ALTER TABLE hustle_job_calls ADD CONSTRAINT hustle_job_calls_squad_id_fkey "
        "FOREIGN KEY (squad_id) REFERENCES hustle_squads(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.drop_table('hustle_squad_members')
    op.drop_table('hustle_squads')
    op.drop_table('hustle_gold_ledger')
    op.drop_table('hustle_contracts')
    op.drop_table('hustle_job_calls')

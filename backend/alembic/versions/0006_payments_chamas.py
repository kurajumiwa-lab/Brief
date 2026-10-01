"""payments custody and digital chamas

Revision ID: 0006_payments_chamas
Revises: 0005_governance
Create Date: 2026-10-01 09:00:00.000000+00:00

Adds the v2.5 money layer: PSP payment intents, the append-only custody
ledger (with the no-UPDATE/DELETE trigger), disbursements with dual approval,
reconciliation runs, dispute holds, Lock-cluster settlement columns, and the
digital-chama (table banking) tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0006_payments_chamas'
down_revision: Union[str, None] = '0005_governance'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _raw_execute(sql: str) -> None:
    """PL/pgSQL bodies (`$$ ... $$` with `%` in the RAISE message) break
    SQLAlchemy's exec_driver_sql parameter plumbing on psycopg2; run them
    through the raw DBAPI cursor (same transaction)."""
    with op.get_bind().connection.connection.cursor() as cur:
        cur.execute(sql)


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'PAYMENT_UPDATE'")
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'CHAMA_UPDATE'")

    # --- Lock clusters: escrow settlement state ---------------------------
    op.add_column('lock_clusters', sa.Column('funds_status', sa.String(length=20), nullable=False, server_default='not_required'))
    op.add_column('lock_clusters', sa.Column('paid_total_ksh', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('lock_clusters', sa.Column('settled_at', sa.DateTime(), nullable=True))

    # --- Payment intents ---------------------------------------------------
    op.create_table('payment_intents',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('entity_type', sa.String(length=40), nullable=False),
    sa.Column('entity_id', sa.UUID(), nullable=False),
    sa.Column('amount_ksh', sa.Integer(), nullable=False),
    sa.Column('provider', sa.String(length=10), nullable=False, server_default='MPESA'),
    sa.Column('phone', sa.String(length=20), nullable=False),
    sa.Column('target_psp_sub', sa.String(length=80), nullable=False),
    sa.Column('psp_api_ref', sa.String(length=80), nullable=False, unique=True),
    sa.Column('psp_payment_id', sa.String(length=80), nullable=True),
    sa.Column('mpesa_receipt', sa.String(length=40), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False, server_default='pending'),
    sa.Column('failure_reason', sa.String(length=400), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint("entity_type IN ('pick_deposit','pick_full_payment','chama_deposit','chama_loan_repayment','sacco_savings','sacco_loan_repayment','pool_ride_share')", name='ck_payment_intent_entity_type'),
    sa.CheckConstraint('amount_ksh > 0', name='ck_payment_intent_amount_positive'),
    sa.CheckConstraint("provider IN ('MPESA','AIRTEL','TKASH','CARD','BANK')", name='ck_payment_intent_provider'),
    sa.CheckConstraint("status IN ('pending','completed','failed','refunded','expired')", name='ck_payment_intent_status'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_payment_intents_entity', 'payment_intents', ['entity_type', 'entity_id'], unique=False)
    op.create_index('idx_payment_intents_status_created', 'payment_intents', ['status', 'created_at'], unique=False)
    op.create_index(op.f('ix_payment_intents_vendor_id'), 'payment_intents', ['vendor_id'], unique=False)

    # --- Append-only custody ledger ----------------------------------------
    op.create_table('custody_ledger',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('ledger_date', sa.Date(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=True),
    sa.Column('psp_sub_account', sa.String(length=80), nullable=False),
    sa.Column('transaction_type', sa.String(length=30), nullable=False),
    sa.Column('amount_ksh', sa.Integer(), nullable=False),
    sa.Column('direction', sa.String(length=8), nullable=False),
    sa.Column('running_balance_ksh', sa.Integer(), nullable=False, server_default='0'),
    sa.Column('psp_reference', sa.String(length=80), nullable=False),
    sa.Column('mpesa_receipt', sa.String(length=40), nullable=True),
    sa.Column('provider', sa.String(length=10), nullable=True),
    sa.Column('entity_type', sa.String(length=40), nullable=True),
    sa.Column('entity_id', sa.UUID(), nullable=True),
    sa.Column('intent_id', sa.UUID(), nullable=True),
    sa.Column('approved_by', sa.UUID(), nullable=True),
    sa.Column('approved_by_2', sa.UUID(), nullable=True),
    sa.Column('reversal_of', sa.UUID(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('amount_ksh > 0', name='ck_custody_ledger_amount_positive'),
    sa.CheckConstraint("transaction_type IN ('collection_in','escrow_lock','escrow_release','escrow_refund','chama_pool_in','chama_loan_out','chama_repayment_in','chama_dividend_out','sacco_deposit_in','sacco_loan_out','sacco_repayment_in','sacco_dividend_out','fee_deducted','dispute_freeze','dispute_release','reversal')", name='ck_custody_ledger_transaction_type'),
    sa.CheckConstraint("direction IN ('credit','debit')", name='ck_custody_ledger_direction'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.ForeignKeyConstraint(['intent_id'], ['payment_intents.id'], ),
    sa.ForeignKeyConstraint(['reversal_of'], ['custody_ledger.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_custody_ledger_psp_sub', 'custody_ledger', ['psp_sub_account', 'ledger_date'], unique=False)
    op.create_index('idx_custody_ledger_vendor', 'custody_ledger', ['vendor_id', 'ledger_date'], unique=False)
    op.create_index('idx_custody_ledger_entity', 'custody_ledger', ['entity_type', 'entity_id'], unique=False)
    op.create_index('idx_custody_ledger_created', 'custody_ledger', ['created_at'], unique=False)

    # The ledger is append-only at the database level: the application role
    # cannot UPDATE or DELETE its rows (corrections are reversal rows).
    _raw_execute("""
        CREATE OR REPLACE FUNCTION brief_custody_ledger_no_mutate()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'custody_ledger is append-only: % is not allowed (id=%)',
                TG_OP, CASE WHEN TG_OP = 'UPDATE' THEN OLD.id WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
            RETURN NULL;
        END;
        $$;
    """)
    _raw_execute("""
        CREATE TRIGGER trg_custody_ledger_append_only
            BEFORE UPDATE OR DELETE ON custody_ledger
            FOR EACH ROW EXECUTE FUNCTION brief_custody_ledger_no_mutate();
    """)

    # --- Disbursements (money OUT, dual approval above the line) -----------
    op.create_table('disbursements',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('entity_type', sa.String(length=30), nullable=False),
    sa.Column('entity_id', sa.UUID(), nullable=False),
    sa.Column('recipient_phone', sa.String(length=20), nullable=False),
    sa.Column('recipient_provider', sa.String(length=10), nullable=False, server_default='MPESA'),
    sa.Column('recipient_name', sa.String(length=200), nullable=True),
    sa.Column('amount_ksh', sa.Integer(), nullable=False),
    sa.Column('source_psp_sub', sa.String(length=80), nullable=False),
    sa.Column('psp_api_ref', sa.String(length=80), nullable=False, unique=True),
    sa.Column('psp_payout_id', sa.String(length=80), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False, server_default='pending_approval'),
    sa.Column('requested_by_vendor_id', sa.UUID(), nullable=True),
    sa.Column('approver_1', sa.UUID(), nullable=True),
    sa.Column('approver_1_at', sa.DateTime(), nullable=True),
    sa.Column('approver_2', sa.UUID(), nullable=True),
    sa.Column('approver_2_at', sa.DateTime(), nullable=True),
    sa.Column('failure_reason', sa.String(length=400), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint("entity_type IN ('pick_settlement','pick_refund','chama_loan','chama_dividend','sacco_loan','sacco_dividend','sacco_withdrawal','price_shield_credit','network_benefit','pool_ride_transporter')", name='ck_disbursement_entity_type'),
    sa.CheckConstraint('amount_ksh > 0', name='ck_disbursement_amount_positive'),
    sa.CheckConstraint("status IN ('pending_approval','approved','queued','completed','failed','reversed')", name='ck_disbursement_status'),
    sa.ForeignKeyConstraint(['requested_by_vendor_id'], ['vendors.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_disbursements_status_created', 'disbursements', ['status', 'created_at'], unique=False)
    op.create_index('idx_disbursements_entity', 'disbursements', ['entity_type', 'entity_id'], unique=False)

    # --- Reconciliation runs ------------------------------------------------
    op.create_table('reconciliation_runs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('run_date', sa.Date(), nullable=False),
    sa.Column('psp_sub_account', sa.String(length=80), nullable=False),
    sa.Column('psp_reported_balance', sa.Integer(), nullable=False),
    sa.Column('ledger_balance', sa.Integer(), nullable=False),
    sa.Column('variance_ksh', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
    sa.Column('variance_explanation', sa.String(length=400), nullable=True),
    sa.Column('resolved_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("status IN ('pending','matched','variance_found','resolved')", name='ck_reconciliation_status'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('run_date', 'psp_sub_account', name='uq_recon_run_date_sub')
    )

    # --- Dispute holds -------------------------------------------------------
    op.create_table('dispute_holds',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('original_ledger_id', sa.UUID(), nullable=True),
    sa.Column('entity_type', sa.String(length=40), nullable=False),
    sa.Column('entity_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=True),
    sa.Column('amount_ksh', sa.Integer(), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False, server_default='frozen'),
    sa.Column('resolved_by', sa.UUID(), nullable=True),
    sa.Column('resolution_note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('resolved_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint('amount_ksh > 0', name='ck_dispute_hold_amount_positive'),
    sa.CheckConstraint("status IN ('frozen','released_to_vendor','released_to_supplier','escalated')", name='ck_dispute_hold_status'),
    sa.ForeignKeyConstraint(['original_ledger_id'], ['custody_ledger.id'], ),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ),
    sa.PrimaryKeyConstraint('id')
    )

    # --- Digital chamas (Layer 2: table banking) ----------------------------
    op.create_table('chamas',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('scope', sa.String(length=10), nullable=False, server_default='group'),
    sa.Column('group_id', sa.UUID(), nullable=True),
    sa.Column('zone_id', sa.UUID(), nullable=True),
    sa.Column('created_by_vendor_id', sa.UUID(), nullable=True),
    sa.Column('min_deposit_ksh', sa.Integer(), nullable=False, server_default='500'),
    sa.Column('max_loan_ksh', sa.Integer(), nullable=False, server_default='10000'),
    sa.Column('interest_rate', sa.Numeric(precision=5, scale=4), nullable=False, server_default='0.0500'),
    sa.Column('cycle_days', sa.Integer(), nullable=False, server_default='7'),
    sa.Column('approval_rate', sa.Numeric(precision=4, scale=3), nullable=False, server_default='0.700'),
    sa.Column('min_members', sa.Integer(), nullable=False, server_default='5'),
    sa.Column('max_members', sa.Integer(), nullable=False, server_default='30'),
    sa.Column('psp_sub_account', sa.String(length=80), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False, server_default='forming'),
    sa.Column('active_at', sa.DateTime(), nullable=True),
    sa.Column('last_dividend_cycle', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('min_deposit_ksh > 0', name='ck_chama_min_deposit_positive'),
    sa.CheckConstraint('max_loan_ksh > 0', name='ck_chama_max_loan_positive'),
    sa.CheckConstraint('cycle_days > 0', name='ck_chama_cycle_positive'),
    sa.CheckConstraint('interest_rate >= 0 AND interest_rate <= 0.50', name='ck_chama_interest_rate'),
    sa.CheckConstraint('approval_rate > 0 AND approval_rate <= 1', name='ck_chama_approval_rate'),
    sa.CheckConstraint("status IN ('forming','active','suspended','dissolved')", name='ck_chama_status'),
    sa.CheckConstraint("(scope = 'group' AND group_id IS NOT NULL) OR scope = 'open'", name='ck_chama_scope_group'),
    sa.ForeignKeyConstraint(['group_id'], ['vendor_groups.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['zone_id'], ['market_zones.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['created_by_vendor_id'], ['vendors.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name'),
    sa.UniqueConstraint('psp_sub_account')
    )
    op.create_index('ix_chamas_group', 'chamas', ['group_id'], unique=False)
    op.create_index('ix_chamas_status', 'chamas', ['status'], unique=False)

    op.create_table('chama_members',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('chama_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('role', sa.String(length=12), nullable=False, server_default='member'),
    sa.Column('joined_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("role IN ('member','chair','treasurer')", name='ck_chama_member_role'),
    sa.ForeignKeyConstraint(['chama_id'], ['chamas.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('chama_id', 'vendor_id', name='uq_chama_member')
    )
    op.create_index(op.f('ix_chama_members_chama_id'), 'chama_members', ['chama_id'], unique=False)
    op.create_index(op.f('ix_chama_members_vendor_id'), 'chama_members', ['vendor_id'], unique=False)

    op.create_table('chama_deposits',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('chama_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('amount_ksh', sa.Integer(), nullable=False),
    sa.Column('cycle_number', sa.Integer(), nullable=False),
    sa.Column('intent_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('amount_ksh > 0', name='ck_chama_deposit_positive'),
    sa.CheckConstraint('cycle_number > 0', name='ck_chama_deposit_cycle_positive'),
    sa.ForeignKeyConstraint(['chama_id'], ['chamas.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['intent_id'], ['payment_intents.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_chama_deposits_member', 'chama_deposits', ['chama_id', 'vendor_id'], unique=False)
    op.create_index(op.f('ix_chama_deposits_chama_id'), 'chama_deposits', ['chama_id'], unique=False)
    op.create_index(op.f('ix_chama_deposits_vendor_id'), 'chama_deposits', ['vendor_id'], unique=False)

    op.create_table('chama_loans',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('chama_id', sa.UUID(), nullable=False),
    sa.Column('borrower_id', sa.UUID(), nullable=False),
    sa.Column('amount_ksh', sa.Integer(), nullable=False),
    sa.Column('interest_ksh', sa.Integer(), nullable=False, server_default='0'),
    sa.Column('total_due_ksh', sa.Integer(), nullable=False),
    sa.Column('purpose', sa.String(length=400), nullable=True),
    sa.Column('cycle_issued', sa.Integer(), nullable=False),
    sa.Column('cycle_due', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False, server_default='pending_vote'),
    sa.Column('disbursement_id', sa.UUID(), nullable=True),
    sa.Column('repayment_intent_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('decided_at', sa.DateTime(), nullable=True),
    sa.Column('disbursed_at', sa.DateTime(), nullable=True),
    sa.Column('repaid_at', sa.DateTime(), nullable=True),
    sa.CheckConstraint('amount_ksh > 0', name='ck_chama_loan_amount_positive'),
    sa.CheckConstraint('total_due_ksh = amount_ksh + interest_ksh', name='ck_chama_loan_total_math'),
    sa.CheckConstraint("status IN ('pending_vote','approved','declined','disbursing','disbursed','repaid','defaulted')", name='ck_chama_loan_status'),
    sa.ForeignKeyConstraint(['chama_id'], ['chamas.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['borrower_id'], ['vendors.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['disbursement_id'], ['disbursements.id'], ),
    sa.ForeignKeyConstraint(['repayment_intent_id'], ['payment_intents.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_chama_loans_status', 'chama_loans', ['status'], unique=False)
    op.create_index('ix_chama_loans_borrower', 'chama_loans', ['borrower_id'], unique=False)
    op.create_index(op.f('ix_chama_loans_chama_id'), 'chama_loans', ['chama_id'], unique=False)

    op.create_table('chama_loan_votes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('loan_id', sa.UUID(), nullable=False),
    sa.Column('voter_id', sa.UUID(), nullable=False),
    sa.Column('vote', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("vote IN ('approve','decline')", name='ck_chama_loan_vote_choice'),
    sa.ForeignKeyConstraint(['loan_id'], ['chama_loans.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['voter_id'], ['vendors.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('loan_id', 'voter_id', name='uq_chama_loan_vote')
    )
    op.create_index(op.f('ix_chama_loan_votes_loan_id'), 'chama_loan_votes', ['loan_id'], unique=False)

    op.create_table('chama_dividends',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('chama_id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('period_cycle_from', sa.Integer(), nullable=False),
    sa.Column('period_cycle_to', sa.Integer(), nullable=False),
    sa.Column('amount_ksh', sa.Integer(), nullable=False),
    sa.Column('disbursement_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False, server_default='declared'),
    sa.Column('declared_at', sa.DateTime(), nullable=False),
    sa.Column('paid_at', sa.DateTime(), nullable=True),
    sa.Column('failure_reason', sa.String(length=400), nullable=True),
    sa.CheckConstraint('amount_ksh > 0', name='ck_chama_dividend_positive'),
    sa.CheckConstraint("status IN ('declared','paid','failed')", name='ck_chama_dividend_status'),
    sa.ForeignKeyConstraint(['chama_id'], ['chamas.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['disbursement_id'], ['disbursements.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_chama_dividends_member', 'chama_dividends', ['chama_id', 'vendor_id'], unique=False)
    op.create_index(op.f('ix_chama_dividends_chama_id'), 'chama_dividends', ['chama_id'], unique=False)


def downgrade() -> None:
    op.drop_table('chama_dividends')
    op.drop_table('chama_loan_votes')
    op.drop_table('chama_loans')
    op.drop_table('chama_deposits')
    op.drop_table('chama_members')
    op.drop_table('chamas')
    op.drop_table('dispute_holds')
    op.drop_table('reconciliation_runs')
    op.drop_table('disbursements')
    op.execute("DROP TRIGGER IF EXISTS trg_custody_ledger_append_only ON custody_ledger;")
    op.execute("DROP FUNCTION IF EXISTS brief_custody_ledger_no_mutate();")
    op.drop_table('custody_ledger')
    op.drop_table('payment_intents')
    op.drop_column('lock_clusters', 'settled_at')
    op.drop_column('lock_clusters', 'paid_total_ksh')
    op.drop_column('lock_clusters', 'funds_status')
    # NOTE: enum values PAYMENT_UPDATE / CHAMA_UPDATE remain (Postgres cannot
    # drop enum members); they are harmless if unreferenced.

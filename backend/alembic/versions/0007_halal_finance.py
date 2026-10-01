"""v2.6 halal finance: vendor finance_mode, chama model_type, qard fee,
murabaha contracts, new payment-intent entity types.

Revision ID: 0007_halal_finance
Revises: 0006_payments_chamas
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0007_halal_finance'
down_revision: str = '0006_payments_chamas'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Vendor finance preference -----------------------------------------
    op.add_column('vendors',
                  sa.Column('finance_mode', sa.String(length=20), nullable=False,
                            server_default='conventional'))
    op.execute(
        "ALTER TABLE vendors ADD CONSTRAINT ck_vendor_finance_mode "
        "CHECK (finance_mode IN ('conventional', 'halal_sharia'))"
    )

    # --- Chama financial structure ------------------------------------------
    op.add_column('chamas',
                  sa.Column('model_type', sa.String(length=24), nullable=False,
                            server_default='conventional_interest'))
    op.execute(
        "ALTER TABLE chamas ADD CONSTRAINT ck_chama_model_type "
        "CHECK (model_type IN ('conventional_interest', 'qard_hasan', "
        "'musharakah_trade', 'murabaha_credit'))"
    )

    # --- Qard admin fee on loans ---------------------------------------------
    op.add_column('chama_loans',
                  sa.Column('fee_ksh', sa.Integer(), nullable=False, server_default='0'))
    op.execute(
        "ALTER TABLE chama_loans ADD CONSTRAINT ck_chama_loan_fee_non_negative "
        "CHECK (fee_ksh >= 0)"
    )

    # --- Murabaha (cost-plus) advances ----------------------------------------
    op.create_table('murabaha_contracts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('supplier_vendor_id', sa.UUID(), nullable=True),
    sa.Column('product', sa.String(length=200), nullable=False),
    sa.Column('quantity', sa.Integer(), nullable=False),
    sa.Column('cost_price_ksh', sa.Integer(), nullable=False),
    sa.Column('markup_ksh', sa.Integer(), nullable=False),
    sa.Column('total_selling_ksh', sa.Integer(), nullable=False),
    sa.Column('payment_due_date', sa.DateTime(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False, server_default='pending_approval'),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('repayment_intent_id', sa.UUID(), nullable=True),
    sa.Column('approved_by_vendor_id', sa.UUID(), nullable=True),
    sa.Column('approved_at', sa.DateTime(), nullable=True),
    sa.Column('settled_at', sa.DateTime(), nullable=True),
    sa.Column('failure_reason', sa.String(length=400), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint('quantity > 0', name='ck_murabaha_quantity_positive'),
    sa.CheckConstraint('cost_price_ksh > 0', name='ck_murabaha_cost_positive'),
    sa.CheckConstraint('markup_ksh >= 0', name='ck_murabaha_markup_non_negative'),
    sa.CheckConstraint('total_selling_ksh = cost_price_ksh + markup_ksh', name='ck_murabaha_total_math'),
    sa.CheckConstraint(
        "status IN ('pending_approval','active','declined','settled','defaulted')",
        name='ck_murabaha_status'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['supplier_vendor_id'], ['vendors.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['repayment_intent_id'], ['payment_intents.id'], ),
    sa.ForeignKeyConstraint(['approved_by_vendor_id'], ['vendors.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_murabaha_vendor', 'murabaha_contracts', ['vendor_id'], unique=False)
    op.create_index('ix_murabaha_status_due', 'murabaha_contracts', ['status', 'payment_due_date'], unique=False)

    # --- New collection entity types ------------------------------------------
    op.drop_constraint('ck_payment_intent_entity_type', 'payment_intents')
    op.create_check_constraint(
        'ck_payment_intent_entity_type', 'payment_intents',
        "entity_type IN ('pick_deposit','pick_full_payment','chama_deposit',"
        "'chama_loan_repayment','sacco_savings','sacco_loan_repayment','pool_ride_share',"
        "'murabaha_repayment','musharakah_profit')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_payment_intent_entity_type', 'payment_intents')
    op.create_check_constraint(
        'ck_payment_intent_entity_type', 'payment_intents',
        "entity_type IN ('pick_deposit','pick_full_payment','chama_deposit',"
        "'chama_loan_repayment','sacco_savings','sacco_loan_repayment','pool_ride_share')",
    )
    op.drop_index('ix_murabaha_status_due', table_name='murabaha_contracts')
    op.drop_index('ix_murabaha_vendor', table_name='murabaha_contracts')
    op.drop_table('murabaha_contracts')
    op.drop_constraint('ck_chama_loan_fee_non_negative', 'chama_loans')
    op.drop_column('chama_loans', 'fee_ksh')
    op.drop_constraint('ck_chama_model_type', 'chamas')
    op.drop_column('chamas', 'model_type')
    op.drop_constraint('ck_vendor_finance_mode', 'vendors')
    op.drop_column('vendors', 'finance_mode')

"""Add an explicit reservation state without refreshing quote timestamps."""
from alembic import op
import sqlalchemy as sa

revision = "0085_market_reservation"
down_revision = "0084_market_opportunities"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("market_opportunities", sa.Column("reserved", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("market_opportunities", "reserved")

"""Event host notifications (Phase 8): a host's photo or message reaches the people who RSVP'd.

Additive: adds one value to the notification type enum. Nothing is removed. A value added to a
PostgreSQL enum cannot be dropped, so downgrade leaves it in place and does nothing.

Revision ID: 0054_event_host_notifications
Revises: 0053_event_hub
Create Date: 2026-11-15
"""

from alembic import op

revision: str = "0054_event_host_notifications"
down_revision: str = "0053_event_hub"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS 'EVENT_HOST_UPDATE'")


def downgrade() -> None:
    # PostgreSQL cannot remove an enum value. Leaving it in place is harmless.
    pass

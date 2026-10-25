"""Uploaded media kept in the database.

Purely additive: one new table, no existing table, column or constraint is
touched, so it is safe to deploy before the application code that uses it.

`media_objects` is the storage backend used when `MEDIA_STORE` resolves to `db`
— the production default when no S3 bucket is configured — because a serverless
or container filesystem is not durable. See `app/services/storage.py`.

Revision ID: 0024_media_objects
Revises: 0023_subscription_billing
Create Date: 2026-10-25
"""

import sqlalchemy as sa

from alembic import op

revision: str = "0024_media_objects"
down_revision: str = "0023_subscription_billing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_objects",
        sa.Column("key", sa.String(400), primary_key=True),
        sa.Column("content_type", sa.String(120), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("media_objects")

"""Home office (S1): offices, members, and calendar events.

Additive only. No money columns. No existing table is changed.

Integrity rules are enforced in the database where a CHECK or index can express them:
- every timestamp is timezone-aware (timestamptz), stored in UTC;
- every text field is non-blank;
- an office has at most one active owner (partial unique index);
- an owner is always a registered account;
- a member row has exactly one identity, except a pending link (no person yet) or a
  revoked link (removed, never a member);
- invitation credentials exist only while an invite is pending and carry an expiry;
  they are cleared on accept, decline, removal and revocation.

Two rules cannot be a CHECK because they depend on the current time or on another table,
and are enforced in the service with a conditional UPDATE and a test instead:
- an invite cannot be accepted after invite_expires_at (checked in the same UPDATE that consumes it);
- offices.owner_vendor_id must match the active owner row (written in the same transaction
  as the office, see service.create_office).

Revision ID: 0040_home_office
Revises: 0039_branch_delivery
Create Date: 2026-11-10
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0040_home_office"
down_revision: str = "0039_branch_delivery"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def _nonblank(column: str) -> str:
    return f"length(btrim({column})) > 0"


def upgrade() -> None:
    op.create_table(
        "offices",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("owner_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("nature", sa.String(120), nullable=False),
        sa.Column("area", sa.String(120), nullable=False),
        sa.Column("hours_text", sa.String(200)),
        sa.Column("contact_mode", sa.String(8), nullable=False, server_default="none"),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.CheckConstraint("contact_mode IN ('none', 'phone', 'email')", name="ck_offices_contact_mode"),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_offices_status"),
        sa.CheckConstraint(
            f"{_nonblank('name')} AND {_nonblank('nature')} AND {_nonblank('area')} "
            f"AND (hours_text IS NULL OR {_nonblank('hours_text')})",
            name="ck_offices_text_nonblank",
        ),
    )
    op.create_index("ix_offices_owner_vendor_id", "offices", ["owner_vendor_id"])

    op.create_table(
        "office_members",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("office_id", UUID, sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="CASCADE")),
        sa.Column("display_name", sa.String(60)),
        sa.Column("function_label", sa.String(80)),
        sa.Column("role", sa.String(12), nullable=False, server_default="staff"),
        sa.Column("status", sa.String(12), nullable=False, server_default="invited"),
        sa.Column("invite_token_hash", sa.String(64), unique=True),
        sa.Column("invite_expires_at", TS),
        sa.Column("invited_by_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("responded_at", TS),
        sa.CheckConstraint("role IN ('owner', 'editor', 'approver', 'member', 'partner', 'staff')",
                           name="ck_office_members_role"),
        sa.CheckConstraint("status IN ('invited', 'active', 'removed')", name="ck_office_members_status"),
        # The owner is always a registered account.
        sa.CheckConstraint("role <> 'owner' OR vendor_id IS NOT NULL", name="ck_office_members_owner_is_account"),
        # Not both identities at once.
        sa.CheckConstraint("NOT (vendor_id IS NOT NULL AND display_name IS NOT NULL)",
                           name="ck_office_members_identity_single"),
        # Exactly one identity, except: a pending link has no person yet (status invited, with a
        # credential), and a revoked link never became a member (status removed).
        sa.CheckConstraint(
            "(vendor_id IS NOT NULL OR display_name IS NOT NULL)"
            " OR (status = 'invited' AND invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL)"
            " OR status = 'removed'",
            name="ck_office_members_identity_present",
        ),
        sa.CheckConstraint(f"display_name IS NULL OR {_nonblank('display_name')}",
                           name="ck_office_members_display_nonblank"),
        sa.CheckConstraint(f"function_label IS NULL OR {_nonblank('function_label')}",
                           name="ck_office_members_function_nonblank"),
        # Credentials exist only on a pending invite, and a pending invite that carries a
        # credential always has an expiry.
        sa.CheckConstraint("invite_token_hash IS NULL OR (status = 'invited' AND invite_expires_at IS NOT NULL)",
                           name="ck_office_members_credential_pending"),
        # Active or removed members hold no invitation credentials.
        sa.CheckConstraint("status = 'invited' OR (invite_token_hash IS NULL AND invite_expires_at IS NULL)",
                           name="ck_office_members_no_stale_credentials"),
    )
    op.create_index("ix_office_members_office_id", "office_members", ["office_id"])
    op.create_index("uq_office_member_account", "office_members", ["office_id", "vendor_id"], unique=True,
                    postgresql_where=text("vendor_id IS NOT NULL"))
    op.create_index("ix_office_members_vendor_id", "office_members", ["vendor_id"],
                    postgresql_where=text("vendor_id IS NOT NULL"))
    # At most one active owner per office.
    op.create_index("uq_office_one_active_owner", "office_members", ["office_id"], unique=True,
                    postgresql_where=text("role = 'owner' AND status = 'active'"))

    op.create_table(
        "office_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("office_id", UUID, sa.ForeignKey("offices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity", sa.String(80), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("starts_at", TS, nullable=False),
        sa.Column("ends_at", TS, nullable=False),
        sa.Column("location_text", sa.String(200)),
        sa.Column("created_by_vendor_id", UUID, sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("created_at", TS, nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ck_office_events_order"),
        sa.CheckConstraint(
            f"{_nonblank('activity')} AND {_nonblank('title')} "
            f"AND (location_text IS NULL OR {_nonblank('location_text')})",
            name="ck_office_events_text_nonblank",
        ),
    )
    op.create_index("ix_office_events_office_id", "office_events", ["office_id"])
    op.create_index("ix_office_events_starts_at", "office_events", ["starts_at"])


def downgrade() -> None:
    op.drop_table("office_events")
    op.drop_table("office_members")
    op.drop_table("offices")

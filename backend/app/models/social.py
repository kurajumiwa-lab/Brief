"""Social participation — the community layer, kept separate from trade.

Caesar's premise is that *the community* decides what deserves attention. That
only holds if the community is not restricted to registered businesses. So this
module deliberately does **not** hang a post or a reaction off ``vendors``:

  · ``social_accounts`` is a first-class identity with a handle, a city and a
    locale, and **no requirement of a vendor row**.
  · ``vendor_id`` is an optional, nullable link. A trader who wants their shop
    name on their posts gets one; a reader who has never traded gets nothing and
    is not a second-class participant. Business identity stays in ``vendors``;
    social identity stays here; the link is the only bridge, and it can be cut
    (``ON DELETE SET NULL``) without destroying anyone's conversation history.
  · Nothing here reads or writes ``network_score`` / ``parasitism_index``. Those
    are trade standing, computed from fulfilment and reciprocity. A social
    reputation that moved them would let popularity masquerade as reliability.

Two invariants are encoded as schema rather than as conventions, because they
are the product:

  · one reaction per account per post (``uq_social_reaction_post_account``), so
    a vote cannot be stuffed by clicking twice;
  · a downvote has no column on ``social_posts``. Visibility is ``status``, and
    reactions never change it. There is nowhere to write "hide because disliked".
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

ACCOUNT_STATUSES = ("active", "suspended", "closed")
POST_STATUSES = ("published", "hidden", "removed")
REACTION_VALUES = ("up", "down")
BLOCK_KINDS = ("block", "mute")
REPORT_STATUSES = ("received", "upheld", "dismissed")
REPORT_REASONS = (
    "harassment",
    "hate",
    "spam",
    "misinformation",
    "privacy",
    "violence",
    "other",
)


class SocialAccount(Base):
    """A participant. Not a vendor, and not required to be one."""

    __tablename__ = "social_accounts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active','suspended','closed')",
            name="ck_social_account_status",
        ),
        # One social identity per vendor at most; many accounts per person is
        # still possible in principle, and that is a product question, not a
        # schema accident.
        Index("uq_social_account_vendor", "vendor_id", unique=True, postgresql_where=text("vendor_id IS NOT NULL")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    handle = Column(String(60), nullable=False, unique=True, index=True)
    display_name = Column(String(120), nullable=False)
    city = Column(String(120))
    locale = Column(String(8), nullable=False, default="en")

    # The only bridge to trade identity, and it is optional by design.
    vendor_id = Column(
        UUID(as_uuid=True),
        ForeignKey("vendors.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SocialCircleFollow(Base):
    """Circles are Brief's ``vendor_groups``; following one is what makes it *yours*.

    Kept as its own table rather than reusing ``group_memberships`` because that
    table is keyed by ``vendor_id`` — and a participant without a business has
    no vendor row to be keyed by.
    """

    __tablename__ = "social_circle_follows"
    __table_args__ = (UniqueConstraint("account_id", "circle_id", name="uq_social_circle_follow"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    circle_id = Column(
        UUID(as_uuid=True), ForeignKey("vendor_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SocialPost(Base):
    """One claim someone can answer.

    ``status`` is the only thing that can hide a post, and only moderation (or
    the author) can set it. There is no ``downvotes`` column: the moment a count
    can hide a post, "disagreement is not abuse" stops being true in the schema.
    """

    __tablename__ = "social_posts"
    __table_args__ = (
        CheckConstraint("status IN ('published','hidden','removed')", name="ck_social_post_status"),
        CheckConstraint("length(btrim(body)) > 0", name="ck_social_post_body_not_blank"),
        Index("ix_social_posts_circle_created", "circle_id", "created_at"),
        Index("ix_social_posts_status_created", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    author_id = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    circle_id = Column(
        UUID(as_uuid=True),
        ForeignKey("vendor_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    body = Column(Text, nullable=False)
    lang = Column(String(8), nullable=False, default="en")
    image_url = Column(String(600))

    # Measured at publish time by the client's compressor and asserted by the
    # server; used by the data-saver and the measurement screen.
    data_kb = Column(Integer, nullable=False, default=1)

    status = Column(String(20), nullable=False, default="published")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SocialReaction(Base):
    """Support or dissent. Equal citizens, each worth one account."""

    __tablename__ = "social_reactions"
    __table_args__ = (
        UniqueConstraint("post_id", "account_id", name="uq_social_reaction_post_account"),
        CheckConstraint("value IN ('up','down')", name="ck_social_reaction_value"),
        Index("ix_social_reactions_post_created", "post_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(
        UUID(as_uuid=True), ForeignKey("social_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_id = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value = Column(String(4), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SocialBlock(Base):
    """A viewer's own choice — block or mute — never a verdict on the author."""

    __tablename__ = "social_blocks"
    __table_args__ = (
        UniqueConstraint("account_id", "target_id", "kind", name="uq_social_block"),
        CheckConstraint("kind IN ('block','mute')", name="ck_social_block_kind"),
        CheckConstraint("account_id <> target_id", name="ck_social_block_not_self"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind = Column(String(10), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class SocialReport(Base):
    """A case, not a removal.

    Reporting opens something a moderator must answer. It does not touch the
    post's status; only a moderation decision does that.
    """

    __tablename__ = "social_reports"
    __table_args__ = (
        UniqueConstraint("post_id", "reporter_id", name="uq_social_report_post_reporter"),
        CheckConstraint("status IN ('received','upheld','dismissed')", name="ck_social_report_status"),
        CheckConstraint(
            "reason IN ('harassment','hate','spam','misinformation','privacy','violence','other')",
            name="ck_social_report_reason",
        ),
        Index("ix_social_reports_status_created", "status", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(
        UUID(as_uuid=True), ForeignKey("social_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reporter_id = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reason = Column(String(30), nullable=False)
    detail = Column(Text)
    status = Column(String(20), nullable=False, default="received")
    # Shown to the reporter so an appeal can name a case rather than a feeling.
    case_number = Column(String(20), nullable=False, unique=True, index=True)
    resolution_note = Column(Text)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))
    resolved_at = Column(DateTime)

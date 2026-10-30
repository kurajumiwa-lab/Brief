"""Caesar Park — a bounded place to be casual, with a gate.

Brief is transactional by design: people appear when they want something. Trade
needs somewhere to *not* be about trade, or the only conversation on the network
is a negotiation and the only people who stay are the ones selling.

A **park** is that place, and it has exactly one property that makes it safe:
it is *bounded*. You can only be in it by an entry rule, and the entry rule is
visible before you knock. Two kinds of boundary, one table:

  · ``place`` — a real place. A ward, a market, a crossroads. Entry rule: you
    are there.
  · ``niche`` — a trade or an interest. Tailors, boda operators, tomato growers.
    Entry rule: it is your work.

Inside a park are **circles** — the lawns. A circle is an existing
``vendor_groups`` row, linked rather than copied, so a park is a *view over
things that exist* and not a second silo for the same conversation.

**The dog park.** A circle may be ``off_leash``. In an off-leash circle the
business identity comes off at the gate: posts are attributed to the social
handle, and the API returns no business link for authors there. That is the
one place on Brief where a vendor is just a person, and it is opt-in per park,
not a global setting — because "hidden unless I say so" and "hidden and I
cannot tell" are different products.

**What is deliberately absent:**

  · No coordinates. Parks are neighbourhood-grained. A park that can place a
    shopkeeper at a pin at nine at night is not a park, it is surveillance.
  · No ``members`` count that can be gamed into a leaderboard, and no ranking
    of people inside a park.
  · No warden with write authority over anybody's words. ``created_by`` owns
    the gate, not the floor. Moderation stays in the report/appeal path that
    already exists.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base

PARK_KINDS = ("place", "niche")
ENTRY_RULES = ("open", "ask")          # walk in, or knock and wait
MEMBERSHIP_STATUS = ("member", "requested", "left", "removed")
LEASH_STATES = ("on", "off")           # on = business identity shown here


class CaesarPark(Base):
    """A bounded place with a gate and a printed set of rules."""

    __tablename__ = "caesar_parks"
    __table_args__ = (
        CheckConstraint("kind IN ('place','niche')", name="ck_park_kind"),
        CheckConstraint("entry_rule IN ('open','ask')", name="ck_park_entry_rule"),
        CheckConstraint("length(btrim(name)) > 0", name="ck_park_name_not_blank"),
        # One park per name per city: two "Kondele" parks would split the
        # neighbourhood in half on day one.
        UniqueConstraint("slug", name="uq_park_slug"),
        Index("ix_parks_city_kind", "city", "kind"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug = Column(String(80), nullable=False)
    name = Column(String(120), nullable=False)
    kind = Column(String(10), nullable=False, default="place")

    # place-bounded
    city = Column(String(120), nullable=True)
    area = Column(String(120), nullable=True)          # ward / estate / market name
    radius_km = Column(Float, nullable=True)           # a walkable ring, never a pin

    # niche-bounded
    niche = Column(String(80), nullable=True)          # "tailors", "tomato growers"

    description = Column(Text, nullable=True)
    # Printed at the gate, before anyone joins. A list of short sentences, same
    # shape as vendor_groups.rules so the UI already knows how to render them.
    rules = Column(JSONB, nullable=False, default=list, server_default="[]")

    entry_rule = Column(String(10), nullable=False, default="open")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")

    # The warden. Owns the gate and the rules; owns nobody's words.
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))

    @property
    def bounded_by(self) -> str:
        if self.kind == "place":
            return self.area or self.city or "a place"
        return self.niche or "a trade"


class CaesarParkCircle(Base):
    """A lawn inside a park: an existing circle, linked not copied."""

    __tablename__ = "caesar_park_circles"
    __table_args__ = (
        UniqueConstraint("park_id", "circle_id", name="uq_park_circle"),
        Index("ix_park_circles_park", "park_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    park_id = Column(
        UUID(as_uuid=True), ForeignKey("caesar_parks.id", ondelete="CASCADE"), nullable=False
    )
    circle_id = Column(
        UUID(as_uuid=True), ForeignKey("vendor_groups.id", ondelete="CASCADE"), nullable=False
    )
    # The dog park. Off-leash: business identity comes off at the gate.
    off_leash = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))


class CaesarParkMembership(Base):
    """Who is inside, whether they asked first, and what name they carry."""

    __tablename__ = "caesar_park_memberships"
    __table_args__ = (
        UniqueConstraint("park_id", "account_id", name="uq_park_membership"),
        CheckConstraint("status IN ('member','requested','left','removed')", name="ck_park_membership_status"),
        CheckConstraint("leash IN ('on','off')", name="ck_park_membership_leash"),
        Index("ix_park_memberships_account", "account_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    park_id = Column(
        UUID(as_uuid=True), ForeignKey("caesar_parks.id", ondelete="CASCADE"), nullable=False
    )
    account_id = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False
    )
    status = Column(String(12), nullable=False, default="member")
    # The leash belongs to the *membership*, not the account: a person may be a
    # shopkeeper in their market park and only a neighbour in their estate park.
    leash = Column(String(6), nullable=False, default="off")
    joined_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))
    # Kept so a removal can be explained and appealed; never shown publicly.
    note = Column(String(280), nullable=True)


class CaesarParkPost(Base):
    """A post inside a park.

    Its own table rather than a ``park_id`` column on ``social_posts``, for the
    same reason 0025 exists: the social layer is additive and an existing table
    is not someone else's to alter. A park post is still a post — it carries the
    same body/status/lang shape, so the feed can render both — but its home is
    a park, and a park can be emptied (``CASCADE``) without touching the
    network's public conversation.
    """

    __tablename__ = "caesar_park_posts"
    __table_args__ = (
        CheckConstraint("status IN ('published','hidden','removed')", name="ck_park_post_status"),
        CheckConstraint("length(btrim(body)) > 0", name="ck_park_post_body_not_blank"),
        Index("ix_park_posts_park_created", "park_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    park_id = Column(
        UUID(as_uuid=True), ForeignKey("caesar_parks.id", ondelete="CASCADE"), nullable=False
    )
    # Optional: which lawn of the park the post was made on. ``SET NULL`` so a
    # removed circle does not delete the conversation that happened in it.
    circle_id = Column(
        UUID(as_uuid=True), ForeignKey("caesar_park_circles.id", ondelete="SET NULL"), nullable=True
    )
    author_id = Column(
        UUID(as_uuid=True), ForeignKey("social_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    body = Column(Text, nullable=False)
    lang = Column(String(8), nullable=False, default="en")
    # Frozen at publish time: what name the author was wearing in this park.
    # If they change the leash later, yesterday's post does not change shape.
    leash_at_post = Column(String(6), nullable=False, default="off")
    status = Column(String(20), nullable=False, default="published")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("now()"))

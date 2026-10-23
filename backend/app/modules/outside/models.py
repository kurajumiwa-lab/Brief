"""Outside content primitives — additive, four tables.

The network already has events (`events`), communities (`vendor_groups`),
collections (`vendor_lists`), listings (`stock_items`), services and rentals
(`tool_listings`) and opportunities (`business_requests`). What it never had
is a *social* record: the house party, the question, the recommendation, the
request for company, the notice that the water is off on Tuesday.

So this module adds one content table and three small support tables, and
touches nothing else:

  * `outside_posts`            — social content. `content_type` covers post,
                                 question, recommendation, opportunity and
                                 notice. **No price column is required**; a
                                 post about a hike has no price and needs none.
  * `outside_reactions`        — like / save / interest / attending, keyed by
                                 (`content_kind`, `content_id`) so *every*
                                 content type in the app gets the same four
                                 interactions without eight more migrations.
  * `outside_discovery_prefs`  — the viewer's own location, radius and layer,
                                 with the manual-location fallback that keeps
                                 the app usable when GPS is denied.
  * `outside_content_reports`  — report / block. Discovery that mixes public
                                 content with private gatherings needs a floor.

Every other content type keeps its own table. A trip is still an `events` row;
a rental is still a `tool_listings` row. Outside reads them through one feed
contract (`app/modules/outside/feed.py`) rather than copying them.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Index,
    Integer, String, Text, UniqueConstraint, text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base

# ── the content kinds the whole Outside surface speaks ─────────────────────────
# A feed item, a card, a reaction and a report all name one of these. Adding a
# kind is a data decision (a source adapter in `feed.py` + a card renderer),
# never a new table.
CONTENT_KINDS = (
    "available",    # local_activities (Available)
    "wanted",       # local_activities (Wanted)
    "scheduled",    # local_activities (Scheduled)
    "post",         # outside_posts
    "event",        # events
    "listing",      # stock_items
    "service",      # tool_listings (transport / courier / hotel / packaging)
    "rental",       # tool_listings (warehouse / cold storage / popup / equipment)
    "opportunity",  # local_activities (Opportunity) + business_requests + hustle call-ups
    "community",    # vendor_groups
    "collection",   # vendor_lists
    "person",       # vendors
    "place",        # public_places
    "market",       # market_zones
)

# What a post is. Deliberately small: a kind with its own record type already
# exists for everything more structured.
POST_TYPES = ("post", "question", "recommendation", "opportunity", "notice")

VISIBILITIES = ("public", "community", "private")
AUDIENCES = ("everyone", "nearby", "community", "invited")
RESPONSE_KINDS = ("reply", "join", "rsvp", "offer_help", "enquire", "buy", "none")
POST_STATUSES = ("draft", "published", "cancelled", "completed", "expired", "removed")
GEO_PRECISIONS = ("exact", "approximate", "none")
LOCATION_LAYERS = ("neighbourhood", "town", "region", "country", "global")
REACTIONS = ("like", "save", "interest", "attending")
REPORT_STATUSES = ("open", "actioned", "dismissed")


class OutsidePost(Base):
    """One social record.

    The shape follows the five questions a piece of local content has to
    answer — where, when, who, what response, what state — because those five
    are what make it rankable and what make it safe to show.
    """

    __tablename__ = "outside_posts"
    __table_args__ = (
        # A post says something. Eight characters is the floor the requests
        # table already uses (`ck_request_description_real`), reused here so
        # the two surfaces validate the same way.
        CheckConstraint("char_length(body) >= 8", name="ck_outside_post_body_real"),
        CheckConstraint(
            "content_type IN ('post','question','recommendation','opportunity','notice')",
            name="ck_outside_post_type",
        ),
        CheckConstraint(
            "visibility IN ('public','community','private')",
            name="ck_outside_post_visibility",
        ),
        CheckConstraint(
            "geo_precision IN ('exact','approximate','none')",
            name="ck_outside_post_geo_precision",
        ),
        # Discovery is geographic, so the two hot query shapes get an index
        # each: "recent public content" and "public content near me".
        Index("ix_outside_posts_status_created", "status", "created_at"),
        Index("ix_outside_posts_geo", "geo_lat", "geo_lng"),
        Index("ix_outside_posts_vendor_created", "author_vendor_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    author_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # ── what ───────────────────────────────────────────────────────────────
    content_type = Column(String(24), nullable=False, default="post", index=True)
    title = Column(String(200))
    body = Column(Text, nullable=False)
    media = Column(JSONB, nullable=False, server_default=sa_text("'[]'::jsonb"), default=list)
    category = Column(String(100), index=True)
    tags = Column(JSONB, nullable=False, server_default=sa_text("'[]'::jsonb"), default=list)

    # ── where (privacy-aware: approximate beats exact by default) ──────────
    location = Column(String(300))
    geo_lat = Column(Float)
    geo_lng = Column(Float)
    geo_precision = Column(String(16), nullable=False, default="approximate", server_default="approximate")
    location_layer = Column(String(20), nullable=False, default="town", server_default="town")

    # ── when ───────────────────────────────────────────────────────────────
    starts_at = Column(DateTime)
    expires_at = Column(DateTime)

    # ── who / what response ────────────────────────────────────────────────
    visibility = Column(String(16), nullable=False, default="public", server_default="public", index=True)
    audience = Column(String(16), nullable=False, default="everyone", server_default="everyone")
    response_kind = Column(String(20), nullable=False, default="reply", server_default="reply")

    # ── commerce, optional by construction ─────────────────────────────────
    # Nullable, never required, never a ranking term. A party has no price.
    price_kes = Column(Integer)
    currency = Column(String(8), nullable=False, default="KES", server_default="KES")
    is_commercial = Column(Boolean, nullable=False, default=False, server_default="false")

    # ── state ──────────────────────────────────────────────────────────────
    status = Column(String(20), nullable=False, default="published", server_default="published", index=True)

    # ── engagement & moderation (denormalised so a feed needs no join) ─────
    like_count = Column(Integer, nullable=False, default=0, server_default="0")
    save_count = Column(Integer, nullable=False, default=0, server_default="0")
    interest_count = Column(Integer, nullable=False, default=0, server_default="0")
    reply_count = Column(Integer, nullable=False, default=0, server_default="0")
    report_count = Column(Integer, nullable=False, default=0, server_default="0")
    moderation_status = Column(String(20), nullable=False, default="approved", server_default="approved")

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    author = relationship("Vendor", foreign_keys=[author_vendor_id])


class OutsideReaction(Base):
    """One interaction on any content, anywhere in the app.

    Polymorphic on purpose: (`content_kind`, `content_id`) means an event, a
    listing, a community and a post all get like/save/interest/attending
    through one table and one endpoint, instead of four.
    """

    __tablename__ = "outside_reactions"
    __table_args__ = (
        UniqueConstraint(
            "vendor_id", "content_kind", "content_id", "reaction",
            name="uq_outside_reaction",
        ),
        # "everything I saved", newest first — the profile's saved tab.
        Index("ix_outside_reactions_vendor", "vendor_id", "reaction", "created_at"),
        # the counter for one piece of content
        Index("ix_outside_reactions_content", "content_kind", "content_id", "reaction"),
        CheckConstraint(
            "reaction IN ('like','save','interest','attending')",
            name="ck_outside_reaction_kind",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    content_kind = Column(String(24), nullable=False)
    content_id = Column(UUID(as_uuid=True), nullable=False)
    reaction = Column(String(16), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class OutsideDiscoveryPref(Base):
    """Where this person is looking, and how wide.

    One row per vendor. `source` records *why* the point is what it is —
    `gps` when the device gave it, `manual` when the person typed a
    neighbourhood, `vendor_profile` when it fell back to the shop address,
    `market_zone` when it fell back to a real anchor. Denying GPS therefore
    costs a radius, not the product.
    """

    __tablename__ = "outside_discovery_prefs"
    __table_args__ = (
        CheckConstraint(
            "source IN ('gps','manual','vendor_profile','market_zone','unset')",
            name="ck_outside_pref_source",
        ),
        CheckConstraint("radius_km >= 0.5 AND radius_km <= 200", name="ck_outside_pref_radius"),
        CheckConstraint(
            "layer IN ('neighbourhood','town','region','country','global')",
            name="ck_outside_pref_layer",
        ),
    )

    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), primary_key=True)

    label = Column(String(200))
    geo_lat = Column(Float)
    geo_lng = Column(Float)
    source = Column(String(24), nullable=False, default="unset", server_default="unset")

    radius_km = Column(Float, nullable=False, default=15.0, server_default="15")
    layer = Column(String(20), nullable=False, default="town", server_default="town")
    interests = Column(JSONB, nullable=False, server_default=sa_text("'[]'::jsonb"), default=list)

    # Location is never broadcast by default: this is the switch that says
    # "show me on the nearby shelf".
    share_location = Column(Boolean, nullable=False, default=False, server_default="false")

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class OutsideContentReport(Base):
    """A report or a block. Sensitive-action audit trail included."""

    __tablename__ = "outside_content_reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open','actioned','dismissed')",
            name="ck_outside_report_status",
        ),
        Index("ix_outside_reports_status_created", "status", "created_at"),
        Index("ix_outside_reports_content", "content_kind", "content_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_vendor_id = Column(
        UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    content_kind = Column(String(24), nullable=False)
    content_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(String(40), nullable=False)
    detail = Column(Text)
    # A block hides every future item from that author for the reporter.
    is_block = Column(Boolean, nullable=False, default=False, server_default="false")
    target_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"))

    status = Column(String(20), nullable=False, default="open", server_default="open")
    resolved_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"))
    resolution_note = Column(Text)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    resolved_at = Column(DateTime)


__all__ = [
    "OutsidePost", "OutsideReaction", "OutsideDiscoveryPref", "OutsideContentReport",
    "CONTENT_KINDS", "POST_TYPES", "VISIBILITIES", "AUDIENCES", "RESPONSE_KINDS",
    "POST_STATUSES", "GEO_PRECISIONS", "LOCATION_LAYERS", "REACTIONS", "REPORT_STATUSES",
]

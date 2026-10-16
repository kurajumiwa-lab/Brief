"""
Commercial Shelf — social commerce layer built around offers, savings, and coordinated buying.

This module harnesses existing services (stock, collective, locks, groups) without replacing them:
- A commercial post is a social post that can become an actionable offer
- Offers carry individual_price, group_price, savings, target_quantity
- Group-buying interests aggregate demand (families, schools, neighborhood groups)
- Salespeople share offers and earn commission (distribution moat)

Moat sources:
- Salesperson distribution network
- Group-demand data
- Verified savings history
- Repeat buying relationships
- Local demand density
"""
import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class CommercialPostType(str, PyEnum):
    REGULAR = "regular"           # Normal social post
    COMMERCIAL = "commercial"     # Post with price/offer
    GROUP_BUY = "group_buy"       # Group buying opportunity
    DEAL = "deal"                 # Time-limited deal
    SAVINGS = "savings"           # Savings-focused post


class CommercialPostStatus(str, PyEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"
    DRAFT = "draft"


class InterestStatus(str, PyEnum):
    INTERESTED = "interested"     # Expressed interest
    JOINED = "joined"             # Joined group buy
    CONFIRMED = "confirmed"       # Confirmed purchase
    CANCELLED = "cancelled"


class CommercialPost(Base):
    """
    The commercial shelf inside the social network.
    
    A selected post can be marked with price, discount, expected savings.
    Users can save, share, express buying interest, or take action.
    
    This harnesses existing StockItem, CollectiveSourcing, and MarketLocks
    without duplicating them — a commercial post can optionally link to them.
    """
    __tablename__ = "commercial_posts"
    __table_args__ = (
        Index("ix_commercial_posts_vendor", "vendor_id"),
        Index("ix_commercial_posts_type", "post_type"),
        Index("ix_commercial_posts_status", "status"),
        Index("ix_commercial_posts_created", "created_at"),
        Index("ix_commercial_posts_commercial", "is_commercial"),
        Index("ix_commercial_posts_location", "location"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False, index=True)

    # Content — Twitter/X-style posting
    title = Column(String(300), nullable=True)  # Optional headline
    content = Column(Text, nullable=False)      # The post body

    # Type and commercial flags
    post_type = Column(Enum(CommercialPostType), default=CommercialPostType.REGULAR, nullable=False)
    is_commercial = Column(Boolean, default=False, nullable=False)
    status = Column(Enum(CommercialPostStatus), default=CommercialPostStatus.ACTIVE, nullable=False)

    # Commercial shelf — pricing
    individual_price = Column(Float, nullable=True)       # Regular price
    group_price = Column(Float, nullable=True)            # Group/coordinated price
    savings_amount = Column(Float, nullable=True)         # Calculated savings
    savings_percentage = Column(Float, nullable=True)     # % savings
    currency = Column(String(10), default="KES", nullable=False)

    # Group-buying layer
    target_quantity = Column(Integer, nullable=True)      # Target for group deal
    min_group_size = Column(Integer, nullable=True)       # Min buyers for group price
    current_interested = Column(Integer, default=0, nullable=False)
    current_quantity_pledged = Column(Integer, default=0, nullable=False)

    # Link to existing system — harnessing, not replacing
    stock_item_id = Column(UUID(as_uuid=True), ForeignKey("stock_items.id"), nullable=True)
    collective_id = Column(UUID(as_uuid=True), ForeignKey("collective_sourcing.id"), nullable=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey("vendor_groups.id"), nullable=True)

    # Media and categorization
    images = Column(JSONB, default=list)                  # Image URLs
    tags = Column(JSONB, default=list)                    # Tags for discovery
    category = Column(String(100), nullable=True)         # Product category
    location = Column(String(300), nullable=True)         # Location for local deals

    # Salesperson distribution — the moat
    commission_rate = Column(Float, nullable=True)        # % commission for sharers
    commission_fixed = Column(Float, nullable=True)       # Fixed commission
    allow_resale = Column(Boolean, default=True, nullable=False)

    # Engagement counters
    view_count = Column(Integer, default=0, nullable=False)
    save_count = Column(Integer, default=0, nullable=False)
    share_count = Column(Integer, default=0, nullable=False)
    interest_count = Column(Integer, default=0, nullable=False)

    # Visibility and expiry
    is_public = Column(Boolean, default=True, nullable=False)
    visible_to_groups = Column(JSONB, default=list)       # Group IDs that can see
    expires_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    vendor = relationship("Vendor", foreign_keys=[vendor_id])
    stock_item = relationship("StockItem", foreign_keys=[stock_item_id])
    interests = relationship("CommercialInterest", back_populates="post", cascade="all, delete-orphan")
    saves = relationship("CommercialSave", back_populates="post", cascade="all, delete-orphan")
    shares = relationship("CommercialShare", back_populates="post", cascade="all, delete-orphan")


class CommercialInterest(Base):
    """
    Group-buying interest — families, schools, neighborhood groups, businesses
    combine demand to negotiate better prices.
    """
    __tablename__ = "commercial_interests"
    __table_args__ = (
        UniqueConstraint("post_id", "vendor_id", name="uq_commercial_interest"),
        Index("ix_commercial_interests_post", "post_id"),
        Index("ix_commercial_interests_vendor", "vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(UUID(as_uuid=True), ForeignKey("commercial_posts.id"), nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False)

    quantity = Column(Integer, default=1, nullable=False)
    status = Column(Enum(InterestStatus), default=InterestStatus.INTERESTED, nullable=False)
    notes = Column(Text, nullable=True)

    # Referral tracking — who brought this buyer?
    referred_by_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    post = relationship("CommercialPost", back_populates="interests")
    vendor = relationship("Vendor", foreign_keys=[vendor_id])
    referred_by = relationship("Vendor", foreign_keys=[referred_by_vendor_id])


class CommercialSave(Base):
    """Bookmarked commercial posts"""
    __tablename__ = "commercial_saves"
    __table_args__ = (
        UniqueConstraint("post_id", "vendor_id", name="uq_commercial_save"),
        Index("ix_commercial_saves_post", "post_id"),
        Index("ix_commercial_saves_vendor", "vendor_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(UUID(as_uuid=True), ForeignKey("commercial_posts.id"), nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    post = relationship("CommercialPost", back_populates="saves")
    vendor = relationship("Vendor", foreign_keys=[vendor_id])


class CommercialShare(Base):
    """
    Distribution tracking — salespeople share offers and earn when they generate sales.
    This is the moat: salesperson distribution network.
    """
    __tablename__ = "commercial_shares"
    __table_args__ = (
        Index("ix_commercial_shares_post", "post_id"),
        Index("ix_commercial_shares_vendor", "vendor_id"),
        Index("ix_commercial_shares_created", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(UUID(as_uuid=True), ForeignKey("commercial_posts.id"), nullable=False)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False)  # Sharer

    share_channel = Column(String(50), default="copy_link", nullable=False)  # whatsapp, x, copy_link, group, direct
    share_target = Column(String(300), nullable=True)  # Group ID, chat room, etc

    # Commission tracking
    referred_vendor_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=True)
    commission_earned = Column(Float, default=0.0, nullable=False)
    commission_status = Column(String(20), default="pending", nullable=False)  # pending, earned, paid

    # Analytics
    click_count = Column(Integer, default=0, nullable=False)
    conversion_count = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    post = relationship("CommercialPost", back_populates="shares")
    vendor = relationship("Vendor", foreign_keys=[vendor_id])
    referred_vendor = relationship("Vendor", foreign_keys=[referred_vendor_id])

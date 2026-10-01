"""
Notifications (Directive v2.1 §2.3).

One row per moment a vendor should hear about. `notification_type` drives
the icon and the deep link on the client; `data` carries the ids that link
needs (movement_id, room_id, stock_id, list_id, ...). Every type is a
vendor-to-vendor moment — there are no consumer alerts here.
"""

import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class NotificationType(str, PyEnum):
    # Sourcing loop
    SOURCE_REQUEST = "source_request"        # Someone wants to buy your stock
    SOURCE_ACCEPTED = "source_accepted"      # Your sourcing request was accepted
    SOURCE_SHIPPED = "source_shipped"        # Supplier shipped your order
    SOURCE_RECEIVED = "source_received"      # Buyer received; movement settled
    SOURCE_CANCELLED = "source_cancelled"    # Either side cancelled / hold expired
    # Deal protocol (chat)
    DEAL_PROPOSAL = "deal_proposal"          # New deal proposed in chat
    DEAL_ACCEPTED = "deal_accepted"          # Your deal was accepted
    DEAL_COUNTERED = "deal_countered"        # Counter-offer on your proposal
    DEAL_DECLINED = "deal_declined"          # Proposal declined
    # Community
    GROUP_INVITE = "group_invite"            # Invited to a group
    GROUP_JOIN_REQUEST = "group_join_request"  # Someone asked to join a group you run
    GROUP_APPROVED = "group_approved"        # Your join request was approved
    LIST_REGISTRATION = "list_registration"  # A vendor registered for your list
    LIST_APPROVED = "list_approved"          # Approved for a vendor list
    LIST_REJECTED = "list_rejected"          # Rejected from a vendor list
    LIST_REVIEW = "list_review"              # A member reviewed a list you run
    COLLECTIVE_UPDATE = "collective_update"  # Group collective sourcing progress
    EVENT_REGISTRATION = "event_registration"  # A vendor registered for your event
    EVENT_REMINDER = "event_reminder"        # Upcoming event
    # Stock
    STOCK_LOW = "stock_low"                  # Stock running low (POS sync / receipt)
    STOCK_VERIFIED = "stock_verified"        # A patron verified your batch
    # Network
    PARASITISM_MILESTONE = "parasitism"      # Mutual trade milestone
    PATRON_PROMOTION = "patron_promotion"    # Tier upgrade
    SHIPMENT_UPDATE = "shipment_update"      # Courier shipment status
    # Tools: bookings & routing (v2.2)
    BOOKING_REQUEST = "booking_request"      # A vendor wants your space / rooms / pitch
    BOOKING_UPDATE = "booking_update"        # Your booking was confirmed, declined or cancelled
    ROUTE_UPDATE = "route_update"            # A courier planned a run carrying your parcel
    GOVERNANCE_UPDATE = "governance_update"  # Proposal, vote and council status
    BENEFIT_UPDATE = "benefit_update"        # Non-cash network benefit statement
    APPEAL_UPDATE = "appeal_update"          # Vendor appeal status change
    PAYMENT_UPDATE = "payment_update"        # Payment, settlement, dispute or custody event
    CHAMA_UPDATE = "chama_update"            # Chama deposit, loan vote, disbursement, dividend
    SYSTEM = "system"                        # Platform announcements


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_recipient_unread", "recipient_id", "is_read", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_id = Column(UUID(as_uuid=True), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)

    notification_type = Column(Enum(NotificationType), nullable=False)
    title = Column(String(200), nullable=False)
    body = Column(String(500))
    data = Column(JSONB, default=dict, nullable=False)
    # e.g. {"stock_id": "...", "quantity": 100, "vendor_handle": "abc"}

    is_read = Column(Boolean, default=False, nullable=False)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    recipient = relationship("Vendor", foreign_keys=[recipient_id])
    sender = relationship("Vendor", foreign_keys=[sender_id])

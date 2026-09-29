import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Table, Text
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class ChatRoomType(str, PyEnum):
    GROUP = "group"           # Group chat
    DIRECT = "direct"         # Vendor-to-vendor
    DEAL = "deal"             # Around a specific stock deal
    NICHE_TOPIC = "niche"     # Topic-based (e.g., "Import regulations")
    VENDOR_LIST = "vendor_list"  # Chat for a vendor list


# Who is in a room. Group rooms are governed by group membership; direct and
# deal rooms by this table.
chat_room_participants = Table(
    'chat_room_participants',
    Base.metadata,
    Column('room_id', UUID(as_uuid=True), ForeignKey('chat_rooms.id'), primary_key=True),
    Column('vendor_id', UUID(as_uuid=True), ForeignKey('vendors.id'), primary_key=True),
    Column('joined_at', DateTime, default=datetime.utcnow),
)


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200))
    room_type = Column(Enum(ChatRoomType), nullable=False)

    # Linked entities
    group_id = Column(UUID(as_uuid=True), ForeignKey('vendor_groups.id'), nullable=True)
    vendor_list_id = Column(UUID(as_uuid=True), ForeignKey('vendor_lists.id'), nullable=True)
    deal_stock_item_id = Column(UUID(as_uuid=True), ForeignKey('stock_items.id'), nullable=True)

    # Niche topic
    topic = Column(String(200))
    topic_tags = Column(JSONB, default=list)

    # Settings
    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Stats
    message_count = Column(Integer, default=0, nullable=False)
    participant_count = Column(Integer, default=0, nullable=False)

    group = relationship("VendorGroup", back_populates="chat_room")
    messages = relationship("ChatMessage", back_populates="room", order_by="ChatMessage.sent_at")
    participants = relationship("Vendor", secondary=chat_room_participants, viewonly=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id = Column(UUID(as_uuid=True), ForeignKey('chat_rooms.id'), nullable=False, index=True)
    sender_id = Column(UUID(as_uuid=True), ForeignKey('vendors.id'), nullable=False)

    content = Column(Text, nullable=False)
    message_type = Column(String(50), default="text", nullable=False)  # text, stock_share, deal_proposal, image

    # If sharing stock item
    shared_stock_id = Column(UUID(as_uuid=True), ForeignKey('stock_items.id'), nullable=True)

    # Deal proposal embedded in message
    deal_data = Column(JSONB, nullable=True)
    # e.g. {"stock_id": "...", "quantity": 100, "proposed_price": 50.00}

    attachments = Column(JSONB, default=list)
    is_pinned = Column(Boolean, default=False, nullable=False)
    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    room = relationship("ChatRoom", back_populates="messages")
    sender = relationship("Vendor")

import asyncio
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session, get_db
from app.models.chat import ChatMessage, ChatRoom, ChatRoomType, chat_room_participants
from app.models.groups import GroupMembership, VendorGroup
from app.models.stock import StockItem
from app.models.vendor import Vendor
from app.models.vendor_list import VendorListMembership
from app.routes.auth import get_current_vendor, vendor_id_from_token

router = APIRouter()


# --- realtime ------------------------------------------------------------------

class ConnectionManager:
    """In-process fan-out. One API instance = one room registry. A multi-
    instance deploy should put a Redis pub/sub behind `broadcast`."""

    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, room_id: str):
        """Register an already-accepted socket and greet it."""
        async with self._lock:
            self.active_connections.setdefault(room_id, []).append(websocket)
        await websocket.send_json({"type": "hello", "room_id": room_id})

    async def disconnect(self, websocket: WebSocket, room_id: str):
        async with self._lock:
            conns = self.active_connections.get(room_id, [])
            if websocket in conns:
                conns.remove(websocket)
            if not conns:
                self.active_connections.pop(room_id, None)

    async def broadcast(self, room_id: str, message: dict):
        for connection in list(self.active_connections.get(room_id, [])):
            try:
                await connection.send_json(message)
            except Exception:
                await self.disconnect(connection, room_id)


manager = ConnectionManager()


# --- schemas ---------------------------------------------------------------------

class NicheTopicCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    topic: str = Field(min_length=1, max_length=200)
    topic_tags: list[str] = []


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    message_type: str = Field("text", pattern="^(text|stock_share|deal_proposal|image)$")
    shared_stock_id: Optional[str] = None
    deal_data: Optional[dict] = None
    attachments: list = []


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    room_id: str
    sender_id: str
    sender_handle: str
    sender_business: str
    content: str
    message_type: str
    shared_stock: Optional[dict] = None
    deal_data: Optional[dict]
    attachments: list = []
    is_pinned: bool = False
    sent_at: str


def _room_out(r: ChatRoom, joined: bool) -> dict:
    return {
        "id": str(r.id),
        "name": r.name,
        "room_type": r.room_type.value,
        "topic": r.topic,
        "topic_tags": r.topic_tags or [],
        "group_id": str(r.group_id) if r.group_id else None,
        "vendor_list_id": str(r.vendor_list_id) if r.vendor_list_id else None,
        "deal_stock_item_id": str(r.deal_stock_item_id) if r.deal_stock_item_id else None,
        "participant_count": r.participant_count,
        "message_count": r.message_count,
        "joined": joined,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def _is_participant(db: AsyncSession, room: ChatRoom, vendor_id: UUID) -> bool:
    """Niche topics are open to every vendor. Group rooms follow group
    membership, list rooms follow list membership, direct/deal rooms follow the
    participants table."""
    if room.room_type == ChatRoomType.NICHE_TOPIC:
        return True
    if room.room_type == ChatRoomType.GROUP and room.group_id:
        row = (await db.execute(select(GroupMembership.id).where(
            GroupMembership.group_id == room.group_id, GroupMembership.vendor_id == vendor_id,
            GroupMembership.is_active.is_(True),
        ))).first()
        return row is not None
    if room.room_type == ChatRoomType.VENDOR_LIST and room.vendor_list_id:
        approved = (await db.execute(select(VendorListMembership.id).where(
            VendorListMembership.vendor_list_id == room.vendor_list_id,
            VendorListMembership.vendor_id == vendor_id, VendorListMembership.status == "approved",
        ))).first()
        if approved:
            return True
    row = (await db.execute(select(chat_room_participants.c.vendor_id).where(
        chat_room_participants.c.room_id == room.id, chat_room_participants.c.vendor_id == vendor_id,
    ))).first()
    return row is not None


async def _get_room_for(db: AsyncSession, room_id: UUID, vendor: Vendor) -> ChatRoom:
    room = await db.get(ChatRoom, room_id)
    if not room or not room.is_active:
        raise HTTPException(404, "Chat room not found")
    if not await _is_participant(db, room, vendor.id):
        raise HTTPException(403, "You are not in this room")
    return room


async def _stock_snippet(db: AsyncSession, stock_id: Optional[UUID]) -> Optional[dict]:
    if not stock_id:
        return None
    item = await db.get(StockItem, stock_id)
    if not item:
        return None
    return {
        "id": str(item.id), "name": item.name, "sku": item.sku, "category": item.category,
        "quantity_available": item.quantity_available, "unit_of_measure": item.unit_of_measure,
        "wholesale_price": item.wholesale_price, "unit_price": item.unit_price,
        "min_order_quantity": item.min_order_quantity, "vendor_id": str(item.vendor_id),
    }


# --- rooms ------------------------------------------------------------------------

@router.post("/niche-topic", status_code=201)
async def create_niche_topic(
    data: NicheTopicCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Create a niche topic chat room (e.g., 'Import regulations', 'Textile sourcing tips')"""
    room = ChatRoom(
        name=data.name.strip(), room_type=ChatRoomType.NICHE_TOPIC, topic=data.topic,
        topic_tags=data.topic_tags, created_by=vendor.id, participant_count=1,
    )
    db.add(room)
    await db.flush()
    await db.execute(chat_room_participants.insert().values(room_id=room.id, vendor_id=vendor.id))
    await db.commit()
    return {"message": f"Topic '{room.name}' created", "room_id": str(room.id)}


@router.post("/direct/{vendor_id}")
async def open_direct_room(
    vendor_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Get or create the one direct room between you and another vendor."""
    if vendor_id == vendor.id:
        raise HTTPException(400, "That is you")
    other = await db.get(Vendor, vendor_id)
    if not other:
        raise HTTPException(404, "Vendor not found")

    p = chat_room_participants
    mine = select(p.c.room_id).where(p.c.vendor_id == vendor.id)
    theirs = select(p.c.room_id).where(p.c.vendor_id == vendor_id)
    room = (await db.execute(select(ChatRoom).where(
        ChatRoom.room_type == ChatRoomType.DIRECT, ChatRoom.id.in_(mine), ChatRoom.id.in_(theirs),
    ))).scalars().first()
    created = False
    if room is None:
        room = ChatRoom(name=f"@{vendor.vendor_handle} · @{other.vendor_handle}", room_type=ChatRoomType.DIRECT,
                        created_by=vendor.id, participant_count=2)
        db.add(room)
        await db.flush()
        await db.execute(p.insert().values([
            {"room_id": room.id, "vendor_id": vendor.id}, {"room_id": room.id, "vendor_id": vendor_id},
        ]))
        await db.commit()
        created = True
    return {"room_id": str(room.id), "created": created, "room": _room_out(room, True)}


@router.post("/deal/{stock_id}")
async def open_deal_room(
    stock_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """A room between you and the vendor whose stock this is, to talk the deal through."""
    item = await db.get(StockItem, stock_id)
    if not item:
        raise HTTPException(404, "Stock item not found")
    if item.vendor_id == vendor.id:
        raise HTTPException(400, "This is your own stock")
    p = chat_room_participants
    mine = select(p.c.room_id).where(p.c.vendor_id == vendor.id)
    room = (await db.execute(select(ChatRoom).where(
        ChatRoom.room_type == ChatRoomType.DEAL, ChatRoom.deal_stock_item_id == stock_id, ChatRoom.id.in_(mine),
    ))).scalars().first()
    if room is None:
        room = ChatRoom(name=f"Deal · {item.name}", room_type=ChatRoomType.DEAL, deal_stock_item_id=stock_id,
                        created_by=vendor.id, participant_count=2)
        db.add(room)
        await db.flush()
        await db.execute(p.insert().values([
            {"room_id": room.id, "vendor_id": vendor.id}, {"room_id": room.id, "vendor_id": item.vendor_id},
        ]))
        await db.commit()
    return {"room_id": str(room.id), "room": _room_out(room, True)}


@router.get("/rooms")
async def list_chat_rooms(
    room_type: Optional[ChatRoomType] = None,
    mine_only: bool = False,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Rooms you can see: every niche topic, plus the group/list/direct/deal rooms you belong to."""
    p = chat_room_participants
    my_rooms = select(p.c.room_id).where(p.c.vendor_id == vendor.id)
    my_groups = select(GroupMembership.group_id).where(
        GroupMembership.vendor_id == vendor.id, GroupMembership.is_active.is_(True))
    my_lists = select(VendorListMembership.vendor_list_id).where(
        VendorListMembership.vendor_id == vendor.id, VendorListMembership.status == "approved")

    member_clause = or_(ChatRoom.id.in_(my_rooms), ChatRoom.group_id.in_(my_groups), ChatRoom.vendor_list_id.in_(my_lists))
    query = select(ChatRoom).where(ChatRoom.is_active.is_(True))
    if mine_only:
        query = query.where(member_clause)
    else:
        query = query.where(or_(ChatRoom.room_type == ChatRoomType.NICHE_TOPIC, member_clause))
    if room_type:
        query = query.where(ChatRoom.room_type == room_type)
    query = query.order_by(ChatRoom.message_count.desc(), ChatRoom.created_at.desc()).limit(200)
    rooms = (await db.execute(query)).scalars().all()

    joined_ids = set((await db.execute(my_rooms)).scalars())
    group_ids = set((await db.execute(my_groups)).scalars())
    list_ids = set((await db.execute(my_lists)).scalars())
    return [
        _room_out(r, r.id in joined_ids or (r.group_id in group_ids) or (r.vendor_list_id in list_ids))
        for r in rooms
    ]


@router.post("/{room_id}/join")
async def join_topic(
    room_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Follow a niche topic so it shows under 'mine'."""
    room = await db.get(ChatRoom, room_id)
    if not room or room.room_type != ChatRoomType.NICHE_TOPIC:
        raise HTTPException(404, "Topic not found")
    p = chat_room_participants
    exists = (await db.execute(select(p.c.vendor_id).where(p.c.room_id == room_id, p.c.vendor_id == vendor.id))).first()
    if not exists:
        await db.execute(p.insert().values(room_id=room_id, vendor_id=vendor.id))
        room.participant_count += 1
        await db.commit()
    return {"message": f"Following '{room.name}'"}


# --- messages ----------------------------------------------------------------------

@router.post("/{room_id}/message", status_code=201)
async def send_message(
    room_id: UUID,
    data: MessageCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    room = await _get_room_for(db, room_id, vendor)

    shared_id: Optional[UUID] = None
    if data.shared_stock_id:
        try:
            shared_id = UUID(data.shared_stock_id)
        except ValueError:
            raise HTTPException(400, "shared_stock_id is not a UUID")
        if not await db.get(StockItem, shared_id):
            raise HTTPException(404, "Shared stock item not found")

    msg = ChatMessage(
        room_id=room_id, sender_id=vendor.id, content=data.content, message_type=data.message_type,
        shared_stock_id=shared_id, deal_data=data.deal_data, attachments=data.attachments,
    )
    db.add(msg)
    room.message_count += 1
    if room.room_type == ChatRoomType.GROUP and room.group_id:
        gm = (await db.execute(select(GroupMembership).where(
            GroupMembership.group_id == room.group_id, GroupMembership.vendor_id == vendor.id,
        ))).scalars().first()
        if gm:
            gm.messages_sent += 1
        group = await db.get(VendorGroup, room.group_id)
        if group is not None:
            group.message_count += 1
    await db.commit()
    await db.refresh(msg)

    payload = MessageOut(
        id=str(msg.id), room_id=str(room_id), sender_id=str(vendor.id),
        sender_handle=vendor.vendor_handle, sender_business=vendor.business_name,
        content=msg.content, message_type=msg.message_type,
        shared_stock=await _stock_snippet(db, shared_id), deal_data=msg.deal_data,
        attachments=msg.attachments or [], is_pinned=msg.is_pinned, sent_at=msg.sent_at.isoformat(),
    ).model_dump()
    await manager.broadcast(str(room_id), {"type": "message", "message": payload})
    return {"message": "Sent", "message_id": str(msg.id), "sent": payload}


@router.get("/{room_id}/messages", response_model=List[MessageOut])
async def get_messages(
    room_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    await _get_room_for(db, room_id, vendor)
    rows = (await db.execute(
        select(ChatMessage, Vendor).join(Vendor, ChatMessage.sender_id == Vendor.id)
        .where(ChatMessage.room_id == room_id)
        .order_by(ChatMessage.sent_at.desc()).offset(skip).limit(limit)
    )).all()
    out = []
    for m, v in reversed(rows):
        out.append(MessageOut(
            id=str(m.id), room_id=str(room_id), sender_id=str(v.id),
            sender_handle=v.vendor_handle, sender_business=v.business_name,
            content=m.content, message_type=m.message_type,
            shared_stock=await _stock_snippet(db, m.shared_stock_id), deal_data=m.deal_data,
            attachments=m.attachments or [], is_pinned=m.is_pinned, sent_at=m.sent_at.isoformat(),
        ))
    return out


@router.get("/{room_id}")
async def get_room(
    room_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    room = await _get_room_for(db, room_id, vendor)
    return _room_out(room, True)


@router.websocket("/{room_id}/ws")
async def websocket_endpoint(websocket: WebSocket, room_id: str, token: str = Query(...)):
    """Receive-only stream of a room. Messages are sent over HTTP POST; the
    socket carries the broadcasts. Authenticates with ?token=<jwt>.

    The handshake is always accepted so the browser sees a close *code* it can
    act on (4401 bad token, 4403 not a participant, 4404 no such room) rather
    than an opaque handshake failure."""
    await websocket.accept()
    vendor_id = vendor_id_from_token(token)
    if vendor_id is None:
        await websocket.close(code=4401, reason="invalid or expired token")
        return
    try:
        rid = UUID(room_id)
    except ValueError:
        await websocket.close(code=4404, reason="no such room")
        return
    async with async_session() as db:
        room = await db.get(ChatRoom, rid)
        if not room or not room.is_active:
            await websocket.close(code=4404, reason="no such room")
            return
        if not await _is_participant(db, room, vendor_id):
            await websocket.close(code=4403, reason="not a participant")
            return

    await manager.connect(websocket, room_id)
    try:
        while True:
            # Keep-alive / pings from the client; content is ignored by design.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket, room_id)

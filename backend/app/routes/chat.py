import asyncio
import json
import logging
from datetime import datetime, timedelta
import math
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.database import async_session, get_db
from app.models.chat import ChatMessage, ChatRoom, ChatRoomType, chat_room_participants
from app.models.groups import GroupMembership, VendorGroup
from app.models.notification import NotificationType
from app.models.stock import PriceNegotiation, StockItem, StockMovement
from app.models.vendor import Vendor
from app.models.vendor_list import VendorListMembership
from app.routes.auth import get_current_vendor, vendor_id_from_token
from app.services import notification_service, stock_engine
from app.services.storage import StorageError, VOICE_TYPES, storage

router = APIRouter()
log = logging.getLogger("brief.chat")


# --- realtime ------------------------------------------------------------------

class ConnectionManager:
    """Room → sockets registry. Single process: frames go straight to the local
    sockets. With REDIS_URL (several uvicorn workers / instances) every frame
    is published on `brief:chat:<room>` and each process delivers what it
    hears to its own sockets, so a deal accepted on worker 2 reaches the buyer
    connected to worker 3."""

    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self._lock = asyncio.Lock()
        self._redis = None
        self._listener: Optional[asyncio.Task] = None

    async def configure(self) -> None:
        """Called from the app lifespan; silently stays in-process when Redis is not reachable."""
        if not settings.REDIS_URL:
            return
        try:
            import redis.asyncio as aioredis
            client = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
            await client.ping()
        except Exception as exc:
            log.info("chat fan-out: in-process (%s)", type(exc).__name__)
            return
        self._redis = client
        self._listener = asyncio.create_task(self._listen())
        log.info("chat fan-out: redis pub/sub")

    async def shutdown(self) -> None:
        if self._listener:
            self._listener.cancel()
            try:
                await self._listener
            except (asyncio.CancelledError, Exception):
                pass
        if self._redis:
            try:
                await self._redis.close()
            except Exception:
                pass

    async def _listen(self) -> None:
        while True:
            pubsub = self._redis.pubsub()
            try:
                await pubsub.psubscribe("brief:chat:*")
                async for item in pubsub.listen():
                    if item.get("type") != "pmessage":
                        continue
                    channel = item["channel"]
                    channel = channel.decode() if isinstance(channel, bytes) else channel
                    await self._deliver(channel.rsplit(":", 1)[-1], json.loads(item["data"]))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("chat fan-out listener dropped (%s); reconnecting", type(exc).__name__)
                await asyncio.sleep(2)
            finally:
                try:
                    await pubsub.close()
                except Exception:
                    pass

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
        if self._redis is not None:
            try:
                await self._redis.publish(f"brief:chat:{room_id}", json.dumps(message, default=str))
                return
            except Exception as exc:
                log.warning("chat fan-out publish failed (%s); delivering locally", type(exc).__name__)
        await self._deliver(room_id, message)

    async def _deliver(self, room_id: str, message: dict):
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


class DealProposalData(BaseModel):
    """Structured terms carried in `deal_data` of a `deal_proposal` message (v2.1 §4.1)."""
    stock_item_id: str
    quantity: int = Field(gt=0)
    proposed_price_per_unit: float = Field(ge=0)
    delivery_terms: str = Field("pickup", max_length=100)     # pickup, delivery, courier
    payment_terms: str = Field("on_delivery", max_length=100)  # on_delivery, advance, credit_30
    notes: str = Field("", max_length=1000)


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    message_type: str = Field("text", pattern="^(text|stock_share|deal_proposal|image|system)$")
    shared_stock_id: Optional[str] = None
    deal_data: Optional[dict] = None
    attachments: list = []


class CounterOffer(BaseModel):
    proposed_price_per_unit: float = Field(ge=0)
    quantity: Optional[int] = Field(None, gt=0)
    delivery_terms: Optional[str] = Field(None, max_length=100)
    payment_terms: Optional[str] = Field(None, max_length=100)
    notes: str = Field("", max_length=1000)


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


def _room_out(r: ChatRoom, joined: bool, participants: Optional[list] = None) -> dict:
    return {
        "participants": participants or [],
        "id": str(r.id),
        "name": r.name,
        "room_type": r.room_type.value,
        "topic": r.topic,
        "topic_tags": r.topic_tags or [],
        "group_id": str(r.group_id) if r.group_id else None,
        "vendor_list_id": str(r.vendor_list_id) if r.vendor_list_id else None,
        "deal_stock_item_id": str(r.deal_stock_item_id) if r.deal_stock_item_id else None,
        "stock_movement_id": str(r.stock_movement_id) if r.stock_movement_id else None,
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


async def _participants(db: AsyncSession, room: ChatRoom) -> list[dict]:
    """Who is on the other side of a direct / deal room (the deal picker needs it)."""
    if room.room_type not in (ChatRoomType.DIRECT, ChatRoomType.DEAL):
        return []
    rows = (await db.execute(
        select(Vendor.id, Vendor.vendor_handle, Vendor.business_name)
        .join(chat_room_participants, chat_room_participants.c.vendor_id == Vendor.id)
        .where(chat_room_participants.c.room_id == room.id)
    )).all()
    return [{"id": str(r.id), "vendor_handle": r.vendor_handle, "business_name": r.business_name} for r in rows]


async def _participant_ids(db: AsyncSession, room: ChatRoom) -> list[UUID]:
    if room.room_type == ChatRoomType.GROUP and room.group_id:
        return list((await db.execute(select(GroupMembership.vendor_id).where(
            GroupMembership.group_id == room.group_id, GroupMembership.is_active.is_(True)))).scalars())
    if room.room_type == ChatRoomType.VENDOR_LIST and room.vendor_list_id:
        return list((await db.execute(select(VendorListMembership.vendor_id).where(
            VendorListMembership.vendor_list_id == room.vendor_list_id,
            VendorListMembership.status == "approved"))).scalars())
    return list((await db.execute(select(chat_room_participants.c.vendor_id).where(
        chat_room_participants.c.room_id == room.id))).scalars())


def _message_out(m: ChatMessage, v: Vendor, shared_stock: Optional[dict]) -> dict:
    # A private object key is stored alongside the voice metadata for the
    # authenticated playback endpoint, but must never leave the API response.
    attachments = []
    for attachment in m.attachments or []:
        if isinstance(attachment, dict) and attachment.get("kind") == "voice":
            attachments.append({k: value for k, value in attachment.items() if k != "storage_key"})
        else:
            attachments.append(attachment)
    return MessageOut(
        id=str(m.id), room_id=str(m.room_id), sender_id=str(v.id),
        sender_handle=v.vendor_handle, sender_business=v.business_name,
        content=m.content, message_type=m.message_type,
        shared_stock=shared_stock, deal_data=m.deal_data,
        attachments=attachments, is_pinned=m.is_pinned, sent_at=m.sent_at.isoformat(),
    ).model_dump()


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
    return {"room_id": str(room.id), "created": created, "room": _room_out(room, True, await _participants(db, room))}


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
    return {"room_id": str(room.id), "room": _room_out(room, True, await _participants(db, room))}


@router.post("/orders/{movement_id}")
async def open_order_room(
    movement_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Get or create a private live conversation attached to one order."""
    movement = await db.get(StockMovement, movement_id, with_for_update=True)
    if not movement or vendor.id not in (movement.from_vendor_id, movement.to_vendor_id):
        raise HTTPException(404, "Order not found")
    room = (await db.execute(select(ChatRoom).where(
        ChatRoom.stock_movement_id == movement.id,
    ))).scalars().first()
    if room is None:
        item = await db.get(StockItem, movement.stock_item_id)
        room = ChatRoom(
            name=f"Order · {item.name if item else 'transaction'}",
            room_type=ChatRoomType.DEAL,
            deal_stock_item_id=movement.stock_item_id,
            stock_movement_id=movement.id,
            created_by=vendor.id,
            participant_count=2,
        )
        db.add(room)
        await db.flush()
        await db.execute(chat_room_participants.insert().values([
            {"room_id": room.id, "vendor_id": movement.from_vendor_id},
            {"room_id": room.id, "vendor_id": movement.to_vendor_id},
        ]))
        await db.commit()
    return {"room_id": str(room.id), "room": _room_out(room, True, await _participants(db, room))}


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

    # Participants of the direct/deal rooms in one query (the room list shows who is on the other side).
    small = [r.id for r in rooms if r.room_type in (ChatRoomType.DIRECT, ChatRoomType.DEAL)]
    participants: dict = {rid: [] for rid in small}
    if small:
        rows = (await db.execute(
            select(p.c.room_id, Vendor.id, Vendor.vendor_handle, Vendor.business_name)
            .join(Vendor, Vendor.id == p.c.vendor_id).where(p.c.room_id.in_(small))
        )).all()
        for room_id, vid, handle, business in rows:
            participants[room_id].append({"id": str(vid), "vendor_handle": handle, "business_name": business})
    return [
        _room_out(r, r.id in joined_ids or (r.group_id in group_ids) or (r.vendor_list_id in list_ids), participants.get(r.id))
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

    deal_data = data.deal_data
    deal_stock: Optional[StockItem] = None
    if data.message_type == "deal_proposal":
        try:
            terms = DealProposalData(**(deal_data or {}))
        except ValidationError as exc:
            first = exc.errors()[0]
            raise HTTPException(400, f"deal_data.{first['loc'][0] if first.get('loc') else '?'}: {first['msg']}")
        try:
            deal_stock = await db.get(StockItem, UUID(terms.stock_item_id))
        except ValueError:
            raise HTTPException(400, "deal_data.stock_item_id is not a UUID")
        if deal_stock is None:
            raise HTTPException(404, "Deal stock item not found")
        deal_data = {**terms.model_dump(), "status": "proposed", "proposed_by": str(vendor.id),
                     "stock_name": deal_stock.name, "unit_of_measure": deal_stock.unit_of_measure,
                     "supplier_id": str(deal_stock.vendor_id),
                     "total": round(terms.quantity * terms.proposed_price_per_unit, 2)}
    elif data.message_type == "system":
        raise HTTPException(400, "system messages are written by the platform")

    msg = ChatMessage(
        room_id=room_id, sender_id=vendor.id, content=data.content, message_type=data.message_type,
        shared_stock_id=shared_id, deal_data=deal_data, attachments=data.attachments,
    )
    db.add(msg)
    room.message_count += 1
    await db.flush()

    if deal_stock is not None:
        # Tell the other side. Owner of the stock hears it as a request to supply;
        # in a direct/deal room a supplier proposing their own stock notifies the buyer.
        recipients = [deal_stock.vendor_id] if deal_stock.vendor_id != vendor.id else [
            pid for pid in await _participant_ids(db, room) if pid != vendor.id]
        for rid in recipients:
            await notification_service.create_notification(
                db, rid, NotificationType.DEAL_PROPOSAL,
                f"Deal proposal from @{vendor.vendor_handle}",
                f"{deal_data['quantity']} {deal_stock.unit_of_measure} of {deal_stock.name} at {deal_data['proposed_price_per_unit']:g}/unit",
                sender_id=vendor.id,
                data={**deal_data, "room_id": room_id, "message_id": msg.id, "vendor_handle": vendor.vendor_handle},
            )
        # Open (or extend) the price negotiation record for this line.
        buyer_id = vendor.id if deal_stock.vendor_id != vendor.id else next(
            (pid for pid in await _participant_ids(db, room) if pid != vendor.id), None)
        if buyer_id is not None:
            db.add(PriceNegotiation(
                stock_item_id=deal_stock.id, buyer_vendor_id=buyer_id, seller_vendor_id=deal_stock.vendor_id,
                original_price=stock_engine.base_unit_price(deal_stock),
                counter_offer=deal_data["proposed_price_per_unit"], quantity=deal_data["quantity"],
                status="pending", rounds=1, last_offer_by_vendor_id=vendor.id,
                buyer_notes=deal_data.get("notes") if buyer_id == vendor.id else None,
                seller_notes=deal_data.get("notes") if buyer_id != vendor.id else None,
                chat_room_id=room.id, message_id=msg.id,
                expires_at=datetime.utcnow() + timedelta(hours=settings.RESERVATION_HOLD_HOURS),
            ))
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

    payload = _message_out(msg, vendor, await _stock_snippet(db, shared_id))
    await manager.broadcast(str(room_id), {"type": "message", "message": payload})
    return {"message": "Sent", "message_id": str(msg.id), "sent": payload}


@router.post("/{room_id}/voice", status_code=201)
async def send_voice_note(
    room_id: UUID,
    file: UploadFile = File(...),
    duration_seconds: float = Form(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Upload a short voice note into an existing vendor chat room."""
    room = await _get_room_for(db, room_id, vendor)
    if room.room_type == ChatRoomType.NICHE_TOPIC:
        joined = (await db.execute(select(chat_room_participants.c.vendor_id).where(
            chat_room_participants.c.room_id == room.id, chat_room_participants.c.vendor_id == vendor.id,
        ))).first()
        if not joined:
            raise HTTPException(403, "Join this topic before posting")
    if not math.isfinite(duration_seconds) or not 0 < duration_seconds <= settings.VOICE_MAX_SECONDS:
        raise HTTPException(400, f"Voice notes must be between 0 and {settings.VOICE_MAX_SECONDS} seconds")

    mime_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if mime_type not in VOICE_TYPES:
        raise HTTPException(415, "Unsupported audio format. Record as WebM, Ogg, MP4, AAC, MP3 or WAV.")
    data = await file.read(settings.VOICE_MAX_BYTES + 1)
    if not data:
        raise HTTPException(400, "Voice note is empty")
    if len(data) > settings.VOICE_MAX_BYTES:
        raise HTTPException(413, f"Voice note is larger than {settings.VOICE_MAX_BYTES // 1024} KB")

    try:
        storage_key = await storage.upload_voice(data, mime_type)
    except StorageError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:  # bucket or disk misconfiguration
        log.error("voice upload failed (%s)", type(exc).__name__)
        raise HTTPException(503, "Voice storage is temporarily unavailable")

    msg = ChatMessage(
        room_id=room_id, sender_id=vendor.id, content="", message_type="voice",
        attachments=[{
            "kind": "voice", "storage_key": storage_key, "content_type": mime_type,
            "duration_seconds": round(duration_seconds, 1), "size_bytes": len(data),
        }],
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
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        await storage.delete_voice(storage_key)
        raise
    await db.refresh(msg)

    payload = _message_out(msg, vendor, None)
    await manager.broadcast(str(room_id), {"type": "message", "message": payload})
    return {"message": "Voice note sent", "message_id": str(msg.id), "sent": payload}


@router.get("/{room_id}/voice/{message_id}")
async def get_voice_note(
    room_id: UUID,
    message_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Stream a clip only to a vendor who can read the chat room."""
    await _get_room_for(db, room_id, vendor)
    msg = await db.get(ChatMessage, message_id)
    if not msg or msg.room_id != room_id or msg.message_type != "voice":
        raise HTTPException(404, "Voice note not found")
    attachment = next((a for a in (msg.attachments or []) if isinstance(a, dict) and a.get("kind") == "voice"), None)
    storage_key = attachment.get("storage_key") if attachment else None
    if not storage_key:
        raise HTTPException(404, "Voice note not found")
    try:
        content, content_type = await storage.read_voice(storage_key)
    except StorageError:
        raise HTTPException(404, "Voice note not found")
    except Exception as exc:
        log.error("voice playback failed (%s)", type(exc).__name__)
        raise HTTPException(503, "Voice storage is temporarily unavailable")
    extension = storage_key.rsplit(".", 1)[-1]
    return Response(content=content, media_type=content_type, headers={
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'inline; filename="voice-note.{extension}"',
    })


# --- deal protocol (v2.1 §4.1 / §4.2) -----------------------------------------------------

async def _load_proposal(db: AsyncSession, room_id: UUID, message_id: UUID, vendor: Vendor):
    room = await _get_room_for(db, room_id, vendor)
    msg = await db.get(ChatMessage, message_id, with_for_update=True)
    if not msg or msg.room_id != room_id or msg.message_type != "deal_proposal" or not msg.deal_data:
        raise HTTPException(404, "Deal proposal not found")
    if msg.sender_id == vendor.id:
        raise HTTPException(403, "You made this proposal; wait for the other side")
    if msg.deal_data.get("status", "proposed") != "proposed":
        raise HTTPException(400, f"This proposal is already {msg.deal_data.get('status')}")
    return room, msg


async def _negotiation_for(db: AsyncSession, msg: ChatMessage) -> Optional[PriceNegotiation]:
    return (await db.execute(select(PriceNegotiation).where(PriceNegotiation.message_id == msg.id))).scalars().first()


async def _post_system(db: AsyncSession, room: ChatRoom, author: Vendor, content: str, deal_data: Optional[dict] = None) -> dict:
    note = ChatMessage(room_id=room.id, sender_id=author.id, content=content, message_type="system", deal_data=deal_data)
    db.add(note)
    room.message_count += 1
    await db.flush()
    return note


@router.post("/{room_id}/deals/{message_id}/accept")
async def accept_deal(
    room_id: UUID,
    message_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Mutual confirmation: the counterpart accepts the terms as proposed. A
    movement is created at the agreed price and starts *confirmed* — both
    sides have agreed — so the supplier's next step is to ship."""
    room, msg = await _load_proposal(db, room_id, message_id, vendor)
    deal = dict(msg.deal_data)
    item = await db.get(StockItem, UUID(deal["stock_item_id"]), with_for_update=True)
    if item is None:
        raise HTTPException(404, "The stock in this proposal no longer exists")
    proposer = await db.get(Vendor, msg.sender_id)
    buyer = vendor if item.vendor_id != vendor.id else proposer
    if buyer is None or buyer.id == item.vendor_id:
        raise HTTPException(400, "Neither party of this proposal can buy this stock")

    try:
        movement = await stock_engine.request_sourcing(
            db, item, buyer, int(deal["quantity"]), float(deal["proposed_price_per_unit"]),
            deal.get("notes") or f"Deal agreed in chat with @{proposer.vendor_handle if proposer else '?'}",
            confirmed=True,
        )
    except stock_engine.StockError as exc:
        raise HTTPException(exc.status_code, str(exc))

    deal.update({"status": "accepted", "accepted_by": str(vendor.id), "accepted_at": datetime.utcnow().isoformat(),
                 "movement_id": str(movement.id)})
    msg.deal_data = deal
    flag_modified(msg, "deal_data")

    neg = await _negotiation_for(db, msg)
    if neg is not None:
        neg.status = "accepted"
        neg.accepted_price = float(deal["proposed_price_per_unit"])
        neg.resolved_at = datetime.utcnow()
        neg.movement_id = movement.id

    await _post_system(
        db, room, vendor,
        f"✅ @{vendor.vendor_handle} accepted the deal: {deal['quantity']} {item.unit_of_measure} of {item.name} "
        f"at {float(deal['proposed_price_per_unit']):g}/unit. Movement confirmed — supplier ships next.",
        {"kind": "deal_accepted", "movement_id": str(movement.id), "message_id": str(msg.id)},
    )
    if proposer is not None:
        await notification_service.create_notification(
            db, proposer.id, NotificationType.DEAL_ACCEPTED,
            f"@{vendor.vendor_handle} accepted your deal on {item.name}",
            f"{deal['quantity']} {item.unit_of_measure} at {float(deal['proposed_price_per_unit']):g}/unit · movement confirmed",
            sender_id=vendor.id, data={"movement_id": movement.id, "room_id": room.id, "stock_id": item.id,
                                        "direction": "incoming" if proposer.id == buyer.id else "outgoing"},
        )
    await db.commit()
    await db.refresh(msg)
    await _broadcast_update(db, room, msg)
    return {"message": "Deal accepted", "status": "accepted", "movement_id": str(movement.id),
            "movement_status": movement.status}


@router.post("/{room_id}/deals/{message_id}/counter", status_code=201)
async def counter_deal(
    room_id: UUID,
    message_id: UUID,
    data: CounterOffer,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Counter-offer: marks the proposal `countered` and posts a fresh proposal
    with the new terms from the countering side."""
    room, msg = await _load_proposal(db, room_id, message_id, vendor)
    deal = dict(msg.deal_data)
    deal.update({"status": "countered", "countered_by": str(vendor.id), "countered_at": datetime.utcnow().isoformat()})
    msg.deal_data = deal
    flag_modified(msg, "deal_data")

    new_terms = {
        "stock_item_id": deal["stock_item_id"],
        "quantity": data.quantity or int(deal["quantity"]),
        "proposed_price_per_unit": data.proposed_price_per_unit,
        "delivery_terms": data.delivery_terms or deal.get("delivery_terms", "pickup"),
        "payment_terms": data.payment_terms or deal.get("payment_terms", "on_delivery"),
        "notes": data.notes or "",
    }
    item = await db.get(StockItem, UUID(deal["stock_item_id"]))
    new_deal = {**new_terms, "status": "proposed", "proposed_by": str(vendor.id), "parent_message_id": str(msg.id),
                "round": int(deal.get("round", 1)) + 1,
                "stock_name": item.name if item else deal.get("stock_name"),
                "unit_of_measure": item.unit_of_measure if item else deal.get("unit_of_measure"),
                "supplier_id": deal.get("supplier_id"),
                "total": round(new_terms["quantity"] * new_terms["proposed_price_per_unit"], 2)}
    counter = ChatMessage(
        room_id=room.id, sender_id=vendor.id, message_type="deal_proposal", deal_data=new_deal,
        content=f"Counter-offer: {new_terms['quantity']} × {new_deal.get('stock_name') or 'item'} at {data.proposed_price_per_unit:g}/unit"
                + (f" — {data.notes}" if data.notes else ""),
    )
    db.add(counter)
    room.message_count += 1
    await db.flush()

    neg = await _negotiation_for(db, msg)
    if neg is not None:
        neg.status = "counter_offered"
        neg.counter_offer = data.proposed_price_per_unit
        neg.quantity = new_terms["quantity"]
        neg.rounds = (neg.rounds or 1) + 1
        neg.last_offer_by_vendor_id = vendor.id
        neg.message_id = counter.id
        if vendor.id == neg.buyer_vendor_id:
            neg.buyer_notes = data.notes or neg.buyer_notes
        else:
            neg.seller_notes = data.notes or neg.seller_notes

    await notification_service.create_notification(
        db, msg.sender_id, NotificationType.DEAL_COUNTERED,
        f"@{vendor.vendor_handle} countered your deal on {new_deal.get('stock_name') or 'stock'}",
        f"{new_terms['quantity']} at {data.proposed_price_per_unit:g}/unit" + (f" · “{data.notes}”" if data.notes else ""),
        sender_id=vendor.id, data={"room_id": room.id, "message_id": counter.id, "stock_id": deal["stock_item_id"]},
    )
    await db.commit()
    await db.refresh(msg)
    await db.refresh(counter)
    await _broadcast_update(db, room, msg)
    payload = _message_out(counter, vendor, None)
    await manager.broadcast(str(room.id), {"type": "message", "message": payload})
    return {"message": "Counter-offer sent", "message_id": str(counter.id), "sent": payload}


@router.post("/{room_id}/deals/{message_id}/decline")
async def decline_deal(
    room_id: UUID,
    message_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    room, msg = await _load_proposal(db, room_id, message_id, vendor)
    deal = dict(msg.deal_data)
    deal.update({"status": "declined", "declined_by": str(vendor.id), "declined_at": datetime.utcnow().isoformat()})
    msg.deal_data = deal
    flag_modified(msg, "deal_data")
    neg = await _negotiation_for(db, msg)
    if neg is not None:
        neg.status = "rejected"
        neg.resolved_at = datetime.utcnow()
    await _post_system(db, room, vendor, f"✗ @{vendor.vendor_handle} declined the proposal on {deal.get('stock_name') or 'this stock'}.",
                       {"kind": "deal_declined", "message_id": str(msg.id)})
    await notification_service.create_notification(
        db, msg.sender_id, NotificationType.DEAL_DECLINED,
        f"@{vendor.vendor_handle} declined your deal on {deal.get('stock_name') or 'stock'}",
        "You can propose new terms from the room.",
        sender_id=vendor.id, data={"room_id": room.id, "message_id": msg.id},
    )
    await db.commit()
    await db.refresh(msg)
    await _broadcast_update(db, room, msg)
    return {"message": "Proposal declined", "status": "declined"}


async def _broadcast_update(db: AsyncSession, room: ChatRoom, msg: ChatMessage) -> None:
    """Push the edited proposal and any system note that followed it."""
    sender = await db.get(Vendor, msg.sender_id)
    if sender is not None:
        await manager.broadcast(str(room.id), {"type": "message_update", "message": _message_out(msg, sender, None)})
    rows = (await db.execute(
        select(ChatMessage, Vendor).join(Vendor, ChatMessage.sender_id == Vendor.id)
        .where(ChatMessage.room_id == room.id, ChatMessage.message_type == "system")
        .order_by(ChatMessage.sent_at.desc()).limit(1)
    )).all()
    for note, author in rows:
        await manager.broadcast(str(room.id), {"type": "message", "message": _message_out(note, author, None)})


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
    return [_message_out(m, v, await _stock_snippet(db, m.shared_stock_id)) for m, v in reversed(rows)]


@router.get("/{room_id}")
async def get_room(
    room_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    room = await _get_room_for(db, room_id, vendor)
    return _room_out(room, True, await _participants(db, room))


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

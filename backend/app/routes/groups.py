import re
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import ChatRoom, ChatRoomType
from app.models.groups import GroupMembership, GroupType, VendorGroup
from app.models.vendor import Vendor
from app.models.vendor_list import VendorList
from app.routes.auth import get_current_vendor

router = APIRouter()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:180] or "group"


class GroupCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    group_type: GroupType = GroupType.OPEN
    category: Optional[str] = None
    tags: list[str] = []
    region: Optional[str] = None
    is_public: bool = True
    requires_approval: bool = False
    max_members: int = Field(500, ge=2)
    rules: list[str] = []


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    description: Optional[str]
    group_type: str
    category: Optional[str]
    tags: list
    region: Optional[str]
    member_count: int
    max_members: int
    is_public: bool
    requires_approval: bool
    created_by: str
    chat_room_id: Optional[str] = None
    my_role: Optional[str] = None  # admin | moderator | member | pending | None


class GroupVendorListCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    max_vendors: int = Field(100, ge=1)
    requires_approval: bool = True


def _out(g: VendorGroup, creator: Vendor, room_id: Optional[UUID], my_role: Optional[str]) -> GroupOut:
    return GroupOut(
        id=str(g.id), name=g.name, slug=g.slug, description=g.description,
        group_type=g.group_type.value, category=g.category, tags=g.tags or [], region=g.region,
        member_count=g.member_count, max_members=g.max_members, is_public=g.is_public,
        requires_approval=g.requires_approval, created_by=creator.vendor_handle,
        chat_room_id=str(room_id) if room_id else None, my_role=my_role,
    )


async def _my_roles(db: AsyncSession, vendor: Vendor) -> dict[UUID, str]:
    rows = (await db.execute(
        select(GroupMembership.group_id, GroupMembership.role, GroupMembership.is_active)
        .where(GroupMembership.vendor_id == vendor.id)
    )).all()
    return {gid: (role if active else "pending") for gid, role, active in rows}


async def _room_ids(db: AsyncSession, group_ids: list[UUID]) -> dict[UUID, UUID]:
    if not group_ids:
        return {}
    rows = (await db.execute(
        select(ChatRoom.group_id, ChatRoom.id).where(ChatRoom.group_id.in_(group_ids))
    )).all()
    return {gid: rid for gid, rid in rows}


@router.post("/create", status_code=201)
async def create_group(
    data: GroupCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Create a vendor group. Any vendor can create a group."""
    base = slugify(data.name)
    slug, n = base, 2
    while (await db.execute(select(VendorGroup.id).where(VendorGroup.slug == slug))).first():
        slug = f"{base}-{n}"
        n += 1

    group = VendorGroup(
        name=data.name.strip(), slug=slug, description=data.description, group_type=data.group_type,
        category=data.category, tags=data.tags, region=data.region, is_public=data.is_public,
        requires_approval=data.requires_approval, max_members=data.max_members, rules=data.rules,
        created_by_vendor_id=vendor.id, member_count=1,
    )
    db.add(group)
    await db.flush()

    # Auto-join creator as admin
    db.add(GroupMembership(vendor_id=vendor.id, group_id=group.id, role="admin"))

    # Create group chat room
    chat_room = ChatRoom(
        name=f"{group.name} Chat", room_type=ChatRoomType.GROUP, group_id=group.id,
        created_by=vendor.id, participant_count=1,
    )
    db.add(chat_room)
    await db.commit()
    return {"message": f"Group '{group.name}' created", "group_id": str(group.id), "chat_room_id": str(chat_room.id)}


@router.get("/browse", response_model=List[GroupOut])
async def browse_groups(
    group_type: Optional[GroupType] = None,
    category: Optional[str] = None,
    region: Optional[str] = None,
    search: Optional[str] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(VendorGroup, Vendor)
        .join(Vendor, VendorGroup.created_by_vendor_id == Vendor.id)
        .where(VendorGroup.is_public.is_(True))
    )
    if group_type:
        query = query.where(VendorGroup.group_type == group_type)
    if category:
        query = query.where(VendorGroup.category.ilike(category))
    if region:
        query = query.where(VendorGroup.region.ilike(f"%{region}%"))
    if search:
        query = query.where(VendorGroup.name.ilike(f"%{search}%") | VendorGroup.description.ilike(f"%{search}%"))
    query = query.order_by(VendorGroup.member_count.desc(), VendorGroup.created_at.desc())
    rows = (await db.execute(query)).all()

    roles = await _my_roles(db, vendor)
    rooms = await _room_ids(db, [g.id for g, _ in rows])
    return [_out(g, creator, rooms.get(g.id), roles.get(g.id)) for g, creator in rows]


@router.get("/mine", response_model=List[GroupOut])
async def my_groups(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    roles = await _my_roles(db, vendor)
    if not roles:
        return []
    rows = (await db.execute(
        select(VendorGroup, Vendor)
        .join(Vendor, VendorGroup.created_by_vendor_id == Vendor.id)
        .where(VendorGroup.id.in_(list(roles)))
        .order_by(VendorGroup.name)
    )).all()
    rooms = await _room_ids(db, list(roles))
    return [_out(g, creator, rooms.get(g.id), roles.get(g.id)) for g, creator in rows]


@router.get("/{group_id}", response_model=GroupOut)
async def get_group(
    group_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        select(VendorGroup, Vendor).join(Vendor, VendorGroup.created_by_vendor_id == Vendor.id)
        .where(VendorGroup.id == group_id)
    )).first()
    if not row:
        raise HTTPException(404, "Group not found")
    g, creator = row
    roles = await _my_roles(db, vendor)
    if not g.is_public and g.id not in roles:
        raise HTTPException(404, "Group not found")
    rooms = await _room_ids(db, [g.id])
    return _out(g, creator, rooms.get(g.id), roles.get(g.id))


@router.get("/{group_id}/members")
async def group_members(
    group_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    group = await db.get(VendorGroup, group_id)
    if not group:
        raise HTTPException(404, "Group not found")
    rows = (await db.execute(
        select(GroupMembership, Vendor).join(Vendor, Vendor.id == GroupMembership.vendor_id)
        .where(GroupMembership.group_id == group_id).order_by(GroupMembership.joined_at)
    )).all()
    return [{
        "vendor_id": str(v.id), "vendor_handle": v.vendor_handle, "business_name": v.business_name,
        "role": m.role, "is_active": m.is_active, "joined_at": m.joined_at.isoformat(),
        "messages_sent": m.messages_sent, "deals_made_in_group": m.deals_made_in_group,
    } for m, v in rows]


@router.post("/{group_id}/join")
async def join_group(
    group_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    group = await db.get(VendorGroup, group_id, with_for_update=True)
    if not group:
        raise HTTPException(404, "Group not found")
    existing = (await db.execute(select(GroupMembership).where(
        GroupMembership.vendor_id == vendor.id, GroupMembership.group_id == group_id,
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Already a member" if existing.is_active else "Your request is pending approval")
    if group.member_count >= group.max_members:
        raise HTTPException(400, "Group is full")

    active = not group.requires_approval
    db.add(GroupMembership(vendor_id=vendor.id, group_id=group_id, role="member", is_active=active))
    if active:
        group.member_count += 1
        room = (await db.execute(select(ChatRoom).where(ChatRoom.group_id == group_id))).scalars().first()
        if room:
            room.participant_count += 1
    await db.commit()
    return {"message": f"Joined group '{group.name}'" if active else "Request sent to the group admins",
            "status": "member" if active else "pending"}


@router.post("/{group_id}/approve/{vendor_id}")
async def approve_member(
    group_id: UUID,
    vendor_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    group = await db.get(VendorGroup, group_id, with_for_update=True)
    if not group:
        raise HTTPException(404, "Group not found")
    me = (await db.execute(select(GroupMembership).where(
        GroupMembership.vendor_id == vendor.id, GroupMembership.group_id == group_id,
        GroupMembership.role.in_(["admin", "moderator"]), GroupMembership.is_active.is_(True),
    ))).scalar_one_or_none()
    if not me:
        raise HTTPException(403, "Must be a group admin or moderator")
    membership = (await db.execute(select(GroupMembership).where(
        GroupMembership.vendor_id == vendor_id, GroupMembership.group_id == group_id,
    ))).scalar_one_or_none()
    if not membership:
        raise HTTPException(404, "No request from that vendor")
    if membership.is_active:
        return {"message": "Already a member"}
    membership.is_active = True
    group.member_count += 1
    room = (await db.execute(select(ChatRoom).where(ChatRoom.group_id == group_id))).scalars().first()
    if room:
        room.participant_count += 1
    await db.commit()
    return {"message": "Member approved"}


@router.post("/{group_id}/leave")
async def leave_group(
    group_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    group = await db.get(VendorGroup, group_id, with_for_update=True)
    membership = (await db.execute(select(GroupMembership).where(
        GroupMembership.vendor_id == vendor.id, GroupMembership.group_id == group_id,
    ))).scalar_one_or_none()
    if not group or not membership:
        raise HTTPException(404, "Not a member")
    if membership.role == "admin":
        others = (await db.execute(select(GroupMembership.id).where(
            GroupMembership.group_id == group_id, GroupMembership.role == "admin",
            GroupMembership.vendor_id != vendor.id, GroupMembership.is_active.is_(True),
        ))).first()
        if not others:
            raise HTTPException(400, "Promote another admin before leaving")
    was_active = membership.is_active
    await db.delete(membership)
    if was_active:
        group.member_count = max(0, group.member_count - 1)
        room = (await db.execute(select(ChatRoom).where(ChatRoom.group_id == group_id))).scalars().first()
        if room:
            room.participant_count = max(0, room.participant_count - 1)
    await db.commit()
    return {"message": f"Left '{group.name}'"}


@router.post("/{group_id}/create-vendor-list", status_code=201)
async def group_creates_vendor_list(
    group_id: UUID,
    data: GroupVendorListCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Groups of vendors can create their own vendor lists (no patron needed)."""
    group = await db.get(VendorGroup, group_id)
    if not group:
        raise HTTPException(404, "Group not found")

    # Check vendor is admin/moderator of group
    result = await db.execute(select(GroupMembership).where(
        GroupMembership.vendor_id == vendor.id, GroupMembership.group_id == group_id,
        GroupMembership.role.in_(["admin", "moderator"]), GroupMembership.is_active.is_(True),
    ))
    if not result.scalar_one_or_none():
        raise HTTPException(403, "Must be group admin to create vendor lists")

    from app.routes.vendor_lists import slugify as list_slug, unique_slug
    vlist = VendorList(
        name=data.name.strip(),
        slug=await unique_slug(db, list_slug(f"{group.name} {data.name}")),
        description=data.description,
        is_group_created=True,
        creating_group_id=group_id,
        category=group.category,
        region=group.region,
        max_vendors=data.max_vendors,
        requires_approval=data.requires_approval,
    )
    db.add(vlist)
    await db.flush()
    room = ChatRoom(name=f"{vlist.name} — vendors", room_type=ChatRoomType.VENDOR_LIST,
                    vendor_list_id=vlist.id, created_by=vendor.id, participant_count=0)
    db.add(room)
    await db.commit()
    return {"message": f"Vendor list '{vlist.name}' created by group", "list_id": str(vlist.id)}

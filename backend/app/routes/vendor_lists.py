import re
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import ChatRoom, ChatRoomType, chat_room_participants
from app.models.groups import GroupMembership, VendorGroup
from app.models.vendor import Vendor
from app.models.vendor_list import Patron, VendorList, VendorListMembership
from app.models.notification import NotificationType
from app.routes.auth import get_current_vendor
from app.services import patron_service
from app.services.notification_service import create_notification

router = APIRouter()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:180] or "list"


async def unique_slug(db: AsyncSession, base: str) -> str:
    slug, n = base, 2
    while (await db.execute(select(VendorList.id).where(VendorList.slug == slug))).first():
        slug = f"{base}-{n}"
        n += 1
    return slug


class VendorListCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    category: Optional[str] = None
    region: Optional[str] = None
    max_vendors: int = Field(100, ge=1)
    requires_approval: bool = True
    entry_criteria: dict = {}


class VendorListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    description: Optional[str]
    category: Optional[str]
    region: Optional[str]
    patron_business: Optional[str]
    patron_handle: Optional[str]
    member_count: int
    max_vendors: int
    is_open: bool
    requires_approval: bool
    is_group_created: bool
    creating_group_id: Optional[str] = None
    my_status: Optional[str] = None
    i_run_it: bool = False


def _out(vl: VendorList, patron_vendor: Optional[Vendor], my_status: Optional[str], i_run_it: bool) -> VendorListOut:
    return VendorListOut(
        id=str(vl.id), name=vl.name, slug=vl.slug, description=vl.description,
        category=vl.category, region=vl.region,
        patron_business=patron_vendor.business_name if patron_vendor else None,
        patron_handle=patron_vendor.vendor_handle if patron_vendor else None,
        member_count=vl.member_count, max_vendors=vl.max_vendors, is_open=vl.is_open,
        requires_approval=vl.requires_approval, is_group_created=vl.is_group_created,
        creating_group_id=str(vl.creating_group_id) if vl.creating_group_id else None,
        my_status=my_status, i_run_it=i_run_it,
    )


async def _can_manage(db: AsyncSession, vendor: Vendor, vlist: VendorList) -> bool:
    """The patron who owns the list, or an admin/moderator of the creating group."""
    if vlist.patron_id and await patron_service.owns_list(db, vendor, vlist):
        return True
    if vlist.creating_group_id:
        row = (await db.execute(select(GroupMembership.id).where(
            GroupMembership.vendor_id == vendor.id,
            GroupMembership.group_id == vlist.creating_group_id,
            GroupMembership.role.in_(["admin", "moderator"]),
        ))).first()
        return row is not None
    return False


@router.post("/create", status_code=201)
async def create_vendor_list(
    data: VendorListCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Create a vendor list. Must be a patron; tier limits apply."""
    try:
        patron = await patron_service.require_patron(db, vendor)
        await patron_service.assert_can_create_list(db, patron)
    except patron_service.PatronError as exc:
        raise HTTPException(exc.status_code, str(exc))

    vlist = VendorList(
        patron_id=patron.id,
        name=data.name.strip(),
        slug=await unique_slug(db, slugify(data.name)),
        description=data.description,
        category=data.category,
        region=data.region,
        max_vendors=patron_service.effective_max_vendors(patron, data.max_vendors),
        requires_approval=data.requires_approval,
        entry_criteria=data.entry_criteria,
    )
    db.add(vlist)
    await db.flush()
    # Every list has a room where the patron talks to its vendors.
    room = ChatRoom(name=f"{vlist.name} — vendors", room_type=ChatRoomType.VENDOR_LIST,
                    vendor_list_id=vlist.id, created_by=vendor.id, participant_count=1)
    db.add(room)
    await db.flush()
    await db.execute(chat_room_participants.insert().values(room_id=room.id, vendor_id=vendor.id))
    await db.commit()
    return {
        "message": f"Vendor list '{vlist.name}' created",
        "list_id": str(vlist.id),
        "max_vendors": vlist.max_vendors,
        "chat_room_id": str(room.id),
    }


@router.get("/browse", response_model=List[VendorListOut])
async def browse_vendor_lists(
    category: Optional[str] = None,
    region: Optional[str] = None,
    include_closed: bool = False,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(VendorList, Vendor)
        .join(Patron, VendorList.patron_id == Patron.id, isouter=True)
        .join(Vendor, Patron.vendor_id == Vendor.id, isouter=True)
    )
    if not include_closed:
        query = query.where(VendorList.is_open.is_(True))
    if category:
        query = query.where(VendorList.category.ilike(category))
    if region:
        query = query.where(VendorList.region.ilike(f"%{region}%"))
    query = query.order_by(VendorList.member_count.desc(), VendorList.created_at.desc())
    rows = (await db.execute(query)).all()

    mine = dict((await db.execute(
        select(VendorListMembership.vendor_list_id, VendorListMembership.status)
        .where(VendorListMembership.vendor_id == vendor.id)
    )).all())
    my_patron = await patron_service.get_patron(db, vendor)
    return [
        _out(vl, pv, mine.get(vl.id), bool(my_patron and vl.patron_id == my_patron.id))
        for vl, pv in rows
    ]


@router.get("/mine", response_model=List[VendorListOut])
async def my_vendor_lists(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Lists you run and lists you are on."""
    my_patron = await patron_service.get_patron(db, vendor)
    ids = set()
    if my_patron:
        ids |= set((await db.execute(select(VendorList.id).where(VendorList.patron_id == my_patron.id))).scalars())
    mine = dict((await db.execute(
        select(VendorListMembership.vendor_list_id, VendorListMembership.status)
        .where(VendorListMembership.vendor_id == vendor.id)
    )).all())
    ids |= set(mine)
    if not ids:
        return []
    rows = (await db.execute(
        select(VendorList, Vendor)
        .join(Patron, VendorList.patron_id == Patron.id, isouter=True)
        .join(Vendor, Patron.vendor_id == Vendor.id, isouter=True)
        .where(VendorList.id.in_(ids))
    )).all()
    return [_out(vl, pv, mine.get(vl.id), bool(my_patron and vl.patron_id == my_patron.id)) for vl, pv in rows]


@router.get("/{list_id}/members")
async def list_members(
    list_id: UUID,
    status: Optional[str] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Members of a list. Pending registrations are visible only to whoever runs it."""
    vlist = await db.get(VendorList, list_id)
    if not vlist:
        raise HTTPException(404, "Vendor list not found")
    manager = await _can_manage(db, vendor, vlist)
    query = (
        select(VendorListMembership, Vendor)
        .join(Vendor, Vendor.id == VendorListMembership.vendor_id)
        .where(VendorListMembership.vendor_list_id == list_id)
    )
    if status:
        query = query.where(VendorListMembership.status == status)
    if not manager:
        query = query.where(VendorListMembership.status == "approved")
    rows = (await db.execute(query.order_by(VendorListMembership.joined_at.asc()))).all()
    return [{
        "vendor_id": str(v.id), "vendor_handle": v.vendor_handle, "business_name": v.business_name,
        "business_categories": v.business_categories or [], "status": m.status,
        "role_in_list": m.role_in_list, "joined_at": m.joined_at.isoformat(),
        "approved_at": m.approved_at.isoformat() if m.approved_at else None,
    } for m, v in rows]


@router.post("/{list_id}/register")
async def register_for_vendor_list(
    list_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Register to join a vendor list"""
    vlist = await db.get(VendorList, list_id, with_for_update=True)
    if not vlist:
        raise HTTPException(404, "Vendor list not found")
    if not vlist.is_open:
        raise HTTPException(400, "This vendor list is not accepting new vendors")
    if vlist.member_count >= vlist.max_vendors:
        raise HTTPException(400, "Vendor list is full")

    existing = (await db.execute(select(VendorListMembership).where(
        VendorListMembership.vendor_id == vendor.id, VendorListMembership.vendor_list_id == list_id,
    ))).scalar_one_or_none()
    if existing and existing.status in ("pending", "approved"):
        raise HTTPException(400, f"Already registered for this list ({existing.status})")

    # Entry criteria the list wrote down are checked, not decorative.
    criteria = vlist.entry_criteria or {}
    wanted = [c.lower() for c in criteria.get("business_categories", [])]
    if wanted and not ({c.lower() for c in (vendor.business_categories or [])} & set(wanted)):
        raise HTTPException(400, f"This list is for vendors in: {', '.join(criteria['business_categories'])}")

    status = "pending" if vlist.requires_approval else "approved"
    if existing:
        membership = existing
        membership.status = status
        membership.joined_at = datetime.utcnow()
    else:
        membership = VendorListMembership(vendor_id=vendor.id, vendor_list_id=list_id, status=status)
        db.add(membership)

    patron = await patron_service.patron_for_list(db, vlist)
    if status == "approved":
        membership.approved_at = datetime.utcnow()
        vlist.member_count += 1
        await _join_list_room(db, vlist, vendor)
        if patron:
            await patron_service.record_approval(db, patron)
    if patron and patron.vendor_id != vendor.id:
        await create_notification(
            db, patron.vendor_id, NotificationType.LIST_REGISTRATION,
            f"@{vendor.vendor_handle} {'joined' if status == 'approved' else 'wants to join'} {vlist.name}",
            "Auto-approved by the list's settings." if status == "approved" else "Review the registration on the list.",
            sender_id=vendor.id, data={"list_id": vlist.id, "vendor_handle": vendor.vendor_handle, "status": status},
        )

    await db.commit()
    return {"message": f"Registration {status}", "status": status}


async def _join_list_room(db: AsyncSession, vlist: VendorList, vendor: Vendor) -> None:
    room = (await db.execute(select(ChatRoom).where(ChatRoom.vendor_list_id == vlist.id))).scalars().first()
    if not room:
        return
    exists = (await db.execute(select(chat_room_participants.c.vendor_id).where(
        chat_room_participants.c.room_id == room.id, chat_room_participants.c.vendor_id == vendor.id,
    ))).first()
    if not exists:
        await db.execute(chat_room_participants.insert().values(room_id=room.id, vendor_id=vendor.id))
        room.participant_count += 1


@router.post("/{list_id}/approve/{vendor_id}")
async def approve_vendor(
    list_id: UUID,
    vendor_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Patron (or creating-group admin) approves a vendor's registration"""
    vlist = await db.get(VendorList, list_id, with_for_update=True)
    if not vlist:
        raise HTTPException(404, "Vendor list not found")
    if not await _can_manage(db, vendor, vlist):
        raise HTTPException(403, "Only the patron can approve vendors")
    if vlist.member_count >= vlist.max_vendors:
        raise HTTPException(400, "Vendor list is full")

    membership = (await db.execute(select(VendorListMembership).where(
        VendorListMembership.vendor_id == vendor_id, VendorListMembership.vendor_list_id == list_id,
    ))).scalar_one_or_none()
    if not membership:
        raise HTTPException(404, "Registration not found")
    if membership.status == "approved":
        return {"message": "Already approved"}

    membership.status = "approved"
    membership.approved_at = datetime.utcnow()
    vlist.member_count += 1
    joining = await db.get(Vendor, vendor_id)
    if joining:
        await _join_list_room(db, vlist, joining)
    patron = await patron_service.patron_for_list(db, vlist)
    if patron:
        await patron_service.record_approval(db, patron)
    await create_notification(
        db, vendor_id, NotificationType.LIST_APPROVED,
        f"You're on {vlist.name}",
        f"@{vendor.vendor_handle} approved your registration. The list's room is open to you.",
        sender_id=vendor.id, data={"list_id": vlist.id, "room_id": (await db.execute(
            select(ChatRoom.id).where(ChatRoom.vendor_list_id == vlist.id))).scalar()},
    )
    await db.commit()
    return {"message": "Vendor approved"}


@router.post("/{list_id}/reject/{vendor_id}")
async def reject_vendor(
    list_id: UUID,
    vendor_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    vlist = await db.get(VendorList, list_id, with_for_update=True)
    if not vlist:
        raise HTTPException(404, "Vendor list not found")
    if not await _can_manage(db, vendor, vlist):
        raise HTTPException(403, "Only the patron can decide registrations")
    membership = (await db.execute(select(VendorListMembership).where(
        VendorListMembership.vendor_id == vendor_id, VendorListMembership.vendor_list_id == list_id,
    ))).scalar_one_or_none()
    if not membership:
        raise HTTPException(404, "Registration not found")
    was_approved = membership.status == "approved"
    membership.status = "removed" if was_approved else "rejected"
    if was_approved:
        vlist.member_count = max(0, vlist.member_count - 1)
    await create_notification(
        db, vendor_id, NotificationType.LIST_REJECTED,
        f"{'Removed from' if was_approved else 'Not accepted onto'} {vlist.name}",
        f"Decided by @{vendor.vendor_handle}." + ("" if was_approved else " Other lists in your categories are open."),
        sender_id=vendor.id, data={"list_id": vlist.id},
    )
    await db.commit()
    return {"message": f"Registration {membership.status}"}


@router.post("/{list_id}/close")
async def toggle_list_open(
    list_id: UUID,
    is_open: bool = False,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    vlist = await db.get(VendorList, list_id)
    if not vlist:
        raise HTTPException(404, "Vendor list not found")
    if not await _can_manage(db, vendor, vlist):
        raise HTTPException(403, "Only the patron can open or close a list")
    vlist.is_open = is_open
    await db.commit()
    return {"message": f"List is now {'open' if is_open else 'closed'}", "is_open": is_open}


# Referenced by services and other routers; kept here so the group router can
# reuse the same slug helper without a circular import.
__all__ = ["router", "slugify", "unique_slug", "VendorGroup"]

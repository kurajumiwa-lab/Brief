"""
Group collective sourcing (Directive v2.1 §5.3).

    POST /api/collective/create                 organiser (group member) opens a request
    GET  /api/collective?group_id=&status=      requests visible to me (my groups)
    GET  /api/collective/{id}                   detail + pledges
    POST /api/collective/{id}/pledge            {pledged_quantity, max_price_per_unit, notes}
    POST /api/collective/{id}/withdraw
    POST /api/collective/{id}/status?status=    organiser / group admin advances the request

Pledges add up on `current_pledged_quantity`; the request flips to
`quota_met` on its own when the target is reached, and every member of the
group hears about it.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.collective import COLLECTIVE_STATUSES, CollectivePledge, CollectiveSourcingRequest
from app.models.groups import GroupMembership, VendorGroup
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.notification_service import create_notification, notify_many

router = APIRouter()


def _naive_utc(v):
    if isinstance(v, str) and v.strip():
        v = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
    if isinstance(v, datetime) and v.tzinfo is not None:
        v = v.astimezone(timezone.utc).replace(tzinfo=None)
    return v or None


class CollectiveCreate(BaseModel):
    group_id: str
    item_name: str = Field(min_length=2, max_length=300)
    item_category: Optional[str] = Field(None, max_length=100)
    target_quantity: int = Field(gt=0)
    target_price_per_unit: Optional[float] = Field(None, ge=0)
    unit_of_measure: str = Field("units", max_length=50)
    specifications: dict = {}
    description: Optional[str] = Field(None, max_length=2000)
    deadline: Optional[datetime] = None

    _deadline = field_validator("deadline", mode="before")(lambda cls, v: _naive_utc(v))


class PledgeCreate(BaseModel):
    pledged_quantity: int = Field(gt=0)
    max_price_per_unit: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=1000)


async def _membership(db: AsyncSession, group_id: UUID, vendor_id: UUID) -> Optional[GroupMembership]:
    return (await db.execute(select(GroupMembership).where(
        GroupMembership.group_id == group_id, GroupMembership.vendor_id == vendor_id, GroupMembership.is_active.is_(True),
    ))).scalar_one_or_none()


async def _member_ids(db: AsyncSession, group_id: UUID) -> list[UUID]:
    return list((await db.execute(select(GroupMembership.vendor_id).where(
        GroupMembership.group_id == group_id, GroupMembership.is_active.is_(True)))).scalars())


def _request_out(r: CollectiveSourcingRequest, organizer: Vendor, group: VendorGroup, my_pledge: Optional[CollectivePledge], me: Vendor,
                 can_manage: bool) -> dict:
    pct = round(100.0 * (r.current_pledged_quantity or 0) / r.target_quantity, 1) if r.target_quantity else 0
    return {
        "id": str(r.id), "group_id": str(r.group_id), "group_name": group.name,
        "organizer_vendor_id": str(organizer.id), "organizer_handle": organizer.vendor_handle,
        "item_name": r.item_name, "item_category": r.item_category, "unit_of_measure": r.unit_of_measure,
        "target_quantity": r.target_quantity, "target_price_per_unit": r.target_price_per_unit,
        "specifications": r.specifications or {}, "description": r.description,
        "status": r.status, "current_pledged_quantity": r.current_pledged_quantity, "pledge_count": r.pledge_count,
        "progress_pct": min(pct, 100.0),
        "deadline": r.deadline.isoformat() if r.deadline else None,
        "created_at": r.created_at.isoformat(), "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "my_pledge": {
            "id": str(my_pledge.id), "pledged_quantity": my_pledge.pledged_quantity,
            "max_price_per_unit": my_pledge.max_price_per_unit, "status": my_pledge.status, "notes": my_pledge.notes,
        } if my_pledge and my_pledge.status != "withdrawn" else None,
        "i_organise": r.organizer_vendor_id == me.id,
        "can_manage": can_manage,
    }


async def _out(db: AsyncSession, r: CollectiveSourcingRequest, me: Vendor) -> dict:
    organizer = await db.get(Vendor, r.organizer_vendor_id)
    group = await db.get(VendorGroup, r.group_id)
    mine = (await db.execute(select(CollectivePledge).where(
        CollectivePledge.request_id == r.id, CollectivePledge.vendor_id == me.id))).scalar_one_or_none()
    membership = await _membership(db, r.group_id, me.id)
    can_manage = r.organizer_vendor_id == me.id or bool(membership and membership.role in ("admin", "moderator"))
    return _request_out(r, organizer, group, mine, me, can_manage)


async def _refresh_totals(db: AsyncSession, r: CollectiveSourcingRequest) -> None:
    total, count = (await db.execute(
        select(func.coalesce(func.sum(CollectivePledge.pledged_quantity), 0), func.count(CollectivePledge.id))
        .where(CollectivePledge.request_id == r.id, CollectivePledge.status != "withdrawn")
    )).one()
    r.current_pledged_quantity = int(total or 0)
    r.pledge_count = int(count or 0)


@router.post("/create", status_code=201)
async def create_request(
    data: CollectiveCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        group_id = UUID(data.group_id)
    except ValueError:
        raise HTTPException(400, "group_id is not a UUID")
    group = await db.get(VendorGroup, group_id)
    if not group:
        raise HTTPException(404, "Group not found")
    if not await _membership(db, group_id, vendor.id):
        raise HTTPException(403, "Join the group before organising a collective buy")

    req = CollectiveSourcingRequest(
        group_id=group_id, organizer_vendor_id=vendor.id, item_name=data.item_name.strip(),
        item_category=(data.item_category or "").strip() or None, target_quantity=data.target_quantity,
        target_price_per_unit=data.target_price_per_unit, unit_of_measure=data.unit_of_measure or "units",
        specifications=data.specifications or {}, description=data.description, deadline=data.deadline,
    )
    db.add(req)
    await db.flush()
    members = [m for m in await _member_ids(db, group_id) if m != vendor.id]
    await notify_many(
        db, members, NotificationType.COLLECTIVE_UPDATE,
        f"Collective buy in {group.name}: {req.item_name}",
        f"@{vendor.vendor_handle} is gathering {req.target_quantity} {req.unit_of_measure}"
        + (f" at ≤ {req.target_price_per_unit:g}/unit" if req.target_price_per_unit else "") + ". Pledge your share.",
        sender_id=vendor.id, data={"collective_id": req.id, "group_id": group_id},
    )
    await db.commit()
    return {"message": "Collective sourcing request opened", "collective_id": str(req.id)}


@router.get("")
@router.get("/")
async def list_requests(
    group_id: Optional[UUID] = None,
    status: Optional[str] = Query(None),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    my_groups = select(GroupMembership.group_id).where(
        GroupMembership.vendor_id == vendor.id, GroupMembership.is_active.is_(True))
    query = select(CollectiveSourcingRequest).where(CollectiveSourcingRequest.group_id.in_(my_groups))
    if group_id:
        query = query.where(CollectiveSourcingRequest.group_id == group_id)
    if status:
        query = query.where(CollectiveSourcingRequest.status == status)
    rows = (await db.execute(query.order_by(CollectiveSourcingRequest.created_at.desc()).limit(100))).scalars().all()
    return [await _out(db, r, vendor) for r in rows]


@router.get("/{collective_id}")
async def get_request(
    collective_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(CollectiveSourcingRequest, collective_id)
    if not req or not await _membership(db, req.group_id, vendor.id):
        raise HTTPException(404, "Collective request not found")
    out = await _out(db, req, vendor)
    rows = (await db.execute(
        select(CollectivePledge, Vendor).join(Vendor, Vendor.id == CollectivePledge.vendor_id)
        .where(CollectivePledge.request_id == req.id).order_by(CollectivePledge.created_at)
    )).all()
    out["pledges"] = [{
        "vendor_id": str(v.id), "vendor_handle": v.vendor_handle, "business_name": v.business_name,
        "pledged_quantity": p.pledged_quantity, "max_price_per_unit": p.max_price_per_unit, "status": p.status,
        "notes": p.notes, "created_at": p.created_at.isoformat(),
    } for p, v in rows]
    return out


@router.post("/{collective_id}/pledge")
async def pledge(
    collective_id: UUID,
    data: PledgeCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(CollectiveSourcingRequest, collective_id, with_for_update=True)
    if not req or not await _membership(db, req.group_id, vendor.id):
        raise HTTPException(404, "Collective request not found")
    if req.status not in ("gathering", "quota_met"):
        raise HTTPException(400, f"This request is {req.status}; pledges are closed")
    if req.deadline and req.deadline < datetime.utcnow():
        raise HTTPException(400, "The pledge deadline has passed")

    existing = (await db.execute(select(CollectivePledge).where(
        CollectivePledge.request_id == req.id, CollectivePledge.vendor_id == vendor.id))).scalar_one_or_none()
    if existing:
        existing.pledged_quantity = data.pledged_quantity
        existing.max_price_per_unit = data.max_price_per_unit
        existing.notes = data.notes
        existing.status = "pledged"
    else:
        db.add(CollectivePledge(request_id=req.id, vendor_id=vendor.id, pledged_quantity=data.pledged_quantity,
                                max_price_per_unit=data.max_price_per_unit, notes=data.notes))
    await db.flush()
    await _refresh_totals(db, req)

    quota_hit = req.status == "gathering" and req.current_pledged_quantity >= req.target_quantity
    if quota_hit:
        req.status = "quota_met"
        await notify_many(
            db, await _member_ids(db, req.group_id), NotificationType.COLLECTIVE_UPDATE,
            f"Quota met: {req.item_name}",
            f"{req.current_pledged_quantity}/{req.target_quantity} {req.unit_of_measure} pledged by {req.pledge_count} vendors. "
            f"@{(await db.get(Vendor, req.organizer_vendor_id)).vendor_handle} can now negotiate the order.",
            data={"collective_id": req.id, "group_id": req.group_id},
        )
    elif req.organizer_vendor_id != vendor.id:
        await create_notification(
            db, req.organizer_vendor_id, NotificationType.COLLECTIVE_UPDATE,
            f"@{vendor.vendor_handle} pledged {data.pledged_quantity} {req.unit_of_measure} of {req.item_name}",
            f"{req.current_pledged_quantity}/{req.target_quantity} gathered",
            sender_id=vendor.id, data={"collective_id": req.id, "group_id": req.group_id},
        )
    await db.commit()
    return {"message": "Pledge recorded", "status": req.status,
            "current_pledged_quantity": req.current_pledged_quantity, "target_quantity": req.target_quantity}


@router.post("/{collective_id}/withdraw")
async def withdraw(
    collective_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(CollectiveSourcingRequest, collective_id, with_for_update=True)
    if not req:
        raise HTTPException(404, "Collective request not found")
    if req.status not in ("gathering", "quota_met"):
        raise HTTPException(400, f"The order is already {req.status}; talk to the organiser")
    mine = (await db.execute(select(CollectivePledge).where(
        CollectivePledge.request_id == req.id, CollectivePledge.vendor_id == vendor.id))).scalar_one_or_none()
    if not mine or mine.status == "withdrawn":
        raise HTTPException(404, "You have no pledge on this request")
    mine.status = "withdrawn"
    await _refresh_totals(db, req)
    if req.status == "quota_met" and req.current_pledged_quantity < req.target_quantity:
        req.status = "gathering"
    await db.commit()
    return {"message": "Pledge withdrawn", "status": req.status, "current_pledged_quantity": req.current_pledged_quantity}


@router.post("/{collective_id}/status")
async def set_status(
    collective_id: UUID,
    status: str = Query(..., pattern="^(gathering|quota_met|negotiating|ordered|fulfilled|cancelled)$"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(CollectiveSourcingRequest, collective_id, with_for_update=True)
    if not req:
        raise HTTPException(404, "Collective request not found")
    membership = await _membership(db, req.group_id, vendor.id)
    if req.organizer_vendor_id != vendor.id and not (membership and membership.role in ("admin", "moderator")):
        raise HTTPException(403, "Only the organiser or a group admin moves the request along")
    if req.status in ("fulfilled", "cancelled"):
        raise HTTPException(400, f"Request is already {req.status}")
    if COLLECTIVE_STATUSES.index(status) < COLLECTIVE_STATUSES.index(req.status) and status not in ("gathering", "cancelled"):
        raise HTTPException(400, f"Can't move from {req.status} back to {status}")
    req.status = status
    if status in ("ordered", "fulfilled", "cancelled", "negotiating"):
        pledgers = list((await db.execute(select(CollectivePledge.vendor_id).where(
            CollectivePledge.request_id == req.id, CollectivePledge.status != "withdrawn"))).scalars())
        if status == "fulfilled":
            for p in (await db.execute(select(CollectivePledge).where(
                    CollectivePledge.request_id == req.id, CollectivePledge.status != "withdrawn"))).scalars():
                p.status = "confirmed"
        await notify_many(
            db, [p for p in pledgers if p != vendor.id], NotificationType.COLLECTIVE_UPDATE,
            f"{req.item_name}: {status.replace('_', ' ')}",
            f"@{vendor.vendor_handle} updated the collective buy ({req.current_pledged_quantity} {req.unit_of_measure} pledged).",
            sender_id=vendor.id, data={"collective_id": req.id, "group_id": req.group_id, "status": status},
        )
    await db.commit()
    return {"message": f"Request is now {status}", "status": status}

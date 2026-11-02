"""Group logistics coordination: group orders, participants, delivery status and routes.

Free for now. Fees are calculated through the fee module, which returns zero
while fees are off. Product sales and payments are not touched here.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.fees import service as fees
from app.modules.logistics.models import ORDER_STATUSES, GroupOrder, GroupOrderParticipant, LogisticsEvent, LogisticsProvider
from app.services import routing


class LogisticsError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


#: Allowed moves. Anything else is refused, so the record always tells a true story.
TRANSITIONS = {
    "open": {"locked", "cancelled"},
    "locked": {"open", "scheduled", "cancelled"},
    "scheduled": {"in_transit", "cancelled"},
    "in_transit": {"delivered", "cancelled"},
    "delivered": set(),
    "cancelled": set(),
}


def _event(db: AsyncSession, order_id, actor: str, action: str, detail: Optional[str] = None) -> None:
    db.add(LogisticsEvent(order_id=order_id, actor=actor, action=action, detail=detail))


async def _order(db: AsyncSession, order_id: uuid.UUID) -> GroupOrder:
    order = await db.get(GroupOrder, order_id)
    if order is None:
        raise LogisticsError("Group order not found.", 404)
    return order


async def _participant(db: AsyncSession, order_id, vendor_id) -> Optional[GroupOrderParticipant]:
    return (await db.execute(select(GroupOrderParticipant).where(
        GroupOrderParticipant.order_id == order_id, GroupOrderParticipant.vendor_id == vendor_id,
    ))).scalar_one_or_none()


def _order_out(o: GroupOrder, *, joined_count: int, my_role: str) -> dict:
    return {
        "id": str(o.id),
        "title": o.title,
        "description": o.description,
        "item_summary": o.item_summary,
        "status": o.status,
        "closes_at": o.closes_at.isoformat() if o.closes_at else None,
        "delivery_point": o.delivery_point,
        "window_start": o.window_start.isoformat() if o.window_start else None,
        "window_end": o.window_end.isoformat() if o.window_end else None,
        "provider_id": str(o.provider_id) if o.provider_id else None,
        "route": o.route or {},
        "participant_count": joined_count,
        "my_role": my_role,
        "fees": "none",  # free for now
    }


async def create_order(db: AsyncSession, vendor: Vendor, *, title: str, description: Optional[str],
                       item_summary: Optional[str], closes_at: Optional[datetime],
                       delivery_point: Optional[str]) -> dict:
    order = GroupOrder(organiser_id=vendor.id, title=title.strip(), description=description,
                       item_summary=item_summary, closes_at=closes_at, delivery_point=delivery_point,
                       status="open")
    db.add(order)
    await db.flush()
    db.add(GroupOrderParticipant(order_id=order.id, vendor_id=vendor.id, status="joined"))
    _event(db, order.id, vendor.vendor_handle, "created")
    await db.flush()
    return _order_out(order, joined_count=1, my_role="organiser")


async def _count(db: AsyncSession, order_id) -> int:
    rows = (await db.execute(select(GroupOrderParticipant.id).where(
        GroupOrderParticipant.order_id == order_id, GroupOrderParticipant.status == "joined",
    ))).all()
    return len(rows)


async def list_open(db: AsyncSession) -> list[dict]:
    """Open group orders anyone can see and join."""
    rows = (await db.execute(select(GroupOrder).where(GroupOrder.status == "open")
                             .order_by(GroupOrder.created_at.desc()).limit(100))).scalars().all()
    return [_order_out(o, joined_count=await _count(db, o.id), my_role="none") for o in rows]


async def list_mine(db: AsyncSession, vendor: Vendor) -> list[dict]:
    """Orders I organise or have joined."""
    rows = (await db.execute(
        select(GroupOrder, GroupOrderParticipant.status)
        .join(GroupOrderParticipant, GroupOrderParticipant.order_id == GroupOrder.id)
        .where(GroupOrderParticipant.vendor_id == vendor.id)
        .where(GroupOrderParticipant.status == "joined")
        .order_by(GroupOrder.created_at.desc()).limit(100)
    )).all()
    out = []
    for o, _ in rows:
        role = "organiser" if o.organiser_id == vendor.id else "participant"
        out.append(_order_out(o, joined_count=await _count(db, o.id), my_role=role))
    return out


async def get_order(db: AsyncSession, vendor: Vendor, order_id: uuid.UUID) -> dict:
    order = await _order(db, order_id)
    me = await _participant(db, order.id, vendor.id)
    is_organiser = order.organiser_id == vendor.id
    if not is_organiser and not (me and me.status == "joined") and order.status != "open":
        raise LogisticsError("Group order not found.", 404)
    role = "organiser" if is_organiser else ("participant" if me and me.status == "joined" else "none")
    out = _order_out(order, joined_count=await _count(db, order.id), my_role=role)
    if role != "none":
        parts = (await db.execute(select(GroupOrderParticipant, Vendor)
                                  .join(Vendor, Vendor.id == GroupOrderParticipant.vendor_id)
                                  .where(GroupOrderParticipant.order_id == order.id)
                                  .where(GroupOrderParticipant.status == "joined"))).all()
        out["participants"] = [{"handle": v.vendor_handle, "business_name": v.business_name,
                                "quantity_note": p.quantity_note} for p, v in parts]
        out["events"] = [{"action": e.action, "actor": e.actor, "detail": e.detail,
                          "at": e.created_at.isoformat()} for e in (await db.execute(
                              select(LogisticsEvent).where(LogisticsEvent.order_id == order.id)
                              .order_by(LogisticsEvent.created_at.desc()).limit(100))).scalars().all()]
    return out


async def join(db: AsyncSession, vendor: Vendor, order_id: uuid.UUID, quantity_note: Optional[str]) -> dict:
    order = await _order(db, order_id)
    if order.status != "open":
        raise LogisticsError("This group order is no longer taking members.", 409)
    if order.closes_at and order.closes_at < datetime.utcnow():
        raise LogisticsError("The deadline for this group order has passed.", 409)
    me = await _participant(db, order.id, vendor.id)
    if me and me.status == "joined":
        raise LogisticsError("You have already joined this group order.", 409)
    if me:
        me.status = "joined"
        me.quantity_note = quantity_note
        me.updated_at = datetime.utcnow()
    else:
        db.add(GroupOrderParticipant(order_id=order.id, vendor_id=vendor.id, quantity_note=quantity_note))
    _event(db, order.id, vendor.vendor_handle, "joined")
    await db.flush()
    return _order_out(order, joined_count=await _count(db, order.id), my_role="participant")


async def leave(db: AsyncSession, vendor: Vendor, order_id: uuid.UUID) -> dict:
    order = await _order(db, order_id)
    if order.organiser_id == vendor.id:
        raise LogisticsError("The organiser cannot leave. Cancel the group order instead.", 409)
    if order.status != "open":
        raise LogisticsError("You can only leave while the group order is open.", 409)
    me = await _participant(db, order.id, vendor.id)
    if not me or me.status != "joined":
        raise LogisticsError("You are not part of this group order.", 404)
    me.status = "left"
    me.updated_at = datetime.utcnow()
    _event(db, order.id, vendor.vendor_handle, "left")
    await db.flush()
    return _order_out(order, joined_count=await _count(db, order.id), my_role="none")


async def plan_route(db: AsyncSession, vendor: Vendor, order_id: uuid.UUID, stops: list[dict],
                     start: Optional[dict]) -> dict:
    """Optimise the drop-off order with the shared routing service and save it on the order."""
    order = await _order(db, order_id)
    if order.organiser_id != vendor.id:
        raise LogisticsError("Only the organiser can plan the route.", 403)
    if order.status in ("delivered", "cancelled"):
        raise LogisticsError("This group order is closed.", 409)
    if not stops:
        raise LogisticsError("Add at least one stop.", 400)
    result = routing.optimise(stops, start=start)
    order.route = {"stops": result["stops"], "total_distance_km": result["total_distance_km"],
                   "saved_km": result["saved_km"], "estimated_minutes": result["estimated_minutes"],
                   "algorithm": result["algorithm"]}
    order.updated_at = datetime.utcnow()
    _event(db, order.id, vendor.vendor_handle, "route_planned",
           f"{len(stops)} stops, {result['total_distance_km']} km")
    await db.flush()
    return order.route


async def set_status(db: AsyncSession, actor: str, order_id: uuid.UUID, new_status: str,
                     note: Optional[str] = None) -> dict:
    if new_status not in ORDER_STATUSES:
        raise LogisticsError("Unknown status.", 400)
    order = await _order(db, order_id)
    if new_status not in TRANSITIONS[order.status]:
        raise LogisticsError(f"A {order.status} group order cannot become {new_status}.", 409)
    if new_status == "scheduled" and not (order.provider_id and order.window_start and order.window_end):
        raise LogisticsError("Choose a provider and a delivery window before scheduling.", 409)
    order.status = new_status
    order.updated_at = datetime.utcnow()
    _event(db, order.id, actor, f"status_{new_status}", note)
    if new_status == "delivered":
        # Zero while fees are off. The base amount is the sale, which this module never sees.
        await fees.fee_for(db, "logistics_coordination", base_amount_kes=0,
                           subject_type="group_order", subject_id=str(order.id))
    await db.flush()
    return {"id": str(order.id), "status": order.status}


async def schedule(db: AsyncSession, actor: str, order_id: uuid.UUID, *, provider_id: Optional[uuid.UUID],
                   window_start: datetime, window_end: datetime) -> dict:
    order = await _order(db, order_id)
    if window_end <= window_start:
        raise LogisticsError("The delivery window must end after it starts.", 400)
    if provider_id is not None:
        provider = await db.get(LogisticsProvider, provider_id)
        if provider is None or not provider.active:
            raise LogisticsError("That provider is not available.", 400)
        order.provider_id = provider_id
    order.window_start = window_start
    order.window_end = window_end
    order.updated_at = datetime.utcnow()
    _event(db, order.id, actor, "scheduled", f"{window_start.isoformat()} to {window_end.isoformat()}")
    await db.flush()
    return {"id": str(order.id), "provider_id": str(order.provider_id) if order.provider_id else None,
            "window_start": window_start.isoformat(), "window_end": window_end.isoformat()}


async def list_providers(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(select(LogisticsProvider).where(LogisticsProvider.active.is_(True))
                             .order_by(LogisticsProvider.name))).scalars().all()
    return [{"id": str(p.id), "name": p.name, "contact": p.contact, "service_area": p.service_area} for p in rows]


async def add_provider(db: AsyncSession, *, name: str, contact: Optional[str],
                       service_area: Optional[str]) -> dict:
    p = LogisticsProvider(name=name.strip(), contact=contact, service_area=service_area, active=True)
    db.add(p)
    await db.flush()
    return {"id": str(p.id), "name": p.name}


async def admin_list(db: AsyncSession, status: Optional[str] = None) -> list[dict]:
    stmt = select(GroupOrder)
    if status:
        stmt = stmt.where(GroupOrder.status == status)
    rows = (await db.execute(stmt.order_by(GroupOrder.created_at.desc()).limit(200))).scalars().all()
    return [_order_out(o, joined_count=await _count(db, o.id), my_role="operator") for o in rows]

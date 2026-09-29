"""
Courier route optimisation — Directive v2.1 §5.5.

A courier builds a run from their undelivered shipments (or from arbitrary
stops with coordinates), the optimiser orders it, and the plan is stored so
senders can see their parcel is on a scheduled run.

    POST /api/tools/couriers/{courier_id}/routes                 plan a run from stops
    POST /api/tools/couriers/{courier_id}/routes/from-shipments   plan from live shipments
    GET  /api/tools/routes?role=courier|booker&status=            your plans
    GET  /api/tools/routes/{route_id}                             one plan with legs
    POST /api/tools/routes/{route_id}/status?status=dispatched    dispatch / complete / cancel
    POST /api/tools/routes/{route_id}/stops/{stop_id}/solve       tick a stop off
"""

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.notification import NotificationType
from app.models.routing import ROUTE_STATUSES, RoutePlan, RouteStop
from app.models.tools import CourierRegistration, CourierShipment
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import routing
from app.services.notification_service import create_notification

router = APIRouter()

LIVE_SHIPMENT_STATUSES = ("picked_up", "in_transit", "out_for_delivery")


class StopIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: Optional[str] = Field(None, max_length=300)
    address: Optional[str] = Field(None, max_length=500)
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    weight_kg: Optional[float] = Field(None, ge=0)
    priority: int = Field(0, ge=0, le=10)
    shipment_id: Optional[UUID] = None
    contact_phone: Optional[str] = Field(None, max_length=40)


class RouteCreate(BaseModel):
    stops: List[StopIn] = Field(..., min_length=1, max_length=100)
    name: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)
    planned_for: Optional[datetime] = None
    average_speed_kmh: float = Field(25, gt=1, le=120)
    service_minutes: int = Field(0, ge=0, le=240)
    return_to_start: bool = False
    start_label: Optional[str] = Field(None, max_length=300)
    start_lat: Optional[float] = Field(None, ge=-90, le=90)
    start_lng: Optional[float] = Field(None, ge=-180, le=180)

    @field_validator("planned_for")
    @classmethod
    def _naive_utc(cls, dt: Optional[datetime]) -> Optional[datetime]:
        if dt is None:
            return None
        return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


async def _courier_or_404(db: AsyncSession, courier_id: UUID) -> CourierRegistration:
    courier = await db.get(CourierRegistration, courier_id)
    if not courier:
        raise HTTPException(404, "Courier not found")
    return courier


def _stop_dict(stop: StopIn, receiver: Optional[Vendor] = None, shipment: Optional[CourierShipment] = None) -> dict:
    lat, lng = stop.lat, stop.lng
    if lat is None and receiver is not None:
        lat, lng = receiver.geo_lat, receiver.geo_lng
    label = stop.label or (f"@{receiver.vendor_handle}" if receiver else None) or "Stop"
    return {
        "label": label[:300],
        "address": stop.address or (shipment.destination if shipment else None) or (receiver.physical_location if receiver else None),
        "lat": lat, "lng": lng,
        "weight_kg": stop.weight_kg if stop.weight_kg is not None else (shipment.weight_kg if shipment else None),
        "priority": stop.priority,
        "shipment_id": shipment.id if shipment else stop.shipment_id,
        "contact_phone": stop.contact_phone,
    }


async def _persist(db: AsyncSession, courier: CourierRegistration, vendor: Vendor, planned: dict,
                   request: RouteCreate) -> RoutePlan:
    plan = RoutePlan(
        courier_id=courier.id,
        vendor_id=vendor.id,
        name=request.name or f"{courier.courier_name} run · {len(planned['stops'])} stops",
        planned_for=request.planned_for,
        status="planned",
        total_stops=len(planned["stops"]),
        total_distance_km=planned["total_distance_km"],
        baseline_distance_km=planned["baseline_distance_km"],
        saved_km=planned["saved_km"],
        estimated_minutes=planned["estimated_minutes"],
        average_speed_kmh=planned["average_speed_kmh"],
        return_to_start=request.return_to_start,
        algorithm=planned["algorithm"],
        start_label=request.start_label,
        start_lat=request.start_lat,
        start_lng=request.start_lng,
        notes=request.notes,
        stops_meta=[{"label": s["label"], "lat": s.get("lat"), "lng": s.get("lng"),
                     "priority": s.get("priority", 0), "weight_kg": s.get("weight_kg"),
                     "shipment_id": str(s["shipment_id"]) if s.get("shipment_id") else None}
                    for s in planned["stops"]],
    )
    db.add(plan)
    await db.flush()
    for stop in planned["stops"]:
        db.add(RouteStop(
            route_plan_id=plan.id,
            shipment_id=stop.get("shipment_id"),
            sequence=stop["sequence"],
            label=stop["label"],
            address=stop.get("address"),
            contact_phone=stop.get("contact_phone"),
            geo_lat=stop.get("lat"),
            geo_lng=stop.get("lng"),
            weight_kg=stop.get("weight_kg"),
            priority=stop.get("priority") or 0,
            distance_from_prev_km=stop["distance_from_prev_km"],
            cumulative_km=stop["cumulative_km"],
            eta_minutes=stop["eta_minutes"],
        ))
    return plan


async def _plan_out(db: AsyncSession, plan: RoutePlan, me: Vendor) -> dict:
    courier = await db.get(CourierRegistration, plan.courier_id)
    owner = await db.get(Vendor, plan.vendor_id)
    stops = (await db.execute(
        select(RouteStop).where(RouteStop.route_plan_id == plan.id).order_by(RouteStop.sequence)
    )).scalars().all()
    return {
        "id": str(plan.id),
        "name": plan.name,
        "status": plan.status,
        "planned_for": plan.planned_for.isoformat() if plan.planned_for else None,
        "courier": {"id": str(courier.id), "courier_name": courier.courier_name,
                    "vendor_handle": owner.vendor_handle} if courier and owner else None,
        "total_stops": plan.total_stops,
        "total_distance_km": plan.total_distance_km,
        "baseline_distance_km": plan.baseline_distance_km,
        "saved_km": plan.saved_km,
        "saved_pct": round(100.0 * plan.saved_km / plan.baseline_distance_km, 1) if plan.baseline_distance_km else 0.0,
        "estimated_minutes": plan.estimated_minutes,
        "average_speed_kmh": plan.average_speed_kmh,
        "return_to_start": plan.return_to_start,
        "algorithm": plan.algorithm,
        "start_label": plan.start_label,
        "start": {"lat": plan.start_lat, "lng": plan.start_lng},
        "notes": plan.notes,
        "created_at": plan.created_at.isoformat(),
        "mine": plan.vendor_id == me.id,
        "stops": [{
            "id": str(s.id), "sequence": s.sequence, "label": s.label, "address": s.address,
            "contact_phone": s.contact_phone, "lat": s.geo_lat, "lng": s.geo_lng,
            "weight_kg": s.weight_kg, "priority": s.priority,
            "distance_from_prev_km": s.distance_from_prev_km, "cumulative_km": s.cumulative_km,
            "eta_minutes": s.eta_minutes, "solved": s.solved,
            "shipment_id": str(s.shipment_id) if s.shipment_id else None,
        } for s in stops],
    }


@router.post("/couriers/{courier_id}/routes", status_code=201)
async def plan_route(
    courier_id: UUID,
    data: RouteCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Optimise a run from explicit stops. Only the courier may plan their own day."""
    courier = await _courier_or_404(db, courier_id)
    if courier.vendor_id != vendor.id:
        raise HTTPException(403, "Only this courier can plan its routes")

    stops = []
    for stop in data.stops:
        shipment = None
        if stop.shipment_id:
            shipment = await db.get(CourierShipment, stop.shipment_id)
            if not shipment or shipment.courier_id != courier.id:
                raise HTTPException(404, "Shipment not found on this courier")
        receiver = await db.get(Vendor, shipment.receiver_vendor_id) if shipment else None
        stops.append(_stop_dict(stop, receiver, shipment))

    start = {"label": data.start_label or "Depot", "lat": data.start_lat, "lng": data.start_lng} \
        if (data.start_lat is not None and data.start_lng is not None) else None
    planned = routing.optimise(stops, start=start, average_speed_kmh=data.average_speed_kmh,
                               return_to_start=data.return_to_start, service_minutes=data.service_minutes)
    plan = await _persist(db, courier, vendor, planned, data)
    await db.commit()
    await db.refresh(plan)
    return await _plan_out(db, plan, vendor)


@router.post("/couriers/{courier_id}/routes/from-shipments", status_code=201)
async def plan_from_shipments(
    courier_id: UUID,
    name: Optional[str] = Query(None, max_length=200),
    average_speed_kmh: float = Query(25, gt=1, le=120),
    return_to_start: bool = False,
    max_stops: int = Query(40, ge=1, le=100),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Build today's run out of the parcels this courier is still carrying."""
    courier = await _courier_or_404(db, courier_id)
    if courier.vendor_id != vendor.id:
        raise HTTPException(403, "Only this courier can plan its routes")

    shipments = (await db.execute(
        select(CourierShipment).where(
            CourierShipment.courier_id == courier.id,
            CourierShipment.status.in_(LIVE_SHIPMENT_STATUSES),
        ).order_by(CourierShipment.created_at.asc()).limit(max_stops)
    )).scalars().all()
    if not shipments:
        raise HTTPException(400, "No undelivered shipments — nothing to plan")

    stops = []
    for shipment in shipments:
        receiver = await db.get(Vendor, shipment.receiver_vendor_id)
        stops.append(_stop_dict(
            StopIn(label=shipment.tracking_number, address=shipment.destination,
                   weight_kg=shipment.weight_kg, shipment_id=shipment.id),
            receiver, shipment,
        ))

    start = {"label": "Depot", "lat": vendor.geo_lat, "lng": vendor.geo_lng}
    planned = routing.optimise(stops, start=start, average_speed_kmh=average_speed_kmh,
                               return_to_start=return_to_start)
    request = RouteCreate(
        stops=[StopIn(**{k: v for k, v in s.items() if k in StopIn.model_fields}) for s in stops],
        name=name, average_speed_kmh=average_speed_kmh, return_to_start=return_to_start,
        start_lat=vendor.geo_lat, start_lng=vendor.geo_lng, start_label="Depot",
    )
    plan = await _persist(db, courier, vendor, planned, request)
    await db.commit()
    await db.refresh(plan)
    return await _plan_out(db, plan, vendor)


@router.get("/routes")
async def list_routes(
    role: str = Query("courier", pattern="^(courier|booker|all)$"),
    status: Optional[str] = Query(None),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Plans you run, and plans that carry your parcels."""
    my_couriers = select(CourierRegistration.id).where(CourierRegistration.vendor_id == vendor.id)
    in_my_plans = RoutePlan.courier_id.in_(my_couriers)
    carries_my_parcel = RoutePlan.id.in_(
        select(RouteStop.route_plan_id)
        .join(CourierShipment, CourierShipment.id == RouteStop.shipment_id)
        .where(or_(CourierShipment.sender_vendor_id == vendor.id, CourierShipment.receiver_vendor_id == vendor.id))
    )
    if role == "courier":
        where = in_my_plans
    elif role == "booker":
        where = carries_my_parcel
    else:
        where = or_(in_my_plans, carries_my_parcel)

    query = select(RoutePlan).where(where)
    if status:
        if status not in ROUTE_STATUSES:
            raise HTTPException(400, f"status must be one of {ROUTE_STATUSES}")
        query = query.where(RoutePlan.status == status)
    plans = (await db.execute(query.order_by(RoutePlan.created_at.desc()).limit(50))).scalars().all()
    return [await _plan_out(db, plan, vendor) for plan in plans]


@router.get("/routes/{route_id}")
async def get_route(
    route_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(RoutePlan, route_id)
    if not plan:
        raise HTTPException(404, "Route plan not found")
    out = await _plan_out(db, plan, vendor)
    if not out["mine"]:
        # The plan stays private between couriers; the only other vendors who may
        # read it are the senders/receivers of a parcel it carries.
        shipment_ids = [UUID(s["shipment_id"]) for s in out["stops"] if s["shipment_id"]]
        carries_my_parcel = bool(shipment_ids) and (await db.execute(
            select(CourierShipment.id).where(
                CourierShipment.id.in_(shipment_ids),
                or_(CourierShipment.sender_vendor_id == vendor.id,
                    CourierShipment.receiver_vendor_id == vendor.id),
            )
        )).first() is not None
        if not carries_my_parcel:
            raise HTTPException(403, "This plan is not yours")
    return out


@router.post("/routes/{route_id}/status")
async def set_route_status(
    route_id: UUID,
    status: str = Query(..., pattern="^(planned|dispatched|completed|cancelled)$"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Dispatch or close the run. Dispatching tells the senders whose parcels
    are on it (that is the point of planning in public)."""
    plan = await db.get(RoutePlan, route_id, with_for_update=True)
    if not plan:
        raise HTTPException(404, "Route plan not found")
    if plan.vendor_id != vendor.id:
        raise HTTPException(403, "Only the courier updates a route plan")

    if status == "dispatched" and plan.status != "planned":
        raise HTTPException(400, f"A {plan.status} plan cannot be dispatched")
    if status == "completed" and plan.status not in ("planned", "dispatched"):
        raise HTTPException(400, f"A {plan.status} plan cannot be completed")
    if plan.status in ("completed", "cancelled"):
        raise HTTPException(400, f"Plan is already {plan.status}")

    plan.status = status
    courier = await db.get(CourierRegistration, plan.courier_id)
    if status in ("dispatched", "cancelled") and courier:
        shipments = (await db.execute(
            select(CourierShipment).where(CourierShipment.id.in_(
                select(RouteStop.shipment_id).where(RouteStop.route_plan_id == plan.id,
                                                    RouteStop.shipment_id.isnot(None))
            ))
        )).scalars().all()
        seen = set()
        for shipment in shipments:
            for rid in (shipment.sender_vendor_id, shipment.receiver_vendor_id):
                if rid in seen or rid == vendor.id or rid is None:
                    continue
                seen.add(rid)
                await create_notification(
                    db, rid, NotificationType.ROUTE_UPDATE,
                    f"{shipment.tracking_number} is on {courier.courier_name}'s "
                    f"{'run' if status == 'dispatched' else 'cancelled run'}",
                    f"{plan.total_stops} stops · {plan.total_distance_km:g} km planned"
                    f" · about {plan.estimated_minutes} minutes",
                    sender_id=vendor.id,
                    data={"route_id": plan.id, "shipment_id": shipment.id, "status": status},
                )
    await db.commit()
    return {"message": f"Route {status}", "status": plan.status, "plan": await _plan_out(db, plan, vendor)}


@router.post("/routes/{route_id}/stops/{stop_id}/solve")
async def solve_stop(
    route_id: UUID,
    stop_id: UUID,
    solved: bool = True,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(RoutePlan, route_id)
    if not plan or plan.vendor_id != vendor.id:
        raise HTTPException(404, "Route plan not found")
    stop = await db.get(RouteStop, stop_id)
    if not stop or stop.route_plan_id != plan.id:
        raise HTTPException(404, "Stop not found")
    stop.solved = solved
    await db.commit()
    remaining = [s for s in (await db.execute(
        select(RouteStop).where(RouteStop.route_plan_id == plan.id)
    )).scalars() if not s.solved]
    return {"message": "Stop solved" if solved else "Stop reopened",
            "stops_remaining": len(remaining), "total_stops": plan.total_stops}

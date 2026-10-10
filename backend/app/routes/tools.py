from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tools import (
    CourierRegistration, HotelSourcing, PopupShop, ToolCategory, ToolListing, TransportService,
)
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor

router = APIRouter()


class ToolListingCreate(BaseModel):
    category: ToolCategory
    title: str = Field(min_length=2, max_length=300)
    description: Optional[str] = None
    location: Optional[str] = None
    geo_lat: Optional[float] = None
    geo_lng: Optional[float] = None
    price_per_unit: Optional[float] = Field(None, ge=0)
    price_unit: str = "per_day"
    min_booking: int = Field(1, ge=1)
    deposit_required: float = Field(0, ge=0)
    available_from: Optional[datetime] = None
    available_until: Optional[datetime] = None
    capacity: dict = {}
    features: list[str] = []
    images: list[str] = []
    terms: Optional[str] = None
    contact_info: dict = {}
    # Category-specific detail; only the block matching `category` is stored.
    transport: Optional[dict] = None       # vehicle_type, max_weight_kg, max_volume_cbm, routes, insurance_covered
    popup_shop: Optional[dict] = None      # venue_name, venue_type, foot_traffic_estimate, amenities, shared_spaces_available
    hotel_sourcing: Optional[dict] = None  # hotel_name, proximity_to, vendor_rate, includes_storage, meeting_room


class ToolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    vendor_id: str
    vendor_handle: str
    vendor_business: str
    category: str
    title: str
    description: Optional[str]
    location: Optional[str]
    price_per_unit: Optional[float]
    price_unit: Optional[str]
    min_booking: int = 1
    deposit_required: float = 0
    capacity: dict = {}
    features: list = []
    terms: Optional[str] = None
    is_available: bool
    times_booked: int
    avg_rating: float
    details: Optional[dict] = None


class CourierRegister(BaseModel):
    courier_name: str = Field(min_length=2, max_length=200)
    registration_number: Optional[str] = None
    coverage_areas: list[str] = []
    service_types: list[str] = []
    price_per_kg: Optional[float] = Field(None, ge=0)
    base_rate: Optional[float] = Field(None, ge=0)


def _tool_out(t: ToolListing, v: Vendor, details: Optional[dict] = None) -> ToolOut:
    return ToolOut(
        id=str(t.id), vendor_id=str(v.id), vendor_handle=v.vendor_handle, vendor_business=v.business_name,
        category=t.category.value, title=t.title, description=t.description, location=t.location,
        price_per_unit=t.price_per_unit, price_unit=t.price_unit, min_booking=t.min_booking,
        deposit_required=t.deposit_required or 0, capacity=t.capacity or {}, features=t.features or [],
        terms=t.terms, is_available=t.is_available, times_booked=t.times_booked, avg_rating=t.avg_rating,
        details=details,
    )


async def _details_for(db: AsyncSession, t: ToolListing) -> Optional[dict]:
    if t.category == ToolCategory.TRANSPORT:
        s = (await db.execute(select(TransportService).where(TransportService.tool_listing_id == t.id))).scalars().first()
        return s and {"vehicle_type": s.vehicle_type, "max_weight_kg": s.max_weight_kg, "max_volume_cbm": s.max_volume_cbm,
                      "routes": s.routes or [], "insurance_covered": s.insurance_covered}
    if t.category == ToolCategory.POPUP_SHOP:
        s = (await db.execute(select(PopupShop).where(PopupShop.tool_listing_id == t.id))).scalars().first()
        return s and {"venue_name": s.venue_name, "venue_type": s.venue_type, "foot_traffic_estimate": s.foot_traffic_estimate,
                      "amenities": s.amenities or [], "shared_spaces_available": s.shared_spaces_available}
    if t.category == ToolCategory.HOTEL_SOURCING:
        s = (await db.execute(select(HotelSourcing).where(HotelSourcing.tool_listing_id == t.id))).scalars().first()
        return s and {"hotel_name": s.hotel_name, "proximity_to": s.proximity_to or [], "vendor_rate": s.vendor_rate,
                      "includes_storage": s.includes_storage, "meeting_room": s.meeting_room}
    return None


@router.post("/list", status_code=201)
async def list_tool(
    data: ToolListingCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """List a tool/service for the vendor network"""
    payload = data.model_dump(exclude={"transport", "popup_shop", "hotel_sourcing"})
    tool = ToolListing(vendor_id=vendor.id, **payload)
    db.add(tool)
    await db.flush()

    if data.category == ToolCategory.TRANSPORT and data.transport:
        t = data.transport
        db.add(TransportService(tool_listing_id=tool.id, vehicle_type=t.get("vehicle_type"),
                                max_weight_kg=t.get("max_weight_kg"), max_volume_cbm=t.get("max_volume_cbm"),
                                routes=t.get("routes") or [], insurance_covered=bool(t.get("insurance_covered", False))))
    elif data.category == ToolCategory.POPUP_SHOP and data.popup_shop:
        p = data.popup_shop
        db.add(PopupShop(tool_listing_id=tool.id, venue_name=p.get("venue_name"), venue_type=p.get("venue_type"),
                         foot_traffic_estimate=p.get("foot_traffic_estimate"), amenities=p.get("amenities") or [],
                         shared_spaces_available=int(p.get("shared_spaces_available") or 0)))
    elif data.category == ToolCategory.HOTEL_SOURCING and data.hotel_sourcing:
        h = data.hotel_sourcing
        db.add(HotelSourcing(tool_listing_id=tool.id, hotel_name=h.get("hotel_name"), proximity_to=h.get("proximity_to") or [],
                             vendor_rate=h.get("vendor_rate"), includes_storage=bool(h.get("includes_storage", False)),
                             meeting_room=bool(h.get("meeting_room", False))))
    await db.commit()
    return {"message": "Tool listed", "tool_id": str(tool.id)}


@router.get("/browse", response_model=List[ToolOut])
async def browse_tools(
    category: Optional[ToolCategory] = None,
    location: Optional[str] = None,
    search: Optional[str] = None,
    include_mine: bool = True,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(ToolListing, Vendor)
        .join(Vendor, ToolListing.vendor_id == Vendor.id)
        .where(ToolListing.is_available.is_(True))
    )
    if category:
        query = query.where(ToolListing.category == category)
    if location:
        query = query.where(ToolListing.location.ilike(f"%{location}%"))
    if search:
        query = query.where(ToolListing.title.ilike(f"%{search}%") | ToolListing.description.ilike(f"%{search}%"))
    if not include_mine:
        query = query.where(ToolListing.vendor_id != vendor.id)
    query = query.order_by(ToolListing.times_booked.desc(), ToolListing.created_at.desc()).offset(skip).limit(limit)
    rows = (await db.execute(query)).all()
    return [_tool_out(t, v, await _details_for(db, t)) for t, v in rows]


@router.get("/mine", response_model=List[ToolOut])
async def my_tools(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    tools = (await db.execute(
        select(ToolListing).where(ToolListing.vendor_id == vendor.id).order_by(ToolListing.created_at.desc())
    )).scalars().all()
    return [_tool_out(t, vendor, await _details_for(db, t)) for t in tools]


@router.post("/courier/register", status_code=201)
async def register_courier(
    data: CourierRegister,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Register a courier service in the network"""
    courier = CourierRegistration(vendor_id=vendor.id, **data.model_dump())
    db.add(courier)
    # A courier is also discoverable through the tools browser.
    db.add(ToolListing(
        vendor_id=vendor.id, category=ToolCategory.COURIER, title=data.courier_name,
        description=f"Coverage: {', '.join(data.coverage_areas) or 'ask'} · Services: {', '.join(data.service_types) or 'ask'}",
        price_per_unit=data.price_per_kg, price_unit="per_kg" if data.price_per_kg is not None else None,
        features=data.service_types, capacity={"coverage_areas": data.coverage_areas},
    ))
    await db.commit()
    return {"message": "Courier registered", "courier_id": str(courier.id)}


@router.get("/couriers")
async def browse_couriers(
    area: Optional[str] = None,
    service_type: Optional[str] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    query = select(CourierRegistration, Vendor).join(Vendor, CourierRegistration.vendor_id == Vendor.id)
    if area:
        query = query.where(CourierRegistration.coverage_areas.contains([area]))
    if service_type:
        query = query.where(CourierRegistration.service_types.contains([service_type]))
    rows = (await db.execute(query.order_by(CourierRegistration.total_deliveries.desc()))).all()
    return [{
        "id": str(c.id), "courier_name": c.courier_name, "vendor_handle": v.vendor_handle, "vendor_id": str(v.id),
        "registration_number": c.registration_number, "coverage_areas": c.coverage_areas or [],
        "service_types": c.service_types or [], "price_per_kg": c.price_per_kg, "base_rate": c.base_rate,
        "is_verified": c.is_verified, "rating": c.rating, "total_deliveries": c.total_deliveries,
    } for c, v in rows]


@router.post("/{tool_id}/availability")
async def set_availability(
    tool_id: UUID,
    is_available: bool,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    tool = await db.get(ToolListing, tool_id)
    if not tool or tool.vendor_id != vendor.id:
        raise HTTPException(404, "Tool not found")
    tool.is_available = is_available
    await db.commit()
    return {"message": "Updated", "is_available": is_available}


# --- courier shipments: tracking & rating (v2.1 §6.1) ---------------------------------

import secrets  # noqa: E402

from app.models.notification import NotificationType  # noqa: E402
from app.models.stock import StockMovement  # noqa: E402
from app.models.tools import SHIPMENT_STATUSES, CourierShipment  # noqa: E402
from app.services.notification_service import create_notification  # noqa: E402


class ShipmentCreate(BaseModel):
    receiver_vendor_id: str
    origin: Optional[str] = Field(None, max_length=500)
    destination: Optional[str] = Field(None, max_length=500)
    weight_kg: Optional[float] = Field(None, ge=0)
    cost: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=1000)
    movement_id: Optional[str] = None  # the stock movement this parcel carries


class ShipmentRating(BaseModel):
    rating: int = Field(ge=1, le=5)
    review: Optional[str] = Field(None, max_length=1000)


def _tracking_number() -> str:
    return "BRF-" + secrets.token_hex(3).upper() + "-" + secrets.token_hex(2).upper()


def _shipment_out(s: CourierShipment, courier: CourierRegistration, sender: Vendor, receiver: Vendor, me: Vendor) -> dict:
    return {
        "id": str(s.id), "tracking_number": s.tracking_number, "status": s.status,
        "courier_id": str(courier.id), "courier_name": courier.courier_name, "courier_vendor_id": str(courier.vendor_id),
        "sender_vendor_id": str(sender.id), "sender_handle": sender.vendor_handle,
        "receiver_vendor_id": str(receiver.id), "receiver_handle": receiver.vendor_handle,
        "movement_id": str(s.movement_id) if s.movement_id else None,
        "origin": s.origin, "destination": s.destination, "weight_kg": s.weight_kg, "cost": s.cost, "notes": s.notes,
        "created_at": s.created_at.isoformat(), "picked_up_at": s.picked_up_at.isoformat() if s.picked_up_at else None,
        "delivered_at": s.delivered_at.isoformat() if s.delivered_at else None,
        "status_history": s.status_history or [],
        "rating": s.rating, "review": s.review,
        "my_role": "courier" if courier.vendor_id == me.id else "sender" if sender.id == me.id else "receiver",
    }


async def _shipment_rows(db: AsyncSession, where):
    from sqlalchemy.orm import aliased
    Snd, Rcv = aliased(Vendor), aliased(Vendor)
    query = (
        select(CourierShipment, CourierRegistration, Snd, Rcv)
        .join(CourierRegistration, CourierRegistration.id == CourierShipment.courier_id)
        .join(Snd, Snd.id == CourierShipment.sender_vendor_id)
        .join(Rcv, Rcv.id == CourierShipment.receiver_vendor_id)
        .where(where)
        .order_by(CourierShipment.created_at.desc()).limit(200)
    )
    return (await db.execute(query)).all()


@router.post("/couriers/{courier_id}/shipments", status_code=201)
async def book_shipment(
    courier_id: UUID,
    data: ShipmentCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Hand a parcel to a registered courier. The receiver and the courier are told."""
    courier = await db.get(CourierRegistration, courier_id)
    if not courier:
        raise HTTPException(404, "Courier not found")
    try:
        receiver_id = UUID(data.receiver_vendor_id)
    except ValueError:
        raise HTTPException(400, "receiver_vendor_id is not a UUID")
    receiver = await db.get(Vendor, receiver_id)
    if not receiver:
        raise HTTPException(404, "Receiving vendor not found")
    if receiver.id == vendor.id:
        raise HTTPException(400, "Ship to another vendor")
    movement_id = None
    if data.movement_id:
        try:
            movement_id = UUID(data.movement_id)
        except ValueError:
            raise HTTPException(400, "movement_id is not a UUID")
        movement = await db.get(StockMovement, movement_id)
        if not movement or vendor.id not in (movement.from_vendor_id, movement.to_vendor_id):
            raise HTTPException(404, "Movement not found")

    now = datetime.utcnow()
    shipment = CourierShipment(
        courier_id=courier.id, sender_vendor_id=vendor.id, receiver_vendor_id=receiver.id, movement_id=movement_id,
        tracking_number=_tracking_number(), status="picked_up", origin=data.origin, destination=data.destination,
        weight_kg=data.weight_kg, cost=data.cost, notes=data.notes, picked_up_at=now,
        status_history=[{"status": "picked_up", "at": now.isoformat(), "by": vendor.vendor_handle}],
    )
    db.add(shipment)
    await db.flush()
    for rid in {receiver.id, courier.vendor_id}:
        await create_notification(
            db, rid, NotificationType.SHIPMENT_UPDATE,
            f"Shipment {shipment.tracking_number} from @{vendor.vendor_handle}",
            f"Via {courier.courier_name}" + (f" · to {data.destination}" if data.destination else ""),
            sender_id=vendor.id, data={"shipment_id": shipment.id, "tracking_number": shipment.tracking_number},
        )
    await db.commit()
    return {"message": "Shipment booked", "shipment_id": str(shipment.id), "tracking_number": shipment.tracking_number}


@router.get("/shipments")
async def my_shipments(
    role: Optional[str] = Query(None, pattern="^(sent|received|courier)$"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import or_
    my_couriers = select(CourierRegistration.id).where(CourierRegistration.vendor_id == vendor.id)
    if role == "sent":
        where = CourierShipment.sender_vendor_id == vendor.id
    elif role == "received":
        where = CourierShipment.receiver_vendor_id == vendor.id
    elif role == "courier":
        where = CourierShipment.courier_id.in_(my_couriers)
    else:
        where = or_(CourierShipment.sender_vendor_id == vendor.id, CourierShipment.receiver_vendor_id == vendor.id,
                    CourierShipment.courier_id.in_(my_couriers))
    rows = await _shipment_rows(db, where)
    return [_shipment_out(s, c, snd, rcv, vendor) for s, c, snd, rcv in rows]


@router.get("/shipments/track/{tracking_number}")
async def track_shipment(
    tracking_number: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    rows = await _shipment_rows(db, CourierShipment.tracking_number == tracking_number.strip().upper())
    if not rows:
        raise HTTPException(404, "No shipment with that tracking number")
    s, c, snd, rcv = rows[0]
    return _shipment_out(s, c, snd, rcv, vendor)


@router.post("/shipments/{shipment_id}/status")
async def update_shipment_status(
    shipment_id: UUID,
    status: str = Query(..., pattern="^(picked_up|in_transit|out_for_delivery|delivered|failed)$"),
    note: Optional[str] = Query(None, max_length=300),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The courier advances the parcel; the receiver may confirm `delivered`."""
    shipment = await db.get(CourierShipment, shipment_id, with_for_update=True)
    if not shipment:
        raise HTTPException(404, "Shipment not found")
    courier = await db.get(CourierRegistration, shipment.courier_id)
    is_courier = courier is not None and courier.vendor_id == vendor.id
    is_receiver = shipment.receiver_vendor_id == vendor.id
    if not (is_courier or (is_receiver and status == "delivered")):
        raise HTTPException(403, "Only the courier updates a shipment (the receiver can confirm delivery)")
    if shipment.status in ("delivered", "failed"):
        raise HTTPException(400, f"Shipment already {shipment.status}")
    if status == "delivered" and shipment.movement_id:
        raise HTTPException(409, "Order receipt requires the buyer's one-time code on the order page")
    if SHIPMENT_STATUSES.index(status) < SHIPMENT_STATUSES.index(shipment.status) and status != "failed":
        raise HTTPException(400, f"Can't go back from {shipment.status} to {status}")

    now = datetime.utcnow()
    shipment.status = status
    history = list(shipment.status_history or [])
    history.append({"status": status, "at": now.isoformat(), "by": vendor.vendor_handle, "note": note})
    shipment.status_history = history
    if status == "delivered":
        shipment.delivered_at = now
        if courier is not None:
            courier.total_deliveries = (courier.total_deliveries or 0) + 1
    for rid in {shipment.sender_vendor_id, shipment.receiver_vendor_id, courier.vendor_id if courier else None} - {vendor.id, None}:
        await create_notification(
            db, rid, NotificationType.SHIPMENT_UPDATE,
            f"{shipment.tracking_number}: {status.replace('_', ' ')}",
            note or (f"Updated by @{vendor.vendor_handle}"),
            sender_id=vendor.id, data={"shipment_id": shipment.id, "tracking_number": shipment.tracking_number, "status": status},
        )
    await db.commit()
    return {"message": f"Shipment {status}", "status": status}


@router.post("/shipments/{shipment_id}/rate")
async def rate_shipment(
    shipment_id: UUID,
    data: ShipmentRating,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Sender or receiver rates a delivered shipment; the courier's average moves."""
    shipment = await db.get(CourierShipment, shipment_id, with_for_update=True)
    if not shipment or vendor.id not in (shipment.sender_vendor_id, shipment.receiver_vendor_id):
        raise HTTPException(404, "Shipment not found")
    if shipment.status not in ("delivered", "failed"):
        raise HTTPException(400, "Rate a shipment once it is delivered (or failed)")
    if shipment.rating is not None:
        raise HTTPException(400, "This shipment is already rated")
    shipment.rating = data.rating
    shipment.review = data.review
    shipment.rated_at = datetime.utcnow()

    courier = await db.get(CourierRegistration, shipment.courier_id)
    if courier is not None:
        from sqlalchemy import func
        avg, count = (await db.execute(
            select(func.avg(CourierShipment.rating), func.count(CourierShipment.rating))
            .where(CourierShipment.courier_id == courier.id, CourierShipment.rating.isnot(None))
        )).one()
        courier.rating = round(float(avg or 0), 2)
        # The Tools listing mirrors the courier's rating so it ranks honestly in browse.
        listing = (await db.execute(select(ToolListing).where(
            ToolListing.vendor_id == courier.vendor_id, ToolListing.category == ToolCategory.COURIER,
            ToolListing.title == courier.courier_name,
        ))).scalars().first()
        if listing is not None:
            listing.avg_rating = courier.rating
        await create_notification(
            db, courier.vendor_id, NotificationType.SHIPMENT_UPDATE,
            f"@{vendor.vendor_handle} rated {shipment.tracking_number} {data.rating}/5",
            data.review or f"{count} rating{'s' if count != 1 else ''} · average {courier.rating}",
            sender_id=vendor.id, data={"shipment_id": shipment.id, "rating": data.rating},
        )
    await db.commit()
    return {"message": "Thanks — rating recorded", "rating": data.rating, "courier_rating": courier.rating if courier else None}

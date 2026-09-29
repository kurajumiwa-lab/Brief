from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tools import (
    CourierRegistration, HotelSourcing, PopupShop, ToolCategory, ToolListing,
    TransportService, WarehouseRental,
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


class WarehouseBooking(BaseModel):
    start_date: datetime
    end_date: datetime
    space_allocated: dict = {}

    @field_validator("start_date", "end_date")
    @classmethod
    def _naive_utc(cls, dt: datetime) -> datetime:
        # Browsers send tz-aware ISO strings ("...Z"); the columns are naive UTC.
        return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


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


@router.post("/{tool_id}/book-warehouse", status_code=201)
async def book_warehouse(
    tool_id: UUID,
    data: WarehouseBooking,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Reserve space in a listed warehouse or cold store."""
    tool = await db.get(ToolListing, tool_id)
    if not tool or not tool.is_available:
        raise HTTPException(404, "Tool not found")
    if tool.category not in (ToolCategory.WAREHOUSE, ToolCategory.COLD_STORAGE):
        raise HTTPException(400, "Only warehouse and cold-storage listings take space bookings")
    if tool.vendor_id == vendor.id:
        raise HTTPException(400, "This is your own space")
    if data.end_date <= data.start_date:
        raise HTTPException(400, "end_date must be after start_date")
    rental = WarehouseRental(
        tool_listing_id=tool.id, renter_vendor_id=vendor.id, space_allocated=data.space_allocated,
        start_date=data.start_date, end_date=data.end_date, monthly_rate=tool.price_per_unit,
    )
    db.add(rental)
    tool.times_booked += 1
    await db.commit()
    return {"message": "Space booked", "rental_id": str(rental.id)}


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

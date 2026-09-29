from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor, VendorProfile, VendorRole, vendor_connections
from app.routes.auth import get_current_vendor
from app.services import stock_engine, patron_service, vendor_network

router = APIRouter()


class VendorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    business_name: str
    vendor_handle: str
    current_role: str
    business_categories: list
    business_description: Optional[str]
    physical_location: Optional[str]
    network_score: float
    parasitism_index: float
    total_sourced: int
    total_supplied: int
    total_stock_moved: int
    has_pos_connected: bool
    is_patron: bool
    is_verified: bool
    connected: bool = False
    # SRM-lite (v2.1 §4.4)
    fulfillment_rate: Optional[float] = None   # % of confirmed movements delivered; None until there is a sample
    movements_completed: int = 0
    reliability_score: Optional[float] = None  # filled where the performance row is loaded


class VendorUpdate(BaseModel):
    business_name: Optional[str] = None
    current_role: Optional[VendorRole] = None
    business_categories: Optional[list[str]] = None
    business_description: Optional[str] = None
    physical_location: Optional[str] = None
    phone: Optional[str] = None
    geo_lat: Optional[float] = None
    geo_lng: Optional[float] = None


class ProfileUpdate(BaseModel):
    primary_goods: Optional[list[str]] = None
    sourcing_interests: Optional[list[str]] = None
    supply_capacity: Optional[dict] = None
    preferred_regions: Optional[list[str]] = None
    min_order_value: Optional[float] = None
    accepts_bulk: Optional[bool] = None
    offers_credit: Optional[bool] = None
    warehouse_address: Optional[str] = None
    operating_hours: Optional[dict] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None


def vendor_out(v: Vendor, connected: bool = False) -> VendorOut:
    return VendorOut(
        id=str(v.id),
        business_name=v.business_name,
        vendor_handle=v.vendor_handle,
        current_role=v.current_role.value,
        business_categories=v.business_categories or [],
        business_description=v.business_description,
        physical_location=v.physical_location,
        network_score=v.network_score,
        parasitism_index=v.parasitism_index,
        total_sourced=v.total_sourced,
        total_supplied=v.total_supplied,
        total_stock_moved=v.total_stock_moved,
        has_pos_connected=v.has_pos_connected,
        is_patron=v.is_patron,
        is_verified=v.is_verified,
        connected=connected,
        fulfillment_rate=stock_engine.fulfillment_rate(v),
        movements_completed=int(getattr(v, "movements_completed", 0) or 0),
    )


@router.get("/me", response_model=VendorOut)
async def get_my_profile(vendor: Vendor = Depends(get_current_vendor)):
    return vendor_out(vendor)


@router.put("/me", response_model=VendorOut)
async def update_profile(
    data: VendorUpdate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(vendor, field, value)
    await db.commit()
    await db.refresh(vendor)
    return vendor_out(vendor)


@router.get("/me/profile")
async def get_my_extended_profile(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    profile = (await db.execute(select(VendorProfile).where(VendorProfile.vendor_id == vendor.id))).scalars().first()
    if profile is None:
        profile = VendorProfile(vendor_id=vendor.id)
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
    return {
        "primary_goods": profile.primary_goods or [],
        "sourcing_interests": profile.sourcing_interests or [],
        "supply_capacity": profile.supply_capacity or {},
        "preferred_regions": profile.preferred_regions or [],
        "min_order_value": profile.min_order_value,
        "accepts_bulk": profile.accepts_bulk,
        "offers_credit": profile.offers_credit,
        "warehouse_address": profile.warehouse_address,
        "operating_hours": profile.operating_hours,
        "logo_url": profile.logo_url,
        "banner_url": profile.banner_url,
    }


@router.put("/me/profile")
async def update_extended_profile(
    data: ProfileUpdate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    profile = (await db.execute(select(VendorProfile).where(VendorProfile.vendor_id == vendor.id))).scalars().first()
    if profile is None:
        profile = VendorProfile(vendor_id=vendor.id)
        db.add(profile)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(profile, field, value)
    await db.commit()
    return {"message": "Profile updated"}


@router.post("/switch-role/{role}")
async def switch_role(
    role: VendorRole,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Switch between sourcing/selling/both. You're always a vendor."""
    vendor.current_role = role
    await db.commit()
    return {"message": f"Now operating as: {role.value}", "role": role.value}


@router.get("/network", response_model=List[VendorOut])
async def browse_vendor_network(
    category: Optional[str] = None,
    role: Optional[VendorRole] = None,
    location: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Browse the vendor network. Everyone here is a vendor."""
    query = select(Vendor).where(Vendor.id != vendor.id)

    if category:
        query = query.where(Vendor.business_categories.contains([category]))
    if role:
        query = query.where(Vendor.current_role == role)
    if location:
        query = query.where(Vendor.physical_location.ilike(f"%{location}%"))
    if search:
        query = query.where(or_(
            Vendor.business_name.ilike(f"%{search}%"),
            Vendor.vendor_handle.ilike(f"%{search}%"),
            Vendor.business_description.ilike(f"%{search}%"),
        ))

    query = query.order_by(Vendor.network_score.desc(), Vendor.joined_at.desc()).offset(skip).limit(limit)
    vendors = (await db.execute(query)).scalars().all()
    connected = {c["vendor_id"] for c in await vendor_network.list_connections(db, vendor.id)}
    return [vendor_out(v, connected=str(v.id) in connected) for v in vendors]


@router.get("/connections")
async def my_connections(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Who you are connected to, ranked by how much you feed each other."""
    return await vendor_network.list_connections(db, vendor.id)


@router.get("/suggested")
async def suggested_vendors(
    limit: int = Query(10, ge=1, le=50),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Vendors whose business complements yours."""
    return await vendor_network.suggest_vendors(db, vendor, limit)


@router.get("/graph")
async def parasitism_graph(
    depth: int = Query(2, ge=1, le=3),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The connection graph around you: nodes are vendors, edges carry the pair score."""
    return await vendor_network.network_graph(db, vendor.id, depth=depth)


@router.get("/stats")
async def network_stats(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    total = (await db.execute(select(func.count(Vendor.id)))).scalar() or 0
    by_role = dict((await db.execute(
        select(Vendor.current_role, func.count(Vendor.id)).group_by(Vendor.current_role)
    )).all())
    connections = (await db.execute(select(func.count()).select_from(vendor_connections))).scalar() or 0
    return {
        "vendors": total,
        "by_role": {k.value if hasattr(k, "value") else str(k): v for k, v in by_role.items()},
        "connections": connections,
    }


@router.get("/{handle}/performance")
async def vendor_performance(
    handle: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """SRM-lite metrics for a vendor (v2.1 §4.4): fulfilment, responsiveness, volume, reliability."""
    from app.models.performance import VendorPerformance
    from app.services import performance_service

    target = (await db.execute(select(Vendor).where(Vendor.vendor_handle == handle.lstrip("@").lower()))).scalars().first()
    if not target:
        raise HTTPException(404, "Vendor not found")
    perf = (await db.execute(select(VendorPerformance).where(VendorPerformance.vendor_id == target.id))).scalar_one_or_none()
    return {"vendor_handle": target.vendor_handle, "fulfillment_rate": stock_engine.fulfillment_rate(target),
            **performance_service.to_dict(perf)}


@router.get("/{handle}", response_model=VendorOut)
async def vendor_by_handle(
    handle: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(select(Vendor).where(Vendor.vendor_handle == handle.lstrip("@").lower()))).scalars().first()
    if not target:
        raise HTTPException(404, "Vendor not found")
    out = vendor_out(target, connected=await vendor_network.are_connected(db, vendor.id, target.id))
    out.reliability_score = await _reliability(db, target.id)
    return out


async def _reliability(db: AsyncSession, vendor_id: UUID) -> Optional[float]:
    from app.models.performance import VendorPerformance
    return (await db.execute(
        select(VendorPerformance.reliability_score).where(VendorPerformance.vendor_id == vendor_id))).scalar_one_or_none()


@router.post("/connect/{target_vendor_id}")
async def connect_with_vendor(
    target_vendor_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Connect with another vendor (parasitism link)"""
    if target_vendor_id == vendor.id:
        raise HTTPException(400, "You are already your own best customer")
    target = await db.get(Vendor, target_vendor_id)
    if not target:
        raise HTTPException(404, "Vendor not found")
    if await vendor_network.are_connected(db, vendor.id, target_vendor_id):
        raise HTTPException(400, "Already connected")

    await db.execute(vendor_connections.insert().values(
        vendor_a_id=vendor.id, vendor_b_id=target_vendor_id, connection_type="mutual",
    ))
    await db.commit()
    return {"message": f"Connected with @{target.vendor_handle}"}


@router.delete("/connect/{target_vendor_id}")
async def disconnect_vendor(
    target_vendor_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    vc = vendor_connections
    result = await db.execute(vc.delete().where(or_(
        (vc.c.vendor_a_id == vendor.id) & (vc.c.vendor_b_id == target_vendor_id),
        (vc.c.vendor_a_id == target_vendor_id) & (vc.c.vendor_b_id == vendor.id),
    )))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Not connected")
    return {"message": "Disconnected"}


@router.post("/become-patron")
async def become_patron(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Become a patron - organize vendor lists and events"""
    try:
        patron = await patron_service.become_patron(db, vendor)
    except patron_service.PatronError as exc:
        raise HTTPException(exc.status_code, str(exc))
    await db.commit()
    return {
        "message": "You are now a patron. Create vendor lists and organize events.",
        **patron_service.limits_for(patron),
    }


@router.get("/me/patron")
async def my_patron_status(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    patron = await patron_service.get_patron(db, vendor)
    if not patron:
        return {"is_patron": False}
    return {
        "is_patron": True,
        "patron_id": str(patron.id),
        "total_vendors_managed": patron.total_vendors_managed,
        "total_events_organized": patron.total_events_organized,
        "reputation_score": patron.reputation_score,
        **patron_service.limits_for(patron),
    }

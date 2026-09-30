"""Daily Flash vendor Locks: products, named market zones and supplier-MOQ bidding.

No payments, consumer checkout, transcription or AI are part of this module.
"""

from datetime import date, datetime, timedelta, timezone
import re
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.market_locks import LockCluster, LockPick, LockProduct, LockWindow, MarketZone, SupplierMOQ, SupplierQuote
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services.market_locks import (
    MARKET_TZ, as_utc_naive, daily_flash_times, evaluate_window, minimum_bid_quantity,
)
from app.services.notification_service import notify_many

router = APIRouter()
_HANDLE_RE = re.compile(r"^[a-z0-9_]{3,100}$")


class ZoneCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    city: str = Field("Nairobi", min_length=2, max_length=120)
    walkable_ring: Optional[str] = Field(None, max_length=240)


class ZoneUpdate(BaseModel):
    is_active: bool


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    category: Optional[str] = Field(None, max_length=100)
    unit_of_measure: str = Field("units", min_length=1, max_length=50)


class ActiveStatus(BaseModel):
    is_active: bool


class ZoneAssignment(BaseModel):
    zone_id: UUID


class SupplierMOQUpsert(BaseModel):
    supplier_handle: str = Field(min_length=3, max_length=100)
    zone_id: UUID
    product_id: UUID
    minimum_order_quantity: int = Field(gt=0, le=10_000_000)
    notes: Optional[str] = Field(None, max_length=1000)

    @field_validator("supplier_handle")
    @classmethod
    def clean_handle(cls, value: str) -> str:
        value = value.strip().lower().lstrip("@")
        if not _HANDLE_RE.fullmatch(value):
            raise ValueError("Enter a vendor handle")
        return value


class WindowCreate(BaseModel):
    zone_id: UUID
    local_date: Optional[date] = None
    opens_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    delivery_at: Optional[datetime] = None

    @field_validator("opens_at", "closes_at", "delivery_at", mode="before")
    @classmethod
    def parse_datetime(cls, value):
        if isinstance(value, str) and value.strip():
            return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        return value


class PickCreate(BaseModel):
    product_id: UUID
    quantity: int = Field(gt=0, le=1_000_000)


class QuoteCreate(BaseModel):
    supplier_moq_id: UUID
    quoted_quantity: int = Field(gt=0, le=10_000_000)
    unit_price: float = Field(ge=0, le=1_000_000_000)
    notes: Optional[str] = Field(None, max_length=1000)


def _zone_out(zone: MarketZone) -> dict:
    return {
        "id": str(zone.id), "name": zone.name, "city": zone.city,
        "walkable_ring": zone.walkable_ring, "is_active": zone.is_active,
    }


def _product_out(product: LockProduct) -> dict:
    return {
        "id": str(product.id), "name": product.name, "category": product.category,
        "unit_of_measure": product.unit_of_measure, "is_active": product.is_active,
    }


def _role_for(vendor: Vendor) -> Optional[str]:
    return settings.market_ops_role(vendor.vendor_handle)


def require_market_ops(*roles: str):
    allowed = set(roles)

    async def dependency(vendor: Vendor = Depends(get_current_vendor)) -> tuple[Vendor, str]:
        role = _role_for(vendor)
        if role is None or (allowed and role not in allowed):
            raise HTTPException(403, "This market operations action is not available to your account")
        return vendor, role

    return dependency


async def _demand(db: AsyncSession, cluster_id: UUID) -> tuple[int, int]:
    total, count = (await db.execute(
        select(func.coalesce(func.sum(LockPick.quantity), 0), func.count(LockPick.id)).where(
            LockPick.cluster_id == cluster_id, LockPick.status == "submitted",
        )
    )).one()
    return int(total or 0), int(count or 0)


async def _cluster_summary(db: AsyncSession, cluster: LockCluster, *, admin: bool = False, my_vendor_id: UUID | None = None) -> dict:
    window = await db.get(LockWindow, cluster.window_id)
    product = await db.get(LockProduct, cluster.product_id)
    quantity, vendor_count = await _demand(db, cluster.id)
    my_pick = None
    if my_vendor_id:
        my_pick = (await db.execute(select(LockPick).where(
            LockPick.cluster_id == cluster.id, LockPick.vendor_id == my_vendor_id,
        ))).scalar_one_or_none()
    offers = (await db.execute(select(SupplierMOQ).where(
        SupplierMOQ.zone_id == window.zone_id, SupplierMOQ.product_id == cluster.product_id,
        SupplierMOQ.is_active.is_(True),
    ))).scalars().all()
    threshold_by_offer = {str(offer.id): minimum_bid_quantity(offer.minimum_order_quantity) for offer in offers}
    thresholds = list(threshold_by_offer.values())
    summary = {
        "id": str(cluster.id), "window_id": str(cluster.window_id), "product": _product_out(product) if product else None,
        "status": cluster.status, "quantity": quantity, "vendor_count": vendor_count,
        "minimum_to_bid": min(thresholds) if thresholds else None,
        "eligible_supplier_count": sum(1 for threshold in thresholds if quantity >= threshold),
        "supplier_count": len(offers), "bid_quantity": cluster.bid_quantity,
        "roll_count": window.roll_count, "dissolved_reason": cluster.dissolved_reason,
        "my_pick": ({"id": str(my_pick.id), "quantity": my_pick.quantity, "status": my_pick.status}
                    if my_pick and my_pick.status == "submitted" else None),
    }
    if cluster.status == "locked" and cluster.selected_quote_id:
        quote = await db.get(SupplierQuote, cluster.selected_quote_id)
        offer = await db.get(SupplierMOQ, quote.supplier_moq_id) if quote else None
        supplier = await db.get(Vendor, offer.supplier_vendor_id) if offer else None
        summary["locked"] = {
            "quantity": cluster.locked_quantity, "unit_price": cluster.locked_unit_price,
            "supplier_handle": supplier.vendor_handle if supplier else None,
            "supplier_business": supplier.business_name if supplier else None,
        }
    if admin:
        summary["supplier_offers"] = [{
            "id": str(offer.id), "supplier_handle": (await db.get(Vendor, offer.supplier_vendor_id)).vendor_handle,
            "supplier_business": (await db.get(Vendor, offer.supplier_vendor_id)).business_name,
            "minimum_order_quantity": offer.minimum_order_quantity,
            "minimum_to_bid": threshold_by_offer[str(offer.id)], "eligible": quantity >= threshold_by_offer[str(offer.id)],
            "notes": offer.notes,
        } for offer in offers]
        quotes = (await db.execute(select(SupplierQuote).where(
            SupplierQuote.cluster_id == cluster.id,
        ).order_by(SupplierQuote.unit_price, SupplierQuote.created_at))).scalars().all()
        summary["quotes"] = []
        for quote in quotes:
            offer = await db.get(SupplierMOQ, quote.supplier_moq_id)
            supplier = await db.get(Vendor, offer.supplier_vendor_id) if offer else None
            summary["quotes"].append({
                "id": str(quote.id), "supplier_moq_id": str(quote.supplier_moq_id),
                "supplier_handle": supplier.vendor_handle if supplier else None,
                "supplier_business": supplier.business_name if supplier else None,
                "quoted_quantity": quote.quoted_quantity, "unit_price": quote.unit_price,
                "notes": quote.notes, "status": quote.status,
            })
    return summary


async def _window_summary(db: AsyncSession, window: LockWindow, *, admin: bool = False, my_vendor_id: UUID | None = None) -> dict:
    zone = await db.get(MarketZone, window.zone_id)
    clusters = (await db.execute(select(LockCluster).where(
        LockCluster.window_id == window.id,
    ).order_by(LockCluster.created_at))).scalars().all()
    return {
        "id": str(window.id), "zone": _zone_out(zone), "local_date": window.local_date.isoformat(),
        "opens_at": window.opens_at.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "closes_at": window.closes_at.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "delivery_at": window.delivery_at.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": window.status, "roll_count": window.roll_count,
        "clusters": [await _cluster_summary(db, c, admin=admin, my_vendor_id=my_vendor_id) for c in clusters],
    }


async def _make_window(db: AsyncSession, zone_id: UUID, day: date, created_by: Optional[UUID] = None,
                       opens_at: Optional[datetime] = None, closes_at: Optional[datetime] = None,
                       delivery_at: Optional[datetime] = None) -> LockWindow:
    if opens_at is None and closes_at is None and delivery_at is None:
        opens_at, closes_at, delivery_at = daily_flash_times(day)
    elif opens_at is None or closes_at is None or delivery_at is None:
        raise HTTPException(400, "Supply all three window times or none")
    else:
        opens_at, closes_at, delivery_at = map(as_utc_naive, (opens_at, closes_at, delivery_at))
    if closes_at <= opens_at or delivery_at < closes_at:
        raise HTTPException(400, "Close must follow open, and delivery must be at or after close")
    if opens_at.replace(tzinfo=timezone.utc).astimezone(MARKET_TZ).date() != day:
        raise HTTPException(400, "The local date must match the opening time in East Africa Time")
    if opens_at < datetime.utcnow() - timedelta(minutes=1):
        raise HTTPException(400, "A new Lock window cannot open in the past")
    window = LockWindow(
        zone_id=zone_id, local_date=day, opens_at=opens_at, closes_at=closes_at,
        delivery_at=delivery_at, status="open", roll_count=0, created_by_vendor_id=created_by,
    )
    db.add(window)
    await db.flush()
    return window


# --- vendor-facing zone, catalog, windows and picks -------------------------------

@router.get("/zones")
async def list_active_zones(db: AsyncSession = Depends(get_db)):
    zones = (await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True)).order_by(
        MarketZone.city, MarketZone.name,
    ))).scalars().all()
    return [_zone_out(zone) for zone in zones]


@router.get("/me")
async def lock_home(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    zone = await db.get(MarketZone, vendor.market_zone_id) if vendor.market_zone_id else None
    can_change_at = vendor.market_zone_changed_at + timedelta(days=30) if vendor.market_zone_changed_at else None
    can_change = vendor.market_zone_id is None or can_change_at <= now
    zones = (await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True)).order_by(
        MarketZone.city, MarketZone.name,
    ))).scalars().all()
    catalog = []
    windows = []
    if zone and zone.is_active:
        products = (await db.execute(
            select(LockProduct).join(SupplierMOQ, SupplierMOQ.product_id == LockProduct.id)
            .where(SupplierMOQ.zone_id == zone.id, SupplierMOQ.is_active.is_(True), LockProduct.is_active.is_(True))
            .distinct().order_by(LockProduct.name)
        )).scalars().all()
        for product in products:
            offers = (await db.execute(select(SupplierMOQ).where(
                SupplierMOQ.zone_id == zone.id, SupplierMOQ.product_id == product.id, SupplierMOQ.is_active.is_(True),
            ))).scalars().all()
            thresholds = [minimum_bid_quantity(offer.minimum_order_quantity) for offer in offers]
            catalog.append({**_product_out(product), "minimum_to_bid": min(thresholds), "supplier_count": len(offers)})
        local_today = datetime.now(MARKET_TZ).date()
        window_rows = (await db.execute(select(LockWindow).where(
            LockWindow.zone_id == zone.id,
            LockWindow.local_date >= (local_today - timedelta(days=2)),
            LockWindow.local_date <= (local_today + timedelta(days=2)),
        ).order_by(LockWindow.local_date.desc()).limit(4))).scalars().all()
        windows = [await _window_summary(db, window, my_vendor_id=vendor.id) for window in window_rows]
    return {
        "vendor_zone": _zone_out(zone) if zone else None,
        "market_zone_changed_at": vendor.market_zone_changed_at.isoformat() if vendor.market_zone_changed_at else None,
        "can_change_zone": can_change,
        "zone_change_available_at": can_change_at.isoformat() if can_change_at else None,
        "zones": [_zone_out(item) for item in zones], "catalog": catalog, "windows": windows,
        "market_ops_role": _role_for(vendor),
    }


@router.post("/me/zone")
async def assign_market_zone(
    data: ZoneAssignment,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    zone = await db.get(MarketZone, data.zone_id)
    if not zone or not zone.is_active:
        raise HTTPException(404, "Market zone not found")
    if vendor.market_zone_id == zone.id:
        return {"message": "Market zone unchanged", "zone": _zone_out(zone)}
    now = datetime.utcnow()
    if vendor.market_zone_id and vendor.market_zone_changed_at and now < vendor.market_zone_changed_at + timedelta(days=30):
        available = (vendor.market_zone_changed_at + timedelta(days=30)).isoformat()
        raise HTTPException(409, f"You can change your market zone after {available} UTC")
    vendor.market_zone_id = zone.id
    vendor.market_zone_changed_at = now
    await db.commit()
    return {"message": f"Market zone set to {zone.name}", "zone": _zone_out(zone), "changed_at": now.isoformat()}


@router.post("/windows/{window_id}/picks", status_code=201)
async def submit_lock_pick(
    window_id: UUID,
    data: PickCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    window = await db.get(LockWindow, window_id, with_for_update=True)
    now = datetime.utcnow()
    if not window or window.status not in ("open", "rolling"):
        raise HTTPException(404, "This Daily Flash window is closed")
    if not vendor.market_zone_id or vendor.market_zone_id != window.zone_id:
        raise HTTPException(403, "Choose this market zone before submitting a Lock")
    if now < window.opens_at or now >= window.closes_at:
        raise HTTPException(400, "This Lock window is not accepting picks right now")
    product = await db.get(LockProduct, data.product_id)
    if not product or not product.is_active:
        raise HTTPException(404, "Product not found")
    offers = (await db.execute(select(SupplierMOQ).where(
        SupplierMOQ.zone_id == window.zone_id, SupplierMOQ.product_id == product.id, SupplierMOQ.is_active.is_(True),
    ))).scalars().all()
    if not offers:
        raise HTTPException(400, "No supplier MOQ has been verified for this product in your zone yet")
    cluster = (await db.execute(select(LockCluster).where(
        LockCluster.window_id == window.id, LockCluster.product_id == product.id,
    ).with_for_update())).scalar_one_or_none()
    if not cluster:
        if window.status == "rolling":
            raise HTTPException(400, "This product wasn't in the original window; new products can't be added during the roll")
        cluster = LockCluster(window_id=window.id, product_id=product.id, status="collecting")
        db.add(cluster)
        await db.flush()
    if cluster.status != "collecting":
        raise HTTPException(400, f"This product cluster is already {cluster.status}; picks are closed")
    pick = (await db.execute(select(LockPick).where(
        LockPick.cluster_id == cluster.id, LockPick.vendor_id == vendor.id,
    ).with_for_update())).scalar_one_or_none()
    if pick:
        pick.quantity = data.quantity
        pick.status = "submitted"
        pick.updated_at = now
    else:
        pick = LockPick(cluster_id=cluster.id, vendor_id=vendor.id, quantity=data.quantity, status="submitted")
        db.add(pick)
    await db.commit()
    await db.refresh(pick)
    summary = await _cluster_summary(db, cluster, my_vendor_id=vendor.id)
    return {"message": "Lock request saved", "pick_id": str(pick.id), "cluster": summary}


@router.delete("/picks/{pick_id}")
async def withdraw_lock_pick(
    pick_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    pick = await db.get(LockPick, pick_id, with_for_update=True)
    if not pick or pick.vendor_id != vendor.id:
        raise HTTPException(404, "Lock request not found")
    cluster = await db.get(LockCluster, pick.cluster_id, with_for_update=True)
    window = await db.get(LockWindow, cluster.window_id, with_for_update=True)
    if cluster.status != "collecting" or window.status not in ("open", "rolling") or datetime.utcnow() >= window.closes_at:
        raise HTTPException(400, "This Lock request is already closed to changes")
    pick.status = "withdrawn"
    pick.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": "Lock request withdrawn", "pick_id": str(pick.id)}


# --- operations desk: role-gated supplier/cluster management --------------------

@router.get("/ops/me")
async def market_ops_me(vendor: Vendor = Depends(get_current_vendor)):
    return {"role": _role_for(vendor)}


@router.get("/ops/board")
async def market_ops_board(
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "clerk", "spotter", "negotiator")),
    db: AsyncSession = Depends(get_db),
):
    zones = (await db.execute(select(MarketZone).order_by(MarketZone.city, MarketZone.name))).scalars().all()
    products = (await db.execute(select(LockProduct).order_by(LockProduct.name))).scalars().all()
    vendors = (await db.execute(select(Vendor).order_by(Vendor.business_name).limit(500))).scalars().all()
    offers = (await db.execute(select(SupplierMOQ).order_by(SupplierMOQ.updated_at.desc()).limit(500))).scalars().all()
    windows = (await db.execute(select(LockWindow).order_by(LockWindow.local_date.desc(), LockWindow.created_at.desc()).limit(30))).scalars().all()
    offer_rows = []
    for offer in offers:
        supplier = await db.get(Vendor, offer.supplier_vendor_id)
        zone = await db.get(MarketZone, offer.zone_id)
        product = await db.get(LockProduct, offer.product_id)
        offer_rows.append({
            "id": str(offer.id), "supplier_vendor_id": str(offer.supplier_vendor_id),
            "supplier_handle": supplier.vendor_handle if supplier else None,
            "supplier_business": supplier.business_name if supplier else None,
            "zone_id": str(offer.zone_id), "zone_name": zone.name if zone else None,
            "product_id": str(offer.product_id), "product_name": product.name if product else None,
            "minimum_order_quantity": offer.minimum_order_quantity, "minimum_to_bid": minimum_bid_quantity(offer.minimum_order_quantity),
            "notes": offer.notes, "is_active": offer.is_active,
        })
    return {
        "staff_role": staff[1], "zones": [_zone_out(zone) for zone in zones],
        "products": [_product_out(product) for product in products],
        "vendors": [{"id": str(item.id), "vendor_handle": item.vendor_handle, "business_name": item.business_name} for item in vendors],
        "offers": offer_rows,
        "windows": [await _window_summary(db, window, admin=True) for window in windows],
    }


@router.post("/ops/zones", status_code=201)
async def create_market_zone(
    data: ZoneCreate,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin")),
    db: AsyncSession = Depends(get_db),
):
    name, city = data.name.strip(), data.city.strip()
    name_key, city_key = name.casefold(), city.casefold()
    exists = (await db.execute(select(MarketZone.id).where(
        MarketZone.name_key == name_key, MarketZone.city_key == city_key,
    ))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "That market zone already exists")
    zone = MarketZone(name=name, city=city, name_key=name_key, city_key=city_key,
                      walkable_ring=(data.walkable_ring or "").strip() or None, is_active=True)
    db.add(zone)
    await db.commit()
    await db.refresh(zone)
    return _zone_out(zone)


@router.patch("/ops/zones/{zone_id}")
async def update_market_zone(
    zone_id: UUID,
    data: ZoneUpdate,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin")),
    db: AsyncSession = Depends(get_db),
):
    zone = await db.get(MarketZone, zone_id)
    if not zone:
        raise HTTPException(404, "Market zone not found")
    zone.is_active = data.is_active
    await db.commit()
    return _zone_out(zone)


@router.post("/ops/products", status_code=201)
async def create_lock_product(
    data: ProductCreate,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin")),
    db: AsyncSession = Depends(get_db),
):
    name, unit = data.name.strip(), data.unit_of_measure.strip().lower()
    name_key = name.casefold()
    exists = (await db.execute(select(LockProduct.id).where(
        LockProduct.name_key == name_key, LockProduct.unit_of_measure == unit,
    ))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "That product and unit already exist")
    product = LockProduct(name=name, name_key=name_key, category=(data.category or "").strip() or None,
                          unit_of_measure=unit, is_active=True)
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return _product_out(product)


@router.patch("/ops/offers/{offer_id}")
async def update_supplier_moq_status(
    offer_id: UUID,
    data: ActiveStatus,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "spotter")),
    db: AsyncSession = Depends(get_db),
):
    offer = await db.get(SupplierMOQ, offer_id)
    if not offer:
        raise HTTPException(404, "Supplier MOQ offer not found")
    offer.is_active = data.is_active
    offer.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": str(offer.id), "is_active": offer.is_active}


@router.patch("/ops/products/{product_id}")
async def update_lock_product_status(
    product_id: UUID,
    data: ActiveStatus,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin")),
    db: AsyncSession = Depends(get_db),
):
    product = await db.get(LockProduct, product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    product.is_active = data.is_active
    await db.commit()
    return _product_out(product)


@router.post("/ops/offers", status_code=201)
async def upsert_supplier_moq(
    data: SupplierMOQUpsert,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "spotter")),
    db: AsyncSession = Depends(get_db),
):
    supplier = (await db.execute(select(Vendor).where(Vendor.vendor_handle == data.supplier_handle))).scalar_one_or_none()
    zone = await db.get(MarketZone, data.zone_id)
    product = await db.get(LockProduct, data.product_id)
    if supplier is None:
        raise HTTPException(404, "Supplier vendor not found")
    if not zone or not zone.is_active or not product or not product.is_active:
        raise HTTPException(404, "Choose an active zone and product")
    offer = (await db.execute(select(SupplierMOQ).where(
        SupplierMOQ.supplier_vendor_id == supplier.id,
        SupplierMOQ.zone_id == zone.id, SupplierMOQ.product_id == product.id,
    ).with_for_update())).scalar_one_or_none()
    now = datetime.utcnow()
    if offer:
        offer.minimum_order_quantity = data.minimum_order_quantity
        offer.notes = (data.notes or "").strip() or None
        offer.is_active = True
        offer.verified_at = now
        offer.updated_at = now
    else:
        offer = SupplierMOQ(
            supplier_vendor_id=supplier.id, zone_id=zone.id, product_id=product.id,
            minimum_order_quantity=data.minimum_order_quantity,
            notes=(data.notes or "").strip() or None, is_active=True, verified_at=now,
        )
        db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return {
        "id": str(offer.id), "supplier_handle": supplier.vendor_handle, "supplier_business": supplier.business_name,
        "zone_id": str(zone.id), "zone_name": zone.name, "product_id": str(product.id), "product_name": product.name,
        "minimum_order_quantity": offer.minimum_order_quantity,
        "minimum_to_bid": minimum_bid_quantity(offer.minimum_order_quantity), "verified_at": offer.verified_at.isoformat(),
    }


@router.post("/ops/windows", status_code=201)
async def create_lock_window(
    data: WindowCreate,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "clerk")),
    db: AsyncSession = Depends(get_db),
):
    zone = await db.get(MarketZone, data.zone_id)
    if not zone or not zone.is_active:
        raise HTTPException(404, "Active market zone not found")
    now_local = datetime.now(MARKET_TZ)
    day = data.local_date or now_local.date()
    if day < now_local.date():
        raise HTTPException(400, "A Daily Flash window cannot be opened for a past date")
    exists = (await db.execute(select(LockWindow.id).where(
        LockWindow.zone_id == zone.id, LockWindow.local_date == day,
    ))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "A Daily Flash window already exists for that zone and date")
    if data.opens_at or data.closes_at or data.delivery_at:
        window = await _make_window(db, zone.id, day, staff[0].id, data.opens_at, data.closes_at, data.delivery_at)
    else:
        window = await _make_window(db, zone.id, day, staff[0].id)
    await db.commit()
    await db.refresh(window)
    return await _window_summary(db, window)


@router.post("/ops/windows/{window_id}/close")
async def close_lock_window(
    window_id: UUID,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "clerk", "negotiator")),
    db: AsyncSession = Depends(get_db),
):
    window = await db.get(LockWindow, window_id, with_for_update=True)
    if not window:
        raise HTTPException(404, "Daily Flash window not found")
    if window.status == "closed":
        raise HTTPException(400, "This Daily Flash window is already closed")
    result = await evaluate_window(db, window, datetime.utcnow())
    await db.commit()
    await db.refresh(window)
    return {"message": "Window evaluated", "status": window.status, "roll_count": window.roll_count, **result}


@router.post("/ops/clusters/{cluster_id}/quotes", status_code=201)
async def add_supplier_quote(
    cluster_id: UUID,
    data: QuoteCreate,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "negotiator")),
    db: AsyncSession = Depends(get_db),
):
    cluster = await db.get(LockCluster, cluster_id, with_for_update=True)
    if not cluster or cluster.status != "bidding" or cluster.bid_quantity is None:
        raise HTTPException(400, "Supplier quotes can only be entered for a cluster open to bids")
    offer = await db.get(SupplierMOQ, data.supplier_moq_id)
    window = await db.get(LockWindow, cluster.window_id)
    if not offer or not offer.is_active or offer.zone_id != window.zone_id or offer.product_id != cluster.product_id:
        raise HTTPException(400, "This supplier is not configured for the cluster's product and zone")
    if data.quoted_quantity != cluster.bid_quantity:
        raise HTTPException(400, f"Quote quantity must match the cluster volume ({cluster.bid_quantity})")
    if data.quoted_quantity < minimum_bid_quantity(offer.minimum_order_quantity):
        raise HTTPException(400, "This supplier's 85% MOQ threshold is not met at that volume")
    quote = SupplierQuote(
        cluster_id=cluster.id, supplier_moq_id=offer.id, quoted_quantity=data.quoted_quantity,
        unit_price=data.unit_price, notes=(data.notes or "").strip() or None,
        status="offered", entered_by_vendor_id=staff[0].id,
    )
    db.add(quote)
    await db.commit()
    await db.refresh(quote)
    return {"id": str(quote.id), "cluster_id": str(cluster.id), "supplier_moq_id": str(offer.id),
            "quoted_quantity": quote.quoted_quantity, "unit_price": quote.unit_price, "status": quote.status}


@router.post("/ops/clusters/{cluster_id}/select/{quote_id}")
async def select_supplier_quote(
    cluster_id: UUID,
    quote_id: UUID,
    staff: tuple[Vendor, str] = Depends(require_market_ops("admin", "negotiator")),
    db: AsyncSession = Depends(get_db),
):
    cluster = await db.get(LockCluster, cluster_id, with_for_update=True)
    quote = await db.get(SupplierQuote, quote_id, with_for_update=True)
    if not cluster or cluster.status != "bidding" or not quote or quote.cluster_id != cluster.id or quote.status != "offered":
        raise HTTPException(404, "Open cluster quote not found")
    if quote.quoted_quantity != cluster.bid_quantity:
        raise HTTPException(409, "This quote no longer matches the cluster's bid volume")
    offer = await db.get(SupplierMOQ, quote.supplier_moq_id)
    window = await db.get(LockWindow, cluster.window_id)
    if (not offer or not window or not offer.is_active or offer.zone_id != window.zone_id or offer.product_id != cluster.product_id
            or cluster.bid_quantity < minimum_bid_quantity(offer.minimum_order_quantity)):
        raise HTTPException(409, "The supplier MOQ is no longer active or eligible at this cluster volume")
    others = (await db.execute(select(SupplierQuote).where(
        SupplierQuote.cluster_id == cluster.id, SupplierQuote.id != quote.id, SupplierQuote.status == "offered",
    ))).scalars().all()
    for other in others:
        other.status = "passed"
    quote.status = "selected"
    cluster.status = "locked"
    cluster.selected_quote_id = quote.id
    cluster.locked_quantity = quote.quoted_quantity
    cluster.locked_unit_price = quote.unit_price
    cluster.locked_at = datetime.utcnow()
    pickers = list((await db.execute(select(LockPick.vendor_id).where(
        LockPick.cluster_id == cluster.id, LockPick.status == "submitted",
    ).distinct())).scalars())
    product = await db.get(LockProduct, cluster.product_id)
    supplier = await db.get(Vendor, (await db.get(SupplierMOQ, quote.supplier_moq_id)).supplier_vendor_id)
    window = await db.get(LockWindow, cluster.window_id)
    zone = await db.get(MarketZone, window.zone_id)
    await notify_many(
        db, pickers, NotificationType.COLLECTIVE_UPDATE,
        f"Lock price confirmed: {product.name}",
        f"{quote.quoted_quantity} {product.unit_of_measure} in {zone.name} at KSh {quote.unit_price:g}/unit from @{supplier.vendor_handle}.",
        sender_id=staff[0].id,
        data={"market_lock_cluster_id": cluster.id, "window_id": window.id, "zone_id": zone.id},
    )
    await db.commit()
    return {"message": "Supplier quote selected; Lock price set", "cluster_id": str(cluster.id),
            "supplier_handle": supplier.vendor_handle, "quantity": cluster.locked_quantity,
            "unit_price": cluster.locked_unit_price, "status": cluster.status}

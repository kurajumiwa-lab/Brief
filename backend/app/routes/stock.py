import csv
import io
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.stock import MovementStatus, StockItem, StockMovement, StockSource
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import stock_engine

router = APIRouter()


class StockItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    sku: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    description: Optional[str] = None
    quantity_in_stock: int = Field(0, ge=0)
    unit_of_measure: str = "units"
    cost_price: Optional[float] = None
    wholesale_price: Optional[float] = None
    unit_price: Optional[float] = None
    min_order_quantity: int = Field(1, ge=1)
    bulk_discount_tiers: list = []
    visible_to_network: bool = True
    visible_to_groups: list = []
    images: list = []
    specifications: dict = {}
    tags: list[str] = []


class StockItemUpdate(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    description: Optional[str] = None
    quantity_in_stock: Optional[int] = Field(None, ge=0)
    unit_of_measure: Optional[str] = None
    cost_price: Optional[float] = None
    wholesale_price: Optional[float] = None
    unit_price: Optional[float] = None
    min_order_quantity: Optional[int] = Field(None, ge=1)
    bulk_discount_tiers: Optional[list] = None
    visible_to_network: Optional[bool] = None
    visible_to_groups: Optional[list] = None
    images: Optional[list] = None
    specifications: Optional[dict] = None
    tags: Optional[list[str]] = None


class StockItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    vendor_id: str
    vendor_handle: str
    vendor_business: str
    name: str
    sku: Optional[str]
    category: Optional[str]
    subcategory: Optional[str] = None
    description: Optional[str] = None
    quantity_in_stock: int
    quantity_reserved: int
    quantity_available: int
    unit_of_measure: str
    cost_price: Optional[float] = None
    wholesale_price: Optional[float]
    unit_price: Optional[float]
    min_order_quantity: int
    bulk_discount_tiers: list
    source: str
    visible_to_network: bool
    tags: list
    images: list = []
    last_pos_sync: Optional[str] = None
    updated_at: Optional[str] = None


class SourceRequest(BaseModel):
    """When a vendor wants to source (buy) from another vendor's stock"""
    quantity: int = Field(gt=0)
    proposed_price: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None


class MovementOut(BaseModel):
    id: str
    stock_item_id: str
    stock_name: str
    sku: Optional[str]
    from_vendor_id: str
    from_handle: str
    to_vendor_id: str
    to_handle: str
    quantity: int
    unit_price: Optional[float]
    total_value: Optional[float]
    movement_type: str
    status: str
    notes: Optional[str]
    created_at: str
    completed_at: Optional[str]
    direction: str  # incoming (I am buying) | outgoing (I am supplying)


def stock_out(i: StockItem, v: Vendor) -> StockItemOut:
    return StockItemOut(
        id=str(i.id),
        vendor_id=str(v.id),
        vendor_handle=v.vendor_handle,
        vendor_business=v.business_name,
        name=i.name,
        sku=i.sku,
        category=i.category,
        subcategory=i.subcategory,
        description=i.description,
        quantity_in_stock=i.quantity_in_stock,
        quantity_reserved=i.quantity_reserved,
        quantity_available=i.quantity_available,
        unit_of_measure=i.unit_of_measure,
        cost_price=i.cost_price,
        wholesale_price=i.wholesale_price,
        unit_price=i.unit_price,
        min_order_quantity=i.min_order_quantity,
        bulk_discount_tiers=i.bulk_discount_tiers or [],
        source=i.source.value,
        visible_to_network=i.visible_to_network,
        tags=i.tags or [],
        images=i.images or [],
        last_pos_sync=i.last_pos_sync.isoformat() if i.last_pos_sync else None,
        updated_at=i.updated_at.isoformat() if i.updated_at else None,
    )


def _movement_out(m: StockMovement, item: StockItem, frm: Vendor, to: Vendor, me: Vendor) -> MovementOut:
    return MovementOut(
        id=str(m.id), stock_item_id=str(item.id), stock_name=item.name, sku=item.sku,
        from_vendor_id=str(frm.id), from_handle=frm.vendor_handle,
        to_vendor_id=str(to.id), to_handle=to.vendor_handle,
        quantity=m.quantity, unit_price=m.unit_price, total_value=m.total_value,
        movement_type=m.movement_type, status=m.status, notes=m.notes,
        created_at=m.created_at.isoformat(), completed_at=m.completed_at.isoformat() if m.completed_at else None,
        direction="incoming" if m.to_vendor_id == me.id else "outgoing",
    )


@router.post("/add", status_code=201)
async def add_stock(
    data: StockItemCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Add stock. This is NOT a listing. This is what's on your shelf."""
    item = StockItem(
        vendor_id=vendor.id,
        source=StockSource.MANUAL_ENTRY,
        quantity_available=data.quantity_in_stock,
        **data.model_dump(),
    )
    db.add(item)
    await db.commit()
    return {"message": "Stock added", "stock_id": str(item.id)}


@router.post("/bulk-import")
async def bulk_import_stock(
    file: UploadFile = File(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Import stock from CSV. Headers: name,sku,category,quantity,unit_price,wholesale_price[,cost_price,unit_of_measure,tags,pos_item_id]
    Re-importing the same file updates rows by SKU instead of duplicating them."""
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "CSV must be UTF-8 encoded")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise HTTPException(400, "CSV has no data rows")

    result = await stock_engine.upsert_from_pos(db, vendor, rows, StockSource.BULK_IMPORT)
    await db.commit()
    return {
        "message": f"Imported {result['added'] + result['updated']} stock items",
        **result,
    }


@router.get("/my-stock", response_model=List[StockItemOut])
async def get_my_stock(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    items = (await db.execute(
        select(StockItem).where(StockItem.vendor_id == vendor.id).order_by(StockItem.updated_at.desc())
    )).scalars().all()
    return [stock_out(i, vendor) for i in items]


@router.get("/network-stock", response_model=List[StockItemOut])
async def browse_network_stock(
    category: Optional[str] = None,
    search: Optional[str] = None,
    vendor_handle: Optional[str] = None,
    min_quantity: int = Query(1, ge=0),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Browse stock available across the vendor network"""
    query = (
        select(StockItem, Vendor)
        .join(Vendor, StockItem.vendor_id == Vendor.id)
        .where(StockItem.visible_to_network.is_(True))
        .where(StockItem.quantity_available >= min_quantity)
        .where(StockItem.vendor_id != vendor.id)
    )
    if category:
        query = query.where(StockItem.category.ilike(category))
    if vendor_handle:
        query = query.where(Vendor.vendor_handle == vendor_handle.lstrip("@").lower())
    if search:
        query = query.where(or_(
            StockItem.name.ilike(f"%{search}%"),
            StockItem.description.ilike(f"%{search}%"),
            StockItem.sku.ilike(f"%{search}%"),
            StockItem.tags.contains([search]),
        ))

    query = query.order_by(StockItem.quantity_available.desc(), StockItem.updated_at.desc()).offset(skip).limit(limit)
    rows = (await db.execute(query)).all()
    return [stock_out(item, v) for item, v in rows]


@router.get("/categories")
async def stock_categories(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Distinct categories currently on network shelves."""
    rows = (await db.execute(
        select(StockItem.category).where(
            StockItem.visible_to_network.is_(True), StockItem.category.isnot(None), StockItem.quantity_available > 0
        ).distinct().order_by(StockItem.category)
    )).scalars().all()
    return [c for c in rows if c]


@router.get("/movements", response_model=List[MovementOut])
async def list_movements(
    status: Optional[str] = None,
    direction: Optional[str] = Query(None, pattern="^(incoming|outgoing)$"),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Your sourcing requests (incoming) and the ones made on your stock (outgoing)."""
    from sqlalchemy.orm import aliased
    Frm, To = aliased(Vendor), aliased(Vendor)
    query = (
        select(StockMovement, StockItem, Frm, To)
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .join(Frm, Frm.id == StockMovement.from_vendor_id)
        .join(To, To.id == StockMovement.to_vendor_id)
    )
    if direction == "incoming":
        query = query.where(StockMovement.to_vendor_id == vendor.id)
    elif direction == "outgoing":
        query = query.where(StockMovement.from_vendor_id == vendor.id)
    else:
        query = query.where(or_(StockMovement.to_vendor_id == vendor.id, StockMovement.from_vendor_id == vendor.id))
    if status:
        query = query.where(StockMovement.status == status)
    query = query.order_by(StockMovement.created_at.desc()).limit(200)
    rows = (await db.execute(query)).all()
    return [_movement_out(m, item, frm, to, vendor) for m, item, frm, to in rows]


@router.get("/{stock_id}", response_model=StockItemOut)
async def get_stock_item(
    stock_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(StockItem, stock_id)
    if not item or (item.vendor_id != vendor.id and not item.visible_to_network):
        raise HTTPException(404, "Stock item not found")
    owner = await db.get(Vendor, item.vendor_id)
    return stock_out(item, owner)


@router.put("/{stock_id}", response_model=StockItemOut)
async def update_stock_item(
    stock_id: UUID,
    data: StockItemUpdate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(StockItem, stock_id)
    if not item or item.vendor_id != vendor.id:
        raise HTTPException(404, "Stock item not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(item, field, value)
    stock_engine.recompute_available(item)
    await db.commit()
    await db.refresh(item)
    return stock_out(item, vendor)


@router.delete("/{stock_id}")
async def remove_stock_item(
    stock_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Take a line off the shelf. Refused while a deal on it is still open."""
    item = await db.get(StockItem, stock_id)
    if not item or item.vendor_id != vendor.id:
        raise HTTPException(404, "Stock item not found")
    if item.quantity_reserved > 0:
        raise HTTPException(400, "Stock is reserved by an open sourcing request; settle or cancel it first")
    item.quantity_in_stock = 0
    item.quantity_available = 0
    item.visible_to_network = False
    await db.commit()
    return {"message": "Stock line closed"}


@router.post("/{stock_id}/source", status_code=201)
async def source_from_vendor(
    stock_id: UUID,
    request: SourceRequest,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Source (buy) stock from another vendor. Reserves the quantity until the
    supplier confirms, ships and you receive — or someone cancels."""
    item = await db.get(StockItem, stock_id, with_for_update=True)
    if not item:
        raise HTTPException(404, "Stock item not found")
    try:
        movement = await stock_engine.request_sourcing(
            db, item, vendor, request.quantity, request.proposed_price, request.notes
        )
    except stock_engine.StockError as exc:
        raise HTTPException(exc.status_code, str(exc))
    await db.commit()
    supplier = await db.get(Vendor, item.vendor_id)
    return {
        "message": "Sourcing request sent",
        "movement_id": str(movement.id),
        "status": movement.status,
        "quantity": movement.quantity,
        "unit_price": movement.unit_price,
        "total_value": movement.total_value,
        "from_handle": supplier.vendor_handle if supplier else None,
    }


@router.post("/movements/{movement_id}/{action}")
async def advance_movement(
    movement_id: UUID,
    action: str,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """confirm → ship (supplier), receive (buyer), cancel (either, before receipt).
    `receive` moves the goods onto your shelf and scores the relationship."""
    if action not in ("confirm", "ship", "receive", "cancel"):
        raise HTTPException(404, "Unknown action")
    movement = await db.get(StockMovement, movement_id, with_for_update=True)
    if not movement or vendor.id not in (movement.from_vendor_id, movement.to_vendor_id):
        raise HTTPException(404, "Movement not found")
    try:
        await stock_engine.transition(db, movement, action, vendor)
    except stock_engine.StockError as exc:
        raise HTTPException(exc.status_code, str(exc))
    await db.commit()
    return {"message": f"Movement {movement.status}", "status": movement.status, "movement_id": str(movement.id)}


# Kept importable for callers that reason about states without the service.
STATES = [s.value for s in MovementStatus]

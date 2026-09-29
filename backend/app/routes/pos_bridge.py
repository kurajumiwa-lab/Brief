import csv
import io
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.pos_bridge import POSConnection, POSSyncLog
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import pos_sync

router = APIRouter()


class POSConnectRequest(BaseModel):
    pos_type: str  # square, shopify, csv, manual, custom_api
    connection_name: str = Field(min_length=1, max_length=200)
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    store_id: Optional[str] = None
    webhook_url: Optional[str] = None
    auto_sync: bool = True
    sync_interval_minutes: int = Field(15, ge=5, le=1440)
    sync_config: dict = {}


class PushRow(BaseModel):
    name: str
    sku: Optional[str] = None
    pos_item_id: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    quantity: int = Field(0, ge=0)
    unit_of_measure: Optional[str] = None
    unit_price: Optional[float] = None
    wholesale_price: Optional[float] = None
    cost_price: Optional[float] = None
    tags: list[str] = []
    visible_to_network: bool = True


class PushBatch(BaseModel):
    items: list[PushRow] = Field(min_length=1, max_length=5000)


def _conn_out(c: POSConnection) -> dict:
    return {
        "id": str(c.id),
        "pos_type": c.pos_type,
        "connection_name": c.connection_name,
        "store_id": c.store_id,
        "has_credentials": bool(c.api_key),
        "auto_sync": c.auto_sync,
        "sync_interval_minutes": c.sync_interval_minutes,
        "last_sync_at": c.last_sync_at.isoformat() if c.last_sync_at else None,
        "items_synced": c.items_synced,
        "sync_config": c.sync_config or {},
        "is_active": c.is_active,
        "mode": "pull" if c.pos_type in pos_sync.PULL_TYPES else "push",
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _log_out(l: POSSyncLog) -> dict:
    return {
        "id": str(l.id),
        "sync_type": l.sync_type,
        "status": l.status,
        "started_at": l.started_at.isoformat(),
        "completed_at": l.completed_at.isoformat() if l.completed_at else None,
        "items_processed": l.items_processed,
        "items_added": l.items_added,
        "items_updated": l.items_updated,
        "items_removed": l.items_removed,
        "errors": l.errors or [],
    }


async def _own_connection(db: AsyncSession, connection_id: UUID, vendor: Vendor) -> POSConnection:
    conn = await db.get(POSConnection, connection_id)
    if not conn or conn.vendor_id != vendor.id:
        raise HTTPException(404, "Connection not found")
    return conn


@router.post("/connect", status_code=201)
async def connect_pos(
    data: POSConnectRequest,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """
    Connect your POS/inventory system to Brief_.
    Your stock syncs automatically. Earn more through network exposure.
    """
    if data.pos_type not in settings.allowed_pos_systems:
        raise HTTPException(400, f"Unsupported POS type. Allowed: {', '.join(settings.allowed_pos_systems)}")
    if data.pos_type in pos_sync.PULL_TYPES and not data.api_key:
        raise HTTPException(400, f"{data.pos_type} needs an access token (api_key)")
    if data.pos_type == "shopify" and not data.store_id:
        raise HTTPException(400, "Shopify needs the store domain in store_id (e.g. my-shop.myshopify.com)")

    connection = POSConnection(
        vendor_id=vendor.id,
        pos_type=data.pos_type,
        connection_name=data.connection_name,
        api_key=pos_sync.encrypt_secret(data.api_key),
        api_secret=pos_sync.encrypt_secret(data.api_secret),
        store_id=data.store_id,
        webhook_url=data.webhook_url,
        auto_sync=data.auto_sync,
        sync_interval_minutes=data.sync_interval_minutes,
        sync_config=data.sync_config,
    )
    db.add(connection)
    vendor.has_pos_connected = True
    vendor.pos_system_type = data.pos_type
    await db.commit()

    mode = "pull" if data.pos_type in pos_sync.PULL_TYPES else "push"
    return {
        "message": f"POS ({data.pos_type}) connected. Your stock is now visible to the vendor network.",
        "connection_id": str(connection.id),
        "mode": mode,
        "next_step": (
            f"Stock will sync every {data.sync_interval_minutes} minutes; POST /api/pos/{connection.id}/sync to run one now."
            if mode == "pull" else
            f"Run pos-extension/sync_daemon.py with --connection {connection.id}, or upload a CSV to /api/pos/{connection.id}/push-csv."
        ),
    }


@router.get("/connections")
async def list_connections(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    conns = (await db.execute(
        select(POSConnection).where(POSConnection.vendor_id == vendor.id).order_by(POSConnection.created_at)
    )).scalars().all()
    return [_conn_out(c) for c in conns]


@router.post("/{connection_id}/sync")
async def trigger_sync(
    connection_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger a POS sync (pull connections)."""
    conn = await _own_connection(db, connection_id, vendor)
    log = await pos_sync.run_sync(db, conn, sync_type="manual")
    await db.commit()
    return {"message": "Sync finished", "sync_id": str(log.id), **_log_out(log)}


@router.post("/{connection_id}/push")
async def push_stock(
    connection_id: UUID,
    batch: PushBatch,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """The vendor-side daemon (pos-extension/) posts shelf rows here. Idempotent:
    rows are matched by pos_item_id, then sku."""
    conn = await _own_connection(db, connection_id, vendor)
    rows = [r.model_dump() for r in batch.items]
    log = await pos_sync.run_sync(db, conn, sync_type="push", pushed_rows=rows)
    await db.commit()
    return {"message": "Push processed", "sync_id": str(log.id), **_log_out(log)}


@router.post("/{connection_id}/push-csv")
async def push_csv(
    connection_id: UUID,
    file: UploadFile = File(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Same as /push, from a CSV export of your POS."""
    conn = await _own_connection(db, connection_id, vendor)
    try:
        text = (await file.read()).decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "CSV must be UTF-8 encoded")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise HTTPException(400, "CSV has no data rows")
    log = await pos_sync.run_sync(db, conn, sync_type="push", pushed_rows=rows)
    await db.commit()
    return {"message": "CSV processed", "sync_id": str(log.id), **_log_out(log)}


@router.get("/sync-logs/{connection_id}")
async def get_sync_logs(
    connection_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    await _own_connection(db, connection_id, vendor)
    logs = (await db.execute(
        select(POSSyncLog).where(POSSyncLog.connection_id == connection_id)
        .order_by(POSSyncLog.started_at.desc()).limit(20)
    )).scalars().all()
    return [_log_out(l) for l in logs]


@router.delete("/{connection_id}")
async def disconnect_pos(
    connection_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    conn = await _own_connection(db, connection_id, vendor)
    conn.is_active = False
    conn.auto_sync = False
    conn.api_key = None
    conn.api_secret = None
    remaining = (await db.execute(select(POSConnection.id).where(
        POSConnection.vendor_id == vendor.id, POSConnection.is_active.is_(True), POSConnection.id != conn.id,
    ))).first()
    if not remaining:
        vendor.has_pos_connected = False
        vendor.pos_system_type = None
    await db.commit()
    return {"message": "Connection removed; synced stock stays on your shelf"}

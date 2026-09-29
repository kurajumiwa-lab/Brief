"""
POS Sync — pulls a vendor's shelf out of the system they already run.

Server-side adapters (Square, Shopify) fetch inventory over HTTPS with the
credentials stored on the connection. CSV / manual / custom_api connections
are *push* connections: the vendor's own machine (pos-extension/) posts rows to
`POST /api/pos/{connection_id}/push`. Both paths land in
`stock_engine.upsert_from_pos`, so a re-run never duplicates a shelf line.

Credentials are encrypted at rest with a key derived from SECRET_KEY.
"""

import asyncio
import base64
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.pos_bridge import POSConnection, POSSyncLog
from app.models.stock import StockSource
from app.models.vendor import Vendor
from app.services.stock_engine import upsert_from_pos

log = logging.getLogger("brief.pos_sync")

PULL_TYPES = {"square", "shopify"}
PUSH_TYPES = {"csv", "manual", "custom_api"}


# --- credentials -------------------------------------------------------------

def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt_secret(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return "enc:" + _fernet().encrypt(value.encode()).decode()


def decrypt_secret(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if not value.startswith("enc:"):
        return value  # legacy plaintext row
    try:
        return _fernet().decrypt(value[4:].encode()).decode()
    except InvalidToken:
        return None


# --- adapters ----------------------------------------------------------------

async def fetch_square(access_token: str, location_id: Optional[str]) -> list[dict]:
    """Square catalog items + inventory counts → generic rows."""
    base = "https://connect.squareup.com/v2"
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        cursor = None
        variations: list[tuple[dict, dict]] = []
        while True:
            params = {"types": "ITEM"}
            if cursor:
                params["cursor"] = cursor
            resp = await client.get(f"{base}/catalog/list", headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            for obj in data.get("objects", []):
                item_data = obj.get("item_data", {})
                for variation in item_data.get("variations", []):
                    variations.append((item_data, variation))
            cursor = data.get("cursor")
            if not cursor:
                break

        counts: dict[str, int] = {}
        ids = [v.get("id") for _, v in variations if v.get("id")]
        for i in range(0, len(ids), 100):
            body = {"catalog_object_ids": ids[i:i + 100]}
            if location_id:
                body["location_ids"] = [location_id]
            resp = await client.post(f"{base}/inventory/counts/batch-retrieve", headers=headers, json=body)
            if resp.status_code == 200:
                for c in resp.json().get("counts", []):
                    if c.get("state", "IN_STOCK") == "IN_STOCK":
                        counts[c["catalog_object_id"]] = counts.get(c["catalog_object_id"], 0) + int(float(c.get("quantity", 0)))

    for item_data, variation in variations:
        var_data = variation.get("item_variation_data", {})
        vid = variation.get("id")
        price = var_data.get("price_money", {}).get("amount")
        rows.append({
            "name": f"{item_data.get('name')} - {var_data.get('name')}" if var_data.get("name") else item_data.get("name"),
            "sku": var_data.get("sku"),
            "pos_item_id": vid,
            "quantity": counts.get(vid, 0),
            "unit_price": (price or 0) / 100 if price is not None else None,
            "category": (item_data.get("category") or {}).get("name"),
            "description": item_data.get("description"),
        })
    return rows


async def fetch_shopify(access_token: str, store_domain: str) -> list[dict]:
    """Shopify Admin REST: products/variants with inventory_quantity → generic rows."""
    domain = store_domain if "." in store_domain else f"{store_domain}.myshopify.com"
    url = f"https://{domain}/admin/api/2024-01/products.json"
    headers = {"X-Shopify-Access-Token": access_token}
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        params: dict = {"limit": 250}
        while url:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            for product in resp.json().get("products", []):
                for variant in product.get("variants", []):
                    title = product.get("title")
                    if variant.get("title") and variant["title"] != "Default Title":
                        title = f"{title} - {variant['title']}"
                    rows.append({
                        "name": title,
                        "sku": variant.get("sku") or None,
                        "pos_item_id": str(variant.get("id")),
                        "quantity": int(variant.get("inventory_quantity") or 0),
                        "unit_price": float(variant["price"]) if variant.get("price") else None,
                        "category": product.get("product_type") or None,
                        "tags": product.get("tags") or "",
                    })
            # Cursor pagination lives in the Link header.
            link = resp.headers.get("Link", "")
            url, params = None, {}
            for part in link.split(","):
                if 'rel="next"' in part:
                    url = part[part.find("<") + 1:part.find(">")]
    for r in rows:
        if isinstance(r.get("tags"), str):
            r["tags"] = [t.strip() for t in r["tags"].split(",") if t.strip()]
    return rows


# --- sync runner --------------------------------------------------------------

async def run_sync(db: AsyncSession, conn: POSConnection, sync_type: str = "manual",
                   pushed_rows: Optional[list[dict]] = None) -> POSSyncLog:
    """Run one sync for a connection and record it. Caller commits."""
    vendor = await db.get(Vendor, conn.vendor_id)
    sync_log = POSSyncLog(connection_id=conn.id, sync_type=sync_type, status="running")
    db.add(sync_log)

    try:
        if pushed_rows is not None:
            rows = pushed_rows
        elif conn.pos_type == "square":
            token = decrypt_secret(conn.api_key)
            if not token:
                raise RuntimeError("Square access token missing or unreadable")
            rows = await fetch_square(token, conn.store_id)
        elif conn.pos_type == "shopify":
            token = decrypt_secret(conn.api_key)
            if not token or not conn.store_id:
                raise RuntimeError("Shopify needs an access token and a store domain")
            rows = await fetch_shopify(token, conn.store_id)
        else:
            # Push connections have nothing to pull. Not an error: the log says so.
            sync_log.status = "success"
            sync_log.completed_at = datetime.utcnow()
            sync_log.errors = [f"{conn.pos_type} connections are fed by pos-extension/sync_daemon.py; nothing to pull"]
            conn.last_sync_at = datetime.utcnow()
            return sync_log

        result = await upsert_from_pos(db, vendor, rows, StockSource.POS_SYNC, conn.sync_config or {})
        sync_log.items_processed = result["processed"]
        sync_log.items_added = result["added"]
        sync_log.items_updated = result["updated"]
        sync_log.errors = result["errors"]
        sync_log.status = "partial" if result["errors"] else "success"
        conn.items_synced = (conn.items_synced or 0) + result["added"] + result["updated"]
        conn.last_sync_at = datetime.utcnow()
        if vendor:
            vendor.has_pos_connected = True
    except Exception as exc:  # the log carries the failure; the API does not 500
        log.exception("POS sync failed for connection %s", conn.id)
        sync_log.status = "failed"
        sync_log.errors = [str(exc)]
    sync_log.completed_at = datetime.utcnow()
    return sync_log


async def due_connections(db: AsyncSession) -> list[POSConnection]:
    now = datetime.utcnow()
    conns = (await db.execute(select(POSConnection).where(
        POSConnection.is_active.is_(True), POSConnection.auto_sync.is_(True),
        POSConnection.pos_type.in_(PULL_TYPES),
    ))).scalars().all()
    return [c for c in conns if not c.last_sync_at or c.last_sync_at + timedelta(minutes=c.sync_interval_minutes or 15) <= now]


async def scheduler_loop(session_factory, interval_seconds: int) -> None:
    """Background task started from the app lifespan. Replaces a worker queue
    for the single-container deploy; a multi-instance deploy should run this in
    exactly one process."""
    while True:
        try:
            async with session_factory() as db:
                for conn in await due_connections(db):
                    await run_sync(db, conn, sync_type="scheduled")
                await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("POS scheduler pass failed")
        await asyncio.sleep(interval_seconds)

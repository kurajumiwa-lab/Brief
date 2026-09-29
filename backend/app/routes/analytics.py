"""
Trade analytics (Directive v2.1 §3.5) — the numbers behind a vendor's trading.

    GET /api/analytics/overview?days=90          everything the dashboard opens with
    GET /api/analytics/trend?days=180            value / units over time
    GET /api/analytics/counterparties?days=90    who you trade with, ranked
    GET /api/analytics/categories               what actually moves
    GET /api/analytics/price-position           your prices against the network
    GET /api/analytics/network?days=30          platform context
    GET /api/analytics/counterparty/{handle}    the full history with one vendor
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import analytics_service, discovery

router = APIRouter()


@router.get("/overview")
async def analytics_overview(
    days: int = Query(90, ge=7, le=730),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_service.overview(db, vendor, days)


@router.get("/trend")
async def analytics_trend(
    days: int = Query(90, ge=7, le=730),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return {"days": days, "trend": await analytics_service.trend(db, vendor.id, days)}


@router.get("/counterparties")
async def analytics_counterparties(
    days: int = Query(90, ge=7, le=730),
    limit: int = Query(10, ge=1, le=50),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_service.counterparties(db, vendor.id, days, limit)


@router.get("/categories")
async def analytics_categories(
    days: int = Query(90, ge=7, le=730),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_service.categories(db, vendor.id, days)


@router.get("/price-position")
async def analytics_price_position(
    days: int = Query(90, ge=7, le=730),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Where your shelf sits against the network's, category by category."""
    return await analytics_service.price_position(db, vendor, days)


@router.get("/network")
async def analytics_network(
    days: int = Query(30, ge=7, le=365),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await analytics_service.network_pulse(db, days)


@router.get("/counterparty/{handle}")
async def analytics_counterparty(
    handle: str,
    days: int = Query(180, ge=7, le=730),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Trade history with one counterparty — both directions, by month."""
    other = (await db.execute(
        select(Vendor).where(Vendor.vendor_handle == handle.lstrip("@").lower())
    )).scalars().first()
    if not other:
        raise HTTPException(404, "Vendor not found")
    if other.id == vendor.id:
        raise HTTPException(400, "That's you")
    return await analytics_service.counterparty_detail(db, vendor, other, days)


@router.get("/weights")
async def analytics_weights(vendor: Vendor = Depends(get_current_vendor)):
    """How the discovery score is weighted — shown in the UI so it is not a mystery."""
    return {"factors": discovery.factor_weights()}

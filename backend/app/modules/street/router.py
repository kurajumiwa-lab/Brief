"""HTTP surface for the street: calendar, tables and the story guide.

    GET    /api/street/now                 calendar + guide + the first tables
    GET    /api/street/calendar            season, today's script, next scripts, my routines
    GET    /api/street/context             cached OSM anchors around my H3 block
    GET    /api/street/guide               chapters, next actions, season points
    GET    /api/street/lobbies             open tables, zoomed by H3 for the signed-in person
    POST   /api/street/lobbies             open a table (15 minutes to 8 hours)
    GET    /api/street/lobbies/mine        hosted and joined tables
    POST   /api/street/lobbies/{id}/join   take a seat and receive the handoff
    DELETE /api/street/lobbies/{id}/membership  leave a table
    POST   /api/street/lobbies/{id}/close  host closes the table

Every route needs a signed-in business because the timetable, guide and match
order are personal. The calendar rule itself is deterministic and can be
recomputed by a client with no data. A public phone number is never returned by
a list; only the join response builds the handoff URL.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.street import service
from app.routes.auth import get_current_vendor

router = APIRouter()


class LobbyIn(BaseModel):
    title: str = Field(..., min_length=4, max_length=140)
    intent: str = Field(..., min_length=3, max_length=24)
    zone: str = Field(..., min_length=2, max_length=80)
    details: Optional[str] = Field(None, max_length=1200)
    tags: list[str] = Field(default_factory=list, max_length=8)
    seats: int = Field(2, ge=2, le=50)
    duration_minutes: int = Field(120, ge=15, le=480)
    handoff_channel: str = Field(..., min_length=7, max_length=16)
    handoff_target: str = Field(..., min_length=5, max_length=120)
    geo_lat: Optional[float] = Field(None, ge=-90, le=90)
    geo_lng: Optional[float] = Field(None, ge=-180, le=180)


@router.get("/now")
async def now(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.now_payload(db, vendor)


@router.get("/calendar")
async def calendar(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.calendar(db, vendor)


@router.get("/guide")
async def guide(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.guide(db, vendor)


@router.get("/context")
async def block_context(
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    refresh: bool = Query(False),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Cached OSM anchors around an H3 block (stage, market, school, shop).

    `refresh=true` forces one Overpass attempt; the default is cache-first, so
    a page paint costs one indexed row and no external API call.
    """
    try:
        result = await service.context(db, vendor, lat=lat, lng=lng, refresh=refresh)
        await db.commit()
        return result
    except service.StreetError as exc:
        await db.rollback()
        raise HTTPException(exc.status, str(exc))


@router.get("/lobbies")
async def lobbies(
    intent: Optional[str] = Query(None, max_length=24),
    zone: Optional[str] = Query(None, max_length=80),
    tag: Optional[str] = Query(None, max_length=24),
    limit: int = Query(24, ge=1, le=50),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await service.list_lobbies(
            db, vendor, intent=intent, zone=zone, tag=tag, limit=limit,
            lat=lat, lng=lng,
        )
    except service.StreetError as exc:
        raise HTTPException(exc.status, str(exc))


@router.post("/lobbies", status_code=201)
async def create_lobby(
    data: LobbyIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await service.create_lobby(
            db, vendor,
            title=data.title, intent=data.intent, zone=data.zone, details=data.details,
            tags=data.tags, seats=data.seats, duration_minutes=data.duration_minutes,
            handoff_channel=data.handoff_channel, handoff_target=data.handoff_target,
            geo_lat=data.geo_lat, geo_lng=data.geo_lng,
        )
        await db.commit()
        return result
    except service.StreetError as exc:
        await db.rollback()
        raise HTTPException(exc.status, str(exc))
    except HTTPException:
        await db.rollback()
        raise


@router.get("/lobbies/mine")
async def my_lobbies(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.my_lobbies(db, vendor)


@router.post("/lobbies/{lobby_id}/join")
async def join_lobby(
    lobby_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await service.join_lobby(db, vendor, lobby_id)
        await db.commit()
        return result
    except service.StreetError as exc:
        await db.rollback()
        raise HTTPException(exc.status, str(exc))
    except HTTPException:
        await db.rollback()
        raise


@router.delete("/lobbies/{lobby_id}/membership")
async def leave_lobby(
    lobby_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await service.leave_lobby(db, vendor, lobby_id)
        await db.commit()
        return result
    except service.StreetError as exc:
        await db.rollback()
        raise HTTPException(exc.status, str(exc))


@router.post("/lobbies/{lobby_id}/close")
async def close_lobby(
    lobby_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await service.close_lobby(db, vendor, lobby_id)
        await db.commit()
        return result
    except service.StreetError as exc:
        await db.rollback()
        raise HTTPException(exc.status, str(exc))

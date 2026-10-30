"""The guide: suggestions, the shelf map, and what the network cannot find.

Every route here is a read except two small beacons, and none of them can write
anything a person owns. The guide suggests; the person decides.

**What it will never do**, and the tests enforce:

  · return an item that is not on a shelf right now (no invented stock);
  · label a declared shelf map as if it were learned from behaviour;
  · say what one individual searched for — demand is floored at three.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.routes.auth import get_current_vendor
from app.services import guide as guide_service

router = APIRouter()


async def _viewer(vendor: Vendor = Depends(get_current_vendor)):
    """Who is asking.

    The whole application sits behind ``VendorOnlyMiddleware``, so the guide is
    an in-app feature and the caller is always a member. That matters for what
    it may show: suggestions exclude the caller's own shelf, and a beacon is
    attributed rather than anonymous.
    """
    return vendor


# ── rung 0 ───────────────────────────────────────────────────────────────────


@router.get("/suggest")
async def suggest(
    q: str = Query("", max_length=120),
    limit: int = Query(8, ge=1, le=20),
    viewer: Vendor = Depends(_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Typeahead over the shelves and the live catalogue.

    Returns shelves first when the words name one, then item names that exist
    and have stock right now. Never a name that cannot be delivered.
    """
    return await guide_service.suggest(db, q, limit=limit, viewer=viewer)


# ── rung 2 ───────────────────────────────────────────────────────────────────


@router.get("/parse")
async def parse(
    q: str = Query(..., min_length=1, max_length=200),
    viewer: Vendor = Depends(_viewer),
    db: AsyncSession = Depends(get_db),
):
    """What the guide understood, and what it did not.

    ``leftover`` is returned verbatim so the UI can be honest: "I used the price
    and the distance; I ignored 'urgent'." An assistant that silently drops what
    it did not understand is worse than one that has no opinion.
    """
    parsed = guide_service.parse_query(q)
    named_by_grammar = parsed.shelf
    await guide_service.resolve_shelf(db, parsed, viewer=viewer)
    return {
        "query": q,
        "filters": parsed.as_filters(),
        "keywords": parsed.keywords,
        "shelf": parsed.shelf,
        # "grammar" — the sentence named the shelf; "catalogue" — a live item
        # did; "none" — nothing did, and no shelf is claimed.
        "shelf_basis": (
            "none" if not parsed.shelf else ("grammar" if named_by_grammar else "catalogue")
        ),
        "understood": parsed.understood(),
    }


# ── rung 1 ───────────────────────────────────────────────────────────────────


@router.get("/next")
async def next_shelf(
    from_shelf: str = Query(..., alias="from", max_length=40),
    viewer: Vendor = Depends(_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Where to go after this shelf — observed if there is evidence, otherwise
    the shop's own signage. ``basis`` says which, always."""
    return await guide_service.next_shelf(db, from_shelf, viewer=viewer)


# ── demand ───────────────────────────────────────────────────────────────────


@router.get("/demand")
async def demand(
    days: int = Query(7, ge=1, le=90),
    minimum: int = Query(3, ge=3, le=50),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """What people looked for and the network could not supply.

    Public, because a gap on the shelves is information the whole network
    benefits from and none of it belongs to anybody. Floored at three searches:
    below that, "somebody asked" starts to identify who.
    """
    return await guide_service.demand(db, days=days, minimum=minimum, limit=limit)


# ── beacons ──────────────────────────────────────────────────────────────────


class SearchBeacon(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    shelf: Optional[str] = Field(None, max_length=40)
    result_count: int = Field(0, ge=0, le=100000)


@router.post("/searched", status_code=202)
async def searched(
    payload: SearchBeacon,
    viewer: Vendor = Depends(_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Record that a search happened and whether it found anything.

    Deliberately quiet (202, empty body): the client must never wait for the
    guide to finish writing before showing results.
    """
    await guide_service.record_search(
        db,
        query=payload.query,
        shelf=payload.shelf,
        result_count=payload.result_count,
        viewer=viewer,
    )
    return {"recorded": True}


class VisitBeacon(BaseModel):
    shelf: str = Field(max_length=40)


@router.post("/visited", status_code=202)
async def visited(
    payload: VisitBeacon,
    viewer: Vendor = Depends(_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Record a shelf opening. Anonymous visitors are counted nowhere."""
    await guide_service.record_visit(db, shelf=payload.shelf, viewer=viewer)
    return {"recorded": viewer is not None}


@router.get("/shelves")
async def shelves():
    """The nine shelves, in the order the home feed shows them.

    Exposed so the client's quick suggestions and the server's typeahead cannot
    drift apart; a test asserts they match.
    """
    return {"shelves": list(guide_service.SHELVES)}

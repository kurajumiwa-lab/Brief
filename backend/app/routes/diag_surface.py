"""TEMPORARY diagnostic — runs the surface feed with a real vendor and returns
the traceback of any failure. Removed as soon as the feed is fixed."""

import traceback

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.database import get_db
from app.models.vendor import Vendor
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.get("/diag/surface")
async def diag_surface(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Vendor).limit(1))
    vendor = res.scalars().first()
    if vendor is None:
        return {"ok": False, "error": "no vendors in db"}
    from app.routes.surface import surface_feed, price_index
    try:
        out = await surface_feed(vendor=vendor, db=db)
        idx = await price_index(vendor=vendor, db=db)
        return JSONResponse({
            "ok": True,
            "cards": len(out["cards"]),
            "kinds": sorted(set(c["kind"] for c in out["cards"])),
            "first_cards": [{"kind": c["kind"], "id": c["id"]} for c in out["cards"][:6]],
            "index_rows": len(idx["rows"]),
        })
    except Exception:
        return JSONResponse({"ok": False, "traceback": traceback.format_exc()})

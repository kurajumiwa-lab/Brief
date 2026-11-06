"""Free blueprints API.

    GET    /api/blueprints                         public library (no account)
    GET    /api/blueprints/{key}                   public: the full steps (no account)
    GET    /api/blueprints/mine/progress           signed in: my started blueprints
    POST   /api/blueprints/{key}/start             signed in: start one (free, idempotent)
    POST   /api/blueprints/{key}/steps/{step}      signed in: tick a step done
    DELETE /api/blueprints/{key}/steps/{step}      signed in: untick a step
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.blueprints import service
from app.modules.blueprints.catalogue import BY_KEY
from app.routes.auth import get_current_vendor

router = APIRouter()


@router.get("")
async def library():
    return {"blueprints": service.library()}


@router.get("/mine/progress")
async def mine(vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    return {"started": await service.progress(db, vendor.id)}


@router.get("/{key}")
async def one(key: str):
    bp = BY_KEY.get(key)
    if bp is None:
        raise HTTPException(status_code=404, detail="No blueprint with that name.")
    return {**{k: bp[k] for k in ("key", "title", "sector", "summary")}, "cost": "Free",
            "steps": [{"key": s["key"], "title": s["title"], "detail": s["detail"]} for s in bp["steps"]]}


@router.post("/{key}/start")
async def start(key: str, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    created = await service.start(db, vendor.id, key)
    await db.commit()
    return {"key": key, "started": True, "created": created}


@router.post("/{key}/steps/{step}")
async def tick(key: str, step: str, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    await service.set_step(db, vendor.id, key, step, done=True)
    await db.commit()
    return {"key": key, "step": step, "done": True}


@router.delete("/{key}/steps/{step}")
async def untick(key: str, step: str, vendor: Vendor = Depends(get_current_vendor), db: AsyncSession = Depends(get_db)):
    await service.set_step(db, vendor.id, key, step, done=False)
    await db.commit()
    return {"key": key, "step": step, "done": False}

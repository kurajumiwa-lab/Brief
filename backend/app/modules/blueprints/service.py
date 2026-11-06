"""Free blueprints: start, progress, and the next step for the Today window."""

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.blueprints.catalogue import BLUEPRINTS, BY_KEY, step_keys
from app.modules.blueprints.models import BlueprintStart, BlueprintStepDone


def _bad(message: str, code: int = 400) -> HTTPException:
    return HTTPException(status_code=code, detail=message)


def _blueprint(key: str) -> dict:
    bp = BY_KEY.get(key)
    if bp is None:
        raise _bad("No blueprint with that name.", 404)
    return bp


def _check_step(bp: dict, step_key: str) -> None:
    if step_key not in step_keys(bp):
        raise _bad("That step is not part of this blueprint.", 404)


def library() -> list[dict]:
    """Public list: everything a person needs to decide, without the steps."""
    return [{"key": b["key"], "title": b["title"], "sector": b["sector"], "summary": b["summary"],
             "step_count": len(b["steps"]), "cost": "Free"} for b in BLUEPRINTS]


async def _started_keys(db: AsyncSession, vendor_id: uuid.UUID) -> list[str]:
    return list((await db.execute(select(BlueprintStart.blueprint_key).where(
        BlueprintStart.vendor_id == vendor_id).order_by(BlueprintStart.started_at))).scalars().all())


async def _done_steps(db: AsyncSession, vendor_id: uuid.UUID, key: str) -> set[str]:
    return set((await db.execute(select(BlueprintStepDone.step_key).where(
        BlueprintStepDone.vendor_id == vendor_id, BlueprintStepDone.blueprint_key == key))).scalars().all())


async def start(db: AsyncSession, vendor_id: uuid.UUID, key: str) -> bool:
    _blueprint(key)
    existing = (await db.execute(select(BlueprintStart).where(
        BlueprintStart.vendor_id == vendor_id, BlueprintStart.blueprint_key == key))).scalar_one_or_none()
    if existing is not None:
        return False
    db.add(BlueprintStart(vendor_id=vendor_id, blueprint_key=key))
    await db.flush()
    return True


async def progress(db: AsyncSession, vendor_id: uuid.UUID) -> list[dict]:
    out = []
    for key in await _started_keys(db, vendor_id):
        bp = _blueprint(key)
        done = await _done_steps(db, vendor_id, key)
        out.append({
            "key": key, "title": bp["title"], "sector": bp["sector"],
            "steps": [{"key": s["key"], "title": s["title"], "detail": s["detail"], "done": s["key"] in done}
                      for s in bp["steps"]],
            "done_count": len(done), "total": len(bp["steps"]),
        })
    return out


async def set_step(db: AsyncSession, vendor_id: uuid.UUID, key: str, step_key: str, done: bool) -> None:
    bp = _blueprint(key)
    _check_step(bp, step_key)
    started = (await db.execute(select(BlueprintStart).where(
        BlueprintStart.vendor_id == vendor_id, BlueprintStart.blueprint_key == key))).scalar_one_or_none()
    if started is None:
        raise _bad("Start this blueprint before ticking its steps.", 409)
    row = (await db.execute(select(BlueprintStepDone).where(
        BlueprintStepDone.vendor_id == vendor_id, BlueprintStepDone.blueprint_key == key,
        BlueprintStepDone.step_key == step_key))).scalar_one_or_none()
    if done and row is None:
        db.add(BlueprintStepDone(vendor_id=vendor_id, blueprint_key=key, step_key=step_key))
    elif not done and row is not None:
        await db.delete(row)
    await db.flush()


async def next_steps(db: AsyncSession, vendor_id: uuid.UUID) -> list[dict]:
    """The first step not yet done, for each started blueprint. Feeds the Today window."""
    out = []
    for key in await _started_keys(db, vendor_id):
        bp = BY_KEY.get(key)
        if bp is None:
            continue
        done = await _done_steps(db, vendor_id, key)
        for step in bp["steps"]:
            if step["key"] not in done:
                out.append({"key": f"bp:{key}:{step['key']}", "label": f"{bp['title']}: {step['title']}",
                            "why": step["detail"], "link": f"/templates/{key}",
                            "blueprint": key, "step": step["key"]})
                break
    return out

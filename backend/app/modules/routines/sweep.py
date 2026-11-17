"""Hourly sweep that publishes due recurring routines.

Registered by both scheduler owners (`main.py` and `app/worker.py`), the same
as the outbox and standing loops. Every pass is idempotent; a missed pass is
caught up by the next one because the condition is "the lead window is open",
not "exactly one hour has passed".
"""

import asyncio
import logging

from app.config import settings
from app.modules.corridor_tasks import service as task_service
from app.modules.routines import service

log = logging.getLogger("brief.routines.sweep")


async def run_once(session_factory) -> dict:
    """One pass in its own session — used by the loop and by tests."""
    async with session_factory() as db:
        routines = await service.sweep_due(db)
        tasks = await task_service.expire_stale(db)
        await db.commit()
    if routines or tasks["expired"] or tasks["released"]:
        log.info("routine sweep: %d published; tasks: %d expired, %d released",
                 len(routines), tasks["expired"], tasks["released"])
    return {"published": routines, "tasks": tasks}


async def scheduler_loop(session_factory, interval_seconds: int | None = None) -> None:
    interval = interval_seconds or settings.ROUTINE_SWEEP_INTERVAL
    log.info("🔁 recurring routine sweep: every %ss", interval)
    while True:
        try:
            await run_once(session_factory)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("routine sweep pass failed")
        await asyncio.sleep(interval)

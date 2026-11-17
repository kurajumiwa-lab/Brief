"""Hourly corridor price index refresh.

Registered by both scheduler owners (`main.py` and `app/worker.py`). Every pass
replaces the snapshot inside one transaction. A missed pass is harmless: the
next one recomputes the same 45-day window from source rows.
"""

import asyncio
import logging

from app.config import settings
from app.modules.price_index import service

log = logging.getLogger("brief.price_index.sweep")


async def run_once(session_factory) -> dict:
    async with session_factory() as db:
        result = await service.refresh_indices(db)
        await db.commit()
    log.info("price index: %d points → %d scopes", result["points"], result["rows_written"])
    return result


async def scheduler_loop(session_factory, interval_seconds: int | None = None) -> None:
    interval = interval_seconds or settings.PRICE_INDEX_REFRESH_INTERVAL
    log.info("📊 corridor price index refresh: every %ss", interval)
    while True:
        try:
            await run_once(session_factory)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("price index refresh failed")
        await asyncio.sleep(interval)

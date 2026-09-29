"""
Scheduler process for multi-worker / multi-instance deploys.

    RUN_SCHEDULER=false uvicorn app.main:app --workers 4     # the API
    python -m app.worker                                     # exactly one of these

Runs the same loop the single-container API runs in-process: POS
scheduled syncs, stock-hold expiry and event reminders.
"""

import asyncio
import logging

from app.config import settings
from app.database import async_session, engine
from app.services import pos_sync

log = logging.getLogger("brief.worker")


async def main() -> None:
    logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log.info("⏱  Brief_ worker v%s — every %ss", settings.VERSION, settings.POS_SYNC_INTERVAL)
    try:
        await pos_sync.scheduler_loop(async_session, settings.POS_SYNC_INTERVAL)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

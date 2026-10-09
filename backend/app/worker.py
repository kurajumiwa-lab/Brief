"""
Scheduler process for multi-worker / multi-instance deploys.

    RUN_SCHEDULER=false uvicorn app.main:app --workers 4     # the API
    python -m app.worker                                     # exactly one of these

Runs the same loops the single-container API runs in-process: POS scheduled
syncs, stock-hold expiry, event reminders, and the payments housekeeping
(intent expiry, chama defaults, daily PSP ↔ ledger reconciliation).
"""

import asyncio
import logging

from app.config import settings
from app.database import async_session, engine
from app.platform import event_outbox
from app.services import payment_worker, pos_sync

log = logging.getLogger("brief.worker")


async def main() -> None:
    logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log.info("⏱  Brief_ worker v%s — POS every %ss, payments every 60s",
             settings.VERSION, settings.POS_SYNC_INTERVAL)
    pos_task = asyncio.create_task(pos_sync.scheduler_loop(async_session, settings.POS_SYNC_INTERVAL))
    payments_task = asyncio.create_task(payment_worker.scheduler_loop(async_session))
    outbox_task = asyncio.create_task(event_outbox.scheduler_loop(async_session))
    try:
        await asyncio.gather(pos_task, payments_task, outbox_task)
    finally:
        for task in (pos_task, payments_task, outbox_task):
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

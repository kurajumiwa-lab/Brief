"""The standing clock — expiry and renewal reminders (v2.11).

Two jobs, both idempotent, both safe to run as often as the loop likes:

    expire_due      flip claims whose printed date has passed. Runs on a
                    schedule, but nothing in the app waits for it — the
                    passport computes the same answer from `expires_on`.
    remind_expiring warn owners 30, 14 and 7 days before a document lapses,
                    once per window (windows are recorded on the claim).

Registered by both scheduler owners (`main.py` in-process and `app/worker.py`
for multi-worker deploys), the same as the outbox and payments loops.
"""

import asyncio
import logging

from app.config import settings
from app.modules.standing import service

log = logging.getLogger("brief.standing.sweep")

expire_due = service.expire_due
remind_expiring = service.remind_expiring


async def run_once(session_factory) -> dict:
    """One pass, in its own session — used by the loop and by tests."""
    async with session_factory() as db:
        expired = await service.expire_due(db)
    async with session_factory() as db:
        reminded = await service.remind_expiring(db)
    if expired or reminded:
        log.info("standing sweep: %d expired, %d reminders", expired, reminded)
    return {"expired": expired, "reminded": reminded}


async def scheduler_loop(session_factory, interval_seconds: int | None = None) -> None:
    interval = interval_seconds or settings.STANDING_SWEEP_INTERVAL
    log.info("📄 standing sweep: every %ss", interval)
    while True:
        try:
            await run_once(session_factory)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("standing sweep pass failed")
        await asyncio.sleep(interval)

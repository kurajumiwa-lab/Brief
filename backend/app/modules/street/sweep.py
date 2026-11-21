"""The street's scheduled pass.

Registered by both scheduler owners (`main.py` in-process and `app/worker.py`),
the same as the routine and price-index loops. Every pass is idempotent:

* a due table is marked `expired` exactly once;
* a weekday script is stamped in `street_broadcasts` at most once per local
  day, by the unique `(script_key, run_date)` pair.

The weekday prompt itself is still deterministic, so a missed pass never hides
Monday. The stamp only says the official slot actually opened. No message is
sent to a person and no payment is involved.
"""

import asyncio
import logging
from datetime import datetime

from app.config import settings
from app.modules.street import service

log = logging.getLogger("brief.street.sweep")


async def run_once(session_factory, now: datetime | None = None) -> dict:
    """One pass in its own transaction — used by the loop and by tests."""
    async with session_factory() as db:
        expired = await service.expire_due(db, now)
        published = await service.publish_due(db, now)
        await db.commit()
    if expired or published:
        log.info("street sweep: %d tables expired, %d script(s) stamped", expired, published)
    return {"expired": expired, "published": published}


async def scheduler_loop(session_factory, interval_seconds: int | None = None) -> None:
    interval = interval_seconds or getattr(settings, "STREET_SWEEP_INTERVAL", 60)
    log.info("🚦 street sweep: every %ss", interval)
    while True:
        try:
            await run_once(session_factory)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("street sweep pass failed")
        await asyncio.sleep(interval)

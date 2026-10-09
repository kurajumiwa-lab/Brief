"""Transactional outbox — the module-to-module feed, written in the same commit.

The locked decision: integrations ride a transactional outbox and background
workers, not in-memory side effects and not a message broker (brokers are
postponed until scale demands one). A module that changes canonical state
calls `emit(db, topic, payload)` *inside* its transaction; the row commits
with the change or not at all. A worker later drains the table and marks
events processed.

Today the drain is a durable no-op: it records the fact of processing so the
table doubles as the raw event history that analytics read models and trust
metrics are rebuilt from (locked decisions: analytics and trust). When the
first real consumers arrive — notifications, reputation — they hang off
`drain`, which is already the single choke point.

Owns exactly one table: `event_outbox`. Nobody else writes it.
"""

import asyncio
import logging
from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, String, select, update
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Base

log = logging.getLogger("brief.outbox")


class OutboxEvent(Base):
    __tablename__ = "event_outbox"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    topic = Column(String(80), nullable=False, index=True)
    payload = Column(JSONB, nullable=False, server_default=sa_text("'{}'::jsonb"), default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    processed_at = Column(DateTime, nullable=True, index=True)


def emit(db: AsyncSession, topic: str, payload: dict | None = None) -> OutboxEvent:
    """Stage a market fact inside the caller's transaction. The caller owns
    the commit — that is the whole point: event and state change are atomic."""
    row = OutboxEvent(topic=topic, payload=payload or {})
    db.add(row)
    return row


async def drain(session_factory, batch: int = 200) -> int:
    """Process up to `batch` unprocessed events, oldest first, and mark them
    processed. FOR UPDATE SKIP LOCKED lets several workers share the drain
    without double-talking one event. Returns how many were processed."""
    async with session_factory() as db:
        async with db.begin():
            rows = (await db.execute(
                select(OutboxEvent.id)
                .where(OutboxEvent.processed_at.is_(None))
                .order_by(OutboxEvent.created_at.asc(), OutboxEvent.id.asc())
                .limit(batch)
                .with_for_update(skip_locked=True)
            )).scalars().all()
            if not rows:
                return 0
            await db.execute(
                update(OutboxEvent)
                .where(OutboxEvent.id.in_(rows))
                .values(processed_at=datetime.utcnow())
            )
            return len(rows)


async def unprocessed_count(session_factory) -> int:
    async with session_factory() as db:
        rows = (await db.execute(
            select(OutboxEvent.id).where(OutboxEvent.processed_at.is_(None))
        )).scalars().all()
        return len(rows)


async def scheduler_loop(session_factory, interval_seconds: int = 30) -> None:
    """Background drain. Runs in-process on single-container deploys and in
    `python -m app.worker` when the API runs web-only."""
    while True:
        try:
            n = await drain(session_factory)
            if n:
                log.info("outbox: processed %d events", n)
        except Exception:
            log.exception("outbox: drain pass failed")
        await asyncio.sleep(interval_seconds)

"""Biashara Score events for money-related behaviour (v2.5).

Reuses the existing governance score machinery (append-only
``BiasharaScoreEvent`` rows anchored to the active ``biashara_score`` rule
version). The custody layer records three event types:

* ``pick_completed``      +5 — a Lock pick was paid and settled (already in
  the published rule configuration).
* ``chama_loan_repaid``   +5 — repaid a peer loan on time.
* ``chama_loan_defaulted`` −15 — a peer loan was marked defaulted.
* ``murabaha_settled``     +5 — a cost-plus advance paid in full on time.
* ``murabaha_defaulted``  −15 — a cost-plus advance passed its due date.

If no score rule is active the event is skipped (logged, never fatal) —
money movement must never be blocked by a missing rule.
"""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.governance import BiasharaScoreEvent, RuleVersion

log = logging.getLogger("brief.biashara")

# Points are the same magnitudes the published rule uses for its event types.
SCORE_EVENT_POINTS = {
    "pick_completed": 5,
    "chama_loan_repaid": 5,
    "chama_loan_defaulted": -15,
    # v2.6 halal-trade
    "murabaha_settled": 5,
    "murabaha_defaulted": -15,
}


async def active_score_rule(db: AsyncSession):
    from datetime import datetime

    rule = (await db.execute(
        select(RuleVersion).where(
            RuleVersion.rule_group == "biashara_score",
            RuleVersion.effective_from <= datetime.utcnow(),
        ).order_by(RuleVersion.version.desc()).limit(1)
    )).scalar_one_or_none()
    return rule


async def vendor_score(db: AsyncSession, vendor_id: uuid.UUID) -> int:
    """Current 180-day Biashara Score (same window the API publishes)."""
    from datetime import datetime, timedelta

    from sqlalchemy import func

    total = (await db.execute(
        select(func.coalesce(func.sum(BiasharaScoreEvent.points), 0)).where(
            BiasharaScoreEvent.vendor_id == vendor_id,
            BiasharaScoreEvent.created_at >= datetime.utcnow() - timedelta(days=180),
        )
    )).scalar_one()
    return int(total or 0)


async def record_biashara_event(
    db: AsyncSession,
    vendor_id: uuid.UUID,
    event_type: str,
    *,
    reference: str,
    explanation: str,
    points: int | None = None,
) -> BiasharaScoreEvent | None:
    """Record one score event (duplicate references are absorbed silently —
    a webhook retry must not double-count). Returns the event, or None."""
    if points is None:
        points = SCORE_EVENT_POINTS.get(event_type)
    if points is None or points == 0:
        raise ValueError(f"Unknown score event {event_type!r}")

    rule = await active_score_rule(db)
    if rule is None:
        log.info("no active biashara rule; skipping %s for %s", event_type, vendor_id)
        return None

    try:
        async with db.begin_nested():
            event = BiasharaScoreEvent(
                vendor_id=vendor_id,
                event_type=event_type,
                points=points,
                reference=str(reference)[:200],
                rule_version_id=rule.id,
                explanation=explanation,
            )
            db.add(event)
            await db.flush()
        return event
    except IntegrityError:
        # Duplicate (vendor_id, event_type, reference): already recorded.
        return None

"""Post-trade ratings: who may rate what, when a trade is final, and recent supplier stats.

Rules (see models.py for the record shape):
  * A client rates a supplier 1-5 stars, only once the trade is done (appointment completed,
    stock movement received).
  * A supplier records failed or fraud, only about a trade that went wrong, and only about
    the client. It never records a star rating.
  * One rating per party per trade. A rating is final: nothing edits or deletes it here.
  * With POST_TRADE_RATING_GATE_ENABLED on, a done trade is FINAL only when it has a rating.
    Final is a separate fact from the trade's status, so no status is ever changed here.
"""

import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockMovement
from app.models.vendor import Vendor
from app.modules.schedule.models import Appointment
from app.modules.ratings import scoring
from app.modules.ratings.models import OUTCOMES, SUBJECT_KINDS, PostTradeRating

# A trade is done (a client may rate it as completed) in these states.
DONE_STATES = {"appointment": ("completed",), "movement": ("received",)}
# A supplier may record failed/fraud about a trade in these states.
FAILABLE_STATES = {
    "appointment": ("confirmed", "completed", "no_show"),
    "movement": ("shipped", "received", "cancelled"),
}


async def _subject(db: AsyncSession, kind: str, sid: uuid.UUID) -> dict:
    if kind == "appointment":
        row = await db.get(Appointment, sid)
        if row is None:
            raise HTTPException(404, "Trade not found")
        return {"supplier": row.vendor_id, "client": row.client_vendor_id, "status": row.status}
    row = await db.get(StockMovement, sid)
    if row is None:
        raise HTTPException(404, "Trade not found")
    return {"supplier": row.from_vendor_id, "client": row.to_vendor_id, "status": row.status}


def _validate_kind_outcome(kind: str, outcome: str) -> None:
    if kind not in SUBJECT_KINDS:
        raise HTTPException(422, "subject_kind must be appointment or movement")
    if outcome not in OUTCOMES:
        raise HTTPException(422, "outcome must be completed, failed or fraud")


async def record_rating(
    db: AsyncSession,
    rater: Vendor,
    *,
    subject_kind: str,
    subject_id: uuid.UUID,
    outcome: str,
    stars: Optional[int] = None,
    note: Optional[str] = None,
) -> PostTradeRating:
    _validate_kind_outcome(subject_kind, outcome)
    subj = await _subject(db, subject_kind, subject_id)

    if rater.id == subj["supplier"]:
        role = "supplier"
    elif subj["client"] is not None and rater.id == subj["client"]:
        role = "client"
    else:
        # Not a party to this trade. Say the same thing as a missing trade, so none is revealed.
        raise HTTPException(404, "Trade not found")

    if role == "client":
        if outcome != "completed" or stars is None:
            raise HTTPException(422, "A client rates a completed trade with 1 to 5 stars")
        if subj["status"] not in DONE_STATES[subject_kind]:
            raise HTTPException(409, "You can rate this trade once it is complete")
    else:
        if outcome not in ("failed", "fraud") or stars is not None:
            raise HTTPException(422, "A supplier records only a failed or fraudulent trade, with no stars")
        if subj["status"] not in FAILABLE_STATES[subject_kind]:
            raise HTTPException(409, "This trade has not reached a point that can be recorded as failed")

    taken = (await db.execute(select(PostTradeRating.id).where(
        PostTradeRating.subject_kind == subject_kind,
        PostTradeRating.subject_id == subject_id,
        PostTradeRating.rater_role == role,
    ))).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(409, "You have already rated this trade")

    text = (note or "").strip()[:500] or None
    row = PostTradeRating(
        subject_kind=subject_kind,
        subject_id=subject_id,
        supplier_vendor_id=subj["supplier"],
        client_vendor_id=subj["client"],
        rater_vendor_id=rater.id,
        rater_role=role,
        outcome=outcome,
        stars=stars if role == "client" else None,
        note=text,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    await db.commit()
    return row


async def is_final(db: AsyncSession, subject_kind: str, subject_id: uuid.UUID) -> bool:
    """A trade is final once any party's rating is recorded."""
    return bool((await db.execute(select(exists().where(
        PostTradeRating.subject_kind == subject_kind,
        PostTradeRating.subject_id == subject_id,
    )))).scalar())


async def status_for(db: AsyncSession, viewer: Vendor, subject_kind: str, subject_id: uuid.UUID) -> dict:
    """What this party can do about one trade, and whether it is final. Non-parties get a 404."""
    _validate_kind_outcome(subject_kind, "completed")
    subj = await _subject(db, subject_kind, subject_id)
    if viewer.id == subj["supplier"]:
        role = "supplier"
    elif subj["client"] is not None and viewer.id == subj["client"]:
        role = "client"
    else:
        raise HTTPException(404, "Trade not found")

    rows = (await db.execute(select(PostTradeRating).where(
        PostTradeRating.subject_kind == subject_kind,
        PostTradeRating.subject_id == subject_id,
    ))).scalars().all()
    mine = [r for r in rows if r.rater_role == role]

    if role == "client":
        can_rate = (not mine) and subj["status"] in DONE_STATES[subject_kind]
        rate_as = "client" if can_rate else None
    else:
        can_rate = (not mine) and subj["status"] in FAILABLE_STATES[subject_kind]
        rate_as = "supplier" if can_rate else None

    return {
        "subject_kind": subject_kind,
        "subject_id": str(subject_id),
        "trade_status": subj["status"],
        "my_role": role,
        "final": bool(rows),
        "rated_by_me": bool(mine),
        "can_rate_as": rate_as,
        "ratings": [
            {"rater_role": r.rater_role, "outcome": r.outcome, "stars": r.stars,
             "note": r.note, "created_at": r.created_at.isoformat()}
            for r in rows
        ],
    }


async def supplier_stats(db: AsyncSession, supplier_ids: list, days: int = scoring.RECENT_DAYS) -> dict:
    """Recent client star ratings per supplier: {vendor_id: {"rated": n, "avg_stars": x or None}}."""
    ids = [i for i in supplier_ids if i is not None]
    out = {i: {"rated": 0, "avg_stars": None} for i in ids}
    if not ids:
        return out
    since = datetime.utcnow() - timedelta(days=days)
    rows = (await db.execute(select(PostTradeRating.supplier_vendor_id, PostTradeRating.stars).where(
        PostTradeRating.supplier_vendor_id.in_(ids),
        PostTradeRating.rater_role == "client",
        PostTradeRating.outcome == "completed",
        PostTradeRating.stars.is_not(None),
        PostTradeRating.created_at >= since,
    ))).all()
    totals: dict = {}
    for vid, stars in rows:
        n, s = totals.get(vid, (0, 0))
        totals[vid] = (n + 1, s + int(stars))
    for vid, (n, s) in totals.items():
        out[vid] = {"rated": n, "avg_stars": round(s / n, 2)}
    return out

"""Post-trade ratings: who may rate what, when a trade is final, and recent supplier stats.

Rules (see models.py for the record shape):
  * A client rates a supplier 1-5 stars, only once the trade is done (appointment completed,
    stock movement received).
  * A supplier records failed or fraud, only about a trade that went wrong, and only about
    the client. It never records a star rating.
  * One rating per party per trade. A rating is final: nothing edits or deletes it here.
  * With POST_TRADE_RATING_GATE_ENABLED on, a done trade is FINAL when it has a rating, or when
    its 14-day rating window closed unrated (see finalise_stranded_trades). Final is a separate
    fact from the trade's status, so no status is ever changed here.
"""

import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockMovement
from app.models.vendor import Vendor
from app.modules.office.models import Office, OfficeMember, OfficePartner
from app.modules.schedule.models import Appointment
from app.modules.ratings import scoring
from app.config import settings
from app.modules.ratings.models import OUTCOMES, SUBJECT_KINDS, PostTradeRating, TradeFinalisation

# A trade may be rated for this long after it is done. Then its window closes: no rating can be
# added, and if none was added the trade is recorded as final with no rating.
RATING_WINDOW = timedelta(days=14)

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


def _digits(phone: Optional[str]) -> str:
    return re.sub(r"\D", "", phone or "")[-9:]


async def conflict(db: AsyncSession, rater: Vendor, supplier_id, client_id) -> Optional[str]:
    """Why this party may not rate this trade, or None.

    1. A business cannot rate its own booking (supplier and client are the same office).
    2. Nobody rates a trade with a business that shares their contact number. That is the one
       reliable signal here that two accounts belong to one person.
    3. Nobody rates a trade with a party on the same team: an active member of an office that both
       accounts belong to (owner included), or of an office that is an active partner team of one
       of theirs (Fluid Teams).
    """
    if client_id is not None and supplier_id == client_id:
        return "A business cannot rate its own booking."
    other_id = client_id if rater.id == supplier_id else supplier_id
    if other_id is None:
        return None
    if await _share_office(db, rater.id, other_id):
        return "You cannot rate a trade with a member of your own team."
    other = await db.get(Vendor, other_id)
    mine, theirs = _digits(rater.phone), _digits(other.phone if other else None)
    if mine and theirs and mine == theirs:
        return "You cannot rate a trade with a business that shares your contact number."
    return None


async def _share_office(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    """True when both accounts are active members of the same active office."""
    async def active_office_ids(vendor_id: uuid.UUID) -> set:
        rows = await db.execute(select(OfficeMember.office_id)
                                .join(Office, Office.id == OfficeMember.office_id)
                                .where(OfficeMember.vendor_id == vendor_id,
                                       OfficeMember.status == "active", Office.status == "active"))
        return set(rows.scalars().all())
    mine, theirs = await active_office_ids(a), await active_office_ids(b)
    if mine & theirs:
        return True
    # Partner teams (Fluid Teams): a member of one active office cannot rate a member of an
    # office that is an active partner of theirs.
    if not mine or not theirs:
        return False
    linked = (await db.execute(select(OfficePartner.id).where(
        OfficePartner.status == "active",
        or_(and_(OfficePartner.office_id.in_(mine), OfficePartner.partner_office_id.in_(theirs)),
            and_(OfficePartner.office_id.in_(theirs), OfficePartner.partner_office_id.in_(mine))),
    ).limit(1))).scalar_one_or_none()
    return linked is not None


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

    blocked = await conflict(db, rater, subj["supplier"], subj["client"])
    if blocked:
        raise HTTPException(403, blocked)

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

    if await _window_closed(db, subject_kind, subject_id):
        raise HTTPException(409, "The rating window for this trade has closed")

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


async def _window_closed(db: AsyncSession, subject_kind: str, subject_id: uuid.UUID) -> bool:
    return bool((await db.execute(select(exists().where(
        TradeFinalisation.subject_kind == subject_kind,
        TradeFinalisation.subject_id == subject_id,
    )))).scalar())


async def is_final(db: AsyncSession, subject_kind: str, subject_id: uuid.UUID) -> bool:
    """A trade is final once a party has rated it, or its rating window has closed unrated."""
    rated = (await db.execute(select(exists().where(
        PostTradeRating.subject_kind == subject_kind,
        PostTradeRating.subject_id == subject_id,
    )))).scalar()
    return bool(rated) or await _window_closed(db, subject_kind, subject_id)


async def finalise_stranded_trades(db: AsyncSession, now: Optional[datetime] = None) -> int:
    """Close the rating window of done trades that passed the window with no rating.

    Off unless POST_TRADE_RATING_GATE_ENABLED is on. Writes only trade_finalisations rows. It
    changes no trade status, no completed count, and no rank. Returns how many were closed.
    """
    if not settings.POST_TRADE_RATING_GATE_ENABLED:
        return 0
    cutoff = (now or datetime.utcnow()) - RATING_WINDOW
    closed = 0
    for kind, model, done_status, done_at in (
        ("appointment", Appointment, "completed", Appointment.ends_at),
        ("movement", StockMovement, "received", StockMovement.completed_at),
    ):
        rated = select(PostTradeRating.id).where(
            PostTradeRating.subject_kind == kind, PostTradeRating.subject_id == model.id)
        final = select(TradeFinalisation.id).where(
            TradeFinalisation.subject_kind == kind, TradeFinalisation.subject_id == model.id)
        due = (await db.execute(select(model.id).where(
            model.status == done_status,
            done_at.is_not(None),
            done_at < cutoff,
            ~rated.exists(),
            ~final.exists(),
        ))).scalars().all()
        for sid in due:
            db.add(TradeFinalisation(subject_kind=kind, subject_id=sid, finalised_at=datetime.utcnow(),
                                     reason="window_expired"))
            closed += 1
    await db.commit()
    return closed


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

    blocked = await conflict(db, viewer, subj["supplier"], subj["client"])
    closed = await _window_closed(db, subject_kind, subject_id)
    if role == "client":
        can_rate = (not mine) and not blocked and not closed and subj["status"] in DONE_STATES[subject_kind]
        rate_as = "client" if can_rate else None
    else:
        can_rate = (not mine) and not blocked and not closed and subj["status"] in FAILABLE_STATES[subject_kind]
        rate_as = "supplier" if can_rate else None

    return {
        "subject_kind": subject_kind,
        "subject_id": str(subject_id),
        "trade_status": subj["status"],
        "my_role": role,
        "final": bool(rows) or closed,
        "window_closed": closed,
        "rated_by_me": bool(mine),
        "can_rate_as": rate_as,
        "blocked_reason": blocked,
        "ratings": [
            {"rater_role": r.rater_role, "outcome": r.outcome, "stars": r.stars,
             "note": r.note, "created_at": r.created_at.isoformat()}
            for r in rows
        ],
    }


async def supplier_stats(db: AsyncSession, supplier_ids: list, days: int = scoring.RECENT_DAYS) -> dict:
    """Recent client star ratings per supplier: {vendor_id: {"rated": n, "avg_stars": x or None}}.

    Anti-gaming: a client counts once per supplier in the window, using their latest rating, so
    repeat bookings with one client cannot stack the average. `rated` counts distinct clients.
    `avg_stars` is shown only once the sample reaches scoring.MIN_RATINGS_FOR_RANK; below that,
    the count is shown and the average is withheld.
    """
    ids = [i for i in supplier_ids if i is not None]
    out = {i: {"rated": 0, "avg_stars": None} for i in ids}
    if not ids:
        return out
    since = datetime.utcnow() - timedelta(days=days)
    rows = (await db.execute(select(
        PostTradeRating.supplier_vendor_id, PostTradeRating.client_vendor_id, PostTradeRating.stars,
    ).where(
        PostTradeRating.supplier_vendor_id.in_(ids),
        PostTradeRating.rater_role == "client",
        PostTradeRating.outcome == "completed",
        PostTradeRating.stars.is_not(None),
        PostTradeRating.created_at >= since,
    ).order_by(PostTradeRating.created_at.desc()))).all()
    latest: dict = {}
    for vid, cid, stars in rows:
        latest.setdefault((vid, cid), int(stars))   # newest first: keep one per (supplier, client)
    totals: dict = {}
    for (vid, _cid), stars in latest.items():
        n, s = totals.get(vid, (0, 0))
        totals[vid] = (n + 1, s + stars)
    for vid, (n, s) in totals.items():
        avg = round(s / n, 2) if n >= scoring.MIN_RATINGS_FOR_RANK else None
        out[vid] = {"rated": n, "avg_stars": avg}
    return out

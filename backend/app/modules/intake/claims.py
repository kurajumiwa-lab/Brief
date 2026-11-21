"""Anyone can advertise a price. The business always gets the last word.

The town's prices are not the shops' marketing. A customer who sees a bale at
KSh 1,932 can say so; an employee, in their own time and from a shelf label
anyone could read, can say so; a rival shop can say so. What we never do is pay
for an internal document, or publish a fact with no date and no source.

This module adds three things to the existing intake dataset:

    reported_by / source   who said it, and in what capacity
    observed_on            when the price was last seen at that shop
    reply / dispute        the business's right of answer, in the same view

And one figure the whole price-truth product exists for:

    savings()              "the same bale is KSh 168 cheaper forty metres away"

Four rules make that figure honest, and they are enforced here rather than in a
comment: at least five confirmed samples, a date no older than 45 days, never a
verdict about a shop, and no number at all when nobody has evidence.

The boundary that matters for the employees you mentioned, in one line:

    allowed: a price anyone can see as a customer (shelf label, quote, printed
             wholesale list, your own receipt)
    refused: a costing sheet, a supplier contract, anything shared in confidence
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from statistics import median
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.intake.models import MarketObservation, MarketPresence

#: A price older than this is stale: it stays readable, it leaves the headline.
STALE_AFTER_DAYS = 45
#: Below this many confirmed samples a "saving" is an anecdote, not a market fact.
MIN_SAMPLES = 5
#: Who may report, and what we call each one on screen.
SOURCES = {
    "customer": "Reported by a customer",
    "employee": "Reported by someone who works there",
    "rival": "Reported by another business",
    "owner": "Reported by the business",
    "operator": "Collected by Brief",
}
#: A claim needs this many independent reports before it is a "confirmed" fact.
CORROBORATIONS = 2


class ClaimError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _norm(text: Optional[str]) -> str:
    return " ".join((text or "").lower().split())


def source_label(source: str) -> str:
    return SOURCES.get(source, "Reported to Brief")


# ── submitting ────────────────────────────────────────────────────────────────

async def submit(
    db: AsyncSession,
    *,
    vendor: Vendor,
    product: str,
    price_kes: int,
    seller_label: str,
    market: Optional[str] = None,
    unit: Optional[str] = None,
    source: str = "customer",
    observed_on: Optional[date] = None,
) -> MarketObservation:
    """A member of the public reports a price. It starts as a suggestion.

    Nothing here publishes anything: the row is `suggested` until a second,
    independent report agrees or an operator confirms it.
    """
    if source not in SOURCES or source == "operator":
        raise ClaimError("Say whether you are a customer, an employee or a rival business.", 422)
    name = (product or "").strip()
    label = (seller_label or "").strip()
    if len(name) < 2:
        raise ClaimError("What is the item?", 422)
    if len(label) < 2:
        raise ClaimError("Which shop is it? A price with no shop is not a claim.", 422)
    if not isinstance(price_kes, int) or isinstance(price_kes, bool) or not (1 <= price_kes <= 100_000_000):
        raise ClaimError("The price must be a whole number of shillings.", 422)
    seen = observed_on or date.today()
    if seen > date.today():
        raise ClaimError("A price cannot have been seen in the future.", 422)
    if seen < date.today() - timedelta(days=365):
        raise ClaimError("That price is more than a year old; it would mislead buyers.", 422)

    presence = (
        await db.execute(
            select(MarketPresence).where(func.lower(MarketPresence.display_name) == label.lower())
        )
    ).scalars().first()
    if presence is None:
        from app.modules.intake.service import presence_for
        presence = await presence_for(db, seller_label=label, phone=None, market=market)

    row = MarketObservation(
        # A public report has no operator batch. The column is required, so a
        # report gets its own one-row batch rather than borrowing someone's.
        batch_id=await _self_batch(db, vendor, market=market),
        presence_id=presence.id if presence else None,
        product=name[:160],
        price_kes=price_kes,
        unit=(unit or "")[:16] or None,
        market=market,
        seller_label=label[:160],
        wholesale=False,
        confidence=0.5,
        status="suggested",
        reported_by=vendor.id,
        source=source,
        observed_on=seen,
    )
    db.add(row)
    await db.flush()

    # Two independent reports of the same price at the same shop confirm each
    # other. One report never does, and a shop reporting itself never does.
    if source != "owner":
        agreed = (await db.execute(
            select(func.count(func.distinct(MarketObservation.reported_by))).where(
                MarketObservation.product == row.product,
                MarketObservation.seller_label == row.seller_label,
                MarketObservation.price_kes == row.price_kes,
                MarketObservation.reported_by.isnot(None),
                MarketObservation.reported_by != row.reported_by,
                MarketObservation.status.in_(("suggested", "confirmed")),
            )
        )).scalar() or 0
        if agreed >= CORROBORATIONS - 1:
            row.status = "confirmed"

    await db.flush()
    return row


async def _self_batch(db: AsyncSession, vendor: Vendor, *, market: Optional[str]) -> uuid.UUID:
    """A one-row batch for a public report, so every claim stays traceable."""
    from app.modules.intake.models import MarketIntakeBatch
    batch = MarketIntakeBatch(
        created_by=vendor.id,
        source="customer",
        image_count=0,
        image_urls=[],
        raw_text=None,
        market=market,
        note="Public price report",
        status="parsed",
    )
    db.add(batch)
    await db.flush()
    return batch.id


# ── the business's rights ─────────────────────────────────────────────────────

async def _claim_for_owner(db: AsyncSession, vendor: Vendor, observation_id: str) -> MarketObservation:
    """The claim, if this vendor is the business it is about.

    A business reaches its own rows through the presence it has claimed, or
    through a row whose seller label matches its own name. Anything else is not
    found, so a shop cannot edit another shop's facts.
    """
    try:
        oid = uuid.UUID(str(observation_id))
    except (ValueError, TypeError):
        raise ClaimError("That price report was not found.", 404)
    row = (await db.execute(
        select(MarketObservation).where(MarketObservation.id == oid)
    )).scalar_one_or_none()
    if row is None:
        raise ClaimError("That price report was not found.", 404)

    mine = False
    if row.presence_id is not None:
        presence = await db.get(MarketPresence, row.presence_id)
        mine = bool(presence and presence.claimed_vendor_id == vendor.id)
    if not mine and row.seller_label:
        mine = _norm(row.seller_label) == _norm(vendor.business_name)
    if not mine:
        raise ClaimError("That report is not about your business.", 403)
    return row


async def reply(db: AsyncSession, vendor: Vendor, observation_id: str, body: str) -> MarketObservation:
    """Answer a claim, in the same view, today. Never a negotiation."""
    text = (body or "").strip()
    if len(text) < 2:
        raise ClaimError("Write the reply.", 422)
    if len(text) > 2000:
        raise ClaimError("The reply is too long.", 422)
    row = await _claim_for_owner(db, vendor, observation_id)
    row.reply_body = text
    row.reply_by = vendor.id
    row.replied_at = datetime.utcnow()
    await db.flush()
    return row


async def correct(
    db: AsyncSession, vendor: Vendor, observation_id: str, price_kes: int
) -> MarketObservation:
    """The owner states the current price. Its own claim, labelled as such.

    The old row stays: a corrected price is a new fact with a date, not an edit
    of somebody else's report.
    """
    if not isinstance(price_kes, int) or isinstance(price_kes, bool) or price_kes < 1:
        raise ClaimError("The price must be a whole number of shillings.", 422)
    row = await _claim_for_owner(db, vendor, observation_id)
    corrected = MarketObservation(
        batch_id=row.batch_id,
        presence_id=row.presence_id,
        product=row.product,
        price_kes=price_kes,
        unit=row.unit,
        category=row.category,
        market=row.market,
        seller_label=row.seller_label,
        wholesale=row.wholesale,
        confidence=1.0,
        status="confirmed",
        reported_by=vendor.id,
        source="owner",
        observed_on=date.today(),
        reply_body=row.reply_body,
    )
    row.status = "rejected"
    row.decided_by = vendor.id
    row.decided_at = datetime.utcnow()
    row.reply_body = (row.reply_body or "") + "\nCorrected by the business on " + date.today().isoformat()
    db.add(corrected)
    await db.flush()
    return corrected


async def dispute(db: AsyncSession, vendor: Vendor, observation_id: str, reason: str) -> dict:
    """Open a dispute. `DisputeCase` is evidence, not a verdict, so the claim is
    only badged until somebody resolves it."""
    from app.modules.town.models import DisputeCase
    text = (reason or "").strip()
    if len(text) < 10:
        raise ClaimError("Say what is wrong with the report, in a sentence.", 422)
    row = await _claim_for_owner(db, vendor, observation_id)
    existing = (await db.execute(
        select(DisputeCase).where(
            DisputeCase.domain == "receipt",
            DisputeCase.subject_id == row.id,
            DisputeCase.status.in_(("open", "reviewing")),
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise ClaimError("This report is already disputed.", 409)
    case = DisputeCase(
        domain="receipt", subject_id=row.id, opened_by_vendor_id=vendor.id,
        against_vendor_id=row.reported_by, reason=text[:2000], status="open",
        evidence={"observation_id": str(row.id), "price_kes": row.price_kes,
                  "seller_label": row.seller_label},
    )
    db.add(case)
    await db.flush()
    return {"observation_id": str(row.id), "disputed": True, "case_id": str(case.id)}


# ── the savings figure ────────────────────────────────────────────────────────

def _age_days(observed_on: Optional[date], created_at: Optional[datetime]) -> int:
    when = observed_on or (created_at.date() if created_at else date.today())
    return max(0, (date.today() - when).days)


async def savings(
    db: AsyncSession,
    *,
    town: Optional[str] = None,
    product: Optional[str] = None,
    limit: int = 20,
) -> dict:
    """Where the same item costs less a short walk away.

    The sentence this returns is deliberately narrow: "KSh 168 cheaper here",
    with a date and a sample count. Never "they are overcharging you" — that is
    a claim about a business we cannot prove and should not make.
    """
    stmt = (
        select(MarketObservation, MarketPresence.virtual_id)
        .outerjoin(MarketPresence, MarketPresence.id == MarketObservation.presence_id)
        .where(MarketObservation.status == "confirmed")
    )

    rows = (await db.execute(stmt)).all()

    groups: dict = {}
    for observation, virtual_id in rows:
        if town and _norm(observation.market) != _norm(town):
            continue
        if product and _norm(product) not in _norm(observation.product):
            continue
        key = (_norm(observation.market), _norm(observation.product), _norm(observation.unit))
        groups.setdefault(key, []).append((observation, virtual_id))

    out = []
    for (market_key, product_key, _unit), entries in groups.items():
        fresh = [
            (o, v) for o, v in entries
            if _age_days(o.observed_on, o.created_at) <= STALE_AFTER_DAYS
        ]
        samples = len(fresh)
        if samples < MIN_SAMPLES:
            # Not enough evidence. We say nothing rather than show a two-shop
            # anecdote as a market fact.
            continue
        prices = [o.price_kes for o, _ in fresh]
        typical = int(median(prices))
        cheapest_row, cheapest_virtual = min(fresh, key=lambda pair: pair[0].price_kes)
        saving = typical - cheapest_row.price_kes
        if saving <= 0:
            continue
        out.append({
            "product": cheapest_row.product,
            "unit": cheapest_row.unit,
            "town": cheapest_row.market,
            "typical_kes": typical,
            "cheapest_kes": cheapest_row.price_kes,
            "saving_kes": saving,
            "saving_pct": round(saving * 100 / typical, 1) if typical else 0,
            "sample_count": samples,
            "cheapest_seller": {
                "virtual_id": cheapest_virtual,
                "label": cheapest_row.seller_label,
            },
            "observed_on": (cheapest_row.observed_on or cheapest_row.created_at.date()).isoformat(),
            "confidence": "confirmed",
            "sentence": f"KSh {saving} cheaper at {cheapest_row.seller_label}.",
            # Named so the UI cannot drift into a verdict about the shop.
            "not_a_verdict": True,
        })

    out.sort(key=lambda item: item["saving_kes"], reverse=True)
    return {
        "items": out[: max(1, min(limit, 50))],
        "min_samples": MIN_SAMPLES,
        "stale_after_days": STALE_AFTER_DAYS,
        "note": (
            "A saving is only shown where at least "
            f"{MIN_SAMPLES} confirmed prices agree, and only for prices seen in the "
            f"last {STALE_AFTER_DAYS} days. No price means nobody has evidence yet."
        ),
    }


def claim_out(observation: MarketObservation, *, presence: Optional[MarketPresence] = None) -> dict:
    """One price claim, with its provenance and the business's answer."""
    return {
        "id": str(observation.id),
        "product": observation.product,
        "price_kes": observation.price_kes,
        "unit": observation.unit,
        "market": observation.market,
        "seller_label": observation.seller_label,
        "status": observation.status,
        "source": observation.source,
        "source_label": source_label(observation.source),
        "observed_on": (observation.observed_on or observation.created_at.date()).isoformat(),
        "stale": _age_days(observation.observed_on, observation.created_at) > STALE_AFTER_DAYS,
        "reporter": str(observation.reported_by) if observation.reported_by else None,
        "reply": (
            {"body": observation.reply_body,
             "at": observation.replied_at.isoformat() if observation.replied_at else None}
            if observation.reply_body else None
        ),
        "seller": {
            "virtual_id": presence.virtual_id if presence else None,
            "claimed": bool(presence and presence.claimed_vendor_id),
        },
    }

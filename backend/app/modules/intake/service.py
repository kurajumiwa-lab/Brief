"""Reading the market, and deciding who may see it.

The commercial logic lives here rather than in the router, because it is the
part worth arguing about:

  · **A photograph never becomes data on its own.** Extraction produces
    `suggested` rows; only an operator (`admin` / `clerk`) can confirm one, and
    a confirmed row is what the market-data views read. That is the difference
    between a dataset and a rumour.

  · **A seller without an account still has an identity.** `presence_for()`
    mints a virtual ID (`~khetia-4f2a`) the first time we see a name or phone,
    and every confirmed observation attaches to it. It costs nothing, it can
    never authenticate, and when the seller finally joins, `claim_presence()`
    hands them the history instead of starting them at zero.

  · **Access is a ladder, and the top rung is not for sale yet.** Anyone signed
    in sees the market: product, price, category. Members see it without the
    seller's contact. Partners — an existing paid plan or a verified business —
    see who is selling and how to reach them. There is no checkout anywhere in
    this module: a partner who is not entitled is told what the entitlement is
    and where to ask for it, and a human answers, because subscription billing
    is still not verified.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.vendor import Vendor
from app.modules.intake import extract as extractor
from app.modules.intake.models import (
    MarketIntakeBatch,
    MarketObservation,
    MarketPresence,
)

# Plans that already carry market-data access. Deliberately read off the
# existing entitlement (plan_tier) rather than inventing a second one.
PARTNER_PLANS = ("business", "enterprise")
MAX_IMAGES_PER_BATCH = 12


class IntakeError(Exception):
    def __init__(self, message: str, *, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# ── access ───────────────────────────────────────────────────────────────────


def access_for(vendor: Optional[Vendor]) -> dict:
    """What this caller may see, and what the next rung would give them.

    Returned with every market-data response so the screen never has to guess
    whether a blank phone number is a missing fact or a missing entitlement.
    """
    if vendor is None:
        return {
            "tier": "public",
            "label": "Public",
            "shows": ["categories", "counts", "price ranges"],
            "hides": ["products", "sellers", "contacts"],
            "upgrade": None,
        }
    plan = (getattr(vendor, "plan_tier", None) or "starter").lower()
    if plan in PARTNER_PLANS or getattr(vendor, "is_patron", False):
        return {
            "tier": "partner",
            "label": "Partner",
            "shows": ["products", "prices", "sellers", "contacts"],
            "hides": [],
            "upgrade": None,
        }
    return {
        "tier": "member",
        "label": "Member",
        "shows": ["products", "prices", "markets"],
        "hides": ["sellers", "contacts"],
        "upgrade": {
            "label": "Request seller contacts",
            "note": (
                "Seller names and phone numbers are included in the Business and "
                "Enterprise plans. Billing is not live yet: ask and a human will "
                "quote you — nothing is charged here."
            ),
            "to": "/storefront?desk=business_software",
        },
    }


def require_ops(vendor: Vendor) -> None:
    role = settings.market_ops_role(vendor.vendor_handle)
    if role not in ("admin", "clerk"):
        raise IntakeError("Market intake is reviewed by operations staff", status=403)


# ── presences ────────────────────────────────────────────────────────────────


def _slug(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return cleaned[:18] or "unlisted"


async def presence_for(
    db: AsyncSession, *, seller_label: Optional[str], phone: Optional[str], market: Optional[str] = None
) -> Optional[MarketPresence]:
    """Find or mint the seller behind an observation.

    Matched on phone first (a number is a business), then on the label
    case-insensitively. Nothing here creates a vendor account.
    """
    label = (seller_label or "").strip() or None
    if not label and not phone:
        return None

    if phone:
        found = (
            await db.execute(select(MarketPresence).where(MarketPresence.phone == phone))
        ).scalars().first()
        if found:
            found.last_seen_at = datetime.utcnow()
            return found

    if label:
        found = (
            await db.execute(
                select(MarketPresence).where(func.lower(MarketPresence.display_name) == label.lower())
            )
        ).scalars().first()
        if found:
            found.last_seen_at = datetime.utcnow()
            return found

    base = _slug(label or "seller")
    virtual_id = f"~{base}"
    suffix = 1
    while (
        await db.execute(select(MarketPresence.id).where(MarketPresence.virtual_id == virtual_id))
    ).first():
        suffix += 1
        virtual_id = f"~{base}-{suffix}"

    presence = MarketPresence(
        virtual_id=virtual_id,
        display_name=label or f"Seller {phone}" if phone else (label or "Unlisted seller"),
        phone=phone,
        market=market,
    )
    db.add(presence)
    await db.flush()
    return presence


async def claim_presence(db: AsyncSession, vendor: Vendor, virtual_id: str) -> dict:
    """A seller joins and takes their history with them.

    The claim is granted on a matching phone number only. Anything looser would
    let one business claim another's prices — and the whole value of the dataset
    is that a row means a specific seller.
    """
    presence = (
        await db.execute(select(MarketPresence).where(MarketPresence.virtual_id == virtual_id))
    ).scalars().first()
    if presence is None:
        raise IntakeError("No such seller record", status=404)
    if presence.claimed_vendor_id is not None:
        if presence.claimed_vendor_id == vendor.id:
            return {"virtual_id": presence.virtual_id, "already_claimed": True}
        raise IntakeError("That seller record has already been claimed", status=409)

    phone = extractor.normalise_phone(getattr(vendor, "phone", "") or "")
    if not phone or not presence.phone or phone != presence.phone:
        raise IntakeError(
            "The number on this business account does not match the one we recorded",
            status=403,
        )

    presence.claimed_vendor_id = vendor.id
    presence.claimed_at = datetime.utcnow()
    await db.commit()
    return {
        "virtual_id": presence.virtual_id,
        "claimed": True,
        "observations": presence.observation_count,
    }


# ── intake ───────────────────────────────────────────────────────────────────


async def create_batch(
    db: AsyncSession,
    *,
    vendor: Vendor,
    lines: Iterable[str],
    image_urls: Optional[list[str]] = None,
    ocr_engine: Optional[str] = None,
    market: Optional[str] = None,
    note: Optional[str] = None,
    source: str = "screenshots",
) -> dict:
    """Store one batch, run the extraction rules, and propose what we found."""
    text_lines = [line for line in (lines or []) if str(line).strip()]
    raw_text = "\n".join(text_lines)
    result = extractor.extract(text_lines, known_markets=[])

    seller_hint = result["seller_hint"]
    phone_hint = result["phones"][0] if result["phones"] else None

    batch = MarketIntakeBatch(
        created_by=vendor.id,
        source=source,
        image_count=len(image_urls or []),
        image_urls=list(image_urls or []),
        ocr_engine=ocr_engine,
        raw_text=raw_text[:20000] if raw_text else None,
        seller_hint=seller_hint,
        phone_hint=phone_hint,
        market=market,
        note=note,
        status="parsed" if result["observations"] else "empty",
    )
    db.add(batch)
    await db.flush()

    presence = await presence_for(
        db, seller_label=seller_hint, phone=phone_hint, market=market
    )

    created: list[MarketObservation] = []
    for row in result["observations"]:
        observation = MarketObservation(
            batch_id=batch.id,
            presence_id=presence.id if presence else None,
            product=row["product"],
            price_kes=row["price_kes"],
            quantity=row["quantity"],
            unit=row["unit"],
            category=row["category"],
            market=market,
            seller_label=seller_hint,
            phone=phone_hint,
            wholesale=row["wholesale"],
            confidence=row["confidence"],
            raw_line=row["raw_line"],
            status="suggested",
        )
        db.add(observation)
        created.append(observation)

    if presence and created:
        presence.observation_count = (presence.observation_count or 0) + len(created)
        presence.last_seen_at = datetime.utcnow()

    await db.commit()
    for observation in created:
        await db.refresh(observation)

    return {
        "batch_id": str(batch.id),
        "status": batch.status,
        "ocr_engine": ocr_engine,
        "image_count": len(image_urls or []),
        "lines_read": len(text_lines),
        "seller_hint": seller_hint,
        "phone_hint": phone_hint,
        "presence": _presence_out(presence) if presence else None,
        "observations": [_observation_out(o, full=True) for o in created],
        "skipped": result["skipped"][:40],
        "note": (
            None
            if ocr_engine
            else "No OCR engine on this server, so only pasted text was read. "
                 "See requirements-ocr.txt to enable reading photographs."
        ),
    }


def _presence_out(presence: MarketPresence) -> dict:
    return {
        "virtual_id": presence.virtual_id,
        "display_name": presence.display_name,
        "phone": presence.phone,
        "market": presence.market,
        "observation_count": presence.observation_count,
        "claimed": presence.claimed_vendor_id is not None,
    }


def _observation_out(o: MarketObservation, *, full: bool) -> dict:
    out = {
        "id": str(o.id),
        "product": o.product,
        "price_kes": o.price_kes,
        "quantity": o.quantity,
        "unit": o.unit,
        "category": o.category,
        "market": o.market,
        "wholesale": o.wholesale,
        "confidence": o.confidence,
        "status": o.status,
        "raw_line": o.raw_line if full else None,
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }
    if full:
        out["seller_label"] = o.seller_label
        out["phone"] = o.phone
    return out


async def decide(
    db: AsyncSession, *, vendor: Vendor, observation_id: str, status: str
) -> dict:
    """Confirm or reject one row. The only door into the published dataset."""
    if status not in ("confirmed", "rejected"):
        raise IntakeError("Status must be 'confirmed' or 'rejected'")

    import uuid as _uuid

    try:
        oid = _uuid.UUID(str(observation_id))
    except (ValueError, TypeError):
        raise IntakeError("Unknown observation", status=404)

    observation = (
        await db.execute(select(MarketObservation).where(MarketObservation.id == oid))
    ).scalars().first()
    if observation is None:
        raise IntakeError("Unknown observation", status=404)

    observation.status = status
    observation.decided_by = vendor.id
    observation.decided_at = datetime.utcnow()
    await db.commit()
    await db.refresh(observation)
    return _observation_out(observation, full=True)


# ── the dataset ──────────────────────────────────────────────────────────────


async def summary(db: AsyncSession) -> dict:
    """The free layer: what the market looks like, without the sellers.

    Counts and ranges only. This is what makes the dataset legible enough to
    want, and it is safe to show anyone: no business is identifiable from
    "cooking oil: 12 observations, KSh 3,800–4,000".
    """
    rows = (
        await db.execute(
            select(
                MarketObservation.category,
                func.count(MarketObservation.id),
                func.min(MarketObservation.price_kes),
                func.max(MarketObservation.price_kes),
            )
            .where(MarketObservation.status == "confirmed")
            .group_by(MarketObservation.category)
            .order_by(func.count(MarketObservation.id).desc())
        )
    ).all()

    total = (
        await db.execute(
            select(func.count(MarketObservation.id)).where(
                MarketObservation.status == "confirmed"
            )
        )
    ).scalar() or 0
    sellers = (
        await db.execute(
            select(func.count(MarketPresence.id)).where(
                MarketPresence.observation_count > 0
            )
        )
    ).scalar() or 0
    pending = (
        await db.execute(
            select(func.count(MarketObservation.id)).where(
                MarketObservation.status == "suggested"
            )
        )
    ).scalar() or 0

    return {
        "observations": int(total),
        "sellers": int(sellers),
        "pending_review": int(pending),
        "categories": [
            {
                "category": category or "uncategorised",
                "count": int(count),
                "price_min_kes": int(price_min) if price_min is not None else None,
                "price_max_kes": int(price_max) if price_max is not None else None,
            }
            for category, count, price_min, price_max in rows
        ],
    }


async def observations(
    db: AsyncSession,
    *,
    viewer: Optional[Vendor],
    category: Optional[str] = None,
    market: Optional[str] = None,
    limit: int = 60,
) -> dict:
    """Confirmed rows, redacted to what the caller is entitled to see."""
    access = access_for(viewer)
    stmt = (
        select(MarketObservation, MarketPresence.virtual_id)
        .outerjoin(MarketPresence, MarketPresence.id == MarketObservation.presence_id)
        .where(MarketObservation.status == "confirmed")
        .order_by(MarketObservation.created_at.desc())
        .limit(max(1, min(limit, 200)))
    )
    if category:
        stmt = stmt.where(MarketObservation.category == category)
    if market:
        stmt = stmt.where(MarketObservation.market == market)

    rows = (await db.execute(stmt)).all()
    items = []
    for observation, virtual_id in rows:
        item = _observation_out(observation, full=False)
        item["seller"] = (
            {
                "virtual_id": virtual_id,
                "label": observation.seller_label,
                "phone": observation.phone,
            }
            if access["tier"] == "partner"
            else None
        )
        item["seller_hidden"] = access["tier"] != "partner"
        items.append(item)

    return {"access": access, "count": len(items), "items": items}


async def recent_batches(db: AsyncSession, limit: int = 20) -> dict:
    rows = (
        await db.execute(
            select(MarketIntakeBatch)
            .order_by(MarketIntakeBatch.created_at.desc())
            .limit(max(1, min(limit, 100)))
        )
    ).scalars().all()
    out = []
    for batch in rows:
        pending = (
            await db.execute(
                select(func.count(MarketObservation.id)).where(
                    MarketObservation.batch_id == batch.id,
                    MarketObservation.status == "suggested",
                )
            )
        ).scalar() or 0
        out.append({
            "id": str(batch.id),
            "source": batch.source,
            "image_count": batch.image_count,
            "ocr_engine": batch.ocr_engine,
            "seller_hint": batch.seller_hint,
            "status": batch.status,
            "pending": int(pending),
            "created_at": batch.created_at.isoformat() if batch.created_at else None,
        })
    return {"count": len(out), "batches": out}


async def batch_detail(db: AsyncSession, batch_id: str) -> dict:
    import uuid as _uuid

    try:
        bid = _uuid.UUID(str(batch_id))
    except (ValueError, TypeError):
        raise IntakeError("Unknown batch", status=404)
    batch = (
        await db.execute(select(MarketIntakeBatch).where(MarketIntakeBatch.id == bid))
    ).scalars().first()
    if batch is None:
        raise IntakeError("Unknown batch", status=404)

    rows = (
        await db.execute(
            select(MarketObservation)
            .where(MarketObservation.batch_id == bid)
            .order_by(MarketObservation.created_at)
        )
    ).scalars().all()

    return {
        "id": str(batch.id),
        "source": batch.source,
        "status": batch.status,
        "image_count": batch.image_count,
        "image_urls": list(batch.image_urls or []),
        "ocr_engine": batch.ocr_engine,
        "seller_hint": batch.seller_hint,
        "phone_hint": batch.phone_hint,
        "market": batch.market,
        "note": batch.note,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "observations": [_observation_out(o, full=True) for o in rows],
    }

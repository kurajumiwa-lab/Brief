"""Caesar as a guide, not an oracle.

A supermarket guide does three things and none of them is conversation: knows
what is on the shelves, knows the way from where you are standing to where you
want to be, and says something useful when you are standing in front of an empty
shelf. This module is those three things, written as ordinary functions.

**Why there is no model here.** Every answer below is a lookup, a count or a
parse. That is not a limitation to be apologised for — it is what makes the
guide trustworthy:

  · a suggestion can always be traced to a row (`evidence`) or to a rule
    (`basis`), and both are returned to the caller;
  · the guide cannot invent an item, because it only ever returns names that
    exist in the database right now;
  · it costs nothing per use, so it can be on every screen.

A language model may later write the sentence *around* these results. It must
never choose them, and it never appears in this file.

**The ladder.** Rung 0 typeahead, rung 1 next-shelf, rung 2 sentence → filters.
Each is independently useful, and each degrades to "no suggestion" rather than
to a wrong one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import quote
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.guide import GuideSearch
from app.models.stock import StockItem
from app.models.vendor import Vendor

# ── the shelves ──────────────────────────────────────────────────────────────
#
# Kept here rather than imported from the frontend because the backend has to be
# able to answer without a browser. The keys are the same nine the home feed
# renders; a test asserts the two lists agree.

SHELVES: tuple[dict, str] = (
    {"key": "stock", "label": "Stock", "blurb": "Goods on the network", "words": ("stock", "goods", "produce", "items", "buy", "supplies")},
    {"key": "services", "label": "Services", "blurb": "Work for your business", "words": ("service", "services", "repair", "fundi", "delivery", "transport", "printing")},
    {"key": "people", "label": "People", "blurb": "Who to work with", "words": ("people", "person", "staff", "hire", "worker", "supplier", "partner")},
    {"key": "equipment", "label": "Equipment", "blurb": "Tools and rentals", "words": ("equipment", "machine", "tool", "rent", "rental", "freezer", "tractor", "generator")},
    {"key": "opportunities", "label": "Opportunities", "blurb": "Requests and call-ups", "words": ("opportunity", "opportunities", "tender", "request", "contract", "tender", "job")},
    {"key": "events", "label": "Events", "blurb": "Market days and meetups", "words": ("event", "events", "market day", "meetup", "training", "expo")},
    {"key": "community", "label": "Community", "blurb": "Groups and lists", "words": ("group", "groups", "community", "chama", "circle", "association")},
    {"key": "markets", "label": "Markets", "blurb": "Physical markets", "words": ("market", "markets", "stall", "shed", "kibanda")},
    {"key": "notices", "label": "Notices", "blurb": "The byway board", "words": ("notice", "notices", "announcement", "board", "byway")},
)

SHELF_BY_KEY = {s["key"]: s for s in SHELVES}

# Which shelf a person is likely to want next, when there is no evidence yet.
#
# This is a declared map, not a prediction, and the API labels it as such. It is
# the supermarket's own signage: "if you picked up flour, the eggs are this way".
# Once there is real navigation data, `observed` supersedes it — see `next_shelf`.
DECLARED_NEXT: dict[str, tuple[str, ...]] = {
    "stock": ("markets", "people", "services"),
    "services": ("people", "equipment", "opportunities"),
    "people": ("services", "community", "markets"),
    "equipment": ("services", "people", "stock"),
    "opportunities": ("stock", "people", "markets"),
    "events": ("markets", "community", "notices"),
    "community": ("events", "notices", "people"),
    "markets": ("stock", "events", "equipment"),
    "notices": ("events", "community", "opportunities"),
}


# ── rung 2: a sentence becomes filters ───────────────────────────────────────
#
# This is a grammar, not an inference. It recognises exactly what Brief can
# actually filter on, and it puts everything it did not understand into
# `leftover` so the UI can say "I used these two things" instead of pretending.

_MONEY = r"(?:ksh|kes|sh|bob|/=)?\s*(\d[\d,]*(?:\.\d+)?)"
_CURRENCY = r"(?:\s*(?:ksh|kes|sh|bob|shillings?|bucks))?"
_CEILING = re.compile(
    rf"(?:under|below|less than|at most|max|maximum|<=?|ch(?:ini|ea) ya chini ya)\s*{_MONEY}{_CURRENCY}",
    re.IGNORECASE,
)
_CEILING_SUFFIX = re.compile(rf"^\s*(?:{_MONEY})\s*(?:ksh|kes|bob|/=|shillings?)", re.IGNORECASE)
_FLOOR = re.compile(
    rf"(?:over|above|more than|at least|min|minimum|>=?)\s*{_MONEY}{_CURRENCY}", re.IGNORECASE
)

_DISTANCE = re.compile(r"(?:within|near|around|inside|karibu na)\s+(\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?|m|metres?|meters?)", re.IGNORECASE)
_PLACE = re.compile(r"(?:in|at|near|around|from|karibu na)\s+([A-Za-z][A-Za-z' \-]{1,40})", re.IGNORECASE)

_QUANTITY = re.compile(r"(\d+)\s*(kg|kgs|kilos?|bags?|boxes?|crates?|litres?|liters?|pieces?|pcs|units?|dozen)", re.IGNORECASE)

_STOPWORDS = {
    "a", "an", "the", "of", "for", "to", "with", "and", "or", "my", "our", "me",
    "i", "we", "you", "is", "are", "some", "any", "please", "need", "want",
    "looking", "find", "show", "get", "buy", "sell", "near", "in", "at", "on",
    "that", "this", "these", "those", "good", "best", "cheap", "cheapest",
}

FILLER_FOR_SHELF = {
    "stock": ("goods", "items", "stock", "products", "produce", "supplies", "buy"),
    "services": ("service", "services", "work"),
    "people": ("people", "person", "staff", "supplier"),
    "equipment": ("equipment", "tools", "rental"),
    "opportunities": ("opportunities", "opportunity", "requests"),
    "events": ("events", "event"),
    "community": ("groups", "group", "community"),
    "markets": ("markets", "market"),
    "notices": ("notices", "notice"),
}


@dataclass
class ParsedQuery:
    """What the guide understood, and the honest remainder."""

    shelf: Optional[str] = None
    keywords: list[str] = field(default_factory=list)
    price_max: Optional[float] = None
    price_min: Optional[float] = None
    within_km: Optional[float] = None
    place: Optional[str] = None
    quantity: Optional[int] = None
    unit: Optional[str] = None

    def as_filters(self) -> dict:
        """Only the things that become query parameters. No keyword soup."""
        out = {
            "price_max": self.price_max,
            "price_min": self.price_min,
            "within_km": self.within_km,
            "place": self.place,
            "quantity": self.quantity,
            "unit": self.unit,
            "shelf": self.shelf,
        }
        return {k: v for k, v in out.items() if v not in (None, "", [])}

    def understood(self) -> list[str]:
        """What the guide will actually do with this sentence, in words."""
        said: list[str] = []
        if self.price_max is not None:
            said.append(f"price up to {self.price_max:g}")
        if self.price_min is not None:
            said.append(f"price from {self.price_min:g}")
        if self.within_km is not None:
            said.append(f"within {self.within_km:g} km")
        if self.place:
            said.append(f"near {self.place}")
        if self.quantity is not None:
            said.append(f"{self.quantity} {self.unit or 'units'}")
        if self.keywords:
            said.append("looking for " + ", ".join(self.keywords))
        return said


def _to_number(raw: str) -> Optional[float]:
    try:
        return float(raw.replace(",", ""))
    except (TypeError, ValueError):
        return None


def parse_query(query: str) -> ParsedQuery:
    """Turn "tomatoes under 200 bob within 5km" into filters, deterministically.

    Everything recognised is *removed* from the text before the leftover is
    computed, so what remains is genuinely unparsed — that is what lets the UI
    say "I used the price and the distance, not the rest" without lying.
    """
    parsed = ParsedQuery()
    rest = query or ""

    if m := _CEILING.search(rest):
        parsed.price_max = _to_number(m.group(1))
        rest = rest[: m.start()] + " " + rest[m.end() :]
    elif m := _CEILING_SUFFIX.search(rest):
        parsed.price_max = _to_number(m.group(1))
        rest = rest[: m.start()] + " " + rest[m.end() :]

    if m := _FLOOR.search(rest):
        parsed.price_min = _to_number(m.group(1))
        rest = rest[: m.start()] + " " + rest[m.end() :]

    if m := _DISTANCE.search(rest):
        value = float(m.group(1))
        unit = m.group(2).lower()
        parsed.within_km = value / 1000 if unit.startswith("m") and not unit.startswith("km") else value
        rest = rest[: m.start()] + " " + rest[m.end() :]

    if m := _QUANTITY.search(rest):
        parsed.quantity = int(m.group(1))
        parsed.unit = m.group(2).lower()
        rest = rest[: m.start()] + " " + rest[m.end() :]

    # The shelf comes from the verbs/nouns the network actually has a shelf for.
    lowered = rest.lower()
    for shelf in SHELVES:
        if any(re.search(rf"\b{re.escape(w)}\b", lowered) for w in shelf["words"]):
            parsed.shelf = shelf["key"]
            for w in shelf["words"]:
                lowered = re.sub(rf"\b{re.escape(w)}\b", " ", lowered)
            break
    rest = lowered

    if m := _PLACE.search(rest):
        candidate = m.group(1).strip(" ,.")
        if len(candidate) > 2:
            parsed.place = candidate
            rest = rest[: m.start()] + " " + rest[m.end() :]

    words = [w for w in re.findall(r"[a-z0-9']+", rest.lower()) if len(w) > 2 and w not in _STOPWORDS]
    fillers = set(FILLER_FOR_SHELF.get(parsed.shelf or "", ()))
    parsed.keywords = [w for w in words if w not in fillers][:6]
    return parsed


# ── rung 0: typeahead ────────────────────────────────────────────────────────


def _normalise(term: str) -> str:
    return re.sub(r"\s+", " ", (term or "").strip().lower())


def _shelf_matches(term: str) -> list[dict]:
    """Shelves are matched on label *and* on the words people actually type."""
    term = _normalise(term)
    if not term:
        return []
    out = []
    for shelf in SHELVES:
        if term in shelf["key"] or term in shelf["label"].lower() or any(term in w for w in shelf["words"]):
            out.append(
                {
                    "kind": "shelf",
                    "shelf": shelf["key"],
                    "label": shelf["label"],
                    "blurb": shelf["blurb"],
                    "to": f"/browse?type={shelf['key']}",
                    "score": 100 if term in shelf["label"].lower() else 70,
                }
            )
    return out


async def suggest(
    db: AsyncSession,
    term: str,
    *,
    limit: int = 8,
    viewer: Optional[Vendor] = None,
) -> dict:
    """Everything that matches what has been typed so far, best first.

    Only names that **exist and are available on the network right now** are
    returned. A suggestion the app cannot deliver is worse than no suggestion:
    it teaches people that the guide guesses.
    """
    term = _normalise(term)
    if len(term) < 2:
        return {"query": term, "suggestions": [], "note": "Type at least two letters."}

    suggestions = _shelf_matches(term)

    # Catalogue matches: group by name so "tomatoes" appears once, with a count
    # of how many shelves carry it and the best price. Never the seller's name —
    # this is a map of the shop, not an advert.
    rows = await db.execute(
        select(
            StockItem.name,
            func.count(func.distinct(StockItem.vendor_id)).label("vendors"),
            func.min(func.coalesce(StockItem.unit_price, StockItem.wholesale_price)).label("from_price"),
        )
        .where(
            and_(
                StockItem.visible_to_network.is_(True),
                StockItem.quantity_available > 0,
                StockItem.name.ilike(f"%{term}%"),
                StockItem.vendor_id != (viewer.id if viewer else None) if viewer else True,
            )
        )
        .group_by(StockItem.name)
        .order_by(func.count(func.distinct(StockItem.vendor_id)).desc(), StockItem.name.asc())
        .limit(limit)
    )
    for name, vendors, from_price in rows.all():
        suggestions.append(
            {
                "kind": "item",
                "label": name,
                "blurb": (
                    f"{vendors} shelf carries it" if vendors == 1 else f"{vendors} shelves carry it"
                )
                + (f" · from KSh {from_price:,.0f}" if from_price is not None else ""),
                # Quoted: a URL with a space or a bracket in it breaks the moment
                # somebody copies it into a chat.
                "to": f"/browse?type=goods&q={quote(name)}",
                "score": 90 if _normalise(name).startswith(term) else 60,
            }
        )

    suggestions.sort(key=lambda s: (-s["score"], s["label"]))
    return {
        "query": term,
        "suggestions": suggestions[:limit],
        "parsed": parse_query(term).as_filters(),
    }


# ── rung 1: the next shelf ───────────────────────────────────────────────────


async def next_shelf(
    db: AsyncSession,
    from_shelf: Optional[str],
    *,
    viewer: Optional[Vendor] = None,
    window_days: int = 60,
    minimum_evidence: int = 20,
) -> dict:
    """Where people go after ``from_shelf`` — observed if there is evidence.

    ``basis`` is always returned. ``observed`` means the counts in this database
    produced the answer; ``declared`` means the shop's own signage did. Nothing
    is presented as a prediction, because with a young network it would not be
    one.

    The query is deliberately blunt: count how often a visit to one shelf is
    followed by a visit to another *for the same vendor*. It needs no model, no
    worker and no nightly job — it is two indexed reads.
    """
    from app.models.guide import GuideShelfVisit  # local import: keeps the cycle out

    if from_shelf not in SHELF_BY_KEY:
        return {"from": from_shelf, "basis": "none", "suggestions": [], "why": "No shelf to start from."}

    since = datetime.utcnow() - timedelta(days=window_days)
    later = GuideShelfVisit.__table__.alias("later")
    earlier = GuideShelfVisit.__table__.alias("earlier")

    rows = await db.execute(
        select(later.c.shelf, func.count().label("n"))
        .select_from(
            earlier.join(
                later,
                and_(
                    later.c.vendor_id == earlier.c.vendor_id,
                    later.c.created_at > earlier.c.created_at,
                    later.c.created_at <= earlier.c.created_at + text("interval '30 minutes'"),
                    later.c.shelf != earlier.c.shelf,
                ),
            )
        )
        .where(and_(earlier.c.shelf == from_shelf, earlier.c.created_at >= since, earlier.c.vendor_id.isnot(None)))
        .group_by(later.c.shelf)
        .order_by(func.count().desc())
        .limit(3)
    )
    observed = [(shelf, n) for shelf, n in rows.all() if shelf in SHELF_BY_KEY]
    total = sum(n for _, n in observed)

    if observed and total >= minimum_evidence:
        return {
            "from": from_shelf,
            "basis": "observed",
            "suggestions": [
                _shelf_offer(shelf, f"{n} of {total} next taps from here") for shelf, n in observed
            ],
            "why": f"From {total} visits in the last {window_days} days.",
        }

    declared = DECLARED_NEXT.get(from_shelf, ())
    return {
        "from": from_shelf,
        "basis": "declared",
        "suggestions": [_shelf_offer(shelf, SHELF_BY_KEY[shelf]["blurb"]) for shelf in declared],
        "why": "Not enough navigation data yet to learn this, so this is the shelf map.",
    }


def _shelf_offer(key: str, blurb: str) -> dict:
    shelf = SHELF_BY_KEY[key]
    return {"shelf": key, "label": shelf["label"], "blurb": blurb, "to": f"/browse?type={key}"}


# ── the most valuable sentence in the product ────────────────────────────────


async def record_search(
    db: AsyncSession,
    *,
    query: str,
    shelf: Optional[str] = None,
    result_count: int = 0,
    viewer: Optional[Vendor] = None,
) -> None:
    """Remember what was asked for and whether the network could answer.

    Rows with ``result_count = 0`` are demand, and they are the single most
    useful thing a young network can collect: they are people saying out loud
    what they wanted and did not find. Nothing else in Brief produces that.
    """
    normalised = _normalise(query)[:200]
    if not normalised:
        return
    db.add(
        GuideSearch(
            vendor_id=viewer.id if viewer else None,
            query=normalised,
            shelf=shelf if shelf in SHELF_BY_KEY else None,
            result_count=max(0, int(result_count)),
        )
    )
    await db.commit()


async def demand(
    db: AsyncSession,
    *,
    days: int = 7,
    minimum: int = 3,
    limit: int = 10,
) -> dict:
    """What people searched for and did not find.

    Aggregated and floored at ``minimum`` distinct searches. That floor is a
    privacy rule, not a nicety: with one event, "somebody searched for X" can
    identify a person to anyone who knows who was asking.
    """
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(
        select(GuideSearch.query, func.count().label("searches"), func.min(GuideSearch.created_at).label("first_seen"))
        .where(and_(GuideSearch.created_at >= since, GuideSearch.result_count == 0))
        .group_by(GuideSearch.query)
        .having(func.count() >= minimum)
        .order_by(func.count().desc())
        .limit(limit)
    )
    return {
        "window_days": days,
        "minimum_searches": minimum,
        "wanted_and_missing": [
            {"query": q, "searches": n, "first_seen": first.isoformat() if first else None}
            for q, n, first in rows.all()
        ],
        "note": "Aggregated. Never attributed to the person who searched.",
    }


async def record_visit(db: AsyncSession, *, shelf: str, viewer: Optional[Vendor] = None) -> None:
    """A navigation event. Anonymous visitors are counted nowhere."""
    from app.models.guide import GuideShelfVisit

    if shelf not in SHELF_BY_KEY or viewer is None:
        return
    db.add(GuideShelfVisit(vendor_id=viewer.id, shelf=shelf))
    await db.commit()


async def resolve_shelf(db: AsyncSession, parsed: ParsedQuery, *, viewer: Optional[Vendor] = None) -> Optional[str]:
    """Which shelf the sentence is really about, when the words did not say.

    "tomatoes under 200" names no shelf — "tomatoes" is not a word the shelf map
    knows. But it *is* a word on a real shelf, so the catalogue answers the
    question the grammar could not. If no live item matches either, the answer is
    ``None`` and the caller says so; guessing "stock" because most searches are
    about stock would be the beginning of an assistant that is usually right and
    never trustworthy.
    """
    if parsed.shelf:
        return parsed.shelf
    if not parsed.keywords:
        return None
    conditions = [StockItem.name.ilike(f"%{word}%") for word in parsed.keywords[:4]]
    row = (
        await db.execute(
            select(StockItem.id)
            .where(
                and_(
                    StockItem.visible_to_network.is_(True),
                    StockItem.quantity_available > 0,
                    or_(*conditions),
                    StockItem.vendor_id != (viewer.id if viewer else None) if viewer else True,
                )
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is not None:
        parsed.shelf = "stock"
        return "stock"
    return None


def shelf_keys() -> list[str]:
    return [s["key"] for s in SHELVES]

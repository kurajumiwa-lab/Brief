"""Seller terms on an offer: our fee, and the cutback the buyer keeps.

Why two numbers instead of one
------------------------------
The product rule that predates this module (`app/modules/outside/ranking.py`)
is that **price is never a ranking term**, and the legal assessment
(`docs/TOWN_COMMERCE_LEGAL.md` §4) caps paid position at three labelled slots
ranked separately. A single "commission" percentage would break both: whoever
paid us most would rise.

So a seller states two percentages, and they are not the same thing:

    platform_fee_pct   what we are paid for the introduction. NEVER ranks.
    buyer_cutback_pct  what the buyer gets back off the listed price. This is
                       the only money-adjacent number ranking may read, and
                       only inside the labelled partner band.

That makes "we prioritise our best cutback" literally true while the customer
is the one who benefits from it. See `docs/briefs/open-market-claims-and-priority.md` §2.

The ceilings are product rules, not suggestions: a seller giving back more than
10% is either not making money or not telling the truth about the price, and
either one breaks the screen.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

# ── limits ────────────────────────────────────────────────────────────────────
#: A buyer cutback above this is a lie about the price or a business in trouble.
MAX_CUTBACK_PCT = 10.0
#: Our share of one sale. Configurable per deployment via commerce_settings,
#: but this is the ceiling a seller may ever set.
MAX_PLATFORM_FEE_PCT = 3.0
#: Combined ceiling. Above this the offer stops being an offer.
MAX_COMBINED_PCT = 12.0

# How many partner offers may occupy the labelled strip (`TOWN_COMMERCE_LEGAL`
# §4 already commits to three sponsored slots; this is the same discipline for
# the new band, and the same number on purpose).
BAND_SLOTS = 3

#: A shelf order is not touched by money while the category is thin. The weight
#: of the cutback inside the band climbs only once there is a real choice.
DENSITY_RAMP = ((20, 0.0), (100, 0.10), (None, 0.25))


def _clamp_pct(value) -> float:
    try:
        pct = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, pct)


def clean_pct(value, *, ceiling: float, what: str) -> float:
    """A percentage a seller may store, rounded to 2dp, or a plain refusal.

    Zero is always allowed: it means "I am not a partner", and most sellers
    will start there.
    """
    pct = round(_clamp_pct(value), 2)
    if pct > ceiling:
        raise ValueError(f"{what} cannot be more than {ceiling:g}%.")
    return pct


def terms_ok(platform_fee_pct, buyer_cutback_pct) -> None:
    """Refuse a pair that would break the offer. Raises ValueError with words a
    seller can act on, never a code."""
    fee = _clamp_pct(platform_fee_pct)
    cut = _clamp_pct(buyer_cutback_pct)
    if fee + cut > MAX_COMBINED_PCT:
        raise ValueError(
            f"Our fee plus the buyer's cutback cannot be more than "
            f"{MAX_COMBINED_PCT:g}% together."
        )


def cutback_kes(price, buyer_cutback_pct) -> Optional[int]:
    """What the buyer gets back, in whole shillings, or None when there is no
    price to cut (ask_me, or a row with no amount).

    Rounded down so we never promise a shilling the seller did not offer.
    """
    if price is None:
        return None
    cut = _clamp_pct(buyer_cutback_pct)
    if cut <= 0:
        return None
    amount = Decimal(str(price)) * Decimal(str(cut)) / Decimal("100")
    value = int(amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return value if value > 0 else None


def buyer_price(price, buyer_cutback_pct) -> Optional[float]:
    """The price the buyer actually pays after the cutback."""
    cut = cutback_kes(price, buyer_cutback_pct)
    if price is None:
        return None
    if cut is None:
        return float(price)
    return round(float(price) - cut, 2)


def boost_weight(density: int) -> float:
    """How much a cutback may move an offer inside the partner band.

    `density` is the number of live offers in the same town and category. With
    nobody to choose between, money changes nothing (the "open space" today);
    as a category fills, a better cutback is worth a nudge — never an override,
    which is `band_order`'s job to enforce against the organic list.
    """
    try:
        count = int(density)
    except (TypeError, ValueError):
        count = 0
    for threshold, weight in DENSITY_RAMP:
        if threshold is None or count < threshold:
            return weight
    return DENSITY_RAMP[-1][1]


def partner_score(item: dict, *, density: int) -> Decimal:
    """The order key inside the band: cutback first, then the honest constants.

    Ranking may read one money number — the buyer's — and nothing else. Our fee
    is deliberately absent, and there is a test asserting that.
    """
    cut = Decimal(str(_clamp_pct(item.get("buyer_cutback_pct"))))
    weight = Decimal(str(boost_weight(density)))
    # Verified offers stay ahead of unverified ones at equal cutback, because a
    # verification is somebody checking, and money cannot buy it.
    verified = Decimal("1") if item.get("verified") else Decimal("0")
    return cut * weight + verified * Decimal("0.5")


def band_order(items: list, *, density: int, slots: int = BAND_SLOTS) -> list:
    """The labelled strip: at most `slots` partner offers, best cutback first."""
    partners = [i for i in items if _clamp_pct(i.get("buyer_cutback_pct")) > 0]
    partners.sort(key=lambda i: partner_score(i, density=density), reverse=True)
    return partners[: max(0, slots)]


def organic_order(items: list) -> list:
    """Everything else, in the order the caller already earned.

    This function never reads a percentage. It exists so the split is explicit
    in code rather than a comment: the band and the organic list are two lists.
    """
    return [i for i in items if not _clamp_pct(i.get("buyer_cutback_pct"))]


def never_above(items: list, *, is_partner, buyer_price_of) -> list:
    """Enforce the sentence the whole design rests on:

        A paying partner can never appear above a cheaper verified offer.

    `items` is the order the caller wants to publish. Each partner is walked in
    turn; every cheaper offer we did not sell that currently sits *below* that
    partner is lifted to directly above it, keeping its own relative order.
    Pure: returns a new list and never mutates the input.
    """
    ordered = list(items)
    for partner in [i for i in ordered if is_partner(i)]:
        partner_price = buyer_price_of(partner)
        if partner_price is None:
            continue
        position = ordered.index(partner)
        cheaper = [
            i for i in ordered[position + 1:]
            if not is_partner(i)
            and buyer_price_of(i) is not None
            and buyer_price_of(i) < partner_price
        ]
        if not cheaper:
            continue
        rest = [i for i in ordered if i is not partner and all(i is not c for c in cheaper)]
        at = rest.index(ordered[position - 1]) + 1 if position > 0 else 0
        ordered = rest[:at] + cheaper + [partner] + rest[at:]
    return ordered

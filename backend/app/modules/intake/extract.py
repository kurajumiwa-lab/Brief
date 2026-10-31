"""From photographed signage to rows — the extraction rules, and nothing else.

This file is pure: text in, candidate records out. No database, no OCR engine,
no HTTP. That is deliberate, because this is the part that will be wrong most
often and therefore the part that must be cheap to test and change. Every rule
below was written against real screenshots of Kenyan wholesale advertising
(Khetia "Pekee", Nairobi) rather than invented:

    "Maya diapers bale@ksh 2100/-"          → Maya diapers bale · 2,100
    "PersilSensitive/LavenderGel (3L) Ksh999" → Persil Sensitive/Lavender Gel · 999 · 3 l
    "Salt cooking oil20litres@ksh4000/-"    → Salt cooking oil · 4,000 · 20 l
    "Doffi 10Kg Ksh850"                     → Doffi · 850 · 10 kg
    "0104211141"                            → a phone, not a product
    "Shop with us today and get free delivery" → noise, on every card

Two things this file refuses to do, on purpose:

* **It never invents a price.** A line with no number is not a product price at
  any confidence — it is a label. Signage that says "Market price" produces a
  row with `price_kes=None`, which is a different and honest thing.
* **It never resolves a name to a catalogue item.** "Doffi" is a brand; whether
  it is the 10 kg bag we stock is a human's call. The extractor reports what the
  photograph said, and `service` decides what to do with it.
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

# ── prices ────────────────────────────────────────────────────────────────────
# "ksh 2100", "Ksh999", "KES 2,800", "sh 700" are the same statement.
_PRICE = re.compile(r"\b(?:ksh|kes|sh)\s*\.?\s*([\d][\d,]*)", re.IGNORECASE)
# "2100/-", "850/=", "2800 /-" — the Kenyan shorthand, with or without a currency.
_PRICE_SLASH = re.compile(r"([\d][\d,]*)\s*(?:/-|/=|/\b)", re.IGNORECASE)
# "25Kgs Ksh2800" is a quantity and a price; the bare-number-with-unit case is
# handled by the quantity rule below so a size never becomes a price.

# ── quantities ────────────────────────────────────────────────────────────────
_UNIT_ALIASES = {
    "kg": "kg", "kgs": "kg", "kilo": "kg", "kilos": "kg", "kilogram": "kg", "kilograms": "kg",
    "g": "g", "gs": "g", "gm": "g", "gms": "g", "gram": "g", "grams": "g",
    "ml": "ml", "mls": "ml",
    "l": "l", "lt": "l", "ltr": "l", "ltrs": "l", "litre": "l", "litres": "l",
    "liter": "l", "liters": "l",
    "pc": "pcs", "pcs": "pcs", "piece": "pcs", "pieces": "pcs",
    "pack": "pack", "packs": "pack", "packet": "pack", "packets": "pack", "pkt": "pack", "pkts": "pack",
    "bale": "bale", "bales": "bale",
    "carton": "carton", "cartons": "carton", "ctn": "carton", "ctns": "carton",
    "dozen": "dozen", "dozens": "dozen", "doz": "dozen",
    "sack": "sack", "sacks": "sack", "bag": "bag", "bags": "bag",
    "roll": "roll", "rolls": "roll", "tray": "tray", "trays": "tray",
    "tin": "tin", "tins": "tin", "bottle": "bottle", "bottles": "bottle",
}
_UNIT_PATTERN = "|".join(sorted(_UNIT_ALIASES, key=len, reverse=True))
_QUANTITY = re.compile(
    rf"(?<![\w.])(\d+(?:\.\d+)?)\s*({_UNIT_PATTERN})(?![\w])", re.IGNORECASE
)

# ── contacts ──────────────────────────────────────────────────────────────────
# Kenyan mobile in every shape it is written on a sign: 0712 345 678,
# +254712345678, 254-712-345678, 0104 211 141 (Safaricom 01x is now common).
_PHONE = re.compile(r"(?:\+?254|0)\s?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}")

# Words that name a *container*, never a product. On a price board they appear
# as a second line under the item ("Bale", "Carton", "1,250/-"), so read alone
# they become a product called "Carton" — the single most common kind of junk
# this extractor produced before the rule existed.
_CONTAINER_ONLY = {
    "bale", "bales", "carton", "cartons", "ctn", "pack", "packs", "packet",
    "pcs", "pc", "piece", "pieces", "box", "boxes", "bag", "bags", "sack",
    "tin", "tins", "roll", "rolls", "now", "only", "offer", "each", "per",
    "dz", "dozen", "sle", "bundle", "bundles",
}

# A cheap, honest category guess. Not a classifier and not claimed to be one:
# it maps a word on the sign to the shelf a buyer would look on, and `None`
# when the sign says nothing recognisable.
_CATEGORY_WORDS = (
    ("diapers", ("diaper", "pampers", "nappy", "nappies", "adult pant", "baby")),
    ("rice & grains", ("rice", "basmati", "ngano", "maize", "posho", "unga", "grain", "sugar")),
    ("cooking oil & fats", ("cooking oil", "salit", "oil 20", "margarine", "fat")),
    ("cleaning & laundry", ("omo", "ariel", "persil", "detergent", "soap", "washing", "cleaning", "clinging", "cling film", "dish")),
    ("tissue & paper", ("tissue", "toilet", "serviette", "paper", "kitchen towel")),
    ("plastics & utensils", ("chair", "dinner set", "dustbin", "bucket", "utensil", "plastic")),
    ("beverages", ("milk", "juice", "soda", "tea", "coffee", "water", "drink")),
    ("snacks & confectionery", ("biscuit", "biscoff", "crisps", "crisp", "chocolate", "chewing", "orbit", "pringles", "gum")),
    ("canned & pantry", ("tomato", "cheese", "canned", "ketchup", "sauce", "beans")),
)


def guess_category(text: str) -> Optional[str]:
    lowered = (text or "").lower()
    for category, words in _CATEGORY_WORDS:
        if any(word in lowered for word in words):
            return category
    return None


# ── noise ─────────────────────────────────────────────────────────────────────
# Slogans, calls to action and platform chrome. These lines appear on almost
# every card in a wholesale feed, and left alone each one becomes a "product".
_NOISE_PHRASES = (
    "shop with us", "free delivery", "we deliver", "delivery countrywide",
    "deliver countrywide", "order now", "make order", "weka order", "tuachie",
    "contact our number", "contact us", "save big", "we accept", "wholesale offer",
    "offer instock", "in stock", "fully stocked", "available in offer",
    "our number is in the bio", "follow for", "tap the link", "dm for",
    "message", "following", "followers", "pinned", "sponsored", "for you",
    "home", "friends", "inbox", "profile", "search", "ad ",
    "trusted wholesale partner", "quality products", "unbeatable prices",
    "reliable delivery", "customer satisfaction",
)
# A line that is only a number is a clock, a view count or a like count.
_ONLY_NUMBER = re.compile(r"^[\d\s:.,+/%-]+$")
_ONLY_TAGS = re.compile(r"^(?:#\w+\s*)+$")
_ONLY_BULLETS = re.compile(r"^[\W_]+$")

MAX_PRODUCT_CHARS = 120


def _squash(text: str) -> str:
    return " ".join((text or "").split())


def looks_like_noise(line: str) -> bool:
    """Is this platform chrome / a slogan rather than something for sale?"""
    text = _squash(line)
    if len(text) < 3 or _ONLY_BULLETS.match(text):
        return True
    if _ONLY_NUMBER.match(text) or _ONLY_TAGS.match(text):
        return True
    # A line that states a price is something for sale, whatever words it uses.
    # "Plastic chairs wholesale offer@ksh399/-" is a product; "wholesale offer"
    # alone, with no number, is a banner. The price is the discriminator.
    if parse_price(text) is not None:
        return False
    lowered = text.lower()
    if any(phrase in lowered for phrase in _NOISE_PHRASES):
        return True
    # A line that is only a phone number is a contact, never a product.
    if normalise_phone(text) and len(_PHONE.sub("", text).strip(" -/|·")) < 2:
        return True
    return False


def parse_price(line: str) -> Optional[int]:
    """The first plausible shilling amount on a line, or None.

    Plausible means 10–10,000,000: a price board does not say 4, and a typo of
    400,000,000 is not a bag of sugar. A size ("500ml") is not read as a price
    because it always carries a unit and this rule never looks at bare numbers.
    """
    for pattern in (_PRICE, _PRICE_SLASH):
        for match in pattern.finditer(line or ""):
            digits = match.group(1).replace(",", "")
            if not digits.isdigit():
                continue
            value = int(digits)
            if 10 <= value <= 10_000_000:
                return value
    return None


def price_is_absent(line: str) -> bool:
    return parse_price(line) is None


def parse_quantity(line: str) -> tuple[Optional[float], Optional[str]]:
    """The first size/weight/pack on a line: ("3", "l"), ("10", "kg"), or (None, None).

    OCR glues the size to the product ("oil20litres"), so a second attempt is
    made with a space forced between a letter and a digit before giving up.
    """
    text = line or ""
    match = _QUANTITY.search(text)
    if not match:
        match = _QUANTITY.search(re.sub(r"(?<=[A-Za-z])(?=\d)", " ", text))
    if not match:
        return None, None
    try:
        value = float(match.group(1))
    except ValueError:  # pragma: no cover - the regex only matches numbers
        return None, None
    unit = _UNIT_ALIASES.get(match.group(2).lower())
    return (value, unit) if unit else (None, None)


def normalise_phone(text: str) -> Optional[str]:
    """A Kenyan mobile number in one shape: +2547XXXXXXXX. None when absent."""
    match = _PHONE.search(text or "")
    if not match:
        return None
    digits = re.sub(r"\D", "", match.group(0))
    if digits.startswith("254"):
        digits = digits[3:]
    elif digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 9 or digits[0] not in "17":
        return None
    return f"+254{digits}"


def clean_product_name(line: str, price: Optional[int]) -> str:
    """The words that describe the thing, with the price and the salesmanship removed.

    "Plastic chairs wholesale offer@ksh 399/-" → "Plastic chairs" plus the
    `wholesale` flag, which `extract` records separately: whether a price is a
    wholesale price is *information*, not part of the product name.
    """
    text = _squash(line)
    text = _PRICE.sub(" ", text)
    text = _PRICE_SLASH.sub(" ", text)
    text = text.replace("@", " ").replace("#", " ")
    text = re.sub(r"\b(?:wholesale|offer|offers|price|pricing|cost|only|at|for)\b\.?", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"^\s*per\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*[/-]{1,2}\s*$", "", text)
    text = re.sub(r"\s*[-–—/|·:]+\s*$", "", text)
    text = _squash(text.strip(" .,-–—/|·:"))
    if not text:
        return ""
    # OCR often loses a space after a parenthesis: "Persil (3L)" is fine, but
    # "Doffi10Kg" becomes "Doffi 10kg" so the quantity rule and the reader both
    # see a name and a size.
    text = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", text)
    text = re.sub(r"(?<=\d)(?=[A-Za-z])", " ", text)
    # OCR loses the space in camel-case brand names: "PersilSensitive" is two
    # words on the packet. Only split lower→upper, so "KSH" and "L" survive.
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)
    text = _squash(text)
    if text.isupper() and len(text) > 3:
        text = text.title()
    return text[:MAX_PRODUCT_CHARS].strip()


def is_quantity_only(text: str) -> bool:
    """Is this line nothing but a size and a price — a continuation of a product?

    "25Kgs Ksh2800" is printed *under* the rice bag on the next card, not as a
    product called "25Kgs". A human reads it as the previous item's price; so
    does `extract`, which merges it into the row above.
    """
    stripped = _squash(text)
    if not stripped:
        return False
    without_quantity = _QUANTITY.sub("", stripped)
    return bool(_QUANTITY.search(stripped)) and not re.sub(r"[\d\s.,/-]", "", without_quantity)


def is_wholesale(line: str) -> bool:
    return "wholesale" in (line or "").lower()


def confidence_for(name: str, price: Optional[int], unit: Optional[str]) -> float:
    """How much of the statement we actually read, as a number a human can triage.

    Nothing here is a probability of correctness — it is a measure of *evidence*:
    a name and a price and a unit is a complete statement (0.85), a name and a
    price is most of one (0.7), a name alone is a label (0.4). Anything below
    0.5 is shown to the operator with a question mark rather than pre-selected.
    """
    if not name:
        return 0.0
    score = 0.4
    if price is not None:
        score += 0.3
    if unit:
        score += 0.1
    if len(name.split()) >= 2:
        score += 0.05
    if len(name.split()) >= 4:
        score += 0.05
    return round(min(score, 0.95), 2)


def extract(lines: Iterable[str], *, known_markets: Iterable[str] = ()) -> dict:
    """Turn OCR lines into `{observations, phones, seller_hint, seller_candidates, market_hint}`.

    `observations` are ordered as they appeared, de-duplicated by
    (name lowercased, price) — a collage repeats the same card, and three copies
    of "Doffi 10 kg Ksh850" is one market fact, not three.
    """
    markets = [m.strip().lower() for m in known_markets if m and m.strip()]
    observations: list[dict] = []
    seen: set[tuple[str, Optional[int]]] = set()
    phones: list[str] = []
    name_counts: dict[str, int] = {}
    brandish: list[str] = []
    skipped: list[dict] = []
    market_hit: Optional[str] = None

    for raw in lines or []:
        line = _squash(raw)
        if not line:
            continue

        phone = normalise_phone(line)
        if phone and phone not in phones:
            phones.append(phone)
        if market_hit is None and markets:
            lowered = line.lower()
            for market in markets:
                if market in lowered:
                    market_hit = line
                    break

        if looks_like_noise(line):
            continue

        price = parse_price(line)

        # A banner line: short, no price, and either all caps or quoted.
        stripped = line.strip()
        if price_is_absent(stripped) and 1 <= len(stripped.split()) <= 3:
            if stripped.isupper() or (stripped.startswith('"') and stripped.endswith('"')):
                brandish.append(clean_product_name(stripped, None).strip().strip('"'))

        # "25Kgs Ksh2800" printed under a bag belongs to the row above it.
        if is_quantity_only(line) and observations:
            previous = observations[-1]
            if previous["price_kes"] is None and price is not None:
                previous["price_kes"] = price
                previous["confidence"] = confidence_for(
                    previous["product"], price, previous["unit"]
                )
            if previous["unit"] is None:
                quantity, unit = parse_quantity(line)
                previous["quantity"], previous["unit"] = quantity, unit
            continue

        name = clean_product_name(line, price)
        if not name or looks_like_noise(name):
            continue
        if is_quantity_only(name):
            # A size and a price with no product on the same line: the operator
            # is told, rather than being handed a product called "25Kgs".
            skipped.append({"reason": "size without a product", "raw_line": line[:200]})
            continue
        quantity, unit = parse_quantity(line)
        # The name is cleaner than the raw line ("oil20litres" → "oil 20 litres"),
        # so a size the raw pass could not see is often visible after cleaning.
        if unit is None:
            quantity, unit = parse_quantity(name)

        # This dataset is *prices*. A line with no shilling amount is a label on
        # a photograph — "Doffi", "Book Now", "Live Support" — and 200 of those
        # bury the 9 rows that matter. It is not dropped: it is reported as
        # skipped, so the operator can see what was read and not used.
        if price is None:
            skipped.append({"reason": "no price", "raw_line": line[:200], "product": name})
            continue

        if not re.search(r"[A-Za-z]{3,}", name):
            skipped.append({"reason": "no product word", "raw_line": line[:200]})
            continue
        if name.lower() in _CONTAINER_ONLY:
            skipped.append({"reason": "container word", "raw_line": line[:200]})
            continue

        # "Salit cooking oil" and "Salitcooking oil" are the same bag; OCR only
        # differs in a lost space, and both become the same market fact.
        key = (re.sub(r"[^a-z0-9]", "", name.lower()), price)
        if key in seen:
            continue
        seen.add(key)

        observations.append({
            "product": name,
            "price_kes": price,
            "quantity": quantity,
            "unit": unit,
            "category": guess_category(name),
            "confidence": confidence_for(name, price, unit),
            "wholesale": is_wholesale(line),
            "raw_line": line[:MAX_PRODUCT_CHARS * 2],
        })

        # A seller's name is a line with no price that keeps appearing. Counting
        # occurrences is the cheapest honest signal; a human confirms it.
        if price is None and 1 <= len(name.split()) <= 4:
            name_counts[name] = name_counts.get(name, 0) + 1

    ranked = sorted(name_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    # A shop's name is printed as a banner: few words, no price, usually the
    # only all-caps line in the picture. Product lines are title case and are
    # counted separately, so a repeated product is never reported as the seller.
    brands = [name for name in brandish if name.lower() not in _NOISE_PHRASES]
    brand_ranked = sorted(
        {b: brands.count(b) for b in brands}.items(), key=lambda kv: (-kv[1], kv[0])
    )
    seller_candidates = [name for name, _ in brand_ranked[:2]] + [name for name, _ in ranked[:2]]
    seen_candidates: list[str] = []
    for candidate in seller_candidates:
        if candidate not in seen_candidates:
            seen_candidates.append(candidate)
    seller_candidates = seen_candidates[:3]
    seller = None
    if brand_ranked and brand_ranked[0][1] >= 2:
        seller = brand_ranked[0][0]
    elif ranked and ranked[0][1] >= 2:
        seller = ranked[0][0]

    return {
        "observations": observations,
        "phones": phones,
        "seller_hint": seller,
        "seller_candidates": seller_candidates,
        "market_hint": market_hit,
        "skipped": skipped,
    }

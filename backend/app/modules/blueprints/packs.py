"""Template packs: a shelf offers a *choice*, not a blank form.

The brief asks for "a category of templates to stimulate choice due to
difference in offering, options or type of business". A blank page editor asks a
wholesaler in Kisii to invent a wholesaler's page; this asks them to pick one.

A pack is data, not code. Each one is:

    key, label, sector, summary      what it is, in the owner's words
    preset                           the page preset it starts from
    offers[]                         starter offers: title, kind, price, unit, mode
    blueprint                        the free starter steps that go with it
    suggested_terms                  platform_fee_pct / buyer_cutback_pct + why
    first_observations[]             the three prices worth photographing first

Two rules, enforced in the service rather than promised here:

1. Everything a pack creates is a **draft**. Nothing goes live in an owner's name
   before they have read it.
2. A pack never invents a price. Every starter offer is `ask_me` until the owner
   states their own number; a template that guesses a price teaches a business
   to guess.

`line_key` links a pack to the trade-line suggestions in
`app/modules/offerings/service.py::SUGGESTIONS`, so the percentages a pack
proposes are the same ones the terms form quotes.
"""

from __future__ import annotations

#: The starter offers are all `ask_me`: we do not know this business's numbers.
ASK = "ask_me"


PACKS = [
    {
        "key": "dry-goods-wholesale",
        "label": "Dry goods wholesaler",
        "sector": "retail",
        "line_key": "dry_goods",
        "summary": "Bales, cartons and sacks sold by the piece or by the dozen, with a price list buyers can compare.",
        "preset": "shop",
        "offers": [
            {"title": "Sugar, 50kg bale", "kind": "goods", "price_unit": "bale", "price_mode": ASK},
            {"title": "Maize flour, 24-pack bale", "kind": "goods", "price_unit": "bale", "price_mode": ASK},
            {"title": "Cooking oil, 20L jerrican", "kind": "goods", "price_unit": "jerrican", "price_mode": ASK},
            {"title": "Rice, 25kg bag", "kind": "goods", "price_unit": "bag", "price_mode": ASK},
            {"title": "Bulk order of 20+ bales", "kind": "service", "price_unit": "order", "price_mode": ASK},
        ],
        "blueprint": "market-stall",
        "first_observations": ["Sugar 50kg bale", "Maize flour bale", "Cooking oil 20L"],
    },
    {
        "key": "fresh-produce",
        "label": "Fresh produce trader",
        "sector": "agriculture",
        "line_key": "fresh_produce",
        "summary": "What is in season this week, by the crate or the kilo, with a collection point buyers can find.",
        "preset": "shop",
        "offers": [
            {"title": "Tomatoes, per crate", "kind": "goods", "price_unit": "crate", "price_mode": ASK},
            {"title": "Onions, per kg", "kind": "goods", "price_unit": "kg", "price_mode": ASK},
            {"title": "Kale, per sack", "kind": "goods", "price_unit": "sack", "price_mode": ASK},
            {"title": "Weekly supply to a hotel or school", "kind": "service", "price_unit": "week", "price_mode": ASK},
        ],
        "blueprint": "market-stall",
        "first_observations": ["Tomatoes crate", "Onions kg", "Kale sack"],
    },
    {
        "key": "duka-shop",
        "label": "Duka / neighbourhood shop",
        "sector": "retail",
        "line_key": "shop_retail",
        "summary": "The everyday lines a shop actually sells, with prices and opening hours a neighbour can check.",
        "preset": "shop",
        "offers": [
            {"title": "Unga 2kg", "kind": "goods", "price_unit": "packet", "price_mode": ASK},
            {"title": "Cooking fat 1kg", "kind": "goods", "price_unit": "packet", "price_mode": ASK},
            {"title": "Soap bar", "kind": "goods", "price_unit": "bar", "price_mode": ASK},
            {"title": "Home delivery within 2 km", "kind": "service", "price_unit": "delivery", "price_mode": ASK},
        ],
        "blueprint": "market-stall",
        "first_observations": ["Unga 2kg", "Cooking fat 1kg", "Soap bar"],
    },
    {
        "key": "cleaning-services",
        "label": "Cleaning and home services",
        "sector": "services",
        "line_key": "services",
        "summary": "Fixed-scope jobs with a starting price, the area served, and what is included before anyone books.",
        "preset": "service",
        "offers": [
            {"title": "Deep clean, 2-bedroom house", "kind": "service", "price_unit": "job", "price_mode": ASK},
            {"title": "Office cleaning, per visit", "kind": "service", "price_unit": "visit", "price_mode": ASK},
            {"title": "Sofa and carpet cleaning", "kind": "service", "price_unit": "job", "price_mode": ASK},
            {"title": "Post-construction clean", "kind": "service", "price_unit": "job", "price_mode": ASK},
        ],
        "blueprint": "beauty-salon",
        "first_observations": [],
    },
    {
        "key": "equipment-rental",
        "label": "Equipment and rentals",
        "sector": "logistics",
        "line_key": "equipment",
        "summary": "What you rent out, the day rate, and the deposit terms stated before a customer travels to you.",
        "preset": "shop",
        "offers": [
            {"title": "Sound system, per day", "kind": "tool", "price_unit": "day", "price_mode": ASK},
            {"title": "Plastic chairs, per 100", "kind": "tool", "price_unit": "day", "price_mode": ASK},
            {"title": "Water pump and pipes", "kind": "tool", "price_unit": "day", "price_mode": ASK},
            {"title": "Delivery and collection", "kind": "service", "price_unit": "trip", "price_mode": ASK},
        ],
        "blueprint": "market-stall",
        "first_observations": [],
    },
    {
        "key": "hardware-yard",
        "label": "Hardware and building supplies",
        "sector": "construction",
        "line_key": "hardware",
        "summary": "Materials by the bag, sheet or piece, with a price list a contractor can quote from.",
        "preset": "shop",
        "offers": [
            {"title": "Cement, 50kg bag", "kind": "goods", "price_unit": "bag", "price_mode": ASK},
            {"title": "Iron sheets, 3m", "kind": "goods", "price_unit": "sheet", "price_mode": ASK},
            {"title": "Ballast, per tonne", "kind": "goods", "price_unit": "tonne", "price_mode": ASK},
            {"title": "Delivery to site", "kind": "service", "price_unit": "trip", "price_mode": ASK},
        ],
        "blueprint": "market-stall",
        "first_observations": ["Cement 50kg", "Iron sheets 3m"],
    },
    {
        "key": "agrovet",
        "label": "Agrovet and farm inputs",
        "sector": "agriculture",
        "line_key": "agrovet",
        "summary": "Seeds, feeds and treatments with units farmers actually buy, plus advice hours.",
        "preset": "shop",
        "offers": [
            {"title": "Maize seed, 1kg", "kind": "goods", "price_unit": "packet", "price_mode": ASK},
            {"title": "Poultry feed, 50kg", "kind": "goods", "price_unit": "bag", "price_mode": ASK},
            {"title": "Fertiliser, 50kg", "kind": "goods", "price_unit": "bag", "price_mode": ASK},
            {"title": "Farm visit and advice", "kind": "service", "price_unit": "visit", "price_mode": ASK},
        ],
        "blueprint": "market-stall",
        "first_observations": ["Maize seed 1kg", "Poultry feed 50kg", "Fertiliser 50kg"],
    },
    {
        "key": "salon-barber",
        "label": "Salon and barber",
        "sector": "beauty",
        "line_key": "services",
        "summary": "A service menu with durations and prices, so a walk-in knows the cost before sitting down.",
        "preset": "service",
        "offers": [
            {"title": "Wash and blow dry", "kind": "service", "price_unit": "visit", "price_mode": ASK},
            {"title": "Braiding", "kind": "service", "price_unit": "visit", "price_mode": ASK},
            {"title": "Beard trim", "kind": "service", "price_unit": "visit", "price_mode": ASK},
            {"title": "Bridal package", "kind": "service", "price_unit": "event", "price_mode": ASK},
        ],
        "blueprint": "beauty-salon",
        "first_observations": [],
    },
    {
        "key": "food-catering",
        "label": "Food and catering",
        "sector": "food",
        "line_key": "services",
        "summary": "Menus priced per plate, minimum order, and a hygiene note a client can read.",
        "preset": "service",
        "offers": [
            {"title": "Lunch, per plate (min 20)", "kind": "service", "price_unit": "plate", "price_mode": ASK},
            {"title": "Event catering, per head", "kind": "service", "price_unit": "head", "price_mode": ASK},
            {"title": "Bulk cooking gas refill", "kind": "tool", "price_unit": "refill", "price_mode": ASK},
        ],
        "blueprint": "food-catering",
        "first_observations": [],
    },
    {
        "key": "boda-transport",
        "label": "Boda and delivery",
        "sector": "logistics",
        "line_key": "services",
        "summary": "Delivery runs priced by distance or trip, with the area covered and a WhatsApp booking line.",
        "preset": "service",
        "offers": [
            {"title": "Same-day delivery within town", "kind": "service", "price_unit": "trip", "price_mode": ASK},
            {"title": "Market run, per trip", "kind": "service", "price_unit": "trip", "price_mode": ASK},
            {"title": "Monthly errand subscription", "kind": "service", "price_unit": "month", "price_mode": ASK},
        ],
        "blueprint": "market-stall",
        "first_observations": [],
    },
    {
        "key": "tailoring",
        "label": "Tailor and clothing",
        "sector": "creative",
        "line_key": "services",
        "summary": "What you make, how long it takes, and the price range before fabric is discussed.",
        "preset": "service",
        "offers": [
            {"title": "School uniform set", "kind": "service", "price_unit": "set", "price_mode": ASK},
            {"title": "Alteration", "kind": "service", "price_unit": "piece", "price_mode": ASK},
            {"title": "Kitenge dress", "kind": "service", "price_unit": "piece", "price_mode": ASK},
            {"title": "Fabric, per metre", "kind": "goods", "price_unit": "metre", "price_mode": ASK},
        ],
        "blueprint": "beauty-salon",
        "first_observations": [],
    },
    {
        "key": "repairs-tools",
        "label": "Repair and technical services",
        "sector": "services",
        "line_key": "services",
        "summary": "Callout price, working hours and the brands you service — the three questions every caller asks.",
        "preset": "service",
        "offers": [
            {"title": "Callout and diagnosis", "kind": "service", "price_unit": "visit", "price_mode": ASK},
            {"title": "Phone screen replacement", "kind": "service", "price_unit": "job", "price_mode": ASK},
            {"title": "Fridge or freezer repair", "kind": "service", "price_unit": "job", "price_mode": ASK},
        ],
        "blueprint": "market-stall",
        "first_observations": [],
    },
]

BY_KEY = {pack["key"]: pack for pack in PACKS}


def list_packs(*, sector: str | None = None) -> list[dict]:
    """The library, without the steps: enough to choose, nothing to copy yet."""
    out = []
    for pack in PACKS:
        if sector and pack["sector"] != sector:
            continue
        out.append({
            "key": pack["key"],
            "label": pack["label"],
            "sector": pack["sector"],
            "summary": pack["summary"],
            "preset": pack["preset"],
            "offer_count": len(pack["offers"]),
            "blueprint": pack["blueprint"],
            "first_observations": list(pack.get("first_observations") or []),
            "cost": "Free",
        })
    return out

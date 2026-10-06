"""Local-business taxonomy — the B2C category tree.

Nextdoor-style top-level groups, Kenyan-localized (Jua Kali, boda boda,
mama fua...). Two matchers:

  * map_place(category)  — for open-data places, whose `category` is the raw
    OSM tag value ("shop:bakery", "amenity:pharmacy", "craft:welder").
  * match_vendor(vendor) — for registered members, whose business_categories
    are free text, matched by keyword.

Both return (group_id, display_label). Unknown categories fall back to a
key-prefix rule, then to "other" — nothing is guessed silently, and a place
with no category at all is "other", not forced into a bucket.
"""

GROUPS = [
    ("food", "Food & Drink"),
    ("fresh", "Farm & Fresh Produce"),
    ("health", "Health & Medical"),
    ("auto", "Automotive"),
    ("artisans", "Artisans & Repairs (Jua Kali)"),
    ("home", "Home & Living"),
    ("retail", "Shopping & Retail"),
    ("education", "Education & Training"),
    ("family", "Family & Childcare"),
    ("events", "Events & Entertainment"),
    ("hospitality", "Hospitality & Travel"),
    ("finance", "Finance & Services"),
    ("other", "Other"),
]

GROUP_LABEL = dict(GROUPS)

OSM_TO_GROUP = {
    # Food & Drink
    "shop:bakery": "food", "amenity:restaurant": "food", "amenity:cafe": "food",
    "amenity:fast_food": "food", "amenity:bar": "food", "amenity:pub": "food",
    "amenity:ice_cream": "food", "amenity:food_court": "food", "amenity:bbq": "food",
    "amenity:bier_garden": "food", "amenity:drinking_water": "other",
    # Farm & Fresh Produce
    "shop:butcher": "fresh", "shop:greengrocer": "fresh", "amenity:marketplace": "fresh",
    "shop:farm": "fresh",
    # Health & Medical
    "amenity:pharmacy": "health", "amenity:clinic": "health", "amenity:doctor": "health",
    "amenity:hospital": "health", "amenity:dentist": "health", "amenity:veterinary": "health",
    "amenity:optician": "health", "health:clinic": "health", "amenity:sanitary_dump_station": "health",
    # Automotive
    "amenity:fuel": "auto", "shop:car": "auto", "shop:car_parts": "auto", "shop:tyres": "auto",
    "shop:motorcycle": "auto", "shop:bicycle": "auto", "amenity:car_wash": "auto",
    "amenity:parking": "auto", "amenity:car_repair": "auto", "amenity:driving_school": "auto",
    "amenity:charging_station": "auto",
    # Artisans & Repairs (Jua Kali)
    "craft:carpenter": "artisans", "craft:welder": "artisans", "craft:tailor": "artisans",
    "craft:blacksmith": "artisans", "craft:pottery": "artisans", "craft:wood_carver": "artisans",
    "craft:cobbler": "artisans", "craft:shoe_repair": "artisans", "craft:builder": "artisans",
    "craft:plasterer": "artisans", "craft:stonemason": "artisans", "craft:sign_maker": "artisans",
    "craft:metal_construction": "artisans", "craft:window_construction": "artisans",
    "craft:concrete_construction": "artisans", "craft:painting": "artisans",
    "craft:roofer": "artisans", "craft:plumber": "artisans",
    # Home & Living
    "amenity:hairdresser": "home", "shop:beauty": "home", "amenity:laundry": "home",
    "shop:furniture": "home", "shop:electronics": "home", "shop:hardware": "home",
    "shop:doityourself": "home", "shop:houseware": "home", "shop:interior_decoration": "home",
    "shop:interior_design": "home", "shop:second_hand": "home", "amenity:shelter": "other",
    # Shopping & Retail
    "shop:clothes": "retail", "shop:shoes": "retail", "shop:mobile_phone": "retail",
    "shop:books": "retail", "shop:gift": "retail", "shop:toys": "retail", "shop:cosmetics": "retail",
    "shop:supermarket": "retail", "shop:department_store": "retail", "amenity:mall": "retail",
    "shop:jewelry": "retail", "shop:optician": "retail", "shop:convenience": "retail",
    "shop:general": "retail", "shop:outdoor": "retail", "shop:varied_goods": "retail",
    "shop:fashion_accessories": "retail", "shop:stationery": "retail", "shop:office_supplies": "retail",
    # Education & Training
    "amenity:school": "education", "amenity:college": "education", "amenity:university": "education",
    "amenity:language_school": "education", "office:educational_institution": "education",
    "amenity:music_school": "education",
    # Family & Childcare
    "amenity:day_care": "family", "amenity:kindergarten": "family", "amenity:nursery": "family",
    # Events & Entertainment
    "amenity:theatre": "events", "amenity:cinema": "events", "leisure:stadium": "events",
    "amenity:events": "events", "amenity:conference_centre": "events",
    # Hospitality & Travel
    "amenity:hotel": "hospitality", "amenity:guest_house": "hospitality", "tourism:hotel": "hospitality",
    "tourism:apartments": "hospitality", "amenity:camp_site": "hospitality",
    "tourism:camp_site": "hospitality", "amenity:caravan_site": "hospitality", "tourism:motel": "hospitality",
    "amenity:chalet": "hospitality",
    # Finance & Services
    "amenity:bank": "finance", "amenity:post_office": "finance", "office:accountant": "finance",
    "office:lawyer": "finance", "office:estate_agent": "finance", "office:insurance": "finance",
    "office:company": "finance", "office:it_consultant": "finance", "office:consulting": "finance",
}

# When the full tag isn't mapped, the OSM key alone is a decent signal.
KEY_FALLBACK = {
    "shop": "retail", "craft": "artisans", "amenity": "other", "office": "finance",
    "tourism": "hospitality", "leisure": "events", "health": "health",
    "building": "other", "landuse": "other", "natural": "other",
}


def map_place(category):
    """OSM category string -> (group_id, label)."""
    if not category:
        return "other", GROUP_LABEL["other"]
    cat = category.strip().lower()
    if cat in OSM_TO_GROUP:
        g = OSM_TO_GROUP[cat]
        return g, GROUP_LABEL[g]
    key = cat.split(":", 1)[0]
    if key in KEY_FALLBACK:
        g = KEY_FALLBACK[key]
        return g, GROUP_LABEL[g]
    return "other", GROUP_LABEL["other"]


# Keyword matching for registered members (free-text categories + name).
VENDOR_KEYWORDS = [
    ("health", ["pharmacy", "chemist", "clinic", "hospital", "doctor", "dentist", "dental", "lab", "laboratory", "medical", "optician", "vet", "veterinary", "pharma"]),
    ("food", ["bakery", "restaurant", "cafe", "café", "cater", "food", "kitchen", "grill", "snack", "juice", "smoothie", "cook", "chef", "bakers", "coffee"]),
    ("fresh", ["vegetable", "fruit", "grocer", "farm", "fresh", "dairy", "eggs", "maize", "grain", "butchery", "meat", "fish"]),
    ("auto", ["fuel", "car ", "vehicle", "mechanic", "boda", "bike", "motorcycle", "tyre", "tire", "wash", "driving school", "auto", "spare parts", "dealership"]),
    ("artisans", ["carpenter", "welder", "welding", "tailor", "blacksmith", "jua kali", "fabricat", "plasterer", "builder", "construction", "mason", "sign", "furniture maker", "cobbler"]),
    ("home", ["hair", "beauty", "salon", "laundry", "furniture", "electronics", "hardware", "plumber", "electrician", "painter", "pest", "cleaning", "mover", "decoration", "interior", "house help", "mama fua", "barber"]),
    ("retail", ["clothes", "shop", "store", "supermarket", "books", "phone", "mobile", "shoes", "fashion", "stationery", "gifts", "toys", "cosmetics", "retail", "boutique"]),
    ("education", ["school", "college", "university", "tutor", "tutoring", "training", "lessons", "academy", "class", "course", "vocational"]),
    ("family", ["daycare", "day care", "nursery", "kindergarten", "babysit", "nanny", "childcare", "child care"]),
    ("events", ["event", "photo", "photography", "video", "dj", "music", "banquet", "wedding", "decor", "venue", "catering hall"]),
    ("hospitality", ["hotel", "guesthouse", "guest house", "bnb", "hostel", "airbnb", "accommodation", "tourism", "travel", "safari"]),
    ("finance", ["bank", "insurance", "lawyer", "accounting", "accountant", "estate", "real estate", "agent", "loan", "sacco", "financial"]),
]


def match_vendor(vendor):
    """Registered member -> (group_id, label) by keyword over name + categories."""
    hay = " ".join([vendor.business_name or ""] + list(vendor.business_categories or []))
    hay = hay.lower()
    for group_id, words in VENDOR_KEYWORDS:
        for w in words:
            if w in hay:
                return group_id, GROUP_LABEL[group_id]
    return "other", GROUP_LABEL["other"]

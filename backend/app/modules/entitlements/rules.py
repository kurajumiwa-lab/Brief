"""Tiers, the plan each tier is sold as, and the feature list.

Plan keys (``starter``, ``readiness``, ``network``) are the values stored on
``vendors.plan_tier``. They stay as they are so existing subscribers keep their
access; the commercial names are shown to users.
"""

TIERS = ("free", "growth", "business_pro")
TIER_RANK = {tier: rank for rank, tier in enumerate(TIERS)}

#: Commercial tier -> the plan key that sells it (prices live in growth/rules.py).
TIER_TO_PLAN = {"free": "starter", "growth": "readiness", "business_pro": "network"}

#: Stored plan key -> commercial tier. Institution is treated as Business Pro so
#: anyone already on it keeps everything they had.
PLAN_TO_TIER = {
    "starter": "free",
    "readiness": "growth",
    "network": "business_pro",
    "institution": "business_pro",
}

#: Seed rows. Used by the migration and to fill any row that is missing, so a
#: missing row fails to the default here, not to "everything open".
FEATURE_SEED: tuple[tuple[str, str, str, str], ...] = (
    ("storefront", "Storefront", "Your shop front. Always free.", "free"),
    ("messaging", "Messaging", "Chat with buyers and sellers. Always free.", "free"),
    ("voice_notes", "Voice notes", "Short voice notes in chat. Always free.", "free"),
    ("search_activities", "Search activities", "Search and post local activities. Always free.", "free"),
    ("advanced_analytics", "Advanced analytics", "Price position against the network and counterparty history.", "growth"),
    ("inventory_automation", "Inventory automation", "Automatic stock updates from your point-of-sale system.", "growth"),
    ("broadcast_tools", "Broadcast tools", "Send one message to many contacts.", "business_pro"),
    ("staff_accounts", "Staff accounts", "Extra logins for your team.", "business_pro"),
)
SEED_BY_KEY = {key: (label, desc, tier) for key, label, desc, tier in FEATURE_SEED}

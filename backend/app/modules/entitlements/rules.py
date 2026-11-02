"""Tiers, the plan each tier is sold as, and the feature list.

Plan keys are the values stored on ``vendors.plan_tier``. Legacy keys stay so
existing subscribers keep their access and their prices.
"""

TIERS = ("free", "growth", "business_pro")
TIER_RANK = {tier: rank for rank, tier in enumerate(TIERS)}

#: Commercial tier -> the plan key that is sold as it.
TIER_TO_PLAN = {"free": "starter", "growth": "growth", "business_pro": "business_pro"}

#: Stored plan key -> commercial tier. The legacy plans (Readiness, Network,
#: Institution) are no longer sold, but their existing customers keep at least
#: what they bought: all of them map to Business Pro, the widest tier.
PLAN_TO_TIER = {
    "starter": "free",
    "growth": "growth",
    "business_pro": "business_pro",
    "readiness": "business_pro",
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
    ("advanced_reporting", "Advanced reporting", "Exportable reports for your records and your accountant.", "business_pro"),
)
SEED_BY_KEY = {key: (label, desc, tier) for key, label, desc, tier in FEATURE_SEED}

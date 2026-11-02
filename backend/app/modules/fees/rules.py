"""Future fee mechanisms. Every rule ships DISABLED with a zero amount.

Free for now: nothing here charges anyone. A rule can only ever produce a fee
when BOTH the deployment switch (FEES_ENABLED) and the rule's own ``enabled``
flag are on. Product transactions never depend on these rules.
"""

#: key, label, what it charges for, basis
#: basis: "flat" (amount_kes per event) or "bps" (rate_bps of the base amount)
FEE_SEED: tuple[tuple[str, str, str, str], ...] = (
    ("membership_monthly", "Flat monthly membership", "Monthly membership fee.", "flat"),
    ("membership_verification", "Verified membership service", "Fee for the verification service.", "flat"),
    ("logistics_coordination", "Logistics coordination", "Fee on a coordinated delivery.", "bps"),
    ("bulk_pool", "Bulk-order pooling", "Fee on a pooled group order.", "bps"),
    ("route_optimisation", "Shared route optimisation", "Fee per optimised shared route.", "flat"),
    ("community_event", "Community event coordination", "Fee per coordinated event.", "flat"),
    ("template_pack", "Professional templates and documents", "Price of a template or document pack.", "flat"),
)
FEE_KEYS = tuple(k for k, *_ in FEE_SEED)
FEE_BASES = ("flat", "bps")
MAX_BPS = 2000  # never more than 20% of the base amount

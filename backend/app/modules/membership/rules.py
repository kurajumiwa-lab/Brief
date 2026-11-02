"""Membership vocabulary. Kept in one place so the API, the admin tools and the
database check constraints all agree."""

CATEGORIES: tuple[tuple[str, str], ...] = (
    ("trader", "Trader or retailer"),
    ("artisan", "Artisan or skilled trade"),
    ("service", "Service provider"),
    ("enterprise", "Enterprise or company"),
    ("institution", "Institution or group"),
    ("community", "Community member"),
)
CATEGORY_KEYS = tuple(k for k, _ in CATEGORIES)

#: Membership standing, set by operators. A suspended member is hidden from the
#: directory and cannot change their profile, but their records are kept.
MEMBERSHIP_STATUSES = ("active", "suspended")

#: Verification is requested by the member and decided by an operator.
VERIFICATION_STATUSES = ("unverified", "pending", "verified", "rejected")

#: Privacy defaults. A new member is NOT listed in the directory until they opt in.
DEFAULT_PRIVACY = {"directory_visible": False, "show_contact": False}

#: The only fields a member may change themselves.
MEMBER_EDITABLE = ("display_name", "category", "professional_class", "bio", "directory_visible", "show_contact")

DIRECTORY_LIMIT = 50

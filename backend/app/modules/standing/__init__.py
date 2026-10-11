"""Business standing — verified facts and the passport (v2.11).

The module owns: the claim catalog (what paperwork Kenyan buyers ask for),
the claim lifecycle (declared → documented → verified, or rejected/expired),
the verifier desk, renewal reminders, the public passport, and readiness
grading against a named checklist. The trade module reads exactly one thing
from here — `service.verified_keys()` — through which opportunity
requirements are checked.

Public interface:

    from app.modules.standing import service, catalog
    await service.verified_keys(db, vendor_id)          # live verified fact keys
    await service.evaluate(db, vendor_id, "agpo_reserved")
    catalog.claim_spec("tax_compliance")                # label, issuer, validity
"""

from app.modules.standing import catalog, service  # noqa: F401
from app.modules.standing.models import (  # noqa: F401
    BusinessClaim,
    ClaimEvent,
    ClaimMethod,
    ClaimStatus,
    StandingProfile,
)

__all__ = [
    "catalog", "service",
    "BusinessClaim", "ClaimEvent", "ClaimMethod", "ClaimStatus", "StandingProfile",
]

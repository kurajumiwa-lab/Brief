"""Hard-coded business rules, plan entitlements, verified marks and six-month rollout (v2.12).

For the initial six-month release, the platform enforces business rules centrally
in code rather than making commercial claims:

    1. Verification: only authorized human reviewers (`VERIFIER_HANDLES`) can
       approve compliance claims; paid plans never automatically confer verification.
    2. Fulfilment marks: calculated strictly from actual eligible completed
       movements and fulfilment outcomes using fixed sample-size thresholds.
    3. Collective buys: require validated pledges meeting the target MOQ and
       explicit organiser/admin authorization before orders or fulfilment.
    4. Financial records: append auditable entries, verify payment-provider
       webhooks, reconcile balances, and refuse simulated/mock payments in
       production. Payment confirmation and physical delivery remain independent.
    5. Premium plans: server-side entitlement checks for seats, watch limits
       and subscription features.
    6. Motion shutdown: stop new experimental processing when the six-month
       window ends or is disabled, while preserving all existing transactions,
       audit logs, outstanding obligations and access to records.
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

from app.config import settings
from app.models.vendor import Vendor
from app.services import stock_engine


class GrowthRuleError(Exception):
    """Raised when a centrally enforced business rule or entitlement check refuses an action."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class PlanSpec:
    key: str
    name: str
    price_kes_monthly: int
    price_kes_annual: Optional[int]
    audience: str
    max_seats: int
    max_watches: int
    included_claim_reviews_per_quarter: int
    priority_verification_queue: bool
    consortium_builder: bool
    buyer_shortlists: bool
    features: tuple[str, ...]
    verification_guardrail: str = (
        "Payment unlocks seats, watch capacity and queue SLA priority — it never "
        "automatically verifies your account or approves compliance claims."
    )


PLAN_CATALOG: dict[str, PlanSpec] = {
    "starter": PlanSpec(
        key="starter",
        name="Starter (Freemium)",
        price_kes_monthly=0,
        price_kes_annual=0,
        audience="Any business getting started on the trade network",
        max_seats=1,
        max_watches=10,
        included_claim_reviews_per_quarter=0,
        priority_verification_queue=False,
        consortium_builder=False,
        buyer_shortlists=False,
        features=(
            "1 seat with @handle and fluid role switching (sourcing / selling / both / dormant)",
            "Stock Room shelf, CSV import, price comparison and movement state machine",
            "Business Passport with declared and documented facts + public directory presence",
            "Up to 10 active RequestWatch opportunity radars",
        ),
    ),
    "readiness": PlanSpec(
        key="readiness",
        name="Readiness",
        price_kes_monthly=2900,
        price_kes_annual=29000,
        audience="Suppliers with dated compliance & eligibility requirements",
        max_seats=3,
        max_watches=25,
        included_claim_reviews_per_quarter=2,
        priority_verification_queue=True,
        consortium_builder=False,
        buyer_shortlists=False,
        features=(
            "3 team seats sharing one Business Passport (owner, finance, clerk)",
            "18-claim Document Vault + 30/14/7-day expiry reminders",
            "Priority verification queue (≤72h target SLA, 2 claim reviews/quarter included)",
            "Up to 25 active RequestWatch radars + unlimited requirement fit checks",
        ),
    ),
    "network": PlanSpec(
        key="network",
        name="Network",
        price_kes_monthly=9500,
        price_kes_annual=95000,
        audience="Growth wholesalers, Patrons, consortium leads and multi-route couriers",
        max_seats=10,
        max_watches=50,
        included_claim_reviews_per_quarter=6,
        priority_verification_queue=True,
        consortium_builder=True,
        buyer_shortlists=False,
        features=(
            "10 team seats + dedicated verification desk queue",
            "Up to 50 active RequestWatch radars + consent-based introductions",
            "Consortium / bid-team builder for AGPO & joint-venture checklists",
            "Full 30/90/180/365-day Trade Analytics & Price Position benchmarks",
        ),
    ),
    "institution": PlanSpec(
        key="institution",
        name="Institution",
        price_kes_monthly=90000,
        price_kes_annual=900000,
        audience="Counties, hospitals, large hospitality buyers, SACCOs and programme offices",
        max_seats=25,
        max_watches=100,
        included_claim_reviews_per_quarter=20,
        priority_verification_queue=True,
        consortium_builder=True,
        buyer_shortlists=True,
        features=(
            "25 procurement & finance seats with audit trail",
            "Buyer-side requirement shortlists & defensible audit exports",
            "Up to 100 active RequestWatch radars + readiness aggregate dashboards",
            "Custody & escrow settlement desk with dual-approval controls",
        ),
    ),
}


HARD_CODED_RULES: tuple[dict, ...] = (
    {
        "id": "verification",
        "title": "Verification cannot be bought",
        "rule": (
            "Only authorized human reviewers (VERIFIER_HANDLES) can approve compliance claims; "
            "self-verification is refused (403) and paid plans never automatically confer verification."
        ),
        "enforced_in": "app/modules/standing/router.py · app/modules/growth/service.py",
    },
    {
        "id": "fulfilment_marks",
        "title": "Fulfilment marks from recorded movements only",
        "rule": (
            "Calculated strictly from actual completed and cancelled movements with fixed sample-size "
            "thresholds: Top supplier (≥95% & ≥20), Level 2 (≥85% & ≥10), Level 1 (≥70% & ≥3), "
            "Getting started (≥1), New to the network (0)."
        ),
        "enforced_in": "app/services/stock_engine.py · frontend/src/components/trust/TrustSignals.jsx",
    },
    {
        "id": "collective_buys",
        "title": "Collective buys require validated MOQ pledges & authorization",
        "rule": (
            "Advancing a collective request to negotiating, ordered or fulfilled requires active "
            "non-withdrawn pledges meeting target_quantity and explicit organiser/admin authorization."
        ),
        "enforced_in": "app/routes/collective.py · app/services/market_locks.py",
    },
    {
        "id": "financial_records",
        "title": "Append-only ledger, verified webhooks & zero simulated production payments",
        "rule": (
            "Ledger entries are append-only, webhooks require HMAC-SHA256 verification, payment and "
            "physical delivery remain independent states, and mock/simulated PSP calls are blocked in production."
        ),
        "enforced_in": "app/services/psp_client.py · app/services/payments.py · app/services/custody.py",
    },
    {
        "id": "premium_entitlements",
        "title": "Server-side entitlement checks for seats, watches and features",
        "rule": (
            "Seat invitations and standing RequestWatch limits are enforced on the server against "
            "the vendor's active plan entitlements."
        ),
        "enforced_in": "app/modules/growth/service.py · app/modules/trade/service.py",
    },
    {
        "id": "motion_shutdown",
        "title": "Graceful six-month motion shutdown preserves obligations & records",
        "rule": (
            "When the six-month experimental window ends or is disabled, new experimental launches stop "
            "(409), while in-flight movements, settlements, audit logs and records remain accessible."
        ),
        "enforced_in": "app/modules/growth/rules.py · app/routes/collective.py · app/routes/market_locks.py",
    },
)


SIX_MONTH_ROLLOUT: tuple[dict, ...] = (
    {
        "month": 1,
        "window": "Oct–Nov",
        "title": "Anchor and stock",
        "summary": (
            "Audit current models, implement event logging and idempotent movement transitions, "
            "connect the stock room and activate the first Business Pulse."
        ),
        "surface": "/stock",
    },
    {
        "month": 2,
        "window": "Nov–Dec",
        "title": "Reciprocal trade",
        "summary": (
            "Complete end-to-end supplier and buyer testing, create verified counterparty edges "
            "and activate movement-driven discovery."
        ),
        "surface": "/network",
    },
    {
        "month": 3,
        "window": "Dec–Jan",
        "title": "Collective demand",
        "summary": (
            "Introduce pledge aggregation, MOQ eligibility, vendor groups and controlled "
            "flash-lock windows."
        ),
        "surface": "/locks",
    },
    {
        "month": 4,
        "window": "Jan–Feb",
        "title": "Tools and opportunity",
        "summary": (
            "Connect delivery tracking, tool bookings, worker requests and service matching."
        ),
        "surface": "/work",
    },
    {
        "month": 5,
        "window": "Feb–Mar",
        "title": "Financial integrity",
        "summary": (
            "Test payment callbacks, ledger reconciliation, permission controls and settlement "
            "exceptions in sandbox mode before any live-money pilot."
        ),
        "surface": "/orders",
    },
    {
        "month": 6,
        "window": "Mar–Apr",
        "title": "Validate and decide",
        "summary": (
            "Measure completed trades, repeat purchasing, fulfilment, worker/job completion, "
            "costs and retention. Decide which modules become permanent."
        ),
        "surface": "/analytics",
    },
)


INVERTED_PYRAMID_LAYERS: tuple[dict, ...] = (
    {
        "layer": 1,
        "stage": "Vertex (1-to-1)",
        "name": "The Verified Anchor",
        "acquisition_mechanic": "Register @handle, publish visible Stock Room SKUs, and verify core Business Passport claims.",
        "earning_mechanic": "Direct B2B shelf sourcing margin and buyer readiness eligibility.",
        "route": "/passport",
    },
    {
        "layer": 2,
        "stage": "Reciprocal Loops (1-to-Few)",
        "name": "Fluid Role & Deal Room Loops",
        "acquisition_mechanic": "Switch between sourcing & selling; each received movement creates a verified graph edge and powers 6-factor discovery.",
        "earning_mechanic": "Multi-round negotiated Deal Room contracts and repeat counterparty replenishment.",
        "route": "/network",
    },
    {
        "layer": 3,
        "stage": "Collective Multipliers (Few-to-Many)",
        "name": "Patrons, Lists, Groups & Daily Flash Locks",
        "acquisition_mechanic": "Sponsor vendors on curated Vendor Lists, host trade Events, and pool zone demand at ≥85% supplier MOQ.",
        "earning_mechanic": "Wholesale volume discounts via Collective Buys & Locks, plus paid Event registrations.",
        "route": "/locks",
    },
    {
        "layer": 4,
        "stage": "Ecosystem & Institutional Pull (Many-to-Ecosystem)",
        "name": "Automated Watches, Shortlists & Cooperative Capital",
        "acquisition_mechanic": "RequestWatch radars auto-match your verified passport to inbound buyer requests; emerald network map pin ranks first.",
        "earning_mechanic": "Institutional contract fulfillment, tool/warehouse rental income, and Digital Chama / Halal Murabaha trade finance.",
        "route": "/work",
    },
)


VERIFIED_MARK_FAMILIES: tuple[dict, ...] = (
    {
        "family": "passport_claims",
        "title": "Business Passport & Standing Marks",
        "source": "modules/standing · VerifiedFacts.jsx",
        "marks": (
            {"key": "declared", "label": "Declared", "rule": "Owner statement; private to owner, never shown on public passport."},
            {"key": "documented", "label": "On file, unchecked", "rule": "Evidence uploaded; awaiting human review."},
            {"key": "verified", "label": "Verified", "rule": "Named human verifier checked evidence; public on shop-front VerifiedStrip until expiry."},
            {"key": "expired", "label": "Expired", "rule": "Printed validity date passed; automatically removed from public verified views."},
        ),
    },
    {
        "family": "fulfilment_ladder",
        "title": "Supplier Fulfilment Marks",
        "source": "services/stock_engine.py · TrustSignals.jsx",
        "marks": (
            {"key": "new", "label": "New to the network", "rule": "0 completed movements."},
            {"key": "rising", "label": "Getting started", "rule": "≥1 completed movement; building sample size."},
            {"key": "l1", "label": "Level 1", "rule": "≥70% fulfilment across ≥3 completed movements."},
            {"key": "l2", "label": "Level 2", "rule": "≥85% fulfilment across ≥10 completed movements."},
            {"key": "top", "label": "Top supplier", "rule": "≥95% fulfilment across ≥20 completed movements."},
        ),
    },
    {
        "family": "stock_provenance",
        "title": "Stock Quality & Provenance Marks",
        "source": "models/stock.py · routes/stock.py",
        "marks": (
            {"key": "unverified", "label": "Unverified", "rule": "Default shelf entry."},
            {"key": "self_declared", "label": "Self-declared", "rule": "Batch number, origin or spec sheet attached by vendor."},
            {"key": "patron_verified", "label": "Patron-verified", "rule": "Inspected and vouched for by the Patron of an approved Vendor List."},
            {"key": "lab_certified", "label": "Lab-certified", "rule": "Third-party certificate / spec_sheet_url attached."},
        ),
    },
    {
        "family": "network_standing",
        "title": "Network, POS & Map Tier Marks",
        "source": "TrustSignals.jsx · services/map_viewport.py",
        "marks": (
            {"key": "live_stock", "label": "Live stock (POS)", "rule": "Connected till syncing inventory via POS Bridge."},
            {"key": "patron_tier", "label": "Patron (Starter → Legend)", "rule": "Earned automatically from vendors sponsored, events hosted and reputation."},
            {"key": "network_pin", "label": "Emerald Network Map Pin", "rule": "Claimed vendor location ranked ahead of muted external directory rows."},
        ),
    },
)


LAUNCH_ACCEPTANCE_GATES: tuple[dict, ...] = (
    {"id": "movement_progression", "label": "A valid movement can progress through every permitted state (pending → confirmed → shipped → received)."},
    {"id": "invalid_transition_rejected", "label": "An invalid transition is rejected by the backend."},
    {"id": "idempotent_receipt", "label": "Retrying a received event cannot debit or credit inventory twice."},
    {"id": "worker_recovery", "label": "Failed background jobs can recover without duplicating side effects."},
    {"id": "pulse_matches_db", "label": "Business Pulse matches database records."},
    {"id": "collective_validation", "label": "Collective demand cannot bypass MOQ, authorization or order validation."},
    {"id": "expired_claims_hidden", "label": "Expired compliance claims disappear from public verified views."},
    {"id": "payment_delivery_independent", "label": "Payment confirmation and physical delivery remain independent states."},
    {"id": "graceful_motion_shutdown", "label": "Disabling the six-month program does not delete records or block legitimate outstanding obligations."},
)


def plan_spec(tier: Optional[str]) -> PlanSpec:
    key = (tier or "starter").strip().lower()
    return PLAN_CATALOG.get(key, PLAN_CATALOG["starter"])


def entitlements_for(vendor: Vendor) -> dict:
    spec = plan_spec(getattr(vendor, "plan_tier", None))
    seats_limit = int(getattr(vendor, "plan_seats_limit", None) or spec.max_seats)
    watches_limit = int(getattr(vendor, "plan_watches_limit", None) or spec.max_watches)
    return {
        "tier": spec.key,
        "name": spec.name,
        "price_kes_monthly": spec.price_kes_monthly,
        "price_kes_annual": spec.price_kes_annual,
        "max_seats": seats_limit,
        "max_watches": watches_limit,
        "included_claim_reviews_per_quarter": spec.included_claim_reviews_per_quarter,
        "priority_verification_queue": spec.priority_verification_queue,
        "consortium_builder": spec.consortium_builder,
        "buyer_shortlists": spec.buyer_shortlists,
        "features": list(spec.features),
        "verification_guardrail": spec.verification_guardrail,
        "fulfillment_mark": stock_engine.fulfillment_mark(vendor),
    }


def program_window_status(*, today_: Optional[date] = None) -> dict:
    """Evaluate whether the six-month experimental rollout window is open."""
    day = today_ or datetime.utcnow().date()
    end_str = (settings.SIX_MONTH_PROGRAM_END_DATE or "2027-04-12").strip()
    try:
        end_date = date.fromisoformat(end_str)
    except ValueError:
        end_date = date(2027, 4, 12)
    enabled = bool(settings.SIX_MONTH_PROGRAM_ENABLED)
    within_window = day <= end_date
    active = enabled and within_window
    return {
        "active": active,
        "enabled": enabled,
        "end_date": end_date.isoformat(),
        "within_window": within_window,
        "preserve_existing_records": True,
        "allow_outstanding_obligations": True,
        "notice": (
            "Six-month rollout window is active."
            if active
            else (
                "The six-month experimental motion window is closed. New experimental "
                "launches are paused, while all existing transactions, audit logs, "
                "outstanding obligations and records remain open."
            )
        ),
    }


def is_program_active(*, today_: Optional[date] = None) -> bool:
    return bool(program_window_status(today_=today_)["active"])


def require_program_active(feature_name: str = "this experimental motion") -> None:
    status = program_window_status()
    if not status["active"]:
        raise GrowthRuleError(
            f"The six-month rollout window is closed for new {feature_name}. "
            "Existing transactions, audit logs, outstanding obligations and records remain available.",
            status=409,
        )

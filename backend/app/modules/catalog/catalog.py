"""The storefront catalogue — sell what businesses already buy (v2.14).

This file is DATA, not promises. Every offer carries:

* a **test price** (a range in KSh taken from existing business spending,
  explicitly *not* a market-verified average and not a commitment);
* a **readiness** that says how it can truthfully be sold today —
  `available_now` (operational in Brief_), `pilot` (operational for a
  small, supervised rollout), `service` (productised work delivered by
  people, booked as an implementation), or `scoped` (quotation only,
  because hardware/EMM/third-party costs decide the price);
* fixed scope: deliverables, revisions where relevant, turnaround,
  exclusions and what the customer must provide — defined *before*
  payment is accepted, so an enquiry can become an invoice without
  inventing scope on a call.

Account tiers follow the same rule. `Junior` is a free, restricted
account whose public label describes the *subscription tier only*.
Verification is a separate, evidence-based state (Business Passport)
and is never sold, bundled or implied by any tier.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Offer:
    key: str
    line: str                    # digital_services | business_software | field_operations
    name: str
    price_min_kes: Optional[int]
    price_max_kes: Optional[int]
    price_unit: str              # one_off | monthly | setup_once | scoped
    readiness: str               # available_now | pilot | service | scoped
    readiness_note: str
    turnaround: str
    deliverables: tuple[str, ...]
    exclusions: tuple[str, ...]
    customer_must_provide: tuple[str, ...]
    revisions: Optional[str] = None
    # Which of the five buying needs this offer answers. Empty means "the same
    # as its line" — set it only where a need is narrower than the line.
    desk: str = ""


LINES: tuple[dict, ...] = (
    {
        "key": "digital_services", "title": "A. Digital services", "badge": "Sell immediately",
        "terms": "One-off purchases · Fixed scope · Fastest route to initial cash",
        "note": "Delivered as productised services by the studio or delivery partners — booked here, fulfilled by people, invoiced before work starts.",
    },
    {
        "key": "business_software", "title": "B. Business software", "badge": "Recurring revenue",
        "terms": "Subscriptions · Organisation accounts · Repeatable delivery",
        "note": "Only what is operational is self-serve. Pilots are sold as pilots, with a named scope — never as a finished SaaS that does not exist yet.",
    },
    {
        "key": "field_operations", "title": "C. Field operations", "badge": "Setup + monthly fee",
        "terms": "Field teams · Android phones · Reporting · Workflow deployment",
        "note": "Hardware, data bundles, travel, third-party licences and specialised integrations are charged separately and quoted in writing.",
    },
)

OFFERS: tuple[Offer, ...] = (
    # ── A. Digital services ──────────────────────────────────────────────
    Offer(
        key="logo_brand_starter", line="digital_services",
        name="Logo and brand starter package",
        price_min_kes=2500, price_max_kes=8000, price_unit="one_off",
        readiness="service",
        readiness_note="Productised studio service. Booked as an enquiry, delivered by people — not software.",
        turnaround="3–5 working days from a completed brief (test)",
        deliverables=("Primary logo + one lockup", "Colour and type choices", "Files for print, signage and social use"),
        exclusions=("Trademark registration or legal clearance", "Unlimited concepts or a full brand-guideline book"),
        customer_must_provide=("Business name and what it sells", "Examples of styles liked and disliked"),
        revisions="Two revision rounds included; further rounds quoted before work continues.",
    ),
    Offer(
        key="business_website", line="digital_services",
        name="Business website",
        price_min_kes=15000, price_max_kes=45000, price_unit="one_off",
        readiness="service",
        readiness_note="Productised studio service with a fixed page count and milestones — the fastest honest route to cash.",
        turnaround="2–4 weeks depending on content readiness (test)",
        deliverables=("Up to 5 pages (home, services, about, catalogue/storefront link, contact)", "Mobile-friendly build", "Contact/enquiry route connected"),
        exclusions=("E-commerce checkout unless separately scoped", "Copywriting, photography and domain/hosting fees"),
        customer_must_provide=("Text, prices and photos they own or may use", "Domain/hosting access or budget"),
        revisions="Two revision rounds per milestone; scope changes quoted before work continues.",
    ),
    Offer(
        key="app_uiux_prototype", line="digital_services",
        name="Mobile app UI/UX prototype",
        price_min_kes=8000, price_max_kes=30000, price_unit="one_off",
        readiness="service",
        readiness_note="A clickable prototype for validation — explicitly not a production app build.",
        turnaround="1–3 weeks (test)",
        deliverables=("Core user flows as a clickable prototype", "Screen designs for the agreed flows", "Handover notes for a developer"),
        exclusions=("Production app development, app-store submission or backend build"),
        customer_must_provide=("The user problem and the flows that matter most",),
        revisions="Two revision rounds included.",
    ),
    Offer(
        key="business_automation_setup", line="digital_services",
        name="Business automation setup",
        price_min_kes=5000, price_max_kes=25000, price_unit="one_off",
        readiness="service",
        readiness_note="Scoped per workflow after a short audit. If the audit finds nothing worth automating, that is the deliverable's answer.",
        turnaround="1–2 weeks per agreed workflow (test)",
        deliverables=("One agreed workflow automated or connected", "Setup documented so the business can run it", "Staff walkthrough"),
        exclusions=("Third-party subscription fees", "Custom software development unless separately quoted"),
        customer_must_provide=("Access to the tools involved", "One staff owner for the workflow"),
        revisions="One correction round for defects in the agreed setup.",
    ),
    # The two capabilities that used to live only on the creative portfolio's
    # own price list. They are productised studio work like the four above, so
    # they are sold as offers here — one desk, one price sheet, one enquiry
    # route. Packaging/print and motion are real capabilities we can deliver;
    # keeping them on a separate page meant a buyer had to find a portfolio
    # before they could find a price.
    Offer(
        key="packaging_print_suite", line="digital_services",
        name="Packaging and print suite",
        price_min_kes=6000, price_max_kes=20000, price_unit="one_off",
        readiness="service",
        readiness_note="Productised studio service: dielines, artwork and press-ready files. Booked as an enquiry, delivered by people.",
        turnaround="2–3 weeks once artwork is approved (test; print lead time decides)",
        deliverables=("Label or packaging artwork for one product format", "Print-ready files with dielines", "Stock and finish recommendations"),
        exclusions=("Printing, foil stamping and delivery charges", "Photography of the finished product"),
        customer_must_provide=("Product dimensions and what is inside it", "A print vendor, or approval to quote one"),
        revisions="Two artwork rounds included; press checks are quoted separately.",
    ),
    Offer(
        key="motion_launch_pack", line="digital_services",
        name="Motion and launch pack",
        price_min_kes=8000, price_max_kes=30000, price_unit="one_off",
        readiness="service",
        readiness_note="Productised studio service: an animated identity and a launch video. Booked as an enquiry, delivered by people.",
        turnaround="2–3 weeks from an approved storyboard (test)",
        deliverables=("One 30–60 second launch video", "Animated logo ident and transitions", "Two social cut-downs"),
        exclusions=("Paid media spend", "Voice talent and licensed music fees", "On-location filming"),
        customer_must_provide=("The logo in vector form, or brand files", "The message and the launch date"),
        revisions="One storyboard round and one cut round included.",
    ),
    # ── B. Business software ─────────────────────────────────────────────
    Offer(
        key="customer_sales_records", line="business_software",
        name="Customer and sales records",
        price_min_kes=1500, price_max_kes=4000, price_unit="monthly",
        readiness="available_now",
        readiness_note="Operational today in Brief_: stock, orders/movements, counterparties and trade analytics. Sold as a Business-tier subscription once billing is live; until then, manual invoicing.",
        turnaround="Account active on signup; onboarding session within 2 working days",
        deliverables=("Stock and sales record-keeping on the vendor account", "Orders and counterparty history", "Trade analytics views"),
        exclusions=("A point-of-sale till or accounting package replacement", "Data migration from paper ledgers unless scoped"),
        customer_must_provide=("Business details for the @handle account",),
    ),
    Offer(
        key="membership_management", line="business_software",
        name="Membership management",
        price_min_kes=5000, price_max_kes=15000, price_unit="monthly",
        readiness="pilot",
        readiness_note="Enterprise workspace member register and field-officer tracking are built (v2.13). Sold as a supervised pilot/manual contract until subscription billing is verified live.",
        turnaround="Pilot workspace configured within 3 working days of receiving the member list",
        deliverables=("Branded workspace inside Brief_ with member register", "Roles for admins, field officers, members and viewers", "Field-registration activity dashboard"),
        exclusions=("Bulk SMS/USSD campaigns", "Physical membership cards"),
        customer_must_provide=("Member list the organisation is entitled to share (ODPC duties apply)", "A named association admin"),
    ),
    Offer(
        key="private_business_workspace", line="business_software",
        name="Private business workspace",
        price_min_kes=5000, price_max_kes=20000, price_unit="monthly",
        readiness="pilot",
        readiness_note="Team seats and private workspaces are operational; plan caps are enforced server-side. The organisation workspace ladder (Pilot/Association/Enterprise) prices larger rollouts separately.",
        turnaround="Workspace active on signup; team invited within 1 working day",
        deliverables=("Private workspace with multiple authorised users", "Customer and job records in the existing work flows", "Reporting views"),
        exclusions=("Custom integrations unless separately quoted",),
        customer_must_provide=("Team email addresses/handles to invite",),
    ),
    Offer(
        key="custom_enterprise_deployment", line="business_software",
        name="Custom enterprise deployment",
        price_min_kes=None, price_max_kes=None, price_unit="scoped",
        readiness="scoped",
        readiness_note="Scoped quotation only. No price is published and no deposit is taken until deliverables, integrations and an SLA the team can actually meet are written down.",
        turnaround="Quoted after a paid or time-boxed discovery, never guessed on a call",
        deliverables=("Written scope, milestones and price before any deposit",),
        exclusions=("Anything not in the written scope",),
        customer_must_provide=("A named decision-maker and the systems to integrate",),
    ),
    # ── C. Field operations ──────────────────────────────────────────────
    Offer(
        key="mobile_form_reporting_setup", line="field_operations",
        name="Mobile form and reporting setup",
        price_min_kes=7500, price_max_kes=20000, price_unit="setup_once",
        readiness="scoped",
        readiness_note="Field-officer registration and supervisor reporting exist (v2.13); bespoke forms are an implementation, scoped per form set.",
        turnaround="1–2 weeks per agreed form set (test)",
        deliverables=("Agreed registration/reporting forms configured", "Supervisor dashboard view of submissions", "Officer walkthrough"),
        exclusions=("Custom form logic or offline-sync guarantees not in the written scope",),
        customer_must_provide=("The exact fields officers must collect, and why (data minimisation)",),
    ),
    Offer(
        key="agent_workflow_management", line="field_operations",
        name="Agent workflow management",
        price_min_kes=3000, price_max_kes=10000, price_unit="monthly",
        readiness="pilot",
        readiness_note="Workspace roles, field registration tracking and work queues are operational for a pilot team. BYOD-first: officers use their own phones with a work profile.",
        turnaround="Pilot team live within 5 working days of the officer list",
        deliverables=("Officer accounts with role-based access", "Registration forms and work queues", "Supervisor dashboard"),
        exclusions=("Salaries, airtime/data and transport for officers", "Guaranteed control over personally owned phones"),
        customer_must_provide=("Officer list and a supervisor", "Officers' consent to a work profile on their own phones"),
    ),
    Offer(
        key="android_device_enrolment", line="field_operations", desk="device_management",
        name="Android device enrolment and configuration",
        price_min_kes=None, price_max_kes=None, price_unit="scoped",
        readiness="scoped",
        readiness_note="Scoped setup fee. Enrolment runs through the organisation's Android Enterprise/EMM; Brief_ keeps the device register and command audit. Capabilities depend on enrolment mode — work-profile (BYOD) devices can never be fully wiped or personally controlled.",
        turnaround="Quoted per fleet size and enrolment mode",
        deliverables=("Enrolment plan: BYOD work-profile or fully-managed, chosen per device", "Devices registered in the workspace with policy names", "Lost-device procedure agreed in writing"),
        exclusions=("The EMM licence itself unless separately quoted", "Unrestricted control over personally owned devices — never promised"),
        customer_must_provide=("Devices or officers' own phones, with owner consent", "An EMM/Android Enterprise admin account"),
    ),
    Offer(
        key="device_procurement_support", line="field_operations", desk="device_management",
        name="Device procurement and ongoing support",
        price_min_kes=None, price_max_kes=None, price_unit="scoped",
        readiness="scoped",
        readiness_note="Quoted separately, per device and support term. Hardware is never bundled into a software subscription price.",
        turnaround="Quoted against supplier availability",
        deliverables=("Written per-device quote before any payment", "Handover and enrolment checklist per device"),
        exclusions=("Repairs, insurance and replacement for loss or damage unless in the written quote",),
        customer_must_provide=("Fleet size, budget ceiling and delivery location",),
    ),
)


@dataclass(frozen=True)
class AccountTier:
    key: str
    name: str
    label: str                       # public profile label, verbatim
    price_min_kes: Optional[int]
    price_max_kes: Optional[int]
    test_price_kes_monthly: Optional[int]   # single figure used for trial disclosure
    billing: str                     # free | monthly | custom
    operational_plan: str            # the existing plan_tier this maps to today
    checkout_status: str             # available_now | enquiry_or_trial | contract
    purpose: str
    includes: tuple[str, ...]
    excludes: tuple[str, ...]


ACCOUNT_TIERS: tuple[AccountTier, ...] = (
    AccountTier(
        key="junior", name="Junior", label="Junior — Free account",
        price_min_kes=0, price_max_kes=0, test_price_kes_monthly=0,
        billing="free", operational_plan="starter", checkout_status="available_now",
        purpose="Attract providers and establish marketplace supply without promising premium service.",
        includes=(
            "One basic public profile",
            "Limited service listings",
            "Basic visibility and contact information",
        ),
        excludes=(
            "No advanced analytics, team management or private organisational workspace",
        ),
    ),
    AccountTier(
        key="professional", name="Professional", label="Professional account",
        price_min_kes=500, price_max_kes=1500, test_price_kes_monthly=1000,
        billing="monthly", operational_plan="readiness", checkout_status="enquiry_or_trial",
        purpose="Monetise professionals who benefit from customer discovery.",
        includes=(
            "More listings and richer portfolios",
            "Enquiry and lead tracking",
            "Basic performance statistics",
            "Enhanced profile presentation",
        ),
        excludes=("No private organisational workspace or field-team management",),
    ),
    AccountTier(
        key="business", name="Business", label="Business account",
        price_min_kes=3000, price_max_kes=10000, test_price_kes_monthly=6500,
        billing="monthly", operational_plan="network", checkout_status="enquiry_or_trial",
        purpose="Recurring revenue from active businesses.",
        includes=(
            "Private business workspace",
            "Multiple authorised users",
            "Customer and job records",
            "Reporting and operational workflows",
            "Paid onboarding options",
        ),
        excludes=("Field-agent fleets and managed devices — see Enterprise",),
    ),
    AccountTier(
        key="enterprise", name="Enterprise", label="Enterprise account",
        price_min_kes=None, price_max_kes=None, test_price_kes_monthly=None,
        billing="custom", operational_plan="institution", checkout_status="contract",
        purpose="Larger contracts with implementation fees and recurring support.",
        includes=(
            "Organisation-wide accounts and permissions",
            "Field-agent management and reporting",
            "Integrations and deployment services",
            "Optional managed-device support and service-level agreements",
        ),
        excludes=("Any SLA, integration or device capability not written into the contract",),
    ),
)

# Which existing vendor plan_tier a public account-tier label describes.
TIER_BY_PLAN: dict[str, str] = {
    "starter": "junior", "readiness": "professional",
    "network": "business", "institution": "enterprise",
}

VERIFICATION_NOTE = (
    "The account-tier label describes the subscription only — it says nothing "
    "about whether a business is qualified or trustworthy. Verification is a "
    "separate state, earned through the Business Passport's evidence checks, "
    "and is never sold or bundled with a paid tier."
)

TRIAL_TERMS: dict = {
    "tier": "business",
    "days": 30,
    "status": "not_yet_live",
    "status_note": (
        "The card-required trial goes live only when a recurring-payment "
        "provider confirms — for this merchant account — eligibility, "
        "settlement, supported currencies, fees and exact subscription "
        "behaviour. Until then the button below records a trial request; "
        "no card is asked for and no charge is made."
    ),
    "card_rules": (
        "Show the exact date and amount of the first charge before the customer confirms",
        "Send a reminder before the trial ends (at least 3 days before the first charge)",
        "Make cancellation easy, and stop recurring charges when cancellation is effective",
        "Never collect card details directly — provider-hosted checkout or secure tokenisation only",
        "Offer an M-Pesa alternative (manual renewal or a supported recurring arrangement) for customers without a card",
    ),
    "alternative_to_test": (
        "A card-required trial reduces casual signups but can also reduce conversion. "
        "Test it against a shorter, capped trial without a card instead of assuming one is always superior."
    ),
}

BYOD_VS_MANAGED: tuple[dict, ...] = (
    {
        "key": "byod", "name": "Bring Your Own Device (BYOD)", "enrolment_mode": "work_profile",
        "headline": "The buyer may already have 15 officers carrying their own phones — sell the deployment, not the hardware.",
        "includes": (
            "Supported work apps configured in a work profile",
            "Role-based access for each officer",
            "Registration forms and a supervisor dashboard",
            "Company data can be removed from the work profile if someone leaves",
        ),
        "limits": (
            "No unrestricted control over a personally owned device",
            "The whole device can never be wiped — personal data is untouchable",
            "Capabilities depend on the device and enrolment configuration",
        ),
    },
    {
        "key": "fully_managed", "name": "Fully managed, company-owned devices", "enrolment_mode": "fully_managed",
        "headline": "A separate tier when the customer needs centralised device controls.",
        "includes": (
            "Organisation-owned phones enrolled as fully managed or dedicated",
            "Central policy, app distribution and remote lock through the EMM",
            "Full wipe available because the organisation owns the device",
            "Device register and command audit in the workspace",
        ),
        "limits": (
            "Hardware, EMM licences and support are quoted separately",
            "Remote actions are delivered by Android Enterprise/the EMM, not by Brief_ itself",
        ),
    },
)


# ── the business desk: five needs, not three product lines ───────────────────
#
# A buyer arrives with a need ("I need a website", "our officers need to file
# reports"), not with knowledge of how the catalogue is organised internally.
# These five groups are the *buying* taxonomy. The three `LINES` above remain
# the *commercial* taxonomy — one line can contain more than one buying need,
# which is exactly why device management is its own door inside field
# operations.

DESKS: tuple[dict, ...] = (
    {
        "key": "digital_services", "title": "Digital services",
        "blurb": "Websites, branding, design and automation.",
        "enquiry_only": False,
    },
    {
        "key": "business_software", "title": "Business software",
        "blurb": "Business records, memberships and workspaces.",
        "enquiry_only": False,
    },
    {
        "key": "field_operations", "title": "Field operations",
        "blurb": "Field teams, mobile forms and reporting.",
        "enquiry_only": False,
    },
    {
        "key": "device_management", "title": "Device management",
        "blurb": "Android deployment and device administration.",
        "enquiry_only": False,
    },
    {
        # The door for "none of the above". It has no offers by design: the
        # only honest answer to an unclassified need is a conversation, so the
        # form is the product.
        "key": "custom", "title": "Custom business solutions",
        "blurb": "Tell us what your organisation needs.",
        "enquiry_only": True,
    },
)


# ── what a customer may do about an offer, decided by its readiness ──────────
#
# This table is the guard rail the interface is not allowed to override: a
# pilot cannot be "purchased", and something not yet live cannot be bought at
# all. The server sends the action with the offer, so a screen cannot invent a
# checkout button for work that does not exist.

CTA_FOR_READINESS: dict[str, dict] = {
    "available_now": {
        "kind": "purchase", "label": "Purchase or enquire",
        "note": "Live today. Send an enquiry and a human confirms scope, then invoices. "
                "No card is collected in the app.",
    },
    "service": {
        "kind": "quotation", "label": "Request a quotation",
        "note": "Delivered as a service by people. A written quotation fixes scope, "
                "dates and price before any work starts.",
    },
    "pilot": {
        "kind": "pilot", "label": "Request pilot participation",
        "note": "Sold as a supervised pilot with a named scope. Nothing is charged "
                "until the pilot terms are agreed in writing.",
    },
    "scoped": {
        "kind": "requirements", "label": "Submit requirements",
        "note": "No public price: hardware, licences and integrations decide it. "
                "Send requirements and a written quotation follows.",
    },
    "not_yet_live": {
        "kind": "interest", "label": "Register interest",
        "note": "Not live yet. Registering interest records a request; nothing is "
                "sold, charged or promised.",
    },
}

# Every enquiry kind the desk may record. The first four existed before the
# desk; the last three are the actions the readiness table above can produce.
ENQUIRY_KINDS: tuple[str, ...] = (
    "purchase", "trial", "quotation", "discovery_call",
    "pilot", "requirements", "interest",
)


def desk_for_offer(o: Offer) -> str:
    """The buying need an offer answers."""
    return o.desk or o.line


def desk_by_key(key: str) -> Optional[dict]:
    clean = (key or "").strip().lower()
    return next((d for d in DESKS if d["key"] == clean), None)


def cta_for(readiness: str) -> dict:
    """What a customer may do, given how ready the offer truthfully is."""
    return CTA_FOR_READINESS.get(readiness) or CTA_FOR_READINESS["not_yet_live"]


def offers_for_desk(key: str) -> tuple[Offer, ...]:
    return tuple(o for o in OFFERS if desk_for_offer(o) == key)


def offer_by_key(key: str) -> Optional[Offer]:
    clean = (key or "").strip().lower()
    return next((o for o in OFFERS if o.key == clean), None)


def tier_by_key(key: str) -> Optional[AccountTier]:
    clean = (key or "").strip().lower()
    return next((t for t in ACCOUNT_TIERS if t.key == clean), None)

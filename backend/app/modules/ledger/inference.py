"""Deterministic category inference, progressive template schemas & youth safety.

Rule from repo strategy §0:
  - No opaque black-box decisions.
  - Consequential guardrails (especially youth safety, supervision, and guardian
    consent) are enforced on the server, never just in the UI.
"""

import re
from datetime import datetime
from typing import Optional

from app.modules.ledger.models import ACTIVITY_TEMPLATES, POSTING_TYPES

POSTING_TYPE_META = [
    {
        "value": "available",
        "label": "Available",
        "icon": "package-plus",
        "description": "I have something to supply, share, sell, or make available.",
        "examples": ["Surplus Napier grass", "Lend a chaff cutter", "Collection point", "Home eggs"],
    },
    {
        "value": "wanted",
        "label": "Wanted",
        "icon": "search",
        "description": "I need a product, a person, a service, or a resource.",
        "examples": ["Fence repair ~20m on Saturday", "Need cattle fodder", "Looking for a cobbler"],
    },
    {
        "value": "scheduled",
        "label": "Scheduled",
        "icon": "calendar-check",
        "description": "I have an activity, appointment, visit, or event at a certain time.",
        "examples": ["Cobbler area round in Muthaiga", "Garden learning session", "Saturday cleanup"],
    },
    {
        "value": "opportunity",
        "label": "Opportunity",
        "icon": "hand-helping",
        "description": "There is work, a learning opportunity, or a way to participate.",
        "examples": ["Pool a bulk fodder order", "Supervised holiday youth task", "Craft apprenticeship"],
    },
]

# Youth safety constants — server-enforced
YOUTH_AGE_BANDS = ("13_15_holiday_learning", "16_17_supervised")
YOUTH_PERMITTED_DOMAINS = (
    "garden_help",
    "tutoring_peer",
    "community_event",
    "craft_learning",
    "digital_help",
    "light_sorting",
)

# Any youth opportunity matching hazardous / night / unsupervised domestic terms is refused (422).
YOUTH_PROHIBITED_PATTERNS = re.compile(
    r"\b("
    r"night\s*guard|night\s*shift|security\s*guard|bar\b|alcohol|club\b|"
    r"pesticide|chemical\s*spray|herbicide|quarry|mining|chainsaw|"
    r"heavy\s*machinery|scaffolding|roofing\s*heights|live\s*in\s*househelp|"
    r"unsupervised\s*domestic|boiler|welding\s*industrial"
    r")\b",
    re.IGNORECASE,
)

# Template definitions: progressive extra fields asked ONLY when relevant.
TEMPLATE_SCHEMAS = {
    "repair_artisan": {
        "key": "repair_artisan",
        "label": "Repair & Local Artisan",
        "default_category": "repairs",
        "extra_fields": [
            {"key": "scope_measure", "label": "Approximate scope / size", "type": "text", "placeholder": "e.g. Approx. 20 metres of timber fence"},
            {"key": "preferred_window", "label": "Preferred day or window", "type": "text", "placeholder": "e.g. Saturday morning"},
            {"key": "materials_basis", "label": "Materials", "type": "select", "options": ["quote_with_materials", "labour_only", "discuss"]},
            {"key": "quotes_invited", "label": "Invite quotations", "type": "boolean", "default": True},
        ],
    },
    "agricultural_produce_fodder": {
        "key": "agricultural_produce_fodder",
        "label": "Farm Produce & Livestock Fodder",
        "default_category": "agriculture",
        "extra_fields": [
            {"key": "quantity", "label": "Quantity", "type": "number_float", "placeholder": "e.g. 15 or 2.5"},
            {"key": "unit", "label": "Unit", "type": "select", "options": ["bales", "kg", "tonnes", "sacks", "crates", "trays", "bundles", "litres"]},
            {"key": "handover_mode", "label": "Collection or delivery", "type": "select", "options": ["homestead_pickup", "collection_point", "local_delivery"]},
            {"key": "freshness_or_cut_note", "label": "Harvest / condition note", "type": "text", "placeholder": "e.g. Cut fresh Friday afternoon"},
        ],
    },
    "tool_lending": {
        "key": "tool_lending",
        "label": "Tool Lending & Sharing",
        "default_category": "tools",
        "extra_fields": [
            {"key": "tool_condition", "label": "Condition", "type": "text", "placeholder": "e.g. Good working order, sharpened"},
            {"key": "max_borrow_duration", "label": "Borrow duration", "type": "text", "placeholder": "e.g. Up to 2 days"},
            {"key": "care_terms", "label": "Return & care terms", "type": "text", "placeholder": "e.g. Return clean by Sunday 5pm"},
        ],
    },
    "collection_point": {
        "key": "collection_point",
        "label": "Temporary Collection Point",
        "default_category": "collection_point",
        "extra_fields": [
            {"key": "open_hours", "label": "Collection window", "type": "text", "placeholder": "e.g. Wed & Sat 3pm–6pm"},
            {"key": "storage_kind", "label": "Storage condition", "type": "select", "options": ["shaded_dry", "indoor_secure", "cool_box"]},
            {"key": "max_items", "label": "Capacity (bags/parcels)", "type": "number_int", "placeholder": "e.g. 20"},
        ],
    },
    "travelling_round": {
        "key": "travelling_round",
        "label": "Travelling Artisan Area Round",
        "default_category": "artisan_round",
        "required_core": ["starts_at"],
        "extra_fields": [
            {"key": "route_corridor", "label": "Areas / estates covered", "type": "text", "placeholder": "e.g. Old Muthaiga → Muthaiga North"},
            {"key": "services_offered", "label": "Work done on the round", "type": "text", "placeholder": "e.g. Shoe stitching, sole replacement, leather bag repair"},
            {"key": "slot_duration_mins", "label": "Typical stop length (mins)", "type": "number_int", "placeholder": "e.g. 30"},
        ],
    },
    "group_sourcing": {
        "key": "group_sourcing",
        "label": "Agricultural & Neighbourhood Group Order",
        "default_category": "group_sourcing",
        "extra_fields": [
            {"key": "target_quantity", "label": "Target combined quantity", "type": "number_float", "placeholder": "e.g. 50"},
            {"key": "unit", "label": "Unit", "type": "select", "options": ["bales", "bags", "kg", "tonnes", "packets", "seedlings"]},
            {"key": "estimated_unit_price_kes", "label": "Estimated unit price (KSh)", "type": "number_int", "placeholder": "e.g. 350"},
            {"key": "dropoff_area", "label": "Drop-off / split point", "type": "text", "placeholder": "e.g. Nyanchwa junction store"},
        ],
    },
    "community_learning": {
        "key": "community_learning",
        "label": "Community Learning & Tutoring",
        "default_category": "learning",
        "extra_fields": [
            {"key": "subject_or_skill", "label": "Topic or skill", "type": "text", "placeholder": "e.g. Holiday maths & coding / kitchen gardening"},
            {"key": "learner_group", "label": "Who it's for", "type": "select", "options": ["all_ages", "children_supervised", "teenagers", "adults"]},
            {"key": "host_background", "label": "Host experience", "type": "text", "placeholder": "e.g. Retired agriculture officer / secondary teacher"},
            {"key": "materials_note", "label": "What to bring", "type": "text", "placeholder": "e.g. Notebook; seedlings provided"},
        ],
    },
    "supervised_youth_task": {
        "key": "supervised_youth_task",
        "label": "Supervised Youth Opportunity",
        "default_category": "youth_opportunity",
        "extra_fields": [
            {"key": "age_band", "label": "Eligible age band", "type": "select", "options": list(YOUTH_AGE_BANDS), "required": True},
            {"key": "permitted_domain", "label": "Eligible supervised domain", "type": "select", "options": list(YOUTH_PERMITTED_DOMAINS), "required": True},
            {"key": "supervisor_name", "label": "Named adult supervisor", "type": "text", "placeholder": "Full name of adult present", "required": True},
            {"key": "supervisor_role", "label": "Supervisor role", "type": "text", "placeholder": "e.g. School patron, Master carpenter, Parent host", "required": True},
            {"key": "learning_takeaway", "label": "Skill gained", "type": "text", "placeholder": "e.g. Nursery bed preparation & record keeping"},
        ],
    },
    "general": {
        "key": "general",
        "label": "General Local Activity",
        "default_category": "community",
        "extra_fields": [],
    },
}

# Ordered deterministic keyword rules: specific safety/phase-2 patterns first!
_INFERENCE_RULES = [
    (
        "supervised_youth_task",
        re.compile(
            r"\b(teenager|teenagers|youth|holiday\s+task|supervised\b.*\btask|"
            r"young\s+person|student\s+helper|16[\s-]*17|13[\s-]*15)\b",
            re.IGNORECASE,
        ),
        "youth_opportunity",
        "Mentions a youth or teenager supervised task — applying mandatory supervision & guardian consent fields.",
    ),
    (
        "group_sourcing",
        re.compile(
            r"\b(bulk\s+order|group\s+order|pool\s+order|buying\s+together|"
            r"joint\s+order|collective\s+order|share\s+a\s+lorry|pool\s+fodder)\b",
            re.IGNORECASE,
        ),
        "group_sourcing",
        "Mentions pooling or a bulk/group order — showing target quantity & fractional pledge fields.",
    ),
    (
        "travelling_round",
        re.compile(
            r"\b(area\s+round|round\s+in|visiting\s+[a-z]+|mobile\s+cobbler|"
            r"cobbler\s+visit|cobbler\s+round|knife\s+sharpen|travelling\s+artisan|"
            r"stops\s+available|estate\s+round)\b",
            re.IGNORECASE,
        ),
        "artisan_round",
        "Describes a scheduled area visit/round — enabling ordered private household stops.",
    ),
    (
        "community_learning",
        re.compile(
            r"\b(tutoring|tutor|holiday\s+learning|learning\s+session|workshop|"
            r"lesson|lessons|study\s+group|training\s+session|demo\s+plot|garden\s+class)\b",
            re.IGNORECASE,
        ),
        "learning",
        "Describes learning, tutoring, or a skill workshop — showing topic, age group & host fields.",
    ),
    (
        "collection_point",
        re.compile(
            r"\b(collection\s+point|drop[\s-]*off\s+point|pickup\s+point|pick[\s-]*up\s+hub)\b",
            re.IGNORECASE,
        ),
        "collection_point",
        "Offers a local collection/drop-off point — showing open window & storage capacity.",
    ),
    (
        "tool_lending",
        re.compile(
            r"\b(lend|borrow|rent\s+out\s+a\s+tool|wheelbarrow|chaff\s+cutter|"
            r"knapsack\s+sprayer|ladder|spade|mower|water\s+pump\s+for\s+hire)\b",
            re.IGNORECASE,
        ),
        "tools",
        "Mentions lending or borrowing equipment/tools — showing condition & return terms.",
    ),
    (
        "agricultural_produce_fodder",
        re.compile(
            r"\b(napier|fodder|silage|hay|boma\s+rhodes|dairy\s+meal|cattle\s+feed|"
            r"surplus\s+produce|avocado|avocados|bananas|kales|sukuma|eggs|milk|"
            r"seedlings|manure|maize\s+stover|sweet\s+potato\s+vines)\b",
            re.IGNORECASE,
        ),
        "agriculture",
        "Mentions farm produce, seedlings, or livestock fodder — showing fractional quantity, unit & pickup fields.",
    ),
    (
        "repair_artisan",
        re.compile(
            r"\b(fence\s+repair|fencing|cobbler|shoe\s+repair|plumber|plumbing|"
            r"carpenter|carpentry|fundi|electrician|welder|welding|mason|"
            r"gutter|roof\s+leak|gate\s+repair|tailor|appliance\s+repair)\b",
            re.IGNORECASE,
        ),
        "repairs",
        "Mentions repair or artisan work — showing scope measurement, timing & quotation fields.",
    ),
]


class YouthSafetyError(ValueError):
    """Raised when a youth opportunity violates supervision, hour, or hazard rules."""


def infer_activity_template(
    posting_type: str,
    text: str = "",
    category: Optional[str] = None,
    explicit_template: Optional[str] = None,
) -> dict:
    """Deterministically infer the best activity template and its extra fields."""
    ptype = (posting_type or "available").strip().lower()
    if ptype not in POSTING_TYPES:
        ptype = "available"

    combined = f"{text or ''} {category or ''}".strip()

    if explicit_template and explicit_template in ACTIVITY_TEMPLATES and explicit_template != "general":
        schema = TEMPLATE_SCHEMAS[explicit_template]
        return {
            "posting_type": ptype,
            "inferred_template": explicit_template,
            "template_label": schema["label"],
            "category": (category or "").strip() or schema["default_category"],
            "confidence_kind": "selected_by_user",
            "reason": f"Using {schema['label']} fields chosen by author.",
            "extra_fields": schema["extra_fields"],
        }

    # Special rule: a cobbler visit on a `scheduled` posting by the cobbler is a
    # `travelling_round`, whereas `wanted` ("Need a cobbler") is `repair_artisan`.
    if ptype == "scheduled" and re.search(r"\b(cobbler|fundi|vet|sharpener|tailor)\b", combined, re.I):
        schema = TEMPLATE_SCHEMAS["travelling_round"]
        return {
            "posting_type": ptype,
            "inferred_template": "travelling_round",
            "template_label": schema["label"],
            "category": (category or "").strip() or "cobbler",
            "confidence_kind": "deterministic_rule",
            "reason": "Scheduled artisan visit — enabling ordered stops for households in the area.",
            "extra_fields": schema["extra_fields"],
        }

    for tpl_key, pattern, default_cat, reason in _INFERENCE_RULES:
        if pattern.search(combined):
            schema = TEMPLATE_SCHEMAS[tpl_key]
            return {
                "posting_type": ptype,
                "inferred_template": tpl_key,
                "template_label": schema["label"],
                "category": (category or "").strip() or default_cat,
                "confidence_kind": "deterministic_rule",
                "reason": reason,
                "extra_fields": schema["extra_fields"],
            }

    schema = TEMPLATE_SCHEMAS["general"]
    return {
        "posting_type": ptype,
        "inferred_template": "general",
        "template_label": schema["label"],
        "category": (category or "").strip() or None,
        "confidence_kind": "default",
        "reason": "Standard local activity — only essential fields required.",
        "extra_fields": [],
    }


def validate_youth_safety(
    inferred_template: str,
    permission_rules: Optional[dict],
    template_fields: Optional[dict],
    title: str,
    body: str,
    starts_at: Optional[datetime] = None,
    ends_at: Optional[datetime] = None,
) -> dict:
    """Enforce server-side child/youth protection rules.

    Returns the normalized `permission_rules` dict (with `guardian_consent_required=True`
    locked on whenever an activity targets under-18s). Raises `YouthSafetyError`
    on any violation.
    """
    rules = dict(permission_rules or {})
    tfields = dict(template_fields or {})
    is_youth = bool(
        inferred_template == "supervised_youth_task"
        or rules.get("is_youth_opportunity")
        or rules.get("age_band")
        or tfields.get("age_band")
    )
    if not is_youth:
        rules.setdefault("is_youth_opportunity", False)
        return rules

    combined_text = f"{title or ''} {body or ''}"
    hazard_match = YOUTH_PROHIBITED_PATTERNS.search(combined_text)
    if hazard_match:
        raise YouthSafetyError(
            f"Youth opportunities cannot involve hazardous, night, or unsupervised domestic work "
            f"(matched '{hazard_match.group(0)}')."
        )

    age_band = rules.get("age_band") or tfields.get("age_band")
    if age_band not in YOUTH_AGE_BANDS:
        raise YouthSafetyError(
            f"Youth opportunities require an eligible age_band: {', '.join(YOUTH_AGE_BANDS)}."
        )

    permitted_domain = rules.get("permitted_domain") or tfields.get("permitted_domain")
    if permitted_domain not in YOUTH_PERMITTED_DOMAINS:
        raise YouthSafetyError(
            f"Youth opportunities must specify a safe permitted_domain: {', '.join(YOUTH_PERMITTED_DOMAINS)}."
        )

    supervisor_name = (rules.get("supervisor_name") or tfields.get("supervisor_name") or "").strip()
    supervisor_role = (rules.get("supervisor_role") or tfields.get("supervisor_role") or "").strip()
    if len(supervisor_name) < 3 or len(supervisor_role) < 2:
        raise YouthSafetyError(
            "Youth opportunities require a named adult supervisor (supervisor_name and supervisor_role)."
        )

    for dt_label, dt_val in (("starts_at", starts_at), ("ends_at", ends_at)):
        if dt_val is not None and (dt_val.hour < 6 or dt_val.hour > 19):
            raise YouthSafetyError(
                f"Youth opportunities must run during supervised daytime hours (06:00–19:00); {dt_label} is outside daytime hours."
            )

    rules.update({
        "is_youth_opportunity": True,
        "age_band": age_band,
        "permitted_domain": permitted_domain,
        "supervisor_name": supervisor_name,
        "supervisor_role": supervisor_role,
        "daytime_hours_only": True,
        "guardian_consent_required": True,  # Immutable server invariant
    })
    return rules


__all__ = [
    "POSTING_TYPE_META",
    "TEMPLATE_SCHEMAS",
    "YOUTH_AGE_BANDS",
    "YOUTH_PERMITTED_DOMAINS",
    "YouthSafetyError",
    "infer_activity_template",
    "validate_youth_safety",
]

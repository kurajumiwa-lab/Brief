"""The claim catalog — the documents a Kenyan buyer actually asks to see (v2.11).

This file is DATA, not logic: the vocabulary the rest of the app is allowed to
speak about a business's paperwork. It exists so that "verified supplier" can
mean something specific — this document, issued by this office, seen by this
person, on this date — instead of a badge.

Three rules the catalog is built on:

1. **A claim is evidence, never a verdict.** `tax_compliance` verified means
   *we saw a KRA Tax Compliance Certificate*. It does not mean the business is
   compliant today, solvent, honest, or good. The wording of every label and
   hint is written so an owner cannot accidentally read a badge as a promise,
   and the API says the same thing in `passport.disclaimer`.

2. **Two kinds of date, two meanings.** `validity_months` is an expiry the
   document itself carries (a county permit runs a year) — past it, the claim
   is `expired`, because the evidence really is out of date. `review_months`
   is the platform's own check-in cadence for facts with no printed expiry
   (a PIN certificate, a BRS registration): nothing "expires", but a human
   re-checks now and then. Conflating the two is how platforms end up lying.

3. **Owner-declared ≠ verified.** Some things cannot be checked from paper
   (who owns a business is a declaration unless a CR12 backs it). Those are
   listed as `attribute` claims and the API always says who said so.

Not legal advice, and not a compliance engine: these are the document types
buyers ask for most often, and `CHECKLISTS` is a readiness guide. The
opportunity itself names its own requirements, and the verification note
records exactly what a human checked.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional


@dataclass(frozen=True)
class ClaimSpec:
    key: str
    label: str                      # what the owner picks in the list
    issuer: str                     # who puts the document on paper
    group: str                      # identity | tax | licences | cover | ownership
    evidence: str                   # what the piece of paper actually is
    validity_months: Optional[int] = None   # printed expiry, if the document has one
    review_months: Optional[int] = None     # re-check cadence when it has none
    sectors: tuple[str, ...] = ()           # empty = every sector
    attribute: bool = False                 # a declaration about the owner, not a certificate
    hint: str = ""                          # one line of guidance for the owner


CLAIMS: tuple[ClaimSpec, ...] = (
    # ── identity ─────────────────────────────────────────────────────────────
    ClaimSpec(
        key="brs_registration",
        label="Business registration (BRS)",
        issuer="Business Registration Service, via eCitizen",
        group="identity",
        evidence="Certificate of Incorporation, or Certificate of Registration for a business name",
        review_months=24,
        hint="The certificate eCitizen issued you. Sole traders have a business-name certificate, not a CR12.",
    ),
    ClaimSpec(
        key="cr12",
        label="CR12 — directors and shareholders",
        issuer="Business Registration Service",
        group="identity",
        evidence="A CR12 official search showing current directors and shareholders",
        validity_months=6,
        hint="Limited companies only. Most institutions want one issued in the last six months.",
    ),
    ClaimSpec(
        key="kra_pin",
        label="KRA PIN certificate",
        issuer="Kenya Revenue Authority (iTax)",
        group="tax",
        evidence="The KRA PIN certificate naming the business and its PIN",
        review_months=24,
        hint="The PIN on the certificate must match the name on your registration.",
    ),
    ClaimSpec(
        key="tax_compliance",
        label="Tax Compliance Certificate (TCC)",
        issuer="Kenya Revenue Authority (iTax)",
        group="tax",
        evidence="A KRA Tax Compliance Certificate in the business's name",
        validity_months=12,
        hint="If your TCC is months old, request a fresh one before a bid — buyers check the date.",
    ),
    ClaimSpec(
        key="etims_onboarded",
        label="eTIMS onboarding",
        issuer="Kenya Revenue Authority",
        group="tax",
        evidence="An eTIMS-signed invoice or receipt (with control number and QR), or KRA's onboarding confirmation",
        review_months=24,
        hint="One recent eTIMS invoice you issued is the fastest proof — every business must now issue these.",
    ),
    ClaimSpec(
        key="county_permit",
        label="County single business permit",
        issuer="County government",
        group="licences",
        evidence="The current single business permit for the premises where you trade",
        validity_months=12,
        hint="Buyers from a county usually want that county's permit — permits do not cross borders.",
    ),
    # ── sector licences ──────────────────────────────────────────────────────
    ClaimSpec(
        key="agpo_certificate",
        label="AGPO certificate",
        issuer="National Treasury — Access to Government Procurement Opportunities",
        group="licences",
        evidence="The AGPO certificate for the enterprise's reserved-category registration",
        validity_months=12,
        hint="Register on the AGPO portal via eCitizen. The certificate prints its own validity — the printed date wins.",
    ),
    ClaimSpec(
        key="ppb_licence",
        label="Pharmacy and Poisons Board licence",
        issuer="Pharmacy and Poisons Board",
        group="licences",
        evidence="A current PPB licence covering the products supplied (medicines, devices, diagnostics)",
        validity_months=12,
        sectors=("health",),
        hint="Only for suppliers of medicines, medical devices or diagnostics. Services like cleaning do not need it.",
    ),
    ClaimSpec(
        key="public_health_certificate",
        label="Public health certificate (catering, food, cleaning, laundry)",
        issuer="County public health office",
        group="licences",
        evidence="The certificate or food-handler medical certificates the county issues for food handling and related work",
        validity_months=12,
        sectors=("health", "food", "events"),
        hint="Hospitals ask for this from caterers, laundries, cleaners and food suppliers.",
    ),
    ClaimSpec(
        key="nca_registration",
        label="NCA registration (construction)",
        issuer="National Construction Authority",
        group="licences",
        evidence="A current NCA registration or contractor certificate",
        validity_months=12,
        sectors=("construction",),
        hint="Required for construction works contracts. Sub-contractors are often asked for it too.",
    ),
    ClaimSpec(
        key="kebs_certification",
        label="KEBS product certification or permit",
        issuer="Kenya Bureau of Standards",
        group="licences",
        evidence="A KEBS permit, certification mark licence or test certificate for the products supplied",
        validity_months=12,
        sectors=("manufacturing", "food", "export"),
        hint="Standards marks and import permits are per product, not per business — attach the one that covers what you sell.",
    ),
    ClaimSpec(
        key="halal_certification",
        label="Halal certification",
        issuer="A recognised halal certifier",
        group="licences",
        evidence="A current halal certificate covering the products or premises",
        validity_months=12,
        sectors=("food",),
        hint="Name the certifier on the certificate — buyers check which body issued it.",
    ),
    # ── cover ────────────────────────────────────────────────────────────────
    ClaimSpec(
        key="insurance_cover",
        label="Insurance cover (goods in transit, professional indemnity, WIBA)",
        issuer="A licensed insurer",
        group="cover",
        evidence="A current certificate of insurance naming the risk it covers",
        validity_months=12,
        hint="Attach the schedule page that shows the cover and the period, not just the payment receipt.",
    ),
    # ── declarations (unverifiable from paper) ───────────────────────────────
    ClaimSpec(
        key="ownership_women",
        label="Women-owned (70%+)",
        issuer="Owner declaration",
        group="ownership",
        evidence="A declaration; cross-checked against the CR12 when one is attached",
        validity_months=None,
        review_months=24,
        attribute=True,
        hint="AGPO requires 70%+ ownership and full control. Where you have a CR12, it is the tie-breaker.",
    ),
    ClaimSpec(
        key="ownership_youth",
        label="Youth-owned (70%+)",
        issuer="Owner declaration",
        group="ownership",
        evidence="A declaration; cross-checked against the CR12 when one is attached",
        review_months=24,
        attribute=True,
        hint="AGPO defines youth as 18–35 at registration. 70%+ ownership and full control.",
    ),
    ClaimSpec(
        key="ownership_pwd",
        label="Owned by persons with disabilities (70%+)",
        issuer="Owner declaration",
        group="ownership",
        evidence="A declaration; cross-checked against the CR12 when one is attached",
        review_months=24,
        attribute=True,
        hint="AGPO reserves a share of its 30% for PWD-owned enterprises.",
    ),
    ClaimSpec(
        key="odpc_registration",
        label="ODPC registration (data controller / processor)",
        issuer="Office of the Data Protection Commissioner",
        group="licences",
        evidence="The ODPC registration certificate for businesses that process other people's personal data",
        review_months=24,
        sectors=("ict", "health"),
        hint="Digital, payroll, health-records and marketing businesses are usually asked for this.",
    ),
    ClaimSpec(
        key="export_documentation",
        label="Export documentation",
        issuer="Depends on the product (AFFA, KEBS, Customs, a buyer's permit)",
        group="licences",
        evidence="The specific export permit, phytosanitary or conformity certificate the destination requires",
        validity_months=12,
        sectors=("export", "agriculture"),
        hint="Name the exact document in your note — export papers differ by product and destination.",
    ),
)

CLAIM_INDEX: dict[str, ClaimSpec] = {c.key: c for c in CLAIMS}

GROUP_ORDER = ("identity", "tax", "licences", "cover", "ownership")


# ─────────────────────────────────────────────────────────────────────────────
# checklists — what a buyer type usually asks to see, before the specific
# opportunity asks for something of its own. A readiness guide, not a gate.
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ChecklistItem:
    label: str
    claim: Optional[str] = None                 # one claim satisfies it
    any_of: tuple[str, ...] = ()                # or any one of these claims
    must_have: bool = False
    hint: str = ""

    def keys(self) -> tuple[str, ...]:
        return (self.claim,) if self.claim else tuple(self.any_of)


@dataclass(frozen=True)
class ChecklistSpec:
    key: str
    label: str
    audience: str
    items: tuple[ChecklistItem, ...]
    note: str = ""


CHECKLISTS: tuple[ChecklistSpec, ...] = (
    ChecklistSpec(
        key="institutional_standard",
        label="Formal buyer pack",
        audience="Corporates, institutions and public buyers of any sector",
        note="What a procurement officer asks for before a supplier is even allowed to quote.",
        items=(
            ChecklistItem(
                label="Registered business (BRS)", claim="brs_registration", must_have=True,
                hint="Certificate of Incorporation, or a business-name certificate for sole traders.",
            ),
            ChecklistItem(
                label="KRA PIN", claim="kra_pin", must_have=True,
                hint="The certificate, with the name matching your registration.",
            ),
            ChecklistItem(
                label="Tax Compliance Certificate", claim="tax_compliance", must_have=True,
                hint="Must be current — buyers check the date.",
            ),
            ChecklistItem(
                label="County single business permit", claim="county_permit",
                hint="The permit for where you actually trade.",
            ),
            ChecklistItem(
                label="eTIMS onboarding", claim="etims_onboarded",
                hint="Buyers cannot claim your invoice as an expense without it.",
            ),
            ChecklistItem(
                label="CR12, current (limited companies)", claim="cr12",
                hint="Companies only. Sole traders and partnerships skip this one.",
            ),
        ),
    ),
    ChecklistSpec(
        key="agpo_reserved",
        label="AGPO reserved opportunities",
        audience="Youth-, women- and PWD-owned enterprises bidding for the 30% reservation",
        note=(
            "AGPO reserves 30% of public procurement for enterprises at least 70% owned and fully "
            "controlled by youth (18–35), women or persons with disabilities. Registration is the "
            "first step; winning needs the ordinary pack as well."
        ),
        items=(
            ChecklistItem(
                label="Registered business (BRS)", claim="brs_registration", must_have=True,
            ),
            ChecklistItem(label="KRA PIN", claim="kra_pin", must_have=True),
            ChecklistItem(
                label="Tax Compliance Certificate", claim="tax_compliance", must_have=True,
            ),
            ChecklistItem(
                label="AGPO certificate", claim="agpo_certificate", must_have=True,
                hint="Apply through the AGPO portal on eCitizen; the certificate prints its own validity.",
            ),
            ChecklistItem(
                label="AGPO ownership category", any_of=("ownership_youth", "ownership_women", "ownership_pwd"),
                must_have=True,
                hint="70%+ ownership and full control by the qualifying group.",
            ),
            ChecklistItem(label="County single business permit", claim="county_permit"),
        ),
    ),
    ChecklistSpec(
        key="healthcare_supply",
        label="Health facility supply and services",
        audience="Hospitals, clinics and their non-clinical suppliers",
        note=(
            "What SHA-contracted facilities commonly ask of suppliers and service providers. "
            "It is not a clinical, HMIS or SHA certification requirement — those sit with the "
            "facility and its systems, not with a supplier directory."
        ),
        items=(
            ChecklistItem(
                label="Registered business (BRS)", claim="brs_registration", must_have=True,
            ),
            ChecklistItem(label="KRA PIN", claim="kra_pin", must_have=True),
            ChecklistItem(
                label="Tax Compliance Certificate", claim="tax_compliance", must_have=True,
            ),
            ChecklistItem(label="County single business permit", claim="county_permit", must_have=True),
            ChecklistItem(
                label="PPB licence (medicines, devices, diagnostics)", claim="ppb_licence",
                hint="Required when the supply includes regulated health products; not for cleaning, catering or IT.",
            ),
            ChecklistItem(
                label="Public health certificate (catering, laundry, cleaning)", claim="public_health_certificate",
                hint="The county certificate for food handling and related services.",
            ),
            ChecklistItem(
                label="Insurance cover", claim="insurance_cover",
                hint="Goods in transit for deliveries; professional indemnity for services.",
            ),
        ),
    ),
    ChecklistSpec(
        key="food_hospitality",
        label="Food, catering and events",
        audience="Caterers, food suppliers, event hosts and hospitality businesses",
        items=(
            ChecklistItem(
                label="Registered business (BRS)", claim="brs_registration", must_have=True,
            ),
            ChecklistItem(label="KRA PIN", claim="kra_pin", must_have=True),
            ChecklistItem(
                label="Tax Compliance Certificate", claim="tax_compliance", must_have=True,
            ),
            ChecklistItem(label="County single business permit", claim="county_permit", must_have=True),
            ChecklistItem(
                label="Public health certificate", claim="public_health_certificate", must_have=True,
                hint="Event hosts and hotels ask for the food-handling certificate before a booking.",
            ),
            ChecklistItem(label="Halal certification", claim="halal_certification"),
        ),
    ),
    ChecklistSpec(
        key="construction_built_env",
        label="Construction and built environment",
        audience="Contractors, installers, fabricators and their subcontractors",
        items=(
            ChecklistItem(
                label="Registered business (BRS)", claim="brs_registration", must_have=True,
            ),
            ChecklistItem(label="KRA PIN", claim="kra_pin", must_have=True),
            ChecklistItem(
                label="Tax Compliance Certificate", claim="tax_compliance", must_have=True,
            ),
            ChecklistItem(
                label="NCA registration", claim="nca_registration", must_have=True,
                hint="Works contracts generally require it; many main contractors pass the requirement down.",
            ),
            ChecklistItem(label="Insurance cover", claim="insurance_cover"),
            ChecklistItem(label="County single business permit", claim="county_permit"),
        ),
    ),
    ChecklistSpec(
        key="export_trade",
        label="Export and cross-border trade",
        audience="Exporters, processors and their logistics partners",
        items=(
            ChecklistItem(
                label="Registered business (BRS)", claim="brs_registration", must_have=True,
            ),
            ChecklistItem(label="KRA PIN", claim="kra_pin", must_have=True),
            ChecklistItem(
                label="Tax Compliance Certificate", claim="tax_compliance", must_have=True,
            ),
            ChecklistItem(
                label="KEBS certification or permit", claim="kebs_certification",
                hint="Per product, not per business.",
            ),
            ChecklistItem(
                label="Export documentation", claim="export_documentation",
                hint="The exact paper depends on the product and the destination.",
            ),
            ChecklistItem(label="Insurance cover", claim="insurance_cover"),
        ),
    ),
)

CHECKLIST_INDEX: dict[str, ChecklistSpec] = {c.key: c for c in CHECKLISTS}


def claim_spec(key: str) -> Optional[ClaimSpec]:
    return CLAIM_INDEX.get(key)


def checklist_spec(key: str) -> Optional[ChecklistSpec]:
    return CHECKLIST_INDEX.get(key)


def add_months(start: date, months: int) -> date:
    """`start` plus N calendar months, with the day clamped to the month's end
    (31 Jan + 1 month is 28/29 Feb — a real date, never a crash)."""
    month = start.month - 1 + months
    year = start.year + month // 12
    month = month % 12 + 1
    last_day = (date(year + (month // 12), month % 12 + 1, 1)
                if month < 12 else date(year + 1, 1, 1)) - timedelta(days=1)
    return date(year, month, min(start.day, last_day.day))


def default_expiry(key: str, seen_on: date) -> Optional[date]:
    """The expiry the document is expected to carry, from the day we saw it.

    Returns None for facts with no printed expiry — those get review
    reminders instead, never a fabricated "expired" state.
    """
    spec = claim_spec(key)
    if not spec or not spec.validity_months:
        return None
    return add_months(seen_on, spec.validity_months)


def claims_for_sector(sector: Optional[str]) -> list[ClaimSpec]:
    """The claims worth offering a business, by sector (empty `sectors` = all)."""
    if not sector:
        return list(CLAIMS)
    return [c for c in CLAIMS if not c.sectors or sector in c.sectors]


def catalog_payload() -> dict:
    """The catalog as the API returns it — grouped, with groups in reading order."""
    return {
        "claims": [
            {
                "key": c.key, "label": c.label, "issuer": c.issuer, "group": c.group,
                "evidence": c.evidence, "validity_months": c.validity_months,
                "review_months": c.review_months, "sectors": list(c.sectors),
                "attribute": c.attribute, "hint": c.hint,
            }
            for g in GROUP_ORDER for c in CLAIMS if c.group == g
        ],
        "checklists": [
            {
                "key": ch.key, "label": ch.label, "audience": ch.audience, "note": ch.note,
                "items": [
                    {
                        "label": i.label, "claim": i.claim, "any_of": list(i.any_of),
                        "keys": list(i.keys()), "must_have": i.must_have, "hint": i.hint,
                    }
                    for i in ch.items
                ],
            }
            for ch in CHECKLISTS
        ],
    }

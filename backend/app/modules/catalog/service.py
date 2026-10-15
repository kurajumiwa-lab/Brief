"""Service layer for the storefront catalogue & enquiries (v2.14)."""

from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.vendor import Vendor
from app.modules.catalog import catalog
from app.modules.catalog.models import CatalogEnquiry


class CatalogError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _offer_out(o: catalog.Offer) -> dict:
    return {
        "key": o.key, "line": o.line, "name": o.name,
        "price_min_kes": o.price_min_kes, "price_max_kes": o.price_max_kes,
        "price_unit": o.price_unit, "price_status": "test_range_not_market_verified",
        "readiness": o.readiness, "readiness_note": o.readiness_note,
        "turnaround": o.turnaround, "deliverables": list(o.deliverables),
        "exclusions": list(o.exclusions),
        "customer_must_provide": list(o.customer_must_provide),
        "revisions": o.revisions,
    }


def _tier_out(t: catalog.AccountTier) -> dict:
    return {
        "key": t.key, "name": t.name, "label": t.label,
        "price_min_kes": t.price_min_kes, "price_max_kes": t.price_max_kes,
        "test_price_kes_monthly": t.test_price_kes_monthly,
        "price_status": "free" if t.key == "junior" else "test_range_not_commitment",
        "billing": t.billing, "operational_plan": t.operational_plan,
        "checkout_status": t.checkout_status, "purpose": t.purpose,
        "includes": list(t.includes), "excludes": list(t.excludes),
    }


def trial_example(*, today_: Optional[date] = None) -> dict:
    """The exact disclosure a Business trial must show before confirming."""
    tier = catalog.tier_by_key(catalog.TRIAL_TERMS["tier"])
    start = today_ or date.today()
    return {
        **catalog.TRIAL_TERMS,
        "example": {
            "tier": tier.key,
            "trial_days": catalog.TRIAL_TERMS["days"],
            "first_charge_date": (start + timedelta(days=catalog.TRIAL_TERMS["days"])).isoformat(),
            "first_charge_amount_kes": tier.test_price_kes_monthly,
            "amount_basis": (
                f"Test price for the {tier.name} tier (range KSh {tier.price_min_kes}–"
                f"{tier.price_max_kes}/mo). The live amount is confirmed in writing "
                "before any charge — this example never authorises one."
            ),
            "reminder_days_before_charge": 3,
        },
    }


def catalogue_payload() -> dict:
    return {
        "headline": "Sell what businesses already buy",
        "price_honesty": (
            "All prices are test ranges to validate with buyers — not market-verified "
            "averages and not commitments. Hosting, support, payment fees, staff time "
            "and delivery cost decide the published price."
        ),
        "lines": [
            {**line, "offers": [_offer_out(o) for o in catalog.OFFERS if o.line == line["key"]]}
            for line in catalog.LINES
        ],
        "offers": [_offer_out(o) for o in catalog.OFFERS],
        "account_tiers": [_tier_out(t) for t in catalog.ACCOUNT_TIERS],
        "verification_note": catalog.VERIFICATION_NOTE,
        "trial": trial_example(),
        "byod_vs_managed": list(catalog.BYOD_VS_MANAGED),
        "sell_tomorrow": [
            "Publish three offers first: one digital service, one business-software offer, one field-operations offer — each with price, scope, turnaround and an enquiry route",
            "Use legitimate business invoices and an existing verified payment channel until subscription billing is proven — do not delay selling to automate checkout",
            "Deliver manually where necessary and record the repeated tasks; they decide what gets automated next",
            "The first target is a small number of paying customers whose contracts can be fulfilled profitably — not thousands of free registrations",
        ],
    }


def account_tier_for_plan(plan_tier: Optional[str]) -> dict:
    """Public account-tier label for a vendor's existing plan_tier."""
    key = catalog.TIER_BY_PLAN.get((plan_tier or "starter").strip().lower(), "junior")
    tier = catalog.tier_by_key(key)
    return {
        "key": tier.key, "name": tier.name, "label": tier.label,
        "is_free": tier.key == "junior",
        "verification_note": catalog.VERIFICATION_NOTE,
    }


def _enquiry_out(e: CatalogEnquiry) -> dict:
    return {
        "id": str(e.id), "offer_key": e.offer_key, "tier_key": e.tier_key,
        "kind": e.kind, "organisation_name": e.organisation_name,
        "contact_name": e.contact_name, "contact_phone": e.contact_phone,
        "notes": e.notes, "status": e.status,
        "acknowledged_first_charge": bool(e.acknowledged_first_charge),
        "first_charge_amount_kes": e.first_charge_amount_kes,
        "first_charge_date": e.first_charge_date.isoformat() if e.first_charge_date else None,
        "next_step": (
            "A human follows up with scope, an invoice or a quotation. "
            "No payment has been taken and no subscription has started."
        ),
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


async def create_enquiry(db: AsyncSession, vendor: Vendor, *, kind: str,
                         offer_key: Optional[str], tier_key: Optional[str],
                         organisation_name: Optional[str], contact_name: Optional[str],
                         contact_phone: Optional[str], notes: Optional[str],
                         acknowledged_first_charge: bool) -> dict:
    kind_clean = (kind or "purchase").strip().lower()
    if kind_clean not in ("purchase", "trial", "quotation", "discovery_call"):
        raise CatalogError(f"Unknown enquiry kind '{kind}'", status=400)
    offer = catalog.offer_by_key(offer_key) if offer_key else None
    if offer_key and offer is None:
        raise CatalogError(f"Unknown offer '{offer_key}'", status=400)
    tier = catalog.tier_by_key(tier_key) if tier_key else None
    if tier_key and tier is None:
        raise CatalogError(f"Unknown account tier '{tier_key}'", status=400)
    if kind_clean in ("purchase", "quotation") and offer is None and tier is None:
        raise CatalogError("Choose an offer or an account tier to enquire about", status=400)

    first_amount = first_date = None
    if kind_clean == "trial":
        if tier is None or tier.key != catalog.TRIAL_TERMS["tier"]:
            raise CatalogError("The trial applies to the Business tier", status=400)
        if not acknowledged_first_charge:
            raise CatalogError(
                "Acknowledge the first-charge date and amount shown before requesting a trial",
                status=400)
        example = trial_example()["example"]
        first_amount, first_date = example["first_charge_amount_kes"], date.fromisoformat(example["first_charge_date"])

    enquiry = CatalogEnquiry(
        vendor_id=vendor.id,
        offer_key=offer.key if offer else None,
        tier_key=tier.key if tier else None,
        kind=kind_clean,
        organisation_name=(organisation_name or "").strip() or None,
        contact_name=(contact_name or "").strip() or None,
        contact_phone=(contact_phone or "").strip() or None,
        notes=(notes or "").strip() or None,
        acknowledged_first_charge=bool(acknowledged_first_charge) if kind_clean == "trial" else False,
        first_charge_amount_kes=first_amount,
        first_charge_date=first_date,
    )
    db.add(enquiry)
    await db.commit()
    await db.refresh(enquiry)
    return _enquiry_out(enquiry)


async def my_enquiries(db: AsyncSession, vendor: Vendor) -> list[dict]:
    rows = (await db.execute(
        select(CatalogEnquiry).where(CatalogEnquiry.vendor_id == vendor.id)
        .order_by(CatalogEnquiry.created_at.desc()).limit(50)
    )).scalars().all()
    return [_enquiry_out(e) for e in rows]

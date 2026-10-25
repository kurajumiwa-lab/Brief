"""Subscription billing rules (Track 2).

The state machine, in one place:

    (none) --subscribe--> trialing --payment.paid--> active
                             |                        |
                             | trial ends, unpaid     | payment.failed
                             v                        v
                          expired <--grace over-- past_due
                             ^                        |
                             |                        | cancel_at_period_end
                          cancelled <----period ends----+

Rules that are not negotiable in code:

* An invoice is settled at most once (unique ``psp_reference`` + status check).
* A plan is granted only after a *verified* provider event, never on request.
* A lapsed subscription returns the vendor to ``starter`` — it never deletes
  their records, and it never removes verification (payment cannot buy trust).
* Nothing in this module can make ``billing_live`` true. That comes from the
  configured provider and whether it can actually take money.
"""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.governance import RevenueEvent
from app.models.vendor import Vendor
from app.modules.billing.models import Subscription, SubscriptionInvoice
from app.modules.growth import rules as growth_rules
from app.modules.growth import service as growth_service

log = logging.getLogger(__name__)

TRIAL_DAYS = 14
GRACE_DAYS = 7
PERIOD_DAYS = {"monthly": 30, "annual": 365}
LIVE_STATUSES = ("trialing", "active", "past_due")


class BillingError(Exception):
    """Raised with an HTTP status the router can pass straight through."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def billing_live() -> dict:
    """Can this deployment actually charge a card or a phone?

    False is the honest answer for a mock provider, and the API says so instead
    of letting a screen imply recurring revenue that does not exist.
    """
    provider = (settings.PSP_PROVIDER or "mock").strip().lower()
    available = settings.payments_available
    if not available:
        return {
            "live": False,
            "provider": provider,
            "reason": "Payments are not available in this deployment, so no subscription can be charged.",
        }
    if provider == "mock":
        return {
            "live": False,
            "provider": provider,
            "reason": "The mock payment provider accepts test events only. Nothing is charged, "
                      "and recurring billing is not live.",
        }
    return {"live": True, "provider": provider, "reason": None}


def _now() -> datetime:
    return datetime.utcnow()


def _add_days(base: datetime, days: int) -> datetime:
    return base + timedelta(days=days)


def _spec(plan_tier: str):
    key = (plan_tier or "").strip().lower()
    if key not in growth_rules.PLAN_CATALOG:
        raise BillingError(
            f"plan_tier must be one of {', '.join(growth_rules.PLAN_CATALOG)}", status=400
        )
    spec = growth_rules.PLAN_CATALOG[key]
    if spec.price_kes_monthly <= 0:
        raise BillingError(
            f"{spec.name} is free — there is nothing to charge. "
            "Use PUT /api/growth/plan to select it.", status=400
        )
    return spec


async def _live_subscription(db: AsyncSession, vendor_id) -> Optional[Subscription]:
    return (await db.execute(
        select(Subscription).where(
            Subscription.vendor_id == vendor_id,
            Subscription.status.in_(LIVE_STATUSES),
        ).with_for_update()
    )).scalar_one_or_none()


async def current_subscription(db: AsyncSession, vendor_id) -> Optional[Subscription]:
    live = await _live_subscription(db, vendor_id)
    if live is not None:
        return live
    return (await db.execute(
        select(Subscription).where(Subscription.vendor_id == vendor_id)
        .order_by(Subscription.created_at.desc()).limit(1)
    )).scalar_one_or_none()


def _price(spec, billing_period: str) -> int:
    return spec.price_kes_annual if billing_period == "annual" else spec.price_kes_monthly


def _period_days(billing_period: str) -> int:
    return PERIOD_DAYS.get(billing_period, 30)


def _invoice_out(invoice: SubscriptionInvoice) -> dict:
    return {
        "id": str(invoice.id),
        "amount_kes": invoice.amount_kes,
        "status": invoice.status,
        "provider": invoice.provider,
        "psp_reference": invoice.psp_reference,
        "period_start": invoice.period_start.isoformat() if invoice.period_start else None,
        "period_end": invoice.period_end.isoformat() if invoice.period_end else None,
        "issued_at": invoice.issued_at.isoformat() if invoice.issued_at else None,
        "paid_at": invoice.paid_at.isoformat() if invoice.paid_at else None,
        "failed_at": invoice.failed_at.isoformat() if invoice.failed_at else None,
        "failure_reason": invoice.failure_reason,
        "attempt": invoice.attempt,
    }


def _subscription_out(sub: Optional[Subscription]) -> Optional[dict]:
    if sub is None:
        return None
    return {
        "id": str(sub.id),
        "plan_tier": sub.plan_tier,
        "billing_period": sub.billing_period,
        "price_kes": sub.price_kes,
        "status": sub.status,
        "provider": sub.provider,
        "trial_ends_at": sub.trial_ends_at.isoformat() if sub.trial_ends_at else None,
        "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "grace_until": sub.grace_until.isoformat() if sub.grace_until else None,
        "cancel_at_period_end": sub.cancel_at_period_end,
        "cancelled_at": sub.cancelled_at.isoformat() if sub.cancelled_at else None,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


async def overview(db: AsyncSession, vendor: Vendor) -> dict:
    sub = await current_subscription(db, vendor.id)
    invoices = []
    if sub is not None:
        invoices = (await db.execute(
            select(SubscriptionInvoice)
            .where(SubscriptionInvoice.subscription_id == sub.id)
            .order_by(SubscriptionInvoice.issued_at.desc())
        )).scalars().all()
    spec = growth_rules.plan_spec(vendor.plan_tier)
    return {
        "billing": billing_live(),
        "subscription": _subscription_out(sub),
        "invoices": [_invoice_out(i) for i in invoices],
        "plan": {
            "tier": spec.key,
            "name": spec.name,
            "price_kes_monthly": spec.price_kes_monthly,
            "price_kes_annual": spec.price_kes_annual,
        },
        "catalogue": [
            {
                "tier": s.key,
                "name": s.name,
                "price_kes_monthly": s.price_kes_monthly,
                "price_kes_annual": s.price_kes_annual,
                "max_seats": s.max_seats,
                "max_watches": s.max_watches,
            }
            for s in growth_rules.PLAN_CATALOG.values()
        ],
        "terms": {
            "trial_days": TRIAL_DAYS,
            "grace_days": GRACE_DAYS,
            "lapse_policy": "A lapsed subscription returns the account to Starter. "
                            "Records, stock history and verification are untouched — "
                            "payment buys features, never trust.",
        },
    }


async def start_subscription(
    db: AsyncSession,
    vendor: Vendor,
    *,
    plan_tier: str,
    billing_period: str = "monthly",
) -> dict:
    """Begin a subscription with a trial and its first invoice."""
    status = billing_live()
    if not status["live"] and status["provider"] != "mock":
        raise BillingError(status["reason"] or "Payments are unavailable", status=503)
    if status["provider"] == "mock" and settings.is_production:
        # Same rule as transaction payments: a mock provider never takes money in
        # production, so it must never grant a paid plan there either.
        raise BillingError(
            "Subscription billing is not configured in this deployment. "
            "No plan was changed and nothing was charged.",
            status=503,
        )
    if billing_period not in PERIOD_DAYS:
        raise BillingError(f"billing_period must be one of {', '.join(PERIOD_DAYS)}", status=400)

    spec = _spec(plan_tier)
    existing = await _live_subscription(db, vendor.id)
    if existing is not None:
        raise BillingError(
            f"You already have a {existing.status.replace('_', ' ')} subscription on "
            f"{growth_rules.plan_spec(existing.plan_tier).name}. Cancel or let it lapse before starting another.",
            status=409,
        )

    # A trial is a courtesy, not a loop: a vendor gets one, ever. Without this,
    # cancel-and-resubscribe would be an unlimited free plan.
    prior = (await db.execute(
        select(Subscription.id).where(Subscription.vendor_id == vendor.id).limit(1)
    )).scalar_one_or_none()
    trial_days = 0 if prior is not None else TRIAL_DAYS

    now = _now()
    price = _price(spec, billing_period)
    trial_end = _add_days(now, trial_days) if trial_days else None

    # No trial left: the invoice is due now, and the plan waits for payment.
    period_end = trial_end or _add_days(now, _period_days(billing_period))
    sub = Subscription(
        id=uuid.uuid4(),
        vendor_id=vendor.id,
        plan_tier=spec.key,
        billing_period=billing_period,
        price_kes=price,
        status="trialing" if trial_end else "past_due",
        provider=(settings.PSP_PROVIDER or "mock").strip().lower(),
        psp_sub_account=f"SUB_{vendor.id.hex[:16].upper()}",
        trial_ends_at=trial_end,
        current_period_start=now,
        current_period_end=period_end,
    )
    db.add(sub)
    await db.flush()

    invoice = _issue_invoice(db, sub, attempt=1)
    if trial_end:
        # The trial grants the plan for its duration. The sweep revokes it if the
        # invoice is still unpaid when the trial ends.
        await _grant(db, sub)
    await db.commit()
    await db.refresh(sub)
    return {
        "subscription": _subscription_out(sub),
        "invoice": _invoice_out(invoice),
        "billing": status,
        "note": (
            f"Your trial runs until {trial_end.date().isoformat()}. The plan is granted now; "
            "payment is verified by the provider, not by this request."
            if trial_end else
            "You have already used your trial. The plan activates when the provider confirms payment."
        ),
    }


def _issue_invoice(db: AsyncSession, sub: Subscription, *, attempt: int) -> SubscriptionInvoice:
    now = _now()
    period_start = sub.current_period_end if sub.status in ("active", "past_due") else now
    invoice = SubscriptionInvoice(
        id=uuid.uuid4(),
        subscription_id=sub.id,
        vendor_id=sub.vendor_id,
        amount_kes=sub.price_kes,
        status="pending",
        provider=sub.provider,
        # The provider echoes this back. Unique in the database, so a duplicate
        # cannot produce two settlements.
        psp_reference=f"SUBINV-{sub.id.hex[:10].upper()}-{attempt}-{uuid.uuid4().hex[:6].upper()}",
        period_start=period_start,
        period_end=_add_days(period_start, _period_days(sub.billing_period)),
        attempt=attempt,
    )
    db.add(invoice)
    return invoice


async def cancel(db: AsyncSession, vendor: Vendor, *, immediate: bool = False) -> dict:
    sub = await _live_subscription(db, vendor.id)
    if sub is None:
        raise BillingError("There is no live subscription to cancel", status=404)

    now = _now()
    if immediate:
        sub.status = "expired"
        sub.cancelled_at = now
        sub.cancel_at_period_end = False
        await _scale_down(db, vendor)
        note = "Cancelled now. The account is back on Starter; records are untouched."
    else:
        if sub.status == "trialing":
            sub.status = "expired"
            sub.cancelled_at = now
            await _scale_down(db, vendor)
            note = "Trial cancelled. The account is back on Starter."
        else:
            sub.cancel_at_period_end = True
            sub.cancelled_at = now
            note = (
                "Cancelled at the end of the paid period. You keep the plan until "
                f"{sub.current_period_end.date().isoformat()}, then return to Starter."
            )

    await db.commit()
    await db.refresh(sub)
    return {"subscription": _subscription_out(sub), "note": note}


async def _grant(db: AsyncSession, sub: Subscription) -> None:
    """Apply the paid plan. Payment never grants verification."""
    vendor = await db.get(Vendor, sub.vendor_id)
    if vendor is None:
        return
    if (vendor.plan_tier or "starter") != sub.plan_tier:
        try:
            await growth_service.change_plan(db, vendor, sub.plan_tier)
        except growth_rules.GrowthRuleError as exc:
            # Seat/watch limits may block a downgrade mid-flight; that is a
            # business answer, not a billing crash. The invoice still settles.
            log.warning("plan change to %s blocked for %s: %s", sub.plan_tier, vendor.id, exc)


async def _scale_down(db: AsyncSession, vendor: Vendor) -> None:
    if (vendor.plan_tier or "starter") == "starter":
        return
    try:
        await growth_service.change_plan(db, vendor, "starter")
    except growth_rules.GrowthRuleError as exc:
        # Seats over the Starter limit: the plan stays until they are revoked,
        # but the subscription is closed so nothing further is charged.
        log.warning("downgrade to starter blocked for %s: %s", vendor.id, exc)


async def _record_revenue(db: AsyncSession, invoice: SubscriptionInvoice, sub: Subscription) -> None:
    db.add(RevenueEvent(
        id=uuid.uuid4(),
        source_type="subscription",
        source_reference=str(invoice.id),
        gross_amount_ksh=invoice.amount_kes,
        payment_fees_ksh=0,
        net_amount_ksh=invoice.amount_kes,
        recognized_at=invoice.paid_at or _now(),
        evidence_note=f"Subscription payment verified by {invoice.provider} "
                      f"(ref {invoice.psp_reference}); plan {sub.plan_tier}.",
        created_by_vendor_id=invoice.vendor_id,
    ))


async def _on_paid(db: AsyncSession, invoice: SubscriptionInvoice, event: dict) -> bool:
    sub = await db.get(Subscription, invoice.subscription_id, with_for_update=True)
    if sub is None:
        log.warning("subscription invoice %s has no subscription", invoice.id)
        return False

    amount = event.get("amount")
    if amount is not None and int(amount) != invoice.amount_kes:
        log.error(
            "subscription amount mismatch: invoice %s expects %s, provider sent %s",
            invoice.id, invoice.amount_kes, amount,
        )
        return False

    now = _now()
    invoice.status = "paid"
    invoice.paid_at = now
    invoice.failure_reason = None

    sub.status = "active"
    sub.grace_until = None
    sub.current_period_start = invoice.period_start
    sub.current_period_end = invoice.period_end
    await db.flush()

    await _grant(db, sub)
    try:
        await _record_revenue(db, invoice, sub)
    except Exception:  # noqa: BLE001 - revenue bookkeeping must not fail a settlement
        log.exception("could not record subscription revenue for invoice %s", invoice.id)
    return True


async def _on_failed(db: AsyncSession, invoice: SubscriptionInvoice, event: dict) -> bool:
    sub = await db.get(Subscription, invoice.subscription_id, with_for_update=True)
    if sub is None:
        return False
    now = _now()
    invoice.status = "failed"
    invoice.failed_at = now
    invoice.failure_reason = str(event.get("reason") or "The provider declined the charge.")[:500]

    if sub.status in ("trialing", "active"):
        sub.status = "past_due"
    sub.grace_until = _add_days(now, GRACE_DAYS)
    return True


async def handle_provider_event(db: AsyncSession, event: dict) -> bool:
    """Apply a verified ``subscription.*`` event. Idempotent by design."""
    event_type = str(event.get("type") or "")
    reference = event.get("api_ref") or event.get("reference")
    if not reference:
        log.warning("subscription event without a reference ignored")
        return False

    invoice = (await db.execute(
        select(SubscriptionInvoice)
        .where(SubscriptionInvoice.psp_reference == str(reference))
        .with_for_update()
    )).scalar_one_or_none()
    if invoice is None:
        log.warning("subscription event for unknown invoice %s", reference)
        return False

    if event_type == "subscription.paid":
        if invoice.status == "paid":
            return True  # replay: the money already moved once
        return await _on_paid(db, invoice, event)
    if event_type == "subscription.failed":
        if invoice.status == "paid":
            return True  # never un-settle a paid invoice from a late failure
        return await _on_failed(db, invoice, event)
    if event_type == "subscription.cancelled":
        sub = await db.get(Subscription, invoice.subscription_id, with_for_update=True)
        if sub is not None and sub.status != "expired":
            sub.status = "expired"
            sub.cancelled_at = _now()
            vendor = await db.get(Vendor, sub.vendor_id)
            if vendor is not None:
                await _scale_down(db, vendor)
        return True

    log.info("subscription event type %s not handled", event_type)
    return False


async def simulate_mock_payment(db: AsyncSession, vendor: Vendor, invoice_id) -> dict:
    """Dev/mock only: complete an invoice as if the provider had answered.

    Refuses unless the mock provider is configured, so this can never be a
    back door to a paid plan in a deployment that can actually charge.
    """
    if (settings.PSP_PROVIDER or "mock").strip().lower() != "mock":
        raise BillingError(
            "This endpoint exists only for the mock provider. "
            "With a live provider, settlement comes from the verified webhook.",
            status=404,
        )
    invoice = await db.get(SubscriptionInvoice, invoice_id)
    if invoice is None or invoice.vendor_id != vendor.id:
        raise BillingError("Invoice not found", status=404)
    if invoice.status != "pending":
        raise BillingError(f"Invoice is already {invoice.status}", status=409)

    ok = await handle_provider_event(db, {
        "type": "subscription.paid",
        "api_ref": invoice.psp_reference,
        "amount": invoice.amount_kes,
        "id": f"MOCK-{uuid.uuid4().hex[:12].upper()}",
    })
    if not ok:
        await db.rollback()
        raise BillingError("The payment could not be applied", status=409)
    await db.commit()
    await db.refresh(invoice)
    return {
        "invoice": _invoice_out(invoice),
        "settled": True,
        "simulated": True,
        "note": "Mock provider: no money moved. This proves the state machine, not the revenue.",
    }


async def run_lifecycle_sweep(db: AsyncSession, *, now: Optional[datetime] = None) -> dict:
    """Expire trials and lapsed subscriptions, and cancel at period end.

    Safe to run repeatedly: every branch is guarded by a status it just changed.
    """
    now = now or _now()
    expired_trials = expired_past_due = cancelled = 0

    rows = (await db.execute(
        select(Subscription).where(Subscription.status.in_(("trialing", "past_due", "active")))
        .with_for_update()
    )).scalars().all()

    for sub in rows:
        vendor = await db.get(Vendor, sub.vendor_id)
        if sub.status == "trialing" and sub.trial_ends_at and sub.trial_ends_at <= now:
            sub.status = "expired"
            expired_trials += 1
            if vendor is not None:
                await _scale_down(db, vendor)
        elif sub.status == "past_due" and sub.grace_until and sub.grace_until <= now:
            sub.status = "expired"
            expired_past_due += 1
            if vendor is not None:
                await _scale_down(db, vendor)
        elif (
            sub.status == "active"
            and sub.cancel_at_period_end
            and sub.current_period_end <= now
        ):
            sub.status = "cancelled"
            cancelled += 1
            if vendor is not None:
                await _scale_down(db, vendor)

    await db.commit()
    return {
        "ran_at": now.isoformat(),
        "expired_trials": expired_trials,
        "expired_past_due": expired_past_due,
        "cancelled_at_period_end": cancelled,
    }

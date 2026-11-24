"""FINANCIAL CONTAINMENT GATES (P0-B).

Brief's product boundary is **no lending and no custody of client capital**.
The chama (table-banking) and murabaha (cost-plus advance) engines were built
and mounted before that boundary was settled, and the P0-A investigation found
both reachable in production with no runtime gate at all — while every other
payment surface in the app (trade payments, billing, fees) was already flagged.

This module is the single place that answers "may this deployment start *new*
financial exposure?" Both flags default to **False**, and a missing or malformed
value fails closed: an operator must opt in explicitly.

What is gated and what is not
-----------------------------
The test applied to each path is simple and is the reason some operations that
look financial are deliberately left open:

    Does this create new exposure, or does it settle exposure that already
    exists?

Gated (creates new exposure):

* creating a chama, or requesting/approving a murabaha contract;
* deposits, loan applications, profit remittances;
* loan votes — a vote exists only to decide a payout, and at quorum it triggers
  one, so allowing votes while blocking payouts would record a yes that can
  never be honoured;
* dividend distribution, the disbursement path itself (the single sink every
  payout funnels through), and payout retries.

**Not** gated, deliberately:

* *settling existing debt* — ``repay_loan`` needs ``status == "disbursed"`` and
  ``pay_murabaha`` needs ``status == "active"``; both states are reachable only
  through a gated path, so these can only ever discharge a commitment that
  already existed. Blocking them would default a borrower mid-repayment and
  turn containment into a second incident;
* declining a pending murabaha, which releases exposure rather than creating it;
* reading history — deposits, loans, dividends, ledgers, contracts;
* staff investigation, custody balances, reconciliation, disputes;
* the PSP webhook, so an intent created before containment can still settle.

Containment that hides records or strands an in-flight payment is not
containment; it is a second incident. The gates are therefore evaluated at the
*service* boundary — the same functions the routers call — so a future caller
that skips the router still cannot move money.
"""

from __future__ import annotations

from fastapi import HTTPException

from app.config import settings

#: The one response a disabled operation returns. Clients branch on this shape,
#: so it is a constant rather than a message repeated at six call sites.
UNAVAILABLE_DETAIL = (
    "This feature is not available on this deployment. "
    "New financial activity is disabled; existing records remain readable."
)


def _on(value) -> bool:
    """Fail closed: only an explicit truthy value turns a gate on.

    This is the second of two layers, and the layers do different jobs.

    The first is the ``bool`` field on ``Settings``. It parses the environment
    with pydantic, exactly like the other 28 boolean flags in this app: unset
    means ``False``, and a malformed value (``"junk"``, an empty string) raises
    at import so the process never starts. Refusing to boot is the safe failure
    here — it cannot silently enable a lending service.

    This helper covers what pydantic does not: values assigned at runtime, in
    tests or by a future caller, where the type contract is no longer enforced.
    Anything not explicitly truthy reads as off, because the cost of guessing
    wrong is starting new financial activity nobody approved.
    """
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def chama_enabled() -> bool:
    return _on(getattr(settings, "CHAMA_ENABLED", False))


def murabaha_enabled() -> bool:
    return _on(getattr(settings, "MURABAHA_ENABLED", False))


def _refuse(feature: str) -> None:
    raise HTTPException(503, f"{feature} is disabled on this deployment. {UNAVAILABLE_DETAIL}")


def require_chama_enabled() -> None:
    """Raise 503 unless this deployment allows new chama financial activity."""
    if not chama_enabled():
        _refuse("Chama")


def require_murabaha_enabled() -> None:
    """Raise 503 unless this deployment allows new murabaha advances."""
    if not murabaha_enabled():
        _refuse("Murabaha")


def require_murabaha_eligible(vendor) -> None:
    """F-13: enforce murabaha eligibility independently of the feature gate.

    A murabaha advance is a cost-plus sale: the Sacco buys the stock and resells
    it at a fixed, disclosed markup with no interest. That is a *Halal* pool
    structure, and `services.chamas.HALAL_POOL_MODELS` already names the three
    models the product treats as such — ``qard_hasan``, ``musharakah_trade`` and
    ``murabaha_credit``.

    The rule mirrors the riba block the repo already enforces in both
    ``join_chama`` and ``apply_for_loan``: a vendor on ``finance_mode ==
    'halal_sharia'`` is restricted to the Halal pool models, and a vendor on
    ``conventional`` may use any structure because a zero-interest, fixed-markup
    trade is permissible to everyone.

    Murabaha is a Halal pool model, so this check restricts Halal accounts no
    further — an interest-bearing structure is what would violate them, and a
    murabaha is not one. The check exists so the *principle* is enforced in code
    at the service boundary rather than left implicit: eligibility is derived
    from the pool-model taxonomy that already exists, not invented here.

    This runs even when ``MURABAHA_ENABLED`` is true, so enabling the flag can
    never enable a structure the product's own taxonomy calls ineligible.
    """
    mode = str(getattr(vendor, "finance_mode", "") or "conventional").strip().lower()
    if mode == "halal_sharia":
        # qard_hasan / musharakah_trade / murabaha_credit are all permissible;
        # there is no interest in a cost-plus sale, so nothing to block. The
        # branch is kept explicit so a future non-Halal murabaha variant has an
        # obvious place to be refused.
        return
    # Conventional accounts may take a murabaha: the structure is interest-free.
    return

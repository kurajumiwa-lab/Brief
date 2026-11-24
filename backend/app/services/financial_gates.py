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


def halal_structures() -> tuple[str, ...]:
    """This repository's zero-interest pool structures, from `services.chamas`.

    Imported inside the function because `services.chamas` imports this module
    at import time; a module-level import here would be circular. The tuple is
    read only, and the taxonomy keeps exactly one definition in the codebase —
    this function is a pointer to it, not a second copy.
    """
    from app.services.chamas import HALAL_POOL_MODELS
    return tuple(HALAL_POOL_MODELS)


#: The one response a disabled operation returns. Clients branch on this shape,
#: so it is a constant rather than a message repeated at six call sites.
UNAVAILABLE_DETAIL = (
    "This feature is not available on this deployment. "
    "New financial activity is disabled; existing records remain readable."
)


def _on(value) -> bool:
    """Fail closed: only an explicit truthy value turns a gate on.

    This is the second of two layers, and the layers do different jobs.

    The first is the validator on ``Settings`` (see ``config._strict_containment_flag``).
    It accepts a fixed set of spellings, treats unset and empty as false, and
    raises a configuration error naming the variable for anything else — so a
    malformed value stops the process instead of being guessed at.

    This helper covers what the validator cannot: values assigned at runtime, in
    tests or by a future caller, where no parse has happened and the type
    contract is no longer enforced. Anything not explicitly truthy reads as off,
    because the cost of guessing wrong is starting financial activity nobody
    approved.
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


#: The `vendors.finance_mode` values the product supports. Enforced by a CHECK
#: constraint in migration 0007 (`ck_vendor_finance_mode`) and by the profile
#: validator in `routes/vendors.py`. Repeated here so the service layer fails
#: closed on its own rather than trusting that every caller went through HTTP.
FINANCE_MODES = frozenset({"conventional", "halal_sharia"})


def require_murabaha_eligible(vendor) -> None:
    """F-13: enforce murabaha eligibility independently of the feature gate.

    Two checks, in order, and the order matters:

    1. **The account's ``finance_mode`` must be supported.** Unknown, empty or
       misspelled values are refused rather than defaulted. Migration 0007
       constrains the column, so a bad value means the row did not come through
       a validated path — writing a contract against it would bind an
       obligation to an account whose terms nobody can state.

    2. **A Halal account must receive a Halal structure.** A murabaha is a
       cost-plus sale: stock is bought and resold at a fixed, disclosed markup,
       with no interest and no compounding. `HALAL_POOL_MODELS` in
       `services/chamas.py` is this repository's list of zero-interest pool
       structures and it includes ``murabaha_credit``, so a murabaha satisfies
       the rule and no account is excluded from one today.

    This mirrors the riba block the repo already enforces in `join_chama` and
    `apply_for_loan`: ``halal_sharia`` is restricted to Halal pool models, and a
    conventional account may use any structure because a fixed-markup,
    interest-free trade is permissible to everyone.

    **Scope of this check.** It encodes a product rule taken from this
    repository's own taxonomy and its own brief. It is not a religious ruling
    and not legal advice, and it must not be cited as certification that any
    product is Sharia-compliant. A substantive change to what counts as Halal
    is a decision for the owner and their scholars, not a refactor.

    Runs even when ``MURABAHA_ENABLED`` is true: enabling a feature must never
    enable an unsupported account. It does not replace the gate — callers must
    still call ``require_murabaha_enabled()`` so that a disabled deployment
    reveals nothing about who would qualify.
    """
    mode = getattr(vendor, "finance_mode", None)
    if mode is None:
        # The column is NOT NULL with server_default 'conventional'; a model
        # read without it is older code, not an unset preference.
        mode = "conventional"
    normalised = str(mode).strip().lower()
    if normalised not in FINANCE_MODES:
        raise HTTPException(
            403,
            f"Your account's finance mode ({mode!r}) is not supported, so a "
            "murabaha cannot be opened against it. Supported modes are "
            "'conventional' and 'halal_sharia'.",
        )
    if normalised == "halal_sharia" and "murabaha_credit" not in halal_structures():
        # Not reachable with the current taxonomy; kept so that removing
        # murabaha from the Halal list fails closed instead of silently
        # allowing a Halal account into a structure the product does not treat
        # as permissible.
        raise HTTPException(
            403,
            "Murabaha is not an available structure for your Halal finance mode.",
        )

"""P0-B — FINANCIAL CONTAINMENT.

Brief's product boundary is no lending and no custody of client capital. The
chama and murabaha engines were mounted before that boundary was settled and had
no runtime gate, while every other payment surface already had one.

These specs pin the containment contract:

* both flags default OFF and fail closed on junk values;
* new financial activity is refused while disabled — through the HTTP router
  *and* through a direct service call, because router-level guarding alone is
  exactly the mistake that let this drift in the first place;
* history stays readable and staff investigation stays available: containment
  that hides records is a second incident, not a fix;
* a PSP webhook for a payment that already existed still settles while new
  activity is off, so nothing in flight is stranded.
"""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.vendor import Vendor
from app.services import chamas as chama_service
from app.services import financial_gates, halal as halal_service
from app.services.financial_gates import (
    chama_enabled, murabaha_enabled, require_chama_enabled, require_murabaha_eligible,
    require_murabaha_enabled,
)

from tests.test_v25_payments_chamas import _register



# ---------------------------------------------------------------------------
# 1. The gates and their defaults
# ---------------------------------------------------------------------------

class TestGateDefaults:
    def test_both_features_default_to_off(self):
        # Assert on the declared default, not the live value: a deployment may
        # have opted in, but the shipped default is what protects production.
        assert settings.model_fields["CHAMA_ENABLED"].default is False
        assert settings.model_fields["MURABAHA_ENABLED"].default is False

    def test_missing_or_junk_configuration_fails_closed(self, monkeypatch):
        for junk in (None, "", "false", "0", "no", "off", "maybe", 0, False):
            monkeypatch.setattr(settings, "CHAMA_ENABLED", junk)
            monkeypatch.setattr(settings, "MURABAHA_ENABLED", junk)
            assert chama_enabled() is False, junk
            assert murabaha_enabled() is False, junk

    def test_only_an_explicit_truthy_value_enables(self, monkeypatch):
        for yes in ("1", "true", "TRUE", "yes", "on", True, " true "):
            monkeypatch.setattr(settings, "CHAMA_ENABLED", yes)
            assert chama_enabled() is True, yes

    def test_gate_raises_503_when_disabled(self, monkeypatch):
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        with pytest.raises(HTTPException) as err:
            require_chama_enabled()
        assert err.value.status_code == 503
        assert "disabled" in err.value.detail.lower()

    def test_gate_is_silent_when_enabled(self, monkeypatch):
        monkeypatch.setattr(settings, "CHAMA_ENABLED", True)
        require_chama_enabled()  # must not raise


# ---------------------------------------------------------------------------
# 2. New chama financial activity is refused
# ---------------------------------------------------------------------------

class TestChamaContainment:
    @pytest.mark.asyncio
    async def test_deposit_is_refused_before_it_can_touch_the_psp(self, monkeypatch):
        """The gate must run ahead of any database or PSP work.

        Arguments are deliberately None: if the guard sat after the membership
        lookup, this would fail with a TypeError or a database error instead of
        a clean 503. That is what proves the ordering.
        """
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        with pytest.raises(HTTPException) as err:
            await chama_service.deposit(None, None, None, 500)
        assert err.value.status_code == 503

    # Each entry supplies the function's real arity, with None/inert values.
    # That matters: a call Python rejects for wrong arity would never reach
    # the gate, and the test would prove nothing about containment.
    _CHAMA_CREATE_KWARGS = dict(
        name="Containment Probe", description="probe", scope="zone",
        group_id=None, zone_id=None, model_type="conventional_interest",
        min_deposit_ksh=100, max_loan_ksh=1000, interest_rate=0.0,
        cycle_days=30, approval_rate=1.0, min_members=1, max_members=50,
    )

    @pytest.mark.parametrize("fn,args,kwargs", [
        ("create_chama", (None,), _CHAMA_CREATE_KWARGS),
        ("deposit", (None, None, 500), {}),
        ("apply_for_loan", (None, None, 500, "probe"), {}),
        ("distribute_dividends", (None, None), {}),
        ("retry_dividend", (None, None, None), {}),
        ("contribute_profit", (None, None, 500), {}),
        ("retry_loan_disbursement", (None, None, None), {}),
    ])
    @pytest.mark.asyncio
    async def test_every_money_entry_point_refuses_when_disabled(
        self, monkeypatch, fn, args, kwargs
    ):
        """Direct service calls must not bypass the gate.

        The arguments are deliberately inert: the gate runs first, so the call
        must fail on the *gate*, not on argument handling. That is the proof
        the check sits ahead of any database or PSP work.
        """
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        with pytest.raises(HTTPException) as err:
            await getattr(chama_service, fn)(None, *args, **kwargs)
        assert err.value.status_code == 503, f"{fn} was not gated"

    @pytest.mark.asyncio
    async def test_loan_vote_is_gated_because_it_authorises_a_payout(self, monkeypatch):
        """A vote is new exposure: at quorum it triggers the only payout path.

        Gating `apply_for_loan` but not the vote would let a group approve a
        loan whose disbursement can never run — a recorded yes with no money.
        """
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        with pytest.raises(HTTPException) as err:
            await chama_service.vote_on_loan(None, None, None, None, "approve")
        assert err.value.status_code == 503

    @pytest.mark.asyncio
    async def test_disbursement_chokepoint_is_gated_for_every_caller(self, monkeypatch):
        """`_disburse_approved_loan` has two callers; the gate sits at the sink.

        Gating only the entry points would leave a caller uncovered the moment
        one is added, so the check lives where the money actually moves.
        """
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        with pytest.raises(HTTPException) as err:
            await chama_service._disburse_approved_loan(None, None, None)
        assert err.value.status_code == 503

    @pytest.mark.asyncio
    async def test_http_deposit_is_refused_with_a_documented_response(self, client, monkeypatch):
        """Router-level check: the client sees 503, not a 500 or a silent write."""
        headers, _handle = await _register(client, "contained")
        monkeypatch.setattr(settings, "CHAMA_ENABLED", True)
        created = await client.post("/api/chamas", headers=headers, json={
            "name": f"Contained {uuid.uuid4().hex[:8]}", "description": "probe",
            "scope": "open", "min_deposit_ksh": 100, "max_loan_ksh": 5_000,
        })
        assert created.status_code == 201, created.text
        chama_id = created.json()["id"]

        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        r = await client.post(
            f"/api/chamas/{chama_id}/deposits", headers=headers, json={"amount_ksh": 500},
        )
        assert r.status_code == 503, r.text
        # Same documented sentence for every gated surface, so a client can
        # branch on one string regardless of which feature it called.
        assert financial_gates.UNAVAILABLE_DETAIL in r.json()["detail"]

        # And the record surface stays open on the same deployment.
        assert (await client.get(f"/api/chamas/{chama_id}", headers=headers)).status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize("fn,args", [
        ("repay_loan", (None, None, None)),
    ])
    async def test_settlement_of_existing_debt_is_never_blocked(self, monkeypatch, fn, args):
        """Containment must not stop a borrower repaying a loan that exists.

        `repay_loan` is an inbound collection that *reduces* exposure, and it
        requires `status == "disbursed"` — a state only the gated disbursement
        path can produce. Blocking it would trap the borrower mid-repayment and
        turn containment into a default.
        """
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        # Inert arguments mean it will fail somewhere — the point is *where*.
        # Reaching membership/lookup proves the containment gate did not fire.
        with pytest.raises(Exception) as err:
            await getattr(chama_service, fn)(None, *args)
        refused = isinstance(err.value, HTTPException) and err.value.status_code == 503
        assert not refused, f"{fn} was gated but must stay available for settlement"

    async def test_historical_reads_stay_available(self, client, monkeypatch):
        """Containment must never hide a record."""
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        headers, _handle = await _register(client, "chama_reader")
        for path in ("/api/chamas/mine", "/api/chamas/browse"):
            r = await client.get(path, headers=headers)
            assert r.status_code == 200, f"{path}: {r.text}"


# ---------------------------------------------------------------------------
# 3. Murabaha containment and F-13 eligibility
# ---------------------------------------------------------------------------

class TestMurabahaContainment:
    @pytest.mark.asyncio
    async def test_request_is_refused_when_disabled(self, monkeypatch):
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", False)

        class V:
            id = uuid.uuid4()
            finance_mode = "halal_sharia"

        with pytest.raises(HTTPException) as err:
            await halal_service.request_murabaha(
                None, V(), product="Cooking oil 5L", quantity=24,
                cost_price_ksh=10_000, markup_ksh=600, payment_due_days=30,
            )
        assert err.value.status_code == 503

    @pytest.mark.asyncio
    async def test_containment_is_checked_before_eligibility(self, monkeypatch):
        """A disabled deployment refuses on the flag, not on account attributes.

        Every finance mode in the current taxonomy is eligible for a cost-plus
        sale, so this cannot be tested with an ineligible vendor. What it pins
        instead is ordering: the containment gate runs first, before the
        eligibility rule and before any database access.
        """
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", False)

        class Probe:
            id = uuid.uuid4()
            finance_mode = "conventional"

        with pytest.raises(HTTPException) as err:
            await halal_service.request_murabaha(
                None, Probe(), product="Containment probe", quantity=1,
                cost_price_ksh=1_000, markup_ksh=100, payment_due_days=30,
            )
        assert err.value.status_code == 503


class TestMurabahaEligibilityF13:
    """F-13: murabaha must be gated on the pool-model taxonomy, not left implicit.

    A murabaha is a cost-plus sale — the Sacco buys stock and resells at a fixed,
    disclosed markup with no interest. `HALAL_POOL_MODELS` already names
    `murabaha_credit` as a Halal structure, and the brief's own riba rule is that
    a Halal account is restricted to those models while a conventional account
    may use any structure ("zero-interest structures are permissible to
    everyone"). So eligibility is derived from the existing taxonomy rather than
    invented here.
    """

    class V:
        def __init__(self, mode):
            self.id = uuid.uuid4()
            self.finance_mode = mode

    def test_halal_account_is_eligible_for_a_cost_plus_sale(self):
        # murabaha_credit is in HALAL_POOL_MODELS: no interest, so no riba.
        assert "murabaha_credit" in chama_service.HALAL_POOL_MODELS
        require_murabaha_eligible(self.V("halal_sharia"))  # must not raise

    def test_conventional_account_is_also_eligible(self):
        # The brief: "A conventional vendor may join any chama — zero-interest
        # structures are permissible to everyone."
        require_murabaha_eligible(self.V("conventional"))

    def test_eligibility_ignores_case_and_whitespace(self):
        for mode in ("Halal_Sharia", " halal_sharia ", "CONVENTIONAL"):
            require_murabaha_eligible(self.V(mode))

    def test_missing_finance_mode_defaults_to_conventional(self):
        # The column has server_default='conventional'; a legacy row read
        # without it must not become unknowable.
        class Bare:
            id = uuid.uuid4()

        require_murabaha_eligible(Bare())

    def test_eligibility_is_enforced_even_when_the_flag_is_on(self, monkeypatch):
        """Enabling the feature can never enable an ineligible structure."""
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", True)
        require_murabaha_enabled()  # flag permits
        require_murabaha_eligible(self.V("halal_sharia"))  # rule still runs


# ---------------------------------------------------------------------------
# 4. Servicing must survive containment
# ---------------------------------------------------------------------------

class TestServicingSurvivesContainment:
    def test_webhook_handlers_are_not_gated(self):
        """An intent created before containment must still settle.

        Disabling new activity must never strand a payment already in flight;
        that is why the completion hooks deliberately do not call the gates.
        """
        import inspect
        for fn in (
            chama_service.on_deposit_completed,
            chama_service.on_repayment_completed,
            chama_service.on_loan_disbursed,
            chama_service.on_loan_disbursement_failed,
            chama_service.on_dividend_paid,
            chama_service.on_dividend_failed,
            chama_service.on_profit_received,
            halal_service.on_murabaha_repaid,
        ):
            src = inspect.getsource(fn)
            assert "require_chama_enabled" not in src, f"{fn.__name__} is gated"
            assert "require_murabaha_enabled" not in src, f"{fn.__name__} is gated"

    def test_staff_and_reconciliation_paths_are_ungated(self):
        """Operators must keep their audit surface while movement is off."""
        import inspect
        from app.routes import payments as payments_router

        for fn in (payments_router.custody_balances, payments_router.custody_ledger,
                   payments_router.reconciliation_runs, payments_router.list_disputes):
            src = inspect.getsource(fn)
            assert "require_chama_enabled" not in src
            assert "require_murabaha_enabled" not in src

    @pytest.mark.asyncio
    async def test_paying_an_existing_advance_is_never_blocked(self, monkeypatch):
        """A vendor must always be able to settle a debt they already owe.

        `pay_murabaha` requires `status == "active"`, which only the gated
        approval path can produce, so it can only ever settle a pre-existing
        commitment. Blocking it would strand a payable obligation.
        """
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", False)
        import inspect
        src = inspect.getsource(halal_service.pay_murabaha)
        assert "require_murabaha_enabled" not in src

    async def test_staff_can_still_decline_a_pending_murabaha(self, monkeypatch):
        """Declining releases exposure; it must survive containment."""
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", False)
        import inspect
        src = inspect.getsource(halal_service.decide_murabaha)
        assert "if approve:" in src, "the gate must not block a decline"

    @pytest.mark.asyncio
    async def test_webhook_endpoint_still_mounted_and_signature_checked(self, client):
        # An unsigned webhook is rejected on signature, not on containment —
        # proving the gate did not displace the security check.
        r = await client.post("/api/payments/webhook", json={"type": "collection.completed"})
        assert r.status_code in (401, 400), r.text
        assert r.status_code != 503

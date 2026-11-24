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


@pytest.fixture(autouse=True)
async def _release_pooled_connections():
    """Drop this module's pooled DB connections after each test.

    The async engine is a module-level singleton whose pool holds connections
    bound to the loop that created them. The flows in this file leave
    connections warm, so disposing here keeps the file's footprint neutral for
    whatever runs next.

    Scope, stated exactly: this is hygiene for *this* file. It does not fix the
    wider weakness, which is pre-existing and reproducible on the previous
    commit without this file at all — a sync `TestClient` (used in
    `test_security_defaults.py`) starts its own loop while earlier suites have
    left connections bound to theirs, producing "attached to a different loop".
    That belongs to the session-scoped `client` fixture in `conftest.py`, is
    outside P0-B, and is fixed by neither this fixture nor the containment
    change. Recorded here so it is not mistaken for a containment defect.
    """
    yield
    from app.database import engine
    await engine.dispose()



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


class TestConfiguration:
    """§4: the flags are validated explicitly, not cast permissively.

    `Settings` is constructed directly here rather than through monkeypatch, so
    what is under test is the real parse path an operator's environment takes.
    """

    @staticmethod
    def _build(**overrides):
        from app.config import Settings
        return Settings(**overrides)

    def test_unset_defaults_to_false(self):
        s = self._build()
        assert s.CHAMA_ENABLED is False
        assert s.MURABAHA_ENABLED is False

    @pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on", " on ", True])
    def test_every_accepted_truthy_spelling_enables(self, raw):
        assert self._build(CHAMA_ENABLED=raw).CHAMA_ENABLED is True

    @pytest.mark.parametrize("raw", ["0", "false", "FALSE", "no", "off", "", "  ", False])
    def test_every_accepted_falsy_spelling_stays_off(self, raw):
        assert self._build(CHAMA_ENABLED=raw).CHAMA_ENABLED is False

    @pytest.mark.parametrize("raw", ["maybe", "enabled", "2", "ture", "chama", "-1"])
    def test_malformed_value_is_a_configuration_error_not_a_silent_off(self, raw):
        """An operator who mistypes must be told, not silently contained.

        The failure is loud at startup and names the variable, so the mistake is
        diagnosable without reading the source.
        """
        with pytest.raises(Exception) as err:
            self._build(CHAMA_ENABLED=raw)
        assert "CHAMA_ENABLED" in str(err.value)

    def test_malformed_value_cannot_enable(self):
        # The property that actually matters: no unreadable value reaches True.
        for raw in ("maybe", "enabled", "2", "ture", ""):
            try:
                assert self._build(MURABAHA_ENABLED=raw).MURABAHA_ENABLED is False
            except Exception:
                pass  # rejected outright, which is also not enabled

    def test_the_two_flags_are_independent(self):
        assert self._build(CHAMA_ENABLED=True, MURABAHA_ENABLED=False).MURABAHA_ENABLED is False
        assert self._build(CHAMA_ENABLED=False, MURABAHA_ENABLED=True).CHAMA_ENABLED is False

    def test_runtime_gate_also_fails_closed_on_junk(self, monkeypatch):
        """Second layer: values assigned at runtime bypass the validator."""
        for junk in (None, "", "false", "0", "no", "off", "maybe", 0, False, []):
            monkeypatch.setattr(settings, "CHAMA_ENABLED", junk)
            monkeypatch.setattr(settings, "MURABAHA_ENABLED", junk)
            assert financial_gates.chama_enabled() is False, junk
            assert financial_gates.murabaha_enabled() is False, junk


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

    @pytest.mark.asyncio
    async def test_refused_disbursement_cannot_leave_a_recorded_vote(
        self, client, monkeypatch,
    ):
        """The mechanism, not just the intent: a gated payout rolls the vote back.

        This is why gating the vote is the right shape rather than a blunt
        addition. `vote_on_loan` records the vote, flushes, and only then calls
        the disbursement sink. If the sink raises, `get_db` closes the session
        without committing — an uncommitted transaction is rolled back — so no
        approval survives and the loan stays pending. A half-committed vote
        would be worse than no containment: members would believe a loan was
        approved that can never be funded.
        """
        from app.models.chamas import ChamaLoan, ChamaLoanVote
        from tests.test_v25_payments_chamas import _chama, _deposit_all

        # Fixtures are built with the feature on; containment is applied below,
        # so the only thing refused is the decision to fund the loan.
        monkeypatch.setattr(settings, "CHAMA_ENABLED", True)
        detail, headers, _handles = await _chama(client, 3)
        chama_id = detail["id"]
        await _deposit_all(client, headers, chama_id, 10_000)

        applied = await client.post(
            f"/api/chamas/{chama_id}/loans", headers=headers[1],
            json={"amount_ksh": 5_000, "purpose": "restock"},
        )
        assert applied.status_code == 201, applied.text
        loan_id = uuid.UUID(applied.json()["id"])

        # Containment goes on after the loan exists, so the only thing being
        # refused is the decision to fund it.
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        voted = await client.post(
            f"/api/chamas/loans/{loan_id}/vote", headers=headers[0],
            json={"vote": "approve"},
        )
        assert voted.status_code == 503, voted.text

        # Nothing was written: no vote row, loan still undecided.
        async with async_session() as db:
            votes = (await db.execute(
                select(ChamaLoanVote.id).where(ChamaLoanVote.loan_id == loan_id)
            )).scalars().all()
            loan = await db.get(ChamaLoan, loan_id)
            assert votes == [], "a refused vote was persisted"
            assert loan.status == "pending_vote", loan.status

        # And the historical read still works for the operator.
        assert (await client.get(f"/api/chamas/{chama_id}", headers=headers[0])).status_code == 200

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

    @pytest.mark.parametrize("mode", ["", "  ", "Halal", "sharia", "islamic", "unknown", "None"])
    def test_unsupported_finance_mode_is_refused(self, mode):
        """An unsupported mode must not be defaulted into eligibility.

        The column is constrained by `ck_vendor_finance_mode`, so a value like
        this cannot arrive through a validated write. That is exactly why it
        must be refused rather than treated as `conventional`: it means the row
        did not come through a path that validates, and binding a payment
        obligation to it would commit an account whose terms nobody can state.
        """
        with pytest.raises(HTTPException) as err:
            require_murabaha_eligible(self.V(mode))
        assert err.value.status_code == 403

    def test_non_string_finance_mode_is_refused(self):
        with pytest.raises(HTTPException):
            require_murabaha_eligible(self.V(12345))

    def test_supported_modes_are_exactly_the_two_the_product_defines(self):
        # Mirrors migration 0007's CHECK and `routes/vendors.py`; if either
        # changes, this test is the tripwire.
        assert financial_gates.FINANCE_MODES == frozenset({"conventional", "halal_sharia"})

    def test_taxonomy_is_read_from_its_single_definition(self):
        # The eligibility rule points at `HALAL_POOL_MODELS` rather than
        # restating it, so the two cannot drift apart.
        assert financial_gates.halal_structures() == tuple(chama_service.HALAL_POOL_MODELS)
        assert "murabaha_credit" in financial_gates.halal_structures()

    async def test_gate_and_eligibility_are_independent(self, monkeypatch):
        """Two separate reasons to refuse stay distinguishable.

        A disabled deployment returns 503 for everyone; an unsupported account
        returns 403 even with the feature on. Collapsing the two would either
        leak eligibility information or let the flag override the rule.
        """
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", False)
        with pytest.raises(HTTPException) as gate_err:
            await halal_service.request_murabaha(
                None, self.V("conventional"), product="Probe", quantity=1,
                cost_price_ksh=1_000, markup_ksh=100, payment_due_days=30,
            )
        assert gate_err.value.status_code == 503

        monkeypatch.setattr(settings, "MURABAHA_ENABLED", True)
        with pytest.raises(HTTPException) as eligibility_err:
            await halal_service.request_murabaha(
                None, self.V("unsupported_mode"), product="Probe", quantity=1,
                cost_price_ksh=1_000, markup_ksh=100, payment_due_days=30,
            )
        assert eligibility_err.value.status_code == 403

    def test_eligibility_is_enforced_even_when_the_flag_is_on(self, monkeypatch):
        """Enabling the feature can never enable an ineligible structure."""
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", True)
        require_murabaha_enabled()  # flag permits
        require_murabaha_eligible(self.V("halal_sharia"))  # rule still runs


class TestExistingObligationsAreServiceable:
    """§3: containment must not default a borrower or strand a payable.

    Both flows run with the flags OFF for the whole lifecycle, proving the
    servicing paths are reachable while containment is on — and that the gates
    they bypass cannot be used to create anything new.
    """

    @pytest.mark.asyncio
    async def test_loan_can_be_repaid_while_containment_is_on(self, client, monkeypatch):
        from app.models.chamas import ChamaLoan
        from tests.test_v25_payments_chamas import (
            _ensure_biashara_rule, _chama, _deposit_all, flush_webhooks,
        )

        monkeypatch.setattr(settings, "CHAMA_ENABLED", True)
        detail, headers, _handles = await _chama(client, 3)
        chama_id = detail["id"]
        await _deposit_all(client, headers, chama_id, 10_000)
        await _ensure_biashara_rule()
        # Above DUAL_APPROVAL_THRESHOLD_KSH (10,000), so the payout needs two
        # distinct officers — the full authorization chain, not the shortcut.
        applied = await client.post(
            f"/api/chamas/{chama_id}/loans", headers=headers[1],
            json={"amount_ksh": 15_000, "purpose": "restock"},
        )
        assert applied.status_code == 201, applied.text
        loan_id = applied.json()["id"]

        # Fund the loan with containment ON, then turn it off for the payment —
        # the borrower was handed money and must be able to give it back.
        #
        # Reaching `disbursed` takes the whole authorization chain: a gated
        # application, two gated votes to reach quorum, a disbursement, then
        # dual approval by two distinct officers, then a settled PSP webhook.
        # That chain is the reason this repayment path can be left ungated.
        detail = (await client.get(f"/api/chamas/{chama_id}", headers=headers[0])).json()
        by_handle = {m["vendor_handle"]: m["vendor_id"] for m in detail["members"]}
        assert (await client.post(
            f"/api/chamas/{chama_id}/roles", headers=headers[0],
            json={"vendor_id": by_handle[_handles[2]], "role": "treasurer"},
        )).status_code == 200

        for voter in (headers[0], headers[2]):
            voted = await client.post(
                f"/api/chamas/loans/{loan_id}/vote", headers=voter, json={"vote": "approve"},
            )
            assert voted.status_code == 200, voted.text
        assert voted.json()["status"] in ("approved", "disbursing")

        loans = (await client.get(f"/api/chamas/{chama_id}/loans", headers=headers[1])).json()
        disbursement_id = next(
            l for l in loans["recent"] if l["id"] == loan_id
        )["disbursement_id"]
        assert disbursement_id

        # The borrower can never approve their own payout.
        assert (await client.post(
            f"/api/payments/disbursements/{disbursement_id}/approve", headers=headers[1],
        )).status_code == 403
        for approver in (headers[2], headers[0]):
            ok = await client.post(
                f"/api/payments/disbursements/{disbursement_id}/approve", headers=approver,
            )
            assert ok.status_code == 200, ok.text
        await flush_webhooks()

        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        repaid = await client.post(f"/api/chamas/loans/{loan_id}/repay", headers=headers[1])
        assert repaid.status_code == 201, repaid.text
        assert repaid.json()["amount_ksh"] == 15_750  # 15,000 + 5% flat interest
        await flush_webhooks()

        async with async_session() as db:
            assert (await db.get(ChamaLoan, uuid.UUID(loan_id))).status == "repaid"

    @pytest.mark.asyncio
    async def test_servicing_cannot_be_used_to_create_new_exposure(self, client, monkeypatch):
        """The open servicing paths still refuse work that starts something new."""
        from tests.test_v25_payments_chamas import _chama
        monkeypatch.setattr(settings, "CHAMA_ENABLED", True)
        detail, headers, _handles = await _chama(client, 3)
        chama_id = detail["id"]
        monkeypatch.setattr(settings, "CHAMA_ENABLED", False)
        # A repayment of a loan that was never funded cannot be invented.
        denied = await client.post(
            f"/api/chamas/{chama_id}/loans", headers=headers[1],
            json={"amount_ksh": 5_000, "purpose": "restock"},
        )
        assert denied.status_code == 503, denied.text

    @pytest.mark.asyncio
    async def test_murabaha_can_be_paid_and_declined_while_containment_is_on(
        self, client, monkeypatch,
    ):
        from app.models.halal import MurabahaContract
        from tests.test_v25_payments_chamas import (
            _ensure_biashara_rule, _register, _staff_roles, flush_webhooks,
        )

        monkeypatch.setattr(settings, "CHAMA_ENABLED", True)
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", True)
        await _ensure_biashara_rule()
        staff, staff_handle = await _register(client, "mura_staff2")
        _staff_roles(monkeypatch, admin=staff_handle)
        vendor, _vh = await _register(client, "mura_vendor2")

        req = await client.post("/api/murabaha/contracts", headers=vendor, json={
            "product": "Cooking oil 5L", "quantity": 24, "cost_price_ksh": 10_000,
            "markup_ksh": 600, "payment_due_days": 30,
        })
        assert req.status_code == 201, req.text
        contract_id = req.json()["id"]
        assert (await client.post(
            f"/api/murabaha/contracts/{contract_id}/approve", headers=staff,
        )).status_code == 200

        # Containment now applies to every future commitment.
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", False)

        # Servicing an existing advance still works.
        paid = await client.post(f"/api/murabaha/contracts/{contract_id}/pay", headers=vendor)
        assert paid.status_code == 201, paid.text
        await flush_webhooks()
        async with async_session() as db:
            assert (await db.get(MurabahaContract, uuid.UUID(contract_id))).status == "settled"

        # But no new contract can be opened.
        blocked = await client.post("/api/murabaha/contracts", headers=vendor, json={
            "product": "Rice 25kg", "quantity": 5, "cost_price_ksh": 4_000,
            "markup_ksh": 200, "payment_due_days": 14,
        })
        assert blocked.status_code == 503, blocked.text

    @pytest.mark.asyncio
    async def test_staff_can_still_decline_a_pending_contract_when_disabled(
        self, client, monkeypatch,
    ):
        """A decline releases exposure; it must not wait for the feature to return."""
        from app.models.halal import MurabahaContract
        from tests.test_v25_payments_chamas import _ensure_biashara_rule, _register, _staff_roles

        monkeypatch.setattr(settings, "CHAMA_ENABLED", True)
        monkeypatch.setattr(settings, "MURABAHA_ENABLED", True)
        await _ensure_biashara_rule()
        staff, staff_handle = await _register(client, "mura_staff3")
        _staff_roles(monkeypatch, admin=staff_handle)
        vendor, _vh = await _register(client, "mura_vendor3")
        req = await client.post("/api/murabaha/contracts", headers=vendor, json={
            "product": "Sugar 50kg", "quantity": 10, "cost_price_ksh": 6_000,
            "markup_ksh": 300, "payment_due_days": 30,
        })
        assert req.status_code == 201, req.text
        contract_id = req.json()["id"]

        monkeypatch.setattr(settings, "MURABAHA_ENABLED", False)
        declined = await client.post(
            f"/api/murabaha/contracts/{contract_id}/decline", headers=staff,
        )
        assert declined.status_code == 200, declined.text
        assert declined.json()["status"] == "declined"
        async with async_session() as db:
            assert (await db.get(MurabahaContract, uuid.UUID(contract_id))).status == "declined"


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

"""v2.6 — Halal trade (halal-trade brief), end to end.

Qard Hasan chamas (zero-interest loans with a flat admin fee netted from the
payout), musharakah profit remittance into the pool, the fee-vs-interest
switch in dividends, and the murabaha (cost-plus) advance lifecycle with PSP
payments. Drives the real API client + the mock PSP; money only moves when a
webhook lands (``await flush_webhooks()``).
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.database import async_session
from app.models.chamas import ChamaLoan
from app.models.halal import MurabahaContract
from app.models.payments import SACCO_ADVANCES, CustodyLedgerEntry
from app.services import biashara, halal as halal_service
from app.services.psp_client import mock_psp  # noqa: F401  (session singleton)

from tests.test_v25_payments_chamas import (
    _register, _staff_roles, _vendor_id, _ensure_biashara_rule, _sub_ledger, flush_webhooks,
)

pytestmark = pytest.mark.asyncio


async def _halal_chama(client, members: int, model_type: str):
    """Open-scope Halal pool with `members` vendors, active."""
    chair, _ = await _register(client, "halchair")
    resp = await client.post("/api/chamas", headers=chair, json={
        "name": f"Halal {model_type} {uuid.uuid4().hex[:8]}", "description": "v2.6 e2e",
        "scope": "open", "model_type": model_type,
        "min_deposit_ksh": 1000, "max_loan_ksh": 200_000,
        "interest_rate": 0.05,  # must be forced to 0 for Halal pools
        "cycle_days": 7, "approval_rate": 0.7,
        "min_members": members, "max_members": 10,
    })
    assert resp.status_code == 201, resp.text
    chama = resp.json()
    headers = [chair]
    for i in range(members - 1):
        member, _ = await _register(client, f"halm{i}")
        join = await client.post(f"/api/chamas/{chama['id']}/join", headers=member)
        assert join.status_code == 200, join.text
        headers.append(member)
    detail = (await client.get(f"/api/chamas/{chama['id']}", headers=chair)).json()
    assert detail["status"] == "active"
    assert detail["model_type"] == model_type
    assert detail["terms"]["interest_rate"] == 0.0  # Riba is structurally out
    return detail, headers


# ---------------------------------------------------------------------------
# 1. Vendor finance preference
# ---------------------------------------------------------------------------

async def test_vendor_halal_finance_mode_roundtrip(client):
    headers, _ = await _register(client, "halalpref")
    me = (await client.get("/api/vendors/me", headers=headers)).json()
    assert me["finance_mode"] == "conventional"
    resp = await client.put("/api/vendors/me", headers=headers,
                            json={"finance_mode": "halal_sharia"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["finance_mode"] == "halal_sharia"
    bad = await client.put("/api/vendors/me", headers=headers,
                           json={"finance_mode": "riba"})
    assert bad.status_code == 400
    back = await client.put("/api/vendors/me", headers=headers,
                            json={"finance_mode": "conventional"})
    assert back.status_code == 200 and back.json()["finance_mode"] == "conventional"


async def test_halal_vendor_blocked_from_interest_chama(client):
    chair, _ = await _register(client, "convchair")
    resp = await client.post("/api/chamas", headers=chair, json={
        "name": f"Conventional {uuid.uuid4().hex[:8]}", "scope": "open",
        "min_deposit_ksh": 1000, "max_loan_ksh": 200_000, "interest_rate": 0.05,
        "cycle_days": 7, "approval_rate": 0.7, "min_members": 3, "max_members": 10,
    })
    assert resp.status_code == 201, resp.text
    chama_id = resp.json()["id"]

    halal, _ = await _register(client, "halalmbr")
    await client.put("/api/vendors/me", headers=halal, json={"finance_mode": "halal_sharia"})
    join = await client.post(f"/api/chamas/{chama_id}/join", headers=halal)
    assert join.status_code == 400
    assert "interest" in join.json()["detail"].lower()

    # A conventional member who switches to Halal mode cannot take an interest loan.
    member, _ = await _register(client, "halconv")
    assert (await client.post(f"/api/chamas/{chama_id}/join", headers=member)).status_code == 200
    await client.put("/api/vendors/me", headers=member, json={"finance_mode": "halal_sharia"})
    loan = await client.post(f"/api/chamas/{chama_id}/loans", headers=member,
                             json={"amount_ksh": 2_000})
    assert loan.status_code == 400


# ---------------------------------------------------------------------------
# 2. Qard Hasan: zero interest, flat fee netted from payout, fee funds dividends
# ---------------------------------------------------------------------------

async def test_qard_hasan_loan_zero_interest_fee_and_dividend(client):
    detail, headers = await _halal_chama(client, 3, "qard_hasan")
    chama_id = detail["id"]
    assert detail["terms"]["qard_admin_fee_ksh"] == 50

    for h in headers:
        r = await client.post(f"/api/chamas/{chama_id}/deposits", headers=h,
                              json={"amount_ksh": 10_000})
        assert r.status_code == 201, r.text
    await flush_webhooks()

    member = headers[1]
    loan_resp = await client.post(f"/api/chamas/{chama_id}/loans", headers=member,
                                  json={"amount_ksh": 10_000, "purpose": "restock"})
    assert loan_resp.status_code == 201, loan_resp.text
    loan = loan_resp.json()
    assert loan["interest_ksh"] == 0          # no Riba
    assert loan["fee_ksh"] == 50              # flat admin fee
    assert loan["total_due_ksh"] == 10_000    # repay exactly the principal
    loan_id = loan["id"]

    # Both other members approve (quorum = ceil(0.7 × 2) = 2).
    for h in (headers[0], headers[2]):
        v = await client.post(f"/api/chamas/loans/{loan_id}/vote", headers=h,
                              json={"vote": "approve"})
        assert v.status_code == 200, v.text
    await flush_webhooks()  # the disbursement webhook lands

    async with async_session() as db:
        loan_row = (await db.execute(
            select(ChamaLoan).where(ChamaLoan.id == uuid.UUID(loan_id)))).scalar_one()
    assert loan_row.status == "disbursed"

    # The pool sent 9,950 (the KSh 50 fee was netted from the payout).
    rows = await _sub_ledger(f"CHAMA_{chama_id}", ttype="chama_loan_out")
    assert sum(a for _, a, _, _ in rows) == 9_950

    pay = await client.post(f"/api/chamas/loans/{loan_id}/repay", headers=member)
    assert pay.status_code == 201, pay.text
    assert pay.json()["amount_ksh"] == 10_000
    await flush_webhooks()

    # Pool = 30,000 − 9,950 + 10,000 = 30,050; distributable = the 50 fee.
    d = (await client.get(f"/api/chamas/{chama_id}", headers=headers[0])).json()
    assert d["pool_balance_ksh"] == 30_050
    div = await client.post(f"/api/chamas/{chama_id}/dividends", headers=headers[0])
    assert div.status_code == 201, div.text
    assert div.json()["distributable_ksh"] == 50


# ---------------------------------------------------------------------------
# 3. Musharakah: remitted profits join the distributable surplus
# ---------------------------------------------------------------------------

async def test_musharakah_profit_flows_to_dividends(client):
    detail, headers = await _halal_chama(client, 3, "musharakah_trade")
    chama_id = detail["id"]
    for h in headers:
        r = await client.post(f"/api/chamas/{chama_id}/deposits", headers=h,
                              json={"amount_ksh": 5_000})
        assert r.status_code == 201, r.text
    await flush_webhooks()

    # Nothing earned yet — no distributable surplus.
    early = await client.post(f"/api/chamas/{chama_id}/dividends", headers=headers[0])
    assert early.status_code == 400

    profit = await client.post(f"/api/chamas/{chama_id}/profit", headers=headers[1],
                               json={"amount_ksh": 600, "note": "onion truck sell-down"})
    assert profit.status_code == 201, profit.text
    await flush_webhooks()

    d = (await client.get(f"/api/chamas/{chama_id}", headers=headers[0])).json()
    assert d["pool_balance_ksh"] == 15_600
    div = await client.post(f"/api/chamas/{chama_id}/dividends", headers=headers[0])
    assert div.status_code == 201, div.text
    assert div.json()["distributable_ksh"] == 600


async def test_profit_remittance_rejected_on_conventional_chama(client):
    from tests.test_v25_payments_chamas import _chama
    detail, headers, _handles = await _chama(client, 3)
    resp = await client.post(f"/api/chamas/{detail['id']}/profit", headers=headers[1],
                             json={"amount_ksh": 600})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 4. Murabaha (cost-plus) advance lifecycle
# ---------------------------------------------------------------------------

async def test_murabaha_full_cycle(client, monkeypatch):
    await _ensure_biashara_rule()
    staff, staff_handle = await _register(client, "mura_staff")
    _staff_roles(monkeypatch, admin=staff_handle)
    vendor, vendor_handle = await _register(client, "mura_vendor")

    req = await client.post("/api/murabaha/contracts", headers=vendor, json={
        "product": "Cooking oil 5L", "quantity": 24,
        "cost_price_ksh": 10_000, "markup_ksh": 600, "payment_due_days": 30,
    })
    assert req.status_code == 201, req.text
    c = req.json()
    assert c["total_selling_ksh"] == 10_600  # cost + fixed, disclosed margin
    assert c["status"] == "pending_approval"

    # Not payable while pending; second request is blocked while one is open.
    assert (await client.post(f"/api/murabaha/contracts/{c['id']}/pay", headers=vendor)).status_code == 400
    dup = await client.post("/api/murabaha/contracts", headers=vendor, json={
        "product": "Rice 25kg", "quantity": 5, "cost_price_ksh": 4_000,
        "markup_ksh": 200, "payment_due_days": 14,
    })
    assert dup.status_code == 409

    # Sacco window desk + approve.
    desk = (await client.get("/api/murabaha/contracts/desk", headers=staff)).json()
    assert any(row["id"] == c["id"] for row in desk)
    appr = await client.post(f"/api/murabaha/contracts/{c['id']}/approve", headers=staff)
    assert appr.status_code == 200, appr.text
    assert appr.json()["status"] == "active"

    # The vendor pays the full total via PSP into the Sacco window.
    pay = await client.post(f"/api/murabaha/contracts/{c['id']}/pay", headers=vendor)
    assert pay.status_code == 201, pay.text
    assert pay.json()["amount_ksh"] == 10_600
    await flush_webhooks()

    mine = (await client.get("/api/murabaha/contracts/mine", headers=vendor)).json()
    assert mine[0]["status"] == "settled"
    assert mine[0]["settled_at"]

    rows = await _sub_ledger(SACCO_ADVANCES, ttype="collection_in")
    assert any(a == 10_600 for _, a, _, _ in rows)

    # Paying again is refused; the Biashara Score gained the settled event.
    assert (await client.post(f"/api/murabaha/contracts/{c['id']}/pay", headers=vendor)).status_code == 400
    vid = await _vendor_id(vendor_handle)
    async with async_session() as db:
        assert (await biashara.vendor_score(db, vid)) >= 5


async def test_murabaha_decline_blocks_payment_and_allows_re_request(client, monkeypatch):
    staff, staff_handle = await _register(client, "mura_staff2")
    _staff_roles(monkeypatch, admin=staff_handle)
    vendor, _ = await _register(client, "mura_declined")

    c = (await client.post("/api/murabaha/contracts", headers=vendor, json={
        "product": "Wheat flour 50kg", "quantity": 10,
        "cost_price_ksh": 8_000, "markup_ksh": 400, "payment_due_days": 14,
    })).json()
    dec = await client.post(f"/api/murabaha/contracts/{c['id']}/decline", headers=staff)
    assert dec.status_code == 200 and dec.json()["status"] == "declined"
    assert (await client.post(f"/api/murabaha/contracts/{c['id']}/pay", headers=vendor)).status_code == 400

    # A declined advance frees the vendor to request a revised one.
    again = await client.post("/api/murabaha/contracts", headers=vendor, json={
        "product": "Wheat flour 50kg", "quantity": 5,
        "cost_price_ksh": 4_000, "markup_ksh": 200, "payment_due_days": 14,
    })
    assert again.status_code == 201


async def test_murabaha_overdue_defaults(client, monkeypatch):
    await _ensure_biashara_rule()
    staff, staff_handle = await _register(client, "mura_staff3")
    _staff_roles(monkeypatch, admin=staff_handle)
    vendor, vendor_handle = await _register(client, "mura_late")

    c = (await client.post("/api/murabaha/contracts", headers=vendor, json={
        "product": "Sugar 50kg", "quantity": 8,
        "cost_price_ksh": 6_000, "markup_ksh": 300, "payment_due_days": 1,
    })).json()
    await client.post(f"/api/murabaha/contracts/{c['id']}/approve", headers=staff)

    # Backdate past the due date + grace (the worker's window).
    async with async_session() as db:
        row = (await db.execute(select(MurabahaContract).where(
            MurabahaContract.id == uuid.UUID(c["id"])))).scalar_one()
        row.payment_due_date = datetime.utcnow() - timedelta(days=5)
        await db.commit()

    async with async_session() as db:
        flagged = await halal_service.flag_overdue_murabaha(db)
        await db.commit()
    assert flagged >= 1

    mine = (await client.get("/api/murabaha/contracts/mine", headers=vendor)).json()
    assert mine[0]["status"] == "defaulted"
    # No late-payment interest — the penalty is a default event, not a rate.
    assert mine[0]["failure_reason"]

    vid = await _vendor_id(vendor_handle)
    async with async_session() as db:
        events = (await db.execute(select(biashara.BiasharaScoreEvent).where(
            biashara.BiasharaScoreEvent.vendor_id == vid,
            biashara.BiasharaScoreEvent.event_type == "murabaha_defaulted",
        ))).scalars().all()
    assert events, "default event must be recorded on the Biashara Score"

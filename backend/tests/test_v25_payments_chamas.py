"""v2.5 — PSP payment stack, digital chamas and lock-escrow settlement, end to end.

Every test drives the real API client + the mock PSP. Money only moves when a
webhook lands, so tests explicitly ``await flush_webhooks()`` after each
payment action and then assert the custody ledger, pool balances, Biashara
events and revenue rows in the database.

The mock PSP is a session singleton whose wallets persist across tests, so the
tests never reset it — every ledger row written earlier has a matching wallet
movement, which is exactly the invariant reconciliation checks. Wallet
assertions are therefore always relative (deltas), never absolute.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text

from app.config import settings
from app.database import async_session
from app.models.chamas import ChamaLoan
from app.models.governance import RevenueEvent
from app.models.market_locks import LockCluster, LockPick, SupplierQuote
from app.models.vendor import Vendor
from app.models.payments import (
    DISPUTE_HOLD, ESCROW_PICK_HEDGING, PLATFORM_FEES, CustodyLedgerEntry,
    PaymentIntent,
)
from app.services import biashara, chamas as chama_service, reconciliation
from app.services.psp_client import mock_psp, sign_webhook

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"
EAT = ZoneInfo("Africa/Nairobi")
PHONE_PREFIX = "0712"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _register(client, prefix: str, phone: str = None) -> tuple[dict, str]:
    suffix = uuid.uuid4().hex[:8]
    handle = f"{prefix}_{suffix}"
    response = await client.post("/api/auth/register", json={
        "business_name": f"{prefix.title()} {suffix[:4]}", "vendor_handle": handle,
        "email": f"{handle}@example.com", "password": PASSWORD,
        "business_categories": ["fresh produce"], "physical_location": "Nairobi",
        "phone": phone or f"{PHONE_PREFIX}{suffix[:6]}",
    })
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, handle


def _staff_roles(monkeypatch, **assignments):
    monkeypatch.setattr(
        settings, "MARKET_OPS_ROLES",
        ",".join(f"{role}:{handle}" for role, handle in assignments.items()),
    )


async def flush_webhooks():
    """Deliver everything the mock PSP queued (its simulated network latency)."""
    await mock_psp().flush()


async def _chama(client, members: int, *, min_deposit: int = 1000):
    """Open-scope chama with `members` vendors, active. Returns (detail, headers)."""
    chair, chair_handle = await _register(client, "chachair")
    response = await client.post("/api/chamas", headers=chair, json={
        "name": f"Test Chama {uuid.uuid4().hex[:10]}", "description": "v2.5 e2e",
        "scope": "open", "min_deposit_ksh": min_deposit, "max_loan_ksh": 200_000,
        "interest_rate": 0.05, "cycle_days": 7, "approval_rate": 0.7,
        "min_members": members, "max_members": 10,
    })
    assert response.status_code == 201, response.text
    chama = response.json()
    headers = [chair]
    handles = [chair_handle]
    for i in range(members - 1):
        member, handle = await _register(client, f"chamem{i}")
        join = await client.post(f"/api/chamas/{chama['id']}/join", headers=member)
        assert join.status_code == 200, join.text
        headers.append(member)
        handles.append(handle)
    detail = (await client.get(f"/api/chamas/{chama['id']}", headers=chair)).json()
    assert detail["status"] == "active"
    return detail, headers, handles


async def _deposit_all(client, headers, chama_id: str, amount: int) -> None:
    for h in headers:
        resp = await client.post(f"/api/chamas/{chama_id}/deposits", headers=h,
                                 json={"amount_ksh": amount})
        assert resp.status_code == 201, resp.text
    await flush_webhooks()


async def _sub_ledger(sub: str, *, ttype: str = None):
    async with async_session() as db:
        stmt = select(CustodyLedgerEntry).where(CustodyLedgerEntry.psp_sub_account == sub)
        if ttype:
            stmt = stmt.where(CustodyLedgerEntry.transaction_type == ttype)
        rows = (await db.execute(stmt.order_by(CustodyLedgerEntry.created_at))).scalars().all()
    return [(r.transaction_type, r.amount_ksh, r.direction, r.running_balance_ksh) for r in rows]


async def _vendor_id(handle: str) -> uuid.UUID:
    async with async_session() as db:
        row = (await db.execute(select(Vendor.id).where(
            Vendor.vendor_handle == handle))).scalar_one()
    return row


async def _ensure_biashara_rule():
    """Score events are skipped (by design) without an active rule; the real
    activation path is a governance vote, which is v2.4 territory. Seed one
    for the score assertions."""
    from app.models.governance import RuleVersion

    async with async_session() as db:
        existing = (await db.execute(select(RuleVersion.id).where(
            RuleVersion.rule_group == "biashara_score",
            RuleVersion.effective_from <= datetime.utcnow(),
        ).limit(1))).scalar_one_or_none()
        if existing is None:
            db.add(RuleVersion(
                rule_group="biashara_score", version=1,
                configuration={"event_points": {"pick_completed": 5}},
                approved_by_type="seed",
                effective_from=datetime.utcnow() - timedelta(days=1),
            ))
            await db.commit()


async def _lock_fixture(client, monkeypatch, *, unit_price: float, quantities: list[int]):
    """A locked cluster (v2.3 demand→selection done) with one submitted pick
    per picker vendor, so this file can test the v2.5 money layer on top."""
    admin, admin_handle = await _register(client, "lockadmin")
    _staff_roles(monkeypatch, admin=admin_handle)

    zone = (await client.post("/api/locks/ops/zones", headers=admin, json={
        "name": f"Pilot {uuid.uuid4().hex[:5]}", "city": "Nairobi", "walkable_ring": "Test ring",
    })).json()
    product = (await client.post("/api/locks/ops/products", headers=admin, json={
        "name": f"Test onions {uuid.uuid4().hex[:5]}", "category": "produce",
        "unit_of_measure": "crates",
    })).json()
    supplier, supplier_handle = await _register(client, "locksupplier")
    offer = (await client.post("/api/locks/ops/offers", headers=admin, json={
        "supplier_handle": supplier_handle, "zone_id": zone["id"], "product_id": product["id"],
        "minimum_order_quantity": 1, "notes": "test sheet",
    })).json()

    now = datetime.now(timezone.utc)
    day = now.astimezone(EAT).date().isoformat()
    window = (await client.post("/api/locks/ops/windows", headers=admin, json={
        "zone_id": zone["id"], "local_date": day,
        "opens_at": (now - timedelta(seconds=5)).isoformat(),
        "closes_at": (now + timedelta(hours=2)).isoformat(),
        "delivery_at": (now + timedelta(hours=10)).isoformat(),
    })).json()

    vendors = []
    vendor_ids = []
    for i in range(len(quantities)):
        v, handle = await _register(client, f"lockpick{i}")
        assigned = await client.post("/api/locks/me/zone", headers=v,
                                     json={"zone_id": zone["id"]})
        assert assigned.status_code == 200, assigned.text
        vendors.append(v)
        vendor_ids.append(await _vendor_id(handle))

    total = sum(quantities)
    async with async_session() as db:
        cluster = LockCluster(
            window_id=uuid.UUID(window["id"]), product_id=uuid.UUID(product["id"]),
            status="locked", bid_quantity=total, locked_quantity=total,
            locked_unit_price=unit_price, locked_at=datetime.utcnow(),
        )
        db.add(cluster)
        await db.flush()
        quote = SupplierQuote(
            cluster_id=cluster.id, supplier_moq_id=uuid.UUID(offer["id"]),
            quoted_quantity=total, unit_price=unit_price, status="selected",
        )
        db.add(quote)
        await db.flush()  # the id default applies at flush time
        cluster.selected_quote_id = quote.id
        for vid, qty in zip(vendor_ids, quantities):
            db.add(LockPick(cluster_id=cluster.id, vendor_id=vid,
                            quantity=qty, status="submitted"))
        await db.commit()
        cluster_id = cluster.id

    return {
        "cluster_id": str(cluster_id), "zone": zone, "product": product,
        "window": window, "offer": offer, "supplier": supplier, "supplier_handle": supplier_handle,
        "vendors": vendors, "vendor_ids": vendor_ids,
        "admin": admin, "admin_handle": admin_handle, "quantities": quantities,
    }


# ---------------------------------------------------------------------------
# 1. Webhook transport: signatures, idempotency
# ---------------------------------------------------------------------------

async def test_webhook_rejects_bad_signature_accepts_valid_and_is_idempotent(client):
    """The webhook endpoint is the ONLY money door: it verifies the HMAC,
    applies the event exactly once, and 502s when it can't apply it yet."""
    chama, headers, handles = await _chama(client, 3)
    chair = headers[0]
    chair_id = await _vendor_id(handles[0])

    # A pending intent with no PSP event in flight, so this test controls the
    # only copy of the webhook.
    intent_id = uuid.uuid4()
    async with async_session() as db:
        db.add(PaymentIntent(
            id=intent_id, vendor_id=chair_id, entity_type="chama_deposit",
            entity_id=uuid.uuid4(), amount_ksh=1000, provider="MPESA",
            phone="0712000000", target_psp_sub=f"CHAMA_{chama['id']}",
            psp_api_ref="COL-TESTSIG1", status="pending",
        ))
        await db.commit()

    raw = json.dumps({"type": "payment.completed", "id": "MANUAL-9000",
                      "api_ref": "COL-TESTSIG1", "amount": 1000,
                      "mpesa_receipt": "MANUALRCPT1"}).encode()

    bad = await client.post("/api/payments/webhook", content=raw,
                            headers={"Content-Type": "application/json",
                                     "X-Webhook-Signature": "0" * 64})
    assert bad.status_code == 401
    still = (await client.get(f"/api/payments/intents/{intent_id}", headers=chair)).json()
    assert still["status"] == "pending"

    good = await client.post("/api/payments/webhook", content=raw,
                             headers={"Content-Type": "application/json",
                                      "X-Webhook-Signature": sign_webhook(raw)})
    assert good.status_code == 200, good.text

    done = (await client.get(f"/api/payments/intents/{intent_id}", headers=chair)).json()
    assert done["status"] == "completed"
    assert done["mpesa_receipt"] == "MANUALRCPT1"

    # Replays (PSP retries / operator resends) must not double-count.
    repeat = await client.post("/api/payments/webhook", content=raw,
                               headers={"Content-Type": "application/json",
                                        "X-Webhook-Signature": sign_webhook(raw)})
    assert repeat.status_code == 200

    async with async_session() as db:
        rows = (await db.execute(select(CustodyLedgerEntry).where(
            CustodyLedgerEntry.intent_id == intent_id))).scalars().all()
    assert len(rows) == 1
    assert rows[0].transaction_type == "chama_pool_in"
    assert rows[0].running_balance_ksh == 1000

    detail = (await client.get(f"/api/chamas/{chama['id']}", headers=chair)).json()
    assert detail["pool_balance_ksh"] == 1000


# ---------------------------------------------------------------------------
# 2. Deposits: ledger running balance + pool
# ---------------------------------------------------------------------------

async def test_deposit_flow_books_ledger_with_running_balance(client):
    chama, headers, handles = await _chama(client, 3)
    sub = f"CHAMA_{chama['id']}"
    await _deposit_all(client, headers, chama["id"], 1000)

    entries = await _sub_ledger(sub)
    assert [e[0] for e in entries] == ["chama_pool_in"] * 3
    assert [e[3] for e in entries] == [1000, 2000, 3000]  # running balance climbs
    assert all(e[2] == "credit" for e in entries)

    detail = (await client.get(f"/api/chamas/{chama['id']}", headers=headers[0])).json()
    assert detail["pool_balance_ksh"] == 3000

    mine = (await client.get(f"/api/chamas/{chama['id']}/deposits", headers=headers[0])).json()
    assert [d["amount_ksh"] for d in mine] == [1000]


async def test_pending_pick_payment_blocks_a_second_payment(client, monkeypatch):
    lock = await _lock_fixture(client, monkeypatch, unit_price=100.0, quantities=[10])
    cluster_id, vendor = lock["cluster_id"], lock["vendors"][0]
    mock_psp().paused = True  # hold the webhook: keep the intent pending
    first = await client.post(f"/api/locks/clusters/{cluster_id}/pay", headers=vendor)
    assert first.status_code == 201, first.text
    # The intent is still pending: a second payment for the same pick is refused.
    second = await client.post(f"/api/locks/clusters/{cluster_id}/pay", headers=vendor)
    assert second.status_code == 409
    mock_psp().paused = False
    await flush_webhooks()
    summary = (await client.get(f"/api/locks/clusters/{cluster_id}", headers=vendor)).json()
    assert summary["funds_status"] == "funded" and summary["paid_total_ksh"] == 1000


async def test_deposit_requires_a_phone_number(client):
    suffix = uuid.uuid4().hex[:8]
    handle = f"nophone_{suffix}"
    reg = await client.post("/api/auth/register", json={
        "business_name": f"NoPhone {suffix[:4]}", "vendor_handle": handle,
        "email": f"{handle}@example.com", "password": PASSWORD,
        "business_categories": ["fresh produce"], "physical_location": "Nairobi",
    })
    assert reg.status_code == 201
    auth = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    crema = (await client.post("/api/chamas", headers=auth, json={
        "name": f"NoPhone Chama {suffix}", "scope": "open", "min_deposit_ksh": 500,
        "min_members": 3, "max_members": 10,
    })).json()
    for _ in range(2):
        member, _ = await _register(client, "phm")
        assert (await client.post(f"/api/chamas/{crema['id']}/join",
                                  headers=member)).status_code == 200
    no_phone = await client.post(f"/api/chamas/{crema['id']}/deposits", headers=auth,
                                 json={"amount_ksh": 500})
    assert no_phone.status_code == 400
    assert "phone" in no_phone.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 3. Loans: quorum vote → dual-approval payout → repayment → dividends
# ---------------------------------------------------------------------------

async def test_loan_full_cycle_dual_approval_repayment_and_dividends(client):
    detail, headers, handles = await _chama(client, 3)  # chair + 2 members
    chama_id = detail["id"]
    chair, member_a, member_b = headers
    await _deposit_all(client, headers, chama_id, 10000)  # pool 30,000
    await _ensure_biashara_rule()

    # Chair designates member B as treasurer (dual approval needs two officers).
    detail = (await client.get(f"/api/chamas/{chama_id}", headers=chair)).json()
    m_by_handle = {m["vendor_handle"]: m["vendor_id"] for m in detail["members"]}
    role = await client.post(f"/api/chamas/{chama_id}/roles", headers=chair,
                             json={"vendor_id": m_by_handle[handles[2]], "role": "treasurer"})
    assert role.status_code == 200, role.text

    # Borrower A applies for 15,000 (5% → 750 interest, 15,750 due).
    apply = await client.post(f"/api/chamas/{chama_id}/loans", headers=member_a,
                              json={"amount_ksh": 15000, "purpose": "restock stock"})
    assert apply.status_code == 201, apply.text
    loan = apply.json()
    assert loan["status"] == "pending_vote"
    assert loan["interest_ksh"] == 750 and loan["total_due_ksh"] == 15750
    detail = (await client.get(f"/api/chamas/{chama_id}", headers=chair)).json()
    assert detail["pending_loans"][0]["quorum_needed"] == 2  # ceil(0.7 × 2 eligible voters)

    # The borrower cannot vote on their own loan.
    assert (await client.post(f"/api/chamas/loans/{loan['id']}/vote", headers=member_a,
                              json={"vote": "approve"})).status_code == 403

    # One approval is not enough.
    v1 = await client.post(f"/api/chamas/loans/{loan['id']}/vote", headers=chair,
                           json={"vote": "approve"})
    assert v1.status_code == 200 and v1.json()["status"] == "pending_vote"

    # Second approval reaches quorum → approved → payout prepared.
    v2 = await client.post(f"/api/chamas/loans/{loan['id']}/vote", headers=member_b,
                           json={"vote": "approve"})
    assert v2.status_code == 200 and v2.json()["status"] in ("approved", "disbursing")

    loans = (await client.get(f"/api/chamas/{chama_id}/loans", headers=member_a)).json()
    my_loan = next(l for l in loans["recent"] if l["id"] == loan["id"])
    assert my_loan["status"] == "disbursing"
    disbursement_id = my_loan["disbursement_id"]
    assert disbursement_id, "a KSh 15,000 payout needs a dual-approval disbursement"

    # --- Dual approval on the payout ---------------------------------------
    payouts = (await client.get("/api/payments/disbursements", headers=member_a)).json()
    dsb = next(d for d in payouts if d["id"] == disbursement_id)
    assert dsb["status"] == "pending_approval" and dsb["amount_ksh"] == 15000

    # The borrower can never approve; so can't a repeat vote from one officer.
    assert (await client.post(f"/api/payments/disbursements/{disbursement_id}/approve",
                              headers=member_a)).status_code == 403

    first_ok = await client.post(f"/api/payments/disbursements/{disbursement_id}/approve",
                                 headers=member_b)  # treasurer
    assert first_ok.status_code == 200, first_ok.text
    assert first_ok.json()["status"] == "pending_approval"  # one more needed
    assert (await client.post(f"/api/payments/disbursements/{disbursement_id}/approve",
                              headers=member_b)).status_code == 400  # already approved

    second_ok = await client.post(f"/api/payments/disbursements/{disbursement_id}/approve",
                                  headers=chair)
    assert second_ok.status_code == 200, second_ok.text
    assert second_ok.json()["status"] == "queued"

    await flush_webhooks()
    loans = (await client.get(f"/api/chamas/{chama_id}/loans", headers=member_a)).json()
    my_loan = next(l for l in loans["recent"] if l["id"] == loan["id"])
    assert my_loan["status"] == "disbursed"

    # Pool = 30,000 − 15,000; ledger shows the single loan outflow.
    detail = (await client.get(f"/api/chamas/{chama_id}", headers=chair)).json()
    assert detail["pool_balance_ksh"] == 15000
    entries = await _sub_ledger(f"CHAMA_{chama_id}", ttype="chama_loan_out")
    assert [(e[1], e[2]) for e in entries] == [(15000, "debit")]

    # --- Repayment (principal + interest back into the pool) ----------------
    repay = await client.post(f"/api/chamas/loans/{loan['id']}/repay", headers=member_a)
    assert repay.status_code == 201, repay.text
    assert repay.json()["amount_ksh"] == 15750
    await flush_webhooks()

    loans = (await client.get(f"/api/chamas/{chama_id}/loans", headers=member_a)).json()
    my_loan = next(l for l in loans["recent"] if l["id"] == loan["id"])
    assert my_loan["status"] == "repaid"
    detail = (await client.get(f"/api/chamas/{chama_id}", headers=chair)).json()
    assert detail["pool_balance_ksh"] == 30750  # 15,000 + 15,750
    async with async_session() as db:
        assert (await biashara.vendor_score(db, uuid.UUID(my_loan["borrower_id"]))) >= 5

    # --- Dividends: the KSh 750 interest, split by deposit share ------------
    assert (await client.get(f"/api/chamas/{chama_id}/dividends",
                             headers=member_b)).json() == []
    assert (await client.post(f"/api/chamas/{chama_id}/dividends",
                              headers=member_a)).status_code == 403  # plain member
    dist = await client.post(f"/api/chamas/{chama_id}/dividends", headers=chair)
    assert dist.status_code == 201, dist.text
    assert dist.json()["distributable_ksh"] == 750
    assert dist.json()["members_paid"] == 3
    await flush_webhooks()

    for h in headers:
        mine = (await client.get(f"/api/chamas/{chama_id}/dividends", headers=h)).json()
        assert len(mine) == 1
        assert mine[0]["amount_ksh"] == 250  # equal deposits → equal shares
        assert mine[0]["status"] == "paid"

    detail = (await client.get(f"/api/chamas/{chama_id}", headers=chair)).json()
    assert detail["pool_balance_ksh"] == 30000  # interest fully distributed
    entries = await _sub_ledger(f"CHAMA_{chama_id}", ttype="chama_dividend_out")
    assert sorted(e[1] for e in entries) == [250, 250, 250]


# ---------------------------------------------------------------------------
# 4. Failure paths: payout failure → retry; collection failure → intent failed
# ---------------------------------------------------------------------------

async def test_failed_loan_payout_reverts_and_retry_succeeds(client):
    detail, headers, handles = await _chama(client, 3)
    chama_id = detail["id"]
    chair, member_a, member_b = headers
    await _deposit_all(client, headers, chama_id, 10000)

    apply = await client.post(f"/api/chamas/{chama_id}/loans", headers=member_a,
                              json={"amount_ksh": 5000})  # under threshold → auto-approve
    assert apply.status_code == 201, apply.text
    loan_id = apply.json()["id"]

    mock_psp().fail_next_disburse = True  # the payout leg will fail
    await client.post(f"/api/chamas/loans/{loan_id}/vote", headers=chair,
                      json={"vote": "approve"})
    v2 = await client.post(f"/api/chamas/loans/{loan_id}/vote", headers=member_b,
                           json={"vote": "approve"})
    # Under the threshold, the payout is auto-approved and queued in the same
    # step, so the loan is already "disbursing" when the webhook lands.
    assert v2.json()["status"] == "disbursing"
    await flush_webhooks()

    loans = (await client.get(f"/api/chamas/{chama_id}/loans", headers=member_a)).json()
    my_loan = next(l for l in loans["recent"] if l["id"] == loan_id)
    assert my_loan["status"] == "approved"  # reverted, retryable
    detail = (await client.get(f"/api/chamas/{chama_id}", headers=chair)).json()
    assert detail["pool_balance_ksh"] == 30000  # money never left the pool

    assert (await client.post(f"/api/chamas/loans/{loan_id}/retry-disbursement",
                              headers=member_a)).status_code == 403
    retry = await client.post(f"/api/chamas/loans/{loan_id}/retry-disbursement", headers=chair)
    assert retry.status_code == 200, retry.text
    await flush_webhooks()

    loans = (await client.get(f"/api/chamas/{chama_id}/loans", headers=member_a)).json()
    my_loan = next(l for l in loans["recent"] if l["id"] == loan_id)
    assert my_loan["status"] == "disbursed"
    detail = (await client.get(f"/api/chamas/{chama_id}", headers=chair)).json()
    assert detail["pool_balance_ksh"] == 25000


async def test_failed_collection_marks_intent_failed_then_retry_succeeds(client):
    detail, headers, handles = await _chama(client, 3)
    chama_id, chair = detail["id"], headers[0]

    mock_psp().fail_next_collect = True
    first = await client.post(f"/api/chamas/{chama_id}/deposits", headers=chair,
                              json={"amount_ksh": 1000})
    assert first.status_code == 201, first.text  # the prompt showed before it failed
    intent_id = first.json()["intent_id"]
    await flush_webhooks()
    intent = (await client.get(f"/api/payments/intents/{intent_id}", headers=chair)).json()
    assert intent["status"] == "failed"
    assert intent["failure_reason"]

    # A failed intent frees the slot: the same member can pay again.
    second = await client.post(f"/api/chamas/{chama_id}/deposits", headers=chair,
                               json={"amount_ksh": 1000})
    assert second.status_code == 201, second.text
    await flush_webhooks()
    intent2 = (await client.get(f"/api/payments/intents/{second.json()['intent_id']}",
                                headers=chair)).json()
    assert intent2["status"] == "completed"

    detail = (await client.get(f"/api/chamas/{chama_id}", headers=chair)).json()
    assert detail["pool_balance_ksh"] == 1000  # only the successful one landed


# ---------------------------------------------------------------------------
# 5. Reconciliation: matched → variance → resolved
# ---------------------------------------------------------------------------

async def test_reconciliation_matched_then_variance_then_resolved(client, monkeypatch):
    admin, admin_handle = await _register(client, "reconadmin")
    _staff_roles(monkeypatch, admin=admin_handle)

    detail, headers, handles = await _chama(client, 3)
    sub = f"CHAMA_{detail['id']}"
    await _deposit_all(client, headers, detail["id"], 1000)

    run = await client.post("/api/payments/reconciliation/run", headers=admin)
    assert run.status_code == 200, run.text
    row = next(r for r in run.json() if r["psp_sub_account"] == sub)
    assert row["status"] == "matched"
    assert row["variance_ksh"] == 0 and row["psp_reported_balance"] == 3000

    # Tamper with the PSP side: the ledger is right, the PSP "lost" KSh 5,000.
    mock_psp()._wallets[sub] = mock_psp()._wallet(sub) - 5000
    run2 = await client.post("/api/payments/reconciliation/run", headers=admin)
    row2 = next(r for r in run2.json() if r["psp_sub_account"] == sub)
    assert row2["status"] == "variance_found"
    assert row2["variance_ksh"] == -5000
    assert row2["id"] == row["id"]  # upserted per (date, wallet), not duplicated

    resolved = await client.post(f"/api/payments/reconciliation/runs/{row['id']}/resolve",
                                 headers=admin,
                                 json={"explanation": "PSP outage; provider credited the wallet."})
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"

    runs = (await client.get("/api/payments/reconciliation/runs", headers=admin)).json()
    assert any(r["id"] == row["id"] and r["status"] == "resolved" for r in runs)


async def test_reconciliation_requires_ops(client):
    vendor, _ = await _register(client, "plainrecon")
    assert (await client.post("/api/payments/reconciliation/run",
                              headers=vendor)).status_code == 403
    assert (await client.get("/api/payments/reconciliation/runs",
                             headers=vendor)).status_code == 403


# ---------------------------------------------------------------------------
# 6. Orphan intent detection
# ---------------------------------------------------------------------------

async def test_orphan_completed_intent_without_ledger_is_found(client):
    detail, headers, handles = await _chama(client, 3)
    await _deposit_all(client, headers, detail["id"], 1000)

    orphan_id = uuid.uuid4()
    async with async_session() as db:
        good = (await db.execute(select(PaymentIntent).where(
            PaymentIntent.status == "completed").limit(1))).scalar_one()
        assert good is not None
        db.add(PaymentIntent(
            id=orphan_id, vendor_id=good.vendor_id, entity_type="chama_deposit",
            entity_id=uuid.uuid4(), amount_ksh=999, provider="MPESA", phone="0712000000",
            target_psp_sub=f"CHAMA_{detail['id']}", psp_api_ref=f"COL-{orphan_id.hex[:14]}",
            status="completed", completed_at=datetime.utcnow() - timedelta(hours=2),
        ))
        await db.commit()
        found = await reconciliation.find_orphan_intents(db)
        assert any(f.id == orphan_id for f in found)
        assert all(f.id != good.id for f in found)


# ---------------------------------------------------------------------------
# 7. The custody ledger is append-only at the database level
# ---------------------------------------------------------------------------

async def test_custody_ledger_is_append_only(client):
    detail, headers, handles = await _chama(client, 3)
    await _deposit_all(client, headers, detail["id"], 1000)

    async with async_session() as db:
        row = (await db.execute(select(CustodyLedgerEntry).limit(1))).scalar_one()
        row_pk, row_amount = row.id, row.amount_ksh
        with pytest.raises(Exception) as exc_info:
            await db.execute(text(
                "UPDATE custody_ledger SET amount_ksh = amount_ksh + 1 WHERE id = :id"),
                {"id": row_pk})
            await db.commit()
        await db.rollback()
        assert "append-only" in str(exc_info.value)

        with pytest.raises(Exception) as exc_info:
            await db.execute(text("DELETE FROM custody_ledger WHERE id = :id"),
                             {"id": row_pk})
            await db.commit()
        await db.rollback()
        assert "append-only" in str(exc_info.value)

    async with async_session() as db:
        row2 = await db.get(CustodyLedgerEntry, row_pk)
        assert row2.amount_ksh == row_amount  # untouched


# ---------------------------------------------------------------------------
# 8. Lock escrow: pay → settle → fee + revenue + Biashara
# ---------------------------------------------------------------------------

async def test_lock_cluster_pay_settle_books_fee_revenue_and_score(client, monkeypatch):
    unit_price, qty = 100.0, 10  # pick payable KSh 1,000
    lock = await _lock_fixture(client, monkeypatch, unit_price=unit_price, quantities=[qty])
    cluster_id, vendor = lock["cluster_id"], lock["vendors"][0]
    await _ensure_biashara_rule()

    summary = (await client.get(f"/api/locks/clusters/{cluster_id}", headers=vendor)).json()
    assert summary["funds_status"] == "not_required"
    assert summary["paid_total_ksh"] == 0

    # Pay the pick → money into escrow when the webhook lands.
    pay = await client.post(f"/api/locks/clusters/{cluster_id}/pay", headers=vendor)
    assert pay.status_code == 201, pay.text
    assert pay.json()["amount_ksh"] == 1000
    await flush_webhooks()

    summary = (await client.get(f"/api/locks/clusters/{cluster_id}", headers=vendor)).json()
    assert summary["funds_status"] == "funded"
    assert summary["paid_total_ksh"] == 1000
    escrow_in = await _sub_ledger(ESCROW_PICK_HEDGING, ttype="collection_in")
    assert any(e[1] == 1000 for e in escrow_in)
    assert mock_psp()._wallet(ESCROW_PICK_HEDGING) >= 1000

    # A second payment for the same (now paid) pick is rejected.
    assert (await client.post(f"/api/locks/clusters/{cluster_id}/pay",
                              headers=vendor)).status_code == 400

    # Settle: gross 1,000 → fee 4% = 40 → supplier net 960 (auto-approve path).
    settle = await client.post(f"/api/locks/clusters/{cluster_id}/settle", headers=lock["admin"])
    assert settle.status_code == 201, settle.text
    assert settle.json()["gross_ksh"] == 1000
    assert settle.json()["fee_ksh"] == 40
    assert settle.json()["net_ksh"] == 960
    await flush_webhooks()

    summary = (await client.get(f"/api/locks/clusters/{cluster_id}", headers=vendor)).json()
    assert summary["funds_status"] == "settled"
    assert summary["settled_at"] is not None

    async with async_session() as db:
        fee_rows = (await db.execute(select(CustodyLedgerEntry).where(
            CustodyLedgerEntry.psp_sub_account == PLATFORM_FEES,
            CustodyLedgerEntry.transaction_type == "fee_deducted"))).scalars().all()
        assert any(r.amount_ksh == 40 for r in fee_rows)
        escrow_fee_side = (await db.execute(select(CustodyLedgerEntry).where(
            CustodyLedgerEntry.psp_sub_account == ESCROW_PICK_HEDGING,
            CustodyLedgerEntry.transaction_type == "escrow_release"))).scalars().all()
        assert any(r.amount_ksh == 40 for r in escrow_fee_side)  # fee's escrow debit
        events = (await db.execute(select(RevenueEvent).where(
            RevenueEvent.source_type == "supplier_facilitation_fee"))).scalars().all()
        assert any(e.gross_amount_ksh == 40 for e in events)
        pick_row = (await db.execute(select(LockPick).where(
            LockPick.cluster_id == uuid.UUID(cluster_id)))).scalar_one()
        assert pick_row.status == "settled"
        assert (await biashara.vendor_score(db, pick_row.vendor_id)) >= 5


async def test_lock_dispute_freeze_release_then_settle_with_dual_approval(client, monkeypatch):
    unit_price, qty = 100.0, 100  # 2 × KSh 10,000 → net 19,200 → dual approval
    lock = await _lock_fixture(client, monkeypatch, unit_price=unit_price, quantities=[qty, qty])
    cluster_id, vendors = lock["cluster_id"], lock["vendors"]
    escrow_before = mock_psp()._wallet(ESCROW_PICK_HEDGING)
    hold_before = mock_psp()._wallet(DISPUTE_HOLD)

    for v in vendors:
        pay = await client.post(f"/api/locks/clusters/{cluster_id}/pay", headers=v)
        assert pay.status_code == 201, pay.text
    await flush_webhooks()

    summary = (await client.get(f"/api/locks/clusters/{cluster_id}", headers=vendors[0])).json()
    assert summary["funds_status"] == "funded" and summary["paid_total_ksh"] == 20000
    assert mock_psp()._wallet(ESCROW_PICK_HEDGING) == escrow_before + 20000

    # Vendor 0 disputes: KSh 10,000 frozen out of escrow (synchronous transfer).
    dispute = await client.post(f"/api/locks/clusters/{cluster_id}/dispute", headers=vendors[0],
                                json={"reason": "Three crates arrived bruised"})
    assert dispute.status_code == 201, dispute.text
    assert dispute.json()["amount_ksh"] == 10000
    hold_id = dispute.json()["dispute_id"]
    assert mock_psp()._wallet(DISPUTE_HOLD) == hold_before + 10000
    assert [e[1] for e in await _sub_ledger(DISPUTE_HOLD, ttype="dispute_freeze")] == [10000]
    assert [e[1] for e in await _sub_ledger(ESCROW_PICK_HEDGING, ttype="dispute_freeze")] == [10000]

    disputes = (await client.get("/api/payments/disputes", headers=lock["admin"])).json()
    assert any(d["id"] == hold_id and d["status"] == "frozen" for d in disputes)

    # Operator releases the frozen share back to escrow (delivery judged valid).
    resolve = await client.post(f"/api/payments/disputes/{hold_id}/resolve", headers=lock["admin"],
                                json={"outcome": "release_to_supplier", "note": "Photos fine."})
    assert resolve.status_code == 200, resolve.text
    assert resolve.json()["status"] == "released_to_supplier"
    assert mock_psp()._wallet(DISPUTE_HOLD) == hold_before

    # Settle the full KSh 20,000: fee 800, net 19,200 > 10,000 → dual approval.
    settle = await client.post(f"/api/locks/clusters/{cluster_id}/settle", headers=lock["admin"])
    assert settle.status_code == 201, settle.text
    body = settle.json()
    assert body["status"] == "pending_approval"
    assert body["gross_ksh"] == 20000 and body["fee_ksh"] == 800 and body["net_ksh"] == 19200
    assert body["dual_approval"] is True
    disbursement_id = body["disbursement_id"]

    # The requesting operator cannot approve their own settlement.
    assert (await client.post(f"/api/payments/disbursements/{disbursement_id}/approve",
                              headers=lock["admin"])).status_code == 403

    # Two OTHER market-ops staff (clerk + negotiator) approve.
    clerk1, clerk1_handle = await _register(client, "lockclerk1")
    clerk2, clerk2_handle = await _register(client, "lockclerk2")
    _staff_roles(monkeypatch, admin=lock["admin_handle"], clerk=clerk1_handle,
                 negotiator=clerk2_handle)
    first = await client.post(f"/api/payments/disbursements/{disbursement_id}/approve",
                              headers=clerk1)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "pending_approval"  # one more needed
    second = await client.post(f"/api/payments/disbursements/{disbursement_id}/approve",
                               headers=clerk2)
    assert second.status_code == 200, second.text
    assert second.json()["status"] == "queued"

    await flush_webhooks()
    summary = (await client.get(f"/api/locks/clusters/{cluster_id}", headers=vendors[0])).json()
    assert summary["funds_status"] == "settled"
    # Escrow fully drained: +20,000 in, −19,200 payout, −800 fee.
    assert mock_psp()._wallet(ESCROW_PICK_HEDGING) == escrow_before
    assert any(e[1] == 800 for e in await _sub_ledger(PLATFORM_FEES, ttype="fee_deducted"))


async def test_lock_dispute_refund_returns_money_to_vendor(client, monkeypatch):
    lock = await _lock_fixture(client, monkeypatch, unit_price=100.0, quantities=[10])
    cluster_id, vendor = lock["cluster_id"], lock["vendors"][0]
    hold_before = mock_psp()._wallet(DISPUTE_HOLD)

    # An unpaid pick cannot be disputed.
    early = await client.post(f"/api/locks/clusters/{cluster_id}/dispute", headers=vendor,
                              json={"reason": "nothing delivered yet"})
    assert early.status_code == 400

    pay = await client.post(f"/api/locks/clusters/{cluster_id}/pay", headers=vendor)
    assert pay.status_code == 201, pay.text
    await flush_webhooks()

    dispute = await client.post(f"/api/locks/clusters/{cluster_id}/dispute", headers=vendor,
                                json={"reason": "nothing delivered"})
    assert dispute.status_code == 201, dispute.text
    hold_id = dispute.json()["dispute_id"]
    assert mock_psp()._wallet(DISPUTE_HOLD) == hold_before + 1000

    # A second open dispute on the same pick is rejected.
    assert (await client.post(f"/api/locks/clusters/{cluster_id}/dispute", headers=vendor,
                              json={"reason": "again"})).status_code == 409

    # Operator refunds the vendor from the hold.
    resolve = await client.post(f"/api/payments/disputes/{hold_id}/resolve", headers=lock["admin"],
                                json={"outcome": "refund_to_vendor", "note": "No delivery."})
    assert resolve.status_code == 200, resolve.text
    assert resolve.json()["status"] in ("pending_approval", "queued")
    await flush_webhooks()

    disputes = (await client.get("/api/payments/disputes", headers=lock["admin"])).json()
    assert any(d["id"] == hold_id and d["status"] == "released_to_vendor" for d in disputes)
    assert mock_psp()._wallet(DISPUTE_HOLD) == hold_before  # hold drained by the refund
    async with async_session() as db:
        pick_row = (await db.execute(select(LockPick).where(
            LockPick.cluster_id == uuid.UUID(cluster_id)))).scalar_one()
        assert pick_row.status == "refunded"


# ---------------------------------------------------------------------------
# 9. Overdue loan worker
# ---------------------------------------------------------------------------

async def test_overdue_disbursed_loan_is_flagged_defaulted_by_worker(client):
    detail, headers, handles = await _chama(client, 3)
    chama_id = detail["id"]
    chair, member_a, member_b = headers
    await _deposit_all(client, headers, chama_id, 10000)

    apply = await client.post(f"/api/chamas/{chama_id}/loans", headers=member_a,
                              json={"amount_ksh": 5000})
    loan_id = apply.json()["id"]
    await client.post(f"/api/chamas/loans/{loan_id}/vote", headers=chair,
                      json={"vote": "approve"})
    await client.post(f"/api/chamas/loans/{loan_id}/vote", headers=member_b,
                      json={"vote": "approve"})
    await flush_webhooks()

    async with async_session() as db:
        loan = await db.get(ChamaLoan, uuid.UUID(loan_id))
        assert loan.status == "disbursed"
        loan.cycle_due = 0  # force "past the due cycle"
        await db.commit()

    async with async_session() as db:
        flagged = await chama_service.flag_overdue_loans(db)
        await db.commit()
        loan = await db.get(ChamaLoan, uuid.UUID(loan_id))
        assert loan.status == "defaulted"
    assert flagged >= 1

    loans = (await client.get(f"/api/chamas/{chama_id}/loans", headers=member_a)).json()
    my_loan = next(l for l in loans["recent"] if l["id"] == loan_id)
    assert my_loan["status"] == "defaulted"

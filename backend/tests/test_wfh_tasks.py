"""Pillar 1 — the Work-From-Home task and commission board.

The rules under test are the ones that keep this honest:
  * an atomic claim, gated by server-derived standing;
  * a lapsed claim auto-releases;
  * the fee is deterministic (5–8%) and is recorded once, in a ledger;
  * the payment tag is revealed only to the poster on approval;
  * proof signals are labelled as signals, not verification.
"""

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.database import async_session
from app.models.vendor import Vendor
from tests.test_smoke import _auth, _register

pytestmark = pytest.mark.asyncio
NAIROBI = ZoneInfo("Africa/Nairobi")


async def _make_level_two(vendor_id: str, *, location="Nairobi"):
    async with async_session() as db:
        person = await db.get(Vendor, uuid.UUID(vendor_id))
        person.phone_verified_at = datetime.utcnow()
        person.physical_location = location
        await db.commit()


def _task_body(**over):
    today = datetime.now(NAIROBI).date()
    body = {
        "task_type": "DELIVERY_HANDOFF",
        "title": "Deliver a parcel to Kondele",
        "instructions": "Collect the parcel at the shop and hand it to the named recipient.",
        "region_slug": "nairobi-metro",
        "town": "Kisumu",
        "scheduled_date": today.isoformat(),
        "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "worker_payout_kes": 250,
        "min_standing_level": 2,
    }
    body.update(over)
    return body


async def test_claim_proof_approval_records_one_fee(client):
    poster, worker, other = [
        await _register(client, name, ["produce"]) for name in ("wfh_poster", "wfh_worker", "wfh_other")
    ]
    h, wh, oh = (_auth(x["access_token"]) for x in (poster, worker, other))
    await _make_level_two(worker["vendor_id"])
    await _make_level_two(other["vendor_id"])

    created = await client.post("/api/tasks", headers=h, json=_task_body())
    assert created.status_code == 201, created.text
    task = created.json()
    assert task["status"] == "OPEN"
    assert task["fee_pct"] == 5.0
    assert task["platform_fee_kes"] == 12.5          # 5% of 250
    assert task["net_payout_label"] == "Earn KSh 250"
    assert task["handoff_code"].startswith("HO-")
    tid = task["id"]

    # The poster cannot claim their own task.
    assert (await client.post(f"/api/tasks/{tid}/claim", headers=h)).status_code == 403

    claimed = await client.post(f"/api/tasks/{tid}/claim", headers=wh)
    assert claimed.status_code == 200, claimed.text
    body = claimed.json()
    assert body["status"] == "CLAIMED" and body["is_assignee"]
    assert body["claim_expires_at"] is not None
    # Another worker cannot take a claimed task.
    assert (await client.post(f"/api/tasks/{tid}/claim", headers=oh)).status_code == 409

    # The worker never sees the poster's handoff code.
    assert body["handoff_code"] is None

    submitted = await client.post(f"/api/tasks/{tid}/proof", headers=wh, json={
        "handoff_code": task["handoff_code"],
        "note": "Handed to the recipient at the stage.",
        "payout_tag": {"method": "SEND_MONEY", "number": "0712345678", "name": "Worker"},
    })
    assert submitted.status_code == 200, submitted.text
    proof = submitted.json()["proof"]
    assert proof["signals"]["handoff_verified"] is True
    assert submitted.json()["payment_tag"] == {}      # hidden until approval
    assert "not platform verification" in submitted.json()["signal_note"]

    # Only the poster approves.
    assert (await client.post(f"/api/tasks/{tid}/approve", headers=wh)).status_code == 403
    approved = await client.post(f"/api/tasks/{tid}/approve", headers=h)
    assert approved.status_code == 200, approved.text
    result = approved.json()
    assert result["payment_tag"]["number"] == "0712345678"
    assert result["fee_recorded"] is True
    assert result["task"]["status"] == "COMPLETED"
    assert result["task"]["payment_tag"]["number"] == "0712345678"
    assert "never holds the money" in result["payment_instruction"]

    # Double approval is idempotent, not a second commission.
    again = await client.post(f"/api/tasks/{tid}/approve", headers=h)
    assert again.status_code == 200 and again.json()["fee_recorded"] is False
    assert again.json()["fee_already_recorded"] is True

    ledger = await client.get("/api/tasks/mine", headers=h)
    fees = ledger.json()["fees"]
    assert len(fees) == 1 and fees[0]["platform_fee_kes"] == 12.5
    assert fees[0]["settlement_mode"] == "direct_mpesa"

    earnings = await client.get("/api/tasks/inbox", headers=wh)
    assert earnings.json()["earnings"]["earned_kes"] == 250.0
    assert earnings.json()["standing_level"] >= 1
    assert "add no standing credit" in earnings.json()["earnings"]["note"]


async def test_standing_gate_and_lapsed_claim_release(client):
    poster = await _register(client, "gate_poster", ["produce"])
    low = await _register(client, "gate_low", ["produce"])
    high = await _register(client, "gate_high", ["produce"])
    h, lh, hh = (_auth(x["access_token"]) for x in (poster, low, high))

    created = await client.post("/api/tasks", headers=h, json=_task_body(
        task_type="MERCHANT_ONBOARD", title="Onboard the chemist", worker_payout_kes=500,
    ))
    assert created.status_code == 201
    task = created.json()
    assert task["fee_pct"] == 8.0 and task["platform_fee_kes"] == 40.0
    tid = task["id"]

    # A fresh account is Level 1: the gate refuses with an explanation that does
    # not pretend standing can be bought.
    refused = await client.post(f"/api/tasks/{tid}/claim", headers=lh)
    assert refused.status_code == 403
    assert "earned from completed trades" in refused.json()["detail"]

    await _make_level_two(high["vendor_id"])
    assert (await client.post(f"/api/tasks/{tid}/claim", headers=hh)).status_code == 200

    # Stall the claim past its four-hour hold: the next read releases it.
    async with async_session() as db:
        from app.modules.corridor_tasks.models import CorridorTask

        row = await db.get(CorridorTask, uuid.UUID(tid))
        row.claim_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db.commit()

    board = await client.get("/api/tasks/board?region_slug=nairobi-metro", headers=lh)
    assert board.status_code == 200
    row = next(item for item in board.json()["tasks"] if item["id"] == tid)
    assert row["status"] == "OPEN" and row["is_assignee"] is False
    assert board.json()["standing_level"] == 1


async def test_inbox_week_strip_is_local_and_dated(client):
    poster = await _register(client, "strip_poster", ["produce"])
    far = await _register(client, "strip_far", ["produce"])
    h, fh = (_auth(x["access_token"]) for x in (poster, far))
    body = _task_body(region_slug="nairobi-metro")
    created = await client.post("/api/tasks", headers=h, json=body)
    assert created.status_code == 201

    inbox = await client.get("/api/tasks/inbox", headers=fh)
    assert inbox.status_code == 200
    data = inbox.json()
    assert len(data["days"]) == 7
    assert data["days"][0]["available"] >= 1
    assert any(item["id"] == created.json()["id"] for item in data["tasks"])

    # A task in another corridor is not shown to this viewer.
    async with async_session() as db:
        person = await db.get(Vendor, uuid.UUID(far["vendor_id"]))
        person.physical_location = "Mombasa"
        await db.commit()
    away = await client.get("/api/tasks/inbox", headers=fh)
    assert all(item["id"] != created.json()["id"] for item in away.json()["tasks"])


async def test_task_validation_and_withdrawal(client):
    poster = await _register(client, "valid_poster", ["produce"])
    h = _auth(poster["access_token"])
    bad_type = await client.post("/api/tasks", headers=h, json=_task_body(task_type="FREE_MONEY"))
    assert bad_type.status_code == 422
    too_low = await client.post("/api/tasks", headers=h, json=_task_body(worker_payout_kes=5))
    assert too_low.status_code == 422
    past = await client.post("/api/tasks", headers=h, json=_task_body(
        due_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()))
    assert past.status_code == 422

    created = await client.post("/api/tasks", headers=h, json=_task_body())
    tid = created.json()["id"]
    withdrawn = await client.post(f"/api/tasks/{tid}/withdraw", headers=h)
    assert withdrawn.status_code == 200 and withdrawn.json()["status"] == "EXPIRED"


async def test_wrong_handoff_code_is_recorded_as_unverified(client):
    poster, worker = [await _register(client, n, ["food"]) for n in ("wrong_poster", "wrong_worker")]
    h, wh = _auth(poster["access_token"]), _auth(worker["access_token"])
    await _make_level_two(worker["vendor_id"])
    created = await client.post("/api/tasks", headers=h, json=_task_body())
    tid = created.json()["id"]
    assert (await client.post(f"/api/tasks/{tid}/claim", headers=wh)).status_code == 200
    submitted = await client.post(f"/api/tasks/{tid}/proof", headers=wh, json={
        "handoff_code": "HO-ZZZ",
        "payout_tag": {"method": "POCHI", "number": "0712345678"},
    })
    assert submitted.status_code == 200
    signals = submitted.json()["proof"]["signals"]
    assert signals["handoff_verified"] is False
    assert "did not match" in signals["handoff_note"]

    # A proof with no signal at all is refused before it reaches the poster.
    async with async_session() as db:
        from app.modules.corridor_tasks.models import CorridorTask

        row = await db.get(CorridorTask, uuid.UUID(tid))
        row.status = "CLAIMED"
        row.proof_payload = {}
        row.payment_tag_snapshot = {}
        await db.commit()
    empty = await client.post(f"/api/tasks/{tid}/proof", headers=wh, json={
        "payout_tag": {"method": "POCHI", "number": "0712345678"},
    })
    assert empty.status_code == 422
    assert "at least one proof" in empty.json()["detail"]

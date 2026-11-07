"""v3.9 — customer reviews through till codes (no customer account).

What these prove:
- a customer can review with no login, using a device key and the till code from a purchase;
- one review per device per shop; one review per till code;
- a code belongs to one shop and expires; a code made seconds ago is held for checking;
- suspicious reviews are held, not published, and stay out of the public rating until staff check them;
- only Brief staff can publish or remove a held review; nobody moderates their own shop;
- every review, hold, moderation and code issue is written to the audit log;
- customers can see their own history and set a display name.
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.database import async_session
from app.modules.trust import catalogue
from app.modules.trust.models import AuditEvent, ReviewFlag, TransactionToken
from tests.test_v38_market_trust import _active_branch, _approve, _branch, _business, _staff  # noqa: F401
from tests.test_v35_offers import ops  # noqa: F401

pytestmark = pytest.mark.asyncio


def cust():
    return {"X-Customer-Key": "cust-" + uuid.uuid4().hex}


async def _code(client, owner, bid, receipt="RCPT-1001", backdate=True):
    r = await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner, json={"receipt_ref": receipt})
    assert r.status_code == 201, r.text
    if backdate:
        await _age_tokens()
    return r.json()["token"]


async def _age_tokens():
    """Make freshly issued codes look a few minutes old, so the 'used within seconds' rule does not fire."""
    async with async_session() as db:
        await db.execute(update(TransactionToken).where(
            TransactionToken.consumed_at.is_(None), TransactionToken.created_at >= datetime.utcnow() - timedelta(minutes=5)
        ).values(created_at=datetime.utcnow() - timedelta(minutes=3)))
        await db.commit()


def review_body(code, overall=4, service=4, product=4, comment=None):
    body = {"transaction_code": code, "service_rating": service, "product_rating": product,
            "overall_rating": overall}
    if comment:
        body["comment"] = comment
    return body


async def _shop(client, ops_fixture, prefix, name=None):
    _, owner, _ = await _business(client, f"{prefix}o")
    _, staff, _ = await _staff(client, None, ops_fixture, f"{prefix}s")
    bid = await _active_branch(client, owner, staff, name=name or f"{prefix} shop")
    return owner, staff, bid


async def _public_reviews(client, bid):
    return (await client.get(f"/api/trust/public/branches/{bid}/reviews")).json()["reviews"]


async def _reputation(client, bid):
    return (await client.get(f"/api/trust/public/branches/{bid}")).json()["reputation"]


# ---------- no login, but a real purchase ----------------------------------------------

async def test_customer_reviews_with_no_login_and_a_till_code(client, ops):
    owner, _, bid = await _shop(client, ops, "cn1")
    code = await _code(client, owner, bid)
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code, 5, 4, 5, "Fresh produce, fast service"))
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "published"
    assert r.json()["evidence_tier"] == "confirmed_token"


async def test_customer_review_is_visible_with_each_rating_and_a_verified_label(client, ops):
    owner, _, bid = await _shop(client, ops, "cn2")
    code = await _code(client, owner, bid)
    await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code, 5, 3, 4))
    rows = await _public_reviews(client, bid)
    assert len(rows) == 1
    assert rows[0]["overall"] == 5 and rows[0]["service"] == 3 and rows[0]["product"] == 4
    assert rows[0]["evidence_tier"] == "confirmed_token"
    assert rows[0]["reviewer"] == "Verified customer"


async def test_reputation_shows_service_and_product_averages(client, ops):
    owner, _, bid = await _shop(client, ops, "cn3")
    for overall, service, product in ((5, 5, 3), (3, 3, 5)):
        code = await _code(client, owner, bid, receipt=f"RCPT-{overall}{service}{product}")
        assert (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(),
                                  json=review_body(code, overall, service, product))).status_code == 201
    rep = await _reputation(client, bid)
    assert rep["review_count"] == 2
    assert rep["service_average"] == 4.0 and rep["product_average"] == 4.0
    assert rep["raw_average"] == 4.0


async def test_customer_path_refuses_a_review_without_a_till_code(client, ops):
    _, _, bid = await _shop(client, ops, "cn4")
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body("", 4))
    assert r.status_code == 422


async def test_customer_path_needs_a_device_key(client, ops):
    owner, _, bid = await _shop(client, ops, "cn5")
    code = await _code(client, owner, bid)
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", json=review_body(code, 4))
    assert r.status_code == 422
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers={"X-Customer-Key": "short"},
                          json=review_body(code, 4))
    assert r.status_code == 422


async def test_each_rating_must_be_one_to_five(client, ops):
    owner, _, bid = await _shop(client, ops, "cn6")
    code = await _code(client, owner, bid)
    for bad in ({"overall_rating": 0}, {"service_rating": 6}, {"product_rating": 0}):
        body = review_body(code, 4)
        body.update(bad)
        assert (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=body)).status_code == 422


# ---------- one review per device, one per code ----------------------------------------

async def test_one_review_per_device_per_shop(client, ops):
    owner, _, bid = await _shop(client, ops, "cn7")
    key = cust()
    code1 = await _code(client, owner, bid, receipt="RCPT-A1")
    code2 = await _code(client, owner, bid, receipt="RCPT-A2")
    assert (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=key, json=review_body(code1))).status_code == 201
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=key, json=review_body(code2))
    assert r.status_code == 409


async def test_a_code_works_once_even_for_another_device(client, ops):
    owner, _, bid = await _shop(client, ops, "cn8")
    code = await _code(client, owner, bid)
    assert (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code))).status_code == 201
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code))
    assert r.status_code == 422


async def test_a_code_from_one_shop_does_not_work_at_another(client, ops):
    owner, _, bid_a = await _shop(client, ops, "cn9a", name="Shop A")
    _, staff, bid_b = await _shop(client, ops, "cn9b", name="Shop B")
    code = await _code(client, owner, bid_a)
    r = await client.post(f"/api/trust/customer/branches/{bid_b}/reviews", headers=cust(), json=review_body(code))
    assert r.status_code == 422


async def test_an_expired_code_is_refused(client, ops):
    owner, _, bid = await _shop(client, ops, "cn10")
    code = await _code(client, owner, bid)
    async with async_session() as db:
        await db.execute(update(TransactionToken).where(TransactionToken.token_hash.isnot(None))
                         .values(expires_at=datetime.utcnow() - timedelta(minutes=1)))
        await db.commit()
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code))
    assert r.status_code == 422


async def test_a_blocked_review_profile_is_refused(client, ops):
    owner, _, bid = await _shop(client, ops, "cn11")
    key = cust()
    code = await _code(client, owner, bid)
    assert (await client.get("/api/trust/customer/reviews", headers=key)).status_code == 200
    from app.modules.trust.models import ReviewIdentity
    import hashlib
    async with async_session() as db:
        await db.execute(update(ReviewIdentity).where(
            ReviewIdentity.key_hash == hashlib.sha256(key["X-Customer-Key"].encode()).hexdigest()
        ).values(status="blocked"))
        await db.commit()
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=key, json=review_body(code))
    assert r.status_code == 403


# ---------- held reviews: fraud and duplicate detection --------------------------------------

async def test_a_code_used_within_seconds_is_held_not_published(client, ops):
    owner, _, bid = await _shop(client, ops, "cn12")
    code = await _code(client, owner, bid, backdate=False)  # made just now
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code, 1))
    assert r.status_code == 201
    assert r.json()["status"] == "hidden_pending_review"
    assert "being checked" in r.json()["message"]
    assert await _public_reviews(client, bid) == []
    assert (await _reputation(client, bid))["score"] is None


async def test_held_reviews_wait_for_staff_then_can_be_published(client, ops):
    owner, staff, bid = await _shop(client, ops, "cn13")
    code = await _code(client, owner, bid, backdate=False)
    rid = (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code, 2))).json()["id"]

    async with async_session() as db:
        flags = (await db.execute(select(ReviewFlag.reason_key).where(ReviewFlag.review_id == uuid.UUID(rid)))).scalars().all()
    assert "code_used_too_fast" in flags

    queue = (await client.get("/api/trust/admin/reviews/flagged", headers=staff)).json()["reviews"]
    assert rid in [q["id"] for q in queue]
    item = next(q for q in queue if q["id"] == rid)
    assert "code_used_too_fast" in item["reasons"]

    r = await client.post(f"/api/trust/admin/reviews/{rid}/moderation", headers=staff,
                          json={"action": "publish", "reason": "Checked the receipt with the shop"})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "published"
    assert [x["id"] for x in await _public_reviews(client, bid)] == [rid]


async def test_staff_can_remove_a_held_review(client, ops):
    owner, staff, bid = await _shop(client, ops, "cn14")
    code = await _code(client, owner, bid, backdate=False)
    rid = (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code, 1))).json()["id"]
    r = await client.post(f"/api/trust/admin/reviews/{rid}/moderation", headers=staff,
                          json={"action": "remove", "reason": "Review was posted by the owner"})
    assert r.status_code == 201 and r.json()["status"] == "removed"
    assert await _public_reviews(client, bid) == []


async def test_duplicate_wording_on_the_same_shop_is_held(client, ops):
    owner, _, bid = await _shop(client, ops, "cn15")
    words = "Excellent service and the tomatoes were fresh today"
    c1 = await _code(client, owner, bid, receipt="RCPT-D1")
    c2 = await _code(client, owner, bid, receipt="RCPT-D2")
    first = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(c1, 5, comment=words))
    second = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(c2, 5, comment=words.upper() + "!"))
    assert first.json()["status"] == "published"
    assert second.json()["status"] == "hidden_pending_review"


async def test_many_reviews_in_a_day_are_held_then_refused(client, ops, monkeypatch):
    key = cust()
    shops = []
    for i in range(6):
        owner, _, bid = await _shop(client, ops, f"cn16{i}", name=f"Velocity {i}")
        shops.append((owner, bid))
    results = []
    for owner, bid in shops:
        code = await _code(client, owner, bid, receipt=f"RCPT-V{uuid.uuid4().hex[:4]}")
        results.append(await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=key, json=review_body(code, 4)))
    statuses = [r.status_code for r in results]
    assert statuses[:2] == [201, 201]
    assert results[2].json()["status"] == "hidden_pending_review"  # third in a day is held
    assert statuses[5] == 429  # fifth already today is refused


# ---------- staff: permission and audit ------------------------------------------------------------

async def test_only_staff_see_the_held_queue_and_moderate(client, ops):
    owner, staff, bid = await _shop(client, ops, "cn17")
    _, not_staff, _ = await _business(client, "cn17x")
    code = await _code(client, owner, bid, backdate=False)
    rid = (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code))).json()["id"]
    assert (await client.get("/api/trust/admin/reviews/flagged", headers=not_staff)).status_code == 403
    assert (await client.get("/api/trust/admin/reviews/flagged")).status_code == 401
    r = await client.post(f"/api/trust/admin/reviews/{rid}/moderation", headers=not_staff,
                          json={"action": "publish", "reason": "Trying to publish my own review"})
    assert r.status_code == 403


async def test_moderation_needs_a_real_reason(client, ops):
    owner, staff, bid = await _shop(client, ops, "cn18")
    code = await _code(client, owner, bid, backdate=False)
    rid = (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code))).json()["id"]
    r = await client.post(f"/api/trust/admin/reviews/{rid}/moderation", headers=staff, json={"action": "publish", "reason": "ok"})
    assert r.status_code == 422


async def test_staff_cannot_moderate_their_own_shop(client, ops):
    # A staff member owns a shop; a second staff member approves it, then the owner tries to moderate.
    owner_handle, owner_staff, _ = await _staff(client, None, ops, "cn19o")
    own_shop_bid = await _branch(client, owner_staff, name="Owner-staff shop")
    _, approver, _ = await _staff(client, None, ops, "cn19a")
    await _approve(client, approver, own_shop_bid)
    code = await _code(client, owner_staff, own_shop_bid, backdate=False)
    rid = (await client.post(f"/api/trust/customer/branches/{own_shop_bid}/reviews", headers=cust(),
                             json=review_body(code))).json()["id"]
    ops(owner_handle)
    r = await client.post(f"/api/trust/admin/reviews/{rid}/moderation", headers=owner_staff,
                          json={"action": "publish", "reason": "Publishing my own shop review"})
    assert r.status_code == 403


async def test_review_and_moderation_are_audited(client, ops):
    owner, staff, bid = await _shop(client, ops, "cn20")
    code = await _code(client, owner, bid, receipt="RCPT-AUD1", backdate=False)
    rid = (await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code))).json()["id"]
    await client.post(f"/api/trust/admin/reviews/{rid}/moderation", headers=staff,
                      json={"action": "publish", "reason": "Checked the receipt with the shop"})
    async with async_session() as db:
        rows = (await db.execute(select(AuditEvent.action).where(AuditEvent.entity_id == uuid.UUID(rid)))).scalars().all()
        issued = (await db.execute(select(AuditEvent.payload).where(
            AuditEvent.action == "token_issued", AuditEvent.payload["receipt_ref"].astext == "RCPT-AUD1"))).scalars().all()
    assert "review_held" in rows and "review_published" in rows
    assert issued, "the till code issue should record the receipt reference"


# ---------- receipts on codes, customer history and names -------------------------------------------

async def test_till_code_needs_a_receipt_reference(client, ops):
    owner, _, bid = await _shop(client, ops, "cn21")
    assert (await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner, json={})).status_code == 422
    assert (await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner, json={"receipt_ref": "x"})).status_code == 422


async def test_customer_sees_their_own_history_only(client, ops):
    owner, _, bid = await _shop(client, ops, "cn22")
    mine, other = cust(), cust()
    code = await _code(client, owner, bid)
    await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=mine, json=review_body(code, 5))
    history = (await client.get("/api/trust/customer/reviews", headers=mine)).json()
    assert len(history["reviews"]) == 1
    assert history["reviews"][0]["overall"] == 5
    assert history["reviews"][0]["status"] == "published"
    assert (await client.get("/api/trust/customer/reviews", headers=other)).json()["reviews"] == []


async def test_display_name_shows_on_reviews_and_can_be_cleared(client, ops):
    owner, _, bid = await _shop(client, ops, "cn23")
    key = cust()
    code = await _code(client, owner, bid)
    await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=key, json=review_body(code, 4))
    r = await client.put("/api/trust/customer/profile", headers=key, json={"display_name": "Achieng"})
    assert r.json()["display_name"] == "Achieng"
    assert (await _public_reviews(client, bid))[0]["reviewer"] == "Achieng"
    await client.put("/api/trust/customer/profile", headers=key, json={"display_name": ""})
    assert (await _public_reviews(client, bid))[0]["reviewer"] == "Verified customer"


async def test_customer_routes_do_not_expose_identity_or_money(client, ops):
    from app.main import app
    paths = [getattr(r, "path", "") for r in app.routes if "/customer" in getattr(r, "path", "")]
    assert paths, "customer routes should be mounted"
    for p in paths:
        assert not any(w in p.lower() for w in ("withdraw", "payout", "wallet", "cash", "transfer"))
    owner, _, bid = await _shop(client, ops, "cn24")
    code = await _code(client, owner, bid)
    await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code))
    for row in await _public_reviews(client, bid):
        assert "review_identity_id" not in row and "key_hash" not in row and "device" not in str(row).lower()


async def test_a_shop_reviewing_itself_right_after_issuing_a_code_is_held(client, ops):
    """The owner issues a code (the normal till flow) and uses it at once from an anonymous device.
    The code is used within seconds, so the review is held and never enters the public rating.
    Limit: an owner who waits before using the code is not caught by this rule alone."""
    owner, _, bid = await _shop(client, ops, "cn_self")
    code = await _code(client, owner, bid, receipt="RCPT-SELF", backdate=False)
    r = await client.post(f"/api/trust/customer/branches/{bid}/reviews", headers=cust(), json=review_body(code, 5, 5, 5))
    assert r.status_code == 201, r.text
    assert await _public_reviews(client, bid) == []
    assert (await _reputation(client, bid))["review_count"] == 0

"""v3.8 — MarketTrust core for Kenya, Ethiopia and Uganda.

What these prove:
- a branch is public only after staff verification; staff cannot verify their own business;
- Brief works in KE, ET and UG only;
- a review with a one-time till code is a confirmed-transaction review; without one it is unverified;
  a code works once, only for its own branch, and only before it expires (even under a race);
- one current review per person per branch, and a business cannot review itself;
- every accepted review earns the same points whatever the star rating;
- points are never money: there is no withdrawal, payout or wallet route, and redemption is
  idempotent, cannot overspend, and only offers services that are listed;
- the append-only tables refuse UPDATE and DELETE at the database level;
- the public read routes need no login; writes always do.
"""

import asyncio
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import update

from app.database import async_session
from app.modules.trust import service as svc
from app.modules.trust.models import AuditEvent, BusinessReview, PointsEntry, TransactionToken
from tests.test_v35_offers import PASSWORD, _register  # noqa: F401 (helper reuse)
from tests.test_v35_offers import ops  # noqa: F401 (fixture reuse)

pytestmark = pytest.mark.asyncio


# ---------- the rules themselves (no database) -------------------------------------------

def test_three_countries_only():
    assert set(svc.COUNTRIES) == {"KE", "ET", "UG"}
    assert svc.COUNTRIES["ET"]["currency"] == "ETB"
    assert svc.COUNTRIES["UG"]["currency"] == "UGX"
    assert svc.COUNTRIES["KE"]["currency"] == "KES"
    assert svc.require_country("et") == "ET"
    with pytest.raises(svc.TrustError):
        svc.require_country("TZ")


def test_token_normalisation_and_shape():
    t = svc.new_token()
    assert t.startswith("TKN-") and len(t.replace("-", "")) > 10
    assert svc.hash_token(" tkn-abcd-1234 ") == svc.hash_token("TKN-ABCD-1234")
    assert svc.hash_token(t) != t


class _R:
    def __init__(self, rating, tier, weight, id_=None):
        self.id = id_ or uuid.uuid4()
        self.rating = rating
        self.evidence_tier = tier
        self.evidence_weight = weight


def test_no_reviews_means_no_score():
    rep = svc.reputation([])
    assert rep["score"] is None and rep["raw_average"] is None and rep["verified_average"] is None
    assert rep["message"] == "Not enough reviews yet."
    assert rep["review_count"] == 0


def test_spec_worked_example_reproduces():
    # Spec example: 5 stars (token, 1.00), 4 stars (unverified, 0.25), 1 star (validated receipt, 0.90).
    # Our tiers are token/unverified only; the 0.90 receipt is modelled here as the same weight input.
    reviews = [
        _R(5, svc.TIER_CONFIRMED, 1.00, uuid.UUID(int=1)),
        _R(4, svc.TIER_UNVERIFIED, 0.25, uuid.UUID(int=2)),
        _R(1, svc.TIER_UNVERIFIED, 0.90, uuid.UUID(int=3)),
    ]
    rep = svc.reputation(reviews)
    assert rep["score"] == pytest.approx(3.41, abs=0.01)
    assert rep["verified_average"] == 5.0
    assert rep["verified_review_count"] == 1
    assert rep["method_version"] == "rep-v1"


def test_reputation_is_reproducible_and_order_independent():
    a = [_R(3, svc.TIER_UNVERIFIED, 0.25, uuid.UUID(int=10)), _R(5, svc.TIER_CONFIRMED, 1.0, uuid.UUID(int=11))]
    b = list(reversed(a))
    assert svc.reputation(a)["input_hash"] == svc.reputation(b)["input_hash"]
    assert svc.reputation(a)["score"] == svc.reputation(b)["score"]


def test_distance_is_about_right():
    # Kisumu CBD to Kisumu Kondele is roughly 4-5 km.
    d = svc.distance_m(-0.0917, 34.7680, -0.1022, 34.7617)
    assert 1_000 < d < 3_000


# ---------- helpers -------------------------------------------------------------------------------

async def _business(client, prefix):
    return await _register(client, prefix)  # (handle, headers, vendor_id)


async def _branch(client, owner_headers, *, country="KE", name=None, lat=-0.0917, lng=34.7680):
    r = await client.post("/api/trust/branches", headers=owner_headers, json={
        "country": country,
        "branch_name": name or f"Branch {uuid.uuid4().hex[:6]}",
        "address_text": "Main road, opposite the market",
        "latitude": lat, "longitude": lng,
    })
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _approve(client, staff_headers, branch_id, method="storefront_photo"):
    r = await client.post(f"/api/trust/admin/branches/{branch_id}/verifications", headers=staff_headers,
                          json={"method": method, "result": "approved", "note": None})
    assert r.status_code == 201, r.text
    return r.json()


async def _staff(client, _unused, ops, prefix="staffv"):
    handle, headers, vid = await _register(client, prefix)
    ops(handle)
    return handle, headers, vid


async def _active_branch(client, owner_headers, staff_headers, **kw):
    bid = await _branch(client, owner_headers, **kw)
    await _approve(client, staff_headers, bid)
    return bid


async def _points(client, headers):
    r = await client.get("/api/trust/points", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["balance_points"]


# ---------- branches and countries -----------------------------------------------------------------

async def test_branch_is_pending_until_staff_approve(client, ops):
    _, owner, _ = await _business(client, "bpend")
    _, staff, _ = await _staff(client, None, ops, "bpstaff")
    bid = await _branch(client, owner)
    assert (await client.get(f"/api/trust/public/branches/{bid}")).status_code == 404
    mine = (await client.get("/api/trust/branches/mine", headers=owner)).json()["branches"]
    assert mine[0]["status"] == "pending"
    await _approve(client, staff, bid)
    assert (await client.get(f"/api/trust/public/branches/{bid}")).status_code == 200


async def test_each_of_the_three_countries_accepts_branches(client):
    _, owner, _ = await _business(client, "ctry")
    for code in ("KE", "ET", "UG"):
        bid = await _branch(client, owner, country=code, name=f"Shop {code} {uuid.uuid4().hex[:4]}")
        assert bid
    r = await client.post("/api/trust/branches", headers=owner, json={
        "country": "TZ", "branch_name": "Dar shop", "address_text": "Somewhere in Dar"})
    assert r.status_code == 422
    assert "Kenya, Ethiopia and Uganda" in r.json()["detail"]


async def test_duplicate_branch_name_for_one_business_is_refused(client):
    _, owner, _ = await _business(client, "dupb")
    await _branch(client, owner, name="Main shop")
    r = await client.post("/api/trust/branches", headers=owner, json={
        "country": "KE", "branch_name": "Main shop", "address_text": "Another road here"})
    assert r.status_code == 409


async def test_nearby_search_respects_radius_and_only_shows_active(client, ops):
    _, owner, _ = await _business(client, "near")
    _, staff, _ = await _staff(client, None, ops, "nearstaff")
    near = await _active_branch(client, owner, staff, lat=-0.0917, lng=34.7680, name="Near one")
    far = await _active_branch(client, owner, staff, lat=-1.2921, lng=36.8219, name="Nairobi one")  # Nairobi
    await _branch(client, owner, lat=-0.0917, lng=34.7680, name="Pending near")  # never approved
    r = await client.get("/api/trust/public/branches", params={"lat": -0.09, "lng": 34.77, "radius_m": 3000})
    ids = [b["id"] for b in r.json()["branches"]]
    assert near in ids and far not in ids
    assert all("reputation" in b for b in r.json()["branches"])
    assert all(b["status"] == "active" for b in r.json()["branches"])


async def test_public_country_filter(client, ops):
    _, owner, _ = await _business(client, "cfilt")
    _, staff, _ = await _staff(client, None, ops, "cfstaff")
    ug = await _active_branch(client, owner, staff, country="UG", name="Kampala shop")
    r = await client.get("/api/trust/public/branches", params={"country": "UG"})
    assert ug in [b["id"] for b in r.json()["branches"]]
    r = await client.get("/api/trust/public/branches", params={"country": "KE"})
    assert ug not in [b["id"] for b in r.json()["branches"]]


# ---------- staff verification ------------------------------------------------------------------------

async def test_only_brief_staff_can_verify(client, ops):
    _, owner, _ = await _business(client, "nostaff")
    _, staff, _ = await _staff(client, None, ops, "realstaff")
    bid = await _branch(client, owner)
    r = await client.post(f"/api/trust/admin/branches/{bid}/verifications", headers=owner,
                          json={"method": "storefront_photo", "result": "approved", "note": None})
    assert r.status_code == 403


async def test_staff_cannot_verify_their_own_business(client, ops):
    _, staff, _ = await _staff(client, None, ops, "selfstaff")
    bid = await _branch(client, staff)
    r = await client.post(f"/api/trust/admin/branches/{bid}/verifications", headers=staff,
                          json={"method": "storefront_photo", "result": "approved", "note": None})
    assert r.status_code == 403


async def test_rejection_needs_a_real_reason(client, ops):
    _, owner, _ = await _business(client, "rej")
    _, staff, _ = await _staff(client, None, ops, "rejstaff")
    bid = await _branch(client, owner)
    r = await client.post(f"/api/trust/admin/branches/{bid}/verifications", headers=staff,
                          json={"method": "storefront_photo", "result": "rejected", "note": "no"})
    assert r.status_code == 422
    r = await client.post(f"/api/trust/admin/branches/{bid}/verifications", headers=staff,
                          json={"method": "storefront_photo", "result": "rejected",
                                "note": "Photo does not show the shop front"})
    assert r.status_code == 201
    assert (await client.get(f"/api/trust/public/branches/{bid}")).status_code == 404


async def test_approval_writes_an_audit_event(client, ops):
    _, owner, _ = await _business(client, "aud")
    _, staff, _ = await _staff(client, None, ops, "audstaff")
    bid = await _branch(client, owner)
    await _approve(client, staff, bid)
    async with async_session() as db:
        rows = (await db.execute(
            __import__("sqlalchemy").select(AuditEvent).where(AuditEvent.entity_id == uuid.UUID(bid))
        )).scalars().all()
    actions = {r.action for r in rows}
    assert {"branch_added", "branch_approved"} <= actions


# ---------- transaction tokens and reviews --------------------------------------------------------------

async def test_only_the_branch_owner_issues_a_code_and_only_when_public(client, ops):
    _, owner, _ = await _business(client, "tok1")
    _, other, _ = await _business(client, "tok2")
    _, staff, _ = await _staff(client, None, ops, "tokstaff")
    bid = await _branch(client, owner)
    assert (await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner)).status_code == 409
    await _approve(client, staff, bid)
    assert (await client.post(f"/api/trust/branches/{bid}/tokens", headers=other)).status_code == 403
    r = await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner)
    assert r.status_code == 201 and r.json()["token"].startswith("TKN-")


async def test_review_without_a_code_is_unverified_and_earns_points(client, ops):
    _, owner, _ = await _business(client, "rv0o")
    _, staff, _ = await _staff(client, None, ops, "rv0s")
    _, reviewer, _ = await _business(client, "rv0r")
    bid = await _active_branch(client, owner, staff)
    r = await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer, json={"rating": 4})
    assert r.status_code == 201, r.text
    assert r.json()["evidence_tier"] == "unverified"
    assert r.json()["points_earned"] == svc.REVIEW_POINTS
    assert await _points(client, reviewer) == svc.REVIEW_POINTS


async def test_one_star_and_five_stars_earn_the_same_points(client, ops):
    _, owner, _ = await _business(client, "eq0o")
    _, staff, _ = await _staff(client, None, ops, "eq0s")
    bid = await _active_branch(client, owner, staff)
    _, low, _ = await _business(client, "eq0low")
    _, high, _ = await _business(client, "eq0high")
    assert (await client.post(f"/api/trust/branches/{bid}/reviews", headers=low, json={"rating": 1})).status_code == 201
    assert (await client.post(f"/api/trust/branches/{bid}/reviews", headers=high, json={"rating": 5})).status_code == 201
    assert await _points(client, low) == await _points(client, high) == svc.REVIEW_POINTS


async def test_review_with_a_till_code_is_confirmed(client, ops):
    _, owner, _ = await _business(client, "rvco")
    _, staff, _ = await _staff(client, None, ops, "rvcs")
    _, reviewer, _ = await _business(client, "rvcr")
    bid = await _active_branch(client, owner, staff)
    token = (await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner)).json()["token"]
    r = await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer,
                          json={"rating": 5, "transaction_token": token.lower()})
    assert r.status_code == 201, r.text
    assert r.json()["evidence_tier"] == "confirmed_token"
    rep = (await client.get(f"/api/trust/public/branches/{bid}")).json()["reputation"]
    assert rep["verified_review_count"] == 1 and rep["verified_average"] == 5.0


async def test_a_till_code_works_only_once(client, ops):
    _, owner, _ = await _business(client, "once")
    _, staff, _ = await _staff(client, None, ops, "oncestaff")
    _, r1, _ = await _business(client, "once1")
    _, r2, _ = await _business(client, "once2")
    bid = await _active_branch(client, owner, staff)
    token = (await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner)).json()["token"]
    assert (await client.post(f"/api/trust/branches/{bid}/reviews", headers=r1,
                              json={"rating": 4, "transaction_token": token})).status_code == 201
    r = await client.post(f"/api/trust/branches/{bid}/reviews", headers=r2,
                          json={"rating": 4, "transaction_token": token})
    assert r.status_code == 422 and "already been used" in r.json()["detail"]
    assert await _points(client, r2) == 0  # a failed review earns nothing


async def test_a_till_code_is_refused_at_another_branch(client, ops):
    _, owner, _ = await _business(client, "xb")
    _, staff, _ = await _staff(client, None, ops, "xbs")
    _, reviewer, _ = await _business(client, "xbr")
    a = await _active_branch(client, owner, staff, name="Branch A")
    b = await _active_branch(client, owner, staff, name="Branch B")
    token = (await client.post(f"/api/trust/branches/{a}/tokens", headers=owner)).json()["token"]
    r = await client.post(f"/api/trust/branches/{b}/reviews", headers=reviewer,
                          json={"rating": 3, "transaction_token": token})
    assert r.status_code == 422 and "does not match this branch" in r.json()["detail"]


async def test_an_expired_till_code_is_refused(client, ops):
    _, owner, _ = await _business(client, "exp")
    _, staff, _ = await _staff(client, None, ops, "exps")
    _, reviewer, _ = await _business(client, "expr")
    bid = await _active_branch(client, owner, staff)
    token = (await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner)).json()["token"]
    async with async_session() as db:
        await db.execute(update(TransactionToken).where(TransactionToken.token_hash == svc.hash_token(token))
                         .values(expires_at=datetime.utcnow() - timedelta(minutes=1)))
        await db.commit()
    r = await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer,
                          json={"rating": 4, "transaction_token": token})
    assert r.status_code == 422


async def test_two_simultaneous_uses_of_one_code_let_exactly_one_through(client, ops):
    _, owner, _ = await _business(client, "race")
    _, staff, _ = await _staff(client, None, ops, "racestaff")
    bid = await _active_branch(client, owner, staff)
    token = (await client.post(f"/api/trust/branches/{bid}/tokens", headers=owner)).json()["token"]
    racers = [await _business(client, f"racer{i}") for i in range(2)]
    results = await asyncio.gather(*[
        client.post(f"/api/trust/branches/{bid}/reviews", headers=h, json={"rating": 5, "transaction_token": token})
        for _, h, _ in racers
    ])
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 422], codes


async def test_second_review_of_the_same_branch_is_refused(client, ops):
    _, owner, _ = await _business(client, "dup")
    _, staff, _ = await _staff(client, None, ops, "dups")
    _, reviewer, _ = await _business(client, "dupr")
    bid = await _active_branch(client, owner, staff)
    assert (await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer, json={"rating": 2})).status_code == 201
    r = await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer, json={"rating": 5})
    assert r.status_code == 409
    assert await _points(client, reviewer) == svc.REVIEW_POINTS  # no second reward


async def test_a_business_cannot_review_its_own_branch(client, ops):
    _, owner, _ = await _business(client, "self")
    _, staff, _ = await _staff(client, None, ops, "selfs")
    bid = await _active_branch(client, owner, staff)
    r = await client.post(f"/api/trust/branches/{bid}/reviews", headers=owner, json={"rating": 5})
    assert r.status_code == 403


async def test_cannot_review_a_pending_branch(client, ops):
    _, owner, _ = await _business(client, "pendrev")
    _, reviewer, _ = await _business(client, "pendrevr")
    bid = await _branch(client, owner)
    r = await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer, json={"rating": 5})
    assert r.status_code == 409


async def test_rating_outside_one_to_five_is_refused(client, ops):
    _, owner, _ = await _business(client, "rng")
    _, staff, _ = await _staff(client, None, ops, "rngs")
    _, reviewer, _ = await _business(client, "rngr")
    bid = await _active_branch(client, owner, staff)
    assert (await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer, json={"rating": 6})).status_code == 422


async def test_client_cannot_set_its_own_evidence_weight(client, ops):
    _, owner, _ = await _business(client, "wgt")
    _, staff, _ = await _staff(client, None, ops, "wgts")
    _, reviewer, _ = await _business(client, "wgtr")
    bid = await _active_branch(client, owner, staff)
    r = await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer,
                          json={"rating": 5, "evidence_weight": 1.0, "evidence_tier": "confirmed_token"})
    assert r.status_code == 201
    assert r.json()["evidence_tier"] == "unverified"
    assert "evidence_weight" not in r.json()


async def test_reputation_for_a_branch_with_no_reviews_is_honest(client, ops):
    _, owner, _ = await _business(client, "norev")
    _, staff, _ = await _staff(client, None, ops, "norevs")
    bid = await _active_branch(client, owner, staff)
    body = (await client.get(f"/api/trust/public/branches/{bid}")).json()
    assert body["reputation"]["score"] is None
    assert body["reputation"]["message"] == "Not enough reviews yet."


async def test_one_excellent_branch_does_not_hide_a_weak_one(client, ops):
    _, owner, owner_id = await _business(client, "two")
    _, staff, _ = await _staff(client, None, ops, "twos")
    good = await _active_branch(client, owner, staff, name="Good branch")
    bad = await _active_branch(client, owner, staff, name="Bad branch")
    _, r1, _ = await _business(client, "two1")
    _, r2, _ = await _business(client, "two2")
    await client.post(f"/api/trust/branches/{good}/reviews", headers=r1, json={"rating": 5})
    await client.post(f"/api/trust/branches/{bad}/reviews", headers=r2, json={"rating": 1})
    g = (await client.get(f"/api/trust/public/branches/{good}")).json()["reputation"]["raw_average"]
    b = (await client.get(f"/api/trust/public/branches/{bad}")).json()["reputation"]["raw_average"]
    assert g == 5.0 and b == 1.0
    biz = (await client.get(f"/api/trust/public/businesses/{owner_id}/reputation")).json()
    assert biz["review_count"] == 2
    assert biz["raw_average"] == 3.0


# ---------- points: never money, redemption is safe ------------------------------------------------

async def test_points_page_says_they_are_not_money(client):
    _, h, _ = await _business(client, "pts")
    body = (await client.get("/api/trust/points", headers=h)).json()
    assert body["balance_points"] == 0
    assert "not money" in body["note"].lower()


async def test_services_list_offers_only_listed_help(client):
    _, h, _ = await _business(client, "svcs")
    assert (await client.get("/api/trust/services")).status_code == 401  # signed-in only
    r = await client.get("/api/trust/services", headers=h)
    assert r.status_code == 200
    keys = {s["service_key"] for s in r.json()["services"]}
    assert keys == {"booking_setup", "directory_listing"}
    # No service may sell a trust rating or a ranking.
    assert not any(w in s["title"].lower() for s in r.json()["services"] for w in ("rating", "rank", "badge", "verif"))


async def test_redeem_with_no_listed_service_is_refused(client):
    _, h, _ = await _business(client, "redn")
    r = await client.post("/api/trust/points/redeem", headers={**h, "Idempotency-Key": "abcdefgh1"},
                          json={"service_key": "anything", "country": "KE"})
    assert r.status_code == 404


async def test_redeem_needs_an_idempotency_key(client):
    _, h, _ = await _business(client, "redk")
    r = await client.post("/api/trust/points/redeem", headers=h, json={"service_key": "x", "country": "KE"})
    assert r.status_code == 422


async def test_redeem_spends_points_once_per_key(client, ops, monkeypatch):
    monkeypatch.setitem(svc.REDEEMABLE_SERVICES, "listing_week", {
        "title": "One week listing", "points_cost": 20, "countries": ["KE", "UG"]})
    _, owner, _ = await _business(client, "rdmo")
    _, staff, _ = await _staff(client, None, ops, "rdms")
    _, reviewer, _ = await _business(client, "rdmr")
    bid = await _active_branch(client, owner, staff)
    await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer, json={"rating": 4})
    assert await _points(client, reviewer) == 20

    h = {**reviewer, "Idempotency-Key": "redeem-0001"}
    r1 = await client.post("/api/trust/points/redeem", headers=h, json={"service_key": "listing_week", "country": "KE"})
    assert r1.status_code == 200 and r1.json()["status"] == "redeemed"
    r2 = await client.post("/api/trust/points/redeem", headers=h, json={"service_key": "listing_week", "country": "KE"})
    assert r2.json()["status"] == "already_redeemed"
    assert await _points(client, reviewer) == 0


async def test_redeem_cannot_overspend(client, monkeypatch):
    monkeypatch.setitem(svc.REDEEMABLE_SERVICES, "big", {"title": "Big", "points_cost": 500, "countries": ["KE"]})
    _, h, _ = await _business(client, "rdmx")
    r = await client.post("/api/trust/points/redeem", headers={**h, "Idempotency-Key": "over-0001"},
                          json={"service_key": "big", "country": "KE"})
    assert r.status_code == 422
    assert await _points(client, h) == 0


async def test_redeem_refuses_a_country_the_service_is_not_offered_in(client, monkeypatch):
    monkeypatch.setitem(svc.REDEEMABLE_SERVICES, "kenya_only", {"title": "K", "points_cost": 1, "countries": ["KE"]})
    _, h, _ = await _business(client, "rdmc")
    r = await client.post("/api/trust/points/redeem", headers={**h, "Idempotency-Key": "country-01"},
                          json={"service_key": "kenya_only", "country": "ET"})
    assert r.status_code == 422


async def test_no_money_routes_exist_under_trust(client):
    from app.main import app
    paths = [getattr(r, "path", "") for r in app.routes if getattr(r, "path", "").startswith("/api/trust")]
    banned = ("withdraw", "payout", "wallet", "cash", "balance", "deposit", "loan")
    for p in paths:
        assert not any(word in p.lower() for word in banned), p


# ---------- append-only guards at the database level ----------------------------------------------------

async def test_points_ledger_refuses_update_and_delete(client, ops):
    _, owner, _ = await _business(client, "app1o")
    _, staff, _ = await _staff(client, None, ops, "app1s")
    _, reviewer, _ = await _business(client, "app1")
    bid = await _active_branch(client, owner, staff)
    assert (await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer, json={"rating": 3})).status_code == 201
    async with async_session() as db:
        with pytest.raises(Exception, match="append-only"):
            await db.execute(update(PointsEntry).values(points=999))
            await db.commit()
    async with async_session() as db:
        from sqlalchemy import delete
        with pytest.raises(Exception, match="append-only"):
            await db.execute(delete(PointsEntry))
            await db.commit()


async def test_audit_events_refuse_update(client):
    _, owner, _ = await _business(client, "app2")
    await _branch(client, owner)
    async with async_session() as db:
        with pytest.raises(Exception, match="append-only"):
            await db.execute(update(AuditEvent).values(action="tampered"))
            await db.commit()


async def test_one_current_review_index_is_enforced_by_the_database(client, ops):
    _, owner, _ = await _business(client, "idx")
    _, staff, _ = await _staff(client, None, ops, "idxs")
    _, reviewer, reviewer_id = await _business(client, "idxr")
    bid = await _active_branch(client, owner, staff)
    assert (await client.post(f"/api/trust/branches/{bid}/reviews", headers=reviewer, json={"rating": 4})).status_code == 201
    async with async_session() as db:
        with pytest.raises(Exception):
            db.add(BusinessReview(
                branch_id=uuid.UUID(bid), reviewer_vendor_id=uuid.UUID(reviewer_id),
                stage="quick", rating=2, evidence_tier="unverified", evidence_weight=0.25,
                status="published", version=1, is_current=True, created_at=datetime.utcnow()))
            await db.commit()


# ---------- access control -----------------------------------------------------------------------------

async def test_public_reads_need_no_login(client, ops):
    _, owner, _ = await _business(client, "pub")
    _, staff, _ = await _staff(client, None, ops, "pubs")
    bid = await _active_branch(client, owner, staff)
    assert (await client.get("/api/trust/public/branches")).status_code == 200
    assert (await client.get(f"/api/trust/public/branches/{bid}")).status_code == 200
    assert (await client.get(f"/api/trust/public/branches/{bid}/reviews")).status_code == 200


async def test_writes_always_need_a_signed_in_business(client):
    bid = str(uuid.uuid4())
    assert (await client.post("/api/trust/branches", json={"country": "KE", "branch_name": "x", "address_text": "y"})).status_code == 401
    assert (await client.post(f"/api/trust/branches/{bid}/reviews", json={"rating": 5})).status_code == 401
    assert (await client.post(f"/api/trust/branches/{bid}/tokens")).status_code == 401
    assert (await client.post("/api/trust/points/redeem", json={"service_key": "x", "country": "KE"})).status_code == 401


async def test_public_profile_hides_private_fields(client, ops):
    _, owner, _ = await _business(client, "priv")
    _, staff, _ = await _staff(client, None, ops, "privs")
    bid = await _active_branch(client, owner, staff)
    body = (await client.get(f"/api/trust/public/branches/{bid}")).json()["branch"]
    assert "vendor_id" in body  # the business link is public by design
    for secret in ("token_hash", "consumed_by_vendor_id", "verifier_vendor_id", "payload"):
        assert secret not in body

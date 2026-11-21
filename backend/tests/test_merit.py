"""Merit: the Trust Score, and the promises that keep it from becoming a loan.

The brief asked for verified behaviour to act as currency, with visible
consequences (tiers, perks, introductions) and no lending and no custody of
anyone's capital. These tests pin the parts that would break that:

    · a score cannot be bought. No fee, plan or payment is an input at all —
      asserted against the source of the rules module, so one cannot slip in;
    · a score cannot be spiked. Six families, each capped, and the cap sum is
      the maximum; Blue Chip needs two independent families;
    · quiet is not misconduct. Decay is floored, and the earned score is kept;
    · a streak is a fact, not points;
    · a mentor can lift a newcomer a little and never to Blue Chip;
    · the report leaves in the business's own hands and says what it is not;
    · discovery position moves by at most five per cent, and cannot be bought.
"""

import inspect
import uuid
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


# ── the rules, purely ────────────────────────────────────────────────────────

def test_no_fee_plan_or_payment_is_an_input():
    """The load-bearing promise: merit is not for sale.

    Asserted against the source, because a `plan` field would otherwise be a
    one-line change nobody notices in review.
    """
    from app.modules.merit import rules

    source = inspect.getsource(rules)
    body = source.split('"""', 2)[2]  # skip the module docstring, which discusses money
    for forbidden in ("platform_fee", "subscription", "plan_tier", "amount_paid",
                      "price_paid", "revenue", "balance", "wallet", "deposit"):
        assert forbidden not in body, f"merit rules must never read {forbidden}"


def test_the_families_cap_the_total():
    from app.modules.merit import rules

    assert rules.MAX_TOTAL == 100
    parts = (rules.MAX_FULFILMENT + rules.MAX_VERIFICATION + rules.MAX_RECEIPTS
             + rules.MAX_PRICE_WORK + rules.MAX_ENDORSEMENTS + rules.MAX_MENTORING)
    assert parts == rules.MAX_TOTAL
    # No single family may dominate: the largest is under a third.
    assert max(rules.MAX_FULFILMENT, rules.MAX_VERIFICATION) < rules.MAX_TOTAL / 3


def test_one_activity_cannot_make_a_blue_chip():
    """400 deliveries and nothing else is Seed or Verified, never Blue Chip."""
    from app.modules.merit import rules

    merit = rules.compute(
        rules.Facts(movements_completed=400, last_activity=date(2026, 11, 21)),
        as_of=date(2026, 11, 21),
    )
    # A single family is capped at its own ceiling, which is far below Blue Chip:
    # one kind of activity can never carry a business to the top tier.
    assert merit.score <= rules.MAX_FULFILMENT + 0.001
    assert merit.families == 1
    assert merit.tier != rules.TIER_BLUE_CHIP


def test_two_families_reach_blue_chip():
    from app.modules.merit import rules

    merit = rules.compute(
        rules.Facts(movements_completed=40, verified_claims=4, receipt_days=20,
                    last_activity=date(2026, 11, 21)),
        as_of=date(2026, 11, 21),
    )
    assert merit.families >= 2
    assert merit.tier == rules.TIER_BLUE_CHIP


def test_a_new_business_is_seed_and_does_not_raise():
    from app.modules.merit import rules

    merit = rules.compute(rules.Facts(), as_of=date(2026, 11, 21))
    assert merit.score == 0 and merit.tier == rules.TIER_SEED
    assert merit.families == 0
    assert merit.components, "an empty business still gets its reasons"
    assert merit.input_hash


def test_missing_evidence_is_zero_not_a_penalty():
    """Not having done a thing must not read as having failed at it."""
    from app.modules.merit import rules

    merit = rules.compute(rules.Facts(), as_of=date(2026, 11, 21))
    assert all(c.points == 0 for c in merit.components)
    assert merit.decay == 1.0
    assert not any("poor" in c.reason.lower() or "bad" in c.reason.lower()
                   for c in merit.components)


def test_counting_is_log_damped():
    from app.modules.merit import rules

    one, four, hundred = (rules.damp(n, 30) for n in (1, 4, 100))
    assert 0 < one < four < hundred <= 30
    assert hundred - four < 30 * 0.5, "the tail must flatten, not climb"


def test_two_perfect_deliveries_is_not_a_hundred_percent_record():
    from app.modules.merit import rules

    assert rules.fulfilment_ratio(0, 0) == 0.5
    two = rules.fulfilment_ratio(2, 0)
    many = rules.fulfilment_ratio(200, 0)
    assert 0.5 < two < 1.0
    assert two < many <= 1.0


def test_decay_is_floored_so_quiet_is_not_misconduct():
    from app.modules.merit import rules

    assert rules.decay_factor(None) == 1.0
    assert rules.decay_factor(0) == 1.0
    assert rules.decay_factor(rules.DECAY_HALF_LIFE_DAYS) == pytest.approx(0.5)
    assert rules.decay_factor(10_000) == rules.DECAY_FLOOR

    today = date(2026, 11, 21)
    active = rules.compute(
        rules.Facts(movements_completed=30, verified_claims=3, last_activity=today), as_of=today)
    quiet = rules.compute(
        rules.Facts(movements_completed=30, verified_claims=3,
                    last_activity=today - timedelta(days=400)), as_of=today)
    assert quiet.score < active.score, "going quiet is visible"
    assert quiet.score_earned == active.score_earned, "the record is never destroyed"
    assert quiet.score >= active.score * rules.DECAY_FLOOR
    assert quiet.decay < 1.0, "and it is reported, not hidden"


def test_a_streak_is_a_fact_not_points():
    from app.modules.merit import rules

    today = date(2026, 11, 21)
    days = [today - timedelta(days=7 * i) for i in range(5)]
    with_streak = rules.compute(
        rules.Facts(movements_completed=10, active_week_streak=5, last_activity=today),
        as_of=today)
    without = rules.compute(
        rules.Facts(movements_completed=10, active_week_streak=0, last_activity=today),
        as_of=today)
    assert with_streak.score == without.score, "showing up must not be worth points"
    assert rules.streak_weeks(days, as_of=today) == 5
    assert rules.streak_weeks([], as_of=today) == 0
    assert "streak" not in inspect.getsource(rules.compute)


def test_mentoring_lifts_a_newcomer_but_never_to_blue_chip():
    from app.modules.merit import rules

    today = date(2026, 11, 21)
    base = rules.compute(rules.Facts(), as_of=today)
    lifted = rules.compute(
        rules.Facts(mentor_uplift=rules.MENTOR_UPLIFT_CAP), as_of=today)
    assert lifted.score > base.score
    assert lifted.score < rules.VERIFIED_AT, "a mentor must not carry a stranger past tier one"
    # And the cap holds even if a bad row asks for more.
    greedy = rules.compute(rules.Facts(mentor_uplift=50.0), as_of=today)
    assert greedy.score <= rules.MENTOR_UPLIFT_CAP + 0.001


def test_an_endorsement_is_worth_what_the_endorser_is_worth():
    from app.modules.merit import rules

    assert rules.weighted_endorsement(0) == 0.2
    assert rules.weighted_endorsement(rules.VERIFIED_AT) == 0.6
    assert rules.weighted_endorsement(rules.BLUE_CHIP_AT) == 1.0
    assert rules.weighted_endorsement(0) < rules.weighted_endorsement(100)


def test_many_endorsements_from_nobodies_do_not_equal_one_from_a_record():
    from app.modules.merit import rules

    ten_strangers = rules.damp_weight(10 * 0.2, rules.MAX_ENDORSEMENTS)
    assert ten_strangers < rules.MAX_ENDORSEMENTS * 0.5


def test_the_same_facts_always_give_the_same_score():
    from app.modules.merit import rules

    facts = rules.Facts(movements_completed=12, verified_claims=2, receipt_days=9,
                        endorsements=1.2, endorsers=3, last_activity=date(2026, 11, 1))
    a = rules.compute(facts, as_of=date(2026, 11, 21))
    b = rules.compute(facts, as_of=date(2026, 11, 21))
    assert a.score == b.score
    assert a.input_hash == b.input_hash
    later = rules.compute(facts, as_of=date(2026, 11, 22))
    assert later.input_hash != a.input_hash


def test_the_perks_never_include_money_or_credit():
    from app.modules.merit import rules

    for tier, perks in rules.UNLOCKS.items():
        for perk in perks:
            lowered = perk.lower()
            for forbidden in ("loan", "credit line", "cash", "prize", "draw",
                              "interest", "repay", "payout", "wallet"):
                assert forbidden not in lowered, f"{tier}: {perk}"


def test_discovery_position_is_capped_at_five_percent():
    from app.modules.merit import rules

    assert rules.discovery_weight(rules.VERIFIED_AT - 1) == 0.0, "no record, no nudge"
    assert rules.discovery_weight(rules.VERIFIED_AT) == 0.0
    assert rules.discovery_weight(100) <= 0.05
    assert rules.discovery_weight(60) < rules.discovery_weight(90)


def test_the_report_says_what_it_is_not():
    from app.modules.merit import rules

    text = rules.REPORT_DISCLAIMER.lower()
    assert "not a credit score" in text
    assert "lends none" in text
    assert "holds no funds" in text


def test_ranking_trust_term_is_small_and_bounded():
    from app.modules.outside import ranking

    assert ranking.W_TRUST <= 0.05
    assert ranking.trust_signal(None, {}) == 0.0
    assert ranking.trust_signal("a", {}) == 0.0
    assert ranking.trust_signal("a", {"a": 10}) == 0.0, "below tier one is nothing"
    assert ranking.trust_signal("a", {"a": 100}) == 1.0
    # A perfect record may move an otherwise identical item, but only a little.
    from datetime import datetime
    now = datetime(2026, 11, 21, 12, 0, 0)
    item = {"id": "x", "kind": "listing", "created_at": now, "owner_id": "a"}
    plain = ranking.score_item(item, ranking.RankContext(now=now))
    trusted = ranking.score_item(item, ranking.RankContext(now=now, trust_by_author={"a": 100}))
    assert trusted.score > plain.score
    assert trusted.score - plain.score <= 0.05 + 1e-9


def test_ranking_still_never_reads_a_price():
    from app.modules.outside import ranking

    source = inspect.getsource(ranking)
    for forbidden in ("price_kes", "entry_fee", "budget_kes", "unit_price", "pay_kes"):
        assert forbidden not in source


# ── over HTTP ────────────────────────────────────────────────────────────────

async def _vendor(client, suffix):
    handle = f"mrt_{suffix}"
    r = await client.post("/api/auth/register", json={
        "business_name": f"Merit {suffix[:5]}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["packaging", "supplies"],
        "physical_location": "Kisii town",
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, handle


@pytest.fixture
async def owner(client):
    return await _vendor(client, uuid.uuid4().hex[:8])


@pytest.fixture
async def peer(client):
    return await _vendor(client, uuid.uuid4().hex[:8])


async def test_a_new_business_can_read_its_own_card(client, owner):
    h, handle = owner
    r = await client.get("/api/merit/me", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tier"] == "seed"
    assert body["score"] == 0
    assert body["is_credit"] is False
    assert body["components"], "the card always says why"
    assert body["streak_weeks"] == 0
    assert body["how_to_move_up"]


async def test_the_public_card_needs_no_account(client, owner):
    _, handle = owner
    r = await client.get(f"/api/merit/public/{handle}")
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "seed"
    # And the ticker is a record of readings, not a live price.
    t = await client.get(f"/api/merit/public/{handle}/ticker")
    assert t.status_code == 200
    assert t.json()["points"]


async def test_an_endorsement_needs_a_reason_and_a_name(client, owner, peer):
    h, _ = owner
    p, peer_handle = peer

    too_vague = await client.post("/api/merit/endorsements", json={
        "handle": peer_handle, "reason": "good",
    }, headers=h)
    assert too_vague.status_code == 422

    ok = await client.post("/api/merit/endorsements", json={
        "handle": peer_handle,
        "reason": "Delivered 40 bales on time through the December rush.",
        "context": "supplier",
    }, headers=h)
    assert ok.status_code == 201, ok.text
    assert 0 <= ok.json()["weight"] <= 1

    again = await client.post("/api/merit/endorsements", json={
        "handle": peer_handle, "reason": "Still very good to work with.",
    }, headers=h)
    assert again.status_code == 409, "one business may vouch once"

    self_vouch = await client.post("/api/merit/endorsements", json={
        "handle": h and (await client.get("/api/vendors/me", headers=h)).json()["vendor_handle"],
        "reason": "I am excellent, obviously.",
    }, headers=h)
    assert self_vouch.status_code == 422, "nobody vouches for themselves"

    # The public sees who said it, in their own words.
    public = await client.get(f"/api/merit/public/{peer_handle}/endorsements")
    assert public.status_code == 200
    rows = public.json()["endorsements"]
    assert rows and "December rush" in rows[0]["reason"]
    assert rows[0]["from"]["handle"]


async def test_only_blue_chip_can_mentor(client, owner, peer):
    h, _ = owner
    _, peer_handle = peer
    r = await client.post("/api/merit/mentorships", json={"handle": peer_handle}, headers=h)
    assert r.status_code == 403, r.text
    assert "Blue Chip" in r.json()["detail"]


async def test_the_report_is_the_business_own_and_says_what_it_is_not(client, owner):
    h, handle = owner
    r = await client.get("/api/merit/report", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subject"]["handle"] == handle
    assert body["is_credit_score"] is False
    assert "not a credit score" in body["disclaimer"].lower()
    assert body["score"]["is_credit"] is False
    assert body["facts"]["supplier_orders_delivered"] == 0
    assert body["notes"], "a report with no notes is a number, not a record"


async def test_concierge_is_honest_about_being_closed(client, owner):
    h, _ = owner
    r = await client.get("/api/merit/concierge", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False
    assert "Blue Chip" in body["why"]


async def test_the_snapshot_is_one_row_per_day(client, owner):
    h, _ = owner
    await client.get("/api/merit/me", headers=h)
    await client.get("/api/merit/me", headers=h)
    ticker = await client.get(f"/api/merit/public/{(await client.get('/api/vendors/me', headers=h)).json()['vendor_handle']}/ticker")
    points = ticker.json()["points"]
    assert len(points) == 1, "recomputing must not duplicate the day"

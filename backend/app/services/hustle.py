"""Hustle League service — the derivation engine.

The one rule, enforced structurally: nothing a player "has" is stored that a
row does not already say. XP, level, division, streak, energy and every skill
card tier are computed from hustle_contracts. Gold is the sum of
hustle_gold_ledger. A stored level or balance that a bug — or a well-meaning
grant — could inflate is the exact fake progress this platform refuses to
serve, so those fields do not exist.

The economy is deliberately small and legible:
  * cash (agreed KES on the contract) is the real pay
  * XP is the match score: pay-based + rating bonus
  * Gold is a bonus for showing up: a slice of pay, a daily-first bonus,
    weekly challenges, and squad splits
"""

import datetime as dt
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.hustle import HustleContract, HustleGoldLedger, HustleJobCall, HustleSquadMember
from app.models.vendor import Vendor

# ---------------------------------------------------------------------------
# The 12 hustles, and the minimum a client may pay for each. The floor is
# enforced server-side at post time so gamification can never become
# underpayment: a task with a market rate is never offered below it.
# ---------------------------------------------------------------------------
SKILLS = {
    "cleaner":    {"label": "Cleaner",    "min_wage_kes": 200},
    "fundi":      {"label": "Fundi",      "min_wage_kes": 500},
    "rider":      {"label": "Rider",      "min_wage_kes": 200},
    "tutor":      {"label": "Tutor",      "min_wage_kes": 400},
    "cook":       {"label": "Cook",       "min_wage_kes": 350},
    "digital":    {"label": "Digital",    "min_wage_kes": 300},
    "gardener":   {"label": "Gardener",   "min_wage_kes": 300},
    "mover":      {"label": "Mover",      "min_wage_kes": 400},
    "sitter":     {"label": "Sitter",     "min_wage_kes": 300},
    "shopper":    {"label": "Shopper",    "min_wage_kes": 150},
    "queue":      {"label": "Queue-jumper", "min_wage_kes": 150},
    "errand":     {"label": "Errand",     "min_wage_kes": 150},
}

# Card tiers — a card rises ONLY as real matches in that skill accumulate at
# a real rating. There is no pack, no randomness, no purchase: the tier is a
# query over the player's own completed contracts.
CARD_TIERS = [
    ("legendary", 75, 4.5),
    ("epic",      30, 4.3),
    ("rare",      10, 4.0),
    ("common",     1, 0.0),
]
# Ranking order for "best card": index in this list is the rank.
TIER_ORDER = ["common", "rare", "epic", "legendary"]

# XP is the match score. pay//10 keeps a KES 200 errand worth 20 XP; a 5-star
# rating adds a flat 30 so quality is worth more than volume.
XP_RATING_BONUS = 30

# Level thresholds (cumulative XP) — the "player level" in the card's corner.
LEVELS = [
    (0, "L1"), (100, "L2"), (250, "L3"), (500, "L4"), (1000, "L5"),
    (2000, "L6"), (3500, "L7"), (6000, "L8"), (10000, "L9"), (15000, "L10"),
]

# Divisions are a season standing, derived from cumulative XP. Top of the
# table climbs; nobody is "deleted", they just sit lower until the work says
# otherwise.
DIVISIONS = [
    (10000, "Elite"), (5000, "Gold"), (2000, "Silver"), (750, "Bronze"), (0, "Rookie"),
]

# Energy: a hard, safe daily cap on STARTED contracts. Burnout protection —
# the game will not let a player grind past this without a rest day.
DAILY_SAFE_LIMIT = 4

# Gold: a bonus on top of cash. A slice of pay (10%, min 5) for the match, a
# flat daily-first bonus, weekly challenge payouts, and squad splits.
GOLD_PAY_SLICE = 0.10
GOLD_MIN_MATCH = 5
GOLD_DAILY_FIRST = 25

# Weekly challenges — reset at Monday 00:00. Each is a query over this week's
# completed contracts; the payout is written once per player per week to the
# gold ledger (idempotent on vendor+reason+ref).
WEEKLY_CHALLENGES = [
    ("tasks_3",   "Complete 3 tasks",        3,  40),
    ("tasks_5",   "Complete 5 tasks",        5,  90),
    ("five_star", "Earn a 5-star rating",    1,  30),   # at least one 5★ this week
]


class HustleError(Exception):
    pass


def now_utc() -> dt.datetime:
    return dt.datetime.utcnow()


def week_key(d: dt.datetime) -> str:
    """ISO week, e.g. 2026-W40 — the reset boundary for weekly challenges."""
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def month_key(d: dt.datetime) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def monday_of(d: dt.datetime) -> dt.datetime:
    return dt.datetime(d.year, d.month, d.day) - dt.timedelta(days=d.weekday())


def _level_for(xp: int) -> tuple[str, int, int]:
    """(label, current_threshold, next_threshold_or_None)."""
    label, floor = "L1", 0
    for threshold, lab in LEVELS:
        if xp >= threshold:
            label, floor = lab, threshold
        else:
            break
    next_threshold = None
    for threshold, _lab in LEVELS:
        if xp < threshold:
            next_threshold = threshold
            break
    return label, floor, next_threshold


def _division_for(xp: int) -> str:
    for threshold, name in DIVISIONS:
        if xp >= threshold:
            return name
    return "Rookie"


def _tier_for(completions: int, avg_rating: float) -> str:
    for tier, need, min_avg in CARD_TIERS:
        if completions >= need and avg_rating >= min_avg:
            return tier
    return "common"


async def gold_balance(db: AsyncSession, vendor_id) -> int:
    return (await db.execute(
        select(func.coalesce(func.sum(HustleGoldLedger.amount), 0)).where(HustleGoldLedger.vendor_id == vendor_id)
    )).scalar() or 0


async def completed_contracts(db: AsyncSession, vendor_id, since: Optional[dt.datetime] = None) -> list:
    stmt = select(HustleContract).where(
        HustleContract.player_vendor_id == vendor_id,
        HustleContract.status == "completed",
    )
    if since:
        stmt = stmt.where(HustleContract.completed_at >= since)
    return (await db.execute(stmt)).scalars().all()


async def _active_contract(db: AsyncSession, vendor_id) -> Optional[HustleContract]:
    """A player may hold one live contract at a time — the energy model is
    'finish what you took', not 'stack ten and grind'."""
    return (await db.execute(
        select(HustleContract).where(
            HustleContract.player_vendor_id == vendor_id,
            HustleContract.status.in_(["accepted", "in_progress"]),
        ).order_by(HustleContract.accepted_at.desc()).limit(1)
    )).scalar_one_or_none()


def streak_from(completed: list) -> int:
    """Consecutive days with ≥1 completed match, walking back from the most
    recent active day. A streak broken today still shows its final length."""
    day_set = {c.completed_at.date() for c in completed if c.completed_at}
    if not day_set:
        return 0
    streak, cur = 0, max(day_set)
    while cur in day_set:
        streak += 1
        cur -= dt.timedelta(days=1)
    return streak


async def player_snapshot(db: AsyncSession, vendor: Vendor) -> dict:
    """Everything the player card shows, derived from rows on every call."""
    done = await completed_contracts(db, vendor.id)
    total_xp = sum(c.xp_earned for c in done)

    # Per-skill card tiers, straight from the completed matches. One bulk
    # fetch for the calls — the player card is the first screen and must not
    # do one query per past match.
    by_skill: dict[str, list] = {}
    if done:
        call_rows = (await db.execute(
            select(HustleJobCall).where(HustleJobCall.id.in_([c.job_call_id for c in done]))
        )).scalars().all()
        calls_by_id = {c.id: c for c in call_rows}
        for c in done:
            call = calls_by_id.get(c.job_call_id)
            if call:
                by_skill.setdefault(call.skill, []).append(c)
    cards = []
    for skill, cons in sorted(by_skill.items()):
        ratings = [c.client_rating for c in cons if c.client_rating]
        avg = (sum(ratings) / len(ratings)) if ratings else 0.0
        cards.append({
            "skill": skill,
            "label": SKILLS.get(skill, {}).get("label", skill),
            "tier": _tier_for(len(cons), avg),
            "completions": len(cons),
            "avg_rating": round(avg, 2),
        })

    # Weekly challenge progress.
    wk_start = monday_of(now_utc())
    this_week = [c for c in done if c.completed_at and c.completed_at >= wk_start]
    five_star = [c for c in this_week if (c.client_rating or 0) >= 5]
    challenges = []
    for key, label, need, payout in WEEKLY_CHALLENGES:
        met = (len(five_star) >= need) if key == "five_star" else (len(this_week) >= need)
        # Has the payout already been written this week?
        granted = (await db.execute(
            select(HustleGoldLedger.id).where(
                HustleGoldLedger.vendor_id == vendor.id,
                HustleGoldLedger.reason == "challenge",
                HustleGoldLedger.ref == f"{week_key(now_utc())}:{key}",
            ).limit(1)
        )).first()
        challenges.append({"key": key, "label": label, "need": need,
                           "have": len(five_star) if key == "five_star" else len(this_week),
                           "payout": payout, "met": met, "granted": bool(granted)})

    # Energy: contracts started today vs the safe cap.
    today = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    started_today = (await db.execute(
        select(func.count(HustleContract.id)).where(
            HustleContract.player_vendor_id == vendor.id,
            HustleContract.started_at >= today,
        )
    )).scalar() or 0

    level, level_floor, level_next = _level_for(total_xp)
    return {
        "vendor_id": str(vendor.id),
        "name": vendor.business_name,
        "handle": vendor.vendor_handle,
        "xp": total_xp,
        "level": level,
        "level_progress": (
            {"floor": level_floor, "next": level_next,
             "pct": 0 if level_next is None else min(100, round((total_xp - level_floor) / max(1, level_next - level_floor) * 100))}
        ),
        "division": _division_for(total_xp),
        "monthly_points": sum(c.xp_earned for c in done if c.completed_at and month_key(c.completed_at) == month_key(now_utc())),
        "streak": streak_from(done),
        "gold": await gold_balance(db, vendor.id),
        "energy": {"used": started_today, "limit": DAILY_SAFE_LIMIT,
                   "rest_today": started_today >= DAILY_SAFE_LIMIT},
        "cards": cards,
        "best_card": max(cards, key=lambda c: TIER_ORDER.index(c["tier"])) if cards else None,
        "active_contract": None,  # filled by caller when a live contract exists
        "challenges": challenges,
        "week": week_key(now_utc()),
    }


async def _grant(db: AsyncSession, vendor_id, amount: int, reason: str, ref: str) -> bool:
    """Write one gold row; the unique constraint makes it idempotent."""
    amount = int(round(amount))
    if amount <= 0:
        return False
    existing = (await db.execute(
        select(HustleGoldLedger.id).where(
            HustleGoldLedger.vendor_id == vendor_id,
            HustleGoldLedger.reason == reason,
            HustleGoldLedger.ref == ref,
        ).limit(1)
    )).first()
    if existing:
        return False
    db.add(HustleGoldLedger(vendor_id=vendor_id, amount=amount, reason=reason, ref=ref))
    await db.flush()
    return True


async def award_on_completion(db: AsyncSession, contract: HustleContract) -> dict:
    """Write the real gold for a completed match: the pay slice, the
    daily-first bonus, any weekly challenges it unlocked, and the squad
    split. Returns a summary of what actually landed."""
    call = await db.get(HustleJobCall, contract.job_call_id)
    player = contract.player_vendor_id
    gained = 0

    # 1) The match slice — a small bonus on top of the cash the client pays.
    slice_gold = max(GOLD_MIN_MATCH, int(contract.agreed_pay_kes * GOLD_PAY_SLICE))
    if await _grant(db, player, slice_gold, "completion", str(contract.id)):
        gained += slice_gold

    # 2) Daily-first bonus — once per calendar day, on the day's first finish.
    day = (contract.completed_at or now_utc()).date()
    day_start = dt.datetime(day.year, day.month, day.day)
    already_first = (await db.execute(
        select(HustleGoldLedger.id).where(
            HustleGoldLedger.vendor_id == player,
            HustleGoldLedger.reason == "daily_first",
            HustleGoldLedger.created_at >= day_start,
        ).limit(1)
    )).first()
    if not already_first:
        if await _grant(db, player, GOLD_DAILY_FIRST, "daily_first", f"day:{day.isoformat()}"):
            gained += GOLD_DAILY_FIRST

    # 3) Weekly challenges this match may have unlocked.
    if call:
        wk_start = monday_of(now_utc())
        this_week = await completed_contracts(db, player, since=wk_start)
        for key, label, need, payout in WEEKLY_CHALLENGES:
            met = (any((c.client_rating or 0) >= 5 for c in this_week)) if key == "five_star" else (len(this_week) >= need)
            if met:
                if await _grant(db, player, payout, "challenge", f"{week_key(now_utc())}:{key}"):
                    gained += payout

    # 4) Squad split — a slice of the pay shared with the worker's squad.
    squad_split_to = 0
    if call and call.squad_id:
        members = (await db.execute(
            select(HustleSquadMember).where(HustleSquadMember.squad_id == call.squad_id)
        )).scalars().all()
        others = [m for m in members if m.vendor_id != player]
        if others:
            pool = int(contract.agreed_pay_kes * 0.10)  # 10% of pay feeds the squad bank
            total_pct = max(1, sum(m.split_pct for m in others))
            for m in others:
                share = max(1, pool * m.split_pct // total_pct)
                if await _grant(db, m.vendor_id, share, "squad_split", f"{contract.id}:{m.vendor_id}"):
                    squad_split_to += share

    contract.gold_earned = slice_gold
    await db.flush()
    return {"gold": gained, "squad_split": squad_split_to}

"""Merit rules: every number, in one pure file.

The brief asked for verified behaviour to become the currency. That only works
if the arithmetic is boring enough to check by hand, so nothing here reads the
database, the clock, or a setting. You hand it facts; it hands back a score and
the sentences that explain it. `compute()` on the same facts always returns the
same figure and the same `input_hash`, today and in a year.

Six things are deliberately true, and each one is defended below:

1. **No single column owns the score.** Six evidence families, each with a hard
   cap, and the biggest is 30 of 100. A business cannot buy, spike or spam its
   way to the top with one kind of activity.

2. **Our money is not in it.** No fee, plan, subscription, tier purchase or
   payment of any kind is an input. `paid` does not appear in this file except
   in the sentence that says so. (See `test_merit.py`.)

3. **Nothing is a reputation guess.** There is no machine-learned score, no
   opaque weight an operator can nudge, and no "reliability" verdict. Every
   component is a count of something that happened, or a ratio of two counts.

4. **Decay is shown, not applied silently.** Going quiet halves your visible
   score every ``DECAY_HALF_LIFE_DAYS`` and never drops it below
   ``DECAY_FLOOR``. The raw record is never destroyed; a returning business
   comes back to the score it earned.

5. **Streaks are not score.** A streak is a *fact* — consecutive active weeks —
   and it unlocks cheap perks. It is not points, because "log in for 30 days"
   is the easiest thing in the world to fake and the brief correctly wanted
   consistency rewarded without one-day spikes.

6. **A mentor can lift a newcomer, but only a little.** Mentoring pays the
   mentor; the newcomer gets at most ``MENTOR_UPLIFT_CAP`` points, which cannot
   reach the second tier on its own. Alleviation must not be a shortcut to
   looking verified.

Tiers are labels over the same score, never a separate score:

    seed        < 20          new, or mostly unproven
    verified    >= 20         enough recorded evidence to take a chance on
    blue_chip   >= 50 *and*   two or more independent evidence families
                >= 2 families

The two-family rule is what stops a business with 40 verified documents and
nothing else from being called Blue Chip. Evidence has to agree with itself.

Money note, again, because it is the whole reason this module exists: a Trust
Score is **not collateral, not a balance, and not a promise of credit**. It is a
count of things a business did, published so that a bank or a SACCO can read it
and make its own decision, with its own underwriting, its own regulator and its
own money. Brief lends nothing and holds nothing.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date
from typing import Optional, Sequence

#: Bumping this changes every score. Kept with the hash so an old report can
#: always be explained by the rules of the day it was made.
TRUST_VERSION = "merit-1"

# ── the six families, and their ceilings ─────────────────────────────────────
# The caps sum to 100 so the score reads as a percentage of the maximum.
MAX_FULFILMENT = 30.0
MAX_VERIFICATION = 25.0
MAX_RECEIPTS = 15.0
MAX_PRICE_WORK = 10.0
MAX_ENDORSEMENTS = 10.0
MAX_MENTORING = 10.0
MAX_TOTAL = (MAX_FULFILMENT + MAX_VERIFICATION + MAX_RECEIPTS + MAX_PRICE_WORK
             + MAX_ENDORSEMENTS + MAX_MENTORING)  # 100

#: Family keys, in the order the card shows them.
FAMILIES = ("fulfilment", "verification", "receipts", "price_work",
            "endorsements", "mentoring")

#: A family counts toward Blue Chip once it has this share of its own ceiling.
#: A single fulfilment row should not count as "this business does business".
FAMILY_COUNTS_AT = 0.25

# ── decay ────────────────────────────────────────────────────────────────────
#: Visible score halves for every this many quiet days. Ten weeks of silence is
#: a season, which is long enough that a business is not punished for a slow
#: month and short enough that a dormant account does not outrank a live one.
DECAY_HALF_LIFE_DAYS = 90.0
#: …but never below this share of the earned score. The record is not deleted
#: for being quiet; being quiet is not misconduct. The floor is what makes the
#: sentence honest: "your record is intact, it is only partly hidden".
DECAY_FLOOR = 0.40

# ── evidence damping ─────────────────────────────────────────────────────────
#: Counting is log-damped, so the tenth delivery matters less than the second
#: and the hundredth barely moves the needle. Without this, age always wins.
DAMPING = 3.0

#: A supplier's fulfilment ratio is smoothed toward 0.5 until there is enough
#: history to be sure. Two perfect deliveries is not a 100% record.
FULFILMENT_PRIOR_SUCCESSES = 1.0
FULFILMENT_PRIOR_TRIALS = 2.0

# ── tiers ────────────────────────────────────────────────────────────────────
TIER_SEED = "seed"
TIER_VERIFIED = "verified"
TIER_BLUE_CHIP = "blue_chip"
TIERS = (TIER_SEED, TIER_VERIFIED, TIER_BLUE_CHIP)
TIER_LABELS = {
    TIER_SEED: "Seed",
    TIER_VERIFIED: "Verified",
    TIER_BLUE_CHIP: "Blue Chip",
}
VERIFIED_AT = 20.0
BLUE_CHIP_AT = 50.0
BLUE_CHIP_MIN_FAMILIES = 2

# ── mentoring ────────────────────────────────────────────────────────────────
#: What a mentee can gain from being taken on, in total, for ever.
MENTOR_UPLIFT_CAP = 8.0
#: What one mentee's milestone is worth to the mentor.
MENTOR_AWARD_PER_MILESTONE = 2.5
MAX_MENTORING_AWARDS = 4

# ── what a tier unlocks ──────────────────────────────────────────────────────
#: Every perk here costs Brief nothing to give and takes nothing from anyone
#: else. That is the test a perk has to pass before it is listed.
#:
#: NOT in this list, on purpose: cash, credit, a loan, a discount funded by us,
#: a prize, a draw, or anything that could be read as a financial product.
UNLOCKS = {
    TIER_SEED: (
        "A public page and offers on the shelf",
    ),
    TIER_VERIFIED: (
        "Discovery position in its own area (see `discovery_weight`)",
        "The verified mark on the public page",
        "A bank-ready Pattern Report, exportable as PDF or JSON",
    ),
    TIER_BLUE_CHIP: (
        "Concierge: priority matching with bulk buyers and event organisers",
        "The right to mentor a newcomer and earn trust for it",
        "Invitations to Brief's own buying rounds, where places are limited",
    ),
}


class MeritError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ── the facts ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Facts:
    """Everything the score is allowed to know. All counts, no opinions.

    Every field is optional and defaults to zero/None, so a brand-new business
    computes cleanly instead of raising. Missing evidence is zero, never a
    penalty: not having done a thing is not the same as having failed at it.
    """

    # fulfilment, as a supplier: a movement is `received` when it arrived
    movements_completed: int = 0
    movements_cancelled: int = 0
    # fulfilment, as a buyer: a buyer who cancels a lot is not reliable either,
    # but this is a light touch — the buyer is not the one being trusted to deliver
    buyer_cancellations: int = 0

    verified_claims: int = 0          # standing claims a human verified
    verified_branches: int = 0        # shops a human checked

    receipt_days: int = 0             # distinct days with a verified receipt
    receipt_verified: int = 0         # receipts verified against the till

    price_accepted: int = 0           # accepted price observations, 90 days

    endorsements: float = 0.0         # pre-weighted by endorser tier
    endorsers: int = 0

    mentoring_awards: int = 0         # mentees who hit a consistency milestone
    mentor_uplift: float = 0.0        # given to a mentee; capped, never bought

    # dates, for decay and history
    last_activity: Optional[date] = None
    first_activity: Optional[date] = None

    # a separate fact, not part of the score (see rule 5 in the module docstring)
    active_week_streak: int = 0


@dataclass
class Component:
    key: str
    label: str
    points: float
    max_points: float
    reason: str
    counts_as_family: bool = False

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "points": round(self.points, 2),
            "max_points": self.max_points,
            "reason": self.reason,
            "counts_as_family": self.counts_as_family,
        }


@dataclass
class Merit:
    """A computed score and everything needed to argue with it."""

    score: float
    score_earned: float
    tier: str
    tier_label: str
    next_tier: Optional[str]
    points_to_next: Optional[float]
    decay: float
    quiet_days: Optional[int]
    families: int
    components: list = field(default_factory=list)
    version: str = TRUST_VERSION
    input_hash: str = ""
    unlocks: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "score": round(self.score, 2),
            "score_earned": round(self.score_earned, 2),
            "max_score": MAX_TOTAL,
            "tier": self.tier,
            "tier_label": self.tier_label,
            "next_tier": self.next_tier,
            "points_to_next": None if self.points_to_next is None else round(self.points_to_next, 1),
            "decay": round(self.decay, 3),
            "quiet_days": self.quiet_days,
            "families": self.families,
            "components": [c.as_dict() for c in self.components],
            "unlocks": self.unlocks,
            "version": self.version,
            "input_hash": self.input_hash,
            # Said on every payload, so no client can present this as credit.
            "is_credit": False,
            "note": (
                "A Trust Score is a count of things this business did, published so "
                "anyone can check it. It is not money, not collateral, and not a "
                "promise of credit. Brief lends nothing."
            ),
        }


# ── maths ────────────────────────────────────────────────────────────────────

def damp(count: int, ceiling: float) -> float:
    """Log-damped credit for a count, reaching `ceiling` asymptotically.

    0 → 0, 1 → about a third of the ceiling, and the hundredth unit adds
    almost nothing. Monotonic and never negative.
    """
    count = max(int(count or 0), 0)
    if count <= 0 or ceiling <= 0:
        return 0.0
    import math
    return min(ceiling * math.log1p(count) / math.log1p(DAMPING * 4), ceiling)


def fulfilment_ratio(completed: int, cancelled: int) -> float:
    """Smoothed success rate. Starts at 0.5 and moves only as evidence builds."""
    completed = max(int(completed or 0), 0)
    cancelled = max(int(cancelled or 0), 0)
    return (completed + FULFILMENT_PRIOR_SUCCESSES) / (
        completed + cancelled + FULFILMENT_PRIOR_TRIALS
    )


def decay_factor(quiet_days: Optional[int]) -> float:
    """How much of the earned score is visible after a quiet spell."""
    if quiet_days is None or quiet_days <= 0:
        return 1.0
    factor = 0.5 ** (quiet_days / DECAY_HALF_LIFE_DAYS)
    return max(factor, DECAY_FLOOR)


def tier_for(score: float, families: int) -> str:
    if score >= BLUE_CHIP_AT and families >= BLUE_CHIP_MIN_FAMILIES:
        return TIER_BLUE_CHIP
    if score >= VERIFIED_AT:
        return TIER_VERIFIED
    return TIER_SEED


def discovery_weight(score: float) -> float:
    """How much a *non-partner* item from this author may be boosted.

    Capped at 0.05 — five per cent of the relevance range — and it starts at
    zero. Two reasons for that ceiling: a discovery boost must never be able to
    reorder a shelf on its own, and trust must never become something a business
    can be *sold* by us later, which a bigger number would invite.

    It is also bounded below by evidence: the boost only exists once a business
    is past the first tier.
    """
    if score < VERIFIED_AT:
        return 0.0
    span = max(MAX_TOTAL - VERIFIED_AT, 1.0)
    return round(min(0.05, 0.05 * (score - VERIFIED_AT) / span), 4)


# ── the computation ──────────────────────────────────────────────────────────

def compute(facts: Facts, *, as_of: date) -> Merit:
    """Score one business on one day. Pure; see the module docstring."""
    components: list[Component] = []

    # 1. Fulfilment. Ratio × volume: one perfect delivery is not a record, and
    # 400 deliveries with 200 cancellations is not a good one either.
    ratio = fulfilment_ratio(facts.movements_completed, facts.movements_cancelled)
    volume = damp(facts.movements_completed, MAX_FULFILMENT)
    fulfilment_points = volume * ratio
    # A buyer who cancels repeatedly is a real cost to suppliers, so it shaves
    # the family rather than being ignored. Bounded at a fifth of the family.
    buyer_penalty = min(0.2, 0.02 * max(facts.buyer_cancellations, 0)) * MAX_FULFILMENT
    fulfilment_points = max(0.0, fulfilment_points - buyer_penalty)
    if facts.movements_completed or facts.movements_cancelled:
        reason = (
            f"{facts.movements_completed} orders delivered"
            f"{f', {facts.movements_cancelled} cancelled' if facts.movements_cancelled else ''}"
            f" · {round(ratio * 100)}% of finished orders arrived"
        )
    else:
        reason = "No completed supplier orders yet."
    if buyer_penalty:
        reason += f" · {facts.buyer_cancellations} cancelled as a buyer"
    components.append(Component(
        "fulfilment", "Delivered what was promised", fulfilment_points,
        MAX_FULFILMENT, reason,
    ))

    # 2. Verification. Only a *human* check counts; a declared document is not
    # evidence and never appears here.
    checks = facts.verified_claims + facts.verified_branches
    verification_points = damp(checks, MAX_VERIFICATION)
    components.append(Component(
        "verification", "Checked by a person",
        verification_points, MAX_VERIFICATION,
        (f"{checks} document{'s' if checks != 1 else ''} or shop{'s' if checks != 1 else ''} "
         f"independently checked" if checks else "Nothing checked yet."),
    ))

    # 3. Receipts. Days, not receipts: ten receipts in one afternoon is a shop
    # trip, ten days is a business.
    receipt_points = damp(facts.receipt_days, MAX_RECEIPTS)
    components.append(Component(
        "receipts", "Kept its receipts",
        receipt_points, MAX_RECEIPTS,
        (f"{facts.receipt_days} separate days of verified receipts"
         if facts.receipt_days else "No verified receipts yet."),
    ))

    # 4. Price work. The paid task, counted the same way for everybody.
    price_points = damp(facts.price_accepted, MAX_PRICE_WORK)
    components.append(Component(
        "price_work", "Helped the town's price list",
        price_points, MAX_PRICE_WORK,
        (f"{facts.price_accepted} accepted price observations in the last 90 days"
         if facts.price_accepted else "No accepted price observations yet."),
    ))

    # 5. Endorsements. Pre-weighted by who said it: a Blue Chip's word is worth
    # more than a stranger's, and ten strangers cannot equal one.
    endorsement_points = min(MAX_ENDORSEMENTS, max(facts.endorsements, 0.0))
    components.append(Component(
        "endorsements", "Vouched for by people with a record",
        endorsement_points, MAX_ENDORSEMENTS,
        (f"{facts.endorsers} business{'es' if facts.endorsers != 1 else ''} vouched for it"
         if facts.endorsers else "Nobody has vouched for it yet."),
    ))

    # 6. Mentoring. Paid to the mentor; the mentee's own uplift is separate and
    # capped, so mentoring is never a shortcut to looking verified.
    awards = min(facts.mentoring_awards, MAX_MENTORING_AWARDS)
    mentoring_points = min(MAX_MENTORING, awards * MENTOR_AWARD_PER_MILESTONE)
    components.append(Component(
        "mentoring", "Brought someone along",
        mentoring_points, MAX_MENTORING,
        (f"{awards} mentee{'s' if awards != 1 else ''} kept it up long enough to count"
         if awards else "Not mentoring anyone yet."),
    ))

    earned = sum(c.points for c in components)

    # The mentee's uplift is added after the family caps, and is itself capped,
    # so it can lift a newcomer toward the first tier without ever carrying them
    # to the second.
    uplift = min(max(facts.mentor_uplift, 0.0), MENTOR_UPLIFT_CAP)
    if uplift:
        components.append(Component(
            "mentor_uplift", "Learning from someone with a record",
            uplift, MENTOR_UPLIFT_CAP,
            f"A mentor took this business on: +{round(uplift, 1)} (capped, and not earned back twice)",
        ))
        earned += uplift

    earned = min(earned, MAX_TOTAL)

    # Decay is applied to the total and reported, never hidden.
    quiet = None
    if facts.last_activity is not None:
        quiet = max((as_of - facts.last_activity).days, 0)
    factor = decay_factor(quiet)
    visible = earned * factor

    # A family "counts" only once it is a real share of its own ceiling.
    families = sum(
        1 for c in components
        if c.key in FAMILIES and c.max_points > 0
        and c.points >= c.max_points * FAMILY_COUNTS_AT
    )

    tier = tier_for(visible, families)
    if tier == TIER_BLUE_CHIP:
        next_tier = None
        to_next = None
    elif tier == TIER_VERIFIED:
        next_tier = TIER_BLUE_CHIP
        to_next = max(BLUE_CHIP_AT - visible, 0.0)
    else:
        next_tier = TIER_VERIFIED
        to_next = max(VERIFIED_AT - visible, 0.0)

    # The hash covers the inputs and the output, so a report can be re-derived
    # and compared years later. Sorted, so dict order cannot change it.
    digest = hashlib.sha256(
        repr((
            TRUST_VERSION, as_of.isoformat(),
            tuple(sorted((k, v) for k, v in facts.__dict__.items() if k != "last_activity")),
            round(visible, 4), tier,
        )).encode()
    ).hexdigest()

    return Merit(
        score=visible,
        score_earned=earned,
        tier=tier,
        tier_label=TIER_LABELS[tier],
        next_tier=next_tier,
        points_to_next=to_next,
        decay=factor,
        quiet_days=quiet,
        families=families,
        components=components,
        input_hash=digest,
        unlocks=list(UNLOCKS[tier]),
    )


# ── what a report may and may not claim ──────────────────────────────────────

#: The line that has to appear on every exported report. A bank reading a
#: Pattern Report has to know exactly what it is and is not.
REPORT_DISCLAIMER = (
    "This report is a record of completed activity on Brief. It is not a credit "
    "score, not a guarantee of repayment, and not an endorsement by Brief of any "
    "borrowing. Brief holds no funds and lends none. The reader makes its own "
    "decision under its own licence."
)


def report_notes(facts: Facts, merit: Merit) -> list[str]:
    """Plain sentences a lender can act on, and cannot misread."""
    notes = [
        f"{facts.movements_completed} supplier orders delivered, "
        f"{facts.movements_cancelled} cancelled, from "
        f"{facts.first_activity.isoformat() if facts.first_activity else 'no recorded start'}.",
        f"{facts.verified_claims + facts.verified_branches} documents or shops "
        f"independently checked by a person.",
        f"{facts.receipt_days} separate days of verified purchase receipts.",
        f"Last recorded activity: "
        f"{facts.last_activity.isoformat() if facts.last_activity else 'none'}.",
        f"Trust Score {round(merit.score, 1)} of {MAX_TOTAL:g} "
        f"({merit.tier_label}), computed with rules version {merit.version} "
        f"and hash {merit.input_hash[:16]}.",
    ]
    if merit.decay < 1.0:
        notes.append(
            f"The visible score is {round(merit.decay * 100)}% of the earned score "
            f"because the business has been quiet for {merit.quiet_days} days. "
            "The underlying record is unchanged."
        )
    return notes


def endpoint_of_tier(tier: str) -> dict:
    """What the tier means, for the public page's own words."""
    return {
        "tier": tier,
        "label": TIER_LABELS.get(tier, tier),
        "unlocks": list(UNLOCKS.get(tier, ())),
    }


def damp_weight(total: float, ceiling: float) -> float:
    """Damp raw endorsement weight toward a ceiling.

    Separate from `damp()` because the input is a sum of weights, not a count,
    and the tenth endorsement should still be worth less than the second.
    """
    total = max(float(total or 0.0), 0.0)
    if total <= 0 or ceiling <= 0:
        return 0.0
    import math
    return min(ceiling * math.log1p(total) / math.log1p(DAMPING * 4), ceiling)


def weighted_endorsement(endorser_score: float) -> float:
    """How much one endorsement is worth, by the endorser's own tier.

    An unproven account's word is worth a fifth of a Blue Chip's. This is the
    whole anti-ring defence: recruiting strangers is worth almost nothing, so
    the only cheap way to build endorsements is to do business people respect.
    """
    if endorser_score >= BLUE_CHIP_AT:
        return 1.0
    if endorser_score >= VERIFIED_AT:
        return 0.6
    return 0.2


def streak_weeks(active_days: Sequence[date], *, as_of: date) -> int:
    """Consecutive weeks with at least one active day, counting back from today.

    Week 0 is the seven days ending on `as_of`; week 1 the seven before that.
    A gap ends the count — this is a streak, not a total, and that is the point:
    it rewards keeping at it rather than one good month.
    """
    offsets = {(as_of - d).days for d in active_days if d <= as_of}
    streak = 0
    while True:
        start_of_week = streak * 7
        if not any(start_of_week <= offset <= start_of_week + 6 for offset in offsets):
            return streak
        streak += 1


def streak_perks(streak: int) -> list[str]:
    """Cheap things a streak unlocks. None of them is money."""
    perks = []
    if streak >= 4:
        perks.append("A month of uninterrupted weeks: your page is listed as 'active this month'")
    if streak >= 12:
        perks.append("A quarter of consistent weeks: first refusal on concierge introductions")
    return perks

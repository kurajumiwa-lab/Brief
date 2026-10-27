"""The Balanced Verdict, on the server.

This is a deliberate line-by-line port of ``caesar/src/lib/ranking.js``. The
prototype proved the rules; a layer of Brief has to *enforce* them, and a feed
sorted by the client is a feed the client can lie about.

Everything here is pure: no database, no request, no clock of its own. The
caller passes `now_ms`. That is what makes the ranking testable, and it is why
this module can land before any table exists.

Two rules are structural rather than configurable, because they are the product:

  · **Ranking decides order, never existence.** Nothing here returns a shorter
    list than it was given. Visibility belongs to blocks, mutes and moderation —
    see ``visible_posts`` for the only three legitimate causes.
  · **Disagreement cannot bury a post.** A contested post is floored at
    ``RANKING["contested_floor"]`` so it stays visible and labelled. It is not
    promoted; it is protected from being erased by a majority.

Constants are identical to the JavaScript ones and a parity test pins that
(``tests/test_verdict.py`` asserts the same fixtures through both
implementations). If the weights ever need to move, they move in both places in
the same commit — or the test fails, which is the point.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence

# ── published constants ───────────────────────────────────────────────────────
# The interface prints these, so they are not a private dial.
RANKING: Mapping[str, Any] = {
    "weights": {"confidence": 0.5, "participation": 0.2, "recency": 0.15, "circle": 0.15},
    # Reaction volume stops earning credit past this many weighted reactions.
    "participation_cap": 40,
    # A post is contested at this much participation…
    "contested_min_reactions": 8,
    # …and this share of it disagreeing.
    "contested_dissent_share": 0.34,
    # Contested posts never fall below this, whatever their support. A quarter
    # is deliberately small: the promise is that disagreement cannot push a post
    # to the bottom of the feed *by itself*, not that an unpopular view gets a
    # good score. It stays visible and labelled; it does not get promoted.
    "contested_floor": 0.25,
    "half_life_hours": 12,
    "burst_window_ms": 60_000,
    "burst_share": 0.3,
    "burst_min_count": 5,
    "burst_damping": 0.5,
    # An account outside a circle still counts, at this fraction.
    "outsider_weight": 0.7,
    # A brand-new account counts at this fraction until it has history.
    "new_account_weight": 0.85,
    # A post outside the viewer's circles still ranks, at this circle fit.
    "outside_circle_fit": 0.35,
}

# A post is visible for exactly these reasons. No reaction count appears, and
# none may be added: the day a downvote can hide a post, the product is dead.
VISIBILITY_CAUSES = ("removed_by_moderation", "author_blocked", "author_muted")


# ── small helpers ─────────────────────────────────────────────────────────────


def _pick(mapping: Mapping[str, Any] | None, *names: str, default: Any = None) -> Any:
    """Read a key from either snake_case or the client's camelCase.

    The prototype speaks camelCase in JSON and this module speaks Python. Rather
    than force a translation layer whose bugs would be invisible, both are read
    here — one place, one rule.
    """
    if not mapping:
        return default
    for name in names:
        if name in mapping:
            return mapping[name]
        camel = "".join(word if i == 0 else word.capitalize() for i, word in enumerate(name.split("_")))
        if camel in mapping:
            return mapping[camel]
    return default


def _js_round(value: float) -> int:
    """JavaScript's ``Math.round``: halves go toward +infinity, not to even."""
    return int(math.floor(value + 0.5))


def _round(value: float, places: int = 3) -> float:
    factor = 10**places
    return _js_round(value * factor) / factor


def _clamp01(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number):
        return 0.0
    return min(1.0, max(0.0, number))


def _to_ms(value: Any) -> float:
    """Epoch milliseconds from a number, a datetime, or an ISO string."""
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return moment.timestamp() * 1000.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        return _to_ms(parsed)
    return 0.0


# ── the arithmetic ────────────────────────────────────────────────────────────


def wilson_lower(support: int, total: int, z: float = 1.96) -> float:
    """Wilson score interval, lower bound. 95% confidence.

    The standard "how sure can we be, given this many observations" estimator —
    and the reason two unanimous reactions cannot claim 100%.
    """
    if not total or total <= 0:
        return 0.0
    p = support / total
    z2 = z * z
    denominator = 1 + z2 / total
    centre = p + z2 / (2 * total)
    margin = z * math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
    return _clamp01((centre - margin) / denominator)


def burst_window(
    reactions: Sequence[Mapping[str, Any]] = (),
    *,
    window_ms: int = RANKING["burst_window_ms"],
    share: float = RANKING["burst_share"],
    min_count: int = RANKING["burst_min_count"],
) -> dict[str, Any]:
    """The largest cluster of reactions inside one window, if it looks coordinated.

    Returns the ids of that cluster. Nothing is deleted and nobody is banned:
    the caller damps those reactions' weight and the panel says so.
    """
    ordered = sorted(reactions, key=lambda reaction: _to_ms(_pick(reaction, "at")))
    best_ids: list[str] = []

    for start, first in enumerate(ordered):
        from_ms = _to_ms(_pick(first, "at"))
        ids: list[str] = []
        for later in ordered[start:]:
            if _to_ms(_pick(later, "at")) - from_ms > window_ms:
                break
            ids.append(str(_pick(later, "id", default=f"{_pick(later, 'user_id')}:{_to_ms(_pick(later, 'at'))}")))
        if len(ids) > len(best_ids):
            best_ids = ids

    total = len(ordered)
    suspected = total >= min_count and len(best_ids) >= max(min_count, math.ceil(total * share))
    return {
        "suspected": suspected,
        "count": len(best_ids),
        "total": total,
        "share": (len(best_ids) / total) if total else 0.0,
        "ids": set(best_ids) if suspected else set(),
    }


def compute_verdict(
    post: Mapping[str, Any] | None,
    *,
    users_by_id: Mapping[str, Mapping[str, Any]] | None = None,
    circle_member_ids: set[str] | None = None,
    now_ms: float | None = None,
) -> dict[str, Any]:
    """Everything the Verdict panel needs about one post's community feedback."""
    users_by_id = users_by_id or {}
    now = _to_ms(now_ms) if now_ms is not None else _to_ms(datetime.now(timezone.utc))
    reactions = list(_pick(post or {}, "reactions", default=[]) or [])
    burst = burst_window(reactions)

    up = 0
    down = 0
    weighted_up = 0.0
    weighted_down = 0.0

    for reaction in reactions:
        reaction_id = _pick(reaction, "id", default=f"{_pick(reaction, 'user_id')}:{_to_ms(_pick(reaction, 'at'))}")
        user_id = _pick(reaction, "user_id")
        user = users_by_id.get(user_id) if user_id is not None else None

        # Account standing: a newcomer's first reaction is worth a little less
        # than an established member's, and an outsider's a little less again.
        reactions_given = _pick(user, "reactions_given", default=0) if user else 0
        standing = 1.0 if (user and (reactions_given or 0) >= 3) else RANKING["new_account_weight"]
        in_circle = circle_member_ids is None or user_id in circle_member_ids
        place = 1.0 if in_circle else RANKING["outsider_weight"]
        damping = RANKING["burst_damping"] if str(reaction_id) in burst["ids"] else 1.0
        weight = standing * place * damping

        if _pick(reaction, "value") == "up":
            up += 1
            weighted_up += weight
        else:
            down += 1
            weighted_down += weight

    participation = up + down
    weighted_participation = weighted_up + weighted_down
    agreement = (up / participation) if participation else 0.0
    confidence = wilson_lower(up, participation)
    dissent_share = (down / participation) if participation else 0.0
    contested = (
        participation >= RANKING["contested_min_reactions"]
        and dissent_share >= RANKING["contested_dissent_share"]
    )

    return {
        "up": up,
        "down": down,
        "participation": participation,
        "weighted_up": _round(weighted_up),
        "weighted_down": _round(weighted_down),
        "weighted_participation": _round(weighted_participation),
        "agreement": agreement,
        "confidence": confidence,
        "dissent_share": dissent_share,
        "contested": contested,
        "coordination": {
            "suspected": burst["suspected"],
            "count": burst["count"],
            "total": burst["total"],
            "share": burst["share"],
            "factor": RANKING["burst_damping"] if burst["suspected"] else 1.0,
        },
        # How much of the sample is still missing before confidence settles.
        "needs_more_voices": participation < RANKING["contested_min_reactions"],
        "at": now,
    }


def score_post(
    post: Mapping[str, Any],
    *,
    verdict: Mapping[str, Any] | None = None,
    viewer_circle_ids: set[str] | None = None,
    now_ms: float | None = None,
) -> dict[str, Any]:
    """One post's rank, plus the exact parts that produced it."""
    viewer_circle_ids = viewer_circle_ids or set()
    now = _to_ms(now_ms) if now_ms is not None else _to_ms(datetime.now(timezone.utc))
    computed = verdict or compute_verdict(post, now_ms=now)

    age_hours = max(0.0, (now - _to_ms(_pick(post, "created_at"))) / 3_600_000)

    confidence = _clamp01(computed["confidence"])
    participation = _clamp01(
        math.log1p(computed["weighted_participation"]) / math.log1p(RANKING["participation_cap"])
    )
    recency = _clamp01(math.pow(0.5, age_hours / RANKING["half_life_hours"]))
    circle_id = _pick(post, "circle_id")
    circle = 1.0 if circle_id in viewer_circle_ids else RANKING["outside_circle_fit"]

    weights = RANKING["weights"]
    raw = (
        weights["confidence"] * confidence
        + weights["participation"] * participation
        + weights["recency"] * recency
        + weights["circle"] * circle
    )
    contested = bool(computed["contested"])
    score = max(raw, RANKING["contested_floor"]) if contested else raw

    return {
        "score": _round(score),
        "raised_by_floor": contested and score > raw,
        "parts": {
            "confidence": _round(confidence),
            "participation": _round(participation),
            "recency": _round(recency),
            "circle": _round(circle),
        },
    }


def rank_posts(
    posts: Iterable[Mapping[str, Any]],
    *,
    users_by_id: Mapping[str, Mapping[str, Any]] | None = None,
    viewer_circle_ids: set[str] | None = None,
    now_ms: float | None = None,
) -> list[dict[str, Any]]:
    """Sort posts. Never filter them — not by reaction count, not by score.

    The caller decides *visibility* from blocks, mutes and moderation. This
    function decides only *order*, which is exactly the separation the product
    promises.
    """
    viewer_circle_ids = viewer_circle_ids or set()
    now = _to_ms(now_ms) if now_ms is not None else _to_ms(datetime.now(timezone.utc))

    entries = []
    for post in posts:
        verdict = compute_verdict(post, users_by_id=users_by_id, now_ms=now)
        rank = score_post(post, verdict=verdict, viewer_circle_ids=viewer_circle_ids, now_ms=now)
        entries.append({"post": post, "verdict": verdict, **rank})

    entries.sort(key=lambda entry: (-entry["score"], -_to_ms(_pick(entry["post"], "created_at"))))
    return entries


def visible_posts(
    posts: Iterable[Mapping[str, Any]],
    *,
    blocked_author_ids: set[str] = frozenset(),
    muted_author_ids: set[str] = frozenset(),
) -> list[Mapping[str, Any]]:
    """The only three reasons a post disappears, and none of them is a reaction.

    Kept next to the ranking so the invariant is readable in one screen: this
    function must never learn about ``up`` or ``down``.
    """
    blocked = set(blocked_author_ids or ())
    muted = set(muted_author_ids or ())
    return [
        post
        for post in posts
        if _pick(post, "status") != "removed"
        and _pick(post, "author_id") not in blocked
        and _pick(post, "author_id") not in muted
    ]


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count} {singular if count == 1 else (plural or singular + 's')}"


def why_this_appears(entry: Mapping[str, Any], viewer_circle_ids: set[str] | None = None) -> dict[str, str]:
    """The one-line reason a card shows before the reader opens the full panel."""
    viewer_circle_ids = viewer_circle_ids or set()
    post = entry["post"]
    verdict = entry["verdict"]
    parts = entry.get("parts") or {}

    if verdict["contested"]:
        return {
            "tone": "terra",
            "text": (
                f"{verdict['participation']} reactions · {round(verdict['dissent_share'] * 100)}% disagree. "
                "Shown because the community is still arguing — dissent never hides a post."
            ),
        }
    if verdict["needs_more_voices"]:
        return {
            "tone": "quiet",
            "text": (
                f"Only {_plural(verdict['participation'], 'reaction')} so far. "
                "A small sample does not decide anything here."
            ),
        }
    if _pick(post, "circle_id") in viewer_circle_ids:
        return {
            "tone": "quiet",
            "text": (
                f"You are in this circle · {round(parts.get('confidence', 0) * 100)}% confidence "
                f"from {verdict['participation']} reactions."
            ),
        }
    return {
        "tone": "quiet",
        "text": (
            "Outside your circles, but the community is "
            f"{round(verdict['confidence'] * 100)}% confident across {verdict['participation']} reactions."
        ),
    }


__all__ = [
    "RANKING",
    "VISIBILITY_CAUSES",
    "wilson_lower",
    "burst_window",
    "compute_verdict",
    "score_post",
    "rank_posts",
    "visible_posts",
    "why_this_appears",
]

"""Outside ranking — the only place relevance is decided.

Five signals, weighted, with the weights named as module constants so a
product decision is a one-line change and a test can assert on it:

    proximity   how close it is to where the viewer is looking
    recency     how recently it was written
    timing      for events, how soon it happens (a party tomorrow beats one
                next month even if the next-month one is fresher)
    interest    does the category or tags match what the viewer follows
    social      is the author someone the viewer is connected to
    engagement  likes / saves / interest, log-damped so a popular item cannot
                drown a useful local one

Two rules are load-bearing and both are pinned by tests in
`backend/tests/test_outside.py`:

1. **Price is never a ranking term.** Nothing in this file reads a price, a
   fee, a budget or `is_commercial` as a boost. Commerce is one use case among
   several; it does not buy position.
2. **Engagement is damped and capped.** `math.log1p` then a ceiling, so 500
   likes is not 500× more relevant than 5. This is the guard against popular
   content overwhelming useful local information.

The function is pure: same item + same context in, same score out. No I/O, no
clock reads (the caller passes `now`), which is what makes it unit-testable.
"""

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, Sequence

# ── weights ───────────────────────────────────────────────────────────────────
# They sum to 1.0 so a score reads as "share of the maximum relevance".
W_PROXIMITY = 0.34
W_RECENCY = 0.20
W_TIMING = 0.16
W_INTEREST = 0.12
W_SOCIAL = 0.10
W_ENGAGEMENT = 0.08

# Half-lives, in hours. Recency decays over ~3 days; an event's timing signal
# peaks the day before and falls away after it starts.
RECENCY_HALF_LIFE_H = 72.0
TIMING_PEAK_H = 18.0
TIMING_FAR_H = 24 * 21.0  # three weeks out is effectively "someday"

# Engagement ceiling: this many interactions earns the full engagement weight.
# Anything above is worth the same, which is the anti-virality guard.
ENGAGEMENT_SATURATION = 40.0

# Repeated commercial posting from the same author inside a window is decayed.
# This is the spam/promotion floor: it never hides content, it only stops one
# account from filling the nearby shelf.
PROMOTION_DECAY_PER_PRIOR = 0.15
PROMOTION_DECAY_FLOOR = 0.4
PROMOTION_WINDOW = timedelta(hours=24)

# Geographic bands, mirroring the product's discovery model.
NEAR_KM = 3.0
TOWN_KM = 15.0


@dataclass(frozen=True)
class RankContext:
    """Everything ranking is allowed to know about the viewer."""

    now: datetime
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_km: float = TOWN_KM
    layer: str = "town"
    interests: Sequence[str] = field(default_factory=tuple)
    connected_vendor_ids: Sequence[str] = field(default_factory=tuple)
    # content_kind -> count of that author's commercial items already shown in
    # the window, used only for the promotion decay.
    recent_commercial_by_author: dict = field(default_factory=dict)


@dataclass
class RankedItem:
    """A feed item plus the score and the human-readable reasons for it."""

    item: dict
    score: float
    reasons: list = field(default_factory=list)


# ── primitives ────────────────────────────────────────────────────────────────

def haversine_km(lat1: Optional[float], lng1: Optional[float],
                 lat2: Optional[float], lng2: Optional[float]) -> Optional[float]:
    """Great-circle distance, or None when either point is unknown.

    Same formula as `app/routes/nearby.py` and `app/routes/surface.py` — the
    network already has three copies of it, so this one delegates nowhere and
    matches them exactly.
    """
    if None in (lat1, lng1, lat2, lng2):
        return None
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))


def _decay(hours: float, half_life: float) -> float:
    """1.0 at zero, 0.5 at the half-life, asymptotic to zero. Never negative."""
    if hours <= 0:
        return 1.0
    return 0.5 ** (hours / half_life)


def _hours_between(later: datetime, earlier: datetime) -> float:
    return (later - earlier).total_seconds() / 3600.0


# ── the five signals ──────────────────────────────────────────────────────────

def proximity_signal(distance_km: Optional[float], radius_km: float, layer: str) -> float:
    """1.0 at the viewer's feet, falling to 0 at the edge of the radius.

    No location on either side is **not** a penalty: an unlocated item scores
    a flat 0.5, which is exactly "neither near nor far" — it keeps national
    and online content visible without letting it out-rank something three
    streets away.
    """
    if distance_km is None:
        return 0.5
    radius = max(radius_km, NEAR_KM)
    if layer == "neighbourhood":
        radius = min(radius, NEAR_KM)
    if distance_km <= 0:
        return 1.0
    if distance_km >= radius:
        return 0.0
    return 1.0 - (distance_km / radius)


def recency_signal(created_at: Optional[datetime], now: datetime) -> float:
    if created_at is None:
        return 0.25
    return _decay(max(_hours_between(now, created_at), 0.0), RECENCY_HALF_LIFE_H)


def timing_signal(starts_at: Optional[datetime], expires_at: Optional[datetime],
                  now: datetime) -> Optional[float]:
    """Only timed content gets this one; everything else returns None.

    Peaks just before it starts (you want to hear about tonight's party this
    afternoon, not after it began) and decays either side. Expired or
    cancelled content scores 0 here — its relevance comes from elsewhere.
    """
    if starts_at is None and expires_at is None:
        return None
    ref = starts_at or expires_at
    hours_until = _hours_between(ref, now)  # negative once it has passed
    if expires_at is not None and expires_at <= now:
        return 0.0
    if hours_until < 0:
        # already underway/past: fade out over the following day
        return max(0.0, _decay(abs(hours_until), 24.0))
    # approaching: strongest inside the peak window, then a slow approach
    if hours_until <= TIMING_PEAK_H:
        return 1.0
    return _decay(hours_until - TIMING_PEAK_H, TIMING_FAR_H / 3)


def interest_signal(category: Optional[str], tags: Sequence[str], interests: Sequence[str]) -> float:
    if not interests:
        return 0.3  # no stated interests → neutral, never a penalty
    wanted = {str(i).strip().lower() for i in interests if str(i).strip()}
    if not wanted:
        return 0.3
    have = set()
    if category:
        have.add(str(category).strip().lower())
    have.update(str(t).strip().lower() for t in (tags or []))
    if have & wanted:
        return 1.0
    return 0.0


def social_signal(author_id: Optional[str], connected: Sequence[str]) -> float:
    if not author_id or not connected:
        return 0.0
    return 1.0 if str(author_id) in {str(c) for c in connected} else 0.0


def engagement_signal(item: dict) -> float:
    """Log-damped, saturating. Deliberately ignores price."""
    total = 0.0
    for key in ("like_count", "save_count", "interest_count", "reply_count",
                "registered_count", "member_count", "offer_count"):
        try:
            total += max(float(item.get(key) or 0), 0.0)
        except (TypeError, ValueError):
            continue
    if total <= 0:
        return 0.0
    return min(math.log1p(total) / math.log1p(ENGAGEMENT_SATURATION), 1.0)


def promotion_decay(author_id: Optional[str], is_commercial: bool,
                    prior_in_window: dict) -> float:
    """1.0 normally; a floor of 0.4 for an account flooding commercial posts."""
    if not is_commercial or not author_id:
        return 1.0
    prior = int(prior_in_window.get(str(author_id), 0) or 0)
    if prior <= 0:
        return 1.0
    return max(PROMOTION_DECAY_FLOOR, 1.0 - PROMOTION_DECAY_PER_PRIOR * prior)


# ── the score ─────────────────────────────────────────────────────────────────

def score_item(item: dict, ctx: RankContext) -> RankedItem:
    """Score one normalised feed item. Pure; see the module docstring."""
    now = ctx.now

    if item.get("distance_km") is None and ctx.lat is not None and ctx.lng is not None:
        distance = haversine_km(ctx.lat, ctx.lng, item.get("geo_lat"), item.get("geo_lng"))
    else:
        distance = item.get("distance_km")

    proximity = proximity_signal(distance, ctx.radius_km, ctx.layer)
    recency = recency_signal(item.get("created_at"), now)
    timing = timing_signal(item.get("starts_at"), item.get("expires_at"), now)
    interest = interest_signal(item.get("category"), item.get("tags") or (), ctx.interests)
    social = social_signal(item.get("owner_id"), ctx.connected_vendor_ids)
    engagement = engagement_signal(item)

    reasons: list = []
    if distance is not None:
        if distance <= NEAR_KM:
            reasons.append(f"{distance:.1f} km away")
        elif distance <= TOWN_KM:
            reasons.append(f"{distance:.0f} km away")
        else:
            reasons.append(f"{distance:.0f} km away")
    if item.get("location") and distance is None:
        reasons.append(str(item["location"]))

    starts = item.get("starts_at")
    if starts is not None:
        delta = starts - now
        if delta.total_seconds() > 0:
            days = delta.days
            if days <= 0:
                reasons.append("today")
            elif days == 1:
                reasons.append("tomorrow")
            elif days < 7:
                reasons.append(f"in {days} days")
            else:
                reasons.append(starts.strftime("%d %b"))

    if interest >= 1.0:
        reasons.append("matches your interests")
    if social >= 1.0:
        reasons.append("someone you are connected to")

    # Timing replaces a slice of the recency weight for undated content, so an
    # event is not penalised twice for being written a while ago.
    if timing is None:
        timing_component = recency * W_TIMING
    else:
        timing_component = timing * W_TIMING

    score = (
        W_PROXIMITY * proximity
        + W_RECENCY * recency
        + timing_component
        + W_INTEREST * interest
        + W_SOCIAL * social
        + W_ENGAGEMENT * engagement
    )

    decay = promotion_decay(
        item.get("owner_id"), bool(item.get("is_commercial")), ctx.recent_commercial_by_author,
    )
    if decay < 1.0:
        score *= decay
        reasons.append("less of this — the author has posted a lot today")

    # Cancelled, removed and expired content drops out of discovery without
    # being deleted, so the record and its history survive.
    if item.get("status") in ("cancelled", "removed", "expired"):
        score *= 0.05
        reasons.append("no longer active")

    return RankedItem(item=item, score=round(score, 6), reasons=reasons[:4])


def rank(items: Sequence[dict], ctx: RankContext) -> list:
    """Score, then order by (score, created_at, id) — a total, stable order.

    The stable tiebreak matters: two calls with the same inputs return the same
    sequence, which is what makes cursor pagination over a ranked list honest.
    """
    ranked = [score_item(item, ctx) for item in items]
    ranked.sort(key=lambda r: (
        -r.score,
        -(r.item.get("created_at") or datetime.min).timestamp(),
        str(r.item.get("id") or ""),
    ))
    return ranked

"""Pure scoring for discovery (Phase 7, PR 102). No I/O: same facts in, same numbers out.

Every input is a real fact about a listing. A missing fact counts as zero and is never
invented. Distance is kept as a true number; it only feeds the order, never the shown value.

Only a client's star rating describes a supplier. A supplier's failed or fraud outcome is
recorded about the client, so it never lowers a supplier's score here.
"""

from typing import Optional

RECENT_DAYS = 90
RANK_COMPLETENESS_WEIGHT = 0.6
RANK_DISTANCE_WEIGHT = 0.4


def rating_part(rated: int, avg_stars: Optional[float]) -> float:
    """0..1. Needs real recent star ratings. Quality is the average stars; confidence grows with
    the count and reaches full weight at five ratings."""
    if rated <= 0 or avg_stars is None:
        return 0.0
    confidence = min(rated, 5) / 5
    quality = max(0.0, min(avg_stars, 5.0)) / 5
    return round(confidence * quality, 4)


def completeness(facts: dict) -> float:
    """Share (0..1) of the four data pillars a listing has filled in.

    facts: has_hours (bool), offer_kinds (0-3 distinct kinds on offer), has_titles (bool),
    rated (recent star ratings), avg_stars (float or None).
    """
    parts = [
        1.0 if facts.get("has_hours") else 0.0,
        min(max(int(facts.get("offer_kinds") or 0), 0), 3) / 3,
        1.0 if facts.get("has_titles") else 0.0,
        rating_part(int(facts.get("rated") or 0), facts.get("avg_stars")),
    ]
    return round(sum(parts) / len(parts), 4)


def rank_score(completeness_value: float, distance_km: float, radius_km: float) -> float:
    """Order key. Higher is shown first. Nearness counts for less than data, but still counts."""
    nearness = 0.0 if radius_km <= 0 else max(0.0, 1 - distance_km / radius_km)
    return round(RANK_COMPLETENESS_WEIGHT * completeness_value + RANK_DISTANCE_WEIGHT * nearness, 4)

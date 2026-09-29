"""
Courier route optimisation (Directive v2.1 §5.5).

A courier's day is a small travelling-salesman problem: pick up here, drop
there, in an order that wastes the fewest kilometres. This module solves it
with the pair of heuristics that fit the size of the problem — nearest
neighbour to build a tour, then 2-opt to remove the crossings — and reports
the saving against the courier's booking order, which is what they would have
driven without the plan.

Distances are great-circle (haversine) when coordinates exist, otherwise the
leg is priced as unknown (0 km) and the stop is kept in relative order. The
caller persists the plan; this module is pure computation.
"""

import math
from typing import Optional


def haversine_km(a: Optional[dict], b: Optional[dict]) -> Optional[float]:
    """Great-circle distance between two stops, or None when either side (or a
    coordinate) is missing. A run with no depot has no first leg to price."""
    if a is None or b is None:
        return None
    lat1, lng1 = a.get("lat"), a.get("lng")
    lat2, lng2 = b.get("lat"), b.get("lng")
    if None in (lat1, lng1, lat2, lng2):
        return None
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(h)), 3)


def _distance(a: dict, b: dict) -> float:
    """Distance used for scoring — unknown legs count as 0 so a missing pin never
    inflates the route."""
    d = haversine_km(a, b)
    return 0.0 if d is None else d


def tour_length(order: list[dict], start: Optional[dict] = None, return_to_start: bool = False) -> float:
    points = ([start] if start else []) + order + ([start] if (start and return_to_start) else [])
    return round(sum(_distance(points[i], points[i + 1]) for i in range(len(points) - 1)), 3)


def _nearest_neighbour(stops: list[dict], start: Optional[dict]) -> list[dict]:
    remaining = list(stops)
    tour: list[dict] = []
    current = start
    while remaining:
        # Priority stops win inside a ~2 km tie so "deliver before 10am" can be honoured.
        nxt = min(
            remaining,
            key=lambda s: (
                round(_distance(current, s) / 2.0) if current else 0,
                -(s.get("priority") or 0),
            ),
        )
        tour.append(nxt)
        remaining.remove(nxt)
        current = nxt
    return tour


def _two_opt(tour: list[dict], start: Optional[dict], return_to_start: bool) -> list[dict]:
    """Classic 2-opt: reverse a segment whenever it shortens the tour."""
    if len(tour) < 3:
        return tour
    best = tour
    best_len = tour_length(best, start, return_to_start)
    improved = True
    guard = 0
    while improved and guard < 25:  # bounded: never let a big day spin the request
        improved = False
        guard += 1
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                candidate = best[:i] + list(reversed(best[i:j + 1])) + best[j + 1:]
                length = tour_length(candidate, start, return_to_start)
                if length + 1e-9 < best_len:
                    best, best_len = candidate, length
                    improved = True
    return best


def optimise(
    stops: list[dict],
    start: Optional[dict] = None,
    average_speed_kmh: float = 25.0,
    return_to_start: bool = False,
    service_minutes: int = 0,
) -> dict:
    """Plan the run.

    `stops` items: {label, lat, lng, address, weight_kg, priority, shipment_id}
    `start` is the courier's current position / depot, same shape.
    Returns the ordered stops with per-leg distance, cumulative distance and ETA,
    plus the distance the same stops would have taken in the order they were given
    (the booking order), so `saved_km` is honest.
    """
    if not stops:
        return {"stops": [], "total_distance_km": 0.0, "baseline_distance_km": 0.0, "saved_km": 0.0,
                "estimated_minutes": 0, "average_speed_kmh": average_speed_kmh,
                "algorithm": "nearest_neighbour+2opt"}

    baseline_order = list(stops)
    tour = _two_opt(_nearest_neighbour(baseline_order, start), start, return_to_start)

    speed = max(1.0, float(average_speed_kmh or 25.0))
    cumulative = 0.0
    planned: list[dict] = []
    previous = start
    for i, stop in enumerate(tour, start=1):
        leg = haversine_km(previous, stop)
        leg_km = leg or 0.0
        cumulative += leg_km
        drive_minutes = (leg_km / speed) * 60.0
        eta_minutes = round(drive_minutes + service_minutes * (i - 1))
        planned.append({
            **stop,
            "sequence": i,
            "distance_from_prev_km": round(leg_km, 2),
            "leg_km_known": leg is not None,
            "cumulative_km": round(cumulative, 2),
            "eta_minutes": int(eta_minutes),
        })
        previous = stop

    if return_to_start and start:
        cumulative += _distance(previous, start)

    baseline = tour_length(baseline_order, start, return_to_start)
    total = round(cumulative, 3)
    return {
        "stops": planned,
        "total_distance_km": round(total, 2),
        "baseline_distance_km": round(baseline, 2),
        "saved_km": round(max(0.0, baseline - total), 2),
        "saved_pct": round(100.0 * max(0.0, baseline - total) / baseline, 1) if baseline else 0.0,
        "estimated_minutes": int(round(total / speed * 60.0 + service_minutes * len(planned))),
        "average_speed_kmh": speed,
        "return_to_start": return_to_start,
        "algorithm": "nearest_neighbour+2opt",
        "unlocated_stops": sum(1 for s in planned if not s["leg_km_known"] and s["sequence"] > 1),
    }

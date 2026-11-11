"""Bounding-box pre-filter for "within N km" queries.

A box is a cheap SQL filter that keeps every row inside the radius, plus some outside it.
Callers then apply the exact haversine distance to the (much smaller) set that is left, so
the answer never changes; only the number of rows loaded does. Antimeridian wrap is not
handled, which is fine for the area this network serves (the box is clamped to the globe).
"""
import math
from typing import Tuple


def radius_box(lat: float, lng: float, radius_km: float) -> Tuple[float, float, float, float]:
    """Return (min_lat, max_lat, min_lng, max_lng) that contains the whole radius."""
    lat_span = radius_km / 111.0
    lng_span = radius_km / max(111.0 * math.cos(math.radians(lat)), 1.0)
    return (max(lat - lat_span, -90.0), min(lat + lat_span, 90.0),
            max(lng - lng_span, -180.0), min(lng + lng_span, 180.0))

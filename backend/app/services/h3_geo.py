"""Uber H3 geometry, without a map SDK.

One coordinate becomes a deterministic cell at three useful resolutions:

  · res 9  ~0.1 km²  a street block / a stage corner
  · res 8  ~0.7 km²  a ward or estate
  · res 7  ~5 km²    a town

The API stores the three strings on a table and the viewer gets three grid
disks. Matching is then a string comparison, not a distance query against every
row. H3 is open source; this module is the only place that imports it.
"""

from __future__ import annotations

from typing import Optional

import h3

STREET_RES = 9
WARD_RES = 8
TOWN_RES = 7
RESOLUTIONS = (STREET_RES, WARD_RES, TOWN_RES)


def valid_point(lat: Optional[float], lng: Optional[float]) -> bool:
    try:
        lat_f, lng_f = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return -90 <= lat_f <= 90 and -180 <= lng_f <= 180


def cell(lat: float, lng: float, resolution: int = STREET_RES) -> str:
    """The H3 string for one point. Invalid input is a caller error."""
    if not valid_point(lat, lng):
        raise ValueError("lat and lng must be real coordinates")
    if resolution not in RESOLUTIONS:
        raise ValueError("resolution must be 7, 8 or 9")
    return h3.latlng_to_cell(float(lat), float(lng), int(resolution))


def parent(index: str, resolution: int) -> str:
    return h3.cell_to_parent(index, int(resolution))


def disk(index: str, ring: int = 1) -> set[str]:
    """The cell plus its hexagonal neighbours (`ring=0` is just the cell)."""
    return set(h3.grid_disk(index, max(0, int(ring))))


def describe(lat: float, lng: float, ring: int = 1) -> dict:
    """Everything a table or a request needs to store for three zoom levels."""
    street = cell(lat, lng, STREET_RES)
    ward = h3.cell_to_parent(street, WARD_RES)
    town = h3.cell_to_parent(street, TOWN_RES)
    center_lat, center_lng = h3.cell_to_latlng(street)
    return {
        "h3_r9": street,
        "h3_r8": ward,
        "h3_r7": town,
        "center_lat": center_lat,
        "center_lng": center_lng,
        "rings": {
            "r9": sorted(disk(street, ring)),
            "r8": sorted(disk(ward, ring)),
            "r7": sorted(disk(town, ring)),
        },
    }


def cell_center(index: str) -> tuple[float, float]:
    return h3.cell_to_latlng(index)


def is_valid(index: Optional[str]) -> bool:
    return bool(index) and h3.is_valid_cell(str(index))

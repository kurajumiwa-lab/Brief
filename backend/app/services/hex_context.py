"""The free, cached open-data context around one H3 block.

A first query in a new cell asks Overpass for named stages, markets, shops,
schools and clinics within 900 m. The result is stored on `geo_hex_cells`, so
the next person in the same block gets an instant answer with no external call.
A failed attempt is recorded too; the retry cooldown is the difference between
"a quiet block" and hammering a free community endpoint on every paint.

The cache is a snapshot, not a census. Every payload remembers its source and
the OSM attribution; the client must show both.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.geo_hex import GeoHexCell
from app.services import geo_data, h3_geo
from app.services.routing import haversine_km

log = logging.getLogger("brief.hex_context")
MAX_FIXTURES = 40
ATTRIBUTION = "Data © OpenStreetMap contributors"


def _now(value: Optional[datetime] = None) -> datetime:
    moment = value or datetime.now(timezone.utc)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _distance_m(lat: float, lng: float, fixture: dict) -> int:
    try:
        return int(round(haversine_km({"lat": lat, "lng": lng},
                                      {"lat": fixture["lat"], "lng": fixture["lng"]}) * 1000))
    except (TypeError, ValueError):
        return 0


def _clean_fixtures(lat: float, lng: float, places: list[dict]) -> list[dict]:
    rows = []
    seen = set()
    for place in places or []:
        key = str(place.get("external_id") or "")
        name = " ".join(str(place.get("name") or "").split())
        if not name or key in seen:
            continue
        try:
            fixture_lat, fixture_lng = float(place["lat"]), float(place["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        if not h3_geo.valid_point(fixture_lat, fixture_lng):
            continue
        seen.add(key)
        cleaned = {**place, "lat": fixture_lat, "lng": fixture_lng}
        row = {
            "name": name[:160],
            "kind": place.get("kind") or "other",
            "kind_label": place.get("kind_label") or "Landmark",
            "category": place.get("category"),
            "address": place.get("address"),
            "lat": fixture_lat,
            "lng": fixture_lng,
            "distance_m": _distance_m(lat, lng, cleaned),
            "source": "openstreetmap",
            "external_id": place.get("external_id"),
        }
        rows.append(row)
    rows.sort(key=lambda row: row["distance_m"])
    return rows[:MAX_FIXTURES]


def _groups(fixtures: list[dict]) -> dict:
    groups = {"transit": [], "commerce": [], "community": [], "other": []}
    for row in fixtures:
        groups.setdefault(row.get("kind") or "other", []).append(row)
    return groups


def _human_distance(metres: int) -> str:
    if metres < 1000:
        return f"{metres} m"
    return f"{metres / 1000:.1f} km"


def _prompts(fixtures: list[dict], label: Optional[str]) -> list[dict]:
    if not fixtures:
        return [
            {
                "eyebrow": "Your block",
                "title": "No mapped anchor in this block yet",
                "body": "Your pin is still the anchor. Name the stage, shop or school "
                        "in the table title so a neighbour can recognise the place.",
                "kind": "empty",
            },
            {
                "eyebrow": "First move",
                "title": "Be the first table here",
                "body": "Open a short table for the thing people are already moving — "
                        "a delivery, a co-buy or a meet-up. The block fills from there.",
                "kind": "table",
                "href": "/street?open=1",
            },
        ]
    nearest = fixtures[0]
    prompts = [
        {
            "eyebrow": "Your anchor",
            "title": f"{_human_distance(nearest['distance_m'])} from {nearest['name']}",
            "body": f"{nearest['kind_label']} is the nearest named place. Use it in the "
                    f"table title so nobody has to guess the meeting point.",
            "kind": "anchor",
        }
    ]
    transit = next((row for row in fixtures if row["kind"] == "transit"), None)
    commerce = next((row for row in fixtures if row["kind"] == "commerce"), None)
    community = next((row for row in fixtures if row["kind"] == "community"), None)
    if transit:
        prompts.append({
            "eyebrow": "Passing traffic",
            "title": f"Commuters pass {transit['name']}",
            "body": "A 30–60 minute table can catch the next run. Say the stage name "
                    "and the direction you are going.",
            "kind": "transit",
            "href": "/street?open=1",
        })
    if commerce:
        prompts.append({
            "eyebrow": "Trade anchor",
            "title": f"{commerce['name']} is already a trade point",
            "body": "A co-buy or a source table next to an existing shop starts from "
                    "foot traffic instead of a cold post.",
            "kind": "commerce",
            "href": "/street?open=1",
        })
    if community:
        prompts.append({
            "eyebrow": "Predictable hours",
            "title": f"People gather at {community['name']}",
            "body": "School gates, clinics and places of worship have a rhythm. A table "
                    "that matches their hours feels like it belongs there.",
            "kind": "community",
        })
    return prompts[:4]


def _payload(
    lat: float,
    lng: float,
    *,
    label: Optional[str],
    fixtures: list[dict],
    info: dict,
    cache: dict,
) -> dict:
    clean = _clean_fixtures(lat, lng, fixtures)
    return {
        "available": True,
        "label": label or (f"Near {clean[0]['name']}" if clean else "Your block"),
        "h3": {"r9": info["h3_r9"], "r8": info["h3_r8"], "r7": info["h3_r7"]},
        "center": {"lat": info["center_lat"], "lng": info["center_lng"]},
        "radius_m": settings.GEO_HEX_RADIUS_M,
        "fixtures": clean,
        "groups": _groups(clean),
        "counts": {
            "total": len(clean),
            "transit": sum(1 for row in clean if row["kind"] == "transit"),
            "commerce": sum(1 for row in clean if row["kind"] == "commerce"),
            "community": sum(1 for row in clean if row["kind"] == "community"),
        },
        "prompts": _prompts(clean, label),
        "cache": cache,
        "attribution": ATTRIBUTION,
    }


def unavailable(reason: str = "Set a pin to trace the nearest stage, market or school.") -> dict:
    return {
        "available": False,
        "reason": reason,
        "h3": None,
        "fixtures": [],
        "groups": {"transit": [], "commerce": [], "community": [], "other": []},
        "counts": {"total": 0, "transit": 0, "commerce": 0, "community": 0},
        "prompts": [],
        "cache": {"cached": False, "stale": False, "source": "none"},
        "attribution": ATTRIBUTION,
    }


async def get_context(
    db: AsyncSession,
    lat: float,
    lng: float,
    *,
    label: Optional[str] = None,
    refresh: bool = False,
    now: Optional[datetime] = None,
) -> dict:
    """Return the cached or freshly traced context for one point.

    The caller commits; this function only flushes. Network failure is a
    first-class answer, not an exception: the pin still has a grid, a label and
    an honest empty state.
    """
    if not h3_geo.valid_point(lat, lng):
        raise ValueError("lat and lng must be real coordinates")
    moment = _now(now)
    info = h3_geo.describe(float(lat), float(lng))
    cell = info["h3_r9"]
    row = (await db.execute(
        select(GeoHexCell).where(GeoHexCell.h3_index == cell)
    )).scalar_one_or_none()

    ttl = timedelta(hours=max(1, int(settings.GEO_HEX_TTL_HOURS)))
    retry = timedelta(minutes=max(1, int(settings.GEO_HEX_RETRY_MINUTES)))
    fresh = bool(row and row.refreshed_at and moment - _now(row.refreshed_at) < ttl)
    cooling = bool(row and row.attempted_at and moment - _now(row.attempted_at) < retry)

    if row is not None and fresh and not refresh:
        return _payload(
            float(lat), float(lng), label=label or row.label,
            fixtures=list(row.fixtures or []), info=info,
            cache={
                "cached": True, "stale": False, "source": row.source,
                "cell": cell, "refreshed_at": _iso(row.refreshed_at),
            },
        )

    if row is not None and cooling and not refresh:
        return _payload(
            float(lat), float(lng), label=label or row.label,
            fixtures=list(row.fixtures or []), info=info,
            cache={
                "cached": bool(row.fixtures), "stale": bool(row.refreshed_at),
                "source": row.source, "cell": cell,
                "refreshed_at": _iso(row.refreshed_at),
                "retry_after": _iso(_now(row.attempted_at) + retry),
                "note": "A recent lookup did not complete. Cached rows, if any, are shown.",
            },
        )

    if row is None:
        row = GeoHexCell(
            h3_index=cell,
            resolution=h3_geo.STREET_RES,
            center_lat=info["center_lat"],
            center_lng=info["center_lng"],
            label=label,
            fixtures=[],
            fixture_count=0,
            source="none",
            created_at=moment,
            updated_at=moment,
        )
        db.add(row)
        await db.flush()

    row.attempted_at = moment
    row.updated_at = moment
    try:
        places = await geo_data.overpass_context_around(
            float(lat), float(lng), radius_m=int(settings.GEO_HEX_RADIUS_M),
        )
    except Exception as exc:  # GeoError, timeout, malformed source
        row.last_error = str(exc)[:300]
        if not row.fixtures:
            row.source = "unavailable"
        row.attempted_at = moment
        await db.flush()
        log.warning("hex context %s unavailable: %s", cell, exc)
        return _payload(
            float(lat), float(lng), label=label or row.label,
            fixtures=list(row.fixtures or []), info=info,
            cache={
                "cached": bool(row.fixtures), "stale": bool(row.refreshed_at),
                "source": row.source, "cell": cell,
                "refreshed_at": _iso(row.refreshed_at),
                "retry_after": _iso(moment + retry),
                "note": "OpenStreetMap did not answer. The pin still works; try again later.",
            },
        )

    fixtures = _clean_fixtures(float(lat), float(lng), places)
    generic = {"pasted pin", "your pin", "pinned location"}
    if not label or str(label).strip().lower() in generic:
        try:
            label = await geo_data.reverse_geocode(float(lat), float(lng))
        except Exception:
            label = None
    row.label = label or (f"Near {fixtures[0]['name']}" if fixtures else None)
    row.fixtures = fixtures
    row.fixture_count = len(fixtures)
    row.source = "openstreetmap"
    row.last_error = None
    row.refreshed_at = moment
    row.attempted_at = moment
    row.updated_at = moment
    await db.flush()
    return _payload(
        float(lat), float(lng), label=label or row.label,
        fixtures=fixtures, info=info,
        cache={
            "cached": False, "stale": False, "source": "openstreetmap",
            "cell": cell, "refreshed_at": _iso(row.refreshed_at),
        },
    )

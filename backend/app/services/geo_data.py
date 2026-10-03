"""Open-data geo service — free endpoints only.

Two public sources, both OpenStreetMap, both free, both no-key:

  * Nominatim      — geocoding (place name → lat/lng). 1 request/second
                     policy, descriptive User-Agent required by their policy.
  * Overpass API   — "what public businesses are inside this circle" queries.

The ingest writes PublicPlace rows keyed by (source, external_id), so a
re-run refreshes `last_checked_at` instead of duplicating. A place the source
no longer returns is NOT deleted (a zone pull is a sample, not a census) — it
goes stale on last_checked_at and the UI shows that, which is the honest
state.

ODbL: the data may be stored and served, with attribution. The frontend
carries the required "Data © OpenStreetMap contributors" line.
"""

import asyncio
import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.market_locks import MarketZone
from app.models.public_place import PublicPlace

log = logging.getLogger("brief.geo_data")

USER_AGENT = "MyShopApp/1.0 (vendor-network open-data ingest; contact: ops@wairo.local)"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# overpass-api.de serves GET (its POST path 406s from some egress IPs);
# maps.mail.ru answers POST. Try each in order, first success wins.
OVERPASS_MIRRORS = [
    ("GET", "https://overpass-api.de/api/interpreter"),
    ("POST", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"),
]

# Which OSM tags are "a business a trader would look up". Everything else
# (toilets, benches, parking) would be noise on the shelf.
OVERPASS_QL = """
[out:json][timeout:{timeout}];
(
  node(around:{radius},{lat},{lng})["shop"];
  way(around:{radius},{lat},{lng})["shop"];
  node(around:{radius},{lat},{lng})["amenity"~"marketplace|supermarket|convenience|pharmacy|fuel|mall"];
  way(around:{radius},{lat},{lng})["amenity"~"marketplace|supermarket|convenience|pharmacy|fuel|mall"];
  node(around:{radius},{lat},{lng})["craft"];
  way(around:{radius},{lat},{lng})["craft"];
);
out center tags;
"""

_geocode_cache: dict[str, tuple[float, float, str]] = {}


class GeoError(Exception):
    pass


async def geocode(query: str) -> dict:
    """Place name → {lat, lng, display_name}. Nominatim, free, no key.

    Cached in-process so repeated runs (zone geocoding, manual calls) do not
    hammer the 1 req/s policy.
    """
    q = (query or "").strip()
    if not q:
        raise GeoError("A place name is required")
    if q in _geocode_cache:
        lat, lng, display = _geocode_cache[q]
        return {"lat": lat, "lng": lng, "display_name": display}
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": USER_AGENT}) as client:
        r = await client.get(NOMINATIM_URL, params={"format": "json", "limit": 1, "q": q})
    if r.status_code != 200:
        raise GeoError(f"Geocoder answered {r.status_code}")
    rows = r.json()
    if not rows:
        raise GeoError(f"No match for “{q}”")
    row = rows[0]
    result = {
        "lat": float(row["lat"]),
        "lng": float(row["lon"]),
        "display_name": row.get("display_name", q),
        "osm_type": row.get("osm_type"),
        "osm_id": row.get("osm_id"),
    }
    _geocode_cache[q] = (result["lat"], result["lng"], result["display_name"])
    return result


def _normalize_element(el: dict) -> dict | None:
    """One Overpass element → place fields, or None when it is not a usable row."""
    tags = el.get("tags") or {}
    name = (tags.get("name") or "").strip()
    if not name:
        return None  # an unnamed node is not a directory row
    shop = tags.get("shop")
    amenity = tags.get("amenity")
    craft = tags.get("craft")
    detail = shop or amenity or craft or None
    category = (f"shop:{shop}" if shop else f"amenity:{amenity}" if amenity else f"craft:{craft}" if craft else None)
    lat = el.get("lat") or (el.get("center") or {}).get("lat")
    lng = el.get("lon") or (el.get("center") or {}).get("lon")
    if lat is None or lng is None:
        return None
    street = tags.get("addr:street")
    suburb = tags.get("addr:suburb") or tags.get("addr:neighbourhood")
    address = ", ".join(p for p in (street, suburb) if p) or None
    return {
        "external_id": f"{el['type']}/{el['id']}",
        "name": name[:300],
        "category": category,
        "detail": detail,
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "opening_hours": (tags.get("opening_hours") or "")[:300] or None,
        "website": tags.get("website") or tags.get("contact:website"),
        "address": address,
        "lat": float(lat),
        "lng": float(lng),
    }


async def overpass_around(lat: float, lng: float, radius_m: int, timeout_s: int = 60) -> list[dict]:
    """All named shop/amenity/craft places inside the circle. Mirror failover."""
    ql = OVERPASS_QL.format(radius=radius_m, lat=lat, lng=lng, timeout=timeout_s)
    last_err: Exception | None = None
    for method, url in OVERPASS_MIRRORS:
        try:
            async with httpx.AsyncClient(timeout=timeout_s + 30, headers={"User-Agent": USER_AGENT}) as client:
                if method == "GET":
                    r = await client.get(url, params={"data": ql})
                else:
                    r = await client.post(url, data={"data": ql})
            if r.status_code != 200:
                last_err = GeoError(f"Overpass {url} answered {r.status_code}")
                continue
            elements = r.json().get("elements", [])
            places = [p for p in (_normalize_element(e) for e in elements) if p]
            return places
        except Exception as exc:  # timeout, bad json, connection reset
            last_err = exc
            continue
    raise GeoError(f"Every Overpass mirror failed: {last_err}")


async def ensure_zone_location(zone: MarketZone) -> bool:
    """Give a zone coordinates if it lacks them (geocode the zone's own name).

    Returns True when the zone has a center after the call. A zone that
    cannot be geocoded stays at NULL and the ingest skips it — never a guess.
    """
    if zone.center_lat is not None and zone.center_lng is not None:
        return True
    try:
        g = await geocode(f"{zone.name}, {zone.city}")
    except GeoError as exc:
        log.warning("zone %s not geocodable: %s", zone.name, exc)
        return False
    zone.center_lat, zone.center_lng = g["lat"], g["lng"]
    if zone.radius_km is None:
        zone.radius_km = 3.0
    return True


async def ingest_zone(zone: MarketZone, db: AsyncSession) -> dict:
    """Pull the open-data directory for one zone and upsert its rows.

    Idempotent: keyed by (source, external_id). A re-run refreshes
    last_checked_at; a brand-new place gets first_seen_at; a place absent
    from this run keeps its rows but simply stops being refreshed.
    """
    if not await ensure_zone_location(zone):
        return {"ok": False, "reason": f"zone “{zone.name}” could not be located"}
    radius_m = int((zone.radius_km or 3.0) * 1000)
    places = await overpass_around(zone.center_lat, zone.center_lng, radius_m)

    now = datetime.utcnow()
    seen = 0
    added = 0
    for p in places:
        seen += 1
        existing = (await db.execute(
            select(PublicPlace).where(
                PublicPlace.source == "openstreetmap",
                PublicPlace.external_id == p["external_id"],
            )
        )).scalar_one_or_none()
        if existing:
            existing.last_checked_at = now
            for field in ("name", "category", "detail", "phone", "opening_hours", "website", "address", "lat", "lng"):
                if p[field] is not None:
                    setattr(existing, field, p[field])
            if existing.status == "removed":
                existing.status = "active"
            if existing.zone_id is None:
                existing.zone_id, existing.zone_name = zone.id, zone.name
        else:
            row = PublicPlace(
                source="openstreetmap", external_id=p["external_id"],
                name=p["name"], category=p["category"], detail=p["detail"],
                phone=p["phone"], opening_hours=p["opening_hours"],
                website=p["website"], address=p["address"],
                lat=p["lat"], lng=p["lng"], zone_id=zone.id, zone_name=zone.name,
                first_seen_at=now, last_checked_at=now, status="active",
            )
            db.add(row)
            added += 1

    zone.last_ingest_at = now
    zone.last_ingest_count = seen
    await db.commit()
    return {"ok": True, "zone": zone.name, "found": seen, "new": added}


# In-process cooldowns: the mirrors are a shared public resource, so a manual
# trigger can at most run once per zone per hour and the daily loop once per
# zone per 23h. Cooldowns live in memory — a restart simply allows an early
# re-run, which is cheap and idempotent.
_zone_last_run: dict[str, datetime] = {}
ZONE_COOLDOWN_HOURS = 1
DAILY_LOOP_EVERY = timedelta(hours=23)
_LAST_FULL_PASS: list[datetime] = [datetime(1970, 1, 1)]


def _zone_ready(zone_id: str, hours: float) -> bool:
    last = _zone_last_run.get(zone_id)
    return last is None or datetime.utcnow() - last >= timedelta(hours=hours)


async def ingest_zone_guarded(zone_id: str) -> dict:
    """Ingest one zone, honouring the per-zone cooldown."""
    if not _zone_ready(zone_id, ZONE_COOLDOWN_HOURS):
        return {"ok": False, "reason": "already refreshed within the last hour"}
    _zone_last_run[zone_id] = datetime.utcnow()
    async with async_session() as db:
        zone = await db.get(MarketZone, zone_id)
        if not zone:
            return {"ok": False, "reason": "zone not found"}
        return await ingest_zone(zone, db)


async def ingest_all_zones() -> list[dict]:
    """One pass over every active zone, staggered so the mirrors stay happy."""
    results = []
    async with async_session() as db:
        zones = (await db.execute(select(MarketZone).where(MarketZone.is_active.is_(True)))).scalars().all()
        for zone in zones:
            if not _zone_ready(str(zone.id), ZONE_COOLDOWN_HOURS):
                results.append({"ok": False, "zone": zone.name, "reason": "recently refreshed"})
                continue
            _zone_last_run[str(zone.id)] = datetime.utcnow()
            try:
                results.append(await ingest_zone(zone, db))
            except GeoError as exc:
                results.append({"ok": False, "zone": zone.name, "reason": str(exc)})
            await asyncio.sleep(20)  # be a guest on the mirrors
    return results


# The East-African market catalog: the high-density, common town markets the
# regional scan covers. Coordinates are best-effort seed values (good to a few
# km — enough to rank "nearest market in a surrounding town" at 10s-of-km
# scale); the open-data ingest uses them to pull each market's real rows.
# (name, city, country, lat, lng)
_MARKET_CATALOG = [
    # Kenya
    ("Gikomba", "Nairobi", "Kenya", -1.2653, 36.8240),
    ("Eastleigh", "Nairobi", "Kenya", -1.2769, 36.8630),
    ("Kawangware", "Nairobi", "Kenya", -1.2280, 36.8440),
    ("Westlands", "Nairobi", "Kenya", -1.2660, 36.8080),
    ("Ngong Road", "Nairobi", "Kenya", -1.3370, 36.7750),
    ("Industrial Area", "Nairobi", "Kenya", -1.3020, 36.7860),
    ("Kangemi", "Nairobi", "Kenya", -1.3150, 36.8060),
    ("Mtwara", "Mombasa", "Kenya", -4.0520, 39.6680),
    ("Kibuye", "Kisumu", "Kenya", -0.0900, 34.7600),
    ("Nakuru Town Market", "Nakuru", "Kenya", -0.2980, 36.0750),
    ("Kibet", "Eldoret", "Kenya", 0.5070, 35.2650),
    ("Thika Town Market", "Thika", "Kenya", -1.0310, 37.0720),
    ("Kitale Town Market", "Kitale", "Kenya", -0.6940, 35.0160),
    ("Machakos Town Market", "Machakos", "Kenya", -1.5140, 37.2640),
    ("Naivasha Town Market", "Naivasha", "Kenya", -0.6940, 36.0880),
    ("Ruai", "Kajiado", "Kenya", -0.8770, 36.2100),
    # Tanzania
    ("Kariakoo", "Dar es Salaam", "Tanzania", -6.8225, 39.2700),
    ("Arusha Central Market", "Arusha", "Tanzania", -3.3850, 36.5850),
    ("Mwanza Market", "Mwanza", "Tanzania", -2.8800, 32.4100),
    # Uganda
    ("Owino Market", "Kampala", "Uganda", 0.3466, 32.5783),
    ("Ntinda Market", "Kampala", "Uganda", 0.3520, 32.5830),
    ("Jinja Market", "Jinja", "Uganda", 0.4231, 33.2072),
    # Rwanda
    ("Kimironko Market", "Kigali", "Rwanda", -1.9458, 30.0666),
    ("Kigali Central Market", "Kigali", "Rwanda", -1.9480, 30.0620),
    # Ethiopia
    ("Merkato", "Addis Ababa", "Ethiopia", 9.0364, 38.7360),
]


def _zone_keys(name: str, city: str):
    return name.lower().replace(" ", ""), city.lower().replace(" ", "")


def _make_zone(name: str, city: str, country: str, lat, lng) -> MarketZone:
    name_key, city_key = _zone_keys(name, city)
    return MarketZone(
        name=name, city=city, name_key=name_key, city_key=city_key,
        country=country, is_active=True, center_lat=lat, center_lng=lng,
    )


async def ensure_seed_zones(db: AsyncSession) -> int:
    """Create the full catalog when the table is empty (fresh install)."""
    existing = (await db.execute(select(MarketZone.id).limit(1))).first()
    if existing:
        return 0
    for name, city, country, lat, lng in _MARKET_CATALOG:
        db.add(_make_zone(name, city, country, lat, lng))
    await db.commit()
    return len(_MARKET_CATALOG)


async def ensure_market_catalog(db: AsyncSession) -> int:
    """Idempotently add any catalog market missing from the table. A live
    network that already has zones keeps them exactly as-is; only NEW markets
    are added. Returns the number added this pass."""
    existing = dict((await db.execute(
        select(MarketZone.name_key, MarketZone.city_key)
    )).all())
    added = 0
    for name, city, country, lat, lng in _MARKET_CATALOG:
        name_key, city_key = _zone_keys(name, city)
        if (name_key, city_key) in existing:
            continue
        db.add(_make_zone(name, city, country, lat, lng))
        existing[(name_key, city_key)] = True
        added += 1
    if added:
        await db.commit()
    return added


async def open_data_loop(session_factory) -> None:
    """Daily scheduler pass: one full sweep over all zones, every ~23 h.

    Mirrors the pos_sync/payment_worker pattern: one task, a sleep between
    passes, and every pass opens its own session so a long Overpass call
    never holds a pooled connection.
    """
    await asyncio.sleep(30)  # let the app finish booting first
    while True:
        try:
            async with async_session() as db:
                added = await ensure_seed_zones(db)
                added += await ensure_market_catalog(db)
            if added:
                log.info("market catalog: %d zones added this pass", added)
            results = await ingest_all_zones()
            ok = [r for r in results if r.get("ok")]
            _LAST_FULL_PASS[0] = datetime.utcnow()
            log.info("open-data pass: %d zones, %d ok, %d new places",
                     len(results), len(ok), sum(r.get("new", 0) for r in ok))
        except Exception:
            log.exception("open-data pass failed")
        await asyncio.sleep(DAILY_LOOP_EVERY.total_seconds())

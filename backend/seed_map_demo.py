"""Seed the map at its real scale — 7,640 public places across 25 markets.

    python seed_map_demo.py            # against http://localhost:8000

`seed_demo.py` seeds the *trade* network (vendors, stock, movements). This one
seeds the *directory* the map draws, because the map's performance problem is a
data-volume problem: you cannot tell whether a viewport query works until the
table holds the thousands of rows it will hold in production.

The rows are generated, not harvested from OpenStreetMap — the point is volume
and shape (clustered around real market coordinates, with realistic OSM
category keys), not provenance. Everything it writes is tagged
`source='openstreetmap'` like a real ingest row would be, so the UI treats it
exactly as it treats live data: unverified until a vendor claims it.

Idempotent: it tops the table up to DIRECTORY_SIZE and skips markets that are
already located.
"""

import asyncio
import os
import random
import sys
from datetime import datetime, timedelta

from sqlalchemy import select, text

from app.database import async_session
from app.models.market_locks import MarketZone
from app.models.public_place import PublicPlace
from app.models.vendor import Vendor

DIRECTORY_SIZE = int(os.environ.get("DIRECTORY_SIZE", "7640"))

# 25 East-African markets with real coordinates. The ingest normally geocodes
# these; here they are stated so the seed needs no network.
MARKET_COORDS = [
    ("Gikomba Market", -1.2860, 36.8280), ("Ngara Market", -1.2760, 36.8210),
    ("Kariakor Market", -1.2760, 36.8320), ("Kibera Market", -1.3130, 36.7890),
    ("Toi Market", -1.3020, 36.7750), ("Muthurwa Market", -1.2840, 36.8340),
    ("Kawangware Market", -1.2850, 36.7520), ("Kangemi Market", -1.2640, 36.7360),
    ("Rongai Market", -1.3960, 36.7440), ("Kikuyu Market", -1.2460, 36.6680),
    ("Thika Market", -1.0330, 37.0690), ("Kiambu Market", -1.1710, 36.8350),
    ("Ruiru Market", -1.1480, 36.9590), ("Juja Market", -1.1060, 37.0140),
    ("Machakos Market", -1.5170, 37.2630), ("Kitengela Market", -1.5040, 36.9660),
    ("Athi River Market", -1.4540, 36.9810), ("Ongata Rongai", -1.3960, 36.7440),
    ("Nakuru Market", -0.3030, 36.0800), ("Naivasha Market", -0.7170, 36.4320),
    ("Nyeri Market", -0.4200, 36.9510), ("Kisumu Market", -0.0910, 34.7680),
    ("Eldoret Market", 0.5140, 35.2700), ("Mombasa Marikiti", -4.0430, 39.6680),
    ("Kampala Owino", 0.3350, 32.5670),
]

CATEGORIES = [
    "shop:convenience", "shop:supermarket", "shop:greengrocer", "shop:butcher",
    "shop:electronics", "shop:mobile_phone", "shop:computer", "shop:clothes",
    "shop:shoes", "shop:fabric", "shop:hardware", "shop:wholesale",
    "shop:hairdresser", "shop:chemist", "shop:furniture", "shop:bakery",
    "amenity:pharmacy", "amenity:restaurant", "amenity:cafe", "amenity:fast_food",
    "amenity:bank", "amenity:marketplace", "craft:tailor", "craft:carpenter",
    "office:company",
]

STREETS = ["Kenyatta Ave", "Tom Mboya St", "River Rd", "Moi Ave", "Haile Selassie Ave",
           "Ngong Rd", "Jogoo Rd", "Thika Rd", "Kimathi St", "Muindi Mbingu St"]

random.seed(20261007)


def place_name(category: str, index: int) -> str:
    kind = category.split(":")[-1].replace("_", " ")
    return f"{random.choice(['Mama', 'Juma', 'Amina', 'Kamau', 'Zawadi', 'Otieno', 'Fatma', 'Brian', 'Grace', 'Hassan'])} {kind.title()} {index}"


async def locate_markets(db):
    """Markets the app knows but cannot place without the network: place them."""
    zones = (await db.execute(select(MarketZone))).scalars().all()
    placed = 0
    for zone in zones:
        if zone.center_lat is not None:
            continue
        # Match on the market name, then fall back to a deterministic pick.
        coords = next(
            ((lat, lng) for name, lat, lng in MARKET_COORDS
             if name.lower() in zone.name.lower() or zone.name.lower() in name.lower()),
            None,
        )
        if not coords:
            _, lat, lng = MARKET_COORDS[placed % len(MARKET_COORDS)]
            coords = (lat, lng)
        zone.center_lat, zone.center_lng = coords
        zone.radius_km = zone.radius_km or 3.0
        placed += 1
    await db.commit()
    return placed, len(zones)


async def locate_vendors(db):
    """Put the demo vendors on the map (around Nairobi CBD), like a real shop."""
    vendors = (await db.execute(select(Vendor))).scalars().all()
    n = 0
    for i, v in enumerate(vendors):
        if v.geo_lat is not None:
            continue
        v.geo_lat = -1.2867 + random.uniform(-0.05, 0.05)
        v.geo_lng = 36.8172 + random.uniform(-0.05, 0.05)
        n += 1
    await db.commit()
    return n, len(vendors)


async def seed_places(db, target: int):
    """Top the directory up to `target`, clustered around the markets so the
    map has real density to cluster."""
    existing = (await db.execute(
        text("SELECT count(*) FROM public_places"))).scalar() or 0
    todo = max(0, target - existing)
    if not todo:
        return 0, existing

    zones = (await db.execute(
        select(MarketZone).where(MarketZone.center_lat.is_not(None)))).scalars().all()
    if not zones:
        print("  ! no located markets — run locate first", file=sys.stderr)
        return 0, existing

    batch = []
    now = datetime.utcnow()
    for i in range(todo):
        zone = zones[i % len(zones)]
        # Most shops sit inside the market's walkable ring; a few spill out.
        spread = (zone.radius_km or 3.0) / 111.0 * (0.4 if i % 5 else 1.6)
        lat = zone.center_lat + random.gauss(0, spread)
        lng = zone.center_lng + random.gauss(0, spread)
        category = CATEGORIES[i % len(CATEGORIES)]
        batch.append(PublicPlace(
            source="openstreetmap", external_id=f"node/{10_000_000 + i}",
            name=place_name(category, i), category=category,
            detail=category.split(":")[-1],
            phone=f"+2547{random.randint(10, 99)}{random.randint(100000, 999999)}",
            opening_hours=random.choice(["Mo-Sa 08:00-18:00", "Mo-Su 07:00-20:00", "Mo-Fr 09:00-17:00", ""]),
            address=f"{random.randint(1, 200)} {random.choice(STREETS)}, {zone.city}",
            lat=round(max(-90, min(90, lat)), 6), lng=round(max(-180, min(180, lng)), 6),
            zone_id=zone.id, zone_name=zone.name,
            status="active",
            first_seen_at=now - timedelta(days=random.randint(30, 400)),
            last_checked_at=now - timedelta(days=random.randint(0, 45)),
            created_at=now, updated_at=now,
        ))
        if len(batch) >= 500:
            db.add_all(batch)
            await db.commit()
            batch = []
    if batch:
        db.add_all(batch)
        await db.commit()

    total = (await db.execute(text("SELECT count(*) FROM public_places"))).scalar() or 0
    return todo, total


async def main():
    async with async_session() as db:
        placed, zones = await locate_markets(db)
        print(f"  · located {placed}/{zones} markets")
        moved, vendors = await locate_vendors(db)
        print(f"  · located {moved}/{vendors} vendors")
        added, total = await seed_places(db, DIRECTORY_SIZE)
        print(f"  · directory: +{added} places → {total} rows")
        counts = (await db.execute(text("""
            SELECT count(*) FILTER (WHERE status IN ('active','claimed')) AS mappable,
                   count(DISTINCT zone_name) AS zones,
                   count(DISTINCT category) AS categories
              FROM public_places
        """))).first()
        print(f"  · {counts.mappable} mappable across {counts.zones} zones, {counts.categories} categories")


if __name__ == "__main__":
    print("Seeding the map directory (writes straight to DATABASE_URL — stop the API or let it share)")
    asyncio.run(main())
    print("Done. The map now draws the directory at production scale.")

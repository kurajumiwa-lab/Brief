"""The location layer: H3 cells, the zoom ladder and the cached OSM context.

Pinned properties:
  · one point has stable cells at res 9/8/7 and its parent links are real;
  · a table and a viewer in the same street cell match without a map SDK;
  · a fresh `geo_hex_cells` row answers `/street/context` with zero network;
  · a person with no pin gets an honest "set a pin" answer, not a city guess.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.database import async_session
from app.models.geo_hex import GeoHexCell
from app.models.vendor import Vendor
from app.modules.street import service
from app.services import geo_data, h3_geo
from tests.test_smoke import _auth, _register

pytestmark = pytest.mark.asyncio

KONDELE = {"lat": -0.0917, "lng": 34.7680}


async def test_h3_cells_are_stable_and_hierarchical():
    info = h3_geo.describe(KONDELE["lat"], KONDELE["lng"])
    assert info["h3_r9"] == h3_geo.cell(KONDELE["lat"], KONDELE["lng"], 9)
    assert h3_geo.parent(info["h3_r9"], 8) == info["h3_r8"]
    assert h3_geo.parent(info["h3_r8"], 7) == info["h3_r7"]
    assert info["h3_r9"] in info["rings"]["r9"]
    assert len(info["rings"]["r9"]) == 7  # the cell and its six neighbours
    assert h3_geo.valid_point(-0.1, 34.7) is True
    assert h3_geo.valid_point(100, 34.7) is False
    assert h3_geo.valid_point(None, None) is False


async def test_osm_fixtures_are_classified_and_deduplicated():
    assert geo_data.fixture_kind({"highway": "bus_stop"}) == ("transit", "Bus stage")
    assert geo_data.fixture_kind({"amenity": "marketplace"}) == ("commerce", "Market")
    assert geo_data.fixture_kind({"amenity": "school"}) == ("community", "School")

    from app.services import hex_context
    fixtures = hex_context._clean_fixtures(KONDELE["lat"], KONDELE["lng"], [
        {"external_id": "node/1", "name": "Kondele Market", "kind": "commerce",
         "kind_label": "Market", "lat": -0.0920, "lng": 34.7682},
        {"external_id": "node/1", "name": "Kondele Market duplicate", "kind": "commerce",
         "kind_label": "Market", "lat": -0.0920, "lng": 34.7682},
        {"external_id": "node/2", "name": "Kondele Stage", "kind": "transit",
         "kind_label": "Bus stage", "lat": -0.0916, "lng": 34.7678},
    ])
    assert [row["name"] for row in fixtures] == ["Kondele Stage", "Kondele Market"]
    assert fixtures[0]["distance_m"] < fixtures[-1]["distance_m"] + 1
    assert fixtures[0]["source"] == "openstreetmap"


async def test_a_saved_pin_ranks_a_table_in_the_same_street_cell(client):
    host = await _register(client, "hex_table_host", ["food"])
    guest = await _register(client, "hex_table_guest", ["food"])
    hh, hg = _auth(host["access_token"]), _auth(guest["access_token"])

    made = await client.post("/api/street/lobbies", headers=hh, json={
        "title": "Split a sack at Kondele stage", "intent": "co_buy",
        "zone": "Kondele, Kisumu", "seats": 3, "duration_minutes": 120,
        "handoff_channel": "whatsapp", "handoff_target": "0712 345 678",
        "geo_lat": KONDELE["lat"], "geo_lng": KONDELE["lng"],
    })
    assert made.status_code == 201, made.text
    lobby_id = made.json()["lobby"]["id"]
    assert made.json()["lobby"]["distance_km"] is None  # own table, no viewer point

    saved = await client.put("/api/outside/location", headers=hg, json={
        "label": "Kondele, Kisumu", "geo_lat": KONDELE["lat"], "geo_lng": KONDELE["lng"],
        "source": "gps", "radius_km": 3, "layer": "neighbourhood",
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["h3"]["r9"] == h3_geo.cell(KONDELE["lat"], KONDELE["lng"])

    listed = await client.get("/api/street/lobbies", headers=hg)
    assert listed.status_code == 200, listed.text
    page = listed.json()
    row = next(item for item in page["lobbies"] if item["id"] == lobby_id)
    assert row["distance_km"] is not None and row["distance_km"] < 1
    assert row["zoom_level"] == "street"
    assert "Same street cell" in row["match_reasons"]
    assert page["zoom"]["level"] == "street"
    assert page["viewer"]["h3"]["r9"] == h3_geo.cell(KONDELE["lat"], KONDELE["lng"])


async def test_cached_hex_context_answers_without_an_external_call(client):
    owner = await _register(client, "hex_context_owner", ["food"])
    h = _auth(owner["access_token"])
    await client.put("/api/outside/location", headers=h, json={
        "label": "Kondele, Kisumu", "geo_lat": KONDELE["lat"], "geo_lng": KONDELE["lng"],
        "source": "gps", "radius_km": 3, "layer": "neighbourhood",
    })

    cell = h3_geo.cell(KONDELE["lat"], KONDELE["lng"])
    now = datetime.now(timezone.utc)
    async with async_session() as db:
        db.add(GeoHexCell(
            h3_index=cell, resolution=9, center_lat=KONDELE["lat"], center_lng=KONDELE["lng"],
            label="Kondele, Kisumu",
            fixtures=[
                {"external_id": "node/1", "name": "Kondele Market", "kind": "commerce",
                 "kind_label": "Market", "lat": KONDELE["lat"], "lng": KONDELE["lng"],
                 "distance_m": 0, "source": "openstreetmap"},
                {"external_id": "node/2", "name": "Kondele Stage", "kind": "transit",
                 "kind_label": "Bus stage", "lat": -0.0905, "lng": 34.7678,
                 "distance_m": 145, "source": "openstreetmap"},
            ],
            fixture_count=2, source="openstreetmap", refreshed_at=now, attempted_at=now,
            created_at=now, updated_at=now,
        ))
        await db.commit()

    response = await client.get("/api/street/context", headers=h)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["available"] is True
    assert body["cache"]["cached"] is True
    assert body["cache"]["source"] == "openstreetmap"
    assert body["counts"] == {"total": 2, "transit": 1, "commerce": 1, "community": 0}
    assert body["label"] == "Kondele, Kisumu"
    assert body["groups"]["commerce"][0]["name"] == "Kondele Market"
    assert any("Kondele Market" in prompt["title"] for prompt in body["prompts"])
    assert "OpenStreetMap" in body["attribution"]


async def test_no_pin_is_an_honest_empty_state(client):
    owner = await _register(client, "hex_without_pin", ["food"])
    h = _auth(owner["access_token"])
    # A vendor can have a profile location string but no coordinates.
    async with async_session() as db:
        vendor = (await db.execute(
            select(Vendor).where(Vendor.vendor_handle == owner["vendor_handle"])
        )).scalar_one()
        vendor.geo_lat = None
        vendor.geo_lng = None
        await db.commit()
    response = await client.get("/api/street/context", headers=h)
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert body["fixtures"] == []
    assert "Set a pin" in body["reason"]

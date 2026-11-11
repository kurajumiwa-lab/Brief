"""Phase 3: my offerings. Create, edit, pause, resume, archive, pricing mode, radius, photos.

Covers the security rules that matter most: an offering can only be changed by its owner;
another person's offering is 'not found'; the request cannot set ownership or status
fields; an archived offering is hidden and cannot come back; and the public view never
shows paused or archived offers. Personal offerings need no business profile.
"""
import uuid

from sqlalchemy import select

from app.database import async_session
from app.models.stock import StockItem
from app.models.tools import ToolListing
from app.modules.schedule.models import BookableService
from tests.test_offerings import _register

GOOD = {"kind": "goods", "title": "Sukuma wiki", "category": "produce", "price": 40,
        "price_unit": "bunch", "quantity": 12, "price_mode": "fixed"}
SERVICE = {"kind": "service", "title": "Hair braiding", "price": 800, "price_mode": "fixed",
           "duration_minutes": 90, "service_radius_km": 5}
TOOL = {"kind": "tool", "title": "Market stall", "category": "popup_shop", "price": 300,
        "price_unit": "per_day", "price_mode": "negotiable", "service_radius_km": 20}


async def _create(client, headers, body):
    return await client.post("/api/offerings", headers=headers, json=body)


# ── create ────────────────────────────────────────────────────────────────────

async def test_a_person_with_no_business_can_offer_goods_a_service_and_a_tool(client):
    _, handle, headers = await _register(client, "solo")
    for body in (GOOD, SERVICE, TOOL):
        r = await _create(client, headers, body)
        assert r.status_code == 201, r.text
        item = r.json()
        assert item["status"] == "active" and item["kind"] == body["kind"]
    mine = (await client.get("/api/offerings/mine", headers=headers)).json()
    assert mine["counts"] == {"goods": 1, "service": 1, "tool": 1}


async def test_create_refuses_unknown_fields_so_ownership_cannot_be_injected(client):
    _, _, headers = await _register(client, "inject")
    other_vid, _, _ = await _register(client, "victim")
    r = await _create(client, headers, {**GOOD, "vendor_id": other_vid})
    assert r.status_code == 422


async def test_a_fixed_price_needs_an_amount(client):
    _, _, headers = await _register(client, "fixedp")
    r = await _create(client, headers, {**GOOD, "price": None})
    assert r.status_code == 422


async def test_ask_me_shows_no_price_and_refuses_one(client):
    _, _, headers = await _register(client, "askme")
    r = await _create(client, headers, {**GOOD, "price_mode": "ask_me", "price": 40})
    assert r.status_code == 422
    r = await _create(client, headers, {**GOOD, "price_mode": "ask_me", "price": None})
    assert r.status_code == 201
    assert r.json()["price"] is None and r.json()["price_mode"] == "ask_me"


async def test_negotiable_may_have_a_starting_price_or_none(client):
    _, _, headers = await _register(client, "nego")
    assert (await _create(client, headers, {**TOOL, "price": 300})).status_code == 201
    assert (await _create(client, headers, {**TOOL, "price": None})).status_code == 201


async def test_an_unknown_price_mode_is_refused(client):
    _, _, headers = await _register(client, "badmode")
    assert (await _create(client, headers, {**GOOD, "price_mode": "bargain"})).status_code == 422


async def test_service_radius_must_be_a_sensible_number_and_goods_have_none(client):
    _, _, headers = await _register(client, "radius")
    assert (await _create(client, headers, {**SERVICE, "service_radius_km": 0})).status_code == 422
    assert (await _create(client, headers, {**SERVICE, "service_radius_km": 501})).status_code == 422
    assert (await _create(client, headers, {**SERVICE, "service_radius_km": True})).status_code == 422
    assert (await _create(client, headers, {**GOOD, "service_radius_km": 5})).status_code == 422


async def test_photos_must_be_https_links_and_capped(client):
    _, _, headers = await _register(client, "photos")
    assert (await _create(client, headers, {**GOOD, "photos": ["http://x.example/a.jpg"]})).status_code == 422
    assert (await _create(client, headers, {**GOOD, "photos": ["javascript:alert(1)"]})).status_code == 422
    assert (await _create(client, headers, {**GOOD, "photos": ["https://x.example/a.jpg"] * 9})).status_code == 422
    r = await _create(client, headers, {**GOOD, "photos": ["https://x.example/a.jpg"]})
    assert r.status_code == 201 and r.json()["photos"] == ["https://x.example/a.jpg"]


async def test_a_tool_needs_a_real_category(client):
    _, _, headers = await _register(client, "cat")
    assert (await _create(client, headers, {**TOOL, "category": "spaceship"})).status_code == 422


# ── edit and ownership ────────────────────────────────────────────────────────

async def test_the_owner_can_edit_and_the_change_is_saved(client):
    _, _, headers = await _register(client, "editor")
    oid = (await _create(client, headers, GOOD)).json()["id"]
    r = await client.patch(f"/api/offerings/goods/{oid}", headers=headers,
                           json={"title": "Sukuma wiki (organic)", "price": 55, "quantity": 0})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "Sukuma wiki (organic)" and body["price"] == 55
    assert body["available"] is False  # no quantity, so not offered


async def test_another_person_cannot_edit_pause_or_archive_my_offering(client):
    _, _, owner = await _register(client, "owner")
    _, _, stranger = await _register(client, "stranger")
    oid = (await _create(client, owner, SERVICE)).json()["id"]
    assert (await client.patch(f"/api/offerings/service/{oid}", headers=stranger,
                               json={"title": "Stolen"})).status_code == 404
    assert (await client.post(f"/api/offerings/service/{oid}/status", headers=stranger,
                              json={"action": "pause"})).status_code == 404
    # the owner's data is unchanged
    mine = (await client.get("/api/offerings/mine", headers=owner)).json()["items"]
    assert [i["title"] for i in mine] == ["Hair braiding"] and mine[0]["status"] == "active"


async def test_a_wrong_kind_or_bad_id_is_not_found_not_a_crash(client):
    _, _, headers = await _register(client, "badid")
    oid = (await _create(client, headers, GOOD)).json()["id"]
    assert (await client.patch(f"/api/offerings/service/{oid}", headers=headers,
                               json={"title": "x y"})).status_code == 404
    assert (await client.patch("/api/offerings/goods/not-a-uuid", headers=headers,
                               json={"title": "x y"})).status_code == 404


async def test_an_edit_cannot_change_ownership_or_status_fields(client):
    _, _, headers = await _register(client, "fields")
    oid = (await _create(client, headers, GOOD)).json()["id"]
    r = await client.patch(f"/api/offerings/goods/{oid}", headers=headers, json={"vendor_id": str(uuid.uuid4())})
    assert r.status_code == 422
    r = await client.patch(f"/api/offerings/goods/{oid}", headers=headers, json={"visible_to_network": False})
    assert r.status_code == 422


# ── lifecycle ─────────────────────────────────────────────────────────────────

async def test_pause_and_resume_reuse_the_existing_flags(client):
    _, _, headers = await _register(client, "pause")
    oid = (await _create(client, headers, SERVICE)).json()["id"]
    r = await client.post(f"/api/offerings/service/{oid}/status", headers=headers, json={"action": "pause"})
    assert r.status_code == 200 and r.json()["status"] == "paused"
    async with async_session() as db:
        assert (await db.get(BookableService, uuid.UUID(oid))).is_active is False
    r = await client.post(f"/api/offerings/service/{oid}/status", headers=headers, json={"action": "resume"})
    assert r.json()["status"] == "active"
    async with async_session() as db:
        assert (await db.get(BookableService, uuid.UUID(oid))).is_active is True


async def test_archive_hides_the_offer_and_it_cannot_be_resumed(client):
    _, _, headers = await _register(client, "arch")
    oid = (await _create(client, headers, TOOL)).json()["id"]
    r = await client.post(f"/api/offerings/tool/{oid}/status", headers=headers, json={"action": "archive"})
    assert r.json()["status"] == "archived"
    assert (await client.get("/api/offerings/mine", headers=headers)).json()["items"] == []
    shown = (await client.get("/api/offerings/mine?include_archived=true", headers=headers)).json()["items"]
    assert [i["status"] for i in shown] == ["archived"]
    r = await client.post(f"/api/offerings/tool/{oid}/status", headers=headers, json={"action": "resume"})
    assert r.status_code == 409
    async with async_session() as db:
        row = await db.get(ToolListing, uuid.UUID(oid))
        assert row is not None and row.archived_at is not None and row.is_available is False


async def test_an_unknown_action_is_refused(client):
    _, _, headers = await _register(client, "act")
    oid = (await _create(client, headers, GOOD)).json()["id"]
    r = await client.post(f"/api/offerings/goods/{oid}/status", headers=headers, json={"action": "delete"})
    assert r.status_code == 422


async def test_the_public_view_never_shows_paused_or_archived(client):
    vid, handle, headers = await _register(client, "publicview")
    keep = (await _create(client, headers, GOOD)).json()["id"]
    pause = (await _create(client, headers, SERVICE)).json()["id"]
    gone = (await _create(client, headers, TOOL)).json()["id"]
    await client.post(f"/api/offerings/service/{pause}/status", headers=headers, json={"action": "pause"})
    await client.post(f"/api/offerings/tool/{gone}/status", headers=headers, json={"action": "archive"})
    pub = (await client.get(f"/api/offerings/of/{handle}")).json()
    titles = [i["title"] for i in pub["items"]]
    assert titles == ["Sukuma wiki"]
    assert keep and "Hair braiding" not in titles and "Market stall" not in titles


async def test_switching_to_ask_me_clears_the_stored_price(client):
    _, _, headers = await _register(client, "clear")
    oid = (await _create(client, headers, TOOL)).json()["id"]
    r = await client.patch(f"/api/offerings/tool/{oid}", headers=headers, json={"price_mode": "ask_me"})
    assert r.status_code == 200
    assert r.json()["price"] is None and r.json()["price_mode"] == "ask_me"
    async with async_session() as db:
        row = await db.get(ToolListing, uuid.UUID(oid))
        assert row.price_per_unit is None


async def test_the_offer_is_saved_in_the_existing_table_not_a_new_one(client):
    vid, _, headers = await _register(client, "tablecheck")
    oid = (await _create(client, headers, GOOD)).json()["id"]
    async with async_session() as db:
        row = (await db.execute(select(StockItem).where(StockItem.id == uuid.UUID(oid)))).scalar_one()
        assert str(row.vendor_id) == vid and row.price_mode == "fixed"

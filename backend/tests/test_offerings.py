"""Offerings: one read-only view over goods, services and tools.

Checks: all three kinds are listed for the owner; the public view shows only
network-visible / active / available rows; another person's rows never leak;
the handle lookup is case- and @-insensitive; no table is created or written by reads.
"""

import uuid

import pytest
from sqlalchemy import select

from app.database import async_session
from app.models.stock import StockItem
from app.models.tools import ToolCategory, ToolListing
from app.models.vendor import Vendor
from app.modules.schedule.models import BookableService

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, handle: str):
    suffix = uuid.uuid4().hex[:6]
    r = await client.post("/api/auth/register", json={
        "business_name": handle.title(), "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com", "password": PASSWORD,
        "business_categories": ["textiles"], "physical_location": "Kisumu",
    })
    assert r.status_code == 201, r.text
    tok = r.json()
    return tok["vendor_id"], tok["vendor_handle"], {"Authorization": f"Bearer {tok['access_token']}"}


async def _seed(vendor_id, *, visible: bool, active: bool):
    """One goods, one service and one tool for a vendor, with the given visibility flags."""
    async with async_session() as db:
        db.add(StockItem(
            vendor_id=uuid.UUID(vendor_id), name=f"Crate {uuid.uuid4().hex[:4]}", category="produce",
            quantity_in_stock=5, quantity_available=5, unit_of_measure="crate", unit_price=3500.0,
            visible_to_network=visible,
        ))
        db.add(BookableService(
            vendor_id=uuid.UUID(vendor_id), name=f"Cut {uuid.uuid4().hex[:4]}", duration_minutes=30,
            price_kes=200, is_active=active,
        ))
        db.add(ToolListing(
            vendor_id=uuid.UUID(vendor_id), category=ToolCategory.COLD_STORAGE,
            title=f"Cold room {uuid.uuid4().hex[:4]}", price_per_unit=800.0, price_unit="per_day",
            is_available=active,
        ))
        await db.commit()


async def test_owner_sees_all_three_kinds_including_hidden(client):
    vid, handle, h = await _register(client, "offr_owner")
    await _seed(vid, visible=False, active=False)
    r = await client.get("/api/offerings/mine", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"] == {"goods": 1, "service": 1, "tool": 1}
    kinds = {i["kind"] for i in body["items"]}
    assert kinds == {"goods", "service", "tool"}
    hidden = [i for i in body["items"] if i["kind"] == "goods"][0]
    assert hidden["price"] == 3500.0 and hidden["price_unit"] == "crate"
    assert all(i["available"] is False for i in body["items"] if i["kind"] in ("service", "tool"))


async def test_public_view_shows_only_visible_and_active(client):
    vid, handle, h = await _register(client, "offr_pub")
    await _seed(vid, visible=False, active=False)  # hidden: must not appear publicly
    r = await client.get(f"/api/offerings/of/{handle}")
    assert r.status_code == 200, r.text
    assert r.json()["counts"] == {"goods": 0, "service": 0, "tool": 0}

    await _seed(vid, visible=True, active=True)    # visible: must appear
    r = await client.get(f"/api/offerings/of/@{handle.upper()}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"] == {"goods": 1, "service": 1, "tool": 1}
    assert all(i["available"] for i in body["items"])


async def test_public_view_does_not_leak_other_people(client):
    a_id, a_handle, _ = await _register(client, "offr_a")
    b_id, b_handle, _ = await _register(client, "offr_b")
    await _seed(a_id, visible=True, active=True)
    r = await client.get(f"/api/offerings/of/{b_handle}")
    assert r.status_code == 200
    assert r.json()["counts"] == {"goods": 0, "service": 0, "tool": 0}


async def test_owner_view_does_not_include_other_people(client):
    a_id, _, _ = await _register(client, "offr_own_a")
    _, _, hb = await _register(client, "offr_own_b")
    await _seed(a_id, visible=True, active=True)
    r = await client.get("/api/offerings/mine", headers=hb)
    assert r.json()["counts"] == {"goods": 0, "service": 0, "tool": 0}


async def test_unknown_handle_is_404_and_mine_needs_auth(client):
    r = await client.get("/api/offerings/of/no_such_person_zz")
    assert r.status_code == 404
    r = await client.get("/api/offerings/mine")
    assert r.status_code in (401, 403)


async def test_reads_do_not_write(client):
    vid, handle, h = await _register(client, "offr_ro")
    await _seed(vid, visible=True, active=True)
    async with async_session() as db:
        before = len((await db.execute(select(StockItem).where(StockItem.vendor_id == uuid.UUID(vid)))).scalars().all())
    await client.get("/api/offerings/mine", headers=h)
    await client.get(f"/api/offerings/of/{handle}")
    async with async_session() as db:
        after = len((await db.execute(select(StockItem).where(StockItem.vendor_id == uuid.UUID(vid)))).scalars().all())
    assert before == after == 1


async def test_public_prefix_is_get_only(client):
    _, handle, _ = await _register(client, "offr_getonly")
    r = await client.post(f"/api/offerings/of/{handle}", json={})
    assert r.status_code in (401, 403, 405)

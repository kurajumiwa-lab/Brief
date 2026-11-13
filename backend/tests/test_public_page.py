"""Public Page (/api/professional/page/{handle}): no sign-in, verified credentials only,
per-way prices, and no private rows (other people's services, hidden or archived ones)."""

import uuid
from datetime import datetime

import pytest

from app.database import async_session
from app.models.credential import VendorCredential
from app.modules.offerings.service import sync_legacy_modes
from app.modules.schedule.models import (
    AvailabilityRule,
    BookableService,
)

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, handle: str):
    suffix = uuid.uuid4().hex[:6]
    r = await client.post("/api/auth/register", json={
        "business_name": f"{handle.title()} Ltd", "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com", "password": PASSWORD,
        "business_categories": ["textiles"], "physical_location": "Kisumu",
    })
    assert r.status_code == 201, r.text
    tok = r.json()
    return tok["vendor_id"], tok["vendor_handle"]


async def test_page_is_public_and_shows_per_mode_prices(client):
    vid, handle = await _register(client, "pg_pub")
    async with async_session() as db:
        svc = BookableService(vendor_id=uuid.UUID(vid), name="Fitting", duration_minutes=60,
                              price_kes=1500, price_mode="fixed", price_unit="per_visit",
                              delivery_clinic=True, delivery_home=True, is_active=True)
        db.add(svc)
        db.add(AvailabilityRule(vendor_id=uuid.UUID(vid), weekday=0, start_minute=540, end_minute=1020))
        db.add(VendorCredential(vendor_id=uuid.UUID(vid), issuing_body="KEBS", registration_number="SECRET-1",
                                title="Licensed tailor", status="verified", verified_at=datetime.utcnow()))  # noqa: DTZ003
        db.add(VendorCredential(vendor_id=uuid.UUID(vid), issuing_body="Self", registration_number="X-2",
                                title="Self claim", status="self_declared"))
        await db.commit()
        await db.refresh(svc)
        await sync_legacy_modes(db, svc)  # writes the per-way rows, as the offerings writer does
        await db.commit()

    r = await client.get(f"/api/professional/page/{handle}")  # no Authorization header
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"].lower().startswith("pg_pub")
    assert body["hours"] == [{"day": "Mon", "windows": ["09:00–17:00"]}]
    svc_out = body["services"][0]
    modes = {m["mode"]: m for m in svc_out["modes"]}
    assert set(modes) == {"in_shop", "home_visit"}
    assert modes["in_shop"]["price_kes"] == 1500 and modes["in_shop"]["price_unit"] == "per_visit"
    # Only verified registrations; the registration number never leaves the server.
    assert [c["title"] for c in body["registrations"]] == ["Licensed tailor"]
    assert "registration_number" not in body["registrations"][0]
    assert "SECRET-1" not in r.text


async def test_page_hides_archived_and_inactive_services_and_404s_unknown(client):
    vid, handle = await _register(client, "pg_hide")
    async with async_session() as db:
        db.add(BookableService(vendor_id=uuid.UUID(vid), name="Off", duration_minutes=30,
                               price_kes=100, is_active=False))
        await db.commit()
    r = await client.get(f"/api/professional/page/{handle}")
    assert r.status_code == 200, r.text
    assert r.json()["services"] == []
    assert (await client.get("/api/professional/page/no_such_handle_zz")).status_code == 404

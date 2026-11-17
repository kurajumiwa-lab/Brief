"""Pillar 2 — recurring hustle routines.

The sweep is the feature. These tests pin the three properties that matter:
  * it publishes a real, expiring `local_activities` row inside the lead window;
  * it is idempotent — a second sweep adds nothing;
  * it never invents a price, a meeting point or a payment tag.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.database import async_session
from app.modules.ledger.models import LocalActivity
from app.modules.routines import service as routine_service
from app.modules.routines.models import DAY_NAMES, RecurringRoutine, RecurringRoutineInstance
from tests.test_smoke import _auth, _register

pytestmark = pytest.mark.asyncio
NAIROBI = ZoneInfo("Africa/Nairobi")


def _next_weekday_slot(hours_ahead=2):
    target = datetime.now(NAIROBI) + timedelta(hours=hours_ahead)
    spec_day = (target.weekday() + 1) % 7          # Python Mon=0 → spec Sun=0
    return spec_day, target.time().replace(microsecond=0, tzinfo=None)


def _routine_body(**over):
    day, start = _next_weekday_slot()
    body = {
        "kind": "event",
        "title": "Friday Kisii pop-up clinic",
        "region_slug": "nyanza",
        "town": "Kisii",
        "day_of_week": day,
        "start_time_local": start.strftime("%H:%M"),
        "duration_hours": 6,
        "publish_lead_hours": 48,
        "template_payload": {
            "body": "Nurse-led blood pressure and diabetes checks. Walk in, no appointment.",
            "price_kes": 200,
            "capacity": 40,
            "meeting_point": "Kisii town, opposite the bus stage",
            "inclusions": ["BP check", "Sugar test"],
            "inferred_template": "community_learning",
            "category": "health",
            "payment_tag": {"method": "SEND_MONEY", "number": "0712345678", "name": "Clinic"},
        },
    }
    body.update(over)
    return body


async def test_sweep_publishes_once_and_has_a_share_prompt(client):
    owner = await _register(client, "routine_owner", ["health"])
    h = _auth(owner["access_token"])
    created = await client.post("/api/routines", headers=h, json=_routine_body())
    assert created.status_code == 201, created.text
    routine = created.json()
    assert routine["recurrence_label"].startswith("Weekly • Every ")
    assert routine["template"]["has_payment_tag"] is True
    rid = routine["id"]

    async with async_session() as db:
        first = await routine_service.sweep_due(db)
        await db.commit()
    assert len(first) == 1, first
    generated = first[0]

    async with async_session() as db:
        activity = await db.get(LocalActivity, __import__("uuid").UUID(generated["activity_id"]))
        assert activity is not None
        assert activity.recurrence_label == routine["recurrence_label"]
        assert activity.expires_at == activity.starts_at + timedelta(hours=6)
        assert activity.price_kes == 200 and activity.capacity == 40
        # The public activity never carries the seller's payment tag.
        assert "payment_tag" not in (activity.template_fields or {})
        assert activity.visibility == "public"

        second = await routine_service.sweep_due(db)
        await db.commit()
        assert second == []
        rows = (await db.execute(select(RecurringRoutineInstance))).scalars().all()
        assert len(rows) == 1

    mine = await client.get("/api/routines", headers=h)
    assert mine.status_code == 200
    prompt = mine.json()["share_prompts"][0]
    assert prompt["activity_id"] == generated["activity_id"]
    assert "This week's round" in prompt["share_text"] or "live" in prompt["share_text"]
    assert prompt["share_path"].startswith("/activities/")

    shared = await client.post(f"/api/routines/instances/{prompt['instance_id']}/shared", headers=h)
    assert shared.status_code == 200 and shared.json()["shared_at"]


async def test_lead_window_blocks_early_and_manual_publish_forces(client):
    owner = await _register(client, "routine_lead", ["food"])
    h = _auth(owner["access_token"])
    # A slot a week out with no lead time: nothing is due yet.
    day, start = _next_weekday_slot(hours_ahead=24 * 8)
    body = _routine_body(day_of_week=day, start_time_local=start.strftime("%H:%M"),
                         publish_lead_hours=0, title="Nairobi → Kisumu Saturday deliveries")
    created = await client.post("/api/routines", headers=h, json=body)
    assert created.status_code == 201, created.text
    rid = created.json()["id"]

    async with async_session() as db:
        assert await routine_service.sweep_due(db) == []
        await db.commit()

    forced = await client.post(f"/api/routines/{rid}/publish", headers=h)
    assert forced.status_code == 200, forced.text
    assert forced.json()["occurrence_date"]

    # The same week cannot be published twice.
    again = await client.post(f"/api/routines/{rid}/publish", headers=h)
    assert again.status_code == 409


async def test_validation_and_delete_leave_published_round_live(client):
    owner = await _register(client, "routine_valid", ["food"])
    h = _auth(owner["access_token"])

    bad_day = await client.post("/api/routines", headers=h, json=_routine_body(day_of_week=9))
    assert bad_day.status_code == 422
    bad_template = await client.post("/api/routines", headers=h, json=_routine_body(
        template_payload={"inferred_template": "not_a_template"}))
    assert bad_template.status_code == 422
    bad_time = await client.post("/api/routines", headers=h, json=_routine_body(
        start_time_local="25:99"))
    assert bad_time.status_code == 422

    created = await client.post("/api/routines", headers=h, json=_routine_body(title="Bulk-buy round"))
    rid = created.json()["id"]
    published = await client.post(f"/api/routines/{rid}/publish", headers=h)
    assert published.status_code == 200
    activity_id = published.json()["activity_id"]

    deleted = await client.delete(f"/api/routines/{rid}", headers=h)
    assert deleted.status_code == 204
    async with async_session() as db:
        assert await db.get(RecurringRoutine, __import__("uuid").UUID(rid)) is None
        activity = await db.get(LocalActivity, __import__("uuid").UUID(activity_id))
        assert activity is not None and activity.recurring_routine_id is None


async def test_pause_stops_the_sweep(client):
    owner = await _register(client, "routine_pause", ["food"])
    h = _auth(owner["access_token"])
    created = await client.post("/api/routines", headers=h, json=_routine_body(title="Paused round"))
    rid = created.json()["id"]
    paused = await client.patch(f"/api/routines/{rid}", headers=h, json={"is_active": False})
    assert paused.status_code == 200 and paused.json()["is_active"] is False
    async with async_session() as db:
        assert await routine_service.sweep_due(db) == []
        await db.commit()

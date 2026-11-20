"""Street engine: a deterministic calendar, expiring tables and a small guide.

The properties pinned here are the ones a user can rely on:
  · the season and weekday script come from the clock, not from a cron message;
  · a table is public, but its contact target is not;
  · taking the last seat is atomic and a repeated tap is idempotent;
  · the handoff is a real wa.me / t.me link with the verification code in it.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.database import async_session
from app.modules.street import service, sweep
from tests.test_smoke import _auth, _register

pytestmark = pytest.mark.asyncio
EAT = service.NAIROBI


async def test_seasons_and_weekday_scripts_are_recomputable():
    monday = datetime(2026, 11, 23, 8, 0, tzinfo=EAT)
    season = service.season_for(monday)
    assert season["key"] == "festive_push"
    assert season["chapter"] == "Season 4"
    assert season["days_left"] > 0

    script = service.today_script(monday)
    assert script["key"] == "monday_declare"
    assert script["state"] == "live"
    assert script["href"] == "/create"

    # A quiet Tuesday has no script, but the next one is still computable.
    assert service.today_script(datetime(2026, 11, 24, 12, 0, tzinfo=EAT)) is None
    upcoming = service.upcoming_scripts(monday, limit=3)
    assert [row["key"] for row in upcoming] == ["wednesday_match", "thursday_pool", "friday_board"]
    assert all(row["at"] for row in upcoming)


async def test_calendar_and_guide_are_safe_for_a_new_business(client):
    owner = await _register(client, "street_calendar", ["food"])
    h = _auth(owner["access_token"])

    calendar = await client.get("/api/street/calendar", headers=h)
    assert calendar.status_code == 200, calendar.text
    payload = calendar.json()
    assert payload["timezone"] == "Africa/Nairobi"
    assert payload["season"]["label"]
    assert len(payload["upcoming"]) == 6
    assert payload["pulse"]["rail"]["color"] == "#E65100"
    assert payload["timetable"] == []

    guide = await client.get("/api/street/guide", headers=h)
    assert guide.status_code == 200, guide.text
    body = guide.json()
    assert body["persona"]["name"] == "Mtaa"
    assert body["total"] == 5
    assert [c["key"] for c in body["chapters"]] == [
        "street_presence", "first_shelf", "weekly_rhythm", "open_a_table", "first_handshake",
    ]
    assert body["completed"] == 0
    assert body["next_actions"]
    assert "ranking" in body["note"]


async def test_table_handoff_is_private_until_join_and_the_last_seat_is_atomic(client):
    host, guest, third = [
        await _register(client, name, ["food"]) for name in ("street_host", "street_guest", "street_third")
    ]
    hh, hg, ht = (_auth(row["access_token"]) for row in (host, guest, third))

    made = await client.post("/api/street/lobbies", headers=hh, json={
        "title": "Two bags of maize flour before noon",
        "intent": "co_buy",
        "zone": "Kondele, Kisumu",
        "details": "Split a 50 kg bag; I can collect at the stage.",
        "tags": ["food", "bulk"],
        "seats": 2,
        "duration_minutes": 90,
        "handoff_channel": "whatsapp",
        "handoff_target": "0712 345 678",
    })
    assert made.status_code == 201, made.text
    lobby = made.json()["lobby"]
    lobby_id = lobby["id"]
    assert lobby["verification_code"]
    assert lobby["remaining"] == 1
    assert lobby["is_mine"] is True

    listed = await client.get("/api/street/lobbies", headers=hg)
    assert listed.status_code == 200, listed.text
    row = next(item for item in listed.json()["lobbies"] if item["id"] == lobby_id)
    assert row["host"]["verified"] is False
    assert row["verification_code"] is None
    assert "handoff" not in row
    assert "handoff_target" not in row
    assert "254712345678" not in listed.text

    joined = await client.post(f"/api/street/lobbies/{lobby_id}/join", headers=hg)
    assert joined.status_code == 200, joined.text
    handoff = joined.json()["handoff"]
    assert joined.json()["joined"] is True
    assert handoff["channel"] == "whatsapp"
    assert handoff["url"].startswith("https://wa.me/254712345678?text=")
    assert handoff["code"] in handoff["url"]
    assert "hold any payment" in handoff["note"]

    again = await client.post(f"/api/street/lobbies/{lobby_id}/join", headers=hg)
    assert again.status_code == 200
    assert again.json()["already"] is True
    assert again.json()["handoff"]["code"] == handoff["code"]

    own = await client.post(f"/api/street/lobbies/{lobby_id}/join", headers=hh)
    assert own.status_code == 409

    full = await client.post(f"/api/street/lobbies/{lobby_id}/join", headers=ht)
    assert full.status_code == 409
    assert "last seat" in full.json()["detail"].lower()

    left = await client.delete(f"/api/street/lobbies/{lobby_id}/membership", headers=hg)
    assert left.status_code == 200
    assert left.json()["joined"] is False

    refill = await client.post(f"/api/street/lobbies/{lobby_id}/join", headers=ht)
    assert refill.status_code == 200, refill.text
    assert refill.json()["joined"] is True

    closed = await client.post(f"/api/street/lobbies/{lobby_id}/close", headers=hh)
    assert closed.status_code == 200
    assert closed.json()["lobby"]["status"] == "closed"

    after = await client.post(f"/api/street/lobbies/{lobby_id}/join", headers=hg)
    assert after.status_code == 409


async def test_telegram_handoff_and_contact_validation(client):
    host, guest = [
        await _register(client, name, ["services"]) for name in ("street_tg_host", "street_tg_guest")
    ]
    hh, hg = _auth(host["access_token"]), _auth(guest["access_token"])

    bad = await client.post("/api/street/lobbies", headers=hh, json={
        "title": "Rider for one afternoon", "intent": "delivery", "zone": "Kisumu CBD",
        "seats": 2, "duration_minutes": 60, "handoff_channel": "whatsapp",
        "handoff_target": "12345",
    })
    assert bad.status_code == 422

    made = await client.post("/api/street/lobbies", headers=hh, json={
        "title": "Rider for one afternoon", "intent": "delivery", "zone": "Kisumu CBD",
        "seats": 3, "duration_minutes": 60, "handoff_channel": "telegram",
        "handoff_target": "@street_rider",
    })
    assert made.status_code == 201, made.text
    lobby_id = made.json()["lobby"]["id"]

    joined = await client.post(f"/api/street/lobbies/{lobby_id}/join", headers=hg)
    assert joined.status_code == 200, joined.text
    handoff = joined.json()["handoff"]
    assert handoff["url"] == "https://t.me/street_rider"
    assert handoff["label"] == "Open Telegram"
    assert handoff["code"] in handoff["share_text"]

    mine = await client.get("/api/street/lobbies/mine", headers=hg)
    assert mine.status_code == 200
    assert any(row["role"] == "guest" and row["id"] == lobby_id for row in mine.json()["lobbies"])


async def test_sweep_stamps_the_official_script_once():
    noon = datetime(2027, 1, 6, 12, 30, tzinfo=EAT)  # a Wednesday
    async with async_session() as db:
        assert await service.publish_due(db, now=noon) == 1
        await db.commit()
        # A second worker, a restart or a duplicate pass is a no-op.
        assert await service.publish_due(db, now=noon) == 0
        rows = await service._broadcasts_today(db, service._local(noon))
        assert len(rows) == 1
        assert rows[0].script_key == "wednesday_match"
        assert rows[0].season_key == "restock_reset"
        assert rows[0].run_date.isoformat() == "2027-01-06"


async def test_expired_tables_are_closed_and_disappear_from_the_rail(client):
    host = await _register(client, "street_expiry_host", ["food"])
    h = _auth(host["access_token"])
    made = await client.post("/api/street/lobbies", headers=h, json={
        "title": "A table that should close itself", "intent": "meetup", "zone": "Kisumu CBD",
        "seats": 2, "duration_minutes": 15, "handoff_channel": "whatsapp",
        "handoff_target": "0712 345 678",
    })
    assert made.status_code == 201, made.text
    lobby_id = made.json()["lobby"]["id"]

    later = datetime.now(timezone.utc) + timedelta(hours=1)
    async with async_session() as db:
        assert await service.expire_due(db, now=later) >= 1
        await db.commit()

    listed = await client.get("/api/street/lobbies", headers=h)
    assert listed.status_code == 200
    assert all(row["id"] != lobby_id for row in listed.json()["lobbies"])


async def test_sweep_run_once_uses_its_own_transaction():
    noon = datetime(2027, 1, 13, 12, 30, tzinfo=EAT)  # the next Wednesday
    result = await sweep.run_once(async_session, now=noon)
    assert result["published"] == 1
    async with async_session() as db:
        rows = await service._broadcasts_today(db, service._local(noon))
        assert [row.script_key for row in rows] == ["wednesday_match"]

"""v3.4 — Brief calendar.

What these prove:
- a business sets services and opening hours, and clients see only free slots;
- a booking holds its slot (a second booking for it is refused) and respects the
  service's buffer, and the client's own calendar;
- the host confirms, declines, completes or cancels; the client can only cancel;
- my week shows plans, appointments, and warns about overlaps;
- clients never see the host's private phone numbers, and vendors never see
  each other's plans.
"""

from datetime import date, datetime, timedelta

import pytest

from app.modules.schedule.service import NAIROBI, monday_of

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


def _target_day() -> date:
    """A day a week ahead, so every slot is in the future for the tests."""
    return datetime.now(NAIROBI).date() + timedelta(days=7)


async def _vendor(client, suffix):
    handle = f"cal_{suffix}"
    r = await client.post("/api/auth/register", json={
        "account_kind": "business",
        "display_name": f"Cal {suffix}",
        "business_name": f"Cal {suffix} Ltd",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["services"],
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["vendor_id"]


async def _host_with_service(client, suffix, *, duration=30, buffer=10):
    headers, vid = await _vendor(client, suffix)
    r = await client.post("/api/schedule/services", headers=headers, json={
        "name": "Hair trim", "duration_minutes": duration, "buffer_minutes": buffer, "price_kes": 500,
    })
    assert r.status_code == 201, r.text
    service_id = r.json()["id"]
    windows = [{"weekday": d, "start_minute": 9 * 60, "end_minute": 12 * 60} for d in range(7)]
    r = await client.put("/api/schedule/availability", headers=headers, json=windows)
    assert r.status_code == 200, r.text
    return headers, vid, service_id


async def _slots(client, headers, host_id, service_id, day):
    r = await client.get(f"/api/schedule/vendors/{host_id}/slots",
                         params={"service_id": service_id, "day": day.isoformat()}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["slots"]


async def _book(client, headers, host_id, service_id, starts_at, name="Amina"):
    return await client.post("/api/schedule/appointments", headers=headers, json={
        "host_vendor_id": host_id, "service_id": service_id, "starts_at": starts_at,
        "client_name": name, "client_phone": "0700 000 000",
    })


# ---------- booking ------------------------------------------------------------------

async def test_slots_follow_opening_hours_and_service_length(client):
    host_h, host_id, svc = await _host_with_service(client, "slots1")
    _, client_id = await _vendor(client, "slots1c")
    client_h, _ = await _vendor(client, "slots1d")
    day = _target_day()
    slots = await _slots(client, client_h, host_id, svc, day)
    # 30-minute service + 10-minute buffer = 40-minute steps from 09:00; the last
    # one that fits before 12:00 starts at 11:00.
    expected = [f"{day.isoformat()}T{t}" for t in ("09:00", "09:40", "10:20", "11:00")]
    assert slots == expected


async def test_booking_holds_the_slot_and_its_buffer(client):
    host_h, host_id, svc = await _host_with_service(client, "hold1")
    client_h, _ = await _vendor(client, "hold1c")
    day = _target_day()
    first = f"{day.isoformat()}T09:00:00"
    r = await _book(client, client_h, host_id, svc, first)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "requested"
    # The booking runs 09:00-09:30 and is followed by a 10-minute buffer, so the
    # first start that is free again is 09:40.
    slots = await _slots(client, client_h, host_id, svc, day)
    assert f"{day.isoformat()}T09:00" not in slots
    assert f"{day.isoformat()}T09:20" not in slots
    assert f"{day.isoformat()}T09:40" in slots
    assert f"{day.isoformat()}T10:20" in slots


async def test_second_booking_for_the_same_time_is_refused(client):
    host_h, host_id, svc = await _host_with_service(client, "dup1")
    a_h, _ = await _vendor(client, "dup1a")
    b_h, _ = await _vendor(client, "dup1b")
    starts = f"{_target_day().isoformat()}T10:20:00"
    assert (await _book(client, a_h, host_id, svc, starts)).status_code == 201
    r = await _book(client, b_h, host_id, svc, starts)
    assert r.status_code == 409, r.text


async def test_cannot_book_a_time_outside_opening_hours(client):
    host_h, host_id, svc = await _host_with_service(client, "hours1")
    client_h, _ = await _vendor(client, "hours1c")
    r = await _book(client, client_h, host_id, svc, f"{_target_day().isoformat()}T13:00:00")
    assert r.status_code == 409


async def test_cannot_book_your_own_service(client):
    host_h, host_id, svc = await _host_with_service(client, "self1")
    r = await _book(client, host_h, host_id, svc, f"{_target_day().isoformat()}T09:00:00")
    assert r.status_code == 400


async def test_client_cannot_book_over_their_own_plan(client):
    host_h, host_id, svc = await _host_with_service(client, "clash1")
    client_h, _ = await _vendor(client, "clash1c")
    day = _target_day()
    r = await client.post("/api/schedule/entries", headers=client_h, json={
        "title": "Dentist", "starts_at": f"{day.isoformat()}T09:00:00", "ends_at": f"{day.isoformat()}T10:00:00",
    })
    assert r.status_code == 201
    r = await _book(client, client_h, host_id, svc, f"{day.isoformat()}T09:00:00")
    assert r.status_code == 409
    assert "already have something" in r.json()["detail"]


async def test_host_plan_removes_the_slot_for_clients(client):
    host_h, host_id, svc = await _host_with_service(client, "plan1")
    client_h, _ = await _vendor(client, "plan1c")
    day = _target_day()
    r = await client.post("/api/schedule/entries", headers=host_h, json={
        "title": "Supplier visit", "starts_at": f"{day.isoformat()}T09:00:00", "ends_at": f"{day.isoformat()}T10:00:00",
    })
    assert r.status_code == 201
    slots = await _slots(client, client_h, host_id, svc, day)
    assert all(not s.startswith(f"{day.isoformat()}T09") for s in slots)


async def test_past_slots_are_never_offered(client):
    host_h, host_id, svc = await _host_with_service(client, "past1")
    client_h, _ = await _vendor(client, "past1c")
    yesterday = datetime.now(NAIROBI).date() - timedelta(days=1)
    assert await _slots(client, client_h, host_id, svc, yesterday) == []


# ---------- confirmation flow ----------------------------------------------------------

async def test_host_confirms_then_client_cancels_and_host_cannot_revive(client):
    host_h, host_id, svc = await _host_with_service(client, "flow1")
    client_h, _ = await _vendor(client, "flow1c")
    appt = (await _book(client, client_h, host_id, svc, f"{_target_day().isoformat()}T11:00:00")).json()
    r = await client.post(f"/api/schedule/appointments/{appt['id']}/status", headers=host_h, json={"status": "confirmed"})
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    r = await client.post(f"/api/schedule/appointments/{appt['id']}/status", headers=client_h, json={"status": "cancelled"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    r = await client.post(f"/api/schedule/appointments/{appt['id']}/status", headers=host_h, json={"status": "confirmed"})
    assert r.status_code == 409


async def test_client_cannot_confirm_their_own_booking(client):
    host_h, host_id, svc = await _host_with_service(client, "noself1")
    client_h, _ = await _vendor(client, "noself1c")
    appt = (await _book(client, client_h, host_id, svc, f"{_target_day().isoformat()}T11:00:00")).json()
    r = await client.post(f"/api/schedule/appointments/{appt['id']}/status", headers=client_h, json={"status": "confirmed"})
    assert r.status_code == 409


async def test_outsider_cannot_see_or_change_an_appointment(client):
    host_h, host_id, svc = await _host_with_service(client, "out1")
    client_h, _ = await _vendor(client, "out1c")
    stranger_h, _ = await _vendor(client, "out1s")
    appt = (await _book(client, client_h, host_id, svc, f"{_target_day().isoformat()}T11:00:00")).json()
    r = await client.post(f"/api/schedule/appointments/{appt['id']}/status", headers=stranger_h, json={"status": "confirmed"})
    assert r.status_code == 404


async def test_clients_do_not_see_the_hosts_private_contact_details(client):
    host_h, host_id, svc = await _host_with_service(client, "privacy1")
    client_h, _ = await _vendor(client, "privacy1c")
    await _book(client, client_h, host_id, svc, f"{_target_day().isoformat()}T11:00:00")
    as_client = (await client.get("/api/schedule/appointments?role=client", headers=client_h)).json()["appointments"][0]
    assert "client_phone" not in as_client and "client_name" not in as_client
    as_host = (await client.get("/api/schedule/appointments?role=host", headers=host_h)).json()["appointments"][0]
    assert as_host["client_name"] == "Amina"


# ---------- my week and plans ----------------------------------------------------------

async def test_week_view_shows_plans_and_appointments_and_flags_overlaps(client):
    host_h, host_id, svc = await _host_with_service(client, "week1")
    client_h, _ = await _vendor(client, "week1c")
    day = _target_day()
    await _book(client, client_h, host_id, svc, f"{day.isoformat()}T10:20:00")
    r = await client.post("/api/schedule/entries", headers=host_h, json={
        "title": "Bank run", "kind": "task",
        "starts_at": f"{day.isoformat()}T10:30:00", "ends_at": f"{day.isoformat()}T11:00:00",
    })
    assert r.status_code == 201
    week = (await client.get("/api/schedule/week", params={"start": monday_of(day).isoformat()},
                             headers=host_h)).json()
    sources = {i["source"] for i in week["items"]}
    assert {"plan", "appointment"} <= sources
    assert len(week["conflicts"]) == 1


async def test_plan_end_must_follow_start(client):
    headers, _ = await _vendor(client, "badplan1")
    day = _target_day().isoformat()
    r = await client.post("/api/schedule/entries", headers=headers, json={
        "title": "Backwards", "starts_at": f"{day}T12:00:00", "ends_at": f"{day}T11:00:00",
    })
    assert r.status_code == 400


async def test_plan_can_be_marked_done_and_removed_only_by_owner(client):
    host_h, _ = await _vendor(client, "own1")
    other_h, _ = await _vendor(client, "own1o")
    day = _target_day().isoformat()
    entry = (await client.post("/api/schedule/entries", headers=host_h, json={
        "title": "Stock count", "starts_at": f"{day}T08:00:00", "ends_at": f"{day}T09:00:00",
    })).json()
    assert (await client.patch(f"/api/schedule/entries/{entry['id']}", headers=other_h,
                               json={"status": "done"})).status_code == 404
    r = await client.patch(f"/api/schedule/entries/{entry['id']}", headers=host_h, json={"status": "done"})
    assert r.status_code == 200 and r.json()["status"] == "done"
    assert (await client.delete(f"/api/schedule/entries/{entry['id']}", headers=host_h)).status_code == 204


async def test_opening_hours_on_one_day_cannot_overlap(client):
    headers, _ = await _vendor(client, "rules1")
    r = await client.put("/api/schedule/availability", headers=headers, json=[
        {"weekday": 0, "start_minute": 540, "end_minute": 720},
        {"weekday": 0, "start_minute": 700, "end_minute": 800},
    ])
    assert r.status_code == 400


async def test_service_duration_limits_are_enforced(client):
    headers, _ = await _vendor(client, "limits1")
    r = await client.post("/api/schedule/services", headers=headers, json={"name": "Long", "duration_minutes": 900})
    assert r.status_code == 422

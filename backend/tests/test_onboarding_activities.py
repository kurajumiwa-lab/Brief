"""Phase 1: person-first signup and the "What do you do?" step.

Covers: a person can register with no business; every person gets a private home office;
the activity step saves a multi-select, refuses unknown keys, can be skipped and finished
later; a skip never overwrites an answer; one person's answers never leak to another.
"""
import uuid

import pytest

from tests.test_v35_offers import PASSWORD

ACTIVITY_KEYS = {
    "run_business", "professional_services", "work_for_someone", "organize_group",
    "organize_events", "seeking_services_or_opportunities", "discover_organize_information",
}


async def _person(client, prefix="pers"):
    """Registers the way the new person-first form does: a name, no business."""
    handle = f"{prefix}_{uuid.uuid4().hex[:8]}"
    r = await client.post("/api/auth/register", json={
        "account_kind": "person",
        "display_name": prefix,
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()


async def test_a_person_registers_with_no_business_and_gets_a_private_home_office(client):
    headers, body = await _person(client, "nobiz")
    assert body["account_kind"] == "person"
    offices = (await client.get("/api/office/offices/mine", headers=headers)).json()["offices"]
    assert len(offices) == 1 and offices[0]["my_role"] == "owner"
    assert offices[0]["visibility"] == "private"


async def test_a_new_person_starts_pending_with_all_seven_options_and_no_answers(client):
    headers, _ = await _person(client, "start")
    r = await client.get("/api/onboarding/activities", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "pending" and body["activities"] == []
    assert {o["key"] for o in body["options"]} == ACTIVITY_KEYS


async def test_saving_several_activities_marks_the_step_done_and_dedupes(client):
    headers, _ = await _person(client, "multi")
    r = await client.put("/api/onboarding/activities", headers=headers, json={
        "activities": ["run_business", "organize_events", "run_business", "work_for_someone"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "done"
    assert body["activities"] == ["run_business", "organize_events", "work_for_someone"]
    again = (await client.get("/api/onboarding/activities", headers=headers)).json()
    assert again["activities"] == body["activities"] and again["state"] == "done"


async def test_an_unknown_activity_is_refused_and_nothing_changes(client):
    headers, _ = await _person(client, "unk")
    r = await client.put("/api/onboarding/activities", headers=headers,
                         json={"activities": ["run_business", "rob_banks"]})
    assert r.status_code == 422
    state = (await client.get("/api/onboarding/activities", headers=headers)).json()
    assert state["state"] == "pending" and state["activities"] == []


async def test_an_empty_selection_is_refused_use_skip_instead(client):
    headers, _ = await _person(client, "empty")
    r = await client.put("/api/onboarding/activities", headers=headers, json={"activities": []})
    assert r.status_code == 422


async def test_skip_then_finish_later(client):
    headers, _ = await _person(client, "later")
    r = await client.post("/api/onboarding/activities/skip", headers=headers)
    assert r.status_code == 200 and r.json()["state"] == "skipped"
    r = await client.put("/api/onboarding/activities", headers=headers,
                         json={"activities": ["organize_group"]})
    assert r.status_code == 200 and r.json()["state"] == "done"


async def test_skip_never_overwrites_an_answer_already_given(client):
    headers, _ = await _person(client, "keep")
    await client.put("/api/onboarding/activities", headers=headers,
                     json={"activities": ["professional_services"]})
    r = await client.post("/api/onboarding/activities/skip", headers=headers)
    assert r.json()["state"] == "done"
    assert r.json()["activities"] == ["professional_services"]


async def test_one_persons_answers_are_not_visible_to_another(client):
    a, _ = await _person(client, "alice")
    b, _ = await _person(client, "bobby")
    await client.put("/api/onboarding/activities", headers=a, json={"activities": ["run_business"]})
    other = (await client.get("/api/onboarding/activities", headers=b)).json()
    assert other["state"] == "pending" and other["activities"] == []


async def test_the_activity_step_requires_sign_in(client):
    assert (await client.get("/api/onboarding/activities")).status_code == 401
    assert (await client.put("/api/onboarding/activities", json={"activities": ["run_business"]})).status_code == 401
    assert (await client.post("/api/onboarding/activities/skip")).status_code == 401


async def test_the_existing_radar_endpoint_still_answers(client):
    headers, _ = await _person(client, "radar")
    r = await client.get("/api/onboarding", headers=headers)
    assert r.status_code == 200
    assert "steps" in r.json() and "completion" in r.json()

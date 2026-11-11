"""Phase 4: workers. Assignment, scoped access, completion, reassignment, history.

Security rules under test: only owners and editors assign or manage; a worker sees only their
own work; a stranger or another worker gets 'not found'; removing a member or downgrading an
editor takes effect at once, even for work already assigned; history is visible only to the
manager and the assignee.
"""
import uuid

import pytest
from sqlalchemy import update

from app.database import async_session
from app.modules.office.models import OfficeMember
from tests.test_offerings import _register
from tests.test_v40_office import _join_account, _office


async def _world(client, prefix="w"):
    """An office with an owner and two active staff members."""
    ovid, ohandle, owner = await _register(client, f"{prefix}own")
    oid = await _office(client, owner)
    a_vid, a_handle, a = await _register(client, f"{prefix}ana")
    b_vid, b_handle, b = await _register(client, f"{prefix}ben")
    await _join_account(client, owner, oid, a, a_handle, "staff")
    await _join_account(client, owner, oid, b, b_handle, "staff")
    return {"oid": oid, "owner": owner, "a": a, "a_handle": a_handle, "a_vid": a_vid,
            "b": b, "b_handle": b_handle, "b_vid": b_vid, "owner_vid": ovid}


async def _assign(client, headers, oid, handle, title="Measure and cut"):
    return await client.post(f"/api/workers/offices/{oid}/assignments", headers=headers,
                             json={"title": title, "assignee_handle": handle, "details": "Ask at the gate"})


async def _set_membership(member_vid, oid, **values):
    async with async_session() as db:
        await db.execute(update(OfficeMember).where(
            OfficeMember.office_id == uuid.UUID(oid), OfficeMember.vendor_id == uuid.UUID(member_vid)
        ).values(**values))
        await db.commit()


# ── assigning ─────────────────────────────────────────────────────────────────

async def test_an_owner_assigns_work_to_an_active_member(client):
    w = await _world(client, "assign")
    r = await _assign(client, w["owner"], w["oid"], w["a_handle"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "assigned" and body["assignee_handle"] == w["a_handle"]
    assert body["assignee_active"] is True and body["assignee_label"] is None


async def test_an_editor_can_assign_but_a_plain_member_cannot(client):
    w = await _world(client, "editor")
    ed_vid, ed_handle, ed = await _register(client, "edtor")
    await _join_account(client, w["owner"], w["oid"], ed, ed_handle, "editor")
    assert (await _assign(client, ed, w["oid"], w["a_handle"])).status_code == 201
    assert (await _assign(client, w["a"], w["oid"], w["b_handle"])).status_code == 403


async def test_a_stranger_cannot_assign_into_the_office(client):
    w = await _world(client, "stranger")
    _, _, stranger = await _register(client, "wstr")
    assert (await _assign(client, stranger, w["oid"], w["a_handle"])).status_code in (403, 404)


async def test_work_cannot_go_to_someone_who_is_not_an_active_member(client):
    w = await _world(client, "nonmember")
    _, outsider, _ = await _register(client, "outsider")
    assert (await _assign(client, w["owner"], w["oid"], outsider)).status_code == 422
    assert (await _assign(client, w["owner"], w["oid"], "no_such_person_zz")).status_code == 404


async def test_an_invited_but_not_accepted_person_cannot_be_assigned(client):
    w = await _world(client, "invited")
    p_vid, p_handle, _ = await _register(client, "pending")
    await client.post(f"/api/office/offices/{w['oid']}/invites/account", headers=w["owner"],
                      json={"handle": p_handle, "role": "staff"})
    assert (await _assign(client, w["owner"], w["oid"], p_handle)).status_code == 422


async def test_assign_refuses_unknown_fields_so_ownership_cannot_be_injected(client):
    w = await _world(client, "inject")
    r = await client.post(f"/api/workers/offices/{w['oid']}/assignments", headers=w["owner"],
                          json={"title": "Sweep", "assignee_handle": w["a_handle"], "status": "done"})
    assert r.status_code == 422


# ── seeing work ───────────────────────────────────────────────────────────────

async def test_a_worker_sees_only_their_own_work(client):
    w = await _world(client, "scope")
    mine_a = (await _assign(client, w["owner"], w["oid"], w["a_handle"], "For Ana")).json()
    mine_b = (await _assign(client, w["owner"], w["oid"], w["b_handle"], "For Ben")).json()
    a_titles = [i["title"] for i in (await client.get("/api/workers/mine", headers=w["a"])).json()["items"]]
    b_titles = [i["title"] for i in (await client.get("/api/workers/mine", headers=w["b"])).json()["items"]]
    assert a_titles == ["For Ana"] and b_titles == ["For Ben"]
    assert (await client.get(f"/api/workers/assignments/{mine_b['id']}", headers=w["a"])).status_code == 404
    assert (await client.get(f"/api/workers/assignments/{mine_a['id']}", headers=w["a"])).status_code == 200


async def test_a_plain_worker_cannot_list_the_whole_office(client):
    w = await _world(client, "listdeny")
    await _assign(client, w["owner"], w["oid"], w["a_handle"])
    assert (await client.get(f"/api/workers/offices/{w['oid']}/assignments", headers=w["a"])).status_code == 403
    r = await client.get(f"/api/workers/offices/{w['oid']}/assignments", headers=w["owner"])
    assert r.status_code == 200 and len(r.json()["items"]) == 1


async def test_a_stranger_cannot_read_an_assignment_at_all(client):
    w = await _world(client, "readdeny")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    _, _, stranger = await _register(client, "wreader")
    assert (await client.get(f"/api/workers/assignments/{aid}", headers=stranger)).status_code == 404


async def test_done_work_is_hidden_from_mine_unless_asked_for(client):
    w = await _world(client, "done")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    await client.post(f"/api/workers/assignments/{aid}/start", headers=w["a"])
    await client.post(f"/api/workers/assignments/{aid}/complete", headers=w["a"])
    assert (await client.get("/api/workers/mine", headers=w["a"])).json()["items"] == []
    shown = (await client.get("/api/workers/mine?include_done=true", headers=w["a"])).json()["items"]
    assert [i["status"] for i in shown] == ["done"]


# ── working ───────────────────────────────────────────────────────────────────

async def test_the_worker_starts_and_completes_their_work(client):
    w = await _world(client, "work")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    r = await client.post(f"/api/workers/assignments/{aid}/start", headers=w["a"])
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    r = await client.post(f"/api/workers/assignments/{aid}/complete", headers=w["a"])
    assert r.status_code == 200 and r.json()["status"] == "done" and r.json()["completed_at"]


async def test_a_manager_can_mark_work_done_too(client):
    w = await _world(client, "mgrdone")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    assert (await client.post(f"/api/workers/assignments/{aid}/complete", headers=w["owner"])).status_code == 200


async def test_a_worker_cannot_start_twice_or_finish_cancelled_work(client):
    w = await _world(client, "states")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    await client.post(f"/api/workers/assignments/{aid}/start", headers=w["a"])
    assert (await client.post(f"/api/workers/assignments/{aid}/start", headers=w["a"])).status_code == 409
    await client.post(f"/api/workers/assignments/{aid}/cancel", headers=w["owner"])
    assert (await client.post(f"/api/workers/assignments/{aid}/complete", headers=w["a"])).status_code == 409


async def test_a_worker_cannot_reassign_cancel_or_start_someone_elses_work(client):
    w = await _world(client, "noright")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    assert (await client.post(f"/api/workers/assignments/{aid}/reassign", headers=w["a"],
                              json={"assignee_handle": w["b_handle"]})).status_code == 403
    assert (await client.post(f"/api/workers/assignments/{aid}/cancel", headers=w["a"])).status_code == 403
    assert (await client.post(f"/api/workers/assignments/{aid}/start", headers=w["b"])).status_code == 404


async def test_the_manager_cancels_open_work_and_it_cannot_come_back(client):
    w = await _world(client, "cancel")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    r = await client.post(f"/api/workers/assignments/{aid}/cancel", headers=w["owner"])
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert (await client.post(f"/api/workers/assignments/{aid}/cancel", headers=w["owner"])).status_code == 409


# ── reassignment and history ──────────────────────────────────────────────────

async def test_reassignment_moves_access_and_is_recorded(client):
    w = await _world(client, "move")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    r = await client.post(f"/api/workers/assignments/{aid}/reassign", headers=w["owner"],
                          json={"assignee_handle": w["b_handle"]})
    assert r.status_code == 200 and r.json()["assignee_handle"] == w["b_handle"]
    assert (await client.get(f"/api/workers/assignments/{aid}", headers=w["a"])).status_code == 404
    assert (await client.get(f"/api/workers/assignments/{aid}", headers=w["b"])).status_code == 200
    hist = (await client.get(f"/api/workers/assignments/{aid}/history", headers=w["owner"])).json()["items"]
    moved = [h for h in hist if h["action"] == "work_reassigned"]
    assert moved and moved[0]["details"] == {"from": w["a_handle"], "to": w["b_handle"]}


async def test_reassigning_to_the_same_person_is_refused(client):
    w = await _world(client, "same")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    r = await client.post(f"/api/workers/assignments/{aid}/reassign", headers=w["owner"],
                          json={"assignee_handle": w["a_handle"]})
    assert r.status_code == 409


async def test_history_records_the_steps_in_order_for_the_manager_and_worker_only(client):
    w = await _world(client, "hist")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    await client.post(f"/api/workers/assignments/{aid}/start", headers=w["a"])
    await client.post(f"/api/workers/assignments/{aid}/complete", headers=w["a"])
    for who in (w["owner"], w["a"]):
        acts = [h["action"] for h in (await client.get(f"/api/workers/assignments/{aid}/history",
                                                       headers=who)).json()["items"]]
        assert acts == ["work_assigned", "work_started", "work_completed"]
    _, _, stranger = await _register(client, "histx")
    assert (await client.get(f"/api/workers/assignments/{aid}/history", headers=stranger)).status_code == 404
    assert (await client.get(f"/api/workers/assignments/{aid}/history", headers=w["b"])).status_code == 404


# ── membership and role changes take effect at once ───────────────────────────

async def test_removing_a_worker_cuts_off_their_access_at_once(client):
    w = await _world(client, "remove")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    await _set_membership(w["a_vid"], w["oid"], status="removed")
    assert (await client.get("/api/workers/mine", headers=w["a"])).json()["items"] == []
    assert (await client.get(f"/api/workers/assignments/{aid}", headers=w["a"])).status_code == 404
    assert (await client.post(f"/api/workers/assignments/{aid}/start", headers=w["a"])).status_code == 404
    owner_view = (await client.get(f"/api/workers/offices/{w['oid']}/assignments", headers=w["owner"])).json()["items"]
    assert owner_view[0]["assignee_active"] is False
    r = await client.post(f"/api/workers/assignments/{aid}/reassign", headers=w["owner"],
                          json={"assignee_handle": w["b_handle"]})
    assert r.status_code == 200


async def test_a_worker_who_is_only_invited_again_gets_no_access_until_they_accept(client):
    w = await _world(client, "reinvite")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    await _set_membership(w["a_vid"], w["oid"], status="invited")
    assert (await client.get(f"/api/workers/assignments/{aid}", headers=w["a"])).status_code == 404


async def test_downgrading_an_editor_removes_their_right_to_assign_immediately(client):
    w = await _world(client, "downgrade")
    ed_vid, ed_handle, ed = await _register(client, "dgrade")
    await _join_account(client, w["owner"], w["oid"], ed, ed_handle, "editor")
    assert (await _assign(client, ed, w["oid"], w["a_handle"])).status_code == 201
    await _set_membership(str(ed_vid), w["oid"], role="member")
    assert (await _assign(client, ed, w["oid"], w["b_handle"])).status_code == 403


async def test_a_worker_keeps_their_work_when_their_role_label_changes(client):
    w = await _world(client, "label")
    aid = (await _assign(client, w["owner"], w["oid"], w["a_handle"])).json()["id"]
    await _set_membership(w["a_vid"], w["oid"], function_label="Lead fundi")
    got = (await client.get(f"/api/workers/assignments/{aid}", headers=w["a"])).json()
    assert got["assignee_label"] == "Lead fundi"


# ── input rules ───────────────────────────────────────────────────────────────

async def test_bad_input_is_refused(client):
    w = await _world(client, "badin")
    assert (await client.post(f"/api/workers/offices/{w['oid']}/assignments", headers=w["owner"],
                              json={"title": "x", "assignee_handle": w["a_handle"]})).status_code == 422
    assert (await client.get(f"/api/workers/offices/{w['oid']}/assignments?status=flying",
                             headers=w["owner"])).status_code == 422
    assert (await client.get("/api/workers/offices/not-a-uuid/assignments", headers=w["owner"])).status_code == 404


async def test_the_workers_endpoints_need_sign_in(client):
    assert (await client.get("/api/workers/mine")).status_code == 401
    assert (await client.post(f"/api/workers/assignments/{uuid.uuid4()}/start")).status_code == 401

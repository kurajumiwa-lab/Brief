"""v2.13 — Enterprise workspaces: the paid, private side of the dual model.

The scope upgrade in acceptance criteria:

    1. A vendor creates a workspace and becomes its owner; plans are priced
       in KSh and the Android Enterprise boundary is stated in the payload.
    2. Owners/admins add members by @handle; field officers register
       members and the dashboard counts those named registrations.
    3. Non-members and ordinary members cannot manage a workspace (403).
    4. Managed devices enrol under an enrolment mode; the command matrix
       refuses `wipe_device` on a work-profile phone (personal data).
    5. Without a bound EMM, a command is an audited `requested` record with
       dispatched=False — never reported as a lock/wipe that happened.
       Binding Android Enterprise alone does not dispatch either while
       deployment dispatch is disabled.
    6. Plan caps are enforced server-side (Pilot: 5 managed devices).
    7. Public workspaces are discoverable (marketplace side); private
       workspaces are never listed.
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, prefix="ent"):
    suffix = uuid.uuid4().hex[:8]
    handle = f"{prefix}_{suffix}"
    res = await client.post("/api/auth/register", json={
        "business_name": f"Business {suffix[:4]}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "phone": "254712345678",
        "password": PASSWORD,
        "business_categories": ["produce"],
        "physical_location": "Kisumu",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    return body, {"Authorization": f"Bearer {body['access_token']}"}, handle


async def _workspace(client, headers, **overrides):
    payload = {"name": overrides.pop("name", f"Traders Association {uuid.uuid4().hex[:6]}"),
               "org_type": "trade_association", "region": "Kisumu"}
    payload.update(overrides)
    res = await client.post("/api/enterprise/workspaces", headers=headers, json=payload)
    assert res.status_code == 201, res.text
    return res.json()


async def test_plans_priced_in_ksh_and_android_boundary_stated(client):
    _, headers, _ = await _register(client, "plan")
    res = await client.get("/api/enterprise/plans", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["model"] == "both"
    prices = {p["key"]: p["price_kes_monthly"] for p in body["plans"]}
    assert prices == {"pilot": 0, "association": 24500, "enterprise": 145000}
    modes = {m["mode"]: m["allowed_commands"] for m in body["android_enterprise"]["enrolment_modes"]}
    assert "wipe_device" not in modes["work_profile"]
    assert "wipe_device" in modes["fully_managed"]
    assert "does_not_provide" not in str(body["android_enterprise"].get("what_it_provides"))


async def test_create_workspace_owner_and_dashboard(client):
    _, headers, handle = await _register(client, "ownr")
    ws = await _workspace(client, headers, is_public=True)
    assert ws["my_role"] == "owner"
    assert ws["plan"]["key"] == "pilot" and ws["plan"]["max_members"] == 25
    assert ws["android"]["enterprise_bound"] is False
    assert ws["marketplace_connected"] is True

    res = await client.get(f"/api/enterprise/workspaces/{ws['id']}/dashboard", headers=headers)
    assert res.status_code == 200, res.text
    dash = res.json()["dashboard"]
    assert dash["members_by_role"] == {"owner": 1}
    assert dash["pending_device_commands"] == 0


async def test_field_officer_registrations_are_counted_by_name(client):
    _, owner, _ = await _register(client, "ownr")
    _, officer, officer_handle = await _register(client, "offc")
    _, member, member_handle = await _register(client, "mmbr")
    ws = await _workspace(client, owner)

    res = await client.post(f"/api/enterprise/workspaces/{ws['id']}/members",
                            headers=owner, json={"vendor_handle": officer_handle, "role": "field_officer"})
    assert res.status_code == 201, res.text

    # The officer — not the owner — registers the next member.
    res = await client.post(f"/api/enterprise/workspaces/{ws['id']}/members",
                            headers=officer, json={"vendor_handle": member_handle, "role": "member"})
    assert res.status_code == 201, res.text
    assert res.json()["registered_by_handle"] == officer_handle

    res = await client.get(f"/api/enterprise/workspaces/{ws['id']}/dashboard", headers=owner)
    dash = res.json()["dashboard"]
    by_officer = {row["officer_handle"]: row["registrations"]
                  for row in dash["field_registrations_last_30d"]}
    assert by_officer[officer_handle] == 1
    assert dash["field_registrations_total_30d"] == 2
    assert dash["members_by_role"]["field_officer"] == 1
    assert dash["members_by_role"]["member"] == 1


async def test_non_member_and_plain_member_cannot_manage(client):
    _, owner, _ = await _register(client, "ownr")
    _, outsider, outsider_handle = await _register(client, "outs")
    _, member, member_handle = await _register(client, "mmbr")
    ws = await _workspace(client, owner)

    res = await client.get(f"/api/enterprise/workspaces/{ws['id']}/dashboard", headers=outsider)
    assert res.status_code == 403, res.text

    await client.post(f"/api/enterprise/workspaces/{ws['id']}/members",
                      headers=owner, json={"vendor_handle": member_handle, "role": "member"})
    # A plain member can read but cannot add members or enrol devices.
    res = await client.post(f"/api/enterprise/workspaces/{ws['id']}/members",
                            headers=member, json={"vendor_handle": outsider_handle, "role": "member"})
    assert res.status_code == 403, res.text
    res = await client.post(f"/api/enterprise/workspaces/{ws['id']}/devices",
                            headers=member, json={"label": "Phone 1", "enrolment_mode": "fully_managed"})
    assert res.status_code == 403, res.text
    res = await client.get(f"/api/enterprise/workspaces/{ws['id']}/members", headers=member)
    assert res.status_code == 200, res.text


async def test_work_profile_cannot_wipe_device_and_command_is_not_dispatched(client):
    _, owner, _ = await _register(client, "ownr")
    _, officer, officer_handle = await _register(client, "offc")
    ws = await _workspace(client, owner)
    await client.post(f"/api/enterprise/workspaces/{ws['id']}/members",
                      headers=owner, json={"vendor_handle": officer_handle, "role": "field_officer"})

    res = await client.post(f"/api/enterprise/workspaces/{ws['id']}/devices", headers=owner, json={
        "label": "Officer phone", "enrolment_mode": "work_profile",
        "assigned_handle": officer_handle, "policy_name": "Field work profile",
    })
    assert res.status_code == 201, res.text
    device = res.json()
    assert "wipe_device" not in device["allowed_commands"]

    # Personal-data guardrail: a work-profile phone can never be fully wiped.
    res = await client.post(
        f"/api/enterprise/workspaces/{ws['id']}/devices/{device['id']}/commands",
        headers=owner, json={"command_type": "wipe_device", "reason": "Phone lost"})
    assert res.status_code == 400, res.text

    # Removing *company* data is allowed — but with no EMM bound it is an
    # audited request, NOT a wipe that happened.
    res = await client.post(
        f"/api/enterprise/workspaces/{ws['id']}/devices/{device['id']}/commands",
        headers=owner, json={"command_type": "wipe_work_data", "reason": "Officer left the association"})
    assert res.status_code == 201, res.text
    cmd = res.json()
    assert cmd["status"] == "requested" and cmd["dispatched"] is False
    assert "NOT sent to the device" in cmd["result_note"]

    res = await client.get(f"/api/enterprise/workspaces/{ws['id']}/dashboard", headers=owner)
    assert res.json()["dashboard"]["pending_device_commands"] == 1


async def test_binding_android_enterprise_alone_still_does_not_dispatch(client):
    _, owner, _ = await _register(client, "ownr")
    ws = await _workspace(client, owner)
    res = await client.put(f"/api/enterprise/workspaces/{ws['id']}", headers=owner, json={
        "android_enterprise_id": "enterprises/LC0123456789", "emm_provider": "example-emm"})
    assert res.status_code == 200, res.text
    assert res.json()["android"]["enterprise_bound"] is True
    # Deployment dispatch switch is off in tests: still honest `requested`.
    assert res.json()["android"]["dispatch_enabled"] is False

    res = await client.post(f"/api/enterprise/workspaces/{ws['id']}/devices", headers=owner, json={
        "label": "Field phone 1", "enrolment_mode": "fully_managed"})
    device = res.json()
    res = await client.post(
        f"/api/enterprise/workspaces/{ws['id']}/devices/{device['id']}/commands",
        headers=owner, json={"command_type": "lock", "reason": "Reported lost at the market"})
    assert res.status_code == 201, res.text
    assert res.json()["dispatched"] is False and res.json()["status"] == "requested"


async def test_pilot_device_cap_enforced_server_side(client):
    _, owner, _ = await _register(client, "ownr")
    ws = await _workspace(client, owner)
    for i in range(5):
        res = await client.post(f"/api/enterprise/workspaces/{ws['id']}/devices",
                                headers=owner, json={"label": f"Phone {i + 1}",
                                                     "enrolment_mode": "fully_managed"})
        assert res.status_code == 201, res.text
    res = await client.post(f"/api/enterprise/workspaces/{ws['id']}/devices",
                            headers=owner, json={"label": "Phone 6", "enrolment_mode": "fully_managed"})
    assert res.status_code == 403, res.text


async def test_discover_lists_public_workspaces_only_and_member_revoke(client):
    _, owner, _ = await _register(client, "ownr")
    _, seeker, seeker_handle = await _register(client, "seek")
    public_ws = await _workspace(client, owner, name=f"Public Traders {uuid.uuid4().hex[:6]}", is_public=True)
    await _workspace(client, owner, name=f"Private Traders {uuid.uuid4().hex[:6]}", is_public=False)

    res = await client.get("/api/enterprise/discover", headers=seeker)
    assert res.status_code == 200, res.text
    slugs = {w["slug"] for w in res.json()}
    assert public_ws["slug"] in slugs
    assert all(w["is_public"] for w in res.json())

    res = await client.post(f"/api/enterprise/workspaces/{public_ws['id']}/members",
                            headers=owner, json={"vendor_handle": seeker_handle, "role": "member"})
    membership_id = res.json()["id"]
    res = await client.delete(
        f"/api/enterprise/workspaces/{public_ws['id']}/members/{membership_id}", headers=owner)
    assert res.status_code == 200 and res.json()["revoked"] is True
    res = await client.get(f"/api/enterprise/workspaces/{public_ws['id']}/dashboard", headers=seeker)
    assert res.status_code == 403, res.text

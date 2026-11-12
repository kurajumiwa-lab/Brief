"""Credentials and licences (Phase 4).

Checks: the flag gates everything; a provider cannot self-verify; only an operator can verify or
reject; rejected credentials never reach the public or a front door; a registration number stays
private; having or lacking credentials does not change who appears in front doors (D3).
"""

import uuid

import pytest
from sqlalchemy import update

from app.config import settings as live_settings
from app.database import async_session
from app.models.vendor import Vendor
from tests.test_nearby_front_doors import HERE, NEAR, _doors, _offer, _place

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"
CRED = {"issuing_body": "Nursing Council of Kenya", "registration_number": "NCK-998877",
        "title": "Registered Nurse"}


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(live_settings, "CREDENTIALS_ENABLED", True)


async def _who(client, tag):
    handle = f"cr_{tag}_{uuid.uuid4().hex[:6]}"
    r = await client.post("/api/auth/register", json={
        "business_name": handle.title(), "vendor_handle": handle, "email": f"{handle}@example.com",
        "password": PASSWORD, "business_categories": ["textiles"], "physical_location": "Kisumu",
    })
    assert r.status_code == 201, r.text
    tok = r.json()
    return handle, tok["vendor_id"], {"Authorization": f"Bearer {tok['access_token']}"}


async def _add(client, h, body=CRED):
    r = await client.post("/api/credentials", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def test_flag_off_hides_every_route(client):
    _, _, h = await _who(client, "off")
    assert (await client.get("/api/credentials", headers=h)).status_code == 404
    assert (await client.post("/api/credentials", json=CRED, headers=h)).status_code == 404
    assert (await client.get("/api/ops/credentials", headers=h)).status_code == 404


async def test_provider_adds_as_self_declared_and_public_hides_the_number(client, on):
    handle, _, h = await _who(client, "decl")
    created = await _add(client, h)
    assert created["status"] == "self_declared"
    assert created["registration_number"] == CRED["registration_number"]    # owner sees it

    pub = (await client.get(f"/api/credentials/of/{handle}", headers=h)).json()["credentials"]
    assert len(pub) == 1
    assert pub[0]["status"] == "self_declared"
    assert "registration_number" not in pub[0]
    assert "NCK-998877" not in str(pub)


async def test_provider_cannot_self_verify(client, on):
    _, _, h = await _who(client, "selfv")
    created = await _add(client, h)
    r = await client.post(f"/api/ops/credentials/{created['id']}/verify", headers=h)
    assert r.status_code == 403


async def test_only_operator_verifies_and_rejects_hides_publicly(client, on, monkeypatch):
    op_handle, _, hop = await _who(client, "op")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", op_handle)
    handle, _, h = await _who(client, "prov")
    created = await _add(client, h)

    queue = (await client.get("/api/ops/credentials", headers=hop)).json()["credentials"]
    assert any(c["id"] == created["id"] for c in queue)

    v = await client.post(f"/api/ops/credentials/{created['id']}/verify", headers=hop)
    assert v.status_code == 200 and v.json()["status"] == "verified"
    pub = (await client.get(f"/api/credentials/of/{handle}", headers=h)).json()["credentials"]
    assert pub[0]["status"] == "verified"

    again = await client.post(f"/api/ops/credentials/{created['id']}/verify", headers=hop)
    assert again.status_code == 409

    other = await _add(client, h, {**CRED, "registration_number": "NCK-000111"})
    rj = await client.post(f"/api/ops/credentials/{other['id']}/reject", json={"reason": "Not on register"},
                           headers=hop)
    assert rj.status_code == 200 and rj.json()["status"] == "rejected"
    pub = (await client.get(f"/api/credentials/of/{handle}", headers=h)).json()["credentials"]
    assert all(c["status"] != "rejected" for c in pub)
    assert len(pub) == 1
    mine = (await client.get("/api/credentials", headers=h)).json()["credentials"]
    assert any(c["status"] == "rejected" and c["rejection_reason"] == "Not on register" for c in mine)


async def test_owner_removes_own_credential_only(client, on):
    _, _, h = await _who(client, "rm_a")
    _, _, hb = await _who(client, "rm_b")
    created = await _add(client, h)
    assert (await client.delete(f"/api/credentials/{created['id']}", headers=hb)).status_code == 404
    assert (await client.delete(f"/api/credentials/{created['id']}", headers=h)).status_code == 204
    assert (await client.get("/api/credentials", headers=h)).json()["credentials"] == []


async def test_front_door_carries_public_credentials_and_visibility_is_unchanged(client, on, monkeypatch):
    op_handle, _, hop = await _who(client, "fop")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", op_handle)
    me_handle, me_id, hme = await _who(client, "fme")
    await _place(me_id, *HERE)

    cred_id, cred_vid, hc = await _who(client, "fcred")
    await _place(cred_vid, *NEAR)
    await _offer(cred_vid, goods=1)
    c = await _add(client, hc)
    await client.post(f"/api/ops/credentials/{c['id']}/verify", headers=hop)

    bare_id, bare_vid, _ = await _who(client, "fbare")
    await _place(bare_vid, *NEAR)
    await _offer(bare_vid, goods=1)

    rej_id, rej_vid, hr = await _who(client, "frej")
    await _place(rej_vid, *NEAR)
    await _offer(rej_vid, goods=1)
    rc = await _add(client, hr)
    await client.post(f"/api/ops/credentials/{rc['id']}/reject", json={}, headers=hop)

    body = await _doors(client, hme, radius_km=3)
    by_handle = {d["handle"]: d for d in body["front_doors"]}
    # D3: visibility does not depend on credentials. Bare and rejected-only providers still show.
    assert cred_id in by_handle and bare_id in by_handle and rej_id in by_handle
    assert by_handle[cred_id]["credentials"][0]["status"] == "verified"
    assert by_handle[bare_id]["credentials"] == []
    assert by_handle[rej_id]["credentials"] == []
    assert "NCK-998877" not in str(body)


async def test_front_door_shape_unchanged_when_flag_off(client, monkeypatch):
    monkeypatch.setattr(live_settings, "CREDENTIALS_ENABLED", False)
    me_handle, me_id, hme = await _who(client, "offme")
    await _place(me_id, *HERE)
    other_handle, other_id, _ = await _who(client, "offo")
    await _place(other_id, *NEAR)
    await _offer(other_id, goods=1)
    body = await _doors(client, hme, radius_km=3)
    door = next(d for d in body["front_doors"] if d["handle"] == other_handle)
    assert "credentials" not in door

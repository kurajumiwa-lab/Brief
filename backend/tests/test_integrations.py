"""Ecosystem integrations (P4): the flag gates everything; the fallback ladder is one place and an
API rung is refused until an adapter exists; a failed attempt stays failed; facts are declared until an
operator verifies them; only an operator verifies; e-GP is links only."""

import uuid
from datetime import datetime, timedelta

import pytest

from app.config import settings as live_settings
from app.modules.integrations import service

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(live_settings, "INTEGRATIONS_ENABLED", True)


async def _who(client, tag):
    handle = f"in_{tag}_{uuid.uuid4().hex[:6]}"
    r = await client.post("/api/auth/register", json={
        "business_name": handle.title(), "vendor_handle": handle, "email": f"{handle}@example.com",
        "password": PASSWORD, "business_categories": ["textiles"], "physical_location": "Kisumu",
    })
    assert r.status_code == 201, r.text
    tok = r.json()
    return tok["vendor_id"], tok["vendor_handle"], {"Authorization": f"Bearer {tok['access_token']}"}


async def test_flag_off_returns_404(client, monkeypatch):
    monkeypatch.setattr(live_settings, "INTEGRATIONS_ENABLED", False)
    _, _, h = await _who(client, "off")
    assert (await client.get("/api/integrations/facts", headers=h)).status_code == 404
    assert (await client.get("/api/integrations/links", headers=h)).status_code == 404


async def test_default_is_off():
    assert live_settings.INTEGRATIONS_ENABLED is False


async def test_api_rung_refused_until_an_adapter_exists(client, on):
    _, _, h = await _who(client, "api")
    r = await client.post("/api/integrations/facts", headers=h,
                          json={"fact_kind": "etims_status", "method": "api"})
    assert r.status_code == 409, r.text
    assert "export" in r.json()["detail"] and "attested upload" in r.json()["detail"]
    listed = (await client.get("/api/integrations/facts", headers=h)).json()
    assert listed["methods"] == ["export", "attested_upload", "manual"]
    assert listed["ladder"] == ["api", "export", "attested_upload", "manual"]


async def test_export_records_declared_with_source_and_timestamp(client, on):
    _, _, h = await _who(client, "exp")
    when = (datetime.utcnow() - timedelta(days=1)).isoformat()
    r = await client.post("/api/integrations/facts", headers=h, json={
        "fact_kind": "kra_pin_tcc", "method": "export", "reference": "TCC-REF-1", "fetched_at": when,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["state"] == "declared"          # the business's own words, not verified
    assert body["source_system"] == "KRA iTax"
    assert body["fetched_at"].startswith(when[:16])
    assert body["fallback"] is None


async def test_failed_attempt_stays_failed_and_names_next_rung(client, on):
    _, _, h = await _who(client, "fail")
    r = await client.post("/api/integrations/facts", headers=h, json={
        "fact_kind": "brs_cr12", "method": "export", "outcome": "failed", "note": "Portal timed out",
    })
    assert r.status_code == 201, r.text
    assert r.json()["state"] == "failed"
    assert r.json()["fallback"] == "attested_upload"


async def test_failed_attempt_needs_a_reason(client, on):
    _, _, h = await _who(client, "noreason")
    r = await client.post("/api/integrations/facts", headers=h, json={
        "fact_kind": "brs_cr12", "method": "export", "outcome": "failed",
    })
    assert r.status_code == 422


async def test_unknown_kind_and_future_date_refused(client, on):
    _, _, h = await _who(client, "bad")
    r = await client.post("/api/integrations/facts", headers=h, json={"fact_kind": "dha_checklist", "method": "manual"})
    assert r.status_code == 422
    future = (datetime.utcnow() + timedelta(days=3)).isoformat()
    r = await client.post("/api/integrations/facts", headers=h, json={
        "fact_kind": "etims_status", "method": "manual", "fetched_at": future,
    })
    assert r.status_code == 422


async def test_only_operator_verifies_and_only_declared_facts(client, on, monkeypatch):
    _, op_handle, hop = await _who(client, "op")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", op_handle)
    _, _, h = await _who(client, "owner")
    fact = (await client.post("/api/integrations/facts", headers=h,
                              json={"fact_kind": "etims_status", "method": "attested_upload"})).json()

    assert (await client.post(f"/api/ops/integrations/facts/{fact['id']}/verify", headers=h, json={})).status_code == 403

    queue = (await client.get("/api/ops/integrations/facts", headers=hop)).json()["facts"]
    assert any(f["id"] == fact["id"] for f in queue)

    v = await client.post(f"/api/ops/integrations/facts/{fact['id']}/verify", headers=hop, json={})
    assert v.status_code == 200, v.text
    assert v.json()["state"] == "verified"
    assert v.json()["reviewed_at"] is not None
    assert v.json()["next_review_at"] is not None

    again = await client.post(f"/api/ops/integrations/facts/{fact['id']}/verify", headers=hop, json={})
    assert again.status_code == 409


async def test_failed_fact_cannot_be_verified(client, on, monkeypatch):
    _, op_handle, hop = await _who(client, "op2")
    monkeypatch.setattr(live_settings, "OPERATOR_HANDLES", op_handle)
    _, _, h = await _who(client, "owner2")
    fact = (await client.post("/api/integrations/facts", headers=h, json={
        "fact_kind": "etims_status", "method": "export", "outcome": "failed", "note": "x",
    })).json()
    r = await client.post(f"/api/ops/integrations/facts/{fact['id']}/verify", headers=hop, json={})
    assert r.status_code == 409


async def test_facts_are_private_to_their_owner(client, on):
    _, _, a = await _who(client, "ownA")
    _, _, b = await _who(client, "ownB")
    await client.post("/api/integrations/facts", headers=a, json={"fact_kind": "etims_status", "method": "manual"})
    assert (await client.get("/api/integrations/facts", headers=b)).json()["facts"] == []


async def test_egp_links_are_links_only(client, on):
    _, _, h = await _who(client, "links")
    r = await client.get("/api/integrations/links", headers=h)
    assert r.status_code == 200
    urls = [l["url"] for l in r.json()["links"]]
    assert "https://egpkenya.go.ke" in urls and "https://tenders.go.ke" in urls


async def test_ladder_helper():
    assert service.next_rung("api") == "export"
    assert service.next_rung("attested_upload") == "manual"
    assert service.next_rung("manual") is None

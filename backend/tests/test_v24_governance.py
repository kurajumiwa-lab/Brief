"""Shared-governance voting, consent, appeals and non-cash benefit foundations."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.governance import (
    AllocationPolicy, GovernanceAuditEvent, GovernanceProposal, GovernanceVote,
    VendorActivityDay, VendorDataConsent, VendorAppeal,
)
from app.models.market_locks import MarketZone
from app.models.vendor import Vendor
from app.services.governance import calculate_vendor_weights, cap_monthly_governance_participation

pytestmark = pytest.mark.asyncio
EAT = ZoneInfo("Africa/Nairobi")
PASSWORD = "Correct-horse-9"


async def _register(client, name):
    suffix = uuid.uuid4().hex[:8]
    handle = f"{name}_{suffix}"
    response = await client.post("/api/auth/register", json={
        "business_name": f"{name.title()} {suffix[:4]}", "vendor_handle": handle,
        "email": f"{handle}@example.com", "password": PASSWORD, "phone": "+254712345678",
        "business_categories": ["market governance"], "physical_location": "Nairobi",
    })
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, handle


def _ops(monkeypatch, *handles):
    monkeypatch.setattr(settings, "MARKET_OPS_ROLES", ",".join(f"admin:{handle}" for handle in handles))


async def _zone(client, admin):
    response = await client.post("/api/locks/ops/zones", headers=admin, json={
        "name": f"Governance {uuid.uuid4().hex[:5]}", "city": "Nairobi",
    })
    assert response.status_code == 201, response.text
    return response.json()


async def _make_eligible(handle, zone_id=None):
    now = datetime.utcnow()
    async with async_session() as db:
        vendor = (await db.execute(select(Vendor).where(Vendor.vendor_handle == handle))).scalar_one()
        vendor.joined_at = now - timedelta(days=45)
        vendor.phone_verified_at = now - timedelta(days=40)
        vendor.market_zone_id = zone_id
        first_day = datetime.now(EAT).date() - timedelta(days=10)
        for day in (first_day, first_day + timedelta(days=1), first_day + timedelta(days=2), first_day + timedelta(days=3), first_day + timedelta(days=4)):
            db.add(VendorActivityDay(vendor_id=vendor.id, local_day=day))
        await db.commit()
        return vendor.id


async def test_governance_requires_phone_age_zone_and_five_distinct_days_then_keeps_vote_changes(client, monkeypatch):
    admin, admin_handle = await _register(client, "govadmin")
    vendor, vendor_handle = await _register(client, "govvendor")
    other, _ = await _register(client, "govother")
    _ops(monkeypatch, admin_handle)
    zone = await _zone(client, admin)
    assert (await client.post("/api/locks/me/zone", headers=vendor, json={"zone_id": zone["id"]})).status_code == 200
    now = datetime.now(timezone.utc)
    created = await client.post("/api/governance/proposals", headers=vendor, json={
        "title": "Move the early pickup point", "summary": "Gate B has safer vehicle access before the market opens.",
        "scope": "zone", "zone_id": zone["id"], "authority": "advisory",
        "proposed_changes": {"pickup_point": "Gate B"},
        "opens_at": now.isoformat(), "closes_at": (now + timedelta(days=2)).isoformat(),
        "quorum_required": 0.2, "approval_required": 0.6,
    })
    assert created.status_code == 201, created.text
    proposal_id = created.json()["id"]

    ineligible = await client.post(f"/api/governance/proposals/{proposal_id}/votes", headers=vendor, json={"vote": "yes"})
    assert ineligible.status_code == 403
    assert "Verify your phone" in str(ineligible.json())

    assert (await client.post("/api/locks/me/zone", headers=other, json={"zone_id": zone["id"]})).status_code == 200
    await _make_eligible(vendor_handle, zone["id"])
    yes = await client.post(f"/api/governance/proposals/{proposal_id}/votes", headers=vendor, json={"vote": "yes"})
    assert yes.status_code == 200, yes.text
    changed = await client.post(f"/api/governance/proposals/{proposal_id}/votes", headers=vendor, json={"vote": "no"})
    assert changed.status_code == 200, changed.text
    denied_other = await client.post(f"/api/governance/proposals/{proposal_id}/votes", headers=other, json={"vote": "yes"})
    assert denied_other.status_code == 403

    result = await client.get(f"/api/governance/proposals/{proposal_id}/results", headers=vendor)
    assert result.status_code == 200, result.text
    assert result.json()["participants"] == 1 and result.json()["yes"] == 0 and result.json()["no"] == 1
    async with async_session() as db:
        votes = (await db.execute(select(GovernanceVote).where(GovernanceVote.proposal_id == uuid.UUID(proposal_id)))).scalars().all()
        audit = (await db.execute(select(GovernanceAuditEvent).where(GovernanceAuditEvent.entity_type == "governance_vote"))).scalars().all()
        activity = (await db.execute(select(VendorActivityDay).where(VendorActivityDay.vendor_id == votes[0].vendor_id))).scalars().all()
        assert len(votes) == 1 and votes[0].vote == "no" and votes[0].voting_weight == 1
        assert len(audit) == 2 and {entry.action for entry in audit} == {"vote_created", "vote_changed"}
        assert len({entry.local_day for entry in activity}) == len(activity)


async def test_platform_proposals_and_cooperative_member_authority_are_explicitly_gated(client, monkeypatch):
    admin, admin_handle = await _register(client, "platformadmin")
    vendor, _ = await _register(client, "platformvendor")
    _ops(monkeypatch, admin_handle)
    now = datetime.now(timezone.utc)
    payload = {
        "title": "Review the supplier reporting policy", "summary": "Compare a quarterly anonymous market report proposal.",
        "scope": "platform", "authority": "advisory", "proposed_changes": {"review": "quarterly"},
        "opens_at": now.isoformat(), "closes_at": (now + timedelta(days=2)).isoformat(),
    }
    denied = await client.post("/api/governance/proposals", headers=vendor, json=payload)
    assert denied.status_code == 403
    created = await client.post("/api/governance/proposals", headers=admin, json=payload)
    assert created.status_code == 201, created.text
    cooperative = {**payload, "authority": "cooperative_member_vote", "legal_basis": "Draft entity bylaws"}
    disabled = await client.post("/api/governance/proposals", headers=admin, json=cooperative)
    assert disabled.status_code == 400


async def test_separate_time_limited_data_consent_is_revocable_and_audited(client):
    vendor, _ = await _register(client, "consentvendor")
    future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    granted = await client.put("/api/governance/consents/lender_profile_sharing", headers=vendor, json={
        "granted": True, "expires_at": future,
    })
    assert granted.status_code == 200, granted.text
    assert granted.json()["data_class"] == "financial_restricted" and granted.json()["granted"] is True
    listing = await client.get("/api/governance/consents", headers=vendor)
    assert listing.status_code == 200
    assert len(listing.json()) == 4
    revoked = await client.put("/api/governance/consents/lender_profile_sharing", headers=vendor, json={"granted": False})
    assert revoked.status_code == 200 and revoked.json()["granted"] is False
    async with async_session() as db:
        consent = (await db.execute(select(VendorDataConsent).where(VendorDataConsent.purpose == "lender_profile_sharing"))).scalar_one()
        assert consent.granted is False and consent.revoked_at is not None


async def test_appeal_lifecycle_is_human_and_cannot_be_self_resolved(client, monkeypatch):
    admin, admin_handle = await _register(client, "appealadmin")
    vendor, _ = await _register(client, "appealvendor")
    _ops(monkeypatch, admin_handle)
    created = await client.post("/api/governance/appeals", headers=vendor, json={
        "subject_type": "moderation", "appeal_text": "Please review the removed market alert; the location details were verified.",
    })
    assert created.status_code == 201, created.text
    appeal_id = created.json()["id"]
    self_resolution = await client.post(f"/api/governance/ops/appeals/{appeal_id}/resolve", headers=vendor, json={
        "status": "under_review", "reason_code": "REVIEW", "resolution_note": "I reviewed my own case.",
    })
    assert self_resolution.status_code == 403
    acknowledged = await client.post(f"/api/governance/ops/appeals/{appeal_id}/resolve", headers=admin, json={
        "status": "acknowledged", "reason_code": "RECEIVED", "resolution_note": "A clerk has received this appeal for review.",
    })
    assert acknowledged.status_code == 200 and acknowledged.json()["status"] == "acknowledged"
    resolved = await client.post(f"/api/governance/ops/appeals/{appeal_id}/resolve", headers=admin, json={
        "status": "partially_reversed", "reason_code": "EVIDENCE_CHECKED", "resolution_note": "The location was restored; the unrelated details remain hidden.",
    })
    assert resolved.status_code == 200 and resolved.json()["status"] == "partially_reversed"
    mine = await client.get("/api/governance/appeals/me", headers=vendor)
    assert mine.json()[0]["status"] == "partially_reversed"
    async with async_session() as db:
        row = await db.get(VendorAppeal, uuid.UUID(appeal_id))
        assert row.resolved_at is not None


async def test_benefit_weight_normalization_caps_governance_monthly_and_sums_to_one():
    capped = cap_monthly_governance_participation({
        ("a", 2026, 6): 4, ("a", 2026, 7): 6, ("b", 2026, 6): 12,
    })
    assert capped == {"a": Decimal(8), "b": Decimal(4)}
    result = calculate_vendor_weights({
        "a": {"fulfilled_purchase": 90, "verified_peer_help": 1, "governance_participation": capped["a"], "reliability": 0.8},
        "b": {"fulfilled_purchase": 10, "verified_peer_help": 3, "governance_participation": capped["b"], "reliability": 0.2},
    })
    assert result["a"]["governance_participation_share"] == pytest.approx(2 / 3)
    assert result["b"]["governance_participation_share"] == pytest.approx(1 / 3)
    assert sum(row["final_weight"] for row in result.values()) == pytest.approx(1.0)
    assert result["a"]["fulfilled_purchase_share"] == pytest.approx(0.9)


async def test_allocation_policy_requires_a_distinct_second_admin_and_creates_version(client, monkeypatch):
    admin_a, handle_a = await _register(client, "policyadmina")
    admin_b, handle_b = await _register(client, "policyadminb")
    _ops(monkeypatch, handle_a, handle_b)
    now = datetime.utcnow()
    async with async_session() as db:
        zone = MarketZone(name="Policy Zone " + uuid.uuid4().hex[:5], city="Nairobi",
                          name_key="policy_" + uuid.uuid4().hex[:5], city_key="nairobi", is_active=True)
        db.add(zone)
        await db.flush()
        proposal = GovernanceProposal(
            title="Adopt the benefit-pool allocation", summary="A verified vendor vote approved these allocation rates.",
            scope="zone", authority="operationally_binding", zone_id=zone.id,
            created_by_vendor_id=uuid.UUID((await client.get("/api/vendors/me", headers=admin_a)).json()["id"]),
            proposed_changes={"allocation": "sample"}, opens_at=now - timedelta(days=2), closes_at=now - timedelta(days=1),
            quorum_required=0.2, approval_required=0.6, status="passed", legal_basis="Reviewed zone operations agreement",
        )
        db.add(proposal)
        await db.commit()
        proposal_id = proposal.id
    effective = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
    request = await client.post("/api/governance/ops/allocation-policy-requests", headers=admin_a, json={
        "operations_rate": "0.5500", "vendor_pool_rate": "0.2000", "local_ops_rate": "0.1500",
        "dispute_reserve_rate": "0.0500", "training_fund_rate": "0.0500", "effective_from": effective,
        "governance_proposal_id": str(proposal_id), "reason_code": "POLICY_VERSION", "explanation": "Version the allocation percentages from the passed zone proposal.",
    })
    assert request.status_code == 201, request.text
    request_id = request.json()["id"]
    self_approve = await client.post(f"/api/governance/ops/approvals/{request_id}/decision", headers=admin_a, json={
        "approve": True, "reason_code": "SECOND_REVIEW", "explanation": "I reviewed the proposed pool percentages.",
    })
    assert self_approve.status_code == 403
    approved = await client.post(f"/api/governance/ops/approvals/{request_id}/decision", headers=admin_b, json={
        "approve": True, "reason_code": "SECOND_REVIEW", "explanation": "I independently checked the proposal and arithmetic.",
    })
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "applied"
    async with async_session() as db:
        policies = (await db.execute(select(AllocationPolicy))).scalars().all()
        assert len(policies) == 1 and policies[0].status == "approved"
        assert policies[0].approved_by_vendor_id is not None
    policy_response = await client.get("/api/governance/benefits/allocation-policy", headers=admin_a)
    assert policy_response.status_code == 200 and policy_response.json()["active"] is False  # effective date is still in the future

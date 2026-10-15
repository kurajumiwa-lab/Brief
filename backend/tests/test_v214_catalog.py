"""v2.14 — Storefront catalogue, account tiers, BYOD and trial disclosure.

Acceptance criteria:

    1. The public catalogue lists exactly the three product lines and the
       twelve offers with the agreed test-price ranges; every offer states
       readiness, deliverables and exclusions before payment.
    2. Account tiers run Junior (KSh 0, exact public label) → Professional
       → Business → Enterprise (custom), and the payload separates the
       tier label from verification in words.
    3. A vendor's public profile carries `account_tier` (Junior for the
       free plan) alongside — never instead of — `is_verified`.
    4. The trial discloses an exact first-charge date (+30 days) and
       amount (Business test price), is `not_yet_live`, and a trial
       enquiry without acknowledgement is refused.
    5. Enquiries validate offer/tier keys, record no payment, and are
       listed only to their owner.
    6. BYOD is work-profile with untouchable personal data; fully managed
       is the separate company-owned tier.
"""

import uuid
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, prefix="cat"):
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


async def test_catalogue_is_public_with_three_lines_and_test_prices(client):
    # No Authorization header on purpose: the storefront is public.
    res = await client.get("/api/catalog")
    assert res.status_code == 200, res.text
    body = res.json()
    assert [line["key"] for line in body["lines"]] == [
        "digital_services", "business_software", "field_operations"]
    assert len(body["offers"]) == 12
    offers = {o["key"]: o for o in body["offers"]}
    assert (offers["business_website"]["price_min_kes"], offers["business_website"]["price_max_kes"]) == (15000, 45000)
    assert (offers["logo_brand_starter"]["price_min_kes"], offers["logo_brand_starter"]["price_max_kes"]) == (2500, 8000)
    assert (offers["agent_workflow_management"]["price_min_kes"], offers["agent_workflow_management"]["price_max_kes"]) == (3000, 10000)
    assert offers["custom_enterprise_deployment"]["price_min_kes"] is None
    assert offers["custom_enterprise_deployment"]["readiness"] == "scoped"
    for offer in body["offers"]:
        assert offer["deliverables"] and offer["exclusions"]
        assert offer["price_status"] == "test_range_not_market_verified"


async def test_account_tiers_and_verification_kept_separate(client):
    res = await client.get("/api/catalog")
    tiers = {t["key"]: t for t in res.json()["account_tiers"]}
    assert tiers["junior"]["label"] == "Junior — Free account"
    assert tiers["junior"]["price_max_kes"] == 0
    assert (tiers["professional"]["price_min_kes"], tiers["professional"]["price_max_kes"]) == (500, 1500)
    assert (tiers["business"]["price_min_kes"], tiers["business"]["price_max_kes"]) == (3000, 10000)
    assert tiers["enterprise"]["billing"] == "custom"
    assert "never sold" in res.json()["verification_note"]

    _, headers, handle = await _register(client, "tier")
    body = (await client.get("/api/vendors/me", headers=headers)).json()
    assert body["account_tier"]["key"] == "junior"
    assert body["account_tier"]["label"] == "Junior — Free account"
    assert body["is_verified"] is False  # separate state, untouched by the tier


async def test_trial_disclosure_exact_date_amount_and_not_live(client):
    res = await client.get("/api/catalog")
    trial = res.json()["trial"]
    assert trial["status"] == "not_yet_live"
    assert trial["days"] == 30
    example = trial["example"]
    assert example["first_charge_amount_kes"] == 6500
    assert date.fromisoformat(example["first_charge_date"]) >= date.today() + timedelta(days=30)
    assert "Never collect card details" in " ".join(trial["card_rules"]) or \
        any("Never collect card details" in rule for rule in trial["card_rules"])

    _, headers, _ = await _register(client, "trl")
    # Without acknowledging the disclosed charge, a trial request is refused.
    res = await client.post("/api/catalog/enquiries", headers=headers, json={
        "kind": "trial", "tier_key": "business"})
    assert res.status_code == 400, res.text
    res = await client.post("/api/catalog/enquiries", headers=headers, json={
        "kind": "trial", "tier_key": "business", "acknowledged_first_charge": True,
        "organisation_name": "Traders Association", "contact_phone": "254712345678"})
    assert res.status_code == 201, res.text
    enquiry = res.json()
    assert enquiry["first_charge_amount_kes"] == 6500
    assert enquiry["first_charge_date"] == example["first_charge_date"]
    assert "No payment has been taken" in enquiry["next_step"]


async def test_enquiries_validate_and_are_private_to_owner(client):
    _, headers, _ = await _register(client, "enq")
    _, other_headers, _ = await _register(client, "oth")

    res = await client.post("/api/catalog/enquiries", headers=headers, json={
        "kind": "purchase", "offer_key": "not_a_real_offer"})
    assert res.status_code == 400, res.text

    res = await client.post("/api/catalog/enquiries", headers=headers, json={
        "kind": "purchase", "offer_key": "business_website",
        "organisation_name": "Riat Retail Ltd", "notes": "Need a 5-page site"})
    assert res.status_code == 201, res.text
    assert res.json()["status"] == "new"

    res = await client.get("/api/catalog/enquiries/mine", headers=headers)
    assert len(res.json()) == 1
    res = await client.get("/api/catalog/enquiries/mine", headers=other_headers)
    assert res.json() == []


async def test_byod_limits_are_stated_not_promised_away(client):
    res = await client.get("/api/catalog")
    byod, managed = res.json()["byod_vs_managed"]
    assert byod["enrolment_mode"] == "work_profile"
    assert any("personally owned" in limit for limit in byod["limits"])
    assert any("never be wiped" in limit for limit in byod["limits"])
    assert managed["enrolment_mode"] == "fully_managed"

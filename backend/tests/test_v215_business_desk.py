"""v2.15 — the Business Desk: choose a need, then see the service.

The complaint this answers: a storefront where a business had to read twelve
long descriptions to work out what was on sale. The fix is a *buying taxonomy*
(five needs) in front of the *commercial taxonomy* (three product lines), and a
readiness rule that decides what a customer is allowed to do.

Acceptance criteria:

    1. Five desks, each with its own one-line explanation; the custom desk has
       no offers because the only honest answer to an unclassified need is a
       conversation.
    2. The existing `/api/catalog` contract is untouched: still three lines and
       twelve offers, now *additionally* grouped by desk.
    3. Every offer carries the action a customer may take, decided by its
       readiness — a pilot cannot be "purchased", and not-yet-live cannot be
       bought at all.
    4. An offer decides its own desk; an offer-less request is recorded as
       `custom` (or the named desk) and is still routable.
    5. Operators — and only operators — can read the inbox and move an enquiry
       through its status. A vendor can see their own enquiries and nobody
       else's.
    6. Nothing in the desk takes a payment or collects card details.
"""

import uuid
from datetime import date

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, prefix="desk"):
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


async def test_five_desks_each_answering_a_buying_need(client):
    res = await client.get("/api/catalog")
    assert res.status_code == 200, res.text
    desks = res.json()["desks"]

    assert [d["key"] for d in desks] == [
        "digital_services", "business_software", "field_operations",
        "device_management", "custom",
    ]
    # Every desk explains itself in one line, and that line is not empty.
    for desk in desks:
        assert desk["blurb"], desk["key"]
        assert len(desk["blurb"]) < 80, "a need must be recognisable at a glance"

    by_key = {d["key"]: d for d in desks}
    # The three commercial lines keep their offers...
    assert by_key["digital_services"]["offer_count"] == 6
    assert by_key["business_software"]["offer_count"] == 4
    # ...and field operations splits, because devices are a different decision.
    assert by_key["field_operations"]["offer_count"] == 2
    assert by_key["device_management"]["offer_count"] == 2
    # The catch-all sells nothing; the form is the product.
    assert by_key["custom"]["offer_count"] == 0
    assert by_key["custom"]["enquiry_only"] is True


async def test_the_original_catalogue_contract_is_untouched(client):
    """Additive means additive: the v2.14 payload still answers exactly."""
    body = (await client.get("/api/catalog")).json()
    assert [line["key"] for line in body["lines"]] == [
        "digital_services", "business_software", "field_operations"]
    assert len(body["offers"]) == 14
    # Every new offer field exists on the old offer list too, so a client that
    # reads only `offers` still gets the desk and the permitted action.
    for offer in body["offers"]:
        assert offer["desk"] in {d["key"] for d in body["desks"]}
        assert offer["cta"]["kind"] in {
            "purchase", "quotation", "pilot", "requirements", "interest"}


async def test_a_desk_never_has_more_offers_than_published(client):
    body = (await client.get("/api/catalog")).json()
    total = sum(d["offer_count"] for d in body["desks"])
    assert total == len(body["offers"]) == 14


async def test_the_action_follows_readiness_not_the_screen(client):
    """The guard rail: what you may do is decided server-side."""
    offers = {o["key"]: o for o in (await client.get("/api/catalog")).json()["offers"]}

    # Live today → it can be bought, so the customer may purchase or enquire.
    assert offers["customer_sales_records"]["readiness"] == "available_now"
    assert offers["customer_sales_records"]["cta"]["kind"] == "purchase"

    # Delivered by people → quotation, never a checkout button.
    assert offers["business_website"]["readiness"] == "service"
    assert offers["business_website"]["cta"]["kind"] == "quotation"

    # A pilot is sold as a pilot.
    assert offers["membership_management"]["readiness"] == "pilot"
    assert offers["membership_management"]["cta"]["kind"] == "pilot"
    assert "pilot" in offers["membership_management"]["cta"]["label"].lower()

    # No published price → requirements first.
    assert offers["custom_enterprise_deployment"]["readiness"] == "scoped"
    assert offers["custom_enterprise_deployment"]["cta"]["kind"] == "requirements"


async def test_an_offer_decides_its_own_desk(client):
    """A request cannot be mis-filed by a client that sends the wrong desk."""
    _, headers, _ = await _register(client, "deskroute")
    res = await client.post("/api/catalog/enquiries", json={
        "kind": "quotation",
        "offer_key": "android_device_enrolment",
        "desk_key": "digital_services",       # deliberately wrong
        "notes": "Fourteen field officers",
    }, headers=headers)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["desk_key"] == "device_management"
    assert body["desk_title"] == "Device management"
    # The enquiry is a lead with scope attached — never a payment.
    assert "No payment has been taken" in body["next_step"]


async def test_a_custom_request_is_routable_with_no_offer_at_all(client):
    _, headers, _ = await _register(client, "deskcustom")
    res = await client.post("/api/catalog/enquiries", json={
        "kind": "requirements",
        "desk_key": "custom",
        "organisation_name": "Kisumu Boda SACCO",
        "notes": "We need a way to track 40 riders and their daily remittances.",
    }, headers=headers)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["desk_key"] == "custom"
    assert body["offer_key"] is None
    assert body["offer_name"] is None


async def test_a_pilot_request_without_a_service_is_refused(client):
    """'Request pilot participation' still has to name something to pilot."""
    _, headers, _ = await _register(client, "deskempty")
    res = await client.post("/api/catalog/enquiries", json={
        "kind": "pilot", "desk_key": "business_software",
    }, headers=headers)
    assert res.status_code == 400, res.text
    assert "service" in res.json()["detail"].lower()


async def test_the_readiness_actions_are_accepted_and_listed(client):
    """The three desk actions are real enquiry kinds, not UI labels."""
    _, headers, _ = await _register(client, "deskinds")
    for kind, offer in (("pilot", "membership_management"),
                        ("requirements", "custom_enterprise_deployment"),
                        ("interest", "android_device_enrolment")):
        res = await client.post("/api/catalog/enquiries", json={
            "kind": kind, "offer_key": offer,
        }, headers=headers)
        assert res.status_code == 201, f"{kind}: {res.text}"
        assert res.json()["kind"] == kind

    mine = (await client.get("/api/catalog/enquiries/mine", headers=headers)).json()
    assert {e["kind"] for e in mine} == {"pilot", "requirements", "interest"}


async def test_trial_disclosure_survives_the_desk(client):
    """The desk did not loosen the trial: still Business-only, still acknowledged."""
    _, headers, _ = await _register(client, "desktrial")
    example = (await client.get("/api/catalog")).json()["trial"]["example"]

    refused = await client.post("/api/catalog/enquiries", json={
        "kind": "trial", "tier_key": "business", "acknowledged_first_charge": False,
    }, headers=headers)
    assert refused.status_code == 400

    accepted = await client.post("/api/catalog/enquiries", json={
        "kind": "trial", "tier_key": "business", "acknowledged_first_charge": True,
    }, headers=headers)
    assert accepted.status_code == 201, accepted.text
    body = accepted.json()
    assert body["first_charge_amount_kes"] == example["first_charge_amount_kes"]
    assert body["first_charge_date"] == example["first_charge_date"]


async def test_the_inbox_is_operator_work(client):
    """A vendor cannot read everyone's requests, and cannot move one."""
    _, mine, _ = await _register(client, "deskvendor")
    await client.post("/api/catalog/enquiries", json={
        "kind": "quotation", "offer_key": "business_website"},
        headers=mine)

    forbidden = await client.get("/api/catalog/enquiries", headers=mine)
    assert forbidden.status_code == 403, forbidden.text

    enquiry_id = (await client.get("/api/catalog/enquiries/mine", headers=mine)).json()[0]["id"]
    moved = await client.patch(
        f"/api/catalog/enquiries/{enquiry_id}", json={"status": "won"}, headers=mine)
    assert moved.status_code == 403, moved.text


async def test_operators_see_every_request_grouped_by_desk(client, monkeypatch):
    """With the ops role configured, the inbox answers 'what came in?'."""
    from app.config import settings

    _, admin, admin_handle = await _register(client, "deskops")
    monkeypatch.setattr(
        type(settings), "market_ops_role",
        lambda self, handle: "admin" if handle == admin_handle else None,
        raising=False,
    )

    _, vendor, _ = await _register(client, "deskbuyer")
    created = await client.post("/api/catalog/enquiries", json={
        "kind": "quotation", "offer_key": "business_website",
        "notes": "We need a shop front and a catalogue.",
    }, headers=vendor)
    assert created.status_code == 201

    inbox = await client.get("/api/catalog/enquiries", headers=admin)
    assert inbox.status_code == 200, inbox.text
    body = inbox.json()
    assert body["count"] >= 1
    assert body["unpicked"] >= 1
    item = next(i for i in body["items"] if i["id"] == created.json()["id"])
    assert item["desk_title"] == "Digital services"
    assert item["vendor_handle"]
    assert any(d["key"] == "digital_services" for d in body["by_desk"])

    # The operator moves it along; a customer can never do this themselves.
    patched = await client.patch(
        f"/api/catalog/enquiries/{item['id']}", json={"status": "contacted"}, headers=admin)
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "contacted"

    bad = await client.patch(
        f"/api/catalog/enquiries/{item['id']}", json={"status": "invented"}, headers=admin)
    assert bad.status_code == 400

"""End-to-end tests for the Local Activity Ledger, non-vendor participation,
household privacy, youth safety guardrails, Phase 2 modules, and utility metrics."""

import uuid
from datetime import datetime, timedelta

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Safe-Password-9"

KISII = (-0.68174, 34.76681)
MUTHAIGA = (-1.25284, 36.82917)


async def _register(client, *, display_name=None, business_name=None, account_kind=None,
                    location="Kisii", categories=None, geo=None):
    suffix = uuid.uuid4().hex[:8]
    handle = f"u_{suffix}"
    payload = {
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "physical_location": location,
        "business_categories": categories or [],
    }
    if display_name is not None:
        payload["display_name"] = display_name
    if business_name is not None:
        payload["business_name"] = business_name
    if account_kind is not None:
        payload["account_kind"] = account_kind
    r = await client.post("/api/auth/register", json=payload)
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    if geo:
        up = await client.put("/api/vendors/me", json={"geo_lat": geo[0], "geo_lng": geo[1]}, headers=headers)
        assert up.status_code == 200, up.text
    return headers, r.json()


# ── 1. Non-vendor participation by default ────────────────────────────────────

async def test_household_and_person_signup_without_business_profile(client):
    home_headers, home_tok = await _register(
        client, display_name="Moraa Homestead", account_kind="household", location="Nyanchwa, Kisii"
    )
    assert home_tok["account_kind"] == "household"

    me = (await client.get("/api/vendors/me", headers=home_headers)).json()
    assert me["display_name"] == "Moraa Homestead"
    assert me["account_kind"] == "household"
    assert me["hide_exact_location"] is True

    # Plain person signup with only display_name defaults to `person`, not `business`
    person_headers, person_tok = await _register(client, display_name="Otieno Neighbour")
    assert person_tok["account_kind"] == "person"
    p_me = (await client.get("/api/vendors/me", headers=person_headers)).json()
    assert p_me["account_kind"] == "person"
    assert p_me["hide_exact_location"] is True

    # Legacy B2B payload (`business_name` only) preserves `business` default
    biz_headers, biz_tok = await _register(client, business_name="Kisii Hardware Ltd")
    assert biz_tok["account_kind"] == "business"
    b_me = (await client.get("/api/vendors/me", headers=biz_headers)).json()
    assert b_me["account_kind"] == "business"


# ── 2. Four primary posting types + deterministic category inference ──────────

async def test_four_posting_types_and_category_inference(client):
    headers, _ = await _register(client, display_name="Wanjiku", account_kind="household")

    # 1. Wanted -> repair_artisan
    r_wanted = await client.post("/api/ledger/activities", json={
        "posting_type": "wanted",
        "title": "Fence repair needed on Saturday",
        "body": "Fence repair needed on Saturday. Approximately 20 metres. Please quote.",
        "area_name": "Nyanchwa, Kisii",
    }, headers=headers)
    assert r_wanted.status_code == 201, r_wanted.text
    assert r_wanted.json()["inferred_template"] == "repair_artisan"
    assert r_wanted.json()["price_kes"] is None

    # 2. Available -> agricultural_produce_fodder
    r_avail = await client.post("/api/ledger/activities", json={
        "posting_type": "available",
        "title": "Surplus Napier grass",
        "body": "Freshly cut Napier grass available for pickup at the homestead.",
        "quantity": 12.5,
        "unit": "bales",
        "area_name": "Suneka, Kisii",
    }, headers=headers)
    assert r_avail.status_code == 201, r_avail.text
    assert r_avail.json()["inferred_template"] == "agricultural_produce_fodder"
    assert r_avail.json()["template_fields"]["quantity"] == 12.5

    # 3. Scheduled -> travelling_round
    starts = (datetime.utcnow() + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    r_sched = await client.post("/api/ledger/activities", json={
        "posting_type": "scheduled",
        "title": "Cobbler round in Muthaiga",
        "body": "Visiting Muthaiga this Thursday for shoe stitching and leather repair.",
        "starts_at": starts.isoformat(),
        "capacity": 6,
        "area_name": "Muthaiga",
    }, headers=headers)
    assert r_sched.status_code == 201, r_sched.text
    assert r_sched.json()["inferred_template"] == "travelling_round"

    # 4. Opportunity -> group_sourcing
    r_opp = await client.post("/api/ledger/activities", json={
        "posting_type": "opportunity",
        "title": "Bulk order of cattle fodder",
        "body": "Let us join a group order for Boma Rhodes hay bales delivered to Kisii.",
        "target_quantity": 50.0,
        "unit": "bales",
        "area_name": "Kisii",
    }, headers=headers)
    assert r_opp.status_code == 201, r_opp.text
    assert r_opp.json()["inferred_template"] == "group_sourcing"


# ── 3. Full 6-stage lifecycle, non-custodial invariant & household privacy ────

async def test_full_fence_repair_lifecycle_and_privacy_gate(client):
    home, _ = await _register(
        client, display_name="Moraa Household", account_kind="household",
        location="Kisii", geo=KISII
    )
    juma, juma_tok = await _register(
        client, display_name="Juma Fencing Fundi", account_kind="artisan",
        location="Kisii", categories=["repairs", "fencing"], geo=(-0.684, 34.770)
    )
    peter, peter_tok = await _register(
        client, display_name="Peter Timber & Fence", account_kind="artisan",
        location="Kisii", categories=["repairs", "fencing"], geo=(-0.690, 34.775)
    )

    # Juma sets a watch preference for repair Wanted posts in Kisii
    w = await client.post("/api/ledger/watches", json={
        "label": "Kisii fencing & repairs",
        "posting_types": ["wanted"],
        "categories": ["repairs"],
        "area_name": "Kisii",
        "radius_km": 15,
    }, headers=juma)
    assert w.status_code == 201, w.text

    # Step 1 & 2: Moraa publishes Wanted fence repair with private gate directions
    pub = await client.post("/api/ledger/activities", json={
        "posting_type": "wanted",
        "title": "Fence repair needed on Saturday",
        "body": "Fence repair needed on Saturday. Approximately 20 metres. Please quote.",
        "area_name": "Nyanchwa, Kisii",
        "geo_lat": KISII[0],
        "geo_lng": KISII[1],
        "private_directions": "Gate 4 behind Nyanchwa Primary, green kei-apple hedge",
        "scope_measure": "20 metres",
        "preferred_window": "Saturday 8am–2pm",
    }, headers=home)
    assert pub.status_code == 201, pub.text
    act_id = pub.json()["id"]
    assert pub.json()["notified_count"] >= 1
    assert pub.json()["lifecycle_status"] == "notified"

    # Juma received the notification and acts upon it
    act_feed = (await client.get("/api/outside/activity", headers=juma)).json()
    all_notifs = [item for g in act_feed["groups"] for item in g["items"]]
    match_notifs = [n for n in all_notifs if (n.get("data") or {}).get("activity_id") == act_id]
    assert match_notifs, "Juma's watch should have delivered a notification"
    acted = await client.post(f"/api/ledger/notifications/{match_notifs[0]['id']}/acted", headers=juma)
    assert acted.status_code == 200

    # Privacy check BEFORE booking: Juma sees approximate coords & NO private directions
    before = (await client.get(f"/api/ledger/activities/{act_id}", headers=juma)).json()
    assert before["private_directions"] is None
    assert before["has_private_directions"] is True
    assert before["private_directions_unlocked"] is False
    assert before["geo_lat"] == round(KISII[0], 2)
    assert before["geo_lng"] == round(KISII[1], 2)

    # Step 3: Juma and Peter submit quotations
    r1 = await client.post(f"/api/ledger/activities/{act_id}/responses", json={
        "quoted_price_kes": 8500,
        "availability_window": "Saturday 8:00am",
        "proposed_completion_time": "Same day by 3:00pm",
        "relevant_experience": "12 cedar & barbed-wire homestead fences around Kisii",
        "note": "Includes treated posts realignment and wire tensioning.",
    }, headers=juma)
    assert r1.status_code == 201, r1.text
    resp_juma_id = r1.json()["id"]

    r2 = await client.post(f"/api/ledger/activities/{act_id}/responses", json={
        "quoted_price_kes": 9800,
        "availability_window": "Saturday 10:00am",
        "proposed_completion_time": "Sunday noon",
        "note": "Labour plus nails included.",
    }, headers=peter)
    assert r2.status_code == 201

    # Peter cannot read Juma's quote; Moraa sees both
    peter_view = (await client.get(f"/api/ledger/activities/{act_id}", headers=peter)).json()
    assert len(peter_view["responses"]) == 1
    assert peter_view["responses"][0]["responder"]["id"] == peter_tok["vendor_id"]

    home_view = (await client.get(f"/api/ledger/activities/{act_id}", headers=home)).json()
    assert len(home_view["responses"]) == 2
    assert home_view["lifecycle_status"] == "responses_received"

    # Step 4: Non-custodial guardrail — custodial/escrow settlement is rejected!
    bad_booking = await client.post(f"/api/ledger/activities/{act_id}/bookings", json={
        "response_id": resp_juma_id,
        "settlement_method": "platform_escrow",
    }, headers=home)
    assert bad_booking.status_code == 422
    assert "non-custodial" in bad_booking.json()["detail"]

    # Confirm non-custodial booking with Juma, unlocking private directions for the agreed work
    bk = await client.post(f"/api/ledger/activities/{act_id}/bookings", json={
        "response_id": resp_juma_id,
        "settlement_method": "direct_mpesa",
        "agreed_price_kes": 8500,
        "share_private_directions": True,
    }, headers=home)
    assert bk.status_code == 201, bk.text
    booking_id = bk.json()["id"]
    assert bk.json()["custody_mode"] == "non_custodial"

    # Juma NOW sees private directions; Peter STILL cannot!
    during_juma = (await client.get(f"/api/ledger/activities/{act_id}", headers=juma)).json()
    assert "Gate 4 behind Nyanchwa Primary" in during_juma["private_directions"]
    assert during_juma["private_directions_unlocked"] is True

    during_peter = (await client.get(f"/api/ledger/activities/{act_id}", headers=peter)).json()
    assert during_peter["private_directions"] is None

    # Step 5: Record an agreed scope/price change, then two-party completion
    chg = await client.post(f"/api/ledger/bookings/{booking_id}/changes", json={
        "summary": "Added replacement of broken wooden gate latch (+KSh 700)",
        "revised_price_kes": 9200,
    }, headers=home)
    assert chg.status_code == 200
    assert chg.json()["agreed_price_kes"] == 9200

    c1 = await client.post(f"/api/ledger/bookings/{booking_id}/confirm-completion", json={
        "note": "Fence taut and latch fitted nicely",
    }, headers=home)
    assert c1.status_code == 200
    assert c1.json()["both_confirmed"] is False
    assert c1.json()["status"] == "organizer_completed"

    c2 = await client.post(f"/api/ledger/bookings/{booking_id}/confirm-completion", json={
        "note": "Paid directly via M-Pesa, thank you",
    }, headers=juma)
    assert c2.status_code == 200
    assert c2.json()["both_confirmed"] is True
    assert c2.json()["status"] == "completed"
    assert c2.json()["activity_lifecycle_status"] == "completed"

    # Step 6: Reusable record privacy lock — private directions automatically re-lock!
    after_juma = (await client.get(f"/api/ledger/activities/{act_id}", headers=juma)).json()
    assert after_juma["private_directions"] is None
    assert after_juma["private_directions_unlocked"] is False
    stages = {s["key"]: s["done"] for s in after_juma["lifecycle_stages"]}
    assert all(stages.values()), stages

    # Mutual factual feedback
    fb1 = await client.post(f"/api/ledger/bookings/{booking_id}/feedback", json={
        "outcome": "completed_with_changes",
        "would_repeat": True,
        "tags": ["arrived_on_time", "quality_work"],
        "note": "Clear quote and solid cedar posts.",
    }, headers=home)
    assert fb1.status_code == 201

    # Save Juma as trusted artisan + check alternatives (Peter appears as alternative!)
    saved = await client.post("/api/ledger/relationships", json={
        "target_vendor_id": juma_tok["vendor_id"],
        "relationship_kind": "artisan",
        "label": "Trusted fencing fundi",
        "categories": ["repairs", "fencing"],
        "private_note": "Knows the steep corner by the orchard",
    }, headers=home)
    assert saved.status_code == 201
    assert saved.json()["completed_together_count"] == 1

    alts = (await client.get("/api/ledger/alternatives", params={
        "category": "repairs",
        "area": "Kisii",
        "exclude_vendor_id": juma_tok["vendor_id"],
    }, headers=home)).json()
    alt_ids = [a["id"] for a in alts["alternatives"]]
    assert peter_tok["vendor_id"] in alt_ids

    # Repeat booking from reusable record: creates new activity, private directions locked again
    rep = await client.post(f"/api/ledger/bookings/{booking_id}/repeat", json={
        "title": " Orchard paddock fence repair (15m)",
        "schedule_label": "Next Saturday morning",
    }, headers=home)
    assert rep.status_code == 201, rep.text
    new_act_id = rep.json()["id"]
    rep_juma_view = (await client.get(f"/api/ledger/activities/{new_act_id}", headers=juma)).json()
    assert rep_juma_view["private_directions"] is None


# ── 4. Phase 2B & 2C: Fractional group fodder order & travelling cobbler round ─

async def test_fractional_group_sourcing_and_travelling_cobbler_round(client):
    # Agricultural group sourcing with Float quantities
    org, _ = await _register(client, display_name="Bosongo Dairy Homestead", account_kind="household", location="Kisii")
    fam1, _ = await _register(client, display_name="Nyaboke Farm", account_kind="household", location="Kisii")
    fam2, _ = await _register(client, display_name="Ombati Homestead", account_kind="household", location="Kisii")

    grp = await client.post("/api/ledger/activities", json={
        "posting_type": "opportunity",
        "title": "Group order: Boma Rhodes hay & dairy fodder",
        "body": "Pooling a bulk order of cattle fodder to share transport from Nakuru to Kisii.",
        "target_quantity": 10.0,
        "unit": "tonnes",
        "estimated_unit_price_kes": 14000,
        "dropoff_area": "Nyanchwa junction",
        "area_name": "Kisii",
    }, headers=org)
    assert grp.status_code == 201
    grp_id = grp.json()["id"]

    p1 = await client.post(f"/api/ledger/activities/{grp_id}/responses", json={
        "quantity": 2.5,
        "unit": "tonnes",
        "note": "2.5 tonnes for our four Friesians",
    }, headers=fam1)
    assert p1.status_code == 201
    assert p1.json()["quantity"] == 2.5

    p2 = await client.post(f"/api/ledger/activities/{grp_id}/responses", json={
        "quantity": 3.75,
        "unit": "tonnes",
        "note": "3.75 tonnes, will collect at Nyanchwa",
    }, headers=fam2)
    assert p2.status_code == 201

    grp_detail = (await client.get(f"/api/ledger/activities/{grp_id}", headers=org)).json()
    assert grp_detail["template_fields"]["pledged_quantity"] == 6.25
    assert grp_detail["template_fields"]["progress_pct"] == 62.5

    # Travelling cobbler round in Muthaiga with ordered private stops
    cobbler, _ = await _register(
        client, display_name="Mzee Kamau Cobbler", account_kind="artisan",
        location="Muthaiga", categories=["cobbler", "repairs"], geo=MUTHAIGA
    )
    h1, _ = await _register(client, display_name="Muthaiga Home A", account_kind="household", location="Muthaiga")
    h2, _ = await _register(client, display_name="Muthaiga Home B", account_kind="household", location="Muthaiga")

    round_dt = (datetime.utcnow() + timedelta(days=3)).replace(hour=9, minute=0, second=0, microsecond=0)
    rnd = await client.post("/api/ledger/activities", json={
        "posting_type": "scheduled",
        "title": "Thursday Muthaiga Cobbler Round",
        "body": "Regular cobbler round across Old Muthaiga and Muthaiga North — 6 household stops.",
        "starts_at": round_dt.isoformat(),
        "capacity": 6,
        "area_name": "Muthaiga",
        "route_corridor": "Limuru Rd -> Tchui Rd -> Naivasha Ave",
        "services_offered": "Sole stitching, heel tips, leather polish & bag zips",
    }, headers=cobbler)
    assert rnd.status_code == 201
    rnd_id = rnd.json()["id"]
    assert rnd.json()["inferred_template"] == "travelling_round"

    s1 = await client.post(f"/api/ledger/activities/{rnd_id}/responses", json={
        "availability_window": "9:30–10:15am",
        "note": "3 pairs of school shoes + 1 leather satchel",
        "private_stop_directions": "Tchui Rd Gate 14, ask for Mama Shiro",
    }, headers=h1)
    s2 = await client.post(f"/api/ledger/activities/{rnd_id}/responses", json={
        "availability_window": "11:00–11:45am",
        "note": "2 pairs of boots for re-soling",
        "private_stop_directions": "Naivasha Ave Plot 8, brown wooden gate",
    }, headers=h2)
    assert s1.status_code == 201 and s2.status_code == 201

    # Household 1 NEVER sees Household 2's private gate address!
    h1_detail = (await client.get(f"/api/ledger/activities/{rnd_id}", headers=h1)).json()
    assert len(h1_detail["responses"]) == 1
    assert "Plot 8" not in str(h1_detail)

    # Cobbler confirms both stops and receives sequential stop numbers 1, 2
    b1 = await client.post(f"/api/ledger/activities/{rnd_id}/bookings", json={
        "response_id": s1.json()["id"],
        "settlement_method": "direct_mpesa",
    }, headers=cobbler)
    b2 = await client.post(f"/api/ledger/activities/{rnd_id}/bookings", json={
        "response_id": s2.json()["id"],
        "settlement_method": "direct_cash",
    }, headers=cobbler)
    assert b1.json()["stop_sequence"] == 1
    assert b2.json()["stop_sequence"] == 2

    # Once Stop 1 is mutually completed, Stop 1's gate directions re-lock even for the cobbler
    await client.post(f"/api/ledger/bookings/{b1.json()['id']}/confirm-completion", headers=cobbler)
    await client.post(f"/api/ledger/bookings/{b1.json()['id']}/confirm-completion", headers=h1)
    cobbler_after = (await client.get(f"/api/ledger/activities/{rnd_id}", headers=cobbler)).json()
    resp_map = {r["id"]: r for r in cobbler_after["responses"]}
    assert resp_map[s1.json()["id"]]["private_stop_directions"] is None
    assert "Plot 8" in resp_map[s2.json()["id"]]["private_stop_directions"]


# ── 5. Phase 2E: Server-enforced youth safety & guardian consent ──────────────

async def test_youth_opportunity_server_guardrails(client):
    school, _ = await _register(
        client, display_name="Kisii Community Resource Centre", account_kind="institution", location="Kisii"
    )
    youth, _ = await _register(
        client, display_name="Brian (Student)", account_kind="person", location="Kisii"
    )

    # 1. Hazardous / night work rejected with 422
    bad_hazard = await client.post("/api/ledger/activities", json={
        "posting_type": "opportunity",
        "title": "Teenager night guard helper",
        "body": "Looking for a teenager to help with night shift gate watch.",
        "age_band": "16_17_supervised",
        "permitted_domain": "community_event",
        "supervisor_name": "John Doe",
        "supervisor_role": "Manager",
    }, headers=school)
    assert bad_hazard.status_code == 422

    # 2. Missing adult supervisor rejected with 422
    bad_sup = await client.post("/api/ledger/activities", json={
        "posting_type": "opportunity",
        "title": "Supervised holiday garden task for teenagers",
        "body": "Holiday tree-nursery potting session for secondary students.",
        "age_band": "16_17_supervised",
        "permitted_domain": "garden_help",
    }, headers=school)
    assert bad_sup.status_code == 422
    assert "supervisor" in bad_sup.json()["detail"].lower()

    # 3. Night-time schedule rejected with 422
    night_dt = (datetime.utcnow() + timedelta(days=2)).replace(hour=21, minute=0, second=0, microsecond=0)
    bad_hour = await client.post("/api/ledger/activities", json={
        "posting_type": "opportunity",
        "title": "Holiday digital cataloguing youth task",
        "body": "Supervised library book sorting for teenagers.",
        "starts_at": night_dt.isoformat(),
        "age_band": "16_17_supervised",
        "permitted_domain": "digital_help",
        "supervisor_name": "Grace Nyaboke",
        "supervisor_role": "Head Librarian",
    }, headers=school)
    assert bad_hour.status_code == 422

    # 4. Valid daytime supervised youth opportunity succeeds & locks guardian_consent_required=True
    day_dt = (datetime.utcnow() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    ok_youth = await client.post("/api/ledger/activities", json={
        "posting_type": "opportunity",
        "title": "Supervised holiday tree-nursery task",
        "body": "Morning indigenous seedling potting & record keeping for 16–17s during school holidays.",
        "starts_at": day_dt.isoformat(),
        "age_band": "16_17_supervised",
        "permitted_domain": "garden_help",
        "supervisor_name": "Grace Nyaboke",
        "supervisor_role": "Extension Educator",
        "price_kes": 800,
    }, headers=school)
    assert ok_youth.status_code == 201, ok_youth.text
    y_id = ok_youth.json()["id"]
    assert ok_youth.json()["permission_rules"]["guardian_consent_required"] is True

    # 5. Youth application without guardian contact is refused (422)
    no_guard = await client.post(f"/api/ledger/activities/{y_id}/responses", json={
        "note": "I would love to join on Saturday morning",
    }, headers=youth)
    assert no_guard.status_code == 422

    app_r = await client.post(f"/api/ledger/activities/{y_id}/responses", json={
        "note": "Form 3 agriculture club member, keen to learn seedling care",
        "guardian_name_and_contact": "Mary Kwamboka (Mother) · +254712345678",
    }, headers=youth)
    assert app_r.status_code == 201
    resp_id = app_r.json()["id"]
    assert app_r.json()["guardian_consent_status"] == "pending"

    # 6. Booking BEFORE guardian consent is confirmed is refused (422)!
    premature_bk = await client.post(f"/api/ledger/activities/{y_id}/bookings", json={
        "response_id": resp_id,
        "settlement_method": "direct_mpesa",
    }, headers=school)
    assert premature_bk.status_code == 422
    assert "consent" in premature_bk.json()["detail"].lower()

    # 7. Confirm guardian consent -> booking succeeds
    consent_ok = await client.post(f"/api/ledger/responses/{resp_id}/guardian-consent", json={
        "consent_status": "confirmed",
        "note": "Confirmed by phone with parent Mary Kwamboka",
    }, headers=school)
    assert consent_ok.status_code == 200

    valid_bk = await client.post(f"/api/ledger/activities/{y_id}/bookings", json={
        "response_id": resp_id,
        "settlement_method": "direct_mpesa",
    }, headers=school)
    assert valid_bk.status_code == 201


# ── 6. Phase 2A: Home Storefront Controls, Metrics & Outside Feed Compat ──────

async def test_home_storefront_audience_and_utility_metrics(client):
    home, _ = await _register(client, display_name="Kiamunyi Homestead", account_kind="household")
    trusted_nb, nb_tok = await _register(client, display_name="Trusted Neighbour", account_kind="person")
    stranger, _ = await _register(client, display_name="Stranger", account_kind="person")

    await client.post("/api/ledger/relationships", json={
        "target_vendor_id": nb_tok["vendor_id"],
        "relationship_kind": "household",
        "label": "Next-door neighbour",
    }, headers=home)

    put_sf = await client.put("/api/ledger/home-storefront", json={
        "enabled": True,
        "title": "Kiamunyi Orchard Shelf",
        "visiting_hours": "Sat 4pm–6pm",
        "audience": "saved_contacts",
        "share_directions_only_when_booked": True,
    }, headers=home)
    assert put_sf.status_code == 200

    eggs = await client.post("/api/ledger/activities", json={
        "posting_type": "available",
        "title": "3 trays of kienyeji eggs",
        "body": "Fresh kienyeji eggs from our homestead flock, collect Saturday afternoon.",
        "price_kes": 450,
        "use_home_storefront": True,
    }, headers=home)
    assert eggs.status_code == 201
    egg_id = eggs.json()["id"]

    # Stranger is blocked from saved-contacts-only home shelf item; trusted neighbour can view
    s_res = await client.get(f"/api/ledger/activities/{egg_id}", headers=stranger)
    assert s_res.status_code == 403
    nb_res = await client.get(f"/api/ledger/activities/{egg_id}", headers=trusted_nb)
    assert nb_res.status_code == 200
    assert nb_res.json()["schedule_label"] == "Sat 4pm–6pm"

    # Public ledger items appear in unified `/api/outside/feed` with approximate coords
    pub_item = await client.post("/api/outside/content", json={
        "posting_type": "available",
        "title": "Lend a wheelbarrow this weekend",
        "body": "Heavy-duty wheelbarrow available to borrow in Kisii neighbourhood.",
        "geo_lat": KISII[0],
        "geo_lng": KISII[1],
    }, headers=home)
    assert pub_item.status_code == 201
    assert pub_item.json()["record"] == "local_activity"

    await client.put("/api/outside/location", json={
        "label": "Kisii",
        "geo_lat": KISII[0],
        "geo_lng": KISII[1],
        "radius_km": 25,
    }, headers=stranger)
    feed = (await client.get("/api/outside/feed", params={"kinds": "available"}, headers=stranger)).json()
    found = [i for i in feed["items"] if i["id"] == pub_item.json()["id"]]
    assert found and found[0]["geo_lat"] == round(KISII[0], 2)

    # The legacy Outside detail route resolves ledger records too.
    legacy_detail = await client.get(
        f"/api/outside/content/available/{pub_item.json()['id']}", headers=stranger
    )
    assert legacy_detail.status_code == 200, legacy_detail.text
    assert legacy_detail.json()["to"] == f"/activities/{pub_item.json()['id']}"
    assert legacy_detail.json()["geo_lat"] == round(KISII[0], 2)

    # Utility metrics report outcome counts — never engagement time
    metrics = (await client.get("/api/ledger/metrics/summary", headers=home)).json()
    assert metrics["metric_philosophy"] == "outcomes_not_time_spent"
    assert set(metrics["network"]) == {
        "successful_matches",
        "requests_fulfilled",
        "repeat_bookings",
        "notifications_acted_upon",
        "active_local_providers_30d",
    }

"""v2.11 — verified standing, the passport, and explainable opportunity fit.

The release adds the paperwork layer the network was missing: a business can
put its documents on record, a named human can check them, the passport shows
what is *live verified fact* and nothing more, and an opportunity can say in
plain words how a supplier measures against what the buyer asked for.

These tests pin the rules that make that trustworthy:

    · declared < documented < verified — and only verified counts as met
    · nobody verifies their own documents; a rejection must say why
    · changing the paper clears the old verification (history keeps both)
    · expiry is computed from the document, never invented
    · renewal reminders fire once per window
    · readiness counts documents; it never issues a reliability verdict
    · the public passport shows verified facts and published checklists only
    · a watch explains which clause rang; a match names the documents held
"""

import uuid
from datetime import date, datetime, timedelta

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _vendor(client, suffix, **extra):
    handle = f"std_{suffix}"
    r = await client.post("/api/auth/register", json={
        "business_name": f"Standing {suffix[:4]}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": extra.get("categories", ["packaging", "supplies"]),
        "physical_location": extra.get("location", "Kisumu market"),
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, handle


@pytest.fixture
async def owner(client):
    return await _vendor(client, uuid.uuid4().hex[:8])


@pytest.fixture
async def buyer(client):
    return await _vendor(client, uuid.uuid4().hex[:8], location="Nairobi CBD")


async def _add_claim(client, headers, key, **overrides):
    data = {"claim_key": key}
    data["reference"] = overrides.pop("reference", "REF-123")
    data.update(overrides)
    return await client.post("/api/passport/claims", data=data, headers=headers)


async def _verify_as(client, verifier_headers, claim_id, **overrides):
    data = {"method": overrides.pop("method", "registry_check"),
            "note": overrides.pop("note", "Seen and checked")}
    if overrides.get("expires_on"):
        data["expires_on"] = overrides["expires_on"]
    return await client.post(f"/api/passport/claims/{claim_id}/verify", data=data, headers=verifier_headers)


def _make_verifier(monkeypatch, handle):
    from app.config import settings
    monkeypatch.setattr(settings, "VERIFIER_HANDLES", handle)


# ── the catalog ───────────────────────────────────────────────────────────────
async def test_catalog_lists_claims_and_checklists(client, owner):
    headers, _ = owner
    r = await client.get("/api/passport/catalog", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    keys = {c["key"] for c in body["claims"]}
    assert {"brs_registration", "tax_compliance", "county_permit", "agpo_certificate"} <= keys
    # The facts that carry a printed expiry say so; the ones that do not, don't.
    tcc = next(c for c in body["claims"] if c["key"] == "tax_compliance")
    pin = next(c for c in body["claims"] if c["key"] == "kra_pin")
    assert tcc["validity_months"] == 12 and tcc["review_months"] is None
    assert pin["validity_months"] is None and pin["review_months"] == 24
    # Groups are ordered for reading, not dumped in insertion order.
    assert body["claims"][0]["group"] == "identity"
    checklists = {c["key"] for c in body["checklists"]}
    assert {"institutional_standard", "agpo_reserved", "healthcare_supply"} <= checklists


async def test_unknown_claim_key_is_refused(client, owner):
    headers, _ = owner
    r = await _add_claim(client, headers, "made_up_certificate")
    assert r.status_code == 404
    assert "catalog" in r.json()["detail"]


# ── claiming ──────────────────────────────────────────────────────────────────
async def test_a_claim_starts_documented_and_never_claims_verified(client, owner, buyer):
    headers, owner_handle = owner
    other, _ = buyer
    r = await _add_claim(client, headers, "tax_compliance", reference="TCC-7788")
    assert r.status_code == 201, r.text
    claim = r.json()
    assert claim["status"] == "documented"       # a reference is not a verification
    assert claim["method"] == "document_reference"
    assert claim["expires_on"] is not None       # catalog validity applied
    assert claim["verified_at"] is None

    mine = (await client.get("/api/passport", headers=headers)).json()
    assert mine["counts"]["verified"] == 0
    assert mine["counts"]["needs_confirmation"] == 1
    assert "not a statement" in mine["disclaimer"]

    # Another business sees only verified facts — nothing here yet.
    public = (await client.get(f"/api/passport/{owner_handle}", headers=other)).json()
    assert public["facts"] == []
    assert public["counts"]["verified"] == 0


async def test_evidence_url_must_look_like_an_upload(client, owner):
    headers, _ = owner
    r = await _add_claim(client, headers, "county_permit", evidence_url="javascript:alert(1)")
    assert r.status_code == 400


async def test_requesting_a_check_needs_something_to_check(client, owner):
    headers, _ = owner
    r = await _add_claim(client, headers, "kra_pin", reference="")
    claim = r.json()
    assert claim["status"] == "declared"
    ask = await client.post(f"/api/passport/claims/{claim['id']}/request-verification", headers=headers)
    assert ask.status_code == 400
    assert "Attach the document" in ask.json()["detail"]


# ── the verifier desk ─────────────────────────────────────────────────────────
async def test_only_a_configured_verifier_reaches_the_desk(client, owner, buyer, monkeypatch):
    headers, _ = owner
    not_a_verifier, _ = buyer
    claim = (await _add_claim(client, headers, "county_permit")).json()
    assert (await client.get("/api/passport/queue", headers=not_a_verifier)).status_code == 403
    assert (await _verify_as(client, not_a_verifier, claim["id"])).status_code == 403


async def test_the_full_verification_loop(client, owner, buyer, monkeypatch):
    headers, owner_handle = owner
    verifier_headers, verifier_handle = buyer
    _make_verifier(monkeypatch, verifier_handle)

    claim = (await _add_claim(client, headers, "tax_compliance", reference="TCC-4242")).json()
    ask = await client.post(f"/api/passport/claims/{claim['id']}/request-verification", headers=headers)
    assert ask.status_code == 200

    queue = (await client.get("/api/passport/queue", headers=verifier_headers)).json()["queue"]
    assert [q["id"] for q in queue] == [claim["id"]]
    assert queue[0]["vendor"]["handle"] == owner_handle
    assert queue[0]["waiting_since"] is not None

    verified = await _verify_as(client, verifier_headers, claim["id"])
    assert verified.status_code == 200, verified.text
    body = verified.json()
    assert body["status"] == "verified"
    assert body["verified_at"] is not None
    # The expiry comes from the catalog's validity, never from an invented date.
    from app.modules.standing import catalog
    assert body["expires_on"] == catalog.default_expiry("tax_compliance", date.today()).isoformat()
    assert (await client.get("/api/passport/queue", headers=verifier_headers)).json()["queue"] == []

    # The owner was told, and the fact is now public.
    notes = (await client.get("/api/notifications", headers=headers)).json()["notifications"]
    assert any(n["type"] == "claim_verified" for n in notes)
    public = (await client.get(f"/api/passport/{owner_handle}", headers=verifier_headers)).json()
    assert public["counts"]["verified"] == 1
    fact = public["facts"][0]
    assert fact["claim_key"] == "tax_compliance"
    assert "evidence_url" not in fact          # the scan never travels publicly


async def test_nobody_verifies_their_own_documents(client, owner, monkeypatch):
    headers, handle = owner
    _make_verifier(monkeypatch, handle)
    claim = (await _add_claim(client, headers, "kra_pin")).json()
    r = await _verify_as(client, headers, claim["id"])
    assert r.status_code == 403
    assert "its own documents" in r.json()["detail"]


async def test_a_rejection_must_say_why(client, owner, buyer, monkeypatch):
    headers, _ = owner
    verifier_headers, verifier_handle = buyer
    _make_verifier(monkeypatch, verifier_handle)
    claim = (await _add_claim(client, headers, "county_permit")).json()

    blank = await client.post(f"/api/passport/claims/{claim['id']}/reject",
                              data={"reason": ""}, headers=verifier_headers)
    assert blank.status_code == 422          # the wire shape refuses it outright
    rejected = await client.post(f"/api/passport/claims/{claim['id']}/reject",
                                 data={"reason": "Permit is for a different premises"},
                                 headers=verifier_headers)
    assert rejected.status_code == 200
    body = rejected.json()
    assert body["status"] == "rejected"
    assert "different premises" in body["rejection_reason"]
    notes = (await client.get("/api/notifications", headers=headers)).json()["notifications"]
    assert any(n["type"] == "claim_rejected" for n in notes)


async def test_replacing_a_verified_document_clears_the_verification(client, owner, buyer, monkeypatch):
    headers, _ = owner
    verifier_headers, verifier_handle = buyer
    _make_verifier(monkeypatch, verifier_handle)

    claim = (await _add_claim(client, headers, "county_permit", reference="P-1")).json()
    await _verify_as(client, verifier_headers, claim["id"])
    again = await _add_claim(client, headers, "county_permit", reference="P-2-renewed")
    body = again.json()
    assert body["status"] == "documented"    # a human checked the old paper, not this one
    assert body["verified_at"] is None
    # ...and the history says so.
    passport = (await client.get("/api/passport", headers=headers)).json()
    mine = next(f for f in passport["facts"] if f["claim_key"] == "county_permit")
    assert mine["status"] == "documented"


# ── the clock ─────────────────────────────────────────────────────────────────
async def test_expiry_is_computed_not_invented(client, owner, buyer, monkeypatch):
    from app.database import async_session
    from app.modules.standing import service as standing

    headers, owner_handle = owner
    verifier_headers, verifier_handle = buyer
    _make_verifier(monkeypatch, verifier_handle)

    claim = (await _add_claim(client, headers, "tax_compliance", reference="TCC-old")).json()
    # Verify a paper that lapsed yesterday: the desk refuses the impossible.
    lapsed = await _verify_as(client, verifier_headers, claim["id"],
                              expires_on=(date.today() - timedelta(days=1)).isoformat())
    assert lapsed.status_code == 400

    await _verify_as(client, verifier_headers, claim["id"])
    async with async_session() as db:
        flipped = await standing.expire_due(db, now=date.today() + timedelta(days=400))
    assert flipped >= 1
    mine = (await client.get("/api/passport", headers=headers)).json()
    fact = next(f for f in mine["facts"] if f["claim_key"] == "tax_compliance")
    assert fact["status"] == "expired"
    assert mine["counts"]["verified"] == 0 and mine["counts"]["expired"] == 1
    public = (await client.get(f"/api/passport/{owner_handle}", headers=verifier_headers)).json()
    assert public["facts"] == []              # an expired fact is not a live fact


async def test_renewal_reminders_fire_once_per_window(client, owner, buyer, monkeypatch):
    from app.database import async_session
    from app.modules.standing import service as standing

    headers, _ = owner
    verifier_headers, verifier_handle = buyer
    _make_verifier(monkeypatch, verifier_handle)
    claim = (await _add_claim(client, headers, "county_permit", reference="P-9")).json()
    await _verify_as(client, verifier_headers, claim["id"],
                     expires_on=(date.today() + timedelta(days=20)).isoformat())

    async with async_session() as db:
        first = await standing.remind_expiring(db)
    assert first == 1
    async with async_session() as db:
        second = await standing.remind_expiring(db)     # nothing twice
    assert second == 0
    notes = (await client.get("/api/notifications", headers=headers)).json()["notifications"]
    expiring = [n for n in notes if n["type"] == "claim_expiring"]
    assert len(expiring) == 1
    assert "days left" in expiring[0]["body"]


# ── readiness: counts, never a verdict ────────────────────────────────────────
async def test_readiness_counts_documents_and_names_the_gaps(client, owner, buyer, monkeypatch):
    headers, owner_handle = owner
    verifier_headers, verifier_handle = buyer
    _make_verifier(monkeypatch, verifier_handle)

    agpo = (await _add_claim(client, headers, "agpo_certificate", reference="AG-1")).json()
    await _verify_as(client, verifier_headers, agpo["id"])
    await _add_claim(client, headers, "kra_pin", reference="PIN-1")   # documented, unchecked

    r = await client.get("/api/passport/readiness/agpo_reserved", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]["met"] == 1
    assert body["summary"]["needs_confirmation"] == 1
    assert body["summary"]["missing"] >= 3
    assert body["eligible_on_paper"] is False
    assert "Registered business (BRS)" in body["must_have_gaps"]
    assert "You meet 1 of 6" in body["sentence"] or "1 verified out of" in body["sentence"]
    states = {i["claim_key"]: i["state"] for i in body["items"]}
    assert states["agpo_certificate"] == "met"
    assert states["kra_pin"] == "needs_confirmation"
    assert body["items"][0]["next_step"]


async def test_an_unpublished_checklist_is_not_public(client, owner, buyer):
    headers, owner_handle = owner
    other, _ = buyer
    denied = await client.get(f"/api/passport/readiness/institutional_standard?handle={owner_handle}",
                              headers=other)
    assert denied.status_code == 403
    published = await client.put("/api/passport/profile",
                               data={"headline": "Registered 2019; PPB licence current",
                                     "published_checklists": "institutional_standard"},
                               headers=headers)
    assert published.status_code == 200
    assert published.json()["published_checklists"] == ["institutional_standard"]
    allowed = await client.get(f"/api/passport/readiness/institutional_standard?handle={owner_handle}",
                               headers=other)
    assert allowed.status_code == 200
    assert allowed.json()["items"]           # gaps included — the owner chose to publish them


async def test_unknown_checklists_are_refused(client, owner):
    headers, _ = owner
    assert (await client.get("/api/passport/readiness/made_up", headers=headers)).status_code == 404
    # Publishing an unknown checklist is silently dropped, never promised.
    r = await client.put("/api/passport/profile", data={"published_checklists": "made_up,agpo_reserved"},
                         headers=headers)
    assert r.json()["published_checklists"] == ["agpo_reserved"]


async def test_withdrawing_keeps_the_history(client, owner, buyer):
    headers, owner_handle = owner
    other, _ = buyer
    claim = (await _add_claim(client, headers, "kra_pin", reference="PIN-2")).json()
    gone = await client.delete(f"/api/passport/claims/{claim['id']}", headers=headers)
    assert gone.status_code == 200
    assert gone.json()["status"] == "withdrawn"
    mine = (await client.get("/api/passport", headers=headers)).json()
    assert all(f["claim_key"] != "kra_pin" for f in mine["facts"])
    public = (await client.get(f"/api/passport/{owner_handle}", headers=other)).json()
    assert public["facts"] == []


# ── requirements, fit and watches ─────────────────────────────────────────────
async def _post_request(client, headers, **overrides):
    body = {
        "request_type": "delivery",
        "description": "Need packaging materials delivered to the Kisumu depot",
        "location": "Kisumu market",
        "needed_by": "this_week",
        "budget_kes": 60000,
        "requirements": [
            {"key": "tax_compliance", "must_have": True},
            {"key": "county_permit"},
            {"key": "stated", "label": "Own transport for the last mile", "must_have": True},
        ],
        **overrides,
    }
    return await client.post("/api/requests", json=body, headers=headers)


async def test_requests_carry_requirements_and_refuse_unknown_keys(client, owner):
    headers, _ = owner
    ok = await _post_request(client, headers)
    assert ok.status_code == 201, ok.text
    reqs = ok.json()["requirements"]
    assert [r["key"] for r in reqs] == ["tax_compliance", "county_permit", "stated"]
    # Claim labels come from the catalog, never from the request body.
    assert reqs[0]["label"] == "Tax Compliance Certificate (TCC)"
    assert reqs[2]["checkable"] is False

    bad = await _post_request(client, headers, requirements=[{"key": "vibes_certificate"}])
    assert bad.status_code == 400
    assert "catalog" in bad.json()["detail"]


async def test_fit_explains_the_gap_without_judging(client, owner, buyer, monkeypatch):
    poster, _ = owner
    viewer, _ = buyer
    # The viewer's own business cannot verify its own claims, so a third account does.
    claim = (await _add_claim(client, viewer, "tax_compliance", reference="TCC-viewer")).json()
    third, third_handle = await _vendor(client, uuid.uuid4().hex[:8])
    _make_verifier(monkeypatch, third_handle)
    await _verify_as(client, third, claim["id"])

    posted = (await _post_request(client, poster)).json()
    fit = await client.get(f"/api/requests/{posted['id']}/fit", headers=viewer)
    assert fit.status_code == 200, fit.text
    body = fit.json()
    assert body["summary"] == {"total": 3, "met": 1, "needs_confirmation": 0,
                               "missing": 1, "unverifiable": 1}
    # The only unmet must-have is the buyer's own words, which nothing can check.
    assert body["eligible_on_paper"] is True
    assert body["missing_must_haves"] == []
    assert "You meet 1 of 3 requirements" in body["sentence"]
    assert "not on file" in body["sentence"]
    stated = next(i for i in body["checklist"] if i["key"] == "stated")
    assert stated["state"] == "unverifiable"
    assert "cannot check" in stated["reason"]
    assert body["can_offer"] is True                    # a gap never blocks an offer
    assert any("Passport" in step for step in body["next_steps"])
    assert "not a judgement" in body["disclaimer"]

    # A must-have document the viewer does not hold reads as not eligible on
    # paper — and still says exactly which document is missing.
    gated = (await _post_request(client, poster, requirements=[
        {"key": "county_permit", "must_have": True},
        {"key": "tax_compliance", "must_have": True},
    ])).json()
    strict = (await client.get(f"/api/requests/{gated['id']}/fit", headers=viewer)).json()
    assert strict["eligible_on_paper"] is False
    assert strict["missing_must_haves"] == ["County single business permit"]


async def test_a_watch_explains_which_clause_rang(client, owner, buyer):
    poster, _ = owner
    watcher, _ = buyer
    watch = await client.post("/api/requests/watches", json={
        "label": "packaging runs", "request_type": "delivery",
        "keywords": "packaging kisumu", "min_budget_kes": 50000,
    }, headers=watcher)
    assert watch.status_code == 201, watch.text
    assert watch.json()["label"] == "packaging runs"

    await _post_request(client, poster)
    notes = (await client.get("/api/notifications", headers=watcher)).json()["notifications"]
    matched = [n for n in notes if n["type"] == "opportunity_match"]
    assert len(matched) == 1
    assert "words: kisumu, packaging" in matched[0]["body"]
    assert matched[0]["data"]["request_id"]

    # A watch that does not match stays quiet — and so does the first watch on
    # a request that misses one of its clauses.
    quiet = await client.post("/api/requests/watches", json={
        "request_type": "worker", "keywords": "loaders",
    }, headers=watcher)
    assert quiet.status_code == 201
    await _post_request(client, poster, request_type="worker",
                        description="Two people to help at the depot on Saturday",
                        location="Kisumu market", requirements=[])
    notes = (await client.get("/api/notifications", headers=watcher)).json()["notifications"]
    assert len([n for n in notes if n["type"] == "opportunity_match"]) == 1


async def test_watches_need_a_filter_and_are_capped(client, owner):
    headers, _ = owner
    empty = await client.post("/api/requests/watches", json={}, headers=headers)
    assert empty.status_code == 400
    assert "at least one filter" in empty.json()["detail"]
    for i in range(10):
        r = await client.post("/api/requests/watches", json={"keywords": f"word{i}"}, headers=headers)
        assert r.status_code == 201, (i, r.text)
    over = await client.post("/api/requests/watches", json={"keywords": "one_more"}, headers=headers)
    assert over.status_code == 400
    assert "remove one" in over.json()["detail"]
    listed = (await client.get("/api/requests/watches", headers=headers)).json()
    assert listed["limit"] == 10 and len(listed["watches"]) == 10

    # A watch can be paused and removed.
    first = listed["watches"][0]["id"]
    paused = await client.post(f"/api/requests/watches/{first}/state?active=false", headers=headers)
    assert paused.status_code == 200 and paused.json()["is_active"] is False
    gone = await client.delete(f"/api/requests/watches/{first}", headers=headers)
    assert gone.status_code == 204


async def test_verified_documents_earn_a_heads_up_when_they_fit(client, owner, buyer, monkeypatch):
    poster, _ = owner
    supplier, _ = buyer
    claim = (await _add_claim(client, supplier, "tax_compliance", reference="TCC-supp")).json()
    third_headers, third_handle = await _vendor(client, uuid.uuid4().hex[:8])
    _make_verifier(monkeypatch, third_handle)
    await _verify_as(client, third_headers, claim["id"])

    # A request whose only requirement is that document — the supplier is told
    # because the paperwork already exists, not because anyone ranked them.
    await _post_request(client, poster, requirements=[{"key": "tax_compliance", "must_have": True}])
    notes = (await client.get("/api/notifications", headers=supplier)).json()["notifications"]
    matched = [n for n in notes if n["type"] == "opportunity_match"]
    assert matched, notes
    assert "verified on your Passport" in matched[0]["body"]

    # And a business without the document hears nothing.
    stranger, _ = await _vendor(client, uuid.uuid4().hex[:8], categories=["packaging", "supplies"])
    notes = (await client.get("/api/notifications", headers=stranger)).json()["notifications"]
    assert not [n for n in notes if n["type"] == "opportunity_match"]

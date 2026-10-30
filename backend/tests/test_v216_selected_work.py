"""v2.16 — Selected work: the shop front shows proof, the desk shows the price.

What this thread answers. The creative portfolio was a 1,700-line separate
product surface: its own sticky navigation, hero, discipline filters, editorial
case-study theatre, a price list of four services, a "Start a Project" form, and
a hybrid studio dashboard that managed its own inquiry pipeline in localStorage.

Almost none of that was a *capability the app provides*. It was a page. Two
capabilities inside it were real and were buried:

  · **Show the work.** A buyer choosing a designer, printer or developer wants
    to see what the business has made. That belongs on the shop front — the
    shelf the buyer is already standing on — not four taps deep in `/portfolio`.
  · **Sell the service.** Packaging/print and motion/launch had a price and a
    turnaround *only* on that page. Two of its four services were already
    Business Desk offers under other names; the other two were invisible to
    anyone who did not find the portfolio.

Everything else was already provided elsewhere: inquiries → the enquiry inbox,
identity/bio editing → the shop front's profile editor, services → the desk.

Acceptance criteria:

    1. Every service the retired portfolio priced is now a Business Desk offer
       with the same scope, exclusions, turnaround and a quotation CTA.
    2. A vendor can publish up to twelve selected-work cards, and everyone can
       read them from the public shop-front payload.
    3. A work item cannot smuggle anything a card cannot render: no unknown
       fields, no HTML field, no non-displayable image URL, no title-less card.
    4. Sending no work items never clears them; sending an empty list does.
    5. Nothing here takes money, and the desk never becomes a catalogue again —
       the offers carry their own scope, price status and permitted action.
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, prefix="showcase"):
    suffix = uuid.uuid4().hex[:8]
    handle = f"{prefix}_{suffix}"
    res = await client.post("/api/auth/register", json={
        "business_name": f"Studio {suffix[:4]}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "phone": "254712345678",
        "password": PASSWORD,
        "business_categories": ["design"],
        "physical_location": "Kisumu",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    return body, {"Authorization": f"Bearer {body['access_token']}"}, handle


def _item(**overrides):
    base = {
        "title": "Kibo Botanicals — identity system",
        "summary": "Wordmark, label architecture and a guideline book for a skincare house.",
        "outcome": "Twelve label formats at launch",
        "discipline": "Branding",
        "year": "2026",
        "image_url": "https://cdn.example.com/kibo.jpg",
    }
    base.update(overrides)
    return base


# ── capability 1: the price list became desk offers ──────────────────────────


async def test_the_portfolio_price_list_now_lives_on_the_desk(client):
    """Four services were priced on the portfolio. All four are desk offers now."""
    offers = {o["key"]: o for o in (await client.get("/api/catalog")).json()["offers"]}

    # Brand identity → the starter package that already existed.
    assert offers["logo_brand_starter"]["readiness"] == "service"
    # Web design → the website offer that already existed.
    assert offers["business_website"]["readiness"] == "service"
    # Packaging & print and motion & launch existed ONLY on the portfolio.
    assert offers["packaging_print_suite"]["desk"] == "digital_services"
    assert offers["motion_launch_pack"]["desk"] == "digital_services"
    for key in ("packaging_print_suite", "motion_launch_pack"):
        assert offers[key]["readiness"] == "service"
        assert offers[key]["cta"]["kind"] == "quotation"
        assert offers[key]["price_min_kes"] and offers[key]["price_max_kes"]
        assert offers[key]["deliverables"] and offers[key]["exclusions"]
        assert offers[key]["customer_must_provide"]


async def test_no_priced_service_is_only_reachable_from_a_portfolio(client):
    """A service with a price must be findable by need, or it is not for sale.

    Every digital-services offer must appear inside a desk (the buyer's route),
    carry a permitted action, and state its scope. A capability hidden behind a
    separate page is a capability the desk cannot sell.
    """
    body = (await client.get("/api/catalog")).json()
    digital = next(d for d in body["desks"] if d["key"] == "digital_services")
    listed = {o["key"] for o in digital["offers"]}

    for offer in body["offers"]:
        if offer["line"] != "digital_services":
            continue
        assert offer["key"] in listed, offer["key"]
        assert offer["cta"]["kind"] in {"quotation", "purchase"}
        assert offer["deliverables"]
    assert {"packaging_print_suite", "motion_launch_pack"} <= listed


# ── capability 2: the work showcase on the shop front ────────────────────────


async def test_a_vendor_publishes_selected_work_and_a_visitor_reads_it(client):
    _, headers, handle = await _register(client)

    res = await client.put("/api/vendors/me/profile", json={
        "work_items": [
            _item(),
            _item(title="Solstice Roasters — digital flagship", discipline="Web design",
                  outcome="", image_url=""),
        ],
    }, headers=headers)
    assert res.status_code == 200, res.text
    saved = res.json()["work_items"]
    assert len(saved) == 2
    assert saved[0]["title"] == "Kibo Botanicals — identity system"
    assert saved[0]["outcome"] == "Twelve label formats at launch"
    # Empty fields are dropped rather than stored as empty strings.
    assert "outcome" not in saved[1] and "image_url" not in saved[1]

    public = await client.get(f"/api/vendors/{handle}", headers=headers)
    assert public.status_code == 200, public.text
    assert [w["title"] for w in public.json()["work_items"]] == [
        "Kibo Botanicals — identity system",
        "Solstice Roasters — digital flagship",
    ]


async def test_a_work_item_cannot_be_more_than_a_card(client):
    """The record is public and vendor-written, so the shape is the contract."""
    _, headers, _ = await _register(client)

    no_title = await client.put("/api/vendors/me/profile",
                                json={"work_items": [_item(title="")]}, headers=headers)
    assert no_title.status_code == 422

    blank_title = await client.put("/api/vendors/me/profile",
                                   json={"work_items": [_item(title="   ")]}, headers=headers)
    assert blank_title.status_code == 422

    # An image the browser must not be asked to load.
    bad_image = await client.put("/api/vendors/me/profile",
                                 json={"work_items": [_item(image_url="javascript:alert(1)")]},
                                 headers=headers)
    assert bad_image.status_code == 422

    # A field a card cannot render.
    smuggled = await client.put("/api/vendors/me/profile",
                                json={"work_items": [_item(body="<script>alert(1)</script>")]},
                                headers=headers)
    assert smuggled.status_code == 422

    too_many = await client.put("/api/vendors/me/profile",
                                json={"work_items": [_item(title=f"Work {i}") for i in range(13)]},
                                headers=headers)
    assert too_many.status_code == 422


async def test_saying_nothing_keeps_the_work_and_an_empty_list_clears_it(client):
    _, headers, _ = await _register(client)
    await client.put("/api/vendors/me/profile",
                     json={"work_items": [_item()]}, headers=headers)

    # A profile save from another part of the app must not wipe the showcase.
    untouched = await client.put("/api/vendors/me/profile",
                                 json={"accepts_bulk": False}, headers=headers)
    assert untouched.status_code == 200
    assert len(untouched.json()["work_items"]) == 1

    cleared = await client.put("/api/vendors/me/profile",
                               json={"work_items": []}, headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["work_items"] == []


async def test_a_new_vendor_starts_with_an_empty_showcase(client):
    """No backfill, no nulls: an empty list is a valid showcase."""
    _, headers, handle = await _register(client)
    profile = await client.get("/api/vendors/me/profile", headers=headers)
    assert profile.status_code == 200
    assert profile.json()["work_items"] == []
    public = await client.get(f"/api/vendors/{handle}", headers=headers)
    assert public.json()["work_items"] == []


async def test_the_showcase_never_collects_payment_details(client):
    """Still true after the move: a showcase is a showcase, not a checkout."""
    _, headers, _ = await _register(client)
    res = await client.put("/api/vendors/me/profile", json={
        "work_items": [_item(**{"card_number": "4242424242424242"})],
    }, headers=headers)
    assert res.status_code == 422

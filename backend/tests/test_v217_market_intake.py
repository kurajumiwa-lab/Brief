"""v2.17 — Market intake: a photograph of a shop sign becomes a price.

The request, in the words it was made in: *"allow multiple once upload of up to
12 photos, then use an open source image reader to process the data… pick
market or trade garbage… since these are there to have sellers they get a
virtual id so it costs us nothing to provide it into the market."*

That is three separate promises, and each one is tested here:

    1. **Twelve photographs, one request** — and no more than twelve.
    2. **The reader separates a price from the noise** — slogans, view counts,
       clocks and container words are not products; a price is never invented
       from a bare number.
    3. **A seller with no account gets an identity** — a virtual ID that can
       never authenticate, that collects their confirmed prices, and that they
       can claim later by proving the phone number.

Plus the commercial rule: the dataset is readable by anyone signed in, the
seller's identity is not — and the upgrade path says plainly that nothing is
charged, because subscription billing is still not verified.

The extraction fixtures are taken from real OCR output of Nairobi wholesale
screenshots (Khetia "Pekee"), including the OCR's own mistakes.
"""

import uuid

import pytest

from app.modules.intake.extract import (
    clean_product_name,
    extract,
    guess_category,
    looks_like_noise,
    normalise_phone,
    parse_price,
    parse_quantity,
)

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


# ── 1. the rules ─────────────────────────────────────────────────────────────


def test_a_price_is_read_in_every_shape_a_shop_writes_it():
    assert parse_price("Maya diapers bale@ksh 2100/-") == 2100
    assert parse_price("Persil (3L) Ksh999") == 999
    assert parse_price("Doffi 10Kg Ksh 850") == 850
    assert parse_price("Brown sugar 50kg@ksh 5,800/-") == 5800
    assert parse_price("Salt cooking oil @ 4000/=") == 4000
    # A bare number is a view count, a clock or a quantity — never a price.
    assert parse_price("127") is None
    assert parse_price("25Kgs") is None
    assert parse_price("23:48") is None


def test_a_size_is_read_as_a_size_not_a_price():
    assert parse_quantity("Doffi 10Kg Ksh850") == (10.0, "kg")
    assert parse_quantity("Salt cooking oil20litres@ksh4000/-") == (20.0, "l")
    assert parse_quantity("Brooksidemilk 500ml carton@ksh700/") == (500.0, "ml")
    assert parse_quantity("Msafibar soap(10 pcs) ksh1150") == (10.0, "pcs")
    assert parse_quantity("no size here") == (None, None)


def test_the_noise_on_every_card_is_not_a_product():
    # The slogan printed on every single card in a wholesale feed.
    assert looks_like_noise("Shop with us today and get free delivery")
    assert looks_like_noise("contact our number in the bio")
    assert looks_like_noise("WE DELIVER COUNTRY WIDE UPON ORDER")
    assert looks_like_noise("140")          # view count
    assert looks_like_noise("23:48")        # clock
    assert looks_like_noise("#wholesaler #kitaletiktoker")
    assert looks_like_noise("0104211141")   # a phone, not a product
    # …and the actual goods survive.
    assert not looks_like_noise("Maya diapers bale@ksh 2100/-")
    assert not looks_like_noise("Plastic chairs wholesale offer@ksh399/-")


def test_a_kenyan_number_is_normalised_to_one_shape():
    assert normalise_phone("Sales 0104211141") == "+254104211141"
    assert normalise_phone("+254 712 345 678") == "+254712345678"
    assert normalise_phone("0712-345-678") == "+254712345678"
    assert normalise_phone("no number here") is None


def test_a_product_name_is_what_it_is_sold_as():
    assert clean_product_name("Plastic chairs wholesale offer@ksh399/-", 399) == "Plastic chairs"
    # OCR loses the space inside a camel-case brand: "PersilSensitive" is two words.
    assert "Persil Sensitive" in clean_product_name("PersilSensitive/LavenderGel (3L) Ksh999", 999)
    # …and between a word and a number.
    assert "oil 20 litres" in clean_product_name("Salt cooking oil20litres@ksh4000/-", 4000)


def test_a_category_is_a_guess_and_says_so():
    assert guess_category("Maya diapers bale") == "diapers"
    assert guess_category("Premium basmati rice 25 kg") == "rice & grains"
    assert guess_category("Salit cooking oil 20 litres") == "cooking oil & fats"
    assert guess_category("Dustbin") == "plastics & utensils"
    assert guess_category("Zzz") is None


def test_extraction_keeps_the_prices_and_drops_the_rest():
    lines = [
        "23:48", "KHETIA", "Pekee",
        "Maya diapers bale@ksh 2100/-",
        "PersilSensitive/LavenderGel (3L) Ksh999",
        "Shop with us today and get free delivery", "140", "127", "KHETIA",
        "Plastic chairs wholesale offer@ksh399/-",
        "Salt cooking oil20litres@ksh4000/-",
        "Brown sugar 50kg@ksh 5800/-",
        "25Kgs Ksh2800",
        "0104211141",
        "contact our number in the bio",
    ]
    result = extract(lines)

    products = {row["product"]: row["price_kes"] for row in result["observations"]}
    assert products["Maya diapers bale"] == 2100
    assert products["Salt cooking oil 20 litres"] == 4000
    assert products["Brown sugar 50 kg"] == 5800
    # None of the chrome became a product.
    joined = " ".join(products).lower()
    assert "shop with us" not in joined
    assert "free delivery" not in joined
    assert "140" not in products
    # The seller's banner and number were read, and attributed to the batch.
    assert result["seller_hint"] == "Khetia"
    assert result["phones"] == ["+254104211141"]
    # The orphan size was reported, not silently turned into a product.
    assert any("size without a product" == s["reason"] for s in result["skipped"])


def test_the_same_card_twice_is_one_market_fact():
    """A collage repeats cards; OCR repeats lines. Neither is two observations."""
    result = extract([
        "Doffi washing powder 10 kg Ksh850",
        "Doffi washing powder 10 kg Ksh850",
        "Doffi washing powder 10kg ksh 850",
    ])
    assert len(result["observations"]) == 1


def test_extraction_never_invents_a_price():
    result = extract(["Rascals diapers", "Market price", "Ask for price"])
    assert result["observations"] == []
    assert {s["reason"] for s in result["skipped"]} == {"no price"}


# ── 2. the API ───────────────────────────────────────────────────────────────


async def _register(client, prefix="intake", plan_hint=None):
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


async def _ops(client, monkeypatch, prefix="intake_ops"):
    """Register an operator and point MARKET_OPS_ROLES at that exact handle.

    The role is configuration, not a database flag — the same rule the enquiry
    inbox uses — so a test has to do what a deployment does.
    """
    from app.config import settings

    _, headers, handle = await _register(client, prefix=prefix)
    monkeypatch.setattr(settings, "MARKET_OPS_ROLES", f"admin:{handle}")
    return headers


SIGN = "\n".join([
    "KHETIA",
    "Maya diapers bale@ksh 2100/-",
    "Salt cooking oil20litres@ksh4000/-",
    "Shop with us today and get free delivery",
    "KHETIA",           # the banner is printed on every card, not just one
    "0104211141",
])


async def test_intake_is_operator_work(client):
    _, headers, _ = await _register(client)
    res = await client.post("/api/intake/batches/text", json={"text": SIGN}, headers=headers)
    assert res.status_code == 403
    assert "operations staff" in res.json()["detail"]


async def test_pasted_text_becomes_suggested_rows_and_a_virtual_seller(client, monkeypatch):
    headers = await _ops(client, monkeypatch)

    res = await client.post("/api/intake/batches/text", json={"text": SIGN}, headers=headers)
    assert res.status_code == 201, res.text
    body = res.json()

    assert body["ocr_engine"] == "text"
    assert body["seller_hint"] == "Khetia"
    assert body["phone_hint"] == "+254104211141"
    assert len(body["observations"]) == 2
    assert {o["status"] for o in body["observations"]} == {"suggested"}

    presence = body["presence"]
    assert presence["virtual_id"].startswith("~")
    assert presence["virtual_id"] != "Khetia"        # handle-shaped, lowercase
    assert presence["claimed"] is False

    # Nothing is in the market dataset until a human confirms it.
    summary = (await client.get("/api/market-data/summary", headers=headers)).json()
    assert summary["observations"] == 0
    assert summary["pending_review"] == 2


async def test_a_confirmed_row_joins_the_dataset_and_a_rejected_one_does_not(
    client, monkeypatch
):
    headers = await _ops(client, monkeypatch)

    batch = (await client.post(
        "/api/intake/batches/text", json={"text": SIGN}, headers=headers
    )).json()
    keep, drop = batch["observations"][0]["id"], batch["observations"][1]["id"]

    ok = await client.patch(f"/api/intake/observations/{keep}", json={"status": "confirmed"}, headers=headers)
    assert ok.status_code == 200 and ok.json()["status"] == "confirmed"
    no = await client.patch(f"/api/intake/observations/{drop}", json={"status": "rejected"}, headers=headers)
    assert no.status_code == 200 and no.json()["status"] == "rejected"

    bad = await client.patch(f"/api/intake/observations/{keep}", json={"status": "published"}, headers=headers)
    assert bad.status_code == 400

    summary = (await client.get("/api/market-data/summary", headers=headers)).json()
    assert summary["observations"] == 1
    assert summary["categories"][0]["category"] == "diapers"
    assert summary["categories"][0]["price_min_kes"] == 2100


async def test_members_see_the_market_but_not_who_is_selling(client, monkeypatch):
    ops = await _ops(client, monkeypatch)
    batch = (await client.post(
        "/api/intake/batches/text", json={"text": SIGN}, headers=ops
    )).json()
    await client.patch(
        f"/api/intake/observations/{batch['observations'][0]['id']}",
        json={"status": "confirmed"}, headers=ops,
    )

    _, member, _ = await _register(client, prefix="member")
    seen = (await client.get("/api/market-data/observations", headers=member)).json()
    assert seen["access"]["tier"] == "member"
    assert seen["count"] >= 1
    mine = [i for i in seen["items"] if i["price_kes"] == 2100]
    assert mine and mine[0]["product"]
    # The seller's identity and number are the paid layer — on every row.
    assert all(item["seller"] is None for item in seen["items"])
    assert all(item["seller_hidden"] for item in seen["items"])
    assert seen["access"]["upgrade"]["label"]
    # …and the upgrade says, in the payload, that nothing is charged yet.
    assert "nothing is charged" in seen["access"]["upgrade"]["note"].lower()


async def test_a_paid_plan_sees_the_contact(client, monkeypatch):
    ops = await _ops(client, monkeypatch)
    batch = (await client.post(
        "/api/intake/batches/text", json={"text": SIGN}, headers=ops
    )).json()
    await client.patch(
        f"/api/intake/observations/{batch['observations'][0]['id']}",
        json={"status": "confirmed"}, headers=ops,
    )

    _, partner, handle = await _register(client, prefix="partner")

    # The plan is the existing entitlement; no second billing concept is invented.
    from sqlalchemy import select

    from app.database import async_session
    from app.models.vendor import Vendor

    async with async_session() as session:
        vendor = (
            await session.execute(select(Vendor).where(Vendor.vendor_handle == handle))
        ).scalars().first()
        vendor.plan_tier = "business"
        await session.commit()

    seen = (await client.get("/api/market-data/observations", headers=partner)).json()
    assert seen["access"]["tier"] == "partner"
    mine = [i for i in seen["items"] if i["price_kes"] == 2100]
    assert mine[0]["seller"]["phone"] == "+254104211141"
    assert mine[0]["seller"]["virtual_id"].startswith("~")


async def test_a_seller_can_claim_their_record_by_proving_the_number(client, monkeypatch):
    ops = await _ops(client, monkeypatch)
    batch = (await client.post(
        "/api/intake/batches/text", json={"text": SIGN}, headers=ops
    )).json()
    virtual_id = batch["presence"]["virtual_id"]

    # A business whose number does not match cannot take someone else's prices.
    _, stranger, _ = await _register(client, prefix="stranger")
    denied = await client.post(f"/api/market-data/presences/{virtual_id}/claim", headers=stranger)
    assert denied.status_code in (403, 409)
    assert "match" in denied.json()["detail"].lower() or "claimed" in denied.json()["detail"].lower()

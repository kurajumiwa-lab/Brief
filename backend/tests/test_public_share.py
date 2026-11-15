"""OpenGraph share surfaces.

The promises these tests defend:

  · a crawler that runs no JavaScript still sees a title, a description and an
    absolute image for `/p/<handle>` and `/invite/<shop>`;
  · the card is generated from rows, not from a mocked "verified" badge;
  · the image is 1200×630, well under WhatsApp's 300 KB ceiling, and cacheable;
  · an invite exposes a shop and an aggregate receipt count, never a buyer,
    an amount or an invoice number.
"""

import html as html_lib
import io
import uuid
from datetime import datetime, timedelta

import pytest
from PIL import Image

from app.database import async_session
from app.models.vendor import Vendor

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


def _pin() -> str:
    number = uuid.uuid4().int % 1_000_000_000
    return f"P{number:09d}{chr(65 + uuid.uuid4().int % 26)}"


def _invoice() -> str:
    return f"INV-{uuid.uuid4().hex[:10].upper()}"


def _qr(pin: str, invoice: str, total: int = 1250, name: str = "Kisumu Fresh Mart") -> str:
    when = datetime.utcnow() - timedelta(minutes=5)
    return (
        f"MerchantName={name}&TraderSystemPin={pin}"
        f"&ControlUnitInvoiceNumber={invoice}&TotalAmount={total}"
        f"&IssuedAt={when.isoformat()}"
    )


async def _register(client, label: str):
    suffix = uuid.uuid4().hex[:6]
    handle = f"{label}_{suffix}"
    response = await client.post("/api/auth/register", json={
        "business_name": f"{label.title()} Ltd",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "password": PASSWORD,
        "business_categories": ["nursing", "fresh_produce"],
        "physical_location": "Kisumu, Nyanza",
    })
    assert response.status_code == 201, response.text
    body = response.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, body["vendor_id"], handle


async def _make_trader(client):
    headers, vendor_id, handle = await _register(client, "share_trader")
    async with async_session() as db:
        vendor = await db.get(Vendor, uuid.UUID(vendor_id))
        vendor.phone = "0712000111"
        vendor.phone_verified_at = datetime.utcnow()
        vendor.allow_direct_calls = True
        vendor.movements_completed = 3
        vendor.confirmed_trade_proofs = 1
        vendor.fulfillment_rate = 0.95
        vendor.business_description = "Home nursing and fresh produce in Kisumu."
        await db.commit()
    return headers, handle


def _meta(html: str, prop: str) -> str:
    marker = f'property="{prop}" content="'
    assert marker in html, f"{prop} missing"
    return html_lib.unescape(html.split(marker, 1)[1].split('"', 1)[0])


async def test_profile_shell_has_crawler_metadata_and_no_fake_verification(client):
    _headers, handle = await _make_trader(client)

    response = await client.get(f"/p/{handle}")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"].startswith("public, max-age=300")
    html = response.text

    assert f"/p/{handle}" in _meta(html, "og:url")
    assert _meta(html, "og:image").endswith(f"/og/p/{handle}.jpg")
    assert _meta(html, "og:image:width") == "1200"
    assert _meta(html, "og:image:height") == "630"
    assert _meta(html, "og:type") == "profile"
    assert "Level 3 of 5" in _meta(html, "og:title")
    assert "Kisumu" in _meta(html, "og:title")
    assert "4 completed trades" in _meta(html, "og:description")
    assert "Nursing & Fresh Produce" in _meta(html, "og:description")
    # The server never ran a KRA lookup, so it never prints that claim.
    assert "verified by KRA" not in html.lower()
    assert "twitter:card" in html


async def test_profile_image_is_small_cacheable_and_the_right_shape(client):
    _headers, handle = await _make_trader(client)

    response = await client.get(f"/og/p/{handle}.jpg")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"].startswith("public, max-age=3600")
    assert response.content[:2] == b"\xff\xd8"
    assert len(response.content) < 150 * 1024
    image = Image.open(io.BytesIO(response.content))
    assert image.size == (1200, 630)


async def test_invite_shell_counts_receipts_but_never_names_a_buyer(client):
    headers, _vendor_id, _handle = await _register(client, "share_buyer")
    pin = _pin()
    invoice = _invoice()
    submitted = await client.post("/api/receipts", json={
        "payload": _qr(pin, invoice), "region": "nyanza",
    }, headers=headers)
    assert submitted.status_code == 201, submitted.text

    response = await client.get("/invite/kisumu-fresh-mart")
    assert response.status_code == 200, response.text
    html = response.text
    assert "1 customer receipt waiting" in _meta(html, "og:title")
    assert "Kisumu Fresh Mart" in _meta(html, "og:title")
    assert _meta(html, "og:image").endswith("/og/invite/kisumu-fresh-mart.jpg")
    assert invoice not in html
    assert "1,250" not in html

    public = await client.get("/api/receipts/invites/kisumu-fresh-mart")
    assert public.status_code == 200, public.text
    body = public.json()
    assert body["shop"]["name"] == "Kisumu Fresh Mart"
    assert body["shop"]["claim_status"] == "unclaimed"
    assert body["receipts"] == 1
    assert pin not in body["description"]
    assert "buyer" not in public.text.lower()


async def test_invite_image_matches_the_same_shop(client):
    headers, _vendor_id, _handle = await _register(client, "share_invite")
    assert (await client.post("/api/receipts", json={
        "payload": _qr(_pin(), _invoice()), "region": "nyanza",
    }, headers=headers)).status_code == 201

    response = await client.get("/og/invite/kisumu-fresh-mart.jpg")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/jpeg"
    assert len(response.content) < 150 * 1024
    assert Image.open(io.BytesIO(response.content)).size == (1200, 630)


async def test_missing_pages_say_so_without_a_share_card(client):
    page = await client.get("/p/nobody_here")
    assert page.status_code == 404
    assert "noindex" in page.text

    invite = await client.get("/invite/no-such-shop")
    assert invite.status_code == 404

    image = await client.get("/og/p/nobody_here.jpg")
    assert image.status_code == 404

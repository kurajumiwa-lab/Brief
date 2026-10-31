"""
PHOTOGRAPHS — the pipeline that makes "photos are visible everywhere" true.

The report was one sentence: *"photos is a must — they aren't visible in the
whole app."* Server-side the storage round-trip already worked (a `/static/...`
URL came back intact from every stock endpoint), so the failures were at the two
edges:

  · the file that arrived was an **iPhone HEIC**, which no browser outside Safari
    paints — stored, served, invisible;
  · the file was **5 MB of camera**, refused by a 3 MB cap with a message that
    did not say what to do, or accepted and slow to load on a 3G phone;
  · and on the client, a bare storage key (`uploads/…`) resolved against the
    current route, 404'd, and painted a broken-image glyph.

These tests pin the server half: bytes in → a JPEG a browser can paint, under the
cap, with the right way up, and a batch that reports per-file failures instead of
throwing away the ten photographs that worked.
"""

import io
import uuid

import pytest

from httpx import AsyncClient

from app.services.images import (
    HEIF_AVAILABLE,
    MAX_EDGE,
    PIL_AVAILABLE,
    UnsupportedImage,
    is_heif,
    prepare_image,
    supported,
)

pytestmark = pytest.mark.skipif(not PIL_AVAILABLE, reason="pillow is not installed")


def _jpeg(size=(3000, 2400), colour=(200, 60, 40), orientation=None) -> bytes:
    from PIL import Image

    image = Image.new("RGB", size, colour)
    out = io.BytesIO()
    if orientation is not None:
        exif = image.getexif()
        exif[0x0112] = orientation  # Orientation
        image.save(out, format="JPEG", exif=exif)
    else:
        image.save(out, format="JPEG")
    return out.getvalue()


def test_a_camera_photo_is_downscaled_and_reports_itself_as_jpeg():
    data = _jpeg((4000, 3000))
    assert len(data) > 100_000  # a phone-sized file, not a fixture

    prepared, name, content_type = prepare_image(data, "IMG_0421.JPG", "image/jpeg")

    assert content_type == "image/jpeg"
    assert name == "IMG_0421.jpg"
    assert len(prepared) < len(data)

    from PIL import Image

    with Image.open(io.BytesIO(prepared)) as image:
        assert max(image.size) == MAX_EDGE
        # the aspect ratio survives, so a shelf does not become a square
        assert image.size[0] / image.size[1] == pytest.approx(4 / 3, rel=0.01)


def test_an_exif_rotation_is_applied_to_the_pixels():
    # Orientation 6 = rotate 90° clockwise. A phone held sideways writes this
    # instead of rotating the pixels; if we drop the tag without applying it the
    # photo lands on the listing on its side.
    data = _jpeg((800, 400), orientation=6)
    prepared, _, _ = prepare_image(data, "sideways.jpg", "image/jpeg")

    from PIL import Image

    with Image.open(io.BytesIO(prepared)) as image:
        assert image.size == (400, 800)


def test_a_jpeg_above_the_cap_is_resized_rather_than_refused():
    # 3 MB cap, a 4 MB photo: the old code answered 413 and the vendor was left
    # believing photos do not work. Downscaling is the answer, not rejection.
    cap = 3 * 1024 * 1024
    from PIL import Image

    noisy = Image.effect_noise((3000, 3000), 90).convert("RGB")
    out = io.BytesIO()
    noisy.save(out, format="JPEG", quality=95)
    data = out.getvalue()
    assert len(data) > cap

    prepared, _, content_type = prepare_image(data, "big.jpg", "image/jpeg", max_bytes=cap)
    assert content_type == "image/jpeg"
    assert len(prepared) <= cap


def test_a_screenshot_that_is_already_fine_is_stored_byte_for_byte():
    # 1080×2400 is exactly a phone screenshot: upright, under the long-edge
    # limit, under the cap. Re-encoding it would spend a second of upload time
    # and a generation of JPEG quality to change nothing — and it cost the OCR
    # reader lines when it happened (470 → 451 on the Khetia specimen).
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (1080, 2400), (30, 30, 30)).save(out, format="JPEG", quality=92)
    data = out.getvalue()

    prepared, name, content_type = prepare_image(data, "shot.jpg", "image/jpeg")
    assert prepared == data
    assert name == "shot.jpg"
    assert content_type == "image/jpeg"


def test_heif_is_detected_by_extension_type_and_bytes():
    assert is_heif("IMG_1.HEIC", "application/octet-stream")
    assert is_heif("photo", "image/heic")
    # the ISO-BMFF brand in the first bytes, whatever the name says
    assert is_heif("upload.bin", None, b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00")
    assert not is_heif("photo.jpg", "image/jpeg", _jpeg((10, 10)))


@pytest.mark.skipif(HEIF_AVAILABLE, reason="only the no-reader fallback is tested here")
def test_heic_without_a_reader_is_refused_with_an_instruction():
    with pytest.raises(UnsupportedImage) as excinfo:
        prepare_image(b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00", "IMG_0421.HEIC", "image/heic")
    message = str(excinfo.value)
    assert "HEIC" in message
    # it must tell the person what to do, not just that it failed
    assert "Most Compatible" in message or "JPEG" in message


def test_a_pdf_is_never_touched():
    data = b"%PDF-1.4\n" + b"x" * 500
    prepared, name, content_type = prepare_image(data, "sheet.pdf", "application/pdf")
    assert prepared == data
    assert name == "sheet.pdf"
    assert content_type == "application/pdf"


def test_an_image_this_build_cannot_decode_is_stored_untouched():
    # Refusing a file Pillow dislikes would delete photographs a browser can
    # still paint. The bytes go through unchanged; only the size cap can refuse.
    data = b"\xff\xd8\xff\xe0" + b"brief-test-photo" + b"\xff\xd9"
    prepared, name, content_type = prepare_image(data, "legacy.jpg", "image/jpeg")
    assert prepared == data
    assert name == "legacy.jpg"
    assert content_type == "image/jpeg"


def test_support_is_reported_so_the_client_can_ask_before_it_tries():
    report = supported()
    assert report["resize"] is True
    assert report["max_edge"] == MAX_EDGE
    assert isinstance(report["heif"], bool)


# ── the endpoints ────────────────────────────────────────────────────────────
#
# The suite's client is an httpx AsyncClient (see conftest), so these specs are
# async like the rest of the backend tests.


async def _register(client) -> dict:
    suffix = uuid.uuid4().hex[:6]
    response = await client.post(
        "/api/auth/register",
        json={
            "business_name": f"Shelf Vendor {suffix}",
            "vendor_handle": f"shelf_{suffix}",
            "email": f"shelf_{suffix}@example.com",
            "password": "Correct-horse-9",
            "business_categories": ["produce"],
            "physical_location": "Kisumu",
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _upload_files(client, headers, files):
    return await client.post(
        "/api/files/upload-many",
        headers=headers,
        files=[("files", (name, data, ctype)) for name, data, ctype in files],
    )


async def test_batch_upload_stores_several_photos_in_one_request(client: AsyncClient):
    headers = await _register(client)
    one = _jpeg((1200, 900), (10, 120, 200))
    two = _jpeg((900, 1200), (200, 120, 10))

    response = await _upload_files(
        client, headers, [("shelf-a.jpg", one, "image/jpeg"), ("shelf-b.jpg", two, "image/jpeg")]
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["count"] == 2
    assert body["rejected"] == []
    for stored in body["files"]:
        assert stored["url"].startswith("/static/uploads/")
        assert stored["content_type"] == "image/jpeg"


async def test_batch_upload_keeps_the_good_files_and_names_the_bad_one(client: AsyncClient):
    headers = await _register(client)

    response = await _upload_files(
        client,
        headers,
        [
            ("shelf.jpg", _jpeg((800, 600)), "image/jpeg"),
            ("notes.txt", b"not an image at all", "text/plain"),
        ],
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["count"] == 1
    assert len(body["rejected"]) == 1
    assert body["rejected"][0]["filename"] == "notes.txt"

    # the photograph is still served afterwards — stored, reachable, painted
    served = await client.get(body["files"][0]["url"])
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("image/jpeg")


async def test_batch_upload_refuses_thirteen(client: AsyncClient):
    headers = await _register(client)
    photo = _jpeg((100, 100))
    response = await _upload_files(
        client, headers, [(f"p{i}.jpg", photo, "image/jpeg") for i in range(13)]
    )
    assert response.status_code == 400
    assert "12" in response.json()["detail"]


async def test_batch_upload_needs_a_signed_in_vendor(client: AsyncClient):
    response = await client.post(
        "/api/files/upload-many",
        files=[("files", ("a.jpg", _jpeg((10, 10)), "image/jpeg"))],
    )
    assert response.status_code in (401, 403)


async def test_limits_report_the_image_pipeline(client: AsyncClient):
    headers = await _register(client)
    response = await client.get("/api/files/limits", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert ".heic" in body["allowed"]
    assert body["batch_max"] == 12
    assert body["images"]["resize"] is True

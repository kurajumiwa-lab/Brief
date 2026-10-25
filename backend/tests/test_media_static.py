"""Uploaded photos must be reachable at the URL the API hands out.

The bug this file protects against, reported as "photos don't render":

  · `POST /api/files/upload` returned `/static/uploads/<uuid>/<name>` and the
    bytes went to a relative directory. On a read-only serverless image that
    directory is replaced by a per-instance /tmp, and on a container host it is
    replaced by the next deploy. The URL stayed in the database; the bytes did
    not; `/static/...` answered 404 and every card showed a broken image.
  · `MEDIA_STORE=db` keeps the bytes in `media_objects` and `/static/<key>`
    serves them, so the same URL works on every instance.
  · `/static` must serve ONLY the exact key shape `upload()` mints — no
    traversal, no arbitrary paths.

Also here: `/api/tools/browse` dropped `images` from its response model, which
is why the equipment shelf never showed a photo even when one existed.
"""

import uuid

import pytest

from app.config import Settings
from app.services.storage import STORE_DB, STORE_LOCAL, STORE_S3, storage

JPEG = b"\xff\xd8\xff\xe0" + b"brief-test-photo" + b"\xff\xd9"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client) -> tuple[dict, dict]:
    suffix = uuid.uuid4().hex[:6]
    r = await client.post("/api/auth/register", json={
        "business_name": f"Photo Vendor {suffix}",
        "vendor_handle": f"photo_{suffix}",
        "email": f"photo_{suffix}@example.com",
        "password": "Correct-horse-9",
        "business_categories": ["produce"],
        "physical_location": "Kisumu",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    return body, _auth(body["access_token"])


async def _upload(client, headers) -> str:
    r = await client.post(
        "/api/files/upload",
        headers=headers,
        files={"file": ("photo.jpg", JPEG, "image/jpeg")},
    )
    assert r.status_code == 201, r.text
    url = r.json()["url"]
    assert url.startswith("/static/uploads/"), url
    return url


# ── the local disk backend (development default) ────────────────────────────


async def test_uploaded_photo_is_served_back_from_static(client):
    _, headers = await _register(client)
    url = await _upload(client, headers)

    r = await client.get(url)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("image/jpeg")
    assert r.content == JPEG
    # Keys carry a UUID directory, so a URL never changes its bytes.
    assert "immutable" in r.headers.get("cache-control", "")


async def test_head_answers_with_headers_and_no_body(client):
    """`curl -sI` is in the go-live guide; so are link previews and CDNs."""
    _, headers = await _register(client)
    url = await _upload(client, headers)

    r = await client.head(url)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/jpeg")
    assert r.content == b""


async def test_a_missing_key_is_a_clean_404_not_a_crash(client):
    missing = f"/static/uploads/{uuid.uuid4()}/nope.jpg"
    r = await client.get(missing)
    assert r.status_code == 404


@pytest.mark.parametrize("path", [
    # Percent-encoded so the traversal reaches the route instead of being
    # normalised away by the HTTP client before it is sent.
    "/static/%2e%2e/.env",
    "/static/uploads/%2e%2e/%2e%2e/etc/passwd",
    "/static/not-an-upload.jpg",
    "/static/uploads/not-a-uuid/photo.jpg",
    "/static/uploads/%s/%%2e%%2e/secret" % uuid.uuid4(),
])
async def test_static_refuses_anything_that_is_not_an_upload_key(client, path):
    r = await client.get(path)
    assert r.status_code == 404


async def test_static_never_serves_a_file_outside_the_upload_root(client):
    """The key shape is the guard: no `..`, no absolute path, no other prefix."""
    for path in (
        "/static/uploads/%2e%2e/%2e%2e/%2e%2e/.env",
        "/static/voice-notes/00000000-0000-0000-0000-000000000000.wav",
    ):
        r = await client.get(path)
        assert r.status_code == 404, path
        assert "SECRET" not in r.text, path


# ── the Postgres backend (production default without S3) ────────────────────


@pytest.fixture
def db_store():
    """Run one test against the database backend and always put it back."""
    original = storage.store
    storage.store = STORE_DB
    try:
        yield storage
    finally:
        storage.store = original


async def test_db_backend_serves_the_same_url_from_any_instance(client, db_store):
    from sqlalchemy import select

    from app.database import async_session
    from app.models.media import MediaObject

    _, headers = await _register(client)
    url = await _upload(client, headers)
    key = url.removeprefix("/static/")

    # Nothing was written to the ephemeral filesystem …
    assert not (storage.local_dir / key).exists()
    # … and the row is there instead.
    async with async_session() as session:
        row = (await session.execute(select(MediaObject).where(MediaObject.key == key))).scalar_one()
        assert row.data == JPEG
        assert row.content_type == "image/jpeg"
        assert row.byte_size == len(JPEG)
        assert len(row.sha256) == 64

    r = await client.get(url)
    assert r.status_code == 200
    assert r.content == JPEG
    assert r.headers["content-type"].startswith("image/jpeg")

    head = await client.head(url)
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["content-type"].startswith("image/jpeg")


async def test_db_backend_still_serves_files_already_on_disk(client, db_store):
    """Switching backends must not orphan the photos a deployment already had."""
    _, headers = await _register(client)
    url = await _upload(client, headers)
    key = url.removeprefix("/static/")

    # Write the bytes straight to the disk location, as the old backend would have.
    path = storage.local_dir / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(JPEG)
    try:
        r = await client.get(url)
        assert r.status_code == 200
        assert r.content == JPEG
    finally:
        path.unlink(missing_ok=True)


async def test_deleting_an_upload_removes_it_from_the_backend(client, db_store):
    _, headers = await _register(client)
    url = await _upload(client, headers)

    await storage.delete(url)
    r = await client.get(url)
    assert r.status_code == 404


# ── backend selection ───────────────────────────────────────────────────────


def test_media_store_auto_picks_database_in_production_without_a_bucket():
    prod = Settings(ENVIRONMENT="production", SECRET_KEY="a" * 40, S3_BUCKET="", MEDIA_STORE="auto")
    assert prod.media_store == STORE_DB


def test_media_store_auto_prefers_s3_when_a_bucket_is_configured():
    prod = Settings(ENVIRONMENT="production", SECRET_KEY="a" * 40, S3_BUCKET="brief-media", MEDIA_STORE="auto")
    assert prod.media_store == STORE_S3


def test_media_store_auto_is_the_disk_in_development():
    dev = Settings(ENVIRONMENT="development", MEDIA_STORE="auto", S3_BUCKET="")
    assert dev.media_store == STORE_LOCAL


def test_media_store_can_be_forced():
    prod = Settings(ENVIRONMENT="production", SECRET_KEY="a" * 40, S3_BUCKET="brief-media", MEDIA_STORE="local")
    assert prod.media_store == STORE_LOCAL


# ── the equipment shelf gets its photos ─────────────────────────────────────


async def test_tool_browse_returns_listing_images(client):
    _, headers = await _register(client)
    photo = f"/static/uploads/{uuid.uuid4()}/warehouse.jpg"
    r = await client.post("/api/tools/list", headers=headers, json={
        "title": "Cold room, 20 pallets",
        "category": "warehouse",
        "price_per_unit": 3500,
        "price_unit": "per_day",
        "location": "Kisumu",
        "images": [photo],
    })
    assert r.status_code == 201, r.text

    # browse excludes the caller's own listings by default; ask for them.
    r = await client.get("/api/tools/mine", headers=headers)
    assert r.status_code == 200, r.text
    rows = [row for row in r.json() if row["title"] == "Cold room, 20 pallets"]
    assert rows, r.text
    assert rows[0]["images"] == [photo]

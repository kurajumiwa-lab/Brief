"""The page gallery: a board of photographs with one tag each.

The board is public and vendor-written, so — exactly like selected work — the
shape of a record is the contract. What this file holds to:

    1. A photo needs an image the browser can load. No `data:` URL, no `blob:`,
       no bare path, no photo-less tile.
    2. A tag is one of a fixed list. The chip row only filters if the words are
       the same on every page, so an unknown tag is filed as `other` rather than
       becoming a chip of its own.
    3. Saying nothing never clears the board; sending `[]` does.
    4. A visitor reads the same list the owner saved, with per-tag counts, from
       the public account payload.
    5. The board is capped, because a stranger is reading it on a phone.
"""

import uuid

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, prefix="gallery"):
    suffix = uuid.uuid4().hex[:8]
    handle = f"{prefix}_{suffix}"
    res = await client.post("/api/auth/register", json={
        "business_name": f"Studio {suffix[:4]}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "phone": "254712345678",
        "password": PASSWORD,
        "business_categories": ["cleaning"],
        "physical_location": "Kisumu",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    return body, {"Authorization": f"Bearer {body['access_token']}"}, handle


def _photo(**overrides):
    base = {
        "image_url": "/static/uploads/board/one.jpg",
        "caption": "Deep clean, Milimani",
        "tag": "work",
    }
    base.update(overrides)
    return base


async def test_the_owner_saves_a_board_and_everyone_reads_it(client):
    _, headers, handle = await _register(client)

    res = await client.put("/api/vendors/me/profile", json={
        "gallery_items": [
            _photo(),
            _photo(image_url="/static/uploads/board/two.jpg", caption="", tag="team"),
            _photo(image_url="https://cdn.example/three.jpg", caption="Before", tag="before-after"),
        ],
    }, headers=headers)
    assert res.status_code == 200, res.text
    saved = res.json()["gallery_items"]
    assert [item["image_url"] for item in saved] == [
        "/static/uploads/board/one.jpg",
        "/static/uploads/board/two.jpg",
        "https://cdn.example/three.jpg",
    ]
    # An empty caption stays empty: a photo with no words shows no caption line.
    assert saved[1]["caption"] == ""

    public = await client.get(f"/api/vendors/{handle}", headers=headers)
    assert public.status_code == 200, public.text
    body = public.json()
    assert len(body["gallery_items"]) == 3
    # The chip row is driven by these counts, so they must be the real numbers.
    assert body["gallery_tags"]["work"] == 1
    assert body["gallery_tags"]["team"] == 1
    assert body["gallery_tags"]["before-after"] == 1
    assert body["gallery_tags"]["event"] == 0


async def test_a_photo_must_be_a_photo(client):
    _, headers, _ = await _register(client)

    for bad in (
        _photo(image_url=""),
        _photo(image_url="data:image/jpeg;base64,AAAA"),
        _photo(image_url="blob:https://example.com/123"),
        _photo(image_url="javascript:alert(1)"),
        _photo(image_url="board/one.jpg"),
        _photo(image_url="javascript:alert(1)", caption="x" * 500),
        # A field a photo tile cannot render.
        _photo(price=100),
    ):
        res = await client.put("/api/vendors/me/profile", json={"gallery_items": [bad]}, headers=headers)
        assert res.status_code == 422, (bad, res.text)


async def test_an_unknown_tag_is_filed_as_other_rather_than_invented(client):
    _, headers, handle = await _register(client)
    res = await client.put("/api/vendors/me/profile", json={
        "gallery_items": [_photo(tag="Cleaning Services!!")],
    }, headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["gallery_items"][0]["tag"] == "other"

    # And the stored tag is always a known one, from the fixed vocabulary.
    public = (await client.get(f"/api/vendors/{handle}", headers=headers)).json()
    assert {item["tag"] for item in public["gallery_items"]} <= {
        "work", "before-after", "premises", "team", "product", "event", "other",
    }


async def test_the_board_is_capped_and_never_becomes_a_camera_roll(client):
    _, headers, _ = await _register(client)
    too_many = [_photo(image_url=f"/static/uploads/board/{i}.jpg") for i in range(31)]
    res = await client.put("/api/vendors/me/profile", json={"gallery_items": too_many}, headers=headers)
    assert res.status_code == 422


async def test_saying_nothing_keeps_the_board_and_an_empty_list_clears_it(client):
    _, headers, handle = await _register(client)
    await client.put("/api/vendors/me/profile", json={"gallery_items": [_photo()]}, headers=headers)

    # Another part of the app saving a profile must not wipe the photographs.
    untouched = await client.put("/api/vendors/me/profile", json={"accepts_bulk": False}, headers=headers)
    assert untouched.status_code == 200
    assert len(untouched.json()["gallery_items"]) == 1

    cleared = await client.put("/api/vendors/me/profile", json={"gallery_items": []}, headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["gallery_items"] == []
    public = (await client.get(f"/api/vendors/{handle}", headers=headers)).json()
    assert public["gallery_items"] == []


async def test_a_new_page_starts_with_an_empty_board(client):
    _, headers, handle = await _register(client)
    profile = await client.get("/api/vendors/me/profile", headers=headers)
    assert profile.status_code == 200
    assert profile.json()["gallery_items"] == []
    public = await client.get(f"/api/vendors/{handle}", headers=headers)
    assert public.json()["gallery_items"] == []
    assert set(public.json()["gallery_tags"].values()) == {0}


async def test_the_gallery_and_the_showcase_stay_separate(client):
    """Pictures and proof are two lists: saving one never edits the other."""
    _, headers, handle = await _register(client)
    await client.put("/api/vendors/me/profile", json={
        "work_items": [{"title": "Office contract", "summary": "Nine months, no missed evening"}],
        "gallery_items": [_photo()],
    }, headers=headers)

    await client.put("/api/vendors/me/profile", json={"gallery_items": []}, headers=headers)
    public = (await client.get(f"/api/vendors/{handle}", headers=headers)).json()
    assert public["gallery_items"] == []
    assert [item["title"] for item in public["work_items"]] == ["Office contract"]


async def test_a_photo_the_uploader_returned_can_be_attached_to_a_card(client):
    """The URL `/api/files/upload` hands back must be one the profile accepts.

    This is the seam that failed once: the uploader returned `/static/…`, the
    work-item validator did not know that prefix, and the photo could be
    uploaded but never shown. Both the gallery and selected work are checked.
    """
    _, headers, handle = await _register(client)
    upload = await client.post(
        "/api/files/upload",
        files={"file": ("stall.jpg", _tiny_jpeg(), "image/jpeg")},
        headers=headers,
    )
    assert upload.status_code in (200, 201), upload.text
    url = upload.json()["url"]
    assert url.startswith("/static/"), url

    res = await client.put("/api/vendors/me/profile", json={
        "work_items": [{"title": "Deep clean", "image_url": url}],
        "gallery_items": [_photo(image_url=url)],
    }, headers=headers)
    assert res.status_code == 200, res.text
    body = (await client.get(f"/api/vendors/{handle}", headers=headers)).json()
    assert body["gallery_items"][0]["image_url"] == url
    assert body["work_items"][0]["image_url"] == url


def _tiny_jpeg() -> bytes:
    """A one-pixel JPEG, so the upload path is exercised without a camera."""
    import base64

    return base64.b64decode(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
        "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
        "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
    )

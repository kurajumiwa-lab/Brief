"""Short vendor-to-vendor voice notes in chat."""

import io
import uuid

import pytest

pytestmark = pytest.mark.asyncio


async def _register(client, handle: str) -> dict:
    suffix = uuid.uuid4().hex[:6]
    response = await client.post("/api/auth/register", json={
        "business_name": handle.title(), "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com", "password": "Correct-horse-9",
        "business_categories": ["retail"], "physical_location": "Nairobi",
    })
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _vendor_id(client, headers) -> str:
    response = await client.get("/api/vendors/me", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def test_voice_note_upload_playback_and_room_privacy(client):
    sender = await _register(client, "voice_sender")
    receiver = await _register(client, "voice_receiver")
    outsider = await _register(client, "voice_outsider")
    receiver_id = await _vendor_id(client, receiver)

    response = await client.post(f"/api/chat/direct/{receiver_id}", headers=sender)
    assert response.status_code == 200, response.text
    room_id = response.json()["room_id"]

    audio = b"webm test clip\x00\x01"
    response = await client.post(
        f"/api/chat/{room_id}/voice", headers=sender,
        data={"duration_seconds": "4"},
        files={"file": ("voice-note.webm", io.BytesIO(audio), "audio/webm;codecs=opus")},
    )
    assert response.status_code == 201, response.text
    sent = response.json()["sent"]
    assert sent["message_type"] == "voice" and sent["content"] == ""
    assert sent["attachments"] == [{
        "kind": "voice", "content_type": "audio/webm", "duration_seconds": 4.0, "size_bytes": len(audio),
    }]
    assert "storage_key" not in response.text

    messages = await client.get(f"/api/chat/{room_id}/messages", headers=receiver)
    assert messages.status_code == 200, messages.text
    assert messages.json()[-1]["id"] == sent["id"]

    playback = await client.get(f"/api/chat/{room_id}/voice/{sent['id']}", headers=receiver)
    assert playback.status_code == 200
    assert playback.content == audio
    assert playback.headers["content-type"].startswith("audio/webm")
    assert playback.headers["cache-control"] == "private, no-store"

    assert (await client.get(f"/api/chat/{room_id}/voice/{sent['id']}")).status_code == 401
    assert (await client.get(f"/api/chat/{room_id}/voice/{sent['id']}", headers=outsider)).status_code == 403


async def test_voice_note_requires_joining_an_open_topic(client):
    owner = await _register(client, "topic_owner")
    visitor = await _register(client, "topic_visitor")
    created = await client.post("/api/chat/niche-topic", headers=owner, json={
        "name": "Sourcing alerts", "topic": "Local supplier updates", "topic_tags": ["sourcing"],
    })
    assert created.status_code == 201, created.text
    room_id = created.json()["room_id"]
    endpoint = f"/api/chat/{room_id}/voice"
    upload = {"file": ("note.webm", io.BytesIO(b"audio"), "audio/webm")}

    not_joined = await client.post(endpoint, headers=visitor, data={"duration_seconds": "2"}, files=upload)
    assert not_joined.status_code == 403

    assert (await client.post(f"/api/chat/{room_id}/join", headers=visitor)).status_code == 200
    joined = await client.post(
        endpoint, headers=visitor, data={"duration_seconds": "2"},
        files={"file": ("note.webm", io.BytesIO(b"audio"), "audio/webm")},
    )
    assert joined.status_code == 201, joined.text


async def test_voice_note_rejects_bad_duration_format_and_oversize(client):
    sender = await _register(client, "voice_limits")
    peer = await _register(client, "voice_peer")
    room_id = (await client.post(
        f"/api/chat/direct/{await _vendor_id(client, peer)}", headers=sender,
    )).json()["room_id"]
    endpoint = f"/api/chat/{room_id}/voice"

    too_long = await client.post(
        endpoint, headers=sender, data={"duration_seconds": "16"},
        files={"file": ("note.webm", io.BytesIO(b"audio"), "audio/webm")},
    )
    assert too_long.status_code == 400

    wrong_format = await client.post(
        endpoint, headers=sender, data={"duration_seconds": "3"},
        files={"file": ("note.bin", io.BytesIO(b"not audio"), "application/octet-stream")},
    )
    assert wrong_format.status_code == 415

    too_large = await client.post(
        endpoint, headers=sender, data={"duration_seconds": "3"},
        files={"file": ("note.webm", io.BytesIO(b"x" * (512 * 1024 + 1)), "audio/webm")},
    )
    assert too_large.status_code == 413

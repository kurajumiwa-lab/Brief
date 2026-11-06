"""v3.7 — business follows, 24-hour statuses and the notification radar.

What these prove:
- a business follows another business (never itself), and unfollowing is easy and repeatable;
- a follow notifies the followed business once, through the one notification system;
- a status reaches only the businesses that follow its author, and never its author's rivals;
- a status expires after 24 hours and a deleted status never comes back;
- views are recorded once per viewer, and only the author can see who viewed;
- media must be a file Brief stored, and video stays off until switched on;
- the radar counts what is new without marking anything seen.
"""

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import update

from app.config import settings as live_settings
from app.database import async_session
from app.models.notification import Notification, NotificationType
from app.modules.statuses import service
from app.modules.statuses.models import BusinessStatus
from tests.test_v35_offers import PASSWORD, _register

pytestmark = pytest.mark.asyncio

PHOTO = "/static/status/shop-front.jpg"


# ---------- the rules themselves (no database) ----------------------------------------

def test_media_must_be_ours():
    assert service.is_our_media("/static/status/a.jpg")
    assert not service.is_our_media("https://evil.example.com/a.jpg")
    assert not service.is_our_media("/static/../etc/passwd")
    assert not service.is_our_media(None)
    assert not service.is_our_media("/static/" + "x" * 700)


def test_text_status_needs_text_and_no_media():
    assert service.validate_new_status("text", "  Fresh maize in today  ", None) == ("Fresh maize in today", None)
    with pytest.raises(service.StatusError):
        service.validate_new_status("text", "   ", None)
    with pytest.raises(service.StatusError):
        service.validate_new_status("text", "hi", PHOTO)


def test_photo_needs_an_uploaded_photo_and_body_is_capped():
    assert service.validate_new_status("photo", "Open today", PHOTO) == ("Open today", PHOTO)
    with pytest.raises(service.StatusError):
        service.validate_new_status("photo", "no picture", None)
    with pytest.raises(service.StatusError):
        service.validate_new_status("photo", "x" * 501, PHOTO)
    with pytest.raises(service.StatusError):
        service.validate_new_status("photo", "ok", "https://elsewhere.example.com/x.jpg")


def test_video_is_off_by_default(monkeypatch):
    monkeypatch.setattr(live_settings, "STATUS_VIDEO_ENABLED", False)
    with pytest.raises(service.StatusError) as e:
        service.validate_new_status("video", "clip", "/static/status/clip.mp4")
    assert "not switched on" in str(e.value)


def test_video_accepted_only_when_switched_on(monkeypatch):
    monkeypatch.setattr(live_settings, "STATUS_VIDEO_ENABLED", True)
    assert service.validate_new_status("video", None, "/static/status/clip.mp4")[1] == "/static/status/clip.mp4"


def test_unknown_kind_rejected():
    with pytest.raises(service.StatusError):
        service.validate_new_status("gif", "x", None)


# ---------- helpers --------------------------------------------------------------------------

async def _biz(client, prefix):
    handle, headers, vid = await _register(client, prefix)
    return {"handle": handle, "headers": headers, "id": vid}


async def _post(client, biz, body="Fresh stock", kind="text", media=None):
    payload = {"kind": kind, "body": body}
    if media:
        payload["media_url"] = media
    r = await client.post("/api/statuses", headers=biz["headers"], json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _follow(client, follower, target_id):
    return await client.post(f"/api/statuses/follow/{target_id}", headers=follower["headers"])


async def _groups(client, biz):
    r = await client.get("/api/statuses/feed", headers=biz["headers"])
    assert r.status_code == 200, r.text
    return r.json()["groups"]


async def _notes(client, biz):
    r = await client.get("/api/notifications", headers=biz["headers"])
    assert r.status_code == 200, r.text
    return r.json()["notifications"]


# ---------- follows ---------------------------------------------------------------------------

async def test_follow_then_unfollow_is_easy_and_repeatable(client):
    a, b = await _biz(client, "fola"), await _biz(client, "folb")
    r = await _follow(client, a, b["id"])
    assert r.status_code == 201 and r.json()["created"] is True
    again = await _follow(client, a, b["id"])
    assert again.status_code == 200 and again.json()["created"] is False  # no duplicate

    state = (await client.get(f"/api/statuses/follow/{b['id']}", headers=a["headers"])).json()
    assert state["following"] is True and state["followers"] == 1

    assert (await client.delete(f"/api/statuses/follow/{b['id']}", headers=a["headers"])).json()["following"] is False
    # unfollowing twice is fine
    again_off = await client.delete(f"/api/statuses/follow/{b['id']}", headers=a["headers"])
    assert again_off.status_code == 200 and again_off.json()["removed"] is False


async def test_cannot_follow_yourself_or_an_unknown_business(client):
    a = await _biz(client, "self")
    r = await _follow(client, a, a["id"])
    assert r.status_code == 400
    r = await _follow(client, a, uuid.uuid4())
    assert r.status_code == 404


async def test_follow_notifies_the_followed_business_once(client):
    a, b = await _biz(client, "notea"), await _biz(client, "noteb")
    await _follow(client, a, b["id"])
    await _follow(client, a, b["id"])  # second press makes no new notification
    notes = [n for n in await _notes(client, b) if n["type"] == "business_follow"]
    assert len(notes) == 1
    assert "started following you" in notes[0]["title"]
    unread = (await client.get("/api/notifications/unread-count", headers=b["headers"])).json()
    assert unread["unread_count"] >= 1


async def test_following_does_not_notify_the_follower(client):
    a, b = await _biz(client, "quiet1"), await _biz(client, "quiet2")
    await _follow(client, a, b["id"])
    assert not [n for n in await _notes(client, a) if n["type"] == "business_follow"]


async def test_unfollow_does_not_notify(client):
    a, b = await _biz(client, "unn1"), await _biz(client, "unn2")
    await _follow(client, a, b["id"])
    before = len(await _notes(client, b))
    await client.delete(f"/api/statuses/follow/{b['id']}", headers=a["headers"])
    assert len(await _notes(client, b)) == before


async def test_suggestions_exclude_me_and_people_i_already_follow(client):
    me = await _biz(client, "sugme")
    other = await _biz(client, "sugother")
    await _follow(client, me, other["id"])
    ids = [s["vendor_id"] for s in (await client.get("/api/statuses/suggestions", headers=me["headers"])).json()["businesses"]]
    assert me["id"] not in ids
    assert other["id"] not in ids
    assert len(ids) <= service.SUGGESTION_LIMIT


async def test_following_list_shows_my_follows(client):
    a, b = await _biz(client, "lista"), await _biz(client, "listb")
    await _follow(client, a, b["id"])
    rows = (await client.get("/api/statuses/following", headers=a["headers"])).json()["businesses"]
    assert [r["vendor_id"] for r in rows] == [b["id"]]


# ---------- audience and posting ----------------------------------------------------------------

async def test_status_reaches_only_followers(client):
    author, follower, stranger = await _biz(client, "auth"), await _biz(client, "fllw"), await _biz(client, "strg")
    await _follow(client, follower, author["id"])
    await _post(client, author, "Fresh maize")
    assert [g["vendor"]["id"] for g in await _groups(client, follower)] == [author["id"]]
    assert await _groups(client, stranger) == []


async def test_author_does_not_see_own_status_in_feed(client):
    author = await _biz(client, "solo")
    await _post(client, author, "Hello")
    assert await _groups(client, author) == []
    mine = (await client.get("/api/statuses/mine", headers=author["headers"])).json()["statuses"]
    assert len(mine) == 1 and mine[0]["view_count"] == 0


async def test_posting_a_photo_status_and_text_status(client):
    author = await _biz(client, "pics")
    follower = await _biz(client, "picsf")
    await _follow(client, follower, author["id"])
    await _post(client, author, "Open till 6", kind="photo", media=PHOTO)
    groups = await _groups(client, follower)
    assert groups[0]["statuses"][0]["kind"] == "photo"
    assert groups[0]["statuses"][0]["media_url"] == PHOTO


async def test_post_rejects_foreign_media_and_video_by_default(client, monkeypatch):
    monkeypatch.setattr(live_settings, "STATUS_VIDEO_ENABLED", False)
    author = await _biz(client, "badm")
    r = await client.post("/api/statuses", headers=author["headers"],
                          json={"kind": "photo", "media_url": "https://evil.example.com/a.jpg"})
    assert r.status_code == 422
    r = await client.post("/api/statuses", headers=author["headers"],
                          json={"kind": "video", "media_url": "/static/status/c.mp4"})
    assert r.status_code == 422


async def test_status_requires_a_signed_in_business(client):
    r = await client.post("/api/statuses", json={"kind": "text", "body": "hi"})
    assert r.status_code in (401, 403)
    assert (await client.get("/api/statuses/feed")).status_code in (401, 403)


async def test_statuses_do_not_create_notifications(client):
    author, follower = await _biz(client, "nonot"), await _biz(client, "nonotf")
    await _follow(client, follower, author["id"])
    before = len(await _notes(client, follower))
    await _post(client, author, "Big news")
    assert len(await _notes(client, follower)) == before


# ---------- expiry and deletion ----------------------------------------------------------------

async def test_status_expires_after_24_hours(client):
    author, follower = await _biz(client, "expa"), await _biz(client, "expf")
    await _follow(client, follower, author["id"])
    sid = await _post(client, author, "Gone soon")
    assert len(await _groups(client, follower)) == 1
    async with async_session() as db:
        await db.execute(update(BusinessStatus).where(BusinessStatus.id == uuid.UUID(sid))
                         .values(expires_at=datetime.utcnow() - timedelta(minutes=1)))
        await db.commit()
    assert await _groups(client, follower) == []
    r = await client.post(f"/api/statuses/{sid}/view", headers=follower["headers"])
    assert r.status_code == 404


async def test_new_status_expires_in_about_24_hours(client):
    author = await _biz(client, "ttl")
    sid = await _post(client, author, "Clock")
    async with async_session() as db:
        row = await db.get(BusinessStatus, uuid.UUID(sid))
        delta = row.expires_at - row.created_at
    assert timedelta(hours=23, minutes=59) < delta <= timedelta(hours=24, seconds=5)


async def test_author_can_delete_own_status_and_it_stays_gone(client):
    author, follower = await _biz(client, "delA"), await _biz(client, "delF")
    await _follow(client, follower, author["id"])
    sid = await _post(client, author, "Oops")
    other = await _biz(client, "delO")
    assert (await client.delete(f"/api/statuses/{sid}", headers=other["headers"])).status_code == 404
    assert (await client.delete(f"/api/statuses/{sid}", headers=author["headers"])).status_code == 200
    assert await _groups(client, follower) == []
    assert (await client.delete(f"/api/statuses/{sid}", headers=author["headers"])).status_code == 404


# ---------- views and rings -----------------------------------------------------------------------

async def test_viewing_marks_seen_and_changes_the_ring(client):
    author, follower = await _biz(client, "ringA"), await _biz(client, "ringF")
    await _follow(client, follower, author["id"])
    sid = await _post(client, author, "Ring test")
    assert (await _groups(client, follower))[0]["unseen"] is True

    r = await client.post(f"/api/statuses/{sid}/view", headers=follower["headers"])
    assert r.status_code == 200 and r.json()["new"] is True
    again = await client.post(f"/api/statuses/{sid}/view", headers=follower["headers"])
    assert again.json()["new"] is False  # recorded once

    group = (await _groups(client, follower))[0]
    assert group["unseen"] is False
    assert group["statuses"][0]["viewed"] is True


async def test_unseen_groups_sort_before_seen_groups(client):
    viewer = await _biz(client, "sortv")
    seen_author, new_author = await _biz(client, "sorta"), await _biz(client, "sortb")
    await _follow(client, viewer, seen_author["id"])
    await _follow(client, viewer, new_author["id"])
    seen_id = await _post(client, seen_author, "old")
    await _post(client, new_author, "new")
    await client.post(f"/api/statuses/{seen_id}/view", headers=viewer["headers"])
    order = [g["vendor"]["id"] for g in await _groups(client, viewer)]
    assert order == [new_author["id"], seen_author["id"]]


async def test_only_author_sees_viewers(client):
    author, follower = await _biz(client, "vwA"), await _biz(client, "vwF")
    await _follow(client, follower, author["id"])
    sid = await _post(client, author, "Who looked")
    await client.post(f"/api/statuses/{sid}/view", headers=follower["headers"])

    mine = await client.get(f"/api/statuses/{sid}/viewers", headers=author["headers"])
    assert mine.status_code == 200
    assert [v["vendor_id"] for v in mine.json()["viewers"]] == [follower["id"]]

    theirs = await client.get(f"/api/statuses/{sid}/viewers", headers=follower["headers"])
    assert theirs.status_code == 404  # not the author: no list at all


async def test_author_views_do_not_count(client):
    author = await _biz(client, "selfv")
    sid = await _post(client, author, "Mine")
    r = await client.post(f"/api/statuses/{sid}/view", headers=author["headers"])
    assert r.json()["new"] is False


async def test_non_follower_cannot_record_a_view(client):
    author, stranger = await _biz(client, "nfA"), await _biz(client, "nfS")
    sid = await _post(client, author, "Private")
    r = await client.post(f"/api/statuses/{sid}/view", headers=stranger["headers"])
    assert r.status_code == 404


async def test_my_statuses_show_view_counts(client):
    author, f1, f2 = await _biz(client, "cntA"), await _biz(client, "cntF1"), await _biz(client, "cntF2")
    await _follow(client, f1, author["id"])
    await _follow(client, f2, author["id"])
    sid = await _post(client, author, "Counted")
    await client.post(f"/api/statuses/{sid}/view", headers=f1["headers"])
    await client.post(f"/api/statuses/{sid}/view", headers=f2["headers"])
    row = next(s for s in (await client.get("/api/statuses/mine", headers=author["headers"])).json()["statuses"]
               if s["id"] == sid)
    assert row["view_count"] == 2


# ---------- radar ----------------------------------------------------------------------------------

async def test_radar_counts_unseen_without_marking_anything_seen(client):
    author, follower = await _biz(client, "radA"), await _biz(client, "radF")
    await _follow(client, follower, author["id"])
    await _post(client, author, "one")
    await _post(client, author, "two")

    r1 = (await client.get("/api/statuses/radar", headers=follower["headers"])).json()
    assert r1["unseen_statuses"] == 2 and r1["unseen_businesses"] == 1
    r2 = (await client.get("/api/statuses/radar", headers=follower["headers"])).json()
    assert r2["unseen_statuses"] == 2  # reading the radar does not mark anything seen


async def test_radar_counts_follow_notifications_and_trade_separately(client):
    a, b = await _biz(client, "rdfA"), await _biz(client, "rdfB")
    await _follow(client, a, b["id"])
    async with async_session() as db:
        from app.models.vendor import Vendor
        vb = await db.get(Vendor, uuid.UUID(b["id"]))
        db.add(Notification(recipient_id=vb.id, notification_type=NotificationType.SOURCE_REQUEST,
                            title="Source request", body=""))
        await db.commit()
    r = (await client.get("/api/statuses/radar", headers=b["headers"])).json()
    assert r["unread_follows"] == 1
    assert r["unread_trade"] == 1
    assert r["unread_total"] >= 2


async def test_radar_is_empty_for_a_new_business(client):
    fresh = await _biz(client, "rdfNew")
    r = (await client.get("/api/statuses/radar", headers=fresh["headers"])).json()
    assert r["unseen_statuses"] == 0 and r["unseen_businesses"] == 0


# ---------- privacy of follows and suspended businesses --------------------------------------------

async def test_suspended_business_is_hidden_from_suggestions_and_feed(client):
    from app.models.vendor import Vendor
    author, follower = await _biz(client, "susA"), await _biz(client, "susF")
    await _follow(client, follower, author["id"])
    await _post(client, author, "Visible until suspended")
    async with async_session() as db:
        v = await db.get(Vendor, uuid.UUID(author["id"]))
        v.fraud_suspended_at = datetime.utcnow()
        await db.commit()
    assert await _groups(client, follower) == []
    ids = [s["vendor_id"] for s in (await client.get("/api/statuses/suggestions", headers=follower["headers"])).json()["businesses"]]
    assert author["id"] not in ids
    r = await _follow(client, follower, author["id"])
    assert r.status_code == 404

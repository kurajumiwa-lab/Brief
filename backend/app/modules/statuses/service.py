"""Rules for follows, statuses, views and the radar.

Rules that matter, in one place:
  · a business can follow another business, never itself;
  · a status is visible only to the businesses that follow its author;
  · a status expires 24 hours after it is posted, and deleted ones never return;
  · only the author sees who viewed a status;
  · a follow notifies the followed business once, through the one notification
    system (`notification_service`). Statuses themselves do not notify anyone:
    the radar counts what is new instead, so a busy supplier cannot flood buyers.
"""

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.notification import Notification, NotificationType
from app.models.vendor import Vendor
from app.modules.statuses.models import BusinessFollow, BusinessStatus, StatusView
from app.services.notification_service import create_notification

STATUS_TTL = timedelta(hours=24)
TEXT_MAX = 500
KINDS = ("text", "photo", "video")
SUGGESTION_LIMIT = 8
FEED_GROUP_LIMIT = 50
PER_GROUP_LIMIT = 20

# Notifications that mean "trade needs you" on the radar.
TRADE_TYPES = (
    NotificationType.SOURCE_REQUEST, NotificationType.SOURCE_ACCEPTED, NotificationType.SOURCE_SHIPPED,
    NotificationType.SOURCE_RECEIVED, NotificationType.SOURCE_CANCELLED, NotificationType.DEAL_PROPOSAL,
    NotificationType.DEAL_ACCEPTED, NotificationType.DEAL_COUNTERED, NotificationType.DEAL_DECLINED,
    NotificationType.PAYMENT_UPDATE, NotificationType.SHIPMENT_UPDATE, NotificationType.DELIVERY_QUOTE_REQUEST,
)


class StatusError(Exception):
    """A rule was broken. `status` is the HTTP code the router should return."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def now() -> datetime:
    # Naive UTC, the same convention the models use.
    return datetime.utcnow()


def is_our_media(url: Optional[str]) -> bool:
    """Only files this platform stored may be attached to a status.

    Uploads are served from /static/ (database or local storage) or from the
    configured S3-compatible bucket. Anything else would let a status point a
    buyer's browser at an arbitrary host.
    """
    if not url or len(url) > 600:
        return False
    if url.startswith("/static/") and ".." not in url:
        return True
    for base in (settings.S3_PUBLIC_URL, settings.S3_ENDPOINT):
        if base and url.startswith(base.rstrip("/") + "/"):
            return True
    if settings.S3_BUCKET and url.startswith(f"https://{settings.S3_BUCKET}.s3."):
        return True
    return False


def validate_new_status(kind: str, body: Optional[str], media_url: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Check a status before it is stored. Returns the cleaned (body, media_url)."""
    if kind not in KINDS:
        raise StatusError("A status must be text, photo or video.")
    body = (body or "").strip() or None
    if body and len(body) > TEXT_MAX:
        raise StatusError(f"A status can be at most {TEXT_MAX} characters.")
    if kind == "text":
        if not body:
            raise StatusError("Write something for a text status.")
        if media_url:
            raise StatusError("A text status cannot carry a picture or video.")
        return body, None
    if kind == "video" and not settings.STATUS_VIDEO_ENABLED:
        raise StatusError("Video statuses are not switched on yet. Post a photo or text.", status=422)
    if not media_url:
        raise StatusError(f"A {kind} status needs the {kind} to be uploaded first.")
    if not is_our_media(media_url):
        raise StatusError("That picture or video was not uploaded to Brief.")
    return body, media_url


async def _business_or_none(db: AsyncSession, vendor_id: uuid.UUID) -> Optional[Vendor]:
    vendor = await db.get(Vendor, vendor_id)
    if vendor is None or vendor.fraud_suspended_at is not None:
        return None
    return vendor


async def following_ids(db: AsyncSession, viewer_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(select(BusinessFollow.followed_id).where(BusinessFollow.follower_id == viewer_id))
    return list(rows.scalars().all())


async def follow(db: AsyncSession, follower: Vendor, target_id: uuid.UUID) -> bool:
    """Follow a business. Returns True when a new follow was created."""
    if target_id == follower.id:
        raise StatusError("A business cannot follow itself.", status=400)
    target = await _business_or_none(db, target_id)
    if target is None:
        raise StatusError("That business is not on the network.", status=404)
    exists = await db.execute(
        select(BusinessFollow.id).where(
            BusinessFollow.follower_id == follower.id, BusinessFollow.followed_id == target_id
        )
    )
    if exists.scalar_one_or_none():
        return False
    db.add(BusinessFollow(follower_id=follower.id, followed_id=target_id))
    await db.flush()
    await create_notification(
        db,
        recipient_id=target_id,
        notification_type=NotificationType.BUSINESS_FOLLOW,
        title=f"{follower.business_name} started following you",
        body="Their updates will now reach you in the status row on Home.",
        sender_id=follower.id,
        data={"follower_id": follower.id, "follower_handle": follower.vendor_handle},
    )
    return True


async def unfollow(db: AsyncSession, follower: Vendor, target_id: uuid.UUID) -> bool:
    """Stop following. Idempotent: returns False when there was nothing to remove."""
    result = await db.execute(
        BusinessFollow.__table__.delete().where(
            BusinessFollow.follower_id == follower.id, BusinessFollow.followed_id == target_id
        )
    )
    return (result.rowcount or 0) > 0


async def follow_state(db: AsyncSession, viewer: Vendor, target_id: uuid.UUID) -> dict:
    following = await db.execute(
        select(BusinessFollow.id).where(
            BusinessFollow.follower_id == viewer.id, BusinessFollow.followed_id == target_id
        )
    )
    followers = await db.execute(
        select(func.count(BusinessFollow.id)).where(BusinessFollow.followed_id == target_id)
    )
    return {
        "vendor_id": str(target_id),
        "following": following.scalar_one_or_none() is not None,
        "followers": int(followers.scalar() or 0),
    }


async def suggestions(db: AsyncSession, viewer: Vendor, limit: int = SUGGESTION_LIMIT) -> list[dict]:
    """Businesses worth following: not me, not already followed, not suspended.

    Ranked by how many live statuses they have, then by how many follow them,
    so a new shop is shown the businesses that are actually posting.
    """
    followed = select(BusinessFollow.followed_id).where(BusinessFollow.follower_id == viewer.id)
    live = (
        select(BusinessStatus.vendor_id, func.count(BusinessStatus.id).label("live"))
        .where(BusinessStatus.removed_at.is_(None), BusinessStatus.expires_at > now())
        .group_by(BusinessStatus.vendor_id)
        .subquery()
    )
    query = (
        select(Vendor, func.coalesce(live.c.live, 0))
        .outerjoin(live, live.c.vendor_id == Vendor.id)
        .where(
            Vendor.id != viewer.id,
            Vendor.id.not_in(followed),
            Vendor.fraud_suspended_at.is_(None),
        )
        .order_by(func.coalesce(live.c.live, 0).desc(), Vendor.business_name.asc())
        .limit(limit)
    )
    rows = (await db.execute(query)).all()
    return [
        {
            "vendor_id": str(v.id),
            "handle": v.vendor_handle,
            "business_name": v.business_name,
            "categories": list(v.business_categories or []),
            "live_statuses": int(n),
        }
        for v, n in rows
    ]


async def post_status(db: AsyncSession, author: Vendor, kind: str, body: Optional[str],
                      media_url: Optional[str]) -> BusinessStatus:
    body, media_url = validate_new_status(kind, body, media_url)
    created = now()
    status = BusinessStatus(
        vendor_id=author.id,
        kind=kind,
        body=body,
        media_url=media_url,
        created_at=created,
        expires_at=created + STATUS_TTL,
    )
    db.add(status)
    await db.flush()
    return status


async def _owned(db: AsyncSession, owner: Vendor, status_id: uuid.UUID) -> BusinessStatus:
    status = await db.get(BusinessStatus, status_id)
    if status is None or status.vendor_id != owner.id or status.removed_at is not None:
        raise StatusError("That status was not found.", status=404)
    return status


async def delete_status(db: AsyncSession, owner: Vendor, status_id: uuid.UUID) -> None:
    status = await _owned(db, owner, status_id)
    status.removed_at = now()


def _live_filter():
    return and_(BusinessStatus.removed_at.is_(None), BusinessStatus.expires_at > now())


async def _viewed_ids(db: AsyncSession, viewer_id: uuid.UUID, status_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not status_ids:
        return set()
    rows = await db.execute(
        select(StatusView.status_id).where(StatusView.viewer_id == viewer_id, StatusView.status_id.in_(status_ids))
    )
    return set(rows.scalars().all())


def _public_status(s: BusinessStatus, viewed: bool) -> dict:
    return {
        "id": str(s.id),
        "kind": s.kind,
        "body": s.body,
        "media_url": s.media_url,
        "created_at": s.created_at.isoformat(),
        "expires_at": s.expires_at.isoformat(),
        "viewed": viewed,
    }


async def feed(db: AsyncSession, viewer: Vendor) -> list[dict]:
    """One group per followed business that has live statuses.

    Groups with something unseen come first (coloured rings), then the rest
    (muted rings). Inside a group the statuses run oldest first, as people
    expect from a story row.
    """
    followed = await following_ids(db, viewer.id)
    if not followed:
        return []
    rows = await db.execute(
        select(BusinessStatus, Vendor)
        .join(Vendor, Vendor.id == BusinessStatus.vendor_id)
        .where(
            BusinessStatus.vendor_id.in_(followed),
            _live_filter(),
            Vendor.fraud_suspended_at.is_(None),
        )
        .order_by(BusinessStatus.created_at.asc())
    )
    pairs = rows.all()
    viewed = await _viewed_ids(db, viewer.id, [s.id for s, _ in pairs])

    groups: dict[uuid.UUID, dict] = {}
    for status, vendor in pairs:
        group = groups.setdefault(vendor.id, {
            "vendor": {"id": str(vendor.id), "handle": vendor.vendor_handle, "business_name": vendor.business_name},
            "statuses": [],
            "latest_at": status.created_at,
            "unseen": False,
        })
        group["statuses"].append(_public_status(status, status.id in viewed))
        group["latest_at"] = max(group["latest_at"], status.created_at)
        if status.id not in viewed:
            group["unseen"] = True

    ordered = sorted(groups.values(), key=lambda g: (not g["unseen"], -g["latest_at"].timestamp()))
    out = []
    for g in ordered[:FEED_GROUP_LIMIT]:
        g["statuses"] = g["statuses"][-PER_GROUP_LIMIT:]
        g["latest_at"] = g["latest_at"].isoformat()
        out.append(g)
    return out


async def mark_viewed(db: AsyncSession, viewer: Vendor, status_id: uuid.UUID) -> bool:
    """Record that the viewer saw a status. Only followers (and the author) may."""
    status = await db.get(BusinessStatus, status_id)
    if status is None or status.removed_at is not None or status.expires_at <= now():
        raise StatusError("That status is no longer available.", status=404)
    if status.vendor_id != viewer.id:
        follows = await db.execute(
            select(BusinessFollow.id).where(
                BusinessFollow.follower_id == viewer.id, BusinessFollow.followed_id == status.vendor_id
            )
        )
        if follows.scalar_one_or_none() is None:
            raise StatusError("That status is no longer available.", status=404)
    if status.vendor_id == viewer.id:
        return False  # an author's own view is not a view
    result = await db.execute(
        pg_insert(StatusView)
        .values(id=uuid.uuid4(), status_id=status_id, viewer_id=viewer.id, viewed_at=now())
        .on_conflict_do_nothing(constraint="uq_status_view_pair")
    )
    return (result.rowcount or 0) > 0


async def viewers(db: AsyncSession, owner: Vendor, status_id: uuid.UUID) -> list[dict]:
    """Who viewed one of my statuses. Only the author ever gets this list."""
    await _owned(db, owner, status_id)
    rows = await db.execute(
        select(StatusView, Vendor)
        .join(Vendor, Vendor.id == StatusView.viewer_id)
        .where(StatusView.status_id == status_id)
        .order_by(StatusView.viewed_at.desc())
    )
    return [
        {"vendor_id": str(v.id), "handle": v.vendor_handle, "business_name": v.business_name,
         "viewed_at": sv.viewed_at.isoformat()}
        for sv, v in rows.all()
    ]


async def mine(db: AsyncSession, owner: Vendor) -> list[dict]:
    """My live statuses, each with how many businesses have viewed it."""
    rows = await db.execute(
        select(BusinessStatus, func.count(StatusView.id))
        .outerjoin(StatusView, StatusView.status_id == BusinessStatus.id)
        .where(BusinessStatus.vendor_id == owner.id, _live_filter())
        .group_by(BusinessStatus.id)
        .order_by(BusinessStatus.created_at.asc())
    )
    return [{**_public_status(s, False), "view_count": int(n)} for s, n in rows.all()]


async def radar(db: AsyncSession, viewer: Vendor) -> dict:
    """Counts for the quick-glance row. Read-only: it never marks anything seen."""
    followed = await following_ids(db, viewer.id)
    unseen_statuses = 0
    unseen_businesses = 0
    if followed:
        rows = await db.execute(
            select(BusinessStatus.id, BusinessStatus.vendor_id).where(
                BusinessStatus.vendor_id.in_(followed), _live_filter()
            )
        )
        pairs = rows.all()
        viewed = await _viewed_ids(db, viewer.id, [sid for sid, _ in pairs])
        unseen = [vid for sid, vid in pairs if sid not in viewed]
        unseen_statuses = len(unseen)
        unseen_businesses = len(set(unseen))

    unread = await db.execute(
        select(Notification.notification_type, func.count(Notification.id))
        .where(Notification.recipient_id == viewer.id, Notification.is_read.is_(False))
        .group_by(Notification.notification_type)
    )
    by_type = {t: int(n) for t, n in unread.all()}
    trade = sum(n for t, n in by_type.items() if t in TRADE_TYPES)
    follows = by_type.get(NotificationType.BUSINESS_FOLLOW, 0)
    return {
        "unseen_statuses": unseen_statuses,
        "unseen_businesses": unseen_businesses,
        "unread_trade": trade,
        "unread_follows": follows,
        "unread_total": sum(by_type.values()),
    }

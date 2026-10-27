"""The social layer's rules, in one readable place.

The router stays thin; this module holds the parts where a mistake would be a
product failure rather than a 500:

  · who may see what (blocks, mutes, moderation status);
  · who may post into which circle;
  · how database rows become the shape ``services.verdict`` ranks.

The visibility query is the important one. It filters on exactly three things —
``status``, blocks and mutes — and it never reads a reaction. Any future filter
added here must pass ``tests/test_social_permissions.py::test_visibility_...``,
which asserts that a post with fifty downvotes is still returned.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Iterable, Mapping, Sequence

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.groups import VendorGroup
from app.models.social import (
    SocialAccount,
    SocialBlock,
    SocialCircleFollow,
    SocialPost,
    SocialReaction,
    SocialReport,
)
from app.models.vendor import Vendor
from app.services.verdict import rank_posts, visible_posts

HANDLE_RE = re.compile(r"^[a-z0-9_]{3,30}$")


# ── identity ──────────────────────────────────────────────────────────────────


def normalise_handle(raw: str) -> str:
    """Lower-case, strip the @, keep [a-z0-9_]. Raises 422 on an unusable handle."""
    handle = (raw or "").strip().lstrip("@").lower()
    if not HANDLE_RE.match(handle):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A handle is 3–30 characters: letters, numbers and underscores.",
        )
    return handle


async def unique_handle(db: AsyncSession, base: str) -> str:
    """A handle nobody holds yet. Used when a vendor is given a social identity."""
    candidate = normalise_handle(base)[:26] or "member"
    suffix = 0
    while True:
        trial = candidate if suffix == 0 else f"{candidate}{suffix}"
        taken = (
            await db.execute(select(SocialAccount.id).where(SocialAccount.handle == trial))
        ).scalar_one_or_none()
        if taken is None:
            return trial
        suffix += 1
        if suffix > 999:
            return f"{candidate}{uuid.uuid4().hex[:6]}"[:30]


async def ensure_social_account(db: AsyncSession, vendor: Vendor) -> SocialAccount:
    """The social identity behind a vendor, created on first use.

    A trader can speak without doing anything: their existing login is enough.
    The account is *linked* to the vendor, never merged into it — ``vendor_id``
    is a pointer, and cutting it leaves the posts standing.
    """
    existing = (
        await db.execute(select(SocialAccount).where(SocialAccount.vendor_id == vendor.id))
    ).scalar_one_or_none()
    if existing:
        return existing

    account = SocialAccount(
        handle=await unique_handle(db, getattr(vendor, "vendor_handle", None) or "member"),
        display_name=(vendor.business_name or vendor.vendor_handle or "Member")[:120],
        # `vendors` stores a free-text location, not a city column; the first
        # segment is the closest honest thing to a city.
        city=(getattr(vendor, "physical_location", None) or "").split(",")[0].strip()[:120] or None,
        vendor_id=vendor.id,
    )
    db.add(account)
    await db.flush()
    return account


async def create_standalone_account(
    db: AsyncSession, *, handle: str, display_name: str, city: str | None, locale: str = "en"
) -> SocialAccount:
    """Register a participant who is not a business, and does not want to be."""
    clean = normalise_handle(handle)
    taken = (
        await db.execute(select(SocialAccount.id).where(SocialAccount.handle == clean))
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That handle is taken.")

    account = SocialAccount(handle=clean, display_name=(display_name or clean)[:120], city=city, locale=locale or "en")
    db.add(account)
    await db.flush()
    return account


# ── visibility ────────────────────────────────────────────────────────────────


async def hidden_author_ids(db: AsyncSession, viewer_id: uuid.UUID) -> set[uuid.UUID]:
    """Authors this viewer has blocked or muted. Their choice, not a verdict."""
    rows = (
        await db.execute(
            select(SocialBlock.target_id).where(
                and_(SocialBlock.account_id == viewer_id, SocialBlock.kind.in_(("block", "mute")))
            )
        )
    ).scalars()
    return set(rows)


def visible_query(viewer_id: uuid.UUID, hidden: Iterable[uuid.UUID]):
    """The only three reasons a post is not shown. None of them is a reaction.

    Kept as a query builder rather than a Python filter so that a feed of ten
    thousand rows does not have to be loaded to be filtered — but the rule lives
    here, in one place, and a test pins that ``social_reactions`` is not joined.
    """
    hidden = [author for author in set(hidden) if author != viewer_id]
    conditions = [SocialPost.status != "removed"]
    if hidden:
        conditions.append(SocialPost.author_id.notin_(hidden))
    return select(SocialPost).where(and_(*conditions))


def filter_visible(posts: Sequence[Mapping], viewer_id, hidden: set) -> list[Mapping]:
    """The Python twin of ``visible_query``, for rows already in memory."""
    return visible_posts(posts, blocked_author_ids=hidden, muted_author_ids=hidden)


# ── posting ───────────────────────────────────────────────────────────────────


async def require_postable_circle(db: AsyncSession, viewer_id: uuid.UUID, circle_id: uuid.UUID) -> VendorGroup:
    """A circle you may write into.

    Public circles are open to everyone — that is what "public" means, and
    requiring membership would re-create the closed shop this layer exists to
    avoid. A private circle is only writable by someone who has joined it.
    """
    circle = (await db.execute(select(VendorGroup).where(VendorGroup.id == circle_id))).scalar_one_or_none()
    if circle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That circle does not exist.")
    if circle.is_public:
        return circle

    follows = (
        await db.execute(
            select(SocialCircleFollow.id).where(
                and_(SocialCircleFollow.account_id == viewer_id, SocialCircleFollow.circle_id == circle_id)
            )
        )
    ).scalar_one_or_none()
    if follows is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This circle is private. Join it before posting.",
        )
    return circle


async def require_post(db: AsyncSession, post_id: uuid.UUID, *, allow_removed: bool = False) -> SocialPost:
    post = (await db.execute(select(SocialPost).where(SocialPost.id == post_id))).scalar_one_or_none()
    if post is None or (post.status == "removed" and not allow_removed):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That post is not available.")
    return post


# ── ranking against real rows ─────────────────────────────────────────────────


async def ranked_feed(
    db: AsyncSession,
    viewer: SocialAccount,
    *,
    circle_id: uuid.UUID | None = None,
    limit: int = 30,
    now: datetime | None = None,
) -> list[dict]:
    """Load, filter, rank — in that order, and never the reverse.

    Ranking is done in Python by ``services.verdict`` so that the feed and the
    verdict panel are literally the same function. That is affordable because
    the query is already bounded; when it stops being affordable, the same
    arithmetic moves into SQL with these tests as the oracle.
    """
    now = now or datetime.utcnow()
    now_ms = now.replace(tzinfo=None).timestamp() * 1000

    hidden = await hidden_author_ids(db, viewer.id)
    query = visible_query(viewer.id, hidden).order_by(SocialPost.created_at.desc()).limit(max(1, min(limit, 200)))
    if circle_id is not None:
        query = query.where(SocialPost.circle_id == circle_id)

    posts = list((await db.execute(query)).scalars())
    if not posts:
        return []

    post_ids = [post.id for post in posts]
    # Materialised, not streamed: this is iterated twice (once to group by post,
    # once to find the viewer's own reaction) and a ScalarResult is exhausted by
    # the first pass. As a stream it also silently dropped reaction authors from
    # the standing map, so every reaction was weighted as a new account.
    rows = list(
        (
            await db.execute(
                select(SocialReaction)
                .where(SocialReaction.post_id.in_(post_ids))
                .order_by(SocialReaction.created_at)
            )
        ).scalars()
    )
    reactions_by_post: dict[uuid.UUID, list[SocialReaction]] = {}
    for reaction in rows:
        reactions_by_post.setdefault(reaction.post_id, []).append(reaction)

    author_ids = {post.author_id for post in posts} | {
        reaction.account_id for row in rows for reaction in [row]
    }
    accounts = {
        account.id: account
        for account in (
            await db.execute(select(SocialAccount).where(SocialAccount.id.in_(author_ids)))
        ).scalars()
    }

    reaction_counts = dict(
        (
            await db.execute(
                select(SocialReaction.account_id, func.count())
                .where(SocialReaction.account_id.in_(author_ids))
                .group_by(SocialReaction.account_id)
            )
        ).all()
    )

    viewer_circles = set(
        (
            await db.execute(
                select(SocialCircleFollow.circle_id).where(SocialCircleFollow.account_id == viewer.id)
            )
        ).scalars()
    )

    # Whose reaction is whose — the card needs to know which button is pressed
    # for *this* reader, and the verdict is computed from everybody's.
    my_reaction = {}
    for reaction in rows:
        if reaction.account_id == viewer.id:
            my_reaction[reaction.post_id] = reaction.value

    shaped = [
        {
            "id": post.id,
            "circle_id": post.circle_id,
            "author_id": post.author_id,
            "body": post.body,
            "lang": post.lang,
            "image_url": post.image_url,
            "data_kb": post.data_kb,
            "status": post.status,
            # Naive UTC in, ISO with a Z out — the same string the client parses.
            "created_at": post.created_at.isoformat() + "Z",
            "reactions": [
                {
                    "id": str(reaction.id),
                    "user_id": reaction.account_id,
                    "value": reaction.value,
                    "at": reaction.created_at.replace(tzinfo=None).timestamp() * 1000,
                }
                for reaction in reactions_by_post.get(post.id, [])
            ],
        }
        for post in posts
    ]

    users_by_id = {
        account_id: {
            "id": account_id,
            "handle": account.handle if account else None,
            "reactions_given": reaction_counts.get(account_id, 0),
        }
        for account_id, account in accounts.items()
    }

    ranked = rank_posts(
        shaped, users_by_id=users_by_id, viewer_circle_ids=viewer_circles, now_ms=now_ms
    )

    return [
        {
            "post": _post_out(entry["post"], accounts),
            "score": entry["score"],
            "raised_by_floor": entry["raised_by_floor"],
            "parts": entry["parts"],
            "verdict": entry["verdict"],
            "my_reaction": my_reaction.get(entry["post"]["id"]),
            "circle_following": entry["post"]["circle_id"] in viewer_circles,
        }
        for entry in ranked
    ]


def _post_out(post: Mapping, accounts: Mapping) -> dict:
    author = accounts.get(post["author_id"])
    return {
        "id": post["id"],
        "circle_id": post["circle_id"],
        "body": post["body"],
        "lang": post["lang"],
        "image_url": post["image_url"],
        "data_kb": post["data_kb"],
        "status": post["status"],
        "created_at": post["created_at"],
        "author": {
            "id": post["author_id"],
            "handle": author.handle if author else None,
            "display_name": author.display_name if author else None,
            "city": author.city if author else None,
        },
    }


# ── reports ───────────────────────────────────────────────────────────────────


def new_case_number() -> str:
    """Short enough to read aloud on the phone, unique by construction."""
    return "C-" + uuid.uuid4().hex[:8].upper()


async def open_report(
    db: AsyncSession, *, post: SocialPost, reporter: SocialAccount, reason: str, detail: str | None
) -> SocialReport:
    """Open a case. Deliberately does not touch ``post.status``."""
    existing = (
        await db.execute(
            select(SocialReport).where(
                and_(SocialReport.post_id == post.id, SocialReport.reporter_id == reporter.id)
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You already reported this post. Case {existing.case_number}.",
        )

    report = SocialReport(
        post_id=post.id,
        reporter_id=reporter.id,
        reason=reason,
        detail=detail,
        case_number=new_case_number(),
    )
    db.add(report)
    await db.flush()
    return report


__all__ = [
    "normalise_handle",
    "unique_handle",
    "ensure_social_account",
    "create_standalone_account",
    "hidden_author_ids",
    "visible_query",
    "filter_visible",
    "require_postable_circle",
    "require_post",
    "ranked_feed",
    "open_report",
    "new_case_number",
]

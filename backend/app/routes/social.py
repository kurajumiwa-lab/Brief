"""Caesar's social layer over the network.

Every route here is additive: nothing existing is modified, and no route reads
or writes ``network_score`` / ``parasitism_index``.

**Who may participate.** Anyone. A Brief vendor is given a social identity
automatically on first use, but a social account can also be created on its own
— no business, no vendor row, no trade standing. That separation is the point
of ``app/models/social.py`` and the reason ``social_accounts.vendor_id`` is
nullable.

**What the routes refuse to do:**

  · a reaction never changes a post's status — see ``POST /posts/{id}/reactions``;
  · a report never hides a post — it opens a case with a number;
  · blocking is the viewer's own choice and is reversible in both directions.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.groups import VendorGroup
from app.models.social import (
    BLOCK_KINDS,
    REPORT_REASONS,
    SocialAccount,
    SocialBlock,
    SocialCircleFollow,
    SocialPost,
    SocialReaction,
    SocialReport,
)
from app.models.vendor import Vendor
from app.platform.security import create_access_token, oauth2_scheme
from app.routes.auth import get_current_vendor
from app.services import social as social_service

router = APIRouter()


# ── identity ──────────────────────────────────────────────────────────────────


class AccountRegister(BaseModel):
    handle: str = Field(min_length=3, max_length=30)
    display_name: str = Field(min_length=1, max_length=120)
    city: Optional[str] = Field(None, max_length=120)
    locale: str = "en"


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    handle: str
    display_name: str
    city: Optional[str]
    locale: str
    vendor_id: Optional[uuid.UUID]
    created_at: datetime


class AccountRegistered(BaseModel):
    account: AccountOut
    access_token: str
    token_type: str = "bearer"


class SocialSession(BaseModel):
    account: AccountOut
    # True when the caller authenticated as a Brief vendor and the identity was
    # provisioned just now — the client shows "your shop name is on your posts".
    linked_to_vendor: bool


def _social_token(account: SocialAccount) -> str:
    """A token that names a social account and nothing else.

    The ``scope`` claim keeps the two token kinds apart in both directions: a
    social token cannot open a vendor route (``vendor_id_from_token`` reads
    ``sub`` as a vendor UUID and finds no such vendor), and a vendor token is
    never mistaken for a social one.
    """
    return create_access_token({"sub": str(account.id), "scope": "social"})


async def _account_from_token(db: AsyncSession, token: str) -> SocialAccount | None:
    from jose import JWTError, jwt

    from app.config import settings

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
    if payload.get("type", "access") != "access":
        return None
    try:
        subject = uuid.UUID(payload.get("sub") or "")
    except ValueError:
        return None

    if payload.get("scope") == "social":
        account = (await db.execute(select(SocialAccount).where(SocialAccount.id == subject))).scalar_one_or_none()
    else:
        # A vendor token: the social identity behind it, provisioned on first use.
        account = (
            await db.execute(select(SocialAccount).where(SocialAccount.vendor_id == subject))
        ).scalar_one_or_none()
        if account is None:
            vendor = (await db.execute(select(Vendor).where(Vendor.id == subject))).scalar_one_or_none()
            if vendor is not None:
                account = await social_service.ensure_social_account(db, vendor)
                # Provisioning has to outlive this request, or the vendor gets a
                # new identity (and a new handle) on every page load.
                await db.commit()

    if account is None or account.status != "active":
        return None
    return account


async def get_current_social_account(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> SocialAccount:
    """Either kind of caller: a reader with a social account, or a vendor.

    This is the whole of "participation does not require a business". A vendor
    arrives through their existing login; a reader arrives through a social
    token; both get the same ``SocialAccount`` interface from here on.
    """
    account = await _account_from_token(db, token)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to take part.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return account


@router.post("/accounts", response_model=AccountRegistered, status_code=status.HTTP_201_CREATED)
async def register_account(payload: AccountRegister, db: AsyncSession = Depends(get_db)):
    """Join the conversation without joining the network.

    No vendor row, no business name, no trade standing. The token returned is
    the account's only credential in this build — a production version would add
    an SMS one-time code, which is also how most people here would expect to
    sign in.
    """
    account = await social_service.create_standalone_account(
        db,
        handle=payload.handle,
        display_name=payload.display_name,
        city=payload.city,
        locale=payload.locale,
    )
    await db.commit()
    await db.refresh(account)
    return {"account": account, "access_token": _social_token(account)}


@router.get("/me", response_model=SocialSession)
async def whoami(
    account: SocialAccount = Depends(get_current_social_account),
):
    return {
        "account": account,
        "linked_to_vendor": account.vendor_id is not None,
    }


# ── circles ───────────────────────────────────────────────────────────────────


class CircleOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: Optional[str]
    region: Optional[str]
    is_public: bool
    requires_approval: bool
    rules: list[str] = []
    following: bool = False
    post_count: int = 0


@router.get("/circles", response_model=list[CircleOut])
async def list_circles(
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """Discoverable circles. Public ones are open to anyone; private ones are
    listed only for people already following them."""
    follows = set(
        (await db.execute(select(SocialCircleFollow.circle_id).where(SocialCircleFollow.account_id == account.id)))
        .scalars()
        .all()
    )
    circles = (
        await db.execute(select(VendorGroup).order_by(VendorGroup.created_at.desc()))
    ).scalars()

    from sqlalchemy import func

    counts = dict(
        (
            await db.execute(
                select(SocialPost.circle_id, func.count())
                .where(SocialPost.status == "published")
                .group_by(SocialPost.circle_id)
            )
        ).all()
    )

    out = []
    for circle in circles:
        following = circle.id in follows
        if not circle.is_public and not following:
            continue
        out.append(
            {
                "id": circle.id,
                "name": circle.name,
                "slug": circle.slug,
                "description": circle.description,
                "region": circle.region,
                "is_public": circle.is_public,
                "requires_approval": circle.requires_approval,
                "rules": circle.rules or [],
                "following": following,
                "post_count": counts.get(circle.id, 0),
            }
        )
    return out


@router.post("/circles/{circle_id}/follow", status_code=status.HTTP_201_CREATED)
async def follow_circle(
    circle_id: uuid.UUID,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    circle = (
        await db.execute(select(VendorGroup).where(VendorGroup.id == circle_id))
    ).scalar_one_or_none()
    if circle is None:
        raise HTTPException(status_code=404, detail="That circle does not exist.")
    if not circle.is_public:
        # Joining a private circle is an approval flow, not a button. Saying so
        # is better than silently succeeding and lying about membership.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This circle needs a moderator's approval. Ask a moderator to add you.",
        )

    existing = (
        await db.execute(
            select(SocialCircleFollow).where(
                and_(SocialCircleFollow.account_id == account.id, SocialCircleFollow.circle_id == circle_id)
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(SocialCircleFollow(account_id=account.id, circle_id=circle_id))
        await db.commit()
    return {"circle_id": circle_id, "following": True}


@router.delete("/circles/{circle_id}/follow", status_code=status.HTTP_200_OK)
async def unfollow_circle(
    circle_id: uuid.UUID,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        await db.execute(
            select(SocialCircleFollow).where(
                and_(SocialCircleFollow.account_id == account.id, SocialCircleFollow.circle_id == circle_id)
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()
    return {"circle_id": circle_id, "following": False}


# ── posts ─────────────────────────────────────────────────────────────────────


class PostCreate(BaseModel):
    body: str = Field(min_length=8, max_length=4000)
    circle_id: Optional[uuid.UUID] = None
    lang: str = Field("en", max_length=8)
    image_url: Optional[str] = Field(None, max_length=600)
    data_kb: int = Field(1, ge=1, le=2048)


class AuthorOut(BaseModel):
    id: uuid.UUID
    handle: Optional[str]
    display_name: Optional[str]
    city: Optional[str]


class PostOut(BaseModel):
    id: uuid.UUID
    circle_id: Optional[uuid.UUID]
    body: str
    lang: str
    image_url: Optional[str]
    data_kb: int
    status: str
    created_at: datetime
    author: AuthorOut


class VerdictOut(BaseModel):
    up: int
    down: int
    participation: int
    confidence: float
    dissent_share: float
    contested: bool
    needs_more_voices: bool
    coordination: dict


class RankedPostOut(BaseModel):
    post: PostOut
    score: float
    raised_by_floor: bool
    parts: dict
    verdict: VerdictOut


@router.post("/posts", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    payload: PostCreate,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    if payload.circle_id is not None:
        await social_service.require_postable_circle(db, account.id, payload.circle_id)

    post = SocialPost(
        author_id=account.id,
        circle_id=payload.circle_id,
        body=payload.body.strip(),
        lang=(payload.lang or "en")[:8],
        image_url=payload.image_url,
        data_kb=max(1, payload.data_kb),
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    return {
        "id": post.id,
        "circle_id": post.circle_id,
        "body": post.body,
        "lang": post.lang,
        "image_url": post.image_url,
        "data_kb": post.data_kb,
        "status": post.status,
        "created_at": post.created_at,
        "author": {
            "id": account.id,
            "handle": account.handle,
            "display_name": account.display_name,
            "city": account.city,
        },
    }


@router.get("/feed", response_model=list[RankedPostOut])
async def feed(
    circle_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(30, ge=1, le=200),
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """The ranked feed, straight from the database.

    Every entry carries the score *and* its four parts, so the verdict panel and
    the measurement screen can explain an order they did not compute.
    """
    return await social_service.ranked_feed(db, account, circle_id=circle_id, limit=limit)


@router.delete("/posts/{post_id}", status_code=status.HTTP_200_OK)
async def remove_own_post(
    post_id: uuid.UUID,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """An author may withdraw their own words. Nothing else may remove them."""
    post = await social_service.require_post(db, post_id, allow_removed=True)
    if post.author_id != account.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author can remove this post.")
    post.status = "removed"
    await db.commit()
    return {"id": post_id, "status": "removed"}


# ── reactions ─────────────────────────────────────────────────────────────────


class ReactionIn(BaseModel):
    value: str = Field(pattern="^(up|down)$")


class ReactionState(BaseModel):
    post_id: uuid.UUID
    my_reaction: Optional[str]
    up: int
    down: int
    participation: int
    contested: bool
    post_status: str


@router.post("/posts/{post_id}/reactions", response_model=ReactionState)
async def react(
    post_id: uuid.UUID,
    payload: ReactionIn,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """Support or dissent. One per account, changeable, and it moves nothing else.

    Note what this route does not do: it does not call ``post.status``. A
    reaction changes *order*; only moderation changes *existence*.
    """
    post = await social_service.require_post(db, post_id)
    if post.author_id == account.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot react to your own post. Ask someone else.",
        )

    existing = (
        await db.execute(
            select(SocialReaction).where(
                and_(SocialReaction.post_id == post_id, SocialReaction.account_id == account.id)
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        db.add(SocialReaction(post_id=post_id, account_id=account.id, value=payload.value))
    else:
        existing.value = payload.value
    await db.commit()

    reactions = list(
        (await db.execute(select(SocialReaction).where(SocialReaction.post_id == post_id))).scalars()
    )
    up = sum(1 for r in reactions if r.value == "up")
    down = len(reactions) - up
    total = len(reactions)
    contested = total >= 8 and (down / total) >= 0.34 if total else False

    return {
        "post_id": post_id,
        "my_reaction": payload.value,
        "up": up,
        "down": down,
        "participation": total,
        "contested": bool(contested),
        "post_status": post.status,
    }


@router.delete("/posts/{post_id}/reactions", response_model=ReactionState)
async def withdraw_reaction(
    post_id: uuid.UUID,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    post = await social_service.require_post(db, post_id, allow_removed=True)
    existing = (
        await db.execute(
            select(SocialReaction).where(
                and_(SocialReaction.post_id == post_id, SocialReaction.account_id == account.id)
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()

    reactions = list(
        (await db.execute(select(SocialReaction).where(SocialReaction.post_id == post_id))).scalars()
    )
    up = sum(1 for r in reactions if r.value == "up")
    down = len(reactions) - up
    total = len(reactions)
    contested = total >= 8 and (down / total) >= 0.34 if total else False

    return {
        "post_id": post_id,
        "my_reaction": None,
        "up": up,
        "down": down,
        "participation": total,
        "contested": bool(contested),
        "post_status": post.status,
    }


# ── reports ───────────────────────────────────────────────────────────────────


class ReportIn(BaseModel):
    reason: str = Field(pattern="^(" + "|".join(REPORT_REASONS) + ")$")
    detail: Optional[str] = Field(None, max_length=2000)


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    post_id: uuid.UUID
    reason: str
    status: str
    case_number: str
    created_at: datetime


@router.post("/posts/{post_id}/reports", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def report_post(
    post_id: uuid.UUID,
    payload: ReportIn,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """File a case. The post stays exactly where it was until a moderator acts."""
    post = await social_service.require_post(db, post_id)
    if post.author_id == account.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot report your own post.")

    report = await social_service.open_report(
        db, post=post, reporter=account, reason=payload.reason, detail=payload.detail
    )
    await db.commit()
    await db.refresh(report)
    return report


@router.get("/reports", response_model=list[ReportOut])
async def my_reports(
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(SocialReport)
            .where(SocialReport.reporter_id == account.id)
            .order_by(SocialReport.created_at.desc())
        )
    ).scalars()
    return list(rows)


# ── blocks and mutes ──────────────────────────────────────────────────────────


class BlockIn(BaseModel):
    target_id: uuid.UUID
    kind: str = Field("block", pattern="^(block|mute)$")


class BlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    target_id: uuid.UUID
    kind: str
    created_at: datetime


@router.post("/blocks", response_model=BlockOut, status_code=status.HTTP_201_CREATED)
async def block_account(
    payload: BlockIn,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    if payload.target_id == account.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot block yourself.")
    target = (
        await db.execute(select(SocialAccount).where(SocialAccount.id == payload.target_id))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such account.")

    existing = (
        await db.execute(
            select(SocialBlock).where(
                and_(
                    SocialBlock.account_id == account.id,
                    SocialBlock.target_id == payload.target_id,
                    SocialBlock.kind == payload.kind,
                )
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    row = SocialBlock(account_id=account.id, target_id=payload.target_id, kind=payload.kind)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/blocks/{target_id}", status_code=status.HTTP_200_OK)
async def unblock_account(
    target_id: uuid.UUID,
    kind: str = Query("block", pattern="^(block|mute)$"),
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    if kind not in BLOCK_KINDS:
        raise HTTPException(status_code=422, detail="Unknown kind.")
    existing = (
        await db.execute(
            select(SocialBlock).where(
                and_(
                    SocialBlock.account_id == account.id,
                    SocialBlock.target_id == target_id,
                    SocialBlock.kind == kind,
                )
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()
    return {"target_id": target_id, "kind": kind, "active": False}


@router.get("/blocks", response_model=list[BlockOut])
async def my_blocks(
    kind: Optional[str] = Query(None, pattern="^(block|mute)$"),
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    query = select(SocialBlock).where(SocialBlock.account_id == account.id)
    if kind:
        query = query.where(SocialBlock.kind == kind)
    return list((await db.execute(query.order_by(SocialBlock.created_at.desc()))).scalars())

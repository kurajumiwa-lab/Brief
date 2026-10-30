"""Caesar Park: bounded places to be casual, with a gate you can see.

The rules this file enforces, in the order they matter:

1. **A park is bounded, and the boundary is visible before you knock.** Every
   park advertises ``kind``, ``bounded_by``, ``entry_rule`` and its ``rules``
   on the listing route — not only after joining.
2. **No coordinates.** ``area`` and ``radius_km`` only. There is no column to
   put a pin in, so no future version can quietly start using one.
3. **The leash belongs to the membership.** You can be a shopkeeper in your
   market park and only a neighbour in your estate park. Off-leash means the
   feed returns no business link for you there.
4. **The author's leash is frozen at publish time** (``leash_at_post``). Taking
   the leash off tomorrow does not reveal yesterday's post, and putting it on
   does not rewrite what people already read.
5. **A warden owns the gate, not the floor.** ``created_by`` may link circles
   and set the rules; nobody here can hide or delete somebody's words. Removal
   goes through the existing report/appeal path.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.groups import VendorGroup
from app.models.park import (
    ENTRY_RULES,
    LEASH_STATES,
    PARK_KINDS,
    CaesarPark,
    CaesarParkCircle,
    CaesarParkMembership,
    CaesarParkPost,
)
from app.models.social import SocialAccount, SocialBlock
from app.models.vendor import Vendor
from app.platform.security import oauth2_scheme_optional
from app.routes.social import _account_from_token, get_current_social_account

router = APIRouter()


# ── shapes ───────────────────────────────────────────────────────────────────


class ParkIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    kind: str = Field("place", pattern="^(place|niche)$")
    city: Optional[str] = Field(None, max_length=120)
    area: Optional[str] = Field(None, max_length=120)
    radius_km: Optional[float] = Field(None, ge=0.1, le=50)
    niche: Optional[str] = Field(None, max_length=80)
    description: Optional[str] = Field(None, max_length=600)
    rules: list[str] = Field(default_factory=list, max_length=12)
    entry_rule: str = Field("open", pattern="^(open|ask)$")


class ParkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    kind: str
    city: Optional[str]
    area: Optional[str]
    radius_km: Optional[float]
    niche: Optional[str]
    description: Optional[str]
    rules: list[str]
    entry_rule: str
    is_active: bool
    created_at: datetime


def _slug(name: str, city: Optional[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", f"{name} {city or ''}".lower()).strip("-")
    return (base or "park")[:70]


async def _unique_slug(db: AsyncSession, name: str, city: Optional[str]) -> str:
    base = _slug(name, city)
    slug, n = base, 1
    while (await db.execute(select(CaesarPark.id).where(CaesarPark.slug == slug))).scalar_one_or_none():
        n += 1
        slug = f"{base}-{n}"
    return slug


def _park_dict(park: CaesarPark, *, members: int, mine: Optional[CaesarParkMembership]) -> dict:
    return {
        "id": str(park.id),
        "slug": park.slug,
        "name": park.name,
        "kind": park.kind,
        # What the boundary is, in words, before anyone joins.
        "bounded_by": park.bounded_by,
        "city": park.city,
        "area": park.area,
        "radius_km": park.radius_km,
        "niche": park.niche,
        "description": park.description,
        "rules": park.rules or [],
        "entry_rule": park.entry_rule,
        "members": members,
        "my_membership": None
        if mine is None
        else {"status": mine.status, "leash": mine.leash, "joined_at": mine.joined_at.isoformat()},
    }


async def _members(db: AsyncSession, park_id: uuid.UUID) -> int:
    return int(
        (
            await db.execute(
                select(func.count())
                .select_from(CaesarParkMembership)
                .where(
                    and_(
                        CaesarParkMembership.park_id == park_id,
                        CaesarParkMembership.status == "member",
                    )
                )
            )
        ).scalar_one()
    )


async def _park_by_slug(db: AsyncSession, slug_or_id: str) -> CaesarPark:
    park = None
    try:
        park = (
            await db.execute(select(CaesarPark).where(CaesarPark.id == uuid.UUID(slug_or_id)))
        ).scalar_one_or_none()
    except (ValueError, AttributeError):
        park = None
    if park is None:
        park = (await db.execute(select(CaesarPark).where(CaesarPark.slug == slug_or_id))).scalar_one_or_none()
    if park is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such park.")
    return park


async def _optional_account(token: Optional[str] = Depends(oauth2_scheme_optional), db: AsyncSession = Depends(get_db)):
    if not token:
        return None
    return await _account_from_token(db, token)


async def _mine(db: AsyncSession, park_id: uuid.UUID, account: Optional[SocialAccount]):
    if account is None:
        return None
    return (
        await db.execute(
            select(CaesarParkMembership).where(
                and_(
                    CaesarParkMembership.park_id == park_id,
                    CaesarParkMembership.account_id == account.id,
                )
            )
        )
    ).scalar_one_or_none()


async def _require_member(db: AsyncSession, park: CaesarPark, account: SocialAccount) -> CaesarParkMembership:
    park_id = park.id if hasattr(park, "id") else park
    membership = await _mine(db, park_id, account)
    if membership is None or membership.status != "member":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Join this park to take part in it.",
        )
    return membership


# ── discovery ────────────────────────────────────────────────────────────────


@router.get("")
async def list_parks(
    city: Optional[str] = Query(None, max_length=120),
    kind: Optional[str] = Query(None, pattern="^(place|niche)$"),
    q: Optional[str] = Query(None, max_length=80),
    limit: int = Query(30, ge=1, le=100),
    account: Optional[SocialAccount] = Depends(_optional_account),
    db: AsyncSession = Depends(get_db),
):
    """Every park you could walk into, with the boundary and the gate on show."""
    stmt = select(CaesarPark).where(CaesarPark.is_active.is_(True))
    if city:
        stmt = stmt.where(func.lower(CaesarPark.city) == city.lower())
    if kind:
        stmt = stmt.where(CaesarPark.kind == kind)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            func.lower(CaesarPark.name).like(like)
            | func.lower(func.coalesce(CaesarPark.niche, "")).like(like)
            | func.lower(func.coalesce(CaesarPark.area, "")).like(like)
        )
    parks = (await db.execute(stmt.order_by(CaesarPark.created_at.desc()).limit(limit))).scalars().all()

    counts = dict(
        (
            await db.execute(
                select(CaesarParkMembership.park_id, func.count())
                .where(
                    and_(
                        CaesarParkMembership.status == "member",
                        CaesarParkMembership.park_id.in_([p.id for p in parks] or [uuid.uuid4()]),
                    )
                )
                .group_by(CaesarParkMembership.park_id)
            )
        ).all()
    )
    mine = {}
    if account is not None and parks:
        mine = {
            m.park_id: m
            for m in (
                await db.execute(
                    select(CaesarParkMembership).where(
                        and_(
                            CaesarParkMembership.account_id == account.id,
                            CaesarParkMembership.park_id.in_([p.id for p in parks]),
                        )
                    )
                )
            )
            .scalars()
            .all()
        }

    out = [_park_dict(p, members=int(counts.get(p.id, 0)), mine=mine.get(p.id)) for p in parks]
    return {"parks": out, "count": len(out)}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_park(
    payload: ParkIn,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """Open a park. The creator becomes its warden and its first member.

    A ``place`` park must say where it is and a ``niche`` park must say what it
    is — a park with no boundary is not a park, it is a lobby.
    """
    if payload.kind == "place" and not (payload.area or payload.city):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A place park needs a city or an area — that is what bounds it.",
        )
    if payload.kind == "niche" and not payload.niche:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A niche park needs the niche it is for.",
        )
    if payload.kind not in PARK_KINDS or payload.entry_rule not in ENTRY_RULES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown park kind or gate.")

    rules = [r.strip()[:140] for r in payload.rules if r.strip()][:12]
    if not rules:
        rules = ["Disagreement is not misconduct. Report what is harmful, not what you dislike."]

    park = CaesarPark(
        slug=await _unique_slug(db, payload.name, payload.city),
        name=payload.name.strip(),
        kind=payload.kind,
        city=payload.city,
        area=payload.area,
        radius_km=payload.radius_km,
        niche=payload.niche,
        description=payload.description,
        rules=rules,
        entry_rule=payload.entry_rule,
        created_by=account.id,
    )
    db.add(park)
    await db.flush()
    db.add(
        CaesarParkMembership(
            park_id=park.id, account_id=account.id, status="member", leash="off"
        )
    )
    await db.commit()
    await db.refresh(park)
    return _park_dict(
        park, members=1, mine=await _mine(db, park.id, account)
    )


@router.get("/{slug}")
async def get_park(
    slug: str,
    account: Optional[SocialAccount] = Depends(_optional_account),
    db: AsyncSession = Depends(get_db),
):
    park = await _park_by_slug(db, slug)
    circles = (
        await db.execute(
            select(CaesarParkCircle, VendorGroup)
            .join(VendorGroup, VendorGroup.id == CaesarParkCircle.circle_id)
            .where(CaesarParkCircle.park_id == park.id)
        )
    ).all()
    body = _park_dict(park, members=await _members(db, park.id), mine=await _mine(db, park.id, account))
    body["circles"] = [
        {
            "id": str(link.id),
            "circle_id": str(group.id),
            "name": group.name,
            "off_leash": link.off_leash,
        }
        for link, group in circles
    ]
    return body


# ── the gate ─────────────────────────────────────────────────────────────────


@router.post("/{slug}/join", status_code=status.HTTP_201_CREATED)
async def join_park(
    slug: str,
    leash: str = Query("off", pattern="^(on|off)$"),
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """Walk in (``open``) or knock (``ask``).

    The leash is chosen at the gate rather than buried in settings, because it
    is the single most consequential thing about joining: it decides what name
    your neighbours see.
    """
    park = await _park_by_slug(db, slug)
    if not park.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This park is closed.")
    if leash not in LEASH_STATES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown leash state.")

    existing = await _mine(db, park.id, account)
    if existing and existing.status in ("member", "requested"):
        # Knocking again is how you change the name you wear. It is the only
        # thing about joining that people reasonably want to revise.
        changed = existing.leash != leash
        existing.leash = leash
        if changed:
            await db.commit()
        return {"status": existing.status, "leash": leash, "already": True, "leash_changed": changed}

    state = "member" if park.entry_rule == "open" else "requested"
    if existing:
        existing.status = state
        existing.leash = leash
        existing.joined_at = datetime.utcnow()
    else:
        db.add(CaesarParkMembership(park_id=park.id, account_id=account.id, status=state, leash=leash))
    await db.commit()
    return {
        "status": state,
        "leash": leash,
        "already": False,
        "detail": "You are in." if state == "member" else "The warden has to let you in.",
    }


@router.post("/{slug}/leave", status_code=status.HTTP_200_OK)
async def leave_park(
    slug: str,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """Leaving keeps your posts standing. Walking out of a park does not
    unsay what you said in it."""
    park = await _park_by_slug(db, slug)
    membership = await _mine(db, park.id, account)
    if membership is None or membership.status in ("left", "removed"):
        return {"status": "not_member"}
    membership.status = "left"
    await db.commit()
    return {"status": "left", "posts_kept": True}


class LeashIn(BaseModel):
    leash: str = Field(pattern="^(on|off)$")


@router.patch("/{slug}/leash")
async def set_leash(
    slug: str,
    payload: LeashIn,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """Put your shop name on, or take it off. Applies from now on, not backwards."""
    park = await _park_by_slug(db, slug)
    membership = await _require_member(db, park, account)
    membership.leash = payload.leash
    await db.commit()
    return {
        "leash": membership.leash,
        "applies_to": "posts published from now on",
        "note": "Earlier posts keep the name they were published under.",
    }


@router.post("/{slug}/circles", status_code=status.HTTP_201_CREATED)
async def link_circle(
    slug: str,
    circle_id: uuid.UUID,
    off_leash: bool = Query(False),
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """Link an existing circle as a lawn of this park.

    Only the warden may do this, and only with circles that already exist — the
    park is a view over the network's circles, not a second place to keep them.
    """
    park = await _park_by_slug(db, slug)
    if park.created_by != account.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the warden of this park can add a circle to it.",
        )
    group = (await db.execute(select(VendorGroup).where(VendorGroup.id == circle_id))).scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such circle.")
    existing = (
        await db.execute(
            select(CaesarParkCircle).where(
                and_(CaesarParkCircle.park_id == park.id, CaesarParkCircle.circle_id == circle_id)
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.off_leash = off_leash
        await db.commit()
        return {"linked": True, "off_leash": existing.off_leash, "already": True}
    db.add(CaesarParkCircle(park_id=park.id, circle_id=circle_id, off_leash=off_leash))
    await db.commit()
    return {"linked": True, "off_leash": off_leash, "already": False}


# ── the floor ────────────────────────────────────────────────────────────────


class PostIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    lang: str = Field("en", max_length=8)


@router.post("/{slug}/posts", status_code=status.HTTP_201_CREATED)
async def post_to_park(
    slug: str,
    payload: PostIn,
    account: SocialAccount = Depends(get_current_social_account),
    db: AsyncSession = Depends(get_db),
):
    """Say something on the lawn.

    The leash is stamped onto the post and never recomputed, so the name people
    read today is the name it will carry tomorrow.
    """
    park = await _park_by_slug(db, slug)
    membership = await _require_member(db, park, account)
    post = CaesarParkPost(
        park_id=park.id,
        author_id=account.id,
        body=payload.body.strip(),
        lang=payload.lang,
        leash_at_post=membership.leash,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return {
        "id": str(post.id),
        "park": park.slug,
        "status": post.status,
        "leash": post.leash_at_post,
        "created_at": post.created_at.isoformat(),
    }


@router.get("/{slug}/feed")
async def park_feed(
    slug: str,
    limit: int = Query(30, ge=1, le=100),
    account: Optional[SocialAccount] = Depends(_optional_account),
    db: AsyncSession = Depends(get_db),
):
    """The park's conversation, newest first.

    Authors carry a name according to the leash **they published under**, and
    only if their membership still exists and has not been removed. Readers who
    blocked somebody do not see them here either — the block carries across
    every room, or it is not a block.
    """
    park = await _park_by_slug(db, slug)

    hidden: set[uuid.UUID] = set()
    if account is not None:
        hidden = {
            row[0]
            for row in (
                await db.execute(
                    select(SocialBlock.target_id).where(
                        and_(SocialBlock.account_id == account.id, SocialBlock.kind == "block")
                    )
                )
            ).all()
        }

    rows = (
        await db.execute(
            select(CaesarParkPost, SocialAccount, Vendor)
            .join(SocialAccount, SocialAccount.id == CaesarParkPost.author_id)
            .outerjoin(Vendor, Vendor.id == SocialAccount.vendor_id)
            .where(and_(CaesarParkPost.park_id == park.id, CaesarParkPost.status == "published"))
            .order_by(CaesarParkPost.created_at.desc())
            .limit(limit)
        )
    ).all()

    posts = []
    for post, author, vendor in rows:
        if author.id in hidden:
            continue
        wearing_shop_name = post.leash_at_post == "on" and vendor is not None
        posts.append(
            {
                "id": str(post.id),
                "body": post.body,
                "lang": post.lang,
                "created_at": post.created_at.isoformat(),
                "author": {
                    "handle": author.handle,
                    "display_name": author.display_name,
                    # Off-leash means the business link is not in the payload at
                    # all — not hidden in the UI, absent from the response.
                    "business": (vendor.business_name if wearing_shop_name else None),
                    "vendor_handle": (vendor.vendor_handle if wearing_shop_name else None),
                },
                "leash": post.leash_at_post,
            }
        )

    return {
        "park": {"slug": park.slug, "name": park.name, "bounded_by": park.bounded_by},
        "posts": posts,
        "count": len(posts),
    }

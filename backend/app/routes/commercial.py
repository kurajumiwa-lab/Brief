"""
Commercial Shelf — social commerce layer.

Harnesses existing services without replacing them:
- Posts can link to StockItem, CollectiveSourcing, VendorGroups
- Group-buying aggregates demand
- Salesperson distribution via shares/referrals

Endpoints:
- POST /posts — create commercial or regular post
- GET /feed — social feed with commercial shelf
- GET /shelf — curated commercial offers (for home)
- GET /posts/{id} — detail
- PUT /posts/{id} — update (owner)
- DELETE /posts/{id}
- POST /posts/{id}/save, /unsave
- POST /posts/{id}/share
- POST /posts/{id}/interest, DELETE, GET /interests
- GET /my-posts, /my-saves, /my-interests, /my-shares
- GET /stats — salesperson analytics
"""
from datetime import datetime, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.commercial import (
    CommercialInterest,
    CommercialPost,
    CommercialPostStatus,
    CommercialPostType,
    CommercialSave,
    CommercialShare,
    InterestStatus,
)
from app.models.vendor import Vendor
from app.models.stock import StockItem
from app.models.groups import VendorGroup
from app.routes.auth import get_current_vendor
from app.services import notification_service
from app.models.notification import NotificationType

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────

class CommercialPostCreate(BaseModel):
    title: Optional[str] = Field(None, max_length=300)
    content: str = Field(..., min_length=1, max_length=5000)
    post_type: CommercialPostType = CommercialPostType.REGULAR
    is_commercial: bool = False
    individual_price: Optional[float] = Field(None, ge=0)
    group_price: Optional[float] = Field(None, ge=0)
    currency: str = Field("KES", max_length=10)
    target_quantity: Optional[int] = Field(None, ge=1)
    min_group_size: Optional[int] = Field(None, ge=1)
    stock_item_id: Optional[UUID] = None
    group_id: Optional[UUID] = None
    images: List[str] = []
    tags: List[str] = []
    category: Optional[str] = Field(None, max_length=100)
    location: Optional[str] = Field(None, max_length=300)
    commission_rate: Optional[float] = Field(None, ge=0, le=100)
    commission_fixed: Optional[float] = Field(None, ge=0)
    allow_resale: bool = True
    is_public: bool = True
    visible_to_groups: List[str] = []
    expires_at: Optional[datetime] = None


class CommercialPostUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=300)
    content: Optional[str] = Field(None, min_length=1, max_length=5000)
    post_type: Optional[CommercialPostType] = None
    is_commercial: Optional[bool] = None
    individual_price: Optional[float] = Field(None, ge=0)
    group_price: Optional[float] = Field(None, ge=0)
    target_quantity: Optional[int] = Field(None, ge=1)
    min_group_size: Optional[int] = Field(None, ge=1)
    images: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    category: Optional[str] = Field(None, max_length=100)
    location: Optional[str] = Field(None, max_length=300)
    commission_rate: Optional[float] = Field(None, ge=0, le=100)
    status: Optional[CommercialPostStatus] = None
    expires_at: Optional[datetime] = None


class InterestCreate(BaseModel):
    quantity: int = Field(1, ge=1)
    notes: Optional[str] = Field(None, max_length=500)
    referred_by: Optional[str] = None  # vendor handle who referred


class ShareCreate(BaseModel):
    share_channel: str = Field("copy_link", max_length=50)
    share_target: Optional[str] = Field(None, max_length=300)


class CommercialPostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    vendor_id: str
    vendor_handle: Optional[str] = None
    vendor_business: Optional[str] = None
    vendor_avatar: Optional[str] = None
    title: Optional[str]
    content: str
    post_type: str
    is_commercial: bool
    status: str
    individual_price: Optional[float]
    group_price: Optional[float]
    savings_amount: Optional[float]
    savings_percentage: Optional[float]
    currency: str
    target_quantity: Optional[int]
    min_group_size: Optional[int]
    current_interested: int
    current_quantity_pledged: int
    stock_item_id: Optional[str]
    group_id: Optional[str]
    images: List[str]
    tags: List[str]
    category: Optional[str]
    location: Optional[str]
    commission_rate: Optional[float]
    commission_fixed: Optional[float]
    allow_resale: bool
    view_count: int
    save_count: int
    share_count: int
    interest_count: int
    is_public: bool
    is_saved: bool = False
    is_interested: bool = False
    my_interest_status: Optional[str] = None
    expires_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


def _calc_savings(individual, group):
    if individual is None or group is None:
        return None, None
    if individual <= 0:
        return None, None
    amount = individual - group
    if amount <= 0:
        return 0, 0
    pct = (amount / individual) * 100
    return round(amount, 2), round(pct, 1)


def _post_to_out(post: CommercialPost, vendor_map: dict, current_vendor_id=None, saved_ids=set(), interested_map=dict()) -> CommercialPostOut:
    v = vendor_map.get(post.vendor_id)
    savings_amount, savings_pct = _calc_savings(post.individual_price, post.group_price)
    # Use stored if available, else calc
    sa = post.savings_amount if post.savings_amount is not None else savings_amount
    sp = post.savings_percentage if post.savings_percentage is not None else savings_pct

    is_saved = str(post.id) in saved_ids
    interest = interested_map.get(str(post.id))
    
    return CommercialPostOut(
        id=str(post.id),
        vendor_id=str(post.vendor_id),
        vendor_handle=v.vendor_handle if v else None,
        vendor_business=v.business_name if v else "A vendor",
        vendor_avatar=None,
        title=post.title,
        content=post.content,
        post_type=post.post_type.value if hasattr(post.post_type, 'value') else str(post.post_type),
        is_commercial=post.is_commercial,
        status=post.status.value if hasattr(post.status, 'value') else str(post.status),
        individual_price=post.individual_price,
        group_price=post.group_price,
        savings_amount=sa,
        savings_percentage=sp,
        currency=post.currency or "KES",
        target_quantity=post.target_quantity,
        min_group_size=post.min_group_size,
        current_interested=post.current_interested or 0,
        current_quantity_pledged=post.current_quantity_pledged or 0,
        stock_item_id=str(post.stock_item_id) if post.stock_item_id else None,
        group_id=str(post.group_id) if post.group_id else None,
        images=list(post.images or []),
        tags=list(post.tags or []),
        category=post.category,
        location=post.location,
        commission_rate=post.commission_rate,
        commission_fixed=post.commission_fixed,
        allow_resale=post.allow_resale,
        view_count=post.view_count or 0,
        save_count=post.save_count or 0,
        share_count=post.share_count or 0,
        interest_count=post.interest_count or 0,
        is_public=post.is_public,
        is_saved=is_saved,
        is_interested=interest is not None,
        my_interest_status=interest.status.value if interest and hasattr(interest.status, 'value') else (str(interest.status) if interest else None),
        expires_at=post.expires_at,
        created_at=post.created_at,
        updated_at=post.updated_at,
    )


async def _vendor_map(db, vendor_ids):
    if not vendor_ids:
        return {}
    res = await db.execute(select(Vendor).where(Vendor.id.in_(vendor_ids)))
    return {v.id: v for v in res.scalars().all()}


# ── Create ───────────────────────────────────────────────────────────────

@router.post("/posts", response_model=CommercialPostOut)
async def create_post(
    data: CommercialPostCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    # Validate linked stock item belongs to vendor or is network-visible
    if data.stock_item_id:
        res = await db.execute(select(StockItem).where(StockItem.id == data.stock_item_id))
        item = res.scalar_one_or_none()
        if not item:
            raise HTTPException(404, "Stock item not found")
        # Allow linking to own or network-visible
        if str(item.vendor_id) != str(vendor.id) and not item.visible_to_network:
            raise HTTPException(403, "Cannot link to private stock")

    # Validate group
    if data.group_id:
        res = await db.execute(select(VendorGroup).where(VendorGroup.id == data.group_id))
        if not res.scalar_one_or_none():
            raise HTTPException(404, "Group not found")

    # Auto-calc savings
    savings_amount, savings_pct = _calc_savings(data.individual_price, data.group_price)

    # Determine if commercial
    is_commercial = data.is_commercial or (data.individual_price is not None) or (data.group_price is not None) or data.post_type in [
        CommercialPostType.COMMERCIAL, CommercialPostType.GROUP_BUY, CommercialPostType.DEAL, CommercialPostType.SAVINGS
    ]

    post = CommercialPost(
        vendor_id=vendor.id,
        title=data.title,
        content=data.content,
        post_type=data.post_type,
        is_commercial=is_commercial,
        individual_price=data.individual_price,
        group_price=data.group_price,
        savings_amount=savings_amount,
        savings_percentage=savings_pct,
        currency=data.currency,
        target_quantity=data.target_quantity,
        min_group_size=data.min_group_size,
        stock_item_id=data.stock_item_id,
        group_id=data.group_id,
        images=data.images,
        tags=data.tags,
        category=data.category,
        location=data.location or vendor.physical_location,
        commission_rate=data.commission_rate,
        commission_fixed=data.commission_fixed,
        allow_resale=data.allow_resale,
        is_public=data.is_public,
        visible_to_groups=data.visible_to_groups,
        expires_at=data.expires_at,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    vm = {vendor.id: vendor}
    return _post_to_out(post, vm)


# ── Feed — social + commercial shelf ─────────────────────────────────────

@router.get("/feed")
async def get_feed(
    commercial_only: bool = False,
    group_buy_only: bool = False,
    category: Optional[str] = None,
    location: Optional[str] = None,
    search: Optional[str] = None,
    vendor_handle: Optional[str] = None,
    saved_only: bool = False,
    following_only: bool = False,
    limit: int = Query(20, ge=1, le=50),
    skip: int = Query(0, ge=0),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    q = select(CommercialPost).where(CommercialPost.status == CommercialPostStatus.ACTIVE)

    # Expiry filter
    now = datetime.utcnow()
    q = q.where(or_(CommercialPost.expires_at.is_(None), CommercialPost.expires_at > now))

    if commercial_only:
        q = q.where(CommercialPost.is_commercial.is_(True))
    if group_buy_only:
        q = q.where(CommercialPost.post_type == CommercialPostType.GROUP_BUY)
    if category:
        q = q.where(CommercialPost.category == category)
    if location:
        q = q.where(CommercialPost.location.ilike(f"%{location}%"))
    if search:
        q = q.where(or_(
            CommercialPost.content.ilike(f"%{search}%"),
            CommercialPost.title.ilike(f"%{search}%"),
            CommercialPost.tags.astext.ilike(f"%{search}%"),
        ))
    if vendor_handle:
        res = await db.execute(select(Vendor).where(Vendor.vendor_handle == vendor_handle))
        v = res.scalar_one_or_none()
        if not v:
            raise HTTPException(404, "Vendor not found")
        q = q.where(CommercialPost.vendor_id == v.id)

    if saved_only:
        # Join with saves
        saved_subq = select(CommercialSave.post_id).where(CommercialSave.vendor_id == vendor.id)
        q = q.where(CommercialPost.id.in_(saved_subq))

    # Public or own or group-visible — for now public + own
    # In future, add group membership check
    q = q.where(or_(
        CommercialPost.is_public.is_(True),
        CommercialPost.vendor_id == vendor.id,
    ))

    q = q.order_by(desc(CommercialPost.created_at)).offset(skip).limit(limit)

    res = await db.execute(q)
    posts = res.scalars().all()

    if not posts:
        return {"posts": [], "total": 0, "has_more": False}

    # Vendor map
    vendor_ids = {p.vendor_id for p in posts}
    vmap = await _vendor_map(db, vendor_ids)

    # Saved ids for current vendor
    save_res = await db.execute(select(CommercialSave.post_id).where(CommercialSave.vendor_id == vendor.id))
    saved_ids = {str(row[0]) for row in save_res.all()}

    # Interested map
    interest_res = await db.execute(
        select(CommercialInterest).where(
            CommercialInterest.vendor_id == vendor.id,
            CommercialInterest.post_id.in_([p.id for p in posts])
        )
    )
    interested_map = {str(i.post_id): i for i in interest_res.scalars().all()}

    out = [_post_to_out(p, vmap, vendor.id, saved_ids, interested_map) for p in posts]

    # Total count for pagination (simplified)
    count_q = select(func.count()).select_from(CommercialPost).where(CommercialPost.status == CommercialPostStatus.ACTIVE)
    if commercial_only:
        count_q = count_q.where(CommercialPost.is_commercial.is_(True))
    total_res = await db.execute(count_q)
    total = total_res.scalar() or 0

    return {"posts": out, "total": total, "has_more": len(posts) == limit}


@router.get("/shelf")
async def get_commercial_shelf(
    limit: int = Query(12, ge=1, le=30),
    category: Optional[str] = None,
    location: Optional[str] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """
    Curated commercial shelf — actionable offers with savings.
    For home discovery feed. Only commercial posts with pricing.
    """
    now = datetime.utcnow()
    q = select(CommercialPost).where(
        CommercialPost.status == CommercialPostStatus.ACTIVE,
        CommercialPost.is_commercial.is_(True),
        CommercialPost.is_public.is_(True),
        or_(CommercialPost.expires_at.is_(None), CommercialPost.expires_at > now),
    )
    if category:
        q = q.where(CommercialPost.category == category)
    if location:
        q = q.where(CommercialPost.location.ilike(f"%{location}%"))

    # Prioritize group buys and deals with savings
    q = q.order_by(
        desc(CommercialPost.savings_percentage),
        desc(CommercialPost.interest_count),
        desc(CommercialPost.created_at),
    ).limit(limit)

    res = await db.execute(q)
    posts = res.scalars().all()

    if not posts:
        return {"shelf": [], "title": "Commercial offers", "subtitle": "Deals from vendors near you"}

    vendor_ids = {p.vendor_id for p in posts}
    vmap = await _vendor_map(db, vendor_ids)

    save_res = await db.execute(select(CommercialSave.post_id).where(CommercialSave.vendor_id == vendor.id))
    saved_ids = {str(row[0]) for row in save_res.all()}

    interest_res = await db.execute(
        select(CommercialInterest).where(
            CommercialInterest.vendor_id == vendor.id,
            CommercialInterest.post_id.in_([p.id for p in posts])
        )
    )
    interested_map = {str(i.post_id): i for i in interest_res.scalars().all()}

    out = [_post_to_out(p, vmap, vendor.id, saved_ids, interested_map) for p in posts]

    return {
        "shelf": out,
        "title": "Commercial shelf — save more together",
        "subtitle": f"{len(out)} active offers · group buys unlock better prices",
        "total_savings_potential": sum([p.savings_amount or 0 for p in out]),
    }


# ── My posts / saves / interests ─────────────────────────────────────────

@router.get("/my-posts")
async def my_posts(
    limit: int = Query(20, ge=1, le=50),
    skip: int = Query(0, ge=0),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    q = select(CommercialPost).where(CommercialPost.vendor_id == vendor.id).order_by(desc(CommercialPost.created_at)).offset(skip).limit(limit)
    res = await db.execute(q)
    posts = res.scalars().all()
    vmap = {vendor.id: vendor}
    save_res = await db.execute(select(CommercialSave.post_id).where(CommercialSave.vendor_id == vendor.id))
    saved_ids = {str(row[0]) for row in save_res.all()}
    return {"posts": [_post_to_out(p, vmap, vendor.id, saved_ids, {}) for p in posts]}


@router.get("/my-saves")
async def my_saves(
    limit: int = Query(20, ge=1, le=50),
    skip: int = Query(0, ge=0),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    q = select(CommercialPost).join(CommercialSave, CommercialSave.post_id == CommercialPost.id).where(
        CommercialSave.vendor_id == vendor.id
    ).order_by(desc(CommercialSave.created_at)).offset(skip).limit(limit)
    res = await db.execute(q)
    posts = res.scalars().all()
    vendor_ids = {p.vendor_id for p in posts}
    vmap = await _vendor_map(db, vendor_ids)
    saved_ids = {str(p.id) for p in posts}
    return {"posts": [_post_to_out(p, vmap, vendor.id, saved_ids, {}) for p in posts]}


@router.get("/my-interests")
async def my_interests(
    limit: int = Query(20, ge=1, le=50),
    skip: int = Query(0, ge=0),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    q = select(CommercialPost).join(CommercialInterest, CommercialInterest.post_id == CommercialPost.id).where(
        CommercialInterest.vendor_id == vendor.id
    ).order_by(desc(CommercialInterest.created_at)).offset(skip).limit(limit)
    res = await db.execute(q)
    posts = res.scalars().all()
    vendor_ids = {p.vendor_id for p in posts}
    vmap = await _vendor_map(db, vendor_ids)

    interest_res = await db.execute(
        select(CommercialInterest).where(CommercialInterest.vendor_id == vendor.id)
    )
    interested_map = {str(i.post_id): i for i in interest_res.scalars().all()}

    save_res = await db.execute(select(CommercialSave.post_id).where(CommercialSave.vendor_id == vendor.id))
    saved_ids = {str(row[0]) for row in save_res.all()}

    return {"posts": [_post_to_out(p, vmap, vendor.id, saved_ids, interested_map) for p in posts]}


# ── Detail, update, delete ───────────────────────────────────────────────

@router.get("/posts/{post_id}", response_model=CommercialPostOut)
async def get_post(
    post_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")

    # Increment view count (async, don't block)
    post.view_count = (post.view_count or 0) + 1
    await db.commit()

    vmap = await _vendor_map(db, {post.vendor_id})
    save_res = await db.execute(
        select(CommercialSave).where(CommercialSave.post_id == post.id, CommercialSave.vendor_id == vendor.id)
    )
    is_saved = save_res.scalar_one_or_none() is not None

    interest_res = await db.execute(
        select(CommercialInterest).where(CommercialInterest.post_id == post.id, CommercialInterest.vendor_id == vendor.id)
    )
    interest = interest_res.scalar_one_or_none()

    return _post_to_out(
        post, vmap, vendor.id,
        {str(post.id)} if is_saved else set(),
        {str(post.id): interest} if interest else {}
    )


@router.put("/posts/{post_id}", response_model=CommercialPostOut)
async def update_post(
    post_id: UUID,
    data: CommercialPostUpdate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")
    if str(post.vendor_id) != str(vendor.id):
        raise HTTPException(403, "Not your post")

    payload = data.model_dump(exclude_none=True)
    # Recalc savings if prices changed
    if "individual_price" in payload or "group_price" in payload:
        ind = payload.get("individual_price", post.individual_price)
        grp = payload.get("group_price", post.group_price)
        sa, sp = _calc_savings(ind, grp)
        post.savings_amount = sa
        post.savings_percentage = sp

    for k, v in payload.items():
        if k in ("individual_price", "group_price"):
            continue  # handled above via calc, but still set
        setattr(post, k, v)
    # Also set prices if present
    if "individual_price" in payload:
        post.individual_price = payload["individual_price"]
    if "group_price" in payload:
        post.group_price = payload["group_price"]

    post.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(post)

    vmap = {vendor.id: vendor}
    return _post_to_out(post, vmap)


@router.delete("/posts/{post_id}")
async def delete_post(
    post_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")
    if str(post.vendor_id) != str(vendor.id):
        raise HTTPException(403, "Not your post")

    post.status = CommercialPostStatus.CANCELLED
    await db.commit()
    return {"ok": True}


# ── Save / unsave ────────────────────────────────────────────────────────

@router.post("/posts/{post_id}/save")
async def save_post(
    post_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")

    # Check existing
    existing = await db.execute(
        select(CommercialSave).where(CommercialSave.post_id == post_id, CommercialSave.vendor_id == vendor.id)
    )
    if existing.scalar_one_or_none():
        return {"saved": True, "save_count": post.save_count}

    save = CommercialSave(post_id=post_id, vendor_id=vendor.id)
    db.add(save)
    post.save_count = (post.save_count or 0) + 1
    await db.commit()
    return {"saved": True, "save_count": post.save_count}


@router.delete("/posts/{post_id}/save")
async def unsave_post(
    post_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")

    existing = await db.execute(
        select(CommercialSave).where(CommercialSave.post_id == post_id, CommercialSave.vendor_id == vendor.id)
    )
    row = existing.scalar_one_or_none()
    if row:
        await db.delete(row)
        post.save_count = max(0, (post.save_count or 1) - 1)
        await db.commit()

    return {"saved": False, "save_count": post.save_count if post else 0}


# ── Share — salesperson distribution moat ────────────────────────────────

@router.post("/posts/{post_id}/share")
async def share_post(
    post_id: UUID,
    data: ShareCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")

    share = CommercialShare(
        post_id=post_id,
        vendor_id=vendor.id,
        share_channel=data.share_channel,
        share_target=data.share_target,
    )
    db.add(share)
    post.share_count = (post.share_count or 0) + 1
    await db.commit()
    await db.refresh(share)

    # Generate referral link
    referral_code = f"{vendor.vendor_handle}:{str(share.id)[:8]}"
    share_url = f"/commercial/{post_id}?ref={referral_code}"

    return {
        "shared": True,
        "share_id": str(share.id),
        "share_url": share_url,
        "referral_code": referral_code,
        "share_count": post.share_count,
        "commission_rate": post.commission_rate,
        "commission_fixed": post.commission_fixed,
    }


@router.get("/posts/{post_id}/shares")
async def get_shares(
    post_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")
    # Only owner can see shares analytics
    if str(post.vendor_id) != str(vendor.id):
        # Others can see count only
        return {"share_count": post.share_count, "shares": []}

    q = select(CommercialShare).where(CommercialShare.post_id == post_id).order_by(desc(CommercialShare.created_at)).limit(50)
    shares_res = await db.execute(q)
    shares = shares_res.scalars().all()

    return {
        "share_count": post.share_count,
        "shares": [
            {
                "id": str(s.id),
                "vendor_id": str(s.vendor_id),
                "channel": s.share_channel,
                "clicks": s.click_count,
                "conversions": s.conversion_count,
                "commission_earned": s.commission_earned,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in shares
        ],
    }


# ── Interest — group-buying layer ────────────────────────────────────────

@router.post("/posts/{post_id}/interest")
async def join_interest(
    post_id: UUID,
    data: InterestCreate,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")
    if post.status != CommercialPostStatus.ACTIVE:
        raise HTTPException(400, "Post is not active")

    # Check existing
    existing_res = await db.execute(
        select(CommercialInterest).where(CommercialInterest.post_id == post_id, CommercialInterest.vendor_id == vendor.id)
    )
    existing = existing_res.scalar_one_or_none()
    if existing:
        if existing.status == InterestStatus.CANCELLED:
            existing.status = InterestStatus.JOINED
            existing.quantity = data.quantity
            existing.notes = data.notes
            existing.updated_at = datetime.utcnow()
        else:
            existing.quantity = data.quantity
            existing.notes = data.notes
            existing.status = InterestStatus.JOINED
            existing.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing)
        return {
            "joined": True,
            "interest_id": str(existing.id),
            "status": existing.status.value if hasattr(existing.status, 'value') else str(existing.status),
            "current_interested": post.current_interested,
            "current_quantity": post.current_quantity_pledged,
        }

    # Handle referral
    referred_by_id = None
    if data.referred_by:
        # referred_by is a handle or referral code
        handle = data.referred_by.split(":")[0].replace("@", "")
        v_res = await db.execute(select(Vendor).where(Vendor.vendor_handle == handle))
        ref_vendor = v_res.scalar_one_or_none()
        if ref_vendor:
            referred_by_id = ref_vendor.id

    interest = CommercialInterest(
        post_id=post_id,
        vendor_id=vendor.id,
        quantity=data.quantity,
        status=InterestStatus.JOINED,
        notes=data.notes,
        referred_by_vendor_id=referred_by_id,
    )
    db.add(interest)

    # Update post counters
    post.current_interested = (post.current_interested or 0) + 1
    post.current_quantity_pledged = (post.current_quantity_pledged or 0) + data.quantity
    post.interest_count = (post.interest_count or 0) + 1

    # If referred, update sharer's conversion
    if referred_by_id:
        share_res = await db.execute(
            select(CommercialShare).where(
                CommercialShare.post_id == post_id,
                CommercialShare.vendor_id == referred_by_id,
            ).order_by(desc(CommercialShare.created_at)).limit(1)
        )
        share = share_res.scalar_one_or_none()
        if share:
            share.conversion_count = (share.conversion_count or 0) + 1
            # Calculate commission if applicable
            if post.commission_rate and post.group_price:
                share.commission_earned = (share.commission_earned or 0) + (post.group_price * data.quantity * post.commission_rate / 100)
            elif post.commission_fixed:
                share.commission_earned = (share.commission_earned or 0) + post.commission_fixed

    await db.commit()
    await db.refresh(interest)

    # Notify post owner
    try:
        await notification_service.create_notification(
            db,
            vendor_id=post.vendor_id,
            type=NotificationType.SYSTEM,
            title="New buying interest",
            body=f"@{vendor.vendor_handle} joined your group-buy: {post.title or post.content[:60]} x{data.quantity}",
            data={"post_id": str(post.id), "interest_id": str(interest.id)},
        )
    except Exception:
        pass

    return {
        "joined": True,
        "interest_id": str(interest.id),
        "status": "joined",
        "current_interested": post.current_interested,
        "current_quantity": post.current_quantity_pledged,
        "target_quantity": post.target_quantity,
        "progress": round((post.current_quantity_pledged / post.target_quantity * 100) if post.target_quantity else 0, 1),
    }


@router.delete("/posts/{post_id}/interest")
async def leave_interest(
    post_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialInterest).where(CommercialInterest.post_id == post_id, CommercialInterest.vendor_id == vendor.id))
    interest = res.scalar_one_or_none()
    if not interest:
        raise HTTPException(404, "Interest not found")

    post_res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = post_res.scalar_one_or_none()

    if interest.status != InterestStatus.CANCELLED:
        if post:
            post.current_interested = max(0, (post.current_interested or 1) - 1)
            post.current_quantity_pledged = max(0, (post.current_quantity_pledged or 0) - (interest.quantity or 0))
            post.interest_count = max(0, (post.interest_count or 1) - 1)

    interest.status = InterestStatus.CANCELLED
    interest.updated_at = datetime.utcnow()
    await db.commit()

    return {"left": True, "current_interested": post.current_interested if post else 0}


@router.get("/posts/{post_id}/interests")
async def list_interests(
    post_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")

    q = select(CommercialInterest).where(
        CommercialInterest.post_id == post_id,
        CommercialInterest.status != InterestStatus.CANCELLED,
    ).order_by(desc(CommercialInterest.created_at)).limit(limit)

    interests_res = await db.execute(q)
    interests = interests_res.scalars().all()

    vendor_ids = {i.vendor_id for i in interests}
    vmap = await _vendor_map(db, vendor_ids)

    return {
        "post_id": str(post_id),
        "total_interested": post.current_interested,
        "total_quantity": post.current_quantity_pledged,
        "target_quantity": post.target_quantity,
        "min_group_size": post.min_group_size,
        "progress_pct": round((post.current_quantity_pledged / post.target_quantity * 100) if post.target_quantity else (post.current_interested / post.min_group_size * 100 if post.min_group_size else 0), 1),
        "interests": [
            {
                "id": str(i.id),
                "vendor_handle": vmap.get(i.vendor_id).vendor_handle if vmap.get(i.vendor_id) else None,
                "vendor_business": vmap.get(i.vendor_id).business_name if vmap.get(i.vendor_id) else "A vendor",
                "quantity": i.quantity,
                "status": i.status.value if hasattr(i.status, 'value') else str(i.status),
                "created_at": i.created_at.isoformat() if i.created_at else None,
            }
            for i in interests
        ],
    }


# ── Convert to collective — harness existing collective sourcing ─────────

@router.post("/posts/{post_id}/convert-to-collective")
async def convert_to_collective(
    post_id: UUID,
    group_id: Optional[UUID] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """
    When group-buy interest reaches target, convert to a CollectiveSourcingRequest
    — this harnesses the existing collective module instead of duplicating it.
    """
    res = await db.execute(select(CommercialPost).where(CommercialPost.id == post_id))
    post = res.scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")
    if str(post.vendor_id) != str(vendor.id):
        raise HTTPException(403, "Only owner can convert")

    if post.collective_id:
        return {"already_converted": True, "collective_id": str(post.collective_id)}

    # Need a group
    target_group_id = group_id or post.group_id
    if not target_group_id:
        raise HTTPException(400, "group_id required — which vendor group should own this collective request?")

    # Check group exists
    g_res = await db.execute(select(VendorGroup).where(VendorGroup.id == target_group_id))
    if not g_res.scalar_one_or_none():
        raise HTTPException(404, "Group not found")

    # Create collective request using existing model
    from app.models.collective import CollectiveSourcingRequest

    collective = CollectiveSourcingRequest(
        group_id=target_group_id,
        organizer_vendor_id=vendor.id,
        item_name=post.title or post.content[:100],
        item_category=post.category,
        target_quantity=post.target_quantity or post.current_quantity_pledged or 10,
        target_price_per_unit=post.group_price or post.individual_price,
        unit_of_measure="units",
        description=post.content,
        status="gathering",
        current_pledged_quantity=post.current_quantity_pledged or 0,
    )
    db.add(collective)
    await db.flush()

    post.collective_id = collective.id
    await db.commit()

    return {"converted": True, "collective_id": str(collective.id), "group_id": str(target_group_id)}


# ── Stats — salesperson moat analytics ───────────────────────────────────

@router.get("/stats")
async def get_stats(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    # Posts created
    posts_count_res = await db.execute(
        select(func.count()).select_from(CommercialPost).where(CommercialPost.vendor_id == vendor.id)
    )
    posts_count = posts_count_res.scalar() or 0

    commercial_count_res = await db.execute(
        select(func.count()).select_from(CommercialPost).where(
            CommercialPost.vendor_id == vendor.id, CommercialPost.is_commercial.is_(True)
        )
    )
    commercial_count = commercial_count_res.scalar() or 0

    # Interests received on my posts
    interests_received_res = await db.execute(
        select(func.count()).select_from(CommercialInterest).join(
            CommercialPost, CommercialPost.id == CommercialInterest.post_id
        ).where(CommercialPost.vendor_id == vendor.id, CommercialInterest.status != InterestStatus.CANCELLED)
    )
    interests_received = interests_received_res.scalar() or 0

    # Shares made
    shares_made_res = await db.execute(
        select(func.count()).select_from(CommercialShare).where(CommercialShare.vendor_id == vendor.id)
    )
    shares_made = shares_made_res.scalar() or 0

    # Commission earned
    commission_res = await db.execute(
        select(func.coalesce(func.sum(CommercialShare.commission_earned), 0)).where(
            CommercialShare.vendor_id == vendor.id
        )
    )
    commission_earned = commission_res.scalar() or 0

    # Conversions via my shares
    conversions_res = await db.execute(
        select(func.coalesce(func.sum(CommercialShare.conversion_count), 0)).where(
            CommercialShare.vendor_id == vendor.id
        )
    )
    conversions = conversions_res.scalar() or 0

    # Interests I've joined
    my_interests_res = await db.execute(
        select(func.count()).select_from(CommercialInterest).where(
            CommercialInterest.vendor_id == vendor.id, CommercialInterest.status != InterestStatus.CANCELLED
        )
    )
    my_interests = my_interests_res.scalar() or 0

    return {
        "posts_created": posts_count,
        "commercial_posts": commercial_count,
        "interests_received": interests_received,
        "shares_made": shares_made,
        "conversions_via_shares": int(conversions),
        "commission_earned": float(commission_earned),
        "my_interests": my_interests,
        "moat_metrics": {
            "distribution_reach": shares_made,
            "demand_aggregated": interests_received,
            "conversion_rate": round((conversions / shares_made * 100) if shares_made else 0, 1),
        },
    }


@router.get("/categories")
async def get_categories(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(CommercialPost.category, func.count().label("count"))
        .where(CommercialPost.category.is_not(None), CommercialPost.status == CommercialPostStatus.ACTIVE)
        .group_by(CommercialPost.category)
        .order_by(desc("count"))
        .limit(20)
    )
    return {"categories": [{"category": row[0], "count": row[1]} for row in res.all()]}

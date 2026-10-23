"""FastAPI router for the Local Activity Ledger (`/api/ledger`)."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.vendor import Vendor
from app.modules.ledger import service
from app.modules.ledger.inference import (
    POSTING_TYPE_META,
    TEMPLATE_SCHEMAS,
    YOUTH_AGE_BANDS,
    YOUTH_PERMITTED_DOMAINS,
    infer_activity_template,
)
from app.modules.ledger.models import (
    ActivityBooking,
    ActivityWatch,
    LocalActivity,
    SavedRelationship,
)
from app.routes.auth import get_current_vendor

router = APIRouter()


@router.get("/templates")
async def get_templates(vendor: Vendor = Depends(get_current_vendor)):
    """The 4 primary posting types, progressive template schemas, and youth rules."""
    return {
        "posting_types": POSTING_TYPE_META,
        "templates": TEMPLATE_SCHEMAS,
        "youth_safety": {
            "age_bands": list(YOUTH_AGE_BANDS),
            "permitted_domains": list(YOUTH_PERMITTED_DOMAINS),
            "daytime_hours": "06:00–19:00",
            "guardian_consent_required": True,
        },
    }


@router.get("/infer")
async def infer_template(
    posting_type: str = Query("available"),
    text: str = Query(""),
    category: Optional[str] = None,
    explicit_template: Optional[str] = None,
    vendor: Vendor = Depends(get_current_vendor),
):
    return infer_activity_template(
        posting_type=posting_type,
        text=text,
        category=category,
        explicit_template=explicit_template,
    )


@router.post("/activities", status_code=201)
async def create_activity(
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_activity(db, vendor, payload)


@router.get("/activities")
async def list_activities(
    posting_type: Optional[str] = None,
    category: Optional[str] = None,
    template: Optional[str] = None,
    area: Optional[str] = None,
    q: Optional[str] = None,
    when: Optional[str] = None,
    youth_eligible: Optional[bool] = None,
    mine_only: bool = False,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: Optional[float] = None,
    limit: int = Query(30, ge=1, le=60),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_activities(
        db,
        viewer=vendor,
        posting_type=posting_type,
        category=category,
        template=template,
        area=area,
        q=q,
        when=when,
        youth_eligible=youth_eligible,
        mine_only=mine_only,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        limit=limit,
    )


@router.get("/activities/{activity_id}")
async def get_activity(
    activity_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_activity_detail(db, vendor, activity_id)


@router.patch("/activities/{activity_id}")
async def update_activity(
    activity_id: UUID,
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    act = await db.get(LocalActivity, activity_id)
    if not act:
        raise HTTPException(404, "Activity not found")
    if act.organizer_vendor_id != vendor.id:
        raise HTTPException(403, "Only the organizer can edit this activity.")
    for field in ("title", "body", "area_name", "schedule_label", "private_directions", "category"):
        if field in payload and payload[field] is not None:
            setattr(act, field, str(payload[field]).strip())
    if "lifecycle_status" in payload and payload["lifecycle_status"] in ("cancelled", "expired", "published"):
        act.lifecycle_status = payload["lifecycle_status"]
    await db.commit()
    return await service.get_activity_detail(db, vendor, activity_id)


@router.post("/activities/{activity_id}/responses", status_code=201)
async def submit_response(
    activity_id: UUID,
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.submit_response(db, vendor, activity_id, payload)


@router.post("/responses/{response_id}/guardian-consent")
async def update_guardian_consent(
    response_id: UUID,
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.set_guardian_consent(
        db,
        actor=vendor,
        response_id=response_id,
        consent_status=payload.get("consent_status", "confirmed"),
        guardian_note=payload.get("note"),
    )


@router.post("/activities/{activity_id}/bookings", status_code=201)
async def create_booking(
    activity_id: UUID,
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_booking(db, vendor, activity_id, payload)


@router.get("/bookings/mine")
async def list_my_bookings(
    status: Optional[str] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import or_

    stmt = (
        select(ActivityBooking, LocalActivity)
        .join(LocalActivity, LocalActivity.id == ActivityBooking.activity_id)
        .where(
            or_(
                ActivityBooking.organizer_vendor_id == vendor.id,
                ActivityBooking.participant_vendor_id == vendor.id,
            )
        )
        .order_by(ActivityBooking.updated_at.desc())
        .limit(50)
    )
    if status:
        stmt = stmt.where(ActivityBooking.status == status)
    rows = (await db.execute(stmt)).all()
    counterparty_ids = {
        b.participant_vendor_id if b.organizer_vendor_id == vendor.id else b.organizer_vendor_id
        for b, _ in rows
    }
    vmap = {}
    if counterparty_ids:
        vlist = (await db.execute(select(Vendor).where(Vendor.id.in_(counterparty_ids)))).scalars().all()
        vmap = {v.id: v for v in vlist}
    return {
        "items": [
            {
                "id": str(b.id),
                "activity_id": str(act.id),
                "activity_title": act.title,
                "posting_type": act.posting_type,
                "inferred_template": act.inferred_template,
                "area_name": act.area_name,
                "role": "organizer" if b.organizer_vendor_id == vendor.id else "participant",
                "counterparty": service.vendor_summary(
                    vmap.get(
                        b.participant_vendor_id
                        if b.organizer_vendor_id == vendor.id
                        else b.organizer_vendor_id
                    )
                ),
                "agreed_scope": b.agreed_scope,
                "agreed_price_kes": b.agreed_price_kes,
                "settlement_method": b.settlement_method,
                "custody_mode": "non_custodial",
                "stop_sequence": b.stop_sequence,
                "slot_label": b.slot_label,
                "status": b.status,
                "organizer_confirmed_at": (
                    b.organizer_confirmed_at.isoformat() if b.organizer_confirmed_at else None
                ),
                "participant_confirmed_at": (
                    b.participant_confirmed_at.isoformat() if b.participant_confirmed_at else None
                ),
                "completed_at": b.completed_at.isoformat() if b.completed_at else None,
                "to": f"/activities/{act.id}",
            }
            for b, act in rows
        ]
    }


@router.post("/bookings/{booking_id}/changes")
async def record_booking_change(
    booking_id: UUID,
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.record_agreed_change(db, vendor, booking_id, payload)


@router.post("/bookings/{booking_id}/confirm-completion")
async def confirm_booking_completion(
    booking_id: UUID,
    payload: dict = Body(default={}),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.confirm_completion(db, vendor, booking_id, note=(payload or {}).get("note"))


@router.post("/bookings/{booking_id}/feedback", status_code=201)
async def leave_booking_feedback(
    booking_id: UUID,
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.leave_feedback(db, vendor, booking_id, payload)


@router.post("/bookings/{booking_id}/repeat", status_code=201)
async def repeat_booking(
    booking_id: UUID,
    payload: dict = Body(default={}),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.repeat_from_booking(db, vendor, booking_id, payload or {})


@router.get("/records")
async def list_reusable_records(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return {"items": await service.my_reusable_records(db, vendor)}


# ── Notification preferences / watches ────────────────────────────────────────

@router.get("/watches")
async def list_watches(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(ActivityWatch)
            .where(ActivityWatch.vendor_id == vendor.id)
            .order_by(ActivityWatch.created_at.desc())
        )
    ).scalars().all()
    return {"items": [service.serialize_watch(w) for w in rows]}


@router.post("/watches", status_code=201)
async def create_watch(
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_watch(db, vendor, payload)


@router.patch("/watches/{watch_id}")
async def toggle_watch(
    watch_id: UUID,
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    watch = await db.get(ActivityWatch, watch_id)
    if not watch or watch.vendor_id != vendor.id:
        raise HTTPException(404, "Watch not found")
    if "is_active" in payload:
        watch.is_active = bool(payload["is_active"])
    if "label" in payload and payload["label"]:
        watch.label = str(payload["label"]).strip()[:140]
    await db.commit()
    return service.serialize_watch(watch)


@router.delete("/watches/{watch_id}")
async def delete_watch(
    watch_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        delete(ActivityWatch).where(ActivityWatch.id == watch_id, ActivityWatch.vendor_id == vendor.id)
    )
    if not res.rowcount:
        raise HTTPException(404, "Watch not found")
    await db.commit()
    return {"deleted": True}


@router.post("/notifications/{notification_id}/acted")
async def mark_notification_acted(
    notification_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.mark_notification_acted(db, vendor, notification_id)


# ── Saved relationships & local alternatives ──────────────────────────────────

@router.get("/relationships")
async def get_relationships(
    kind: Optional[str] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return {"items": await service.list_relationships(db, vendor, kind=kind)}


@router.post("/relationships", status_code=201)
async def save_relationship(
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.upsert_relationship(db, vendor, payload)


@router.delete("/relationships/{rel_id}")
async def remove_relationship(
    rel_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        delete(SavedRelationship).where(
            SavedRelationship.id == rel_id,
            SavedRelationship.owner_vendor_id == vendor.id,
        )
    )
    if not res.rowcount:
        raise HTTPException(404, "Saved relationship not found")
    await db.commit()
    return {"deleted": True}


@router.get("/alternatives")
async def compare_alternatives(
    category: Optional[str] = None,
    area: Optional[str] = None,
    exclude_vendor_id: Optional[UUID] = None,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.find_alternatives(
        db,
        viewer=vendor,
        category=category,
        area=area,
        exclude_vendor_id=exclude_vendor_id,
    )


# ── Phase 2: Home Storefront Controls ─────────────────────────────────────────

@router.get("/home-storefront")
async def get_home_storefront(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    cfg = dict(getattr(vendor, "home_storefront_config", None) or {})
    defaults = {
        "enabled": False,
        "title": f"{vendor.business_name}'s Home Shelf",
        "visiting_hours": "",
        "audience": "neighbours",
        "share_directions_only_when_booked": True,
        "pickup_notes": "",
    }
    defaults.update(cfg)
    my_available = await service.list_activities(
        db, viewer=vendor, posting_type="available", mine_only=True, limit=20
    )
    return {"config": defaults, "available_activities": my_available["items"]}


@router.put("/home-storefront")
async def put_home_storefront(
    payload: dict = Body(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    audience = (payload.get("audience") or "neighbours").strip().lower()
    if audience not in ("neighbours", "saved_contacts", "by_appointment"):
        raise HTTPException(422, "audience must be 'neighbours', 'saved_contacts', or 'by_appointment'.")
    cfg = dict(getattr(vendor, "home_storefront_config", None) or {})
    cfg.update(
        {
            "enabled": bool(payload.get("enabled", cfg.get("enabled", False))),
            "title": (payload.get("title") or cfg.get("title") or f"{vendor.business_name}'s Home Shelf").strip()[:160],
            "visiting_hours": (payload.get("visiting_hours") or "").strip()[:160],
            "audience": audience,
            "share_directions_only_when_booked": bool(
                payload.get("share_directions_only_when_booked", True)
            ),
            "pickup_notes": (payload.get("pickup_notes") or "").strip()[:300],
        }
    )
    vendor.home_storefront_config = cfg
    if cfg["share_directions_only_when_booked"]:
        vendor.hide_exact_location = True
    await db.commit()
    return {"config": cfg}


# ── Community Utility Metrics (§10) ───────────────────────────────────────────

@router.get("/metrics/summary")
async def get_metrics_summary(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    return await service.community_utility_metrics(db, vendor)

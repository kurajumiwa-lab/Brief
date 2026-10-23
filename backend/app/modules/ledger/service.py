"""Local Activity Ledger service — lifecycle state machine, privacy, watches & Phase 2."""

import uuid as uuidlib
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.groups import GroupMembership
from app.models.notification import Notification, NotificationType
from app.models.vendor import Vendor
from app.modules.ledger.inference import (
    YouthSafetyError,
    infer_activity_template,
    validate_youth_safety,
)
from app.modules.ledger.models import (
    ACTIVITY_GEO_PRECISIONS,
    ACTIVITY_TEMPLATES,
    ACTIVITY_VISIBILITIES,
    BOOKING_STATUSES_LEDGER,
    FEEDBACK_OUTCOMES,
    GUARDIAN_CONSENT_STATUSES,
    LOCATION_SCOPES,
    POSTING_TYPES,
    PRICE_BASES,
    RELATIONSHIP_KINDS,
    RESPONSE_TYPES,
    SETTLEMENT_METHODS,
    ActivityBooking,
    ActivityFeedback,
    ActivityLedgerEvent,
    ActivityResponse,
    ActivityWatch,
    LocalActivity,
    SavedRelationship,
)
from app.modules.ledger.privacy import (
    ACTIVE_DIRECTION_BOOKING_STATUSES,
    can_view_private_directions,
    can_view_stop_directions,
    public_coordinates,
)
from app.modules.outside.models import OutsideContentReport
from app.modules.outside.ranking import haversine_km
from app.platform import event_outbox

DAY_ABBR = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def parse_dt(value, field_name: str = "datetime") -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    except ValueError:
        raise HTTPException(422, f"Invalid {field_name}: '{value}'")


def _record_ledger_event(
    db: AsyncSession,
    activity_id: UUID,
    event_type: str,
    summary: str,
    actor_vendor_id: Optional[UUID] = None,
    booking_id: Optional[UUID] = None,
    payload: Optional[dict] = None,
) -> ActivityLedgerEvent:
    safe_payload = dict(payload or {})
    # Never write sensitive gate/home directions into audit logs or outbox.
    safe_payload.pop("private_directions", None)
    safe_payload.pop("private_stop_directions", None)
    ev = ActivityLedgerEvent(
        activity_id=activity_id,
        booking_id=booking_id,
        actor_vendor_id=actor_vendor_id,
        event_type=event_type,
        summary=summary,
        payload=safe_payload,
        created_at=datetime.utcnow(),
    )
    db.add(ev)
    event_outbox.emit(
        db,
        f"ledger.{event_type}",
        {"activity_id": str(activity_id), "booking_id": str(booking_id) if booking_id else None, **safe_payload},
    )
    return ev


def _notify(
    db: AsyncSession,
    recipient_id: UUID,
    sender_id: Optional[UUID],
    ntype: NotificationType,
    title: str,
    body: str,
    data: dict,
) -> None:
    if sender_id and recipient_id == sender_id:
        return
    db.add(
        Notification(
            id=uuidlib.uuid4(),
            recipient_id=recipient_id,
            sender_id=sender_id,
            notification_type=ntype,
            title=title[:200],
            body=(body or "")[:500],
            data=data,
            is_read=False,
            created_at=datetime.utcnow(),
        )
    )


def vendor_summary(v: Optional[Vendor]) -> Optional[dict]:
    if v is None:
        return None
    return {
        "id": str(v.id),
        "handle": v.vendor_handle,
        "name": v.business_name,
        "account_kind": getattr(v, "account_kind", None) or "business",
        "is_verified": bool(v.is_verified),
    }


async def blocked_vendor_ids(db: AsyncSession, viewer_id: UUID) -> set[UUID]:
    rows = (
        await db.execute(
            select(OutsideContentReport.target_vendor_id).where(
                OutsideContentReport.reporter_vendor_id == viewer_id,
                OutsideContentReport.is_block.is_(True),
                OutsideContentReport.target_vendor_id.is_not(None),
            )
        )
    ).scalars().all()
    return {r for r in rows if r is not None}


async def can_view_activity(
    db: AsyncSession,
    activity: LocalActivity,
    viewer: Vendor,
    bookings: Optional[list[ActivityBooking]] = None,
) -> bool:
    if activity.organizer_vendor_id == viewer.id:
        return True
    blocked = await blocked_vendor_ids(db, viewer.id)
    if activity.organizer_vendor_id in blocked:
        return False

    if bookings is None:
        bookings = (
            await db.execute(
                select(ActivityBooking).where(ActivityBooking.activity_id == activity.id)
            )
        ).scalars().all()
    if any(b.participant_vendor_id == viewer.id for b in bookings):
        return True

    if activity.visibility == "public":
        # Check Home Storefront audience rule when an Available item is linked to home shelf
        if activity.posting_type == "available" and activity.permission_rules.get("saved_contacts_only"):
            rel = (
                await db.execute(
                    select(SavedRelationship.id).where(
                        SavedRelationship.owner_vendor_id == activity.organizer_vendor_id,
                        SavedRelationship.target_vendor_id == viewer.id,
                    )
                )
            ).scalar_one_or_none()
            return rel is not None
        return True

    if activity.visibility == "saved_contacts":
        rel = (
            await db.execute(
                select(SavedRelationship.id).where(
                    SavedRelationship.owner_vendor_id == activity.organizer_vendor_id,
                    SavedRelationship.target_vendor_id == viewer.id,
                )
            )
        ).scalar_one_or_none()
        return rel is not None

    if activity.visibility == "community":
        community_id = activity.permission_rules.get("community_id")
        if not community_id:
            return False
        try:
            cid = UUID(str(community_id))
        except ValueError:
            return False
        member = (
            await db.execute(
                select(GroupMembership.id).where(
                    GroupMembership.group_id == cid,
                    GroupMembership.vendor_id == viewer.id,
                    GroupMembership.is_approved.is_(True),
                )
            )
        ).scalar_one_or_none()
        return member is not None

    return False  # private


def build_lifecycle_stages(
    activity: LocalActivity,
    bookings: list[ActivityBooking],
) -> list[dict]:
    """The 6-stage lifecycle record described in §8."""
    completed_bookings = [b for b in bookings if b.status == "completed"]
    active_or_done = [b for b in bookings if b.status != "cancelled"]
    is_completed = activity.lifecycle_status == "completed" or (
        bool(completed_bookings) and len(completed_bookings) == len(active_or_done)
    )
    return [
        {
            "step": 1,
            "key": "published",
            "label": "Published",
            "done": True,
            "detail": f"Posted as {activity.posting_type.title()} in {activity.area_name or 'local area'}",
        },
        {
            "step": 2,
            "key": "notified",
            "label": "Relevant people notified",
            "done": activity.notified_count > 0,
            "count": activity.notified_count,
            "detail": (
                f"{activity.notified_count} matching local member(s) notified"
                if activity.notified_count > 0
                else "Visible in neighbourhood discovery; alerts fire as matching watchers join"
            ),
        },
        {
            "step": 3,
            "key": "responses_received",
            "label": "Responses received",
            "done": activity.response_count > 0,
            "count": activity.response_count,
            "detail": (
                f"{activity.response_count} response(s) / quotation(s) recorded"
                if activity.response_count > 0
                else "Open for quotations, offers, pledges, or slot requests"
            ),
        },
        {
            "step": 4,
            "key": "booking_agreed",
            "label": "Booking agreed",
            "done": len(active_or_done) > 0,
            "count": len(active_or_done),
            "detail": (
                f"{len(active_or_done)} non-custodial booking(s) confirmed"
                if active_or_done
                else "Scope, schedule, and direct settlement not yet confirmed"
            ),
        },
        {
            "step": 5,
            "key": "completed",
            "label": "Work completed",
            "done": is_completed,
            "count": len(completed_bookings),
            "detail": (
                "Both parties confirmed completion"
                if is_completed
                else "Awaiting mutual completion confirmation & any agreed changes"
            ),
        },
        {
            "step": 6,
            "key": "reusable_record",
            "label": "Reusable record",
            "done": is_completed,
            "detail": (
                "Saved as a reusable record — sensitive household directions are private"
                if is_completed
                else "Unlocks after completion so you can rebook or compare alternatives"
            ),
        },
    ]


def serialize_activity_card(
    activity: LocalActivity,
    organizer: Optional[Vendor],
    viewer_id: Optional[UUID] = None,
    viewer_lat: Optional[float] = None,
    viewer_lng: Optional[float] = None,
    bookings: Optional[list[ActivityBooking]] = None,
    pledged_total: Optional[float] = None,
) -> dict:
    b_list = bookings or []
    can_see_exact = can_view_private_directions(activity, viewer_id, b_list)
    pub_lat, pub_lng = public_coordinates(
        activity.geo_lat, activity.geo_lng, activity.geo_precision, authorized_exact=can_see_exact
    )
    dist = None
    if viewer_lat is not None and viewer_lng is not None and activity.geo_lat is not None and activity.geo_lng is not None:
        dist = round(haversine_km(viewer_lat, viewer_lng, activity.geo_lat, activity.geo_lng), 1)

    tfields = dict(activity.template_fields or {})
    if activity.inferred_template == "group_sourcing" and pledged_total is not None:
        tfields["pledged_quantity"] = round(float(pledged_total), 3)
        target = tfields.get("target_quantity")
        if target:
            try:
                tfields["progress_pct"] = min(100, round((float(pledged_total) / float(target)) * 100, 1))
            except (TypeError, ValueError, ZeroDivisionError):
                pass

    return {
        "id": str(activity.id),
        "to": f"/activities/{activity.id}",
        "posting_type": activity.posting_type,
        "inferred_template": activity.inferred_template,
        "category": activity.category,
        "title": activity.title,
        "body": activity.body,
        "media": list(activity.media or []),
        "tags": list(activity.tags or []),
        "area_name": activity.area_name,
        "location_scope": activity.location_scope,
        "geo_lat": pub_lat,
        "geo_lng": pub_lng,
        "geo_precision": activity.geo_precision,
        "distance_km": dist,
        # Private household directions are redacted unless viewer is authorized RIGHT NOW.
        "private_directions": activity.private_directions if can_see_exact else None,
        "has_private_directions": bool(activity.private_directions),
        "private_directions_unlocked": bool(activity.private_directions and can_see_exact),
        "starts_at": activity.starts_at.isoformat() if activity.starts_at else None,
        "ends_at": activity.ends_at.isoformat() if activity.ends_at else None,
        "schedule_label": activity.schedule_label,
        "capacity": activity.capacity,
        "spots_confirmed": activity.spots_confirmed,
        "spots_remaining": (
            max(0, int(activity.capacity) - int(activity.spots_confirmed))
            if activity.capacity is not None
            else None
        ),
        "visibility": activity.visibility,
        "permission_rules": dict(activity.permission_rules or {}),
        "template_fields": tfields,
        "price_kes": activity.price_kes,
        "price_basis": activity.price_basis,
        "custody_mode": "non_custodial",
        "lifecycle_status": activity.lifecycle_status,
        "notified_count": activity.notified_count,
        "response_count": activity.response_count,
        "reused_from_activity_id": (
            str(activity.reused_from_activity_id) if activity.reused_from_activity_id else None
        ),
        "organizer": vendor_summary(organizer),
        "created_at": activity.created_at.isoformat(),
        "updated_at": activity.updated_at.isoformat(),
    }


async def _notify_matching_people(
    db: AsyncSession,
    activity: LocalActivity,
    organizer: Vendor,
) -> int:
    """Match active watches and saved-contact subscribers, notifying each at most once."""
    if activity.visibility == "private":
        return 0

    recipient_ids: set[UUID] = set()
    text_blob = f"{activity.title} {activity.body} {activity.category or ''} {activity.area_name or ''}".lower()
    day_key = DAY_ABBR[activity.starts_at.weekday()] if activity.starts_at else None
    is_youth = bool((activity.permission_rules or {}).get("is_youth_opportunity"))

    # 1. Preference-based ActivityWatches
    watches = (
        await db.execute(
            select(ActivityWatch).where(
                ActivityWatch.is_active.is_(True),
                ActivityWatch.vendor_id != organizer.id,
            )
        )
    ).scalars().all()

    now = datetime.utcnow()
    for w in watches:
        if w.only_youth_eligible and not is_youth:
            continue
        if w.posting_types and activity.posting_type not in w.posting_types:
            continue
        if w.categories:
            cats = [str(c).lower() for c in w.categories]
            act_cat = (activity.category or "").lower()
            if not any(c in act_cat or c in text_blob for c in cats):
                continue
        if w.keywords:
            words = [tok.strip().lower() for tok in w.keywords.split(",") if tok.strip()]
            if words and not any(tok in text_blob for tok in words):
                continue
        if w.days_of_week and day_key and day_key not in [str(d).lower()[:3] for d in w.days_of_week]:
            continue
        # Geographic match: coordinate radius if both exist, else area_name substring if specified
        if (
            w.geo_lat is not None
            and w.geo_lng is not None
            and activity.geo_lat is not None
            and activity.geo_lng is not None
        ):
            if haversine_km(w.geo_lat, w.geo_lng, activity.geo_lat, activity.geo_lng) > float(w.radius_km or 10.0):
                continue
        elif w.area_name and activity.area_name:
            if w.area_name.strip().lower() not in activity.area_name.lower() and activity.area_name.lower() not in w.area_name.strip().lower():
                continue
        elif w.area_name and not activity.area_name:
            continue

        recipient_ids.add(w.vendor_id)
        w.last_triggered_at = now

    # 2. People who saved this organizer with `notify_when_active=True`
    if activity.posting_type in ("available", "scheduled", "opportunity"):
        saved_subs = (
            await db.execute(
                select(SavedRelationship.owner_vendor_id).where(
                    SavedRelationship.target_vendor_id == organizer.id,
                    SavedRelationship.notify_when_active.is_(True),
                    SavedRelationship.owner_vendor_id != organizer.id,
                )
            )
        ).scalars().all()
        for owner_id in saved_subs:
            recipient_ids.add(owner_id)

    # Filter out anyone who blocked the organizer
    if recipient_ids:
        blocks = (
            await db.execute(
                select(OutsideContentReport.reporter_vendor_id).where(
                    OutsideContentReport.reporter_vendor_id.in_(recipient_ids),
                    OutsideContentReport.target_vendor_id == organizer.id,
                    OutsideContentReport.is_block.is_(True),
                )
            )
        ).scalars().all()
        recipient_ids -= set(blocks)

    for rid in recipient_ids:
        _notify(
            db,
            recipient_id=rid,
            sender_id=organizer.id,
            ntype=NotificationType.OPPORTUNITY_MATCH,
            title=f"{activity.posting_type.title()} near {activity.area_name or 'you'}: {activity.title}",
            body=activity.body[:220],
            data={
                "ledger_kind": "activity_match",
                "activity_id": str(activity.id),
                "posting_type": activity.posting_type,
                "category": activity.category,
                "to": f"/activities/{activity.id}",
            },
        )
    return len(recipient_ids)


async def create_activity(db: AsyncSession, organizer: Vendor, payload: dict) -> dict:
    """Create a LocalActivity, validate youth/privacy rules, and notify watchers."""
    posting_type = (payload.get("posting_type") or "").strip().lower()
    if posting_type not in POSTING_TYPES:
        raise HTTPException(
            422, f"posting_type must be one of: {', '.join(POSTING_TYPES)}"
        )

    body = (payload.get("body") or "").strip()
    title = (payload.get("title") or "").strip()
    if not title and body:
        title = body.split("\n", 1)[0][:120]
    if not body and len(title) >= 8:
        body = title
    if len(body) < 8:
        raise HTTPException(422, "Activity description (body) must be at least 8 characters.")
    if not title:
        raise HTTPException(422, "Provide a short title for this activity.")

    inferred = infer_activity_template(
        posting_type=posting_type,
        text=f"{title} {body}",
        category=payload.get("category"),
        explicit_template=payload.get("inferred_template"),
    )
    template = inferred["inferred_template"]
    if template not in ACTIVITY_TEMPLATES:
        template = "general"

    starts_at = parse_dt(payload.get("starts_at"), "starts_at")
    ends_at = parse_dt(payload.get("ends_at"), "ends_at")
    if ends_at and starts_at and ends_at < starts_at:
        raise HTTPException(422, "ends_at cannot be earlier than starts_at.")

    if posting_type == "scheduled" and starts_at is None and not (payload.get("schedule_label") or "").strip():
        raise HTTPException(422, "A Scheduled activity requires starts_at or schedule_label.")

    template_fields = dict(payload.get("template_fields") or {})
    # Merge convenient top-level fields into template_fields when supplied
    for k in (
        "scope_measure", "preferred_window", "materials_basis", "quotes_invited",
        "quantity", "unit", "handover_mode", "freshness_or_cut_note",
        "tool_condition", "max_borrow_duration", "care_terms",
        "open_hours", "storage_kind", "max_items",
        "route_corridor", "services_offered", "slot_duration_mins",
        "target_quantity", "estimated_unit_price_kes", "dropoff_area",
        "subject_or_skill", "learner_group", "host_background", "materials_note",
        "age_band", "permitted_domain", "supervisor_name", "supervisor_role", "learning_takeaway",
    ):
        if k in payload and payload[k] not in (None, ""):
            template_fields.setdefault(k, payload[k])

    try:
        permission_rules = validate_youth_safety(
            inferred_template=template,
            permission_rules=payload.get("permission_rules"),
            template_fields=template_fields,
            title=title,
            body=body,
            starts_at=starts_at,
            ends_at=ends_at,
        )
    except YouthSafetyError as exc:
        raise HTTPException(422, str(exc)) from exc

    # Apply Home Storefront rules automatically when organizer posts `available` from a home shelf
    home_cfg = dict(getattr(organizer, "home_storefront_config", None) or {})
    if posting_type == "available" and payload.get("use_home_storefront") and home_cfg:
        if home_cfg.get("audience") == "saved_contacts":
            permission_rules["saved_contacts_only"] = True
        if home_cfg.get("visiting_hours") and not payload.get("schedule_label"):
            payload["schedule_label"] = home_cfg.get("visiting_hours")

    location_scope = (payload.get("location_scope") or "").strip().lower()
    if not location_scope:
        location_scope = (
            "homestead_private"
            if getattr(organizer, "account_kind", "business") in ("person", "household")
            else "neighbourhood"
        )
    if location_scope not in LOCATION_SCOPES:
        raise HTTPException(422, f"location_scope must be one of: {', '.join(LOCATION_SCOPES)}")

    visibility = (payload.get("visibility") or "public").strip().lower()
    if visibility not in ACTIVITY_VISIBILITIES:
        raise HTTPException(422, f"visibility must be one of: {', '.join(ACTIVITY_VISIBILITIES)}")

    private_directions = (payload.get("private_directions") or "").strip() or None
    geo_precision = (payload.get("geo_precision") or "").strip().lower()
    if not geo_precision:
        if private_directions:
            geo_precision = "exact_for_confirmed"
        elif getattr(organizer, "hide_exact_location", True) or location_scope == "homestead_private":
            geo_precision = "approximate"
        else:
            geo_precision = "approximate"
    if geo_precision not in ACTIVITY_GEO_PRECISIONS:
        raise HTTPException(422, f"geo_precision must be one of: {', '.join(ACTIVITY_GEO_PRECISIONS)}")

    price_kes = payload.get("price_kes")
    if price_kes is not None and price_kes != "":
        price_kes = int(price_kes)
        if price_kes < 0:
            raise HTTPException(422, "price_kes cannot be negative.")
    else:
        price_kes = None

    price_basis = (payload.get("price_basis") or "").strip().lower()
    if not price_basis:
        if price_kes == 0:
            price_basis = "free"
        elif price_kes is not None:
            price_basis = "per_unit" if template in ("agricultural_produce_fodder", "group_sourcing") else "fixed"
        else:
            price_basis = "quote_requested" if posting_type == "wanted" else "free"
    if price_basis not in PRICE_BASES:
        raise HTTPException(422, f"price_basis must be one of: {', '.join(PRICE_BASES)}")

    capacity = payload.get("capacity")
    if capacity is not None and capacity != "":
        capacity = int(capacity)
        if capacity < 1:
            capacity = None
    else:
        capacity = None

    now = datetime.utcnow()
    activity = LocalActivity(
        id=uuidlib.uuid4(),
        organizer_vendor_id=organizer.id,
        posting_type=posting_type,
        inferred_template=template,
        category=(payload.get("category") or inferred["category"] or "").strip() or None,
        title=title[:220],
        body=body,
        media=list(payload.get("media") or []),
        tags=list(payload.get("tags") or []),
        area_name=(payload.get("area_name") or payload.get("location") or organizer.physical_location or "").strip() or None,
        location_scope=location_scope,
        geo_lat=float(payload["geo_lat"]) if payload.get("geo_lat") is not None else organizer.geo_lat,
        geo_lng=float(payload["geo_lng"]) if payload.get("geo_lng") is not None else organizer.geo_lng,
        geo_precision=geo_precision,
        private_directions=private_directions,
        starts_at=starts_at,
        ends_at=ends_at,
        schedule_label=(payload.get("schedule_label") or "").strip() or None,
        capacity=capacity,
        spots_confirmed=0,
        visibility=visibility,
        permission_rules=permission_rules,
        template_fields=template_fields,
        price_kes=price_kes,
        price_basis=price_basis,
        lifecycle_status="published",
        notified_count=0,
        response_count=0,
        reused_from_activity_id=payload.get("reused_from_activity_id"),
        created_at=now,
        updated_at=now,
    )
    db.add(activity)
    await db.flush()

    _record_ledger_event(
        db,
        activity_id=activity.id,
        actor_vendor_id=organizer.id,
        event_type="published",
        summary=f"Published {posting_type} activity: {activity.title}",
        payload={"posting_type": posting_type, "template": template, "category": activity.category},
    )

    notified = await _notify_matching_people(db, activity, organizer)
    activity.notified_count = notified
    if notified > 0:
        activity.lifecycle_status = "notified"
        _record_ledger_event(
            db,
            activity_id=activity.id,
            actor_vendor_id=organizer.id,
            event_type="watchers_notified",
            summary=f"Notified {notified} relevant local member(s)",
            payload={"notified_count": notified},
        )

    await db.commit()
    await db.refresh(activity)
    out = serialize_activity_card(activity, organizer, viewer_id=organizer.id)
    out["inferred"] = inferred
    out["lifecycle_stages"] = build_lifecycle_stages(activity, [])
    return out


async def list_activities(
    db: AsyncSession,
    viewer: Vendor,
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
    limit: int = 30,
) -> dict:
    stmt = (
        select(LocalActivity, Vendor)
        .join(Vendor, Vendor.id == LocalActivity.organizer_vendor_id)
        .order_by(LocalActivity.created_at.desc())
        .limit(min(max(limit * 3, 40), 150))
    )
    if mine_only:
        stmt = stmt.where(LocalActivity.organizer_vendor_id == viewer.id)
    else:
        stmt = stmt.where(LocalActivity.lifecycle_status.not_in(["cancelled", "expired"]))

    if posting_type:
        stmt = stmt.where(LocalActivity.posting_type == posting_type.strip().lower())
    if category:
        stmt = stmt.where(LocalActivity.category.ilike(f"%{category.strip()}%"))
    if template:
        stmt = stmt.where(LocalActivity.inferred_template == template.strip().lower())
    if area:
        stmt = stmt.where(LocalActivity.area_name.ilike(f"%{area.strip()}%"))
    if q:
        pat = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                LocalActivity.title.ilike(pat),
                LocalActivity.body.ilike(pat),
                LocalActivity.category.ilike(pat),
                LocalActivity.area_name.ilike(pat),
            )
        )

    now = datetime.utcnow()
    if when == "today":
        stmt = stmt.where(
            LocalActivity.starts_at.is_not(None),
            LocalActivity.starts_at >= now - timedelta(hours=4),
            LocalActivity.starts_at <= now + timedelta(hours=24),
        )
    elif when in ("weekend", "saturday"):
        stmt = stmt.where(
            or_(
                and_(
                    LocalActivity.starts_at.is_not(None),
                    LocalActivity.starts_at <= now + timedelta(days=7),
                ),
                LocalActivity.schedule_label.ilike("%sat%"),
                LocalActivity.schedule_label.ilike("%sun%"),
                LocalActivity.schedule_label.ilike("%weekend%"),
            )
        )
    elif when == "week":
        stmt = stmt.where(
            LocalActivity.starts_at.is_not(None),
            LocalActivity.starts_at <= now + timedelta(days=7),
        )

    rows = (await db.execute(stmt)).all()
    items = []
    for act, org in rows:
        if youth_eligible and not bool((act.permission_rules or {}).get("is_youth_opportunity")):
            continue
        if not await can_view_activity(db, act, viewer):
            continue
        if (
            lat is not None
            and lng is not None
            and radius_km is not None
            and act.geo_lat is not None
            and act.geo_lng is not None
        ):
            if haversine_km(lat, lng, act.geo_lat, act.geo_lng) > radius_km:
                continue

        pledged_total = None
        if act.inferred_template == "group_sourcing":
            pledged_total = (
                await db.execute(
                    select(func.coalesce(func.sum(ActivityResponse.quantity), 0.0)).where(
                        ActivityResponse.activity_id == act.id,
                        ActivityResponse.status.in_(["submitted", "shortlisted", "accepted"]),
                    )
                )
            ).scalar() or 0.0

        items.append(
            serialize_activity_card(
                act,
                org,
                viewer_id=viewer.id,
                viewer_lat=lat,
                viewer_lng=lng,
                pledged_total=pledged_total,
            )
        )
        if len(items) >= limit:
            break

    return {"items": items, "count": len(items)}


async def get_activity_detail(db: AsyncSession, viewer: Vendor, activity_id: UUID) -> dict:
    row = (
        await db.execute(
            select(LocalActivity, Vendor)
            .join(Vendor, Vendor.id == LocalActivity.organizer_vendor_id)
            .where(LocalActivity.id == activity_id)
        )
    ).first()
    if not row:
        raise HTTPException(404, "Activity not found")
    activity, organizer = row

    bookings = (
        await db.execute(
            select(ActivityBooking)
            .where(ActivityBooking.activity_id == activity.id)
            .order_by(ActivityBooking.stop_sequence.asc().nulls_last(), ActivityBooking.created_at.asc())
        )
    ).scalars().all()

    if not await can_view_activity(db, activity, viewer, bookings=bookings):
        raise HTTPException(403, "You do not have permission to view this activity")

    responses_rows = (
        await db.execute(
            select(ActivityResponse, Vendor)
            .join(Vendor, Vendor.id == ActivityResponse.responder_vendor_id)
            .where(ActivityResponse.activity_id == activity.id)
            .order_by(ActivityResponse.created_at.asc())
        )
    ).all()

    booking_by_response = {b.response_id: b for b in bookings if b.response_id}

    # Privacy rule on responses:
    # - Organizer sees all responses (with stop directions redacted after completion).
    # - A responder sees their OWN response in full.
    # - Other viewers only see aggregate response_count (and public pooled quantity on group orders).
    serialized_responses = []
    pledged_total = 0.0
    for resp, resp_vendor in responses_rows:
        if resp.status in ("submitted", "shortlisted", "accepted") and resp.quantity:
            pledged_total += float(resp.quantity)
        is_org = activity.organizer_vendor_id == viewer.id
        is_self = resp.responder_vendor_id == viewer.id
        if not (is_org or is_self):
            continue
        linked_b = booking_by_response.get(resp.id)
        show_stop_dir = can_view_stop_directions(resp, activity, viewer.id, booking=linked_b)
        serialized_responses.append(
            {
                "id": str(resp.id),
                "activity_id": str(resp.activity_id),
                "responder": vendor_summary(resp_vendor),
                "response_type": resp.response_type,
                "quoted_price_kes": resp.quoted_price_kes,
                "quantity": resp.quantity,
                "unit": resp.unit,
                "availability_window": resp.availability_window,
                "proposed_completion_time": resp.proposed_completion_time,
                "relevant_experience": resp.relevant_experience,
                "note": resp.note,
                "private_stop_directions": resp.private_stop_directions if show_stop_dir else None,
                "has_private_stop_directions": bool(resp.private_stop_directions),
                "guardian_consent_status": resp.guardian_consent_status,
                "guardian_name_and_contact": resp.guardian_name_and_contact if (is_org or is_self) else None,
                "status": resp.status,
                "created_at": resp.created_at.isoformat(),
            }
        )

    # Bookings: visible in detail only to the organizer or the booking's participant
    participant_ids = {b.participant_vendor_id for b in bookings} | {activity.organizer_vendor_id}
    vendors_map = {}
    if participant_ids:
        vrows = (await db.execute(select(Vendor).where(Vendor.id.in_(participant_ids)))).scalars().all()
        vendors_map = {v.id: v for v in vrows}

    feedback_rows = []
    if bookings:
        feedback_rows = (
            await db.execute(
                select(ActivityFeedback).where(
                    ActivityFeedback.booking_id.in_([b.id for b in bookings])
                )
            )
        ).scalars().all()
    fb_by_booking: dict[UUID, list[dict]] = {}
    for fb in feedback_rows:
        fb_by_booking.setdefault(fb.booking_id, []).append(
            {
                "id": str(fb.id),
                "author_vendor_id": str(fb.author_vendor_id),
                "target_vendor_id": str(fb.target_vendor_id),
                "outcome": fb.outcome,
                "would_repeat": fb.would_repeat,
                "tags": list(fb.tags or []),
                "note": fb.note,
                "created_at": fb.created_at.isoformat(),
            }
        )

    serialized_bookings = []
    for b in bookings:
        is_party = viewer.id in (b.organizer_vendor_id, b.participant_vendor_id)
        if not is_party:
            # Non-party viewers on a travelling round only see anonymized slot occupancy
            if activity.inferred_template == "travelling_round" and b.status != "cancelled":
                serialized_bookings.append(
                    {
                        "id": str(b.id),
                        "stop_sequence": b.stop_sequence,
                        "slot_label": b.slot_label,
                        "status": b.status,
                        "redacted_for_privacy": True,
                    }
                )
            continue
        serialized_bookings.append(
            {
                "id": str(b.id),
                "activity_id": str(b.activity_id),
                "response_id": str(b.response_id) if b.response_id else None,
                "organizer": vendor_summary(vendors_map.get(b.organizer_vendor_id)),
                "participant": vendor_summary(vendors_map.get(b.participant_vendor_id)),
                "agreed_scope": b.agreed_scope,
                "agreed_quantity": b.agreed_quantity,
                "agreed_unit": b.agreed_unit,
                "agreed_price_kes": b.agreed_price_kes,
                "settlement_method": b.settlement_method,
                "custody_mode": "non_custodial",
                "scheduled_start": b.scheduled_start.isoformat() if b.scheduled_start else None,
                "scheduled_end": b.scheduled_end.isoformat() if b.scheduled_end else None,
                "slot_label": b.slot_label,
                "stop_sequence": b.stop_sequence,
                "share_private_directions": b.share_private_directions,
                "private_directions_active": (
                    bool(b.share_private_directions) and b.status in ACTIVE_DIRECTION_BOOKING_STATUSES
                ),
                "agreed_changes": list(b.agreed_changes or []),
                "status": b.status,
                "organizer_confirmed_at": (
                    b.organizer_confirmed_at.isoformat() if b.organizer_confirmed_at else None
                ),
                "participant_confirmed_at": (
                    b.participant_confirmed_at.isoformat() if b.participant_confirmed_at else None
                ),
                "completed_at": b.completed_at.isoformat() if b.completed_at else None,
                "source_booking_id": str(b.source_booking_id) if b.source_booking_id else None,
                "feedback": fb_by_booking.get(b.id, []),
                "created_at": b.created_at.isoformat(),
            }
        )

    events = (
        await db.execute(
            select(ActivityLedgerEvent)
            .where(ActivityLedgerEvent.activity_id == activity.id)
            .order_by(ActivityLedgerEvent.created_at.asc(), ActivityLedgerEvent.id.asc())
        )
    ).scalars().all()

    card = serialize_activity_card(
        activity,
        organizer,
        viewer_id=viewer.id,
        bookings=bookings,
        pledged_total=pledged_total if activity.inferred_template == "group_sourcing" else None,
    )
    card["lifecycle_stages"] = build_lifecycle_stages(activity, bookings)
    card["responses"] = serialized_responses
    card["bookings"] = serialized_bookings
    card["ledger_events"] = [
        {
            "id": ev.id,
            "event_type": ev.event_type,
            "summary": ev.summary,
            "created_at": ev.created_at.isoformat(),
        }
        for ev in events
    ]
    return card


async def submit_response(
    db: AsyncSession,
    responder: Vendor,
    activity_id: UUID,
    payload: dict,
) -> dict:
    activity = await db.get(LocalActivity, activity_id)
    if not activity:
        raise HTTPException(404, "Activity not found")
    if activity.organizer_vendor_id == responder.id:
        raise HTTPException(400, "You cannot respond to your own activity.")
    if activity.lifecycle_status in ("cancelled", "expired", "completed"):
        raise HTTPException(409, f"This activity is already {activity.lifecycle_status}.")
    if not await can_view_activity(db, activity, responder):
        raise HTTPException(403, "You do not have permission to respond to this activity.")

    existing = (
        await db.execute(
            select(ActivityResponse).where(
                ActivityResponse.activity_id == activity.id,
                ActivityResponse.responder_vendor_id == responder.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "You have already responded to this activity; update your existing response instead.")

    is_youth = bool((activity.permission_rules or {}).get("is_youth_opportunity"))
    default_rtype = (
        "youth_application" if is_youth
        else "group_pledge" if activity.inferred_template == "group_sourcing"
        else "round_stop_request" if activity.inferred_template == "travelling_round"
        else "learning_enrolment" if activity.inferred_template == "community_learning"
        else "supply_offer" if activity.posting_type == "available"
        else "quote"
    )
    response_type = (payload.get("response_type") or default_rtype).strip().lower()
    if is_youth:
        response_type = "youth_application"
    if response_type not in RESPONSE_TYPES:
        raise HTTPException(422, f"response_type must be one of: {', '.join(RESPONSE_TYPES)}")

    note = (payload.get("note") or "").strip()
    if len(note) < 3:
        raise HTTPException(422, "Include a brief note with your response.")

    guardian_status = "not_required"
    guardian_contact = (payload.get("guardian_name_and_contact") or "").strip() or None
    if is_youth:
        if not guardian_contact or len(guardian_contact) < 5:
            raise HTTPException(
                422,
                "Youth opportunities require guardian_name_and_contact so a parent/guardian can confirm consent.",
            )
        # Starts `pending` unless guardian attestation is explicitly skipped — never skipped!
        guardian_status = "pending"

    quoted_price = payload.get("quoted_price_kes")
    if quoted_price is not None and quoted_price != "":
        quoted_price = int(quoted_price)
        if quoted_price < 0:
            raise HTTPException(422, "quoted_price_kes cannot be negative.")
    else:
        quoted_price = None

    qty = payload.get("quantity")
    if qty is not None and qty != "":
        qty = float(qty)
        if qty <= 0:
            raise HTTPException(422, "quantity must be greater than zero.")
    else:
        qty = None
    if response_type == "group_pledge" and qty is None:
        raise HTTPException(422, "A group-order pledge requires a positive quantity.")

    now = datetime.utcnow()
    resp = ActivityResponse(
        id=uuidlib.uuid4(),
        activity_id=activity.id,
        responder_vendor_id=responder.id,
        response_type=response_type,
        quoted_price_kes=quoted_price,
        quantity=qty,
        unit=(payload.get("unit") or (activity.template_fields or {}).get("unit") or "").strip() or None,
        availability_window=(payload.get("availability_window") or "").strip() or None,
        proposed_completion_time=(payload.get("proposed_completion_time") or "").strip() or None,
        relevant_experience=(payload.get("relevant_experience") or "").strip() or None,
        note=note,
        private_stop_directions=(payload.get("private_stop_directions") or "").strip() or None,
        guardian_consent_status=guardian_status,
        guardian_name_and_contact=guardian_contact,
        status="submitted",
        created_at=now,
        updated_at=now,
    )
    db.add(resp)
    activity.response_count = int(activity.response_count or 0) + 1
    if activity.lifecycle_status in ("published", "notified"):
        activity.lifecycle_status = "responses_received"
    activity.updated_at = now

    _record_ledger_event(
        db,
        activity_id=activity.id,
        actor_vendor_id=responder.id,
        event_type="response_received",
        summary=f"@{responder.vendor_handle} submitted a {response_type.replace('_', ' ')}",
        payload={"response_id": str(resp.id), "response_type": response_type},
    )
    _notify(
        db,
        recipient_id=activity.organizer_vendor_id,
        sender_id=responder.id,
        ntype=NotificationType.BOOKING_REQUEST,
        title=f"New response on '{activity.title}'",
        body=f"@{responder.vendor_handle}: {note[:180]}",
        data={
            "ledger_kind": "response_received",
            "activity_id": str(activity.id),
            "response_id": str(resp.id),
            "to": f"/activities/{activity.id}",
        },
    )

    await db.commit()
    await db.refresh(resp)
    return {
        "id": str(resp.id),
        "activity_id": str(activity.id),
        "response_type": resp.response_type,
        "quoted_price_kes": resp.quoted_price_kes,
        "quantity": resp.quantity,
        "unit": resp.unit,
        "guardian_consent_status": resp.guardian_consent_status,
        "status": resp.status,
    }


async def set_guardian_consent(
    db: AsyncSession,
    actor: Vendor,
    response_id: UUID,
    consent_status: str,
    guardian_note: Optional[str] = None,
) -> dict:
    """Confirm or revoke parent/guardian/school consent for a youth application."""
    resp = await db.get(ActivityResponse, response_id)
    if not resp:
        raise HTTPException(404, "Response not found")
    activity = await db.get(LocalActivity, resp.activity_id)
    if not activity:
        raise HTTPException(404, "Activity not found")
    if actor.id not in (resp.responder_vendor_id, activity.organizer_vendor_id):
        raise HTTPException(403, "Only the applicant/guardian or activity organizer can record consent status.")

    cstatus = (consent_status or "").strip().lower()
    if cstatus not in ("confirmed", "revoked"):
        raise HTTPException(422, "consent_status must be 'confirmed' or 'revoked'.")
    if not resp.guardian_name_and_contact:
        raise HTTPException(422, "guardian_name_and_contact must be recorded before confirming consent.")

    resp.guardian_consent_status = cstatus
    resp.updated_at = datetime.utcnow()
    _record_ledger_event(
        db,
        activity_id=activity.id,
        actor_vendor_id=actor.id,
        event_type="guardian_consent_updated",
        summary=f"Guardian consent {cstatus} for youth application",
        payload={"response_id": str(resp.id), "guardian_consent_status": cstatus, "note": guardian_note},
    )
    await db.commit()
    return {"id": str(resp.id), "guardian_consent_status": resp.guardian_consent_status}


async def create_booking(
    db: AsyncSession,
    organizer: Vendor,
    activity_id: UUID,
    payload: dict,
) -> dict:
    """Agree on scope, schedule, non-custodial settlement, and confirm appointment."""
    activity = await db.get(LocalActivity, activity_id, with_for_update=True)
    if not activity:
        raise HTTPException(404, "Activity not found")
    if activity.organizer_vendor_id != organizer.id:
        raise HTTPException(403, "Only the activity organizer can confirm a booking.")
    if activity.lifecycle_status in ("cancelled", "expired"):
        raise HTTPException(409, f"Cannot book a {activity.lifecycle_status} activity.")

    if activity.capacity is not None and activity.spots_confirmed >= activity.capacity:
        raise HTTPException(409, f"Capacity reached ({activity.capacity} confirmed).")

    settlement_method = (payload.get("settlement_method") or "direct_mpesa").strip().lower()
    if settlement_method not in SETTLEMENT_METHODS:
        raise HTTPException(
            422,
            f"Bookings are strictly non-custodial. settlement_method must be one of: {', '.join(SETTLEMENT_METHODS)}.",
        )

    response_id = payload.get("response_id")
    resp: Optional[ActivityResponse] = None
    if response_id:
        resp = await db.get(ActivityResponse, UUID(str(response_id)))
        if not resp or resp.activity_id != activity.id:
            raise HTTPException(404, "Response not found on this activity.")
        participant_id = resp.responder_vendor_id
    else:
        pid = payload.get("participant_vendor_id")
        if not pid:
            raise HTTPException(422, "Provide response_id or participant_vendor_id.")
        participant_id = UUID(str(pid))

    if participant_id == organizer.id:
        raise HTTPException(400, "Cannot create a booking with yourself.")

    # Server-enforced youth supervision & guardian consent gate!
    if bool((activity.permission_rules or {}).get("is_youth_opportunity")):
        if resp is None or resp.guardian_consent_status != "confirmed":
            raise HTTPException(
                422,
                "Youth opportunity bookings require confirmed parent/guardian consent before confirmation.",
            )

    agreed_scope = (
        (payload.get("agreed_scope") or "").strip()
        or (resp.note if resp else "")
        or activity.title
    )
    agreed_price = payload.get("agreed_price_kes")
    if agreed_price is not None and agreed_price != "":
        agreed_price = int(agreed_price)
        if agreed_price < 0:
            raise HTTPException(422, "agreed_price_kes cannot be negative.")
    elif resp and resp.quoted_price_kes is not None:
        agreed_price = resp.quoted_price_kes
    else:
        agreed_price = activity.price_kes

    agreed_qty = payload.get("agreed_quantity")
    if agreed_qty is not None and agreed_qty != "":
        agreed_qty = float(agreed_qty)
    elif resp and resp.quantity is not None:
        agreed_qty = float(resp.quantity)
    else:
        agreed_qty = None

    stop_sequence = payload.get("stop_sequence")
    if stop_sequence is not None and stop_sequence != "":
        stop_sequence = int(stop_sequence)
    elif activity.inferred_template == "travelling_round":
        max_seq = (
            await db.execute(
                select(func.coalesce(func.max(ActivityBooking.stop_sequence), 0)).where(
                    ActivityBooking.activity_id == activity.id,
                    ActivityBooking.status != "cancelled",
                )
            )
        ).scalar() or 0
        stop_sequence = int(max_seq) + 1
    else:
        stop_sequence = None

    now = datetime.utcnow()
    booking = ActivityBooking(
        id=uuidlib.uuid4(),
        activity_id=activity.id,
        response_id=resp.id if resp else None,
        organizer_vendor_id=organizer.id,
        participant_vendor_id=participant_id,
        agreed_scope=agreed_scope,
        agreed_quantity=agreed_qty,
        agreed_unit=(payload.get("agreed_unit") or (resp.unit if resp else None) or "").strip() or None,
        agreed_price_kes=agreed_price,
        settlement_method=settlement_method,
        scheduled_start=parse_dt(payload.get("scheduled_start"), "scheduled_start") or activity.starts_at,
        scheduled_end=parse_dt(payload.get("scheduled_end"), "scheduled_end") or activity.ends_at,
        slot_label=(payload.get("slot_label") or (resp.availability_window if resp else None) or "").strip() or None,
        stop_sequence=stop_sequence,
        share_private_directions=bool(payload.get("share_private_directions", bool(activity.private_directions))),
        agreed_changes=[],
        status="agreed",
        source_booking_id=UUID(str(payload["source_booking_id"])) if payload.get("source_booking_id") else None,
        created_at=now,
        updated_at=now,
    )
    db.add(booking)
    await db.flush()

    if resp:
        resp.status = "accepted"
        resp.updated_at = now

    activity.spots_confirmed = int(activity.spots_confirmed or 0) + 1
    activity.lifecycle_status = "booking_agreed"
    activity.updated_at = now

    _record_ledger_event(
        db,
        activity_id=activity.id,
        booking_id=booking.id,
        actor_vendor_id=organizer.id,
        event_type="booking_agreed",
        summary=f"Booking agreed ({settlement_method}, non-custodial)",
        payload={
            "participant_vendor_id": str(participant_id),
            "settlement_method": settlement_method,
            "stop_sequence": stop_sequence,
        },
    )
    _notify(
        db,
        recipient_id=participant_id,
        sender_id=organizer.id,
        ntype=NotificationType.BOOKING_UPDATE,
        title=f"Booking confirmed: {activity.title}",
        body=f"Agreed scope: {agreed_scope[:160]}",
        data={
            "ledger_kind": "booking_agreed",
            "activity_id": str(activity.id),
            "booking_id": str(booking.id),
            "to": f"/activities/{activity.id}",
        },
    )

    await db.commit()
    await db.refresh(booking)
    return {
        "id": str(booking.id),
        "activity_id": str(activity.id),
        "status": booking.status,
        "settlement_method": booking.settlement_method,
        "custody_mode": "non_custodial",
        "stop_sequence": booking.stop_sequence,
        "share_private_directions": booking.share_private_directions,
    }


async def record_agreed_change(
    db: AsyncSession,
    actor: Vendor,
    booking_id: UUID,
    payload: dict,
) -> dict:
    """Record an agreed scope, timing, or price change on an active booking (§8 step 5)."""
    booking = await db.get(ActivityBooking, booking_id, with_for_update=True)
    if not booking:
        raise HTTPException(404, "Booking not found")
    if actor.id not in (booking.organizer_vendor_id, booking.participant_vendor_id):
        raise HTTPException(403, "Only booking participants can record agreed changes.")
    if booking.status in ("completed", "cancelled"):
        raise HTTPException(409, f"Cannot modify a {booking.status} booking.")

    summary = (payload.get("summary") or "").strip()
    if len(summary) < 4:
        raise HTTPException(422, "Describe the agreed change (at least 4 characters).")

    revised_price = payload.get("revised_price_kes")
    if revised_price is not None and revised_price != "":
        revised_price = int(revised_price)
        if revised_price < 0:
            raise HTTPException(422, "revised_price_kes cannot be negative.")
        booking.agreed_price_kes = revised_price
    else:
        revised_price = None

    if payload.get("revised_scope"):
        booking.agreed_scope = str(payload["revised_scope"]).strip()

    entry = {
        "id": str(uuidlib.uuid4()),
        "at": datetime.utcnow().isoformat(),
        "by_vendor_id": str(actor.id),
        "summary": summary,
        "revised_price_kes": revised_price,
    }
    booking.agreed_changes = [*list(booking.agreed_changes or []), entry]
    booking.updated_at = datetime.utcnow()

    _record_ledger_event(
        db,
        activity_id=booking.activity_id,
        booking_id=booking.id,
        actor_vendor_id=actor.id,
        event_type="scope_change_recorded",
        summary=f"Agreed change recorded: {summary[:140]}",
        payload={"change_id": entry["id"]},
    )
    other_id = (
        booking.participant_vendor_id
        if actor.id == booking.organizer_vendor_id
        else booking.organizer_vendor_id
    )
    _notify(
        db,
        recipient_id=other_id,
        sender_id=actor.id,
        ntype=NotificationType.BOOKING_UPDATE,
        title="Agreed change recorded on booking",
        body=summary[:200],
        data={
            "ledger_kind": "scope_change_recorded",
            "activity_id": str(booking.activity_id),
            "booking_id": str(booking.id),
            "to": f"/activities/{booking.activity_id}",
        },
    )
    await db.commit()
    return {"booking_id": str(booking.id), "agreed_changes": booking.agreed_changes, "agreed_price_kes": booking.agreed_price_kes}


async def confirm_completion(
    db: AsyncSession,
    actor: Vendor,
    booking_id: UUID,
    note: Optional[str] = None,
) -> dict:
    """Two-party completion confirmation.

    Once both organizer and participant confirm:
      - `booking.status` becomes `'completed'`
      - temporary household `private_directions` & `private_stop_directions`
        access closes automatically so the reusable record stays private!
    """
    booking = await db.get(ActivityBooking, booking_id, with_for_update=True)
    if not booking:
        raise HTTPException(404, "Booking not found")
    if actor.id not in (booking.organizer_vendor_id, booking.participant_vendor_id):
        raise HTTPException(403, "Only the booking organizer or participant can confirm completion.")
    if booking.status == "cancelled":
        raise HTTPException(409, "Cannot complete a cancelled booking.")

    activity = await db.get(LocalActivity, booking.activity_id, with_for_update=True)
    now = datetime.utcnow()

    if actor.id == booking.organizer_vendor_id and not booking.organizer_confirmed_at:
        booking.organizer_confirmed_at = now
    if actor.id == booking.participant_vendor_id and not booking.participant_confirmed_at:
        booking.participant_confirmed_at = now

    both_confirmed = bool(booking.organizer_confirmed_at and booking.participant_confirmed_at)
    if both_confirmed:
        booking.status = "completed"
        booking.completed_at = booking.completed_at or now
    elif booking.organizer_confirmed_at:
        booking.status = "organizer_completed"
    else:
        booking.status = "participant_completed"
    booking.updated_at = now

    if both_confirmed and activity:
        all_bookings = (
            await db.execute(
                select(ActivityBooking).where(
                    ActivityBooking.activity_id == activity.id,
                    ActivityBooking.status != "cancelled",
                )
            )
        ).scalars().all()
        capacity_met = activity.capacity is None or len(all_bookings) >= activity.capacity
        if all(b.status == "completed" or b.id == booking.id for b in all_bookings) and capacity_met:
            activity.lifecycle_status = "completed"
            activity.updated_at = now

        _record_ledger_event(
            db,
            activity_id=booking.activity_id,
            booking_id=booking.id,
            actor_vendor_id=actor.id,
            event_type="activity_completed",
            summary="Both parties confirmed completion — reusable private record created",
            payload={"note": note} if note else {},
        )
    else:
        _record_ledger_event(
            db,
            activity_id=booking.activity_id,
            booking_id=booking.id,
            actor_vendor_id=actor.id,
            event_type="party_confirmed_completion",
            summary=f"@{actor.vendor_handle} confirmed completion — awaiting other party",
            payload={"note": note} if note else {},
        )

    other_id = (
        booking.participant_vendor_id
        if actor.id == booking.organizer_vendor_id
        else booking.organizer_vendor_id
    )
    _notify(
        db,
        recipient_id=other_id,
        sender_id=actor.id,
        ntype=NotificationType.BOOKING_UPDATE,
        title=(
            f"Completed: {activity.title}"
            if both_confirmed and activity
            else f"Confirm completion: {activity.title if activity else 'Booking'}"
        ),
        body=(
            "Both sides have confirmed completion. Leave feedback or save for future bookings."
            if both_confirmed
            else f"@{actor.vendor_handle} marked the work completed — please confirm."
        ),
        data={
            "ledger_kind": "completion_update",
            "activity_id": str(booking.activity_id),
            "booking_id": str(booking.id),
            "to": f"/activities/{booking.activity_id}",
        },
    )

    await db.commit()
    return {
        "booking_id": str(booking.id),
        "status": booking.status,
        "both_confirmed": both_confirmed,
        "private_directions_active": False if both_confirmed else bool(booking.share_private_directions),
        "activity_lifecycle_status": activity.lifecycle_status if activity else None,
    }


async def leave_feedback(
    db: AsyncSession,
    author: Vendor,
    booking_id: UUID,
    payload: dict,
) -> dict:
    booking = await db.get(ActivityBooking, booking_id)
    if not booking:
        raise HTTPException(404, "Booking not found")
    if author.id not in (booking.organizer_vendor_id, booking.participant_vendor_id):
        raise HTTPException(403, "Only booking participants can leave feedback.")
    if booking.status != "completed":
        raise HTTPException(409, "Feedback can only be recorded after mutual completion.")

    existing = (
        await db.execute(
            select(ActivityFeedback).where(
                ActivityFeedback.booking_id == booking.id,
                ActivityFeedback.author_vendor_id == author.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "You already left feedback for this booking.")

    outcome = (payload.get("outcome") or "completed_as_agreed").strip().lower()
    if outcome not in FEEDBACK_OUTCOMES:
        raise HTTPException(422, f"outcome must be one of: {', '.join(FEEDBACK_OUTCOMES)}")

    target_id = (
        booking.participant_vendor_id
        if author.id == booking.organizer_vendor_id
        else booking.organizer_vendor_id
    )
    fb = ActivityFeedback(
        id=uuidlib.uuid4(),
        booking_id=booking.id,
        author_vendor_id=author.id,
        target_vendor_id=target_id,
        outcome=outcome,
        would_repeat=bool(payload.get("would_repeat", True)),
        tags=[str(t).strip() for t in (payload.get("tags") or []) if str(t).strip()][:8],
        note=(payload.get("note") or "").strip() or None,
        created_at=datetime.utcnow(),
    )
    db.add(fb)
    _record_ledger_event(
        db,
        activity_id=booking.activity_id,
        booking_id=booking.id,
        actor_vendor_id=author.id,
        event_type="feedback_left",
        summary=f"Feedback recorded ({outcome.replace('_', ' ')})",
        payload={"outcome": outcome, "would_repeat": fb.would_repeat},
    )
    await db.commit()
    return {
        "id": str(fb.id),
        "booking_id": str(booking.id),
        "outcome": fb.outcome,
        "would_repeat": fb.would_repeat,
        "tags": fb.tags,
    }


async def repeat_from_booking(
    db: AsyncSession,
    viewer: Vendor,
    booking_id: UUID,
    payload: dict,
) -> dict:
    """Create a fresh repeat activity & invite the trusted counterparty — while
    keeping sensitive household directions locked until the new booking is agreed."""
    old_booking = await db.get(ActivityBooking, booking_id)
    if not old_booking:
        raise HTTPException(404, "Booking not found")
    if viewer.id not in (old_booking.organizer_vendor_id, old_booking.participant_vendor_id):
        raise HTTPException(403, "Only participants of a past booking can repeat it.")
    if old_booking.status != "completed":
        raise HTTPException(409, "Only completed bookings can be repeated from the reusable record.")

    old_act = await db.get(LocalActivity, old_booking.activity_id)
    if not old_act:
        raise HTTPException(404, "Source activity not found")

    other_id = (
        old_booking.participant_vendor_id
        if viewer.id == old_booking.organizer_vendor_id
        else old_booking.organizer_vendor_id
    )

    new_payload = {
        "posting_type": payload.get("posting_type") or old_act.posting_type,
        "inferred_template": old_act.inferred_template,
        "category": old_act.category,
        "title": (payload.get("title") or f"Repeat: {old_act.title}").strip(),
        "body": (payload.get("body") or old_booking.agreed_scope or old_act.body).strip(),
        "area_name": payload.get("area_name") or old_act.area_name,
        "location_scope": old_act.location_scope,
        "geo_lat": old_act.geo_lat,
        "geo_lng": old_act.geo_lng,
        "geo_precision": "exact_for_confirmed" if old_act.private_directions else "approximate",
        # Private directions carry forward for the organizer's own convenience,
        # but stay REDACTED until a new booking is explicitly confirmed!
        "private_directions": (
            payload.get("private_directions")
            if "private_directions" in payload
            else (old_act.private_directions if viewer.id == old_act.organizer_vendor_id else None)
        ),
        "starts_at": payload.get("starts_at"),
        "schedule_label": payload.get("schedule_label") or "Repeat booking — confirm schedule",
        "price_kes": payload.get("price_kes", old_booking.agreed_price_kes),
        "template_fields": dict(old_act.template_fields or {}),
        "permission_rules": dict(old_act.permission_rules or {}),
        "reused_from_activity_id": old_act.id,
    }
    created = await create_activity(db, viewer, new_payload)
    new_act_id = UUID(created["id"])

    if payload.get("auto_invite_previous", True):
        _notify(
            db,
            recipient_id=other_id,
            sender_id=viewer.id,
            ntype=NotificationType.BOOKING_REQUEST,
            title=f"Repeat request from @{viewer.vendor_handle}: {created['title']}",
            body="You worked together previously — send availability or a fresh quote.",
            data={
                "ledger_kind": "repeat_invite",
                "activity_id": str(new_act_id),
                "source_booking_id": str(old_booking.id),
                "to": f"/activities/{new_act_id}",
            },
        )
        _record_ledger_event(
            db,
            activity_id=new_act_id,
            booking_id=old_booking.id,
            actor_vendor_id=viewer.id,
            event_type="rebooked",
            summary="Created from reusable record & invited previous provider",
            payload={"source_booking_id": str(old_booking.id), "invited_vendor_id": str(other_id)},
        )
        await db.commit()

    created["source_booking_id"] = str(old_booking.id)
    created["invited_previous_vendor_id"] = str(other_id)
    return created


async def upsert_relationship(db: AsyncSession, owner: Vendor, payload: dict) -> dict:
    target_raw = payload.get("target_vendor_id")
    handle_raw = payload.get("target_handle")
    target: Optional[Vendor] = None
    if target_raw:
        target = await db.get(Vendor, UUID(str(target_raw)))
    elif handle_raw:
        target = (
            await db.execute(
                select(Vendor).where(Vendor.vendor_handle == str(handle_raw).lstrip("@").lower())
            )
        ).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Target person or provider not found.")
    if target.id == owner.id:
        raise HTTPException(400, "Cannot save yourself as a relationship.")

    rkind = (payload.get("relationship_kind") or "service_provider").strip().lower()
    if rkind not in RELATIONSHIP_KINDS:
        raise HTTPException(422, f"relationship_kind must be one of: {', '.join(RELATIONSHIP_KINDS)}")

    rel = (
        await db.execute(
            select(SavedRelationship).where(
                SavedRelationship.owner_vendor_id == owner.id,
                SavedRelationship.target_vendor_id == target.id,
            )
        )
    ).scalar_one_or_none()

    now = datetime.utcnow()
    if rel is None:
        rel = SavedRelationship(
            id=uuidlib.uuid4(),
            owner_vendor_id=owner.id,
            target_vendor_id=target.id,
            relationship_kind=rkind,
            label=(payload.get("label") or "").strip() or None,
            categories=list(payload.get("categories") or target.business_categories or []),
            private_note=(payload.get("private_note") or "").strip() or None,
            notify_when_active=bool(payload.get("notify_when_active", True)),
            last_booking_id=UUID(str(payload["last_booking_id"])) if payload.get("last_booking_id") else None,
            created_at=now,
            updated_at=now,
        )
        db.add(rel)
    else:
        rel.relationship_kind = rkind
        if "label" in payload:
            rel.label = (payload.get("label") or "").strip() or None
        if "categories" in payload and payload["categories"] is not None:
            rel.categories = list(payload["categories"])
        if "private_note" in payload:
            rel.private_note = (payload.get("private_note") or "").strip() or None
        if "notify_when_active" in payload:
            rel.notify_when_active = bool(payload["notify_when_active"])
        rel.updated_at = now

    await db.commit()
    await db.refresh(rel)
    return await _serialize_relationship(db, rel, target)


async def _serialize_relationship(db: AsyncSession, rel: SavedRelationship, target: Vendor) -> dict:
    completed_together = (
        await db.execute(
            select(func.count(ActivityBooking.id)).where(
                ActivityBooking.status == "completed",
                or_(
                    and_(
                        ActivityBooking.organizer_vendor_id == rel.owner_vendor_id,
                        ActivityBooking.participant_vendor_id == target.id,
                    ),
                    and_(
                        ActivityBooking.organizer_vendor_id == target.id,
                        ActivityBooking.participant_vendor_id == rel.owner_vendor_id,
                    ),
                ),
            )
        )
    ).scalar() or 0

    latest_booking = (
        await db.execute(
            select(ActivityBooking)
            .where(
                ActivityBooking.status == "completed",
                or_(
                    and_(
                        ActivityBooking.organizer_vendor_id == rel.owner_vendor_id,
                        ActivityBooking.participant_vendor_id == target.id,
                    ),
                    and_(
                        ActivityBooking.organizer_vendor_id == target.id,
                        ActivityBooking.participant_vendor_id == rel.owner_vendor_id,
                    ),
                ),
            )
            .order_by(ActivityBooking.completed_at.desc().nulls_last())
            .limit(1)
        )
    ).scalar_one_or_none()

    primary_cat = (rel.categories or target.business_categories or [None])[0]
    return {
        "id": str(rel.id),
        "relationship_kind": rel.relationship_kind,
        "label": rel.label,
        "categories": list(rel.categories or []),
        "private_note": rel.private_note,
        "notify_when_active": rel.notify_when_active,
        "completed_together_count": int(completed_together),
        "last_completed_booking_id": str(latest_booking.id) if latest_booking else (
            str(rel.last_booking_id) if rel.last_booking_id else None
        ),
        "target": {
            **vendor_summary(target),
            "area": target.physical_location,
        },
        # Freedom-of-choice deep link always accompanies every saved provider (§10.4)
        "compare_alternatives_params": {
            "category": primary_cat,
            "exclude_vendor_id": str(target.id),
        },
        "created_at": rel.created_at.isoformat(),
    }


async def list_relationships(
    db: AsyncSession,
    owner: Vendor,
    kind: Optional[str] = None,
) -> list[dict]:
    stmt = (
        select(SavedRelationship, Vendor)
        .join(Vendor, Vendor.id == SavedRelationship.target_vendor_id)
        .where(SavedRelationship.owner_vendor_id == owner.id)
        .order_by(SavedRelationship.updated_at.desc())
    )
    if kind:
        stmt = stmt.where(SavedRelationship.relationship_kind == kind.strip().lower())
    rows = (await db.execute(stmt)).all()
    return [await _serialize_relationship(db, r, t) for r, t in rows]


async def find_alternatives(
    db: AsyncSession,
    viewer: Vendor,
    category: Optional[str] = None,
    area: Optional[str] = None,
    exclude_vendor_id: Optional[UUID] = None,
    limit: int = 8,
) -> dict:
    """Compare alternatives nearby so repeat relationships never restrict choice."""
    excluded = {viewer.id}
    if exclude_vendor_id:
        excluded.add(exclude_vendor_id)
    excluded |= await blocked_vendor_ids(db, viewer.id)

    v_stmt = select(Vendor).where(Vendor.id.not_in(excluded)).limit(60)
    if area:
        v_stmt = v_stmt.where(Vendor.physical_location.ilike(f"%{area.strip()}%"))
    candidates = (await db.execute(v_stmt)).scalars().all()

    providers = []
    cat_low = (category or "").strip().lower()
    for cand in candidates:
        cats = [str(c).lower() for c in (cand.business_categories or [])]
        desc = (cand.business_description or "").lower()
        if cat_low and not (any(cat_low in c or c in cat_low for c in cats) or cat_low in desc):
            # Also check if they have an active/completed activity in that category
            act_match = (
                await db.execute(
                    select(LocalActivity.id)
                    .where(
                        LocalActivity.organizer_vendor_id == cand.id,
                        LocalActivity.category.ilike(f"%{cat_low}%"),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if not act_match:
                continue

        completed_cnt = (
            await db.execute(
                select(func.count(ActivityBooking.id)).where(
                    ActivityBooking.status == "completed",
                    or_(
                        ActivityBooking.participant_vendor_id == cand.id,
                        ActivityBooking.organizer_vendor_id == cand.id,
                    ),
                )
            )
        ).scalar() or 0
        would_repeat_cnt = (
            await db.execute(
                select(func.count(ActivityFeedback.id)).where(
                    ActivityFeedback.target_vendor_id == cand.id,
                    ActivityFeedback.would_repeat.is_(True),
                )
            )
        ).scalar() or 0
        total_fb = (
            await db.execute(
                select(func.count(ActivityFeedback.id)).where(
                    ActivityFeedback.target_vendor_id == cand.id,
                )
            )
        ).scalar() or 0

        reasons = []
        if cand.physical_location:
            reasons.append(f"Area: {cand.physical_location}")
        if completed_cnt:
            reasons.append(f"{completed_cnt} completed local booking(s)")
        if total_fb:
            reasons.append(f"{would_repeat_cnt}/{total_fb} neighbours would book again")
        if cand.business_categories:
            reasons.append(f"Categories: {', '.join(cand.business_categories[:3])}")

        providers.append(
            {
                **vendor_summary(cand),
                "area": cand.physical_location,
                "categories": list(cand.business_categories or []),
                "completed_bookings": int(completed_cnt),
                "feedback_sample_size": int(total_fb),
                "would_repeat_count": int(would_repeat_cnt),
                "reasons": reasons or ["Active on the local network"],
            }
        )
        if len(providers) >= limit:
            break

    # Also surface open Available / Scheduled activities in the same category
    open_activities = await list_activities(
        db,
        viewer=viewer,
        category=category,
        area=area,
        limit=limit,
    )
    filtered_acts = [
        a for a in open_activities["items"]
        if not exclude_vendor_id or (a.get("organizer") or {}).get("id") != str(exclude_vendor_id)
    ]
    return {
        "alternatives": providers,
        "open_activities": filtered_acts[:limit],
        "category": category,
        "area": area,
    }


async def my_reusable_records(db: AsyncSession, viewer: Vendor) -> list[dict]:
    """Completed bookings for this person/household — reusable without leaking privacy."""
    rows = (
        await db.execute(
            select(ActivityBooking, LocalActivity)
            .join(LocalActivity, LocalActivity.id == ActivityBooking.activity_id)
            .where(
                ActivityBooking.status == "completed",
                or_(
                    ActivityBooking.organizer_vendor_id == viewer.id,
                    ActivityBooking.participant_vendor_id == viewer.id,
                ),
            )
            .order_by(ActivityBooking.completed_at.desc().nulls_last())
            .limit(40)
        )
    ).all()

    counterparty_ids = {
        b.participant_vendor_id if b.organizer_vendor_id == viewer.id else b.organizer_vendor_id
        for b, _ in rows
    }
    vmap = {}
    if counterparty_ids:
        vlist = (await db.execute(select(Vendor).where(Vendor.id.in_(counterparty_ids)))).scalars().all()
        vmap = {v.id: v for v in vlist}

    out = []
    for b, act in rows:
        other_id = (
            b.participant_vendor_id if b.organizer_vendor_id == viewer.id else b.organizer_vendor_id
        )
        other = vmap.get(other_id)
        out.append(
            {
                "booking_id": str(b.id),
                "activity_id": str(act.id),
                "title": act.title,
                "posting_type": act.posting_type,
                "inferred_template": act.inferred_template,
                "category": act.category,
                "area_name": act.area_name,
                "agreed_scope": b.agreed_scope,
                "agreed_price_kes": b.agreed_price_kes,
                "settlement_method": b.settlement_method,
                "completed_at": b.completed_at.isoformat() if b.completed_at else None,
                "counterparty": vendor_summary(other),
                "household_privacy_preserved": True,
                "compare_alternatives_to": f"/explore?category={act.category or ''}",
            }
        )
    return out


async def create_watch(db: AsyncSession, viewer: Vendor, payload: dict) -> dict:
    label = (payload.get("label") or "").strip()
    ptypes = [str(p).lower() for p in (payload.get("posting_types") or []) if str(p).lower() in POSTING_TYPES]
    cats = [str(c).strip() for c in (payload.get("categories") or []) if str(c).strip()]
    keywords = (payload.get("keywords") or "").strip() or None
    area_name = (payload.get("area_name") or "").strip() or None
    only_youth = bool(payload.get("only_youth_eligible", False))

    if not (ptypes or cats or keywords or area_name or only_youth):
        raise HTTPException(422, "Choose at least one filter (posting type, category, keyword, area, or youth-eligible).")

    if not label:
        parts = ptypes + cats + ([keywords] if keywords else []) + ([area_name] if area_name else [])
        label = " · ".join(parts[:3]) or "Local watch"

    radius_km = float(payload.get("radius_km") or 10.0)
    if radius_km < 0.5 or radius_km > 200:
        raise HTTPException(422, "radius_km must be between 0.5 and 200.")

    watch = ActivityWatch(
        id=uuidlib.uuid4(),
        vendor_id=viewer.id,
        label=label[:140],
        posting_types=ptypes,
        categories=cats,
        keywords=keywords,
        area_name=area_name,
        geo_lat=float(payload["geo_lat"]) if payload.get("geo_lat") is not None else viewer.geo_lat,
        geo_lng=float(payload["geo_lng"]) if payload.get("geo_lng") is not None else viewer.geo_lng,
        radius_km=radius_km,
        days_of_week=[str(d).lower()[:3] for d in (payload.get("days_of_week") or [])],
        only_youth_eligible=only_youth,
        is_active=True,
        created_at=datetime.utcnow(),
    )
    db.add(watch)
    await db.commit()
    await db.refresh(watch)
    return serialize_watch(watch)


def serialize_watch(w: ActivityWatch) -> dict:
    return {
        "id": str(w.id),
        "label": w.label,
        "posting_types": list(w.posting_types or []),
        "categories": list(w.categories or []),
        "keywords": w.keywords,
        "area_name": w.area_name,
        "radius_km": w.radius_km,
        "days_of_week": list(w.days_of_week or []),
        "only_youth_eligible": w.only_youth_eligible,
        "is_active": w.is_active,
        "last_triggered_at": w.last_triggered_at.isoformat() if w.last_triggered_at else None,
        "created_at": w.created_at.isoformat(),
    }


async def mark_notification_acted(db: AsyncSession, viewer: Vendor, notification_id: UUID) -> dict:
    notif = await db.get(Notification, notification_id)
    if not notif or notif.recipient_id != viewer.id:
        raise HTTPException(404, "Notification not found")
    now = datetime.utcnow()
    notif.is_read = True
    notif.read_at = notif.read_at or now
    notif.acted_upon_at = notif.acted_upon_at or now
    await db.commit()
    return {"id": str(notif.id), "acted_upon_at": notif.acted_upon_at.isoformat()}


async def community_utility_metrics(db: AsyncSession, viewer: Vendor) -> dict:
    """Real utility metrics (§10) — zero time-spent or engagement-vanity counters."""
    since_30d = datetime.utcnow() - timedelta(days=30)

    successful_matches = (
        await db.execute(
            select(func.count(ActivityBooking.id)).where(ActivityBooking.status != "cancelled")
        )
    ).scalar() or 0

    requests_fulfilled = (
        await db.execute(
            select(func.count(ActivityBooking.id)).where(ActivityBooking.status == "completed")
        )
    ).scalar() or 0

    # Repeat bookings: either explicitly created via repeat (`source_booking_id`)
    # or second+ completed booking between the same organizer & participant pair.
    explicit_repeats = (
        await db.execute(
            select(func.count(ActivityBooking.id)).where(
                ActivityBooking.source_booking_id.is_not(None),
                ActivityBooking.status != "cancelled",
            )
        )
    ).scalar() or 0
    pair_rows = (
        await db.execute(
            select(
                ActivityBooking.organizer_vendor_id,
                ActivityBooking.participant_vendor_id,
                func.count(ActivityBooking.id),
            )
            .where(ActivityBooking.status == "completed")
            .group_by(ActivityBooking.organizer_vendor_id, ActivityBooking.participant_vendor_id)
        )
    ).all()
    implicit_pair_repeats = sum(max(0, int(cnt) - 1) for _, _, cnt in pair_rows)
    repeat_bookings = max(int(explicit_repeats), int(implicit_pair_repeats))

    notifications_acted_upon = (
        await db.execute(
            select(func.count(Notification.id)).where(Notification.acted_upon_at.is_not(None))
        )
    ).scalar() or 0

    resp_providers = set(
        (
            await db.execute(
                select(ActivityResponse.responder_vendor_id).where(
                    ActivityResponse.created_at >= since_30d
                )
            )
        ).scalars().all()
    )
    avail_providers = set(
        (
            await db.execute(
                select(LocalActivity.organizer_vendor_id).where(
                    LocalActivity.posting_type.in_(["available", "scheduled"]),
                    LocalActivity.created_at >= since_30d,
                )
            )
        ).scalars().all()
    )
    active_local_providers = len(resp_providers | avail_providers)

    my_active_bookings = (
        await db.execute(
            select(func.count(ActivityBooking.id)).where(
                ActivityBooking.status.in_(list(ACTIVE_DIRECTION_BOOKING_STATUSES)),
                or_(
                    ActivityBooking.organizer_vendor_id == viewer.id,
                    ActivityBooking.participant_vendor_id == viewer.id,
                ),
            )
        )
    ).scalar() or 0

    my_completed = (
        await db.execute(
            select(func.count(ActivityBooking.id)).where(
                ActivityBooking.status == "completed",
                or_(
                    ActivityBooking.organizer_vendor_id == viewer.id,
                    ActivityBooking.participant_vendor_id == viewer.id,
                ),
            )
        )
    ).scalar() or 0

    return {
        "metric_philosophy": "outcomes_not_time_spent",
        "network": {
            "successful_matches": int(successful_matches),
            "requests_fulfilled": int(requests_fulfilled),
            "repeat_bookings": int(repeat_bookings),
            "notifications_acted_upon": int(notifications_acted_upon),
            "active_local_providers_30d": int(active_local_providers),
        },
        "mine": {
            "active_bookings": int(my_active_bookings),
            "completed_records": int(my_completed),
        },
    }

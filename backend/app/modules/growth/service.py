"""Service layer for Business Pulse, 5-Gear Resources Motion, Plan Entitlements & Seats (v2.12).

Every counter returned by `live_pulse()` and `growth_blueprint()` is queried
directly from the database — never fabricated or hardcoded.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bookings import ToolBooking
from app.models.collective import CollectivePledge, CollectiveSourcingRequest
from app.models.groups import GroupMembership
from app.models.payments import PaymentIntent
from app.models.stock import MovementStatus, QualityStatus, StockItem, StockMovement
from app.models.tools import CourierShipment, ToolListing
from app.models.vendor import Vendor, vendor_connections
from app.models.vendor_list import VendorList
from app.modules.growth import rules
from app.modules.growth.models import PlanEntitlementEvent, TEAM_ROLES, VendorTeamMember
from app.modules.standing import service as standing_service
from app.modules.standing.models import BusinessClaim
from app.modules.trade.models import BusinessRequest, RequestOffer, RequestStatus, RequestWatch
from app.platform.event_outbox import emit
from app.services import stock_engine


def _record_event(
    db: AsyncSession,
    vendor_id: UUID,
    action: str,
    *,
    previous_tier: Optional[str] = None,
    new_tier: Optional[str] = None,
    actor_vendor_id: Optional[UUID] = None,
    payload: Optional[dict] = None,
) -> PlanEntitlementEvent:
    ev = PlanEntitlementEvent(
        vendor_id=vendor_id,
        action=action,
        previous_tier=previous_tier,
        new_tier=new_tier,
        actor_vendor_id=actor_vendor_id,
        payload=payload or {},
    )
    db.add(ev)
    return ev


async def seat_usage(db: AsyncSession, vendor: Vendor) -> dict:
    """Count active team seats (owner occupies seat 1; invited active members occupy the rest)."""
    active_members = (await db.execute(
        select(VendorTeamMember)
        .where(VendorTeamMember.vendor_id == vendor.id, VendorTeamMember.status == "active")
        .order_by(VendorTeamMember.created_at.asc())
    )).scalars().all()
    limit = int(getattr(vendor, "plan_seats_limit", None) or rules.plan_spec(vendor.plan_tier).max_seats)
    used = 1 + len(active_members)
    return {
        "owner_handle": vendor.vendor_handle,
        "seats_used": used,
        "seats_limit": limit,
        "seats_remaining": max(0, limit - used),
        "members": [
            {
                "id": str(m.id),
                "member_email": m.member_email,
                "member_handle": m.member_handle,
                "role": m.role,
                "status": m.status,
                "can_verify_claims": False,  # Hard-coded rule: no team seat can self-verify
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in active_members
        ],
    }


async def add_seat(
    db: AsyncSession,
    vendor: Vendor,
    *,
    member_email: str,
    role: str = "clerk",
    member_handle: Optional[str] = None,
) -> dict:
    """Invite a team seat onto the business passport/workspace, enforcing server-side seat limits."""
    role_clean = (role or "clerk").strip().lower()
    if role_clean not in TEAM_ROLES:
        raise rules.GrowthRuleError(f"role must be one of {', '.join(TEAM_ROLES)}", status=400)
    email_clean = (member_email or "").strip().lower()
    if not email_clean or "@" not in email_clean:
        raise rules.GrowthRuleError("Provide a valid member_email", status=400)
    if email_clean == (vendor.email or "").lower():
        raise rules.GrowthRuleError("The account owner already holds the primary seat", status=400)

    usage = await seat_usage(db, vendor)
    if usage["seats_used"] >= usage["seats_limit"]:
        raise rules.GrowthRuleError(
            f"Your {rules.plan_spec(vendor.plan_tier).name} plan includes {usage['seats_limit']} "
            f"seat(s) ({usage['seats_used']} in use). Upgrade your plan or revoke a seat first.",
            status=403,
        )

    existing = (await db.execute(
        select(VendorTeamMember).where(
            VendorTeamMember.vendor_id == vendor.id,
            VendorTeamMember.member_email == email_clean,
        )
    )).scalar_one_or_none()

    if existing and existing.status == "active":
        raise rules.GrowthRuleError("That team member already has an active seat", status=409)

    handle_clean = (member_handle or "").strip().lstrip("@").lower() or None
    if existing:
        existing.status = "active"
        existing.role = role_clean
        existing.member_handle = handle_clean
        existing.revoked_at = None
        seat = existing
    else:
        seat = VendorTeamMember(
            vendor_id=vendor.id,
            member_email=email_clean,
            member_handle=handle_clean,
            role=role_clean,
            status="active",
            added_by_vendor_id=vendor.id,
        )
        db.add(seat)

    await db.flush()
    _record_event(
        db, vendor.id, "seat_added",
        previous_tier=vendor.plan_tier, new_tier=vendor.plan_tier,
        actor_vendor_id=vendor.id,
        payload={"seat_id": str(seat.id), "member_email": email_clean, "role": role_clean},
    )
    await db.commit()
    return await seat_usage(db, vendor)


async def revoke_seat(db: AsyncSession, vendor: Vendor, seat_id: UUID) -> dict:
    seat = await db.get(VendorTeamMember, seat_id)
    if not seat or seat.vendor_id != vendor.id or seat.status != "active":
        raise rules.GrowthRuleError("Active team seat not found", status=404)
    seat.status = "revoked"
    seat.revoked_at = datetime.utcnow()
    _record_event(
        db, vendor.id, "seat_revoked",
        previous_tier=vendor.plan_tier, new_tier=vendor.plan_tier,
        actor_vendor_id=vendor.id,
        payload={"seat_id": str(seat.id), "member_email": seat.member_email},
    )
    await db.commit()
    return await seat_usage(db, vendor)


async def change_plan(db: AsyncSession, vendor: Vendor, target_tier: str) -> dict:
    """Switch a business's subscription tier and server-side entitlements.

    Hard-coded rule: upgrading a plan NEVER grants `vendor.is_verified` and
    NEVER approves any compliance claim on the Business Passport.
    """
    key = (target_tier or "").strip().lower()
    if key not in rules.PLAN_CATALOG:
        raise rules.GrowthRuleError(
            f"plan_tier must be one of {', '.join(rules.PLAN_CATALOG)}", status=400,
        )
    if key != "starter":
        rules.require_program_active("premium plan upgrades")

    spec = rules.PLAN_CATALOG[key]
    usage = await seat_usage(db, vendor)
    if usage["seats_used"] > spec.max_seats:
        raise rules.GrowthRuleError(
            f"You have {usage['seats_used']} active seats, which exceeds the {spec.name} limit "
            f"of {spec.max_seats}. Revoke {usage['seats_used'] - spec.max_seats} seat(s) before downgrading.",
            status=409,
        )

    watch_count = (await db.execute(
        select(func.count()).select_from(RequestWatch).where(RequestWatch.vendor_id == vendor.id)
    )).scalar() or 0
    if watch_count > spec.max_watches:
        raise rules.GrowthRuleError(
            f"You have {watch_count} saved watches, which exceeds the {spec.name} limit "
            f"of {spec.max_watches}. Delete {watch_count - spec.max_watches} watch(es) before downgrading.",
            status=409,
        )

    previous_tier = getattr(vendor, "plan_tier", None) or "starter"
    was_verified = bool(vendor.is_verified)

    vendor.plan_tier = spec.key
    vendor.plan_seats_limit = spec.max_seats
    vendor.plan_watches_limit = spec.max_watches
    vendor.plan_updated_at = datetime.utcnow()
    # Strictly preserve verification state — payment never buys verification.
    vendor.is_verified = was_verified

    _record_event(
        db, vendor.id, "plan_changed",
        previous_tier=previous_tier, new_tier=spec.key,
        actor_vendor_id=vendor.id,
        payload={
            "max_seats": spec.max_seats,
            "max_watches": spec.max_watches,
            "verification_unchanged": True,
        },
    )
    emit(db, "growth.plan.changed", {
        "vendor_id": str(vendor.id),
        "previous_tier": previous_tier,
        "new_tier": spec.key,
    })
    await db.commit()
    await db.refresh(vendor)
    return rules.entitlements_for(vendor)


async def live_pulse(db: AsyncSession, vendor: Vendor) -> dict:
    """Compute the authoritative Business Pulse and 5-Gear Resources Motion
    directly from database records."""
    # 1. Shelf & stock items
    stock_rows = (await db.execute(
        select(StockItem).where(StockItem.vendor_id == vendor.id)
    )).scalars().all()
    total_listings = len(stock_rows)
    visible_listings = sum(1 for item in stock_rows if item.visible_to_network)
    reserved_units = sum(int(item.quantity_reserved or 0) for item in stock_rows)
    available_units = sum(int(item.quantity_available or 0) for item in stock_rows)
    certified_listings = sum(
        1 for item in stock_rows
        if item.quality_status in (QualityStatus.PATRON_VERIFIED, QualityStatus.LAB_CERTIFIED)
    )
    self_declared_listings = sum(
        1 for item in stock_rows if item.quality_status == QualityStatus.SELF_DECLARED
    )

    # 2. Movements (open trades, completed, cancelled)
    movements = (await db.execute(
        select(StockMovement).where(
            or_(StockMovement.from_vendor_id == vendor.id, StockMovement.to_vendor_id == vendor.id)
        )
    )).scalars().all()
    open_statuses = {
        MovementStatus.PENDING.value,
        MovementStatus.CONFIRMED.value,
        MovementStatus.SHIPPED.value,
        "in_transit",
    }
    open_trades = sum(1 for m in movements if m.status in open_statuses)
    received_movements = sum(1 for m in movements if m.status == MovementStatus.RECEIVED.value)
    cancelled_movements = sum(1 for m in movements if m.status == MovementStatus.CANCELLED.value)

    # 3. Supplier links (connections)
    supplier_links = (await db.execute(
        select(func.count()).select_from(vendor_connections).where(
            vendor_connections.c.vendor_a_id == vendor.id
        )
    )).scalar() or 0

    # 4. Standing & Passport claims (using live claim_state so expired claims never count as verified)
    claims = (await db.execute(
        select(BusinessClaim).where(BusinessClaim.vendor_id == vendor.id)
    )).scalars().all()
    day = standing_service.today()
    claim_states = [standing_service.claim_state(c, today_=day) for c in claims]
    verified_claims = sum(1 for s in claim_states if s == "verified")
    documented_claims = sum(1 for s in claim_states if s == "documented")
    declared_claims = sum(1 for s in claim_states if s == "declared")
    expired_claims = sum(1 for s in claim_states if s == "expired")

    # 5. Watches & opportunities
    watches = (await db.execute(
        select(RequestWatch).where(RequestWatch.vendor_id == vendor.id)
    )).scalars().all()
    active_watches = sum(1 for w in watches if w.is_active)
    total_watches = len(watches)

    open_requests = (await db.execute(
        select(func.count()).select_from(BusinessRequest).where(
            BusinessRequest.requester_vendor_id == vendor.id,
            BusinessRequest.status == RequestStatus.OPEN,
        )
    )).scalar() or 0
    offers_submitted = (await db.execute(
        select(func.count()).select_from(RequestOffer).where(
            RequestOffer.responder_vendor_id == vendor.id,
        )
    )).scalar() or 0

    # 6. Collective & Groups & Lists
    groups_joined = (await db.execute(
        select(func.count()).select_from(GroupMembership).where(
            GroupMembership.vendor_id == vendor.id, GroupMembership.is_active.is_(True)
        )
    )).scalar() or 0
    collective_pledges = (await db.execute(
        select(
            func.count(CollectivePledge.id),
            func.coalesce(func.sum(CollectivePledge.pledged_quantity), 0),
        ).where(
            CollectivePledge.vendor_id == vendor.id,
            CollectivePledge.status != "withdrawn",
        )
    )).one()
    collective_organized = (await db.execute(
        select(func.count()).select_from(CollectiveSourcingRequest).where(
            CollectiveSourcingRequest.organizer_vendor_id == vendor.id
        )
    )).scalar() or 0
    lists_created = (await db.execute(
        select(func.count()).select_from(VendorList)
    )).scalar() or 0

    # 7. Tools & logistics
    tool_listings_count = (await db.execute(
        select(func.count()).select_from(ToolListing).where(ToolListing.vendor_id == vendor.id)
    )).scalar() or 0
    tool_bookings_count = (await db.execute(
        select(func.count(ToolBooking.id))
        .select_from(ToolBooking)
        .outerjoin(ToolListing, ToolListing.id == ToolBooking.tool_listing_id)
        .where(
            or_(ToolBooking.booker_vendor_id == vendor.id, ToolListing.vendor_id == vendor.id)
        )
    )).scalar() or 0
    shipments_count = (await db.execute(
        select(func.count()).select_from(CourierShipment).where(
            or_(CourierShipment.sender_vendor_id == vendor.id, CourierShipment.receiver_vendor_id == vendor.id)
        )
    )).scalar() or 0

    # 8. Capital & payments
    payment_intents_total = (await db.execute(
        select(func.count()).select_from(PaymentIntent).where(PaymentIntent.vendor_id == vendor.id)
    )).scalar() or 0
    completed_payments = (await db.execute(
        select(func.count()).select_from(PaymentIntent).where(
            PaymentIntent.vendor_id == vendor.id, PaymentIntent.status == "completed"
        )
    )).scalar() or 0

    seats = await seat_usage(db, vendor)
    entitlements = rules.entitlements_for(vendor)
    mark = stock_engine.fulfillment_mark(vendor)
    rate = stock_engine.fulfillment_rate(vendor)

    return {
        "vendor_id": str(vendor.id),
        "vendor_handle": vendor.vendor_handle,
        "business_name": vendor.business_name,
        "current_role": vendor.current_role.value if hasattr(vendor.current_role, "value") else str(vendor.current_role),
        "pulse": {
            "visible_listings": visible_listings,
            "total_listings": total_listings,
            "open_trades": open_trades,
            "completed_movements": int(vendor.movements_completed or 0),
            "cancelled_movements": int(vendor.movements_cancelled or 0),
            "received_movements_in_db": received_movements,
            "supplier_links": int(supplier_links),
            "fulfillment_rate": rate,
            "fulfillment_mark": mark,
            "verified_claims": verified_claims,
            "documented_claims": documented_claims,
            "declared_claims": declared_claims,
            "expired_claims": expired_claims,
            "active_watches": active_watches,
            "total_watches": total_watches,
            "watch_limit": entitlements["max_watches"],
            "seats_used": seats["seats_used"],
            "seats_limit": seats["seats_limit"],
            "plan_tier": entitlements["tier"],
            "network_score": round(float(vendor.network_score or 0.0), 2),
            "parasitism_index": round(float(vendor.parasitism_index or 0.0), 2),
        },
        "motions": {
            "stock_motion": {
                "label": "Gear 1 · Stock & Shelf Motion",
                "visible_listings": visible_listings,
                "total_listings": total_listings,
                "available_units": available_units,
                "reserved_units": reserved_units,
                "open_movements": open_trades,
                "completed_movements": int(vendor.movements_completed or 0),
                "certified_listings": certified_listings,
                "self_declared_listings": self_declared_listings,
            },
            "collective_motion": {
                "label": "Gear 2 · Collective & Flash Lock Motion",
                "groups_joined": int(groups_joined),
                "collective_organized": int(collective_organized),
                "active_pledges": int(collective_pledges[0] or 0),
                "pledged_units": int(collective_pledges[1] or 0),
                "market_zone_locked": bool(vendor.market_zone_id),
                "network_lists_available": int(lists_created),
            },
            "tools_logistics_motion": {
                "label": "Gear 3 · Physical Tools & Courier Motion",
                "tool_listings": int(tool_listings_count),
                "tool_bookings": int(tool_bookings_count),
                "shipments": int(shipments_count),
            },
            "opportunity_motion": {
                "label": "Gear 4 · Opportunity, Fit & Squad Motion",
                "open_requests": int(open_requests),
                "offers_submitted": int(offers_submitted),
                "active_watches": active_watches,
                "watch_limit": entitlements["max_watches"],
            },
            "capital_custody_motion": {
                "label": "Gear 5 · Capital, Custody & Chama Motion",
                "finance_mode": getattr(vendor, "finance_mode", None) or "conventional",
                "payment_intents": int(payment_intents_total),
                "completed_payments": int(completed_payments),
                "payment_delivery_independent": True,
            },
        },
        "entitlements": entitlements,
        "seats": seats,
        "program_status": rules.program_window_status(),
    }


async def growth_blueprint(db: AsyncSession, vendor: Vendor) -> dict:
    """Return the full Business Planner blueprint enriched with live DB state."""
    state = await live_pulse(db, vendor)
    p = state["pulse"]
    m = state["motions"]

    pyramid = []
    for layer in rules.INVERTED_PYRAMID_LAYERS:
        num = layer["layer"]
        if num == 1:
            active = p["visible_listings"] > 0 or p["verified_claims"] > 0
            metric = f"{p['visible_listings']} visible SKU(s) · {p['verified_claims']} verified claim(s)"
        elif num == 2:
            active = p["supplier_links"] > 0 or p["completed_movements"] > 0
            metric = f"{p['supplier_links']} supplier link(s) · {p['completed_movements']} completed movement(s)"
        elif num == 3:
            active = m["collective_motion"]["groups_joined"] > 0 or vendor.is_patron or m["collective_motion"]["active_pledges"] > 0
            metric = (
                f"{m['collective_motion']['groups_joined']} group(s) · "
                f"{m['collective_motion']['pledged_units']} unit(s) pledged · "
                f"{'Patron' if vendor.is_patron else 'Member'}"
            )
        else:
            active = p["active_watches"] > 0 or m["opportunity_motion"]["offers_submitted"] > 0
            metric = f"{p['active_watches']}/{p['watch_limit']} watch radar(s) · {m['opportunity_motion']['offers_submitted']} offer(s)"
        pyramid.append({
            **layer,
            "active": active,
            "live_metric": metric,
        })

    rollout = []
    for step in rules.SIX_MONTH_ROLLOUT:
        month = step["month"]
        if month == 1:
            ready = p["visible_listings"] > 0
        elif month == 2:
            ready = p["supplier_links"] > 0 or p["completed_movements"] > 0
        elif month == 3:
            ready = m["collective_motion"]["groups_joined"] > 0 or m["collective_motion"]["active_pledges"] > 0
        elif month == 4:
            ready = m["tools_logistics_motion"]["tool_bookings"] > 0 or m["opportunity_motion"]["open_requests"] > 0 or p["active_watches"] > 0
        elif month == 5:
            ready = m["capital_custody_motion"]["payment_intents"] > 0 or p["verified_claims"] > 0
        else:
            ready = p["completed_movements"] >= 3
        rollout.append({
            **step,
            "milestone_active": ready,
        })

    plans = [
        {
            "key": spec.key,
            "name": spec.name,
            "price_kes_monthly": spec.price_kes_monthly,
            "price_kes_annual": spec.price_kes_annual,
            "audience": spec.audience,
            "max_seats": spec.max_seats,
            "max_watches": spec.max_watches,
            "included_claim_reviews_per_quarter": spec.included_claim_reviews_per_quarter,
            "priority_verification_queue": spec.priority_verification_queue,
            "consortium_builder": spec.consortium_builder,
            "buyer_shortlists": spec.buyer_shortlists,
            "features": list(spec.features),
            "verification_guardrail": spec.verification_guardrail,
            "is_current": spec.key == p["plan_tier"],
        }
        for spec in rules.PLAN_CATALOG.values()
    ]

    return {
        **state,
        "inverted_pyramid": pyramid,
        "plans": plans,
        "verified_mark_families": [
            {
                "family": fam["family"],
                "title": fam["title"],
                "source": fam["source"],
                "marks": list(fam["marks"]),
            }
            for fam in rules.VERIFIED_MARK_FAMILIES
        ],
        "hard_coded_rules": list(rules.HARD_CODED_RULES),
        "six_month_rollout": rollout,
        "acceptance_gates": list(rules.LAUNCH_ACCEPTANCE_GATES),
    }

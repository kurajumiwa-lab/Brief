"""Second-hand passes with an atomic handover.

A confirmed pass can be re-listed once. The DB unique constraint on
`registration_id` is the double-listing lock; `EventRegistration.pass_rotation`
invalidates the seller's old code when the buyer is minted a fresh one. Money is
settled directly between the two people and is never held here.

Lock order: read the listing to learn its registration, lock the registration,
then lock the listing. That is stable against a concurrent handover and against
the booking path, which locks the event before a registration.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.events import Event, EventPassResale, EventRegistration
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.modules.town.audit import audit
from app.services.event_payments import pass_code_for
from app.services.notification_service import create_notification


def _now() -> datetime:
    return datetime.utcnow()


def _event_brief(event: Event) -> dict:
    return {
        "id": str(event.id),
        "slug": event.slug,
        "title": event.title,
        "start_date": event.start_date.isoformat(),
        "end_date": event.end_date.isoformat(),
        "location": event.location,
        "is_virtual": event.is_virtual,
        "entry_fee": event.entry_fee,
    }


def _contact(vendor: Optional[Vendor]) -> Optional[dict]:
    if vendor is None:
        return None
    return {
        "name": vendor.business_name,
        "handle": vendor.vendor_handle,
        "phone": vendor.phone,
        "email": vendor.email,
    }


def _out(row: EventPassResale, event: Event, seller: Vendor, buyer: Optional[Vendor],
         viewer: Vendor, registration: Optional[EventRegistration] = None) -> dict:
    viewer_id = viewer.id
    is_seller = row.seller_id == viewer_id
    is_buyer = row.buyer_id == viewer_id
    is_party = is_seller or is_buyer
    contact = None
    if is_party and row.buyer_id and (row.status in ("claimed", "completed")):
        contact = _contact(buyer if is_seller else seller)
    pass_code = None
    if row.status == "completed" and is_buyer and registration is not None:
        pass_code = pass_code_for(registration.id, registration.pass_rotation)
    return {
        "id": str(row.id),
        "event": _event_brief(event),
        "registration_id": str(row.registration_id),
        "seller": {"handle": seller.vendor_handle, "business": seller.business_name},
        "buyer": ({"handle": buyer.vendor_handle, "business": buyer.business_name}
                  if buyer else None),
        "price_kes": int(row.price_kes or 0),
        "note": row.note,
        "status": row.status,
        "my_role": ("seller" if is_seller else "buyer" if is_buyer else "viewer"),
        "i_confirmed": bool(row.seller_confirmed_at if is_seller else row.buyer_confirmed_at if is_buyer else None),
        "other_confirmed": bool(row.buyer_confirmed_at if is_seller else row.seller_confirmed_at if is_buyer else None),
        "seller_confirmed": bool(row.seller_confirmed_at),
        "buyer_confirmed": bool(row.buyer_confirmed_at),
        "claimed_at": row.claimed_at.isoformat() if row.claimed_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "contact": contact,
        "pass_code": pass_code,
        "can_claim": row.status == "listed" and not is_party,
        "can_confirm": row.status == "claimed" and is_party,
    }


async def eligible_passes(db: AsyncSession, vendor: Vendor) -> dict:
    """Confirmed, unused passes the signed-in vendor can still re-list."""
    now = _now()
    rows = (await db.execute(
        select(EventRegistration, Event, EventPassResale)
        .join(Event, Event.id == EventRegistration.event_id)
        .outerjoin(EventPassResale, EventPassResale.registration_id == EventRegistration.id)
        .where(
            EventRegistration.vendor_id == vendor.id,
            EventRegistration.booking_status == "CONFIRMED",
            EventRegistration.checked_in_at.is_(None),
            Event.start_date > now,
            Event.status != "cancelled",
        )
        .order_by(Event.start_date.asc())
        .limit(100)
    )).all()
    out = []
    for reg, event, resale in rows:
        out.append({
            **_event_brief(event),
            "registration_id": str(reg.id),
            "pass_code": pass_code_for(reg.id, reg.pass_rotation),
            "price_paid": float(reg.mpesa_amount or event.entry_fee or 0),
            "max_price_kes": int(float(event.entry_fee or 0)),
            "resale": ({"id": str(resale.id), "status": resale.status,
                        "price_kes": int(resale.price_kes or 0)} if resale else None),
            "can_list": resale is None,
        })
    return {
        "passes": out,
        "rule": "You can re-list a confirmed pass once, at or below the price you paid. The buyer pays you directly.",
    }


async def list_pass(db: AsyncSession, vendor: Vendor, registration_id: UUID, *,
                    price_kes: int, note: Optional[str]) -> dict:
    note = (note or "").strip()[:500] or None
    if price_kes < 0:
        raise HTTPException(422, "A resale price cannot be negative.")
    reg = (await db.execute(
        select(EventRegistration).where(EventRegistration.id == registration_id)
        .with_for_update()
    )).scalar_one_or_none()
    if reg is None or reg.vendor_id != vendor.id:
        raise HTTPException(404, "That pass was not found.")
    if reg.booking_status != "CONFIRMED":
        raise HTTPException(409, "Only a confirmed pass can be re-listed.")
    if reg.checked_in_at is not None:
        raise HTTPException(409, "That pass has already been used.")

    event = await db.get(Event, reg.event_id)
    if event is None or event.status == "cancelled":
        raise HTTPException(409, "That event was cancelled.")
    if event.start_date <= _now():
        raise HTTPException(409, "That event has already started.")

    max_price = int(float(event.entry_fee or 0))
    if price_kes > max_price:
        raise HTTPException(
            422, f"This is a {max_price:,} KES pass. Re-list at or below that price to avoid touting.",
        )
    existing = (await db.execute(
        select(EventPassResale).where(EventPassResale.registration_id == reg.id)
        .with_for_update()
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "This pass is already listed or has already been resold.")

    row = EventPassResale(
        event_id=event.id, registration_id=reg.id, seller_id=vendor.id,
        price_kes=price_kes, note=note, status="listed", created_at=_now(), updated_at=_now(),
    )
    db.add(row)
    await db.flush()
    audit(db, action="pass_listed", entity_type="event", entity_id=event.id, actor_vendor_id=vendor.id, payload={"resale_id": str(row.id), "registration_id": str(reg.id), "price_kes": price_kes})
    return _out(row, event, vendor, None, vendor, reg)


async def board(db: AsyncSession, vendor: Vendor) -> dict:
    now = _now()
    seller = aliased(Vendor)
    rows = (await db.execute(
        select(EventPassResale, Event, seller)
        .join(Event, Event.id == EventPassResale.event_id)
        .join(seller, seller.id == EventPassResale.seller_id)
        .where(
            EventPassResale.status == "listed",
            Event.start_date > now,
            Event.status != "cancelled",
        )
        .order_by(Event.start_date.asc(), EventPassResale.created_at.asc())
        .limit(100)
    )).all()
    return {
        "listings": [
            _out(row, event, owner, None, vendor)
            for row, event, owner in rows
        ],
        "note": "Every listing is one seat. Pay the seller directly; both of you confirm the handover before the pass moves.",
    }


async def mine(db: AsyncSession, vendor: Vendor) -> dict:
    seller = aliased(Vendor)
    buyer = aliased(Vendor)
    rows = (await db.execute(
        select(EventPassResale, Event, seller, buyer, EventRegistration)
        .join(Event, Event.id == EventPassResale.event_id)
        .join(seller, seller.id == EventPassResale.seller_id)
        .outerjoin(buyer, buyer.id == EventPassResale.buyer_id)
        .join(EventRegistration, EventRegistration.id == EventPassResale.registration_id)
        .where(or_(EventPassResale.seller_id == vendor.id, EventPassResale.buyer_id == vendor.id))
        .order_by(EventPassResale.created_at.desc())
        .limit(100)
    )).all()
    return {
        "sales": [_out(row, event, owner, purchaser, vendor, reg)
                  for row, event, owner, purchaser, reg in rows if row.seller_id == vendor.id],
        "purchases": [_out(row, event, owner, purchaser, vendor, reg)
                      for row, event, owner, purchaser, reg in rows if row.buyer_id == vendor.id],
    }


async def _row(db: AsyncSession, resale_id: UUID) -> tuple[EventPassResale, Event, Vendor, Optional[Vendor]]:
    row = await db.get(EventPassResale, resale_id)
    if row is None:
        raise HTTPException(404, "That resale was not found.")
    event = await db.get(Event, row.event_id)
    seller = await db.get(Vendor, row.seller_id)
    buyer = await db.get(Vendor, row.buyer_id) if row.buyer_id else None
    return row, event, seller, buyer


async def detail(db: AsyncSession, vendor: Vendor, resale_id: UUID) -> dict:
    row, event, seller, buyer = await _row(db, resale_id)
    if row.status != "listed" and vendor.id not in (row.seller_id, row.buyer_id):
        raise HTTPException(404, "That resale was not found.")
    reg = await db.get(EventRegistration, row.registration_id)
    await db.refresh(row)
    return _out(row, event, seller, buyer, vendor, reg)


async def claim(db: AsyncSession, vendor: Vendor, resale_id: UUID) -> dict:
    row, event, seller, buyer = await _row(db, resale_id)
    reg = (await db.execute(
        select(EventRegistration).where(EventRegistration.id == row.registration_id)
        .with_for_update()
    )).scalar_one_or_none()
    row = (await db.execute(
        select(EventPassResale).where(EventPassResale.id == resale_id).with_for_update()
    )).scalar_one_or_none()
    if row is None or reg is None:
        raise HTTPException(404, "That resale was not found.")
    if row.status != "listed":
        raise HTTPException(409, "Someone already claimed this pass.")
    if vendor.id == row.seller_id:
        raise HTTPException(409, "You cannot buy your own pass.")
    if reg.vendor_id != row.seller_id or reg.booking_status != "CONFIRMED":
        raise HTTPException(409, "The seller's pass is no longer valid.")
    if event.start_date <= _now():
        raise HTTPException(409, "That event has already started.")
    existing = (await db.execute(
        select(EventRegistration.id).where(
            EventRegistration.event_id == row.event_id,
            EventRegistration.vendor_id == vendor.id,
        )
    )).first()
    if existing:
        raise HTTPException(409, "You already have a booking for this event.")
    row.buyer_id = vendor.id
    row.status = "claimed"
    row.claimed_at = _now()
    row.updated_at = _now()
    await db.flush()
    await create_notification(
        db, row.seller_id, NotificationType.EVENT_REGISTRATION,
        f"Your pass for {event.title} has a buyer",
        f"{vendor.business_name} claimed it at {int(row.price_kes):,} KES. "
        "Agree how they pay you directly, then both confirm the handover.",
        sender_id=vendor.id,
        data={"event_id": str(event.id), "resale_id": str(row.id)},
    )
    audit(db, action="pass_claimed", entity_type="event", entity_id=event.id, actor_vendor_id=vendor.id, payload={"resale_id": str(row.id), "seller_id": str(row.seller_id)})
    return _out(row, event, seller, vendor, vendor, reg)


async def release(db: AsyncSession, vendor: Vendor, resale_id: UUID) -> dict:
    row, event, seller, buyer = await _row(db, resale_id)
    if row.buyer_id != vendor.id:
        raise HTTPException(403, "Only the buyer who claimed this pass can release it.")
    if row.status != "claimed":
        raise HTTPException(409, "This pass is not claimed.")
    row.buyer_id = None
    row.status = "listed"
    row.claimed_at = None
    row.updated_at = _now()
    await db.flush()
    audit(db, action="pass_claim_released", entity_type="event", entity_id=event.id, actor_vendor_id=vendor.id, payload={"resale_id": str(row.id)})
    return _out(row, event, seller, None, vendor)


async def cancel(db: AsyncSession, vendor: Vendor, resale_id: UUID) -> dict:
    row, event, seller, buyer = await _row(db, resale_id)
    if row.seller_id != vendor.id:
        raise HTTPException(403, "Only the seller can cancel this listing.")
    if row.status == "completed":
        raise HTTPException(409, "This handover is already complete.")
    if row.status == "cancelled":
        return _out(row, event, seller, buyer, vendor)
    row.status = "cancelled"
    row.cancelled_at = _now()
    row.updated_at = _now()
    if row.buyer_id:
        await create_notification(
            db, row.buyer_id, NotificationType.EVENT_REGISTRATION,
            f"The resale for {event.title} was cancelled",
            "The seller withdrew the listing. No money moved through Brief.",
            sender_id=vendor.id,
            data={"event_id": str(event.id), "resale_id": str(row.id)},
        )
    await db.flush()
    audit(db, action="pass_resale_cancelled", entity_type="event", entity_id=event.id, actor_vendor_id=vendor.id, payload={"resale_id": str(row.id)})
    return _out(row, event, seller, buyer, vendor)


async def confirm_handover(db: AsyncSession, vendor: Vendor, resale_id: UUID) -> dict:
    """One tap from each side. The second tap performs the only swap."""
    row, event, seller, buyer = await _row(db, resale_id)
    if vendor.id not in (row.seller_id, row.buyer_id):
        raise HTTPException(404, "That resale was not found.")
    if row.status == "completed":
        reg = await db.get(EventRegistration, row.registration_id)
        return _out(row, event, seller, buyer, vendor, reg)
    if row.status != "claimed":
        raise HTTPException(409, "The pass must be claimed before a handover can be confirmed.")

    reg = (await db.execute(
        select(EventRegistration).where(EventRegistration.id == row.registration_id)
        .with_for_update()
    )).scalar_one_or_none()
    row = (await db.execute(
        select(EventPassResale).where(EventPassResale.id == resale_id).with_for_update()
    )).scalar_one_or_none()
    if reg is None or row is None:
        raise HTTPException(404, "That resale was not found.")
    if row.status != "claimed" or row.buyer_id is None:
        raise HTTPException(409, "The pass is no longer claimed.")
    if reg.vendor_id != row.seller_id or reg.booking_status != "CONFIRMED":
        raise HTTPException(409, "The seller's pass is no longer valid; this handover cannot complete.")

    now = _now()
    if vendor.id == row.seller_id:
        row.seller_confirmed_at = row.seller_confirmed_at or now
    else:
        row.buyer_confirmed_at = row.buyer_confirmed_at or now
    await db.flush()

    if not (row.seller_confirmed_at and row.buyer_confirmed_at):
        audit(db, action="pass_handover_confirmed", entity_type="event", entity_id=event.id, actor_vendor_id=vendor.id, payload={"resale_id": str(row.id), "side": "seller" if vendor.id == row.seller_id else "buyer"})
        return _out(row, event, seller, buyer, vendor, reg)

    # Atomic swap: same seat, one owner. Capacity is unchanged because the
    # registration stays CONFIRMED throughout.
    reg.vendor_id = row.buyer_id
    reg.pass_rotation = int(reg.pass_rotation or 0) + 1
    reg.checked_in_at = None
    reg.status = "registered"
    reg.booking_status = "CONFIRMED"
    reg.hold_expires_at = None
    row.status = "completed"
    row.completed_at = now
    row.updated_at = now
    seller.resale_trades = int(seller.resale_trades or 0) + 1
    if buyer is not None:
        buyer.resale_trades = int(buyer.resale_trades or 0) + 1
    await db.flush()

    await create_notification(
        db, row.buyer_id, NotificationType.EVENT_REGISTRATION,
        f"Your pass for {event.title} is ready",
        "The handover is complete. Your new pass code is in Inbox — the seller's old code no longer works.",
        sender_id=row.seller_id,
        data={"event_id": str(event.id), "resale_id": str(row.id), "registration_id": str(reg.id)},
    )
    await create_notification(
        db, row.seller_id, NotificationType.EVENT_REGISTRATION,
        f"Handover complete: {event.title}",
        f"{buyer.business_name if buyer else 'The buyer'} now holds the pass. "
        "Your old code is invalid. Settle payment directly as agreed.",
        sender_id=row.buyer_id,
        data={"event_id": str(event.id), "resale_id": str(row.id)},
    )
    audit(db, action="pass_handover_completed", entity_type="event", entity_id=event.id, actor_vendor_id=vendor.id, payload={"resale_id": str(row.id), "buyer_id": str(row.buyer_id),
                 "price_kes": int(row.price_kes or 0), "rotation": reg.pass_rotation})
    return _out(row, event, seller, buyer, vendor, reg)

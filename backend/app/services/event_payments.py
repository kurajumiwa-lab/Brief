"""Paid vs. waitlist state machine for events (spec §3).

Capacity is strictly `CONFIRMED + active PENDING_PAYMENT/PAYMENT_SUBMITTED
holds < capacity`. A booking that cannot get a seat becomes WAITLISTED with a
position; when a hold expires or a seat is cancelled, the head of the
waitlist is auto-promoted to PENDING_PAYMENT with a fresh hold and an Inbox
alert. The HO-84K Trade Pass only unlocks on CONFIRMED — the agenda derives
the same code from the registration id, so the pass shown in the Inbox is
the pass the host sees.

All functions run inside the caller's transaction and flush; the caller
commits. Notifications are queued on the same session, so an alert is never
written for a booking that rolled back.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.events import Event, EventRegistration, EventMpesaCode
from app.models.notification import NotificationType
from app.models.vendor import Vendor
from app.services.mpesa_parser import parse_mpesa_sms
from app.services.notification_service import create_notification

HOLD_STATUSES = ("PENDING_PAYMENT", "PAYMENT_SUBMITTED")
ACTIVE_BOOKING_STATUSES = ("PENDING_PAYMENT", "PAYMENT_SUBMITTED", "CONFIRMED", "WAITLISTED")


def is_paid_event(event: Event) -> bool:
    """A paid event needs an explicit M-Pesa rail *and* a non-zero fee.

    Events created before this feature have a fee but no rail; treating
    those as paid would suddenly gate seats that were instant. They stay
    free (pay on arrival) until the organiser sets a Till/Paybill.
    """
    method = (event.payment_method or "FREE").upper()
    return method in ("TILL", "PAYBILL", "POCHI", "SEND_MONEY") and float(event.entry_fee or 0) > 0


def capacity(event: Event) -> int:
    """0 means unlimited (publish.py writes 0 when no capacity was given)."""
    return int(event.max_vendors or 0)


def pass_code_for(registration_id: UUID) -> str:
    """The HO-84K reference for a registration — mirrors the agenda's code.

    Derived from the record id and the server secret so it never changes
    between reloads. It is a reference the host reads against the member's
    name, not a cryptographic proof.
    """
    from app.services.receipt_rewards import VOUCHER_CODE_ALPHABET, VOUCHER_CODE_PREFIX

    digest = hmac.new(
        settings.SECRET_KEY.encode(), f"pass:{registration_id}".encode(), hashlib.sha256,
    ).digest()
    suffix = "".join(VOUCHER_CODE_ALPHABET[b % len(VOUCHER_CODE_ALPHABET)] for b in digest[:3])
    return f"{VOUCHER_CODE_PREFIX}{suffix}"


async def counts(db: AsyncSession, event: Event, now: Optional[datetime] = None) -> dict:
    """Live headcounts for one event. `occupied` is what capacity gates on."""
    now = now or datetime.utcnow()
    rows = (await db.execute(
        select(EventRegistration.booking_status, func.count(EventRegistration.id))
        .where(EventRegistration.event_id == event.id)
        .group_by(EventRegistration.booking_status)
    )).all()
    by_status = {status: int(n) for status, n in rows}
    # A PENDING_PAYMENT hold past its expiry no longer occupies a seat, even
    # before the sweep marks it EXPIRED — capacity must never gate on a dead
    # hold. PAYMENT_SUBMITTED holds do not auto-expire (the host must act).
    stale_pending = int((await db.execute(
        select(func.count(EventRegistration.id)).where(
            EventRegistration.event_id == event.id,
            EventRegistration.booking_status == "PENDING_PAYMENT",
            EventRegistration.hold_expires_at.is_not(None),
            EventRegistration.hold_expires_at <= now,
        )
    )).scalar() or 0)
    confirmed = by_status.get("CONFIRMED", 0)
    active_holds = by_status.get("PENDING_PAYMENT", 0) - stale_pending + by_status.get("PAYMENT_SUBMITTED", 0)
    waitlist = by_status.get("WAITLISTED", 0)
    occupied = confirmed + active_holds
    cap = capacity(event)
    return {
        "confirmed_count": confirmed,
        "active_holds": active_holds,
        "waitlist_count": waitlist,
        "occupied": occupied,
        "capacity": cap,
        "spots_left": max(0, cap - occupied) if cap else None,
        "is_full": bool(cap and occupied >= cap),
        "by_status": by_status,
    }


async def counts_for(db: AsyncSession, event_ids: list[UUID], now: Optional[datetime] = None) -> dict:
    """Batch counts for browse/mine lists — one grouped query, not N+1."""
    if not event_ids:
        return {}
    now = now or datetime.utcnow()
    rows = (await db.execute(
        select(
            EventRegistration.event_id,
            EventRegistration.booking_status,
            func.count(EventRegistration.id),
        )
        .where(EventRegistration.event_id.in_(event_ids))
        .group_by(EventRegistration.event_id, EventRegistration.booking_status)
    )).all()
    stale_rows = (await db.execute(
        select(EventRegistration.event_id, func.count(EventRegistration.id))
        .where(
            EventRegistration.event_id.in_(event_ids),
            EventRegistration.booking_status == "PENDING_PAYMENT",
            EventRegistration.hold_expires_at.is_not(None),
            EventRegistration.hold_expires_at <= now,
        )
        .group_by(EventRegistration.event_id)
    )).all()
    stale = {eid: int(n) for eid, n in stale_rows}
    out: dict[UUID, dict] = {}
    for eid, status, n in rows:
        bucket = out.setdefault(eid, {"CONFIRMED": 0, "PENDING_PAYMENT": 0, "PAYMENT_SUBMITTED": 0, "WAITLISTED": 0})
        if status in bucket:
            bucket[status] = int(n)
    result = {}
    for eid, bucket in out.items():
        confirmed = bucket["CONFIRMED"]
        active_holds = bucket["PENDING_PAYMENT"] - stale.get(eid, 0) + bucket["PAYMENT_SUBMITTED"]
        result[eid] = {
            "confirmed_count": confirmed,
            "active_holds": active_holds,
            "waitlist_count": bucket["WAITLISTED"],
            "occupied": confirmed + active_holds,
        }
    return result


def _hold_until(event: Event, now: datetime) -> datetime:
    return now + timedelta(minutes=int(event.hold_ttl_minutes or 120))


async def _renumber_waitlist(db: AsyncSession, event: Event) -> None:
    rows = (await db.execute(
        select(EventRegistration)
        .where(EventRegistration.event_id == event.id, EventRegistration.booking_status == "WAITLISTED")
        .order_by(EventRegistration.registered_at.asc(), EventRegistration.id.asc())
    )).scalars().all()
    for index, reg in enumerate(rows, start=1):
        reg.waitlist_position = index


async def promote_waitlist(db: AsyncSession, event: Event, now: Optional[datetime] = None) -> list[EventRegistration]:
    """Fill every free seat from the head of the waitlist. Caller commits."""
    now = now or datetime.utcnow()
    promoted: list[EventRegistration] = []
    while True:
        current = await counts(db, event, now)
        cap = current["capacity"]
        if cap and current["occupied"] >= cap:
            break
        head = (await db.execute(
            select(EventRegistration)
            .where(EventRegistration.event_id == event.id, EventRegistration.booking_status == "WAITLISTED")
            .order_by(EventRegistration.waitlist_position.asc().nulls_last(), EventRegistration.registered_at.asc())
            .limit(1)
        )).scalar_one_or_none()
        if head is None:
            break
        head.booking_status = "PENDING_PAYMENT" if is_paid_event(event) else "CONFIRMED"
        head.status = "registered"
        head.waitlist_position = None
        head.hold_expires_at = _hold_until(event, now) if is_paid_event(event) else None
        event.registered_count = (event.registered_count or 0) + 1
        await db.flush()
        promoted.append(head)
        await create_notification(
            db, head.vendor_id, NotificationType.EVENT_WAITLIST_PROMOTED,
            f"A spot opened up: {event.title}",
            (f"Your spot is held for {int(event.hold_ttl_minutes or 120)} minutes — pay via M-Pesa to confirm it."
             if is_paid_event(event) else "Your spot is confirmed. Your pass is ready in Inbox."),
            sender_id=event.organizer_id,
            data={"event_id": str(event.id), "registration_id": str(head.id)},
        )
    if promoted:
        await _renumber_waitlist(db, event)
    return promoted


async def expire_stale_holds(
    db: AsyncSession, now: Optional[datetime] = None, event_id: Optional[UUID] = None,
) -> int:
    """Expire unpaid holds and promote the waitlist. Caller commits.

    Only PENDING_PAYMENT expires: a PAYMENT_SUBMITTED note is waiting on the
    host, and expiring it would punish the guest for the host's inbox.
    """
    now = now or datetime.utcnow()
    query = select(EventRegistration).where(
        EventRegistration.booking_status == "PENDING_PAYMENT",
        EventRegistration.hold_expires_at.is_not(None),
        EventRegistration.hold_expires_at <= now,
    )
    if event_id is not None:
        query = query.where(EventRegistration.event_id == event_id)
    stale = (await db.execute(query.with_for_update())).scalars().all()
    expired = 0
    affected_events: set[UUID] = set()
    for reg in stale:
        event = await db.get(Event, reg.event_id)
        reg.booking_status = "EXPIRED"
        reg.status = "expired"
        reg.hold_expires_at = None
        reg.waitlist_position = None
        if event is not None:
            event.registered_count = max(0, (event.registered_count or 0) - 1)
            affected_events.add(event.id)
        await db.flush()
        expired += 1
        if event is not None:
            await create_notification(
                db, reg.vendor_id, NotificationType.EVENT_HOLD_EXPIRED,
                f"Your hold for {event.title} expired",
                "The payment window closed without a submitted M-Pesa note. "
                "If a seat is still free you can book again.",
                sender_id=event.organizer_id,
                data={"event_id": str(event.id), "registration_id": str(reg.id)},
            )
    for eid in affected_events:
        event = await db.get(Event, eid)
        if event is not None:
            await promote_waitlist(db, event, now)
    return expired


async def book_spot(
    db: AsyncSession, event: Event, vendor: Vendor,
    now: Optional[datetime] = None,
) -> EventRegistration:
    """Book a seat, or join the waitlist when the event is full.

    The caller has already checked the event is bookable and the vendor has
    no live registration. Free events confirm at once; paid events hold a
    seat for `hold_ttl_minutes` awaiting an M-Pesa note.
    """
    now = now or datetime.utcnow()
    # A dead hold must free its seat before we decide who gets one.
    await expire_stale_holds(db, now, event_id=event.id)

    current = await counts(db, event, now)
    if not is_paid_event(event) and not current["is_full"]:
        reg = EventRegistration(
            event_id=event.id, vendor_id=vendor.id,
            status="registered", booking_status="CONFIRMED",
            registered_at=now,
        )
        db.add(reg)
        event.registered_count = (event.registered_count or 0) + 1
        await db.flush()
        return reg

    current = await counts(db, event, now)
    cap = current["capacity"]
    if not cap or current["occupied"] < cap:
        reg = EventRegistration(
            event_id=event.id, vendor_id=vendor.id,
            status="registered", booking_status="PENDING_PAYMENT",
            hold_expires_at=_hold_until(event, now),
            registered_at=now,
        )
        db.add(reg)
        event.registered_count = (event.registered_count or 0) + 1
        await db.flush()
        return reg

    position = current["waitlist_count"] + 1
    reg = EventRegistration(
        event_id=event.id, vendor_id=vendor.id,
        status="waitlisted", booking_status="WAITLISTED",
        waitlist_position=position,
        registered_at=now,
    )
    db.add(reg)
    await db.flush()
    await create_notification(
        db, vendor.id, NotificationType.EVENT_WAITLIST_PROMOTED,
        f"You're #{position} on the waiting list for {event.title}",
        "We'll alert you here if a reserved spot opens up.",
        sender_id=event.organizer_id,
        data={"event_id": str(event.id), "registration_id": str(reg.id)},
    )
    return reg


async def submit_payment(
    db: AsyncSession, event: Event, vendor: Vendor, raw_text: str,
    now: Optional[datetime] = None,
) -> tuple[EventRegistration, dict]:
    """Attach user-declared M-Pesa evidence to a held seat.

    Returns (registration, parsed_summary). Raises HTTPException with the
    client-facing reason; the caller rolls back on HTTPException.
    """
    now = now or datetime.utcnow()
    await expire_stale_holds(db, now, event_id=event.id)
    reg = (await db.execute(
        select(EventRegistration).where(
            EventRegistration.event_id == event.id, EventRegistration.vendor_id == vendor.id,
        )
    )).scalar_one_or_none()
    if reg is None:
        raise HTTPException(404, "No booking for that event — reserve a spot first")
    if reg.booking_status == "PAYMENT_SUBMITTED":
        raise HTTPException(409, "Payment already submitted — waiting for the host to confirm")
    if reg.booking_status != "PENDING_PAYMENT":
        raise HTTPException(409, f"Nothing to pay for: booking is {reg.booking_status.lower().replace('_', ' ')}")

    expected_recipient = event.payment_recipient_name or ""
    parsed = parse_mpesa_sms(raw_text, expected_recipient, float(event.entry_fee or 0))
    if parsed.amount is not None and parsed.amount >= 100000000:
        raise HTTPException(422, "M-Pesa amount is too large")
    if not parsed.code:
        raise HTTPException(422, "No 10-character M-Pesa code found in that text. Paste the full confirmation SMS.")

    duplicate = (await db.execute(
        select(EventRegistration.id).where(
            EventRegistration.mpesa_code == parsed.code,
            EventRegistration.id != reg.id,
        )
    )).scalar_one_or_none()
    if duplicate is not None:
        raise HTTPException(409, "That M-Pesa code is already used for another booking.")

    db.add(EventMpesaCode(code=parsed.code, created_at=now))
    reg.mpesa_code = parsed.code
    reg.mpesa_amount = parsed.amount
    reg.mpesa_raw_note = (raw_text or "").strip()[:2000] or None
    reg.mpesa_submitted_at = now
    reg.mpesa_recipient_matched = parsed.recipient_matched
    reg.booking_status = "PAYMENT_SUBMITTED"
    reg.status = "registered"
    reg.hold_expires_at = _hold_until(event, now)  # hold extended while the host decides
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "That M-Pesa code is already used for another booking.")

    summary = {
        "mpesa_code": parsed.code,
        "mpesa_amount": parsed.amount,
        "recipient_matched": parsed.recipient_matched,
        "risk_level": parsed.risk_level,
        "warnings": parsed.warnings,
        "amount_matches_price": parsed.amount_matches_price,
        "amount_is_partial": parsed.amount_is_partial,
    }
    warning_line = f" Warnings: {' '.join(parsed.warnings)}" if parsed.warnings else ""
    await create_notification(
        db, event.organizer_id, NotificationType.EVENT_PAYMENT_SUBMITTED,
        f"Confirm payment for {event.title}",
        f"@{vendor.vendor_handle} submitted M-Pesa {parsed.code}"
        + (f" KSh {parsed.amount:,.0f}" if parsed.amount is not None else "")
        + f".{warning_line} Tap Confirm in Inbox to unlock their pass.",
        sender_id=vendor.id,
        data={
            "event_id": str(event.id), "registration_id": str(reg.id),
            "vendor_handle": vendor.vendor_handle, "mpesa_code": parsed.code,
            "mpesa_amount": parsed.amount, "recipient_matched": parsed.recipient_matched,
            "risk_level": parsed.risk_level, "warnings": parsed.warnings,
        },
    )
    return reg, summary


async def confirm_payment(
    db: AsyncSession, event: Event, registration_id: UUID,
) -> EventRegistration:
    """Host confirms a submitted note. This is the only path to CONFIRMED
    for a paid event, and the only moment the Trade Pass unlocks."""
    reg = await db.get(EventRegistration, registration_id)
    if reg is None or reg.event_id != event.id:
        raise HTTPException(404, "Booking not found")
    if reg.booking_status != "PAYMENT_SUBMITTED":
        raise HTTPException(409, "That booking is not waiting for payment confirmation")
    reg.booking_status = "CONFIRMED"
    reg.status = "confirmed"
    reg.hold_expires_at = None
    reg.waitlist_position = None
    await db.flush()
    await create_notification(
        db, reg.vendor_id, NotificationType.EVENT_PAYMENT_CONFIRMED,
        f"Confirmed: {event.title}",
        "The host confirmed your M-Pesa payment. Your Trade Pass is ready in Inbox.",
        sender_id=event.organizer_id,
        data={"event_id": str(event.id), "registration_id": str(reg.id)},
    )
    return reg


async def reject_payment(
    db: AsyncSession, event: Event, registration_id: UUID, reason: Optional[str] = None,
) -> EventRegistration:
    """Host rejects a note. The seat stays held (fresh hold) so the guest
    can submit a corrected code; rejected codes remain reserved against reuse."""
    reg = await db.get(EventRegistration, registration_id)
    if reg is None or reg.event_id != event.id:
        raise HTTPException(404, "Booking not found")
    if reg.booking_status != "PAYMENT_SUBMITTED":
        raise HTTPException(409, "That booking is not waiting for payment confirmation")
    reg.booking_status = "PENDING_PAYMENT"
    reg.status = "registered"
    reg.mpesa_code = None
    reg.mpesa_amount = None
    reg.mpesa_raw_note = None
    reg.mpesa_submitted_at = None
    reg.mpesa_recipient_matched = None
    reg.hold_expires_at = _hold_until(event, datetime.utcnow())
    await db.flush()
    await create_notification(
        db, reg.vendor_id, NotificationType.EVENT_PAYMENT_REJECTED,
        f"Payment not accepted for {event.title}",
        (reason or "The host could not accept that M-Pesa note.").strip()
        + " Your spot is still held — paste the correct confirmation SMS to try again.",
        sender_id=event.organizer_id,
        data={"event_id": str(event.id), "registration_id": str(reg.id)},
    )
    return reg


async def cancel_booking(
    db: AsyncSession, event: Event, reg: EventRegistration,
) -> None:
    """Cancel a live booking and promote the waitlist. Caller commits."""
    occupied = reg.booking_status in ("PENDING_PAYMENT", "PAYMENT_SUBMITTED", "CONFIRMED")
    await db.delete(reg)
    await db.flush()
    if occupied:
        event.registered_count = max(0, (event.registered_count or 0) - 1)
        await db.flush()
        await promote_waitlist(db, event)
    elif reg.booking_status == "WAITLISTED":
        await _renumber_waitlist(db, event)


async def roster(db: AsyncSession, event: Event) -> dict:
    """Live roster for the WhatsApp share button (spec §4).

    Names are business names + handles of CONFIRMED guests only. Waitlisted
    and unpaid holds are counts, never names — a roster is a headcount, not
    a leak of who hasn't paid.
    """
    current = await counts(db, event)
    rows = (await db.execute(
        select(EventRegistration, Vendor)
        .join(Vendor, Vendor.id == EventRegistration.vendor_id)
        .where(
            EventRegistration.event_id == event.id,
            EventRegistration.booking_status == "CONFIRMED",
        )
        .order_by(EventRegistration.registered_at.asc())
    )).all()
    names = [f"{v.business_name} (@{v.vendor_handle})" for _, v in rows]
    return {
        "event_id": str(event.id),
        "title": event.title,
        "confirmed_count": current["confirmed_count"],
        "capacity": current["capacity"] or None,
        "waitlist_count": current["waitlist_count"],
        "active_holds": current["active_holds"],
        "confirmed_names": names,
        "confirmed": [
            {
                "registration_id": str(r.id),
                "vendor_id": str(v.id),
                "vendor_handle": v.vendor_handle,
                "business_name": v.business_name,
            }
            for r, v in rows
        ],
    }

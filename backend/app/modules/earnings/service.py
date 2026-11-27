"""My Opportunities & Earnings — the member's economic identity, as evidence.

The strategy asks every member to see how they participate economically:
work found, work done, referrals verified, events that produced connections,
commissions that are pending versus due versus actually paid. This module
answers with rows that exist, and with a list of things it refuses to answer
rather than estimate.

Hard rules, enforced in code and copy:

* No number here is an estimate except the one labelled as one (event ticket
  value). Everything else is a count or a sum of stored rows.
* Pending is not due. Due is not paid. Points are never money and are
  always summed separately.
* "Earnings" are never asserted — the member sees evidence, in the three
  commission states, and the honest list of what cannot be measured yet.
* Nothing in this module writes. It issues SELECTs and returns a projection.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.events import Event, EventRegistration
from app.models.hustle import HustleContract
from app.models.vendor import Vendor
from app.modules.knowledge.models import KnowledgeListing
from app.modules.referrals.models import Referral as ShopReferral
from app.modules.town.models import ReferralConversion
from app.modules.trade.models import (
    BusinessRequest,
    OfferStatus,
    RequestOffer,
    RequestStatus,
)

COUNTED_EVENT_BOOKINGS = ("CONFIRMED",)


def _i(value) -> int:
    return int(value or 0)


async def _contracts(db: AsyncSession, me: UUID) -> dict[str, Any]:
    row = (
        await db.execute(
            select(
                func.count(HustleContract.id).filter(HustleContract.status == "completed"),
                func.coalesce(
                    func.sum(HustleContract.agreed_pay_kes).filter(HustleContract.status == "completed"),
                    0,
                ),
                func.count(HustleContract.id).filter(
                    HustleContract.status == "completed",
                    HustleContract.payout_status == "completed",
                ),
                func.coalesce(
                    func.sum(HustleContract.agreed_pay_kes).filter(
                        HustleContract.status == "completed",
                        HustleContract.payout_status == "completed",
                    ),
                    0,
                ),
            ).where(HustleContract.player_vendor_id == me)
        )
    ).one()
    return {
        "completed_projects": _i(row[0]),
        "agreed_value_recorded_kes": _i(row[1]),
        "payouts_recorded_count": _i(row[2]),
        "payouts_recorded_kes": _i(row[3]),
    }


async def _referral_money(db: AsyncSession, me: UUID) -> dict[str, Any]:
    """Both referral engines, one bucket each state. Never mixed with points."""
    town = (
        await db.execute(
            select(
                func.count(ReferralConversion.id).filter(ReferralConversion.status == "verified"),
                func.count(ReferralConversion.id).filter(ReferralConversion.status == "pending"),
                func.coalesce(
                    func.sum(ReferralConversion.bounty_kes).filter(ReferralConversion.status == "pending"),
                    0,
                ),
                func.coalesce(
                    func.sum(ReferralConversion.bounty_kes).filter(ReferralConversion.bounty_status == "due"),
                    0,
                ),
                func.count(ReferralConversion.id).filter(ReferralConversion.bounty_status == "due"),
                func.coalesce(
                    func.sum(ReferralConversion.bounty_kes).filter(ReferralConversion.bounty_status == "paid"),
                    0,
                ),
                func.count(ReferralConversion.id).filter(ReferralConversion.bounty_status == "paid"),
                func.coalesce(
                    func.sum(ReferralConversion.reward_points).filter(ReferralConversion.status == "verified"),
                    0,
                ),
            ).where(ReferralConversion.referrer_vendor_id == me)
        )
    ).one()
    shop = (
        await db.execute(
            select(
                func.count(ShopReferral.id).filter(ShopReferral.status == "qualified"),
                func.count(ShopReferral.id).filter(ShopReferral.status == "pending"),
                func.coalesce(
                    func.sum(ShopReferral.bounty_kes).filter(ShopReferral.status == "pending"),
                    0,
                ),
                func.coalesce(
                    func.sum(ShopReferral.bounty_kes).filter(ShopReferral.bounty_status == "due"),
                    0,
                ),
                func.count(ShopReferral.id).filter(ShopReferral.bounty_status == "due"),
                func.coalesce(
                    func.sum(ShopReferral.bounty_kes).filter(ShopReferral.bounty_status == "paid"),
                    0,
                ),
                func.count(ShopReferral.id).filter(ShopReferral.bounty_status == "paid"),
                func.coalesce(
                    func.sum(ShopReferral.reward_points).filter(ShopReferral.status == "qualified"),
                    0,
                ),
            ).where(ShopReferral.referrer_vendor_id == me)
        )
    ).one()
    return {
        "successful_referrals": _i(town[0]) + _i(shop[0]),
        "pending_count": _i(town[1]) + _i(shop[1]),
        "pending_kes": _i(town[2]) + _i(shop[2]),
        "due_kes": _i(town[3]) + _i(shop[3]),
        "due_count": _i(town[4]) + _i(shop[4]),
        "paid_kes": _i(town[5]) + _i(shop[5]),
        "paid_count": _i(town[6]) + _i(shop[6]),
        "reward_points": _i(town[7]) + _i(shop[7]),
    }


async def _events(db: AsyncSession, me: UUID) -> dict[str, Any]:
    my_events = (
        await db.execute(select(Event.id).where(Event.organizer_id == me))
    ).scalars().all()
    seats = 0
    if my_events:
        seats = _i(
            (
                await db.execute(
                    select(func.count(EventRegistration.id)).where(
                        EventRegistration.event_id.in_(my_events),
                        EventRegistration.booking_status.in_(COUNTED_EVENT_BOOKINGS),
                    )
                )
            ).scalar()
        )
    attended = _i(
        (
            await db.execute(
                select(func.count(EventRegistration.id)).where(
                    EventRegistration.vendor_id == me,
                    EventRegistration.status == "attended",
                )
            )
        ).scalar()
    )
    return {
        "hosted": len(my_events),
        "confirmed_seats": seats,
        "attended": attended,
        "event_connections": seats + attended,
    }


async def _event_value_estimate(db: AsyncSession, me: UUID) -> int:
    """Ticket price x confirmed seats, for my own events. An estimate, never
    presented as income: the host collects directly, off platform."""
    events = (
        await db.execute(
            select(Event.id, Event.entry_fee).where(
                Event.organizer_id == me,
                Event.entry_fee > 0,
            )
        )
    ).all()
    total = 0.0
    for event_id, fee in events:
        seats = _i(
            (
                await db.execute(
                    select(func.count(EventRegistration.id)).where(
                        EventRegistration.event_id == event_id,
                        EventRegistration.booking_status.in_(COUNTED_EVENT_BOOKINGS),
                    )
                )
            ).scalar()
        )
        total += float(fee or 0) * seats
    return int(total)


async def _knowledge(db: AsyncSession, me: UUID) -> dict[str, Any]:
    delivered = _i(
        (
            await db.execute(
                select(func.count(KnowledgeListing.id)).where(
                    KnowledgeListing.organiser_vendor_id == me,
                    KnowledgeListing.status == "completed",
                )
            )
        ).scalar()
    )
    published = _i(
        (
            await db.execute(
                select(func.count(KnowledgeListing.id)).where(
                    KnowledgeListing.organiser_vendor_id == me,
                    KnowledgeListing.status == "published",
                )
            )
        ).scalar()
    )
    hosted_attendees = 0
    listing_ids = (
        await db.execute(
            select(KnowledgeListing.id).where(KnowledgeListing.organiser_vendor_id == me)
        )
    ).scalars().all()
    if listing_ids:
        from app.modules.knowledge.models import KnowledgeRegistration

        hosted_attendees = _i(
            (
                await db.execute(
                    select(func.count(KnowledgeRegistration.id)).where(
                        KnowledgeRegistration.listing_id.in_(listing_ids)
                    )
                )
            ).scalar()
        )
    return {"delivered": delivered, "published": published, "attendees": hosted_attendees}


async def _active(db: AsyncSession, me: UUID) -> dict[str, Any]:
    open_requests = _i(
        (
            await db.execute(
                select(func.count(BusinessRequest.id)).where(
                    BusinessRequest.requester_vendor_id == me,
                    BusinessRequest.status == RequestStatus.OPEN,
                )
            )
        ).scalar()
    )
    pending_offers = _i(
        (
            await db.execute(
                select(func.count(RequestOffer.id)).where(
                    RequestOffer.responder_vendor_id == me,
                    RequestOffer.status == OfferStatus.OFFERED,
                )
            )
        ).scalar()
    )
    return {
        "active_opportunities": open_requests + pending_offers,
        "open_requests": open_requests,
        "pending_offers": pending_offers,
    }


async def _recent(db: AsyncSession, me: UUID) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    contracts = (
        await db.execute(
            select(HustleContract)
            .where(HustleContract.player_vendor_id == me, HustleContract.status == "completed")
            .order_by(HustleContract.completed_at.desc().nullslast())
            .limit(5)
        )
    ).scalars().all()
    for c in contracts:
        items.append({
            "id": f"contract-{c.id}",
            "kind": "project",
            "label": "Project completed (squad)",
            "amount_kes": _i(c.agreed_pay_kes),
            "status": "recorded" if c.payout_status == "completed" else "payout not confirmed",
            "occurred_at": c.completed_at.isoformat() if c.completed_at else None,
            "to": "/tasks/squad",
        })

    conversions = (
        await db.execute(
            select(ReferralConversion)
            .where(
                ReferralConversion.referrer_vendor_id == me,
                ReferralConversion.status == "verified",
            )
            .order_by(ReferralConversion.verified_at.desc().nullslast())
            .limit(5)
        )
    ).scalars().all()
    for conv in conversions:
        items.append({
            "id": f"conversion-{conv.id}",
            "kind": "referral",
            "label": "Referral verified",
            "amount_kes": _i(conv.bounty_kes),
            "status": conv.bounty_status,
            "occurred_at": conv.verified_at.isoformat() if conv.verified_at else None,
            "to": "/referral-index",
        })

    items.sort(key=lambda item: item.get("occurred_at") or "", reverse=True)
    return items[:8]


async def build(db: AsyncSession, vendor: Vendor) -> dict[str, Any]:
    me = vendor.id
    contracts = await _contracts(db, me)
    money = await _referral_money(db, me)
    events = await _events(db, me)
    event_estimate = await _event_value_estimate(db, me)
    knowledge = await _knowledge(db, me)
    active = await _active(db, me)
    recent = await _recent(db, me)

    channels = [
        {
            "key": "projects",
            "name": "Project earnings",
            "detail": f"{contracts['completed_projects']} completed on the squad board",
            "count": contracts["completed_projects"],
            "to": "/tasks/squad",
        },
        {
            "key": "referrals",
            "name": "Referral commissions",
            "detail": f"{money['successful_referrals']} verified referral(s)",
            "count": money["successful_referrals"],
            "to": "/referral-index",
        },
        {
            "key": "events",
            "name": "Event hosting",
            "detail": f"{events['hosted']} hosted · {events['confirmed_seats']} confirmed seat(s)",
            "count": events["hosted"],
            "to": "/events",
        },
        {
            "key": "partnerships",
            "name": "Partnership revenue",
            "detail": "No partnership ledger exists yet — nothing to measure honestly",
            "count": None,
            "to": "/office",
        },
        {
            "key": "knowledge",
            "name": "Consulting and mentoring",
            "detail": f"{knowledge['delivered']} completed · {knowledge['attendees']} registration(s) across your listings",
            "count": knowledge["delivered"],
            "to": "/learn",
        },
        {
            "key": "rentals",
            "name": "Resource rentals",
            "detail": "Rental availability is set on the desk; there is no single trusted count yet",
            "count": None,
            "to": "/desk",
        },
    ]

    commissions = {
        "pending_kes": money["pending_kes"],
        "pending_count": money["pending_count"],
        "due_kes": money["due_kes"],
        "due_count": money["due_count"],
        "paid_kes": money["paid_kes"],
        "paid_count": money["paid_count"],
        "reward_points": money["reward_points"],
        "project_payouts_recorded_kes": contracts["payouts_recorded_kes"],
        "project_payouts_recorded_count": contracts["payouts_recorded_count"],
        "event_value_estimate_kes": event_estimate,
    }

    not_measured = [
        {
            "what": "Cash received for project work",
            "why": "Payment happens off platform (usually direct M-Pesa). "
                   "Agreed value on completed contracts is recorded "
                   f"(KES {contracts['agreed_value_recorded_kes']:,}), and only "
                   "payouts explicitly marked completed are shown as recorded — "
                   "neither is proof of what reached your phone.",
        },
        {
            "what": "Partnership revenue",
            "why": "There is no partnership revenue table. A split agreed in chat "
                   "is a real agreement the platform cannot see.",
        },
        {
            "what": "Consulting and mentoring cash",
            "why": "Knowledge registrations record interest and attendance, not "
                   "payment. Sessions are settled between you and your client.",
        },
        {
            "what": "Event ticket revenue",
            "why": "Shown separately as an estimate (confirmed seats × entry fee). "
                   "Hosts collect directly; the platform never holds the money.",
        },
        {
            "what": "Resource rentals",
            "why": "Rental terms live on the desk. No aggregated, trustworthy "
                   "rental-earnings record exists yet.",
        },
    ]

    return {
        "summary": {
            "completed_projects": contracts["completed_projects"],
            "successful_referrals": money["successful_referrals"],
            "event_connections": events["event_connections"],
            "active_opportunities": active["active_opportunities"],
        },
        "channels": channels,
        "commissions": commissions,
        "recent": recent,
        "not_measured": not_measured,
        "note": (
            "Pending commissions become earnings only when the transaction is "
            "verified. Due means approved and awaiting direct payment. Paid "
            "means the payer recorded the payment. Reward points are not money "
            "and cannot be withdrawn."
        ),
    }

"""HTTP surface for live stock-movement transactions.

The order itself remains the canonical StockMovement row. This router adds
provider-verified payment, quoted fulfilment, explicit receipt proof, and
persisted dispute records without inventing sample amounts or statuses.
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.config import settings
from app.database import get_db
from app.models.notification import NotificationType
from app.models.payments import Disbursement, PaymentIntent, PaymentRefund
from app.models.stock import MovementStatus, StockItem, StockMovement
from app.models.tools import CourierRegistration, CourierShipment
from app.models.vendor import Vendor
from app.modules.orders.audit import ensure_order_transaction, record_movement_event
from app.modules.orders.models import DeliveryQuote, DeliveryQuoteRequest, MovementEvent, OrderDispute, OrderTransaction
from app.modules.orders.schemas import (
    DeliveryQuoteIn,
    DeliveryRequestIn,
    OrderDisputeIn,
    OrderPaymentIn,
    PickupDetailsIn,
    ReceiptCodeIn,
    ResolveDisputeIn,
    TrackingUpdateIn,
)
from app.routes.auth import get_current_vendor
from app.services import notification_service, psp_client, stock_engine
from app.services.governance import add_audit_event
from app.services.notification_service import create_notification

router = APIRouter()
log = logging.getLogger("brief.orders")


async def _load_order(
    db: AsyncSession,
    movement_id: UUID,
    vendor: Vendor,
    *,
    lock: bool = False,
    allow_fulfillment_provider: bool = False,
):
    supplier = aliased(Vendor)
    buyer = aliased(Vendor)
    stmt = (
        select(StockMovement, StockItem, supplier, buyer)
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .join(supplier, supplier.id == StockMovement.from_vendor_id)
        .join(buyer, buyer.id == StockMovement.to_vendor_id)
        .where(StockMovement.id == movement_id)
    )
    if not allow_fulfillment_provider:
        stmt = stmt.where(or_(StockMovement.from_vendor_id == vendor.id, StockMovement.to_vendor_id == vendor.id))
    if lock:
        stmt = stmt.with_for_update(of=StockMovement)
    row = (await db.execute(stmt)).first()
    if not row:
        raise HTTPException(404, "Order not found")
    movement = row[0]
    if vendor.id not in (movement.from_vendor_id, movement.to_vendor_id):
        transaction = (await db.execute(select(OrderTransaction).where(
            OrderTransaction.movement_id == movement.id,
        ))).scalar_one_or_none()
        quote = await db.get(DeliveryQuote, transaction.selected_quote_id) if transaction and transaction.selected_quote_id else None
        if (not allow_fulfillment_provider or quote is None or quote.status != "selected"
                or quote.provider_vendor_id != vendor.id
                or quote.provider_type not in ("courier", "errand", "scheduled")):
            raise HTTPException(404, "Order not found")
    return row


def _payment_readiness() -> dict:
    if not settings.TRADE_PAYMENTS_ENABLED:
        return {"enabled": False, "reason": "Order payments are not enabled for this deployment."}
    if settings.PSP_PROVIDER == "mock":
        return {"enabled": False, "reason": "The mock payment provider is active; it cannot move real money."}
    if settings.PSP_PROVIDER != "intasend" or not settings.PSP_API_KEY or not settings.PSP_API_SECRET:
        return {"enabled": False, "reason": "A live supported payment provider is not fully configured."}
    if not settings.TRADE_SETTLEMENT_ENABLED:
        return {"enabled": False, "reason": "Supplier settlement is not configured for this provider."}
    if not settings.TRADE_PSP_SUB_ACCOUNT:
        return {"enabled": False, "reason": "A provider-managed trade sub-account has not been configured."}
    return {"enabled": True, "reason": None}


async def _refund_summary(db: AsyncSession, intent: PaymentIntent | None) -> tuple[int, int, list[dict]]:
    if intent is None:
        return 0, 0, []
    rows = (await db.execute(select(PaymentRefund).where(
        PaymentRefund.payment_intent_id == intent.id,
    ).order_by(PaymentRefund.created_at.asc()))).scalars().all()
    refunded = sum(row.amount_ksh for row in rows if row.status == "completed")
    pending = sum(row.amount_ksh for row in rows if row.status == "pending")
    return int(refunded), int(pending), [{
        "id": str(row.id), "amount_ksh": row.amount_ksh, "status": row.status,
        "product_refund_ksh": row.product_refund_ksh,
        "delivery_refund_ksh": row.delivery_refund_ksh,
        "platform_fee_refund_ksh": row.platform_fee_refund_ksh,
        "reason": row.reason, "failure_reason": row.failure_reason,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    } for row in rows]


async def _order_out(
    db: AsyncSession, movement_id: UUID, vendor: Vendor, *, allow_fulfillment_provider: bool = False,
) -> dict:
    movement, item, supplier, buyer = await _load_order(
        db, movement_id, vendor, allow_fulfillment_provider=allow_fulfillment_provider,
    )
    transaction = await ensure_order_transaction(db, movement)
    quote_rows = (await db.execute(select(DeliveryQuote).where(
        DeliveryQuote.movement_id == movement.id,
    ).order_by(DeliveryQuote.created_at.desc()))).scalars().all()
    selected = await db.get(DeliveryQuote, transaction.selected_quote_id) if transaction.selected_quote_id else None
    quote_vendors = {}
    quote_verification = {}
    for quote in quote_rows:
        if quote.provider_vendor_id and quote.provider_vendor_id not in quote_vendors:
            quote_vendors[quote.provider_vendor_id] = await db.get(Vendor, quote.provider_vendor_id)
        if quote.provider_type in ("courier", "errand", "scheduled") and quote.request_id:
            request = await db.get(DeliveryQuoteRequest, quote.request_id)
            registration = await db.get(CourierRegistration, request.courier_registration_id) if request and request.courier_registration_id else None
            quote_verification[quote.id] = bool(registration and registration.is_verified)
        elif quote.provider_vendor_id:
            provider = quote_vendors.get(quote.provider_vendor_id)
            quote_verification[quote.id] = bool(provider and provider.is_verified)
        else:
            quote_verification[quote.id] = False

    intents = (await db.execute(select(PaymentIntent).where(
        PaymentIntent.entity_type == "stock_movement_payment",
        PaymentIntent.entity_id == movement.id,
        PaymentIntent.vendor_id == buyer.id,
    ).order_by(PaymentIntent.created_at.desc()).limit(1))).scalars().first()
    refund_total, refund_pending_total, refunds = await _refund_summary(db, intents)
    if intents is None:
        payment_status = "unpaid"
    elif intents.status == "pending":
        payment_status = "processing"
    elif intents.status == "failed":
        payment_status = "failed"
    elif intents.status == "refunded" or refund_total >= intents.amount_ksh:
        payment_status = "refunded"
    elif refund_pending_total:
        payment_status = "refund_processing"
    elif refund_total:
        payment_status = "partially_refunded"
    else:
        payment_status = "paid"

    delivery_requests = (await db.execute(select(DeliveryQuoteRequest).where(
        DeliveryQuoteRequest.movement_id == movement.id,
    ).order_by(DeliveryQuoteRequest.created_at.desc()))).scalars().all()
    event_rows = (await db.execute(select(MovementEvent).where(
        MovementEvent.movement_id == movement.id,
    ).order_by(MovementEvent.created_at.asc(), MovementEvent.id.asc()))).scalars().all()
    shipments = (await db.execute(select(CourierShipment).where(
        CourierShipment.movement_id == movement.id,
    ).order_by(CourierShipment.created_at.asc()))).scalars().all()
    disputes = (await db.execute(select(OrderDispute).where(
        OrderDispute.movement_id == movement.id,
    ).order_by(OrderDispute.created_at.desc()))).scalars().all()
    payouts = (await db.execute(select(Disbursement).where(
        Disbursement.entity_type.in_(("movement_settlement", "movement_delivery")),
        Disbursement.entity_id == movement.id,
    ).order_by(Disbursement.created_at.asc()))).scalars().all()

    fee = int(transaction.platform_fee_ksh or 0)
    delivery_fee = int(selected.price_ksh) if selected else None
    total = int(transaction.product_amount_ksh + fee + delivery_fee) if delivery_fee is not None else None
    is_fulfillment_provider = vendor.id not in (supplier.id, buyer.id)
    visible_quotes = [quote for quote in quote_rows if not is_fulfillment_provider or quote.id == transaction.selected_quote_id]
    visible_delivery_requests = [] if is_fulfillment_provider else delivery_requests
    visible_payouts = [
        payout for payout in payouts
        if not is_fulfillment_provider or payout.entity_type == "movement_delivery"
    ]
    visible_disputes = [
        dispute for dispute in disputes
        if not is_fulfillment_provider or dispute.opened_by_vendor_id == vendor.id
    ]
    visible_events = [
        event for event in event_rows
        if not is_fulfillment_provider or event.event_type in (
            "dispatch_marked", "delivery_tracking_created", "tracking_update", "order_received",
        )
    ]
    supplier_call = supplier.phone if vendor.id == buyer.id and supplier.allow_direct_calls else None
    buyer_call = buyer.phone if vendor.id == supplier.id and buyer.allow_direct_calls else None

    return {
        "id": str(movement.id),
        "status": movement.status,
        "direction": "fulfillment" if is_fulfillment_provider else "incoming" if vendor.id == buyer.id else "outgoing",
        "created_at": movement.created_at.isoformat() if movement.created_at else None,
        "confirmed_at": movement.confirmed_at.isoformat() if movement.confirmed_at else None,
        "shipped_at": movement.shipped_at.isoformat() if movement.shipped_at else None,
        "completed_at": movement.completed_at.isoformat() if movement.completed_at else None,
        "hold_expires_at": None,
        "notes": None if is_fulfillment_provider else movement.notes,
        "stock_item_id": str(item.id),
        "stock_name": item.name,
        "sku": item.sku,
        "images": item.images or [],
        "quantity": movement.quantity,
        "unit_of_measure": item.unit_of_measure,
        "unit_price": None if is_fulfillment_provider else movement.unit_price,
        "product_total_ksh": None if is_fulfillment_provider else transaction.product_amount_ksh,
        "supplier": {
            "id": str(supplier.id), "business_name": supplier.business_name,
            "handle": supplier.vendor_handle, "location": supplier.physical_location,
            "is_verified": supplier.is_verified,
            "allow_direct_calls": bool(supplier.allow_direct_calls),
            "call_phone": supplier_call,
        },
        "buyer": {
            "id": str(buyer.id), "business_name": buyer.business_name,
            "handle": buyer.vendor_handle, "location": buyer.physical_location,
            "is_verified": buyer.is_verified,
            "allow_direct_calls": bool(buyer.allow_direct_calls),
            "call_phone": buyer_call,
        },
        "terms": {
            "product_amount_ksh": None if is_fulfillment_provider else transaction.product_amount_ksh,
            "delivery_amount_ksh": delivery_fee,
            "platform_fee_ksh": None if is_fulfillment_provider else fee,
            "total_amount_ksh": None if is_fulfillment_provider else total,
            "delivery_mode": selected.provider_type if selected else None,
            "destination_address": transaction.destination_address,
            "currency": "KES",
        },
        "pickup": {
            "address": transaction.pickup_address,
            "hours": transaction.pickup_hours,
            "instructions": transaction.pickup_instructions,
            "ready_for_collection": transaction.ready_for_collection,
            "ready_at": transaction.pickup_ready_at.isoformat() if transaction.pickup_ready_at else None,
        },
        "selected_quote_id": str(transaction.selected_quote_id) if transaction.selected_quote_id else None,
        "delivery_quotes": [{
            "id": str(quote.id), "provider_type": quote.provider_type,
            "provider_name": quote.provider_name,
            "provider_vendor_id": str(quote.provider_vendor_id) if quote.provider_vendor_id else None,
            "provider_handle": quote_vendors[quote.provider_vendor_id].vendor_handle
                if quote.provider_vendor_id in quote_vendors else None,
            "provider_verified": quote_verification.get(quote.id, False),
            "price_ksh": quote.price_ksh, "eta_text": quote.eta_text,
            "pickup_address": quote.pickup_address,
            "destination_address": quote.destination_address,
            "ready_for_collection": quote.ready_for_collection,
            "collection_instructions": quote.collection_instructions,
            "scheduled_start": quote.scheduled_start.isoformat() if quote.scheduled_start else None,
            "scheduled_end": quote.scheduled_end.isoformat() if quote.scheduled_end else None,
            "note": quote.note, "status": quote.status,
            "expires_at": quote.expires_at.isoformat() if quote.expires_at else None,
            "created_at": quote.created_at.isoformat() if quote.created_at else None,
        } for quote in visible_quotes],
        "delivery_requests": [{
            "id": str(request.id), "provider_type": request.provider_type,
            "courier_registration_id": str(request.courier_registration_id) if request.courier_registration_id else None,
            "destination_address": request.destination_address,
            "scheduled_start": request.scheduled_start.isoformat() if request.scheduled_start else None,
            "scheduled_end": request.scheduled_end.isoformat() if request.scheduled_end else None,
            "customer_note": request.customer_note, "status": request.status,
            "created_at": request.created_at.isoformat() if request.created_at else None,
        } for request in visible_delivery_requests],
        "tracking": {
            "updates": [{
                "status": event.payload.get("status"),
                "note": event.payload.get("note"),
                "tracking_reference": event.payload.get("tracking_reference"),
                "tracking_url": event.payload.get("tracking_url"),
                "created_at": event.created_at.isoformat() if event.created_at else None,
            } for event in event_rows if event.event_type == "tracking_update"],
            "shipments": [{
                "id": str(shipment.id), "tracking_number": shipment.tracking_number,
                "status": shipment.status, "origin": shipment.origin,
                "destination": shipment.destination, "courier_name": (
                    (await db.get(CourierRegistration, shipment.courier_id)).courier_name
                    if shipment.courier_id else None
                ),
                "status_history": shipment.status_history or [],
                "created_at": shipment.created_at.isoformat() if shipment.created_at else None,
                "delivered_at": shipment.delivered_at.isoformat() if shipment.delivered_at else None,
            } for shipment in shipments],
        },
        "payment": {
            "status": payment_status,
            "intent_id": None if is_fulfillment_provider else str(intents.id) if intents else None,
            "provider": intents.provider if intents and not is_fulfillment_provider else None,
            "amount_ksh": intents.amount_ksh if intents and not is_fulfillment_provider else None,
            "reference": intents.psp_api_ref if intents and not is_fulfillment_provider else None,
            "receipt": intents.mpesa_receipt if intents and not is_fulfillment_provider else None,
            "failure_reason": intents.failure_reason if intents and not is_fulfillment_provider else None,
            "created_at": intents.created_at.isoformat() if intents and intents.created_at and not is_fulfillment_provider else None,
            "verified_at": intents.completed_at.isoformat() if intents and intents.completed_at and intents.status in ("completed", "refunded") and not is_fulfillment_provider else None,
            "refunded_amount_ksh": None if is_fulfillment_provider else refund_total,
            "refund_pending_amount_ksh": None if is_fulfillment_provider else refund_pending_total,
            "refunds": [] if is_fulfillment_provider else refunds,
            "availability": None if is_fulfillment_provider else _payment_readiness(),
        },
        "settlement": {
            "status": transaction.settlement_status,
            "payouts": [{
                "id": str(payout.id), "type": payout.entity_type, "amount_ksh": payout.amount_ksh,
                "status": payout.status, "failure_reason": payout.failure_reason,
                "created_at": payout.created_at.isoformat() if payout.created_at else None,
                "completed_at": payout.completed_at.isoformat() if payout.completed_at else None,
            } for payout in visible_payouts],
        },
        "events": [{
            "id": str(event.id), "type": event.event_type,
            "created_at": event.created_at.isoformat() if event.created_at else None,
            "payload": event.payload or {},
        } for event in visible_events],
        "disputes": [{
            "id": str(dispute.id), "category": dispute.category, "description": dispute.description,
            "status": dispute.status, "outcome": dispute.outcome,
            "resolution_note": dispute.resolution_note,
            "created_at": dispute.created_at.isoformat() if dispute.created_at else None,
            "resolved_at": dispute.resolved_at.isoformat() if dispute.resolved_at else None,
        } for dispute in visible_disputes],
        "transaction_id": str(transaction.id),
    }


def _has_active_dispute(db: AsyncSession, movement_id: UUID):
    return select(OrderDispute.id).where(
        OrderDispute.movement_id == movement_id,
        OrderDispute.status.in_(("open", "in_review")),
    ).limit(1)


async def _active_payment(db: AsyncSession, movement_id: UUID, buyer_id: UUID):
    return (await db.execute(select(PaymentIntent).where(
        PaymentIntent.entity_type == "stock_movement_payment",
        PaymentIntent.entity_id == movement_id,
        PaymentIntent.vendor_id == buyer_id,
        PaymentIntent.status.in_(("pending", "completed")),
    ).order_by(PaymentIntent.created_at.desc()).limit(1))).scalar_one_or_none()


@router.get("/support/disputes")
async def support_order_disputes(
    status: str = Query("active", pattern="^(active|open|in_review|resolved|all)$"),
    limit: int = Query(100, ge=1, le=500),
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Market-ops case queue; order counterparties cannot enumerate other cases."""
    if settings.market_ops_role(vendor.vendor_handle) not in ("admin", "clerk"):
        raise HTTPException(403, "Only configured platform support staff can view order disputes")

    supplier = aliased(Vendor)
    buyer = aliased(Vendor)
    opener = aliased(Vendor)
    stmt = (
        select(OrderDispute, StockMovement, StockItem, supplier, buyer, opener, OrderTransaction)
        .join(StockMovement, StockMovement.id == OrderDispute.movement_id)
        .join(StockItem, StockItem.id == StockMovement.stock_item_id)
        .join(supplier, supplier.id == StockMovement.from_vendor_id)
        .join(buyer, buyer.id == StockMovement.to_vendor_id)
        .join(opener, opener.id == OrderDispute.opened_by_vendor_id)
        .outerjoin(OrderTransaction, OrderTransaction.movement_id == StockMovement.id)
    )
    if status == "active":
        stmt = stmt.where(OrderDispute.status.in_(("open", "in_review")))
    elif status != "all":
        stmt = stmt.where(OrderDispute.status == status)
    rows = (await db.execute(stmt.order_by(
        OrderDispute.created_at.desc(), OrderDispute.id.desc(),
    ).limit(limit))).all()
    movement_ids = [row[1].id for row in rows]
    latest_payments = {}
    active_payout_ids = set()
    if movement_ids:
        intents = (await db.execute(select(PaymentIntent).where(
            PaymentIntent.entity_type == "stock_movement_payment",
            PaymentIntent.entity_id.in_(movement_ids),
        ).order_by(PaymentIntent.created_at.desc(), PaymentIntent.id.desc()))).scalars().all()
        for intent in intents:
            latest_payments.setdefault(intent.entity_id, intent)
        active_payout_ids = set((await db.execute(select(Disbursement.entity_id).where(
            Disbursement.entity_type.in_(("movement_settlement", "movement_delivery")),
            Disbursement.entity_id.in_(movement_ids),
            Disbursement.status.in_(("pending_approval", "approved", "queued", "completed")),
        ))).scalars().all())

    result = []
    for dispute, movement, item, order_supplier, order_buyer, opened_by, transaction in rows:
        payment = latest_payments.get(movement.id)
        quote = await db.get(DeliveryQuote, transaction.selected_quote_id) if transaction and transaction.selected_quote_id else None
        refunded, refund_pending, _refunds = await _refund_summary(db, payment)
        payment_status = payment.status if payment else "unpaid"
        result.append({
            "id": str(dispute.id),
            "movement_id": str(movement.id),
            "category": dispute.category,
            "description": dispute.description,
            "status": dispute.status,
            "outcome": dispute.outcome,
            "resolution_note": dispute.resolution_note,
            "created_at": dispute.created_at.isoformat() if dispute.created_at else None,
            "resolved_at": dispute.resolved_at.isoformat() if dispute.resolved_at else None,
            "opened_by": {"business_name": opened_by.business_name, "handle": opened_by.vendor_handle},
            "order": {
                "status": movement.status,
                "stock_name": item.name,
                "sku": item.sku,
                "quantity": movement.quantity,
                "unit_of_measure": item.unit_of_measure,
                "supplier": {"business_name": order_supplier.business_name, "handle": order_supplier.vendor_handle},
                "buyer": {"business_name": order_buyer.business_name, "handle": order_buyer.vendor_handle},
                "product_amount_ksh": transaction.product_amount_ksh if transaction else None,
                "delivery_amount_ksh": quote.price_ksh if quote else None,
                "platform_fee_ksh": transaction.platform_fee_ksh if transaction else None,
                "total_amount_ksh": (
                    transaction.product_amount_ksh + transaction.platform_fee_ksh + quote.price_ksh
                    if transaction and quote else None
                ),
                "delivery_mode": quote.provider_type if quote else None,
                "settlement_status": transaction.settlement_status if transaction else "not_started",
            },
            "payment": {
                "status": payment_status,
                "provider": payment.provider if payment else None,
                "amount_ksh": payment.amount_ksh if payment else None,
                "reference": payment.psp_api_ref if payment else None,
                "refunded_amount_ksh": refunded,
                "refund_pending_amount_ksh": refund_pending,
                "remaining_refundable_ksh": max(0, payment.amount_ksh - refunded - refund_pending) if payment else 0,
            },
            "payout_started": movement.id in active_payout_ids,
        })
    return result


@router.get("/delivery-requests/inbox")
async def delivery_quote_inbox(
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    """Open requests addressed to this supplier or one of their courier listings."""
    courier_ids = list((await db.execute(select(CourierRegistration.id).where(
        CourierRegistration.vendor_id == vendor.id,
    ))).scalars().all())
    requests = (await db.execute(select(DeliveryQuoteRequest).where(
        DeliveryQuoteRequest.status == "open",
        or_(
            DeliveryQuoteRequest.provider_type == "supplier_delivery",
            DeliveryQuoteRequest.courier_registration_id.in_(courier_ids) if courier_ids else False,
        ),
    ).order_by(DeliveryQuoteRequest.created_at.asc()).limit(100))).scalars().all()
    out = []
    for request in requests:
        movement = await db.get(StockMovement, request.movement_id)
        if not movement:
            continue
        if request.provider_type == "supplier_delivery":
            if movement.from_vendor_id != vendor.id:
                continue
            provider_name = vendor.business_name
        else:
            registration = await db.get(CourierRegistration, request.courier_registration_id)
            if not registration or registration.vendor_id != vendor.id:
                continue
            provider_name = registration.courier_name
        item = await db.get(StockItem, movement.stock_item_id)
        buyer = await db.get(Vendor, movement.to_vendor_id)
        transaction = (await db.execute(select(OrderTransaction).where(
            OrderTransaction.movement_id == movement.id,
        ))).scalar_one_or_none()
        out.append({
            "id": str(request.id), "movement_id": str(movement.id),
            "provider_type": request.provider_type, "provider_name": provider_name,
            "stock_name": item.name if item else "Order",
            "quantity": movement.quantity, "unit_of_measure": item.unit_of_measure if item else "units",
            "buyer_handle": buyer.vendor_handle if buyer else None,
            "buyer_business": buyer.business_name if buyer else None,
            "pickup_address": transaction.pickup_address if transaction else None,
            "destination_address": request.destination_address,
            "scheduled_start": request.scheduled_start.isoformat() if request.scheduled_start else None,
            "scheduled_end": request.scheduled_end.isoformat() if request.scheduled_end else None,
            "customer_note": request.customer_note, "created_at": request.created_at.isoformat(),
        })
    return out


@router.get("/{movement_id}")
async def order_detail(
    movement_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, *_ = await _load_order(db, movement_id, vendor, allow_fulfillment_provider=True)
    await ensure_order_transaction(db, movement)
    await db.commit()
    return await _order_out(db, movement_id, vendor, allow_fulfillment_provider=True)


@router.put("/{movement_id}/pickup")
async def set_pickup_details(
    movement_id: UUID,
    body: PickupDetailsIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, _item, supplier, buyer = await _load_order(db, movement_id, vendor, lock=True)
    if vendor.id != supplier.id:
        raise HTTPException(403, "Only the supplier confirms the pickup address and readiness")
    if movement.status not in (MovementStatus.PENDING.value, MovementStatus.CONFIRMED.value):
        raise HTTPException(409, "Pickup details are locked after dispatch")
    transaction = await ensure_order_transaction(db, movement)
    if await _active_payment(db, movement.id, buyer.id):
        raise HTTPException(409, "Delivery terms cannot change while payment is pending or paid")

    old_details = (
        transaction.pickup_address, transaction.pickup_hours,
        transaction.pickup_instructions, bool(transaction.ready_for_collection),
    )
    new_details = (
        body.address.strip(), body.pickup_hours.strip() if body.pickup_hours else None,
        body.instructions.strip() if body.instructions else None, bool(body.ready_for_collection),
    )
    details_changed = old_details != new_details
    transaction.pickup_address, transaction.pickup_hours, transaction.pickup_instructions, transaction.ready_for_collection = new_details
    if not transaction.ready_for_collection:
        transaction.pickup_ready_at = None
    elif details_changed or transaction.pickup_ready_at is None:
        transaction.pickup_ready_at = datetime.utcnow()

    open_requests = []
    if details_changed:
        quotes = (await db.execute(select(DeliveryQuote).where(
            DeliveryQuote.movement_id == movement.id,
            DeliveryQuote.status.in_(("offered", "selected")),
        ))).scalars().all()
        for quote in quotes:
            quote.status = "expired"
        open_requests = (await db.execute(select(DeliveryQuoteRequest).where(
            DeliveryQuoteRequest.movement_id == movement.id,
            DeliveryQuoteRequest.status.in_(("open", "quoted")),
        ))).scalars().all()
        for request in open_requests:
            request.status = "cancelled"
        transaction.selected_quote_id = None
        transaction.delivery_mode = None
        transaction.destination_address = None
        transaction.receipt_code_hash = None
        transaction.receipt_code_expires_at = None

    pickup_quote = (await db.execute(select(DeliveryQuote).where(
        DeliveryQuote.movement_id == movement.id,
        DeliveryQuote.provider_type == "self_pickup",
        DeliveryQuote.provider_vendor_id == supplier.id,
        DeliveryQuote.status != "expired",
    ).order_by(DeliveryQuote.created_at.desc()).limit(1))).scalar_one_or_none()
    if pickup_quote is None:
        pickup_quote = DeliveryQuote(
            movement_id=movement.id, provider_vendor_id=supplier.id,
            provider_type="self_pickup", provider_name=supplier.business_name, price_ksh=0,
        )
        db.add(pickup_quote)
    pickup_quote.provider_name = supplier.business_name
    pickup_quote.price_ksh = 0
    pickup_quote.pickup_address = transaction.pickup_address
    pickup_quote.ready_for_collection = transaction.ready_for_collection
    pickup_quote.collection_instructions = transaction.pickup_instructions
    pickup_quote.eta_text = transaction.pickup_hours
    if transaction.selected_quote_id != pickup_quote.id:
        pickup_quote.status = "offered"

    if details_changed:
        record_movement_event(db, movement.id, "pickup_details_confirmed", actor_vendor_id=vendor.id,
                              payload={"ready_for_collection": transaction.ready_for_collection})
        if quotes or open_requests:
            await create_notification(
                db, buyer.id, NotificationType.DELIVERY_QUOTE_REQUEST,
                "Pickup details changed — review fulfilment again",
                "Existing pickup or delivery options were withdrawn so you can confirm the latest location and readiness.",
                sender_id=vendor.id,
                data={"movement_id": str(movement.id)},
            )
    await db.commit()
    return await _order_out(db, movement.id, vendor)


@router.post("/{movement_id}/delivery-requests", status_code=201)
async def request_delivery_quote(
    movement_id: UUID,
    body: DeliveryRequestIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, _item, supplier, buyer = await _load_order(db, movement_id, vendor, lock=True)
    if vendor.id != buyer.id:
        raise HTTPException(403, "Only the customer requests delivery quotes")
    if movement.status != MovementStatus.CONFIRMED.value:
        raise HTTPException(409, "The supplier must confirm the order before delivery is arranged")
    transaction = await ensure_order_transaction(db, movement)
    if not transaction.pickup_address:
        raise HTTPException(409, "Ask the supplier to confirm the exact pickup address first")
    if await _active_payment(db, movement.id, buyer.id):
        raise HTTPException(409, "Delivery terms cannot change while payment is pending or paid")

    courier = None
    recipient = supplier
    if body.courier_registration_id:
        courier = await db.get(CourierRegistration, body.courier_registration_id)
        if not courier:
            raise HTTPException(404, "Delivery provider not found")
        recipient = await db.get(Vendor, courier.vendor_id)
        if recipient is None or recipient.id in (buyer.id, supplier.id):
            raise HTTPException(400, "Choose a separate registered delivery provider")

    existing = (await db.execute(select(DeliveryQuoteRequest.id).where(
        DeliveryQuoteRequest.movement_id == movement.id,
        DeliveryQuoteRequest.requester_vendor_id == buyer.id,
        DeliveryQuoteRequest.courier_registration_id == body.courier_registration_id,
        DeliveryQuoteRequest.provider_type == body.provider_type,
        DeliveryQuoteRequest.status == "open",
    ).limit(1))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "A quote request is already open with this provider")

    request = DeliveryQuoteRequest(
        movement_id=movement.id,
        requester_vendor_id=buyer.id,
        courier_registration_id=body.courier_registration_id,
        provider_type=body.provider_type,
        destination_address=body.destination_address.strip(),
        scheduled_start=body.scheduled_start,
        scheduled_end=body.scheduled_end,
        customer_note=body.customer_note.strip() if body.customer_note else None,
    )
    db.add(request)
    await db.flush()
    transaction.destination_address = body.destination_address.strip()
    record_movement_event(db, movement.id, "delivery_quote_requested", actor_vendor_id=buyer.id,
                          payload={"request_id": str(request.id), "provider_type": body.provider_type})
    await create_notification(
        db, recipient.id, NotificationType.DELIVERY_QUOTE_REQUEST,
        f"Delivery quote requested for {movement.quantity} units",
        f"@{buyer.vendor_handle} needs a {body.provider_type.replace('_', ' ')} quote for {body.destination_address.strip()[:180]}",
        sender_id=buyer.id,
        data={"movement_id": str(movement.id), "delivery_request_id": str(request.id)},
    )
    await db.commit()
    return {"id": str(request.id), "status": request.status, "provider_type": request.provider_type}


@router.post("/delivery-requests/{request_id}/quote", status_code=201)
async def answer_delivery_quote(
    request_id: UUID,
    body: DeliveryQuoteIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    request = await db.get(DeliveryQuoteRequest, request_id, with_for_update=True)
    if not request or request.status != "open":
        raise HTTPException(404, "Open delivery quote request not found")
    movement = await db.get(StockMovement, request.movement_id, with_for_update=True)
    if not movement or movement.status != MovementStatus.CONFIRMED.value:
        raise HTTPException(409, "This order is no longer accepting delivery quotes")
    transaction = await ensure_order_transaction(db, movement)
    if request.provider_type == "supplier_delivery":
        if vendor.id != movement.from_vendor_id:
            raise HTTPException(403, "Only the supplier can quote supplier delivery")
        provider_name = (await db.get(Vendor, vendor.id)).business_name
        provider_vendor_id = vendor.id
    else:
        registration = await db.get(CourierRegistration, request.courier_registration_id)
        if not registration or registration.vendor_id != vendor.id:
            raise HTTPException(403, "Only the requested delivery provider can submit this quote")
        provider_name = registration.courier_name
        provider_vendor_id = vendor.id
    if not transaction.pickup_address:
        raise HTTPException(409, "The supplier has not confirmed an exact pickup address")

    quote = DeliveryQuote(
        movement_id=movement.id,
        request_id=request.id,
        provider_vendor_id=provider_vendor_id,
        provider_type=request.provider_type,
        provider_name=provider_name,
        price_ksh=body.price_ksh,
        eta_text=body.eta_text.strip() if body.eta_text else None,
        pickup_address=transaction.pickup_address,
        destination_address=request.destination_address,
        ready_for_collection=transaction.ready_for_collection,
        collection_instructions=transaction.pickup_instructions,
        scheduled_start=request.scheduled_start,
        scheduled_end=request.scheduled_end,
        note=body.note.strip() if body.note else None,
    )
    db.add(quote)
    request.status = "quoted"
    record_movement_event(db, movement.id, "delivery_quote_received", actor_vendor_id=vendor.id,
                          payload={"quote_id": str(quote.id), "request_id": str(request.id)})
    await create_notification(
        db, request.requester_vendor_id, NotificationType.DELIVERY_QUOTE_REQUEST,
        f"A delivery quote is ready: KSh {body.price_ksh:,}",
        body.eta_text or "Review the quote and total before choosing.",
        sender_id=vendor.id,
        data={"movement_id": str(movement.id), "delivery_quote_id": str(quote.id)},
    )
    await db.commit()
    return {"id": str(quote.id), "status": quote.status, "price_ksh": quote.price_ksh}


@router.post("/{movement_id}/delivery-quotes/{quote_id}/select")
async def select_delivery_quote(
    movement_id: UUID,
    quote_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, _item, _supplier, buyer = await _load_order(db, movement_id, vendor, lock=True)
    if vendor.id != buyer.id:
        raise HTTPException(403, "Only the customer chooses a delivery option")
    if movement.status != MovementStatus.CONFIRMED.value:
        raise HTTPException(409, "Delivery must be decided before the supplier dispatches")
    transaction = await ensure_order_transaction(db, movement)
    if await _active_payment(db, movement.id, buyer.id):
        raise HTTPException(409, "A delivery option cannot change while payment is pending or paid")
    quote = await db.get(DeliveryQuote, quote_id, with_for_update=True)
    if not quote or quote.movement_id != movement.id or quote.status not in ("offered", "selected"):
        raise HTTPException(404, "Available delivery quote not found")
    if quote.expires_at and quote.expires_at <= datetime.utcnow():
        quote.status = "expired"
        await db.commit()
        raise HTTPException(409, "This delivery quote has expired; request a fresh quote")
    if not quote.pickup_address or quote.pickup_address != transaction.pickup_address:
        raise HTTPException(409, "The supplier has not confirmed the current pickup address; review an updated option")
    if not transaction.ready_for_collection or not quote.ready_for_collection:
        raise HTTPException(409, "The supplier has not marked the order ready for collection or hand-off")
    if quote.provider_type != "self_pickup" and not quote.destination_address:
        raise HTTPException(409, "This delivery quote has no confirmed destination")

    if transaction.selected_quote_id and transaction.selected_quote_id != quote.id:
        previous = await db.get(DeliveryQuote, transaction.selected_quote_id)
        if previous and previous.status == "selected":
            previous.status = "offered"
    quote.status = "selected"
    transaction.selected_quote_id = quote.id
    transaction.delivery_mode = quote.provider_type
    transaction.destination_address = quote.destination_address
    transaction.receipt_code_hash = None
    transaction.receipt_code_expires_at = None
    record_movement_event(db, movement.id, "delivery_selected", actor_vendor_id=buyer.id,
                          payload={"quote_id": str(quote.id), "provider_type": quote.provider_type})
    await db.commit()
    return await _order_out(db, movement.id, vendor)


@router.post("/{movement_id}/receipt-code")
async def create_receipt_code(
    movement_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, _item, _supplier, buyer = await _load_order(db, movement_id, vendor, lock=True)
    if vendor.id != buyer.id:
        raise HTTPException(403, "Only the customer can generate the receipt code")
    if movement.status != MovementStatus.SHIPPED.value:
        raise HTTPException(409, "The receipt code is available after dispatch")
    transaction = await ensure_order_transaction(db, movement)
    if not transaction.selected_quote_id:
        raise HTTPException(409, "Choose a fulfilment option first")
    code = f"{secrets.randbelow(1_000_000):06d}"
    transaction.receipt_code_hash = hashlib.sha256(code.encode()).hexdigest()
    transaction.receipt_code_expires_at = datetime.utcnow() + timedelta(hours=24)
    record_movement_event(db, movement.id, "receipt_code_issued", actor_vendor_id=buyer.id)
    await db.commit()
    # The secret is returned only to the buyer and is never present on GET.
    return {"receipt_code": code, "expires_at": transaction.receipt_code_expires_at.isoformat()}


@router.post("/{movement_id}/receive")
async def confirm_order_receipt(
    movement_id: UUID,
    body: ReceiptCodeIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, _item, _supplier, _buyer = await _load_order(
        db, movement_id, vendor, lock=True, allow_fulfillment_provider=True,
    )
    try:
        await stock_engine.transition(db, movement, "receive", vendor, receipt_code=body.receipt_code)
    except stock_engine.StockError as exc:
        raise HTTPException(exc.status_code, str(exc))
    await db.commit()
    try:
        from app.modules.orders.settlement import start_order_settlement
        await start_order_settlement(db, movement.id)
        await db.commit()
    except Exception:
        await db.rollback()
        log.exception("receipt was saved but settlement could not be queued for order %s", movement.id)
    return await _order_out(db, movement.id, vendor, allow_fulfillment_provider=True)


@router.post("/{movement_id}/tracking")
async def update_supplier_delivery_tracking(
    movement_id: UUID,
    body: TrackingUpdateIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, _item, supplier, buyer = await _load_order(db, movement_id, vendor, lock=True)
    transaction = await ensure_order_transaction(db, movement)
    quote = await db.get(DeliveryQuote, transaction.selected_quote_id) if transaction.selected_quote_id else None
    if movement.status != MovementStatus.SHIPPED.value:
        raise HTTPException(409, "Tracking updates are available after dispatch")
    if quote is None or quote.provider_type != "supplier_delivery" or quote.provider_vendor_id != vendor.id:
        raise HTTPException(403, "Only the selected supplier-delivery provider can update this tracking")

    previous = (await db.execute(select(MovementEvent).where(
        MovementEvent.movement_id == movement.id,
        MovementEvent.event_type == "tracking_update",
    ).order_by(MovementEvent.created_at.desc()).limit(1))).scalars().first()
    progression = {"picked_up": 0, "in_transit": 1, "out_for_delivery": 2}
    prior_status = (previous.payload or {}).get("status") if previous else None
    if body.status != "delivery_issue" and prior_status in progression:
        if progression[body.status] < progression[prior_status]:
            raise HTTPException(409, "Tracking cannot move backwards")

    payload = {
        "status": body.status,
        "note": body.note.strip() if body.note else None,
        "tracking_reference": body.tracking_reference.strip() if body.tracking_reference else None,
        "tracking_url": body.tracking_url,
    }
    record_movement_event(db, movement.id, "tracking_update", actor_vendor_id=vendor.id, payload=payload)
    await create_notification(
        db, buyer.id, NotificationType.SHIPMENT_UPDATE,
        f"Order delivery: {body.status.replace('_', ' ')}",
        payload["note"] or "The supplier updated the delivery progress.",
        sender_id=vendor.id,
        data={"movement_id": str(movement.id), "status": body.status},
    )
    await db.commit()
    return await _order_out(db, movement.id, vendor)


@router.post("/{movement_id}/payments", status_code=202)
async def initiate_order_payment(
    movement_id: UUID,
    body: OrderPaymentIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, _item, supplier, buyer = await _load_order(db, movement_id, vendor, lock=True)
    if vendor.id != buyer.id:
        raise HTTPException(403, "Only the customer pays for this order")
    if movement.status != MovementStatus.CONFIRMED.value:
        raise HTTPException(409, "Supplier confirmation is required before payment")
    readiness = _payment_readiness()
    if not readiness["enabled"]:
        raise HTTPException(503, readiness["reason"])
    transaction = await ensure_order_transaction(db, movement)
    if transaction.selected_quote_id is None:
        raise HTTPException(409, "Choose a delivery option and review the full total before paying")
    if await db.scalar(_has_active_dispute(db, movement.id)):
        raise HTTPException(409, "This order has an open dispute")
    if not supplier.phone:
        raise HTTPException(409, "Supplier has not configured a payout phone")

    quote = await db.get(DeliveryQuote, transaction.selected_quote_id)
    if (quote is None or quote.status != "selected"
            or quote.pickup_address != transaction.pickup_address
            or not transaction.ready_for_collection or not quote.ready_for_collection):
        raise HTTPException(409, "Selected fulfilment terms are no longer available; review the current pickup details and quote")
    if quote.expires_at and quote.expires_at <= datetime.utcnow():
        raise HTTPException(409, "The selected quote expired. Choose a fresh pickup or delivery option before paying")
    if quote.provider_type in ("courier", "errand", "scheduled"):
        courier = await db.get(Vendor, quote.provider_vendor_id) if quote.provider_vendor_id else None
        if courier is None or not courier.phone:
            raise HTTPException(409, "Delivery provider has not configured a payout phone")
    if await _active_payment(db, movement.id, buyer.id):
        raise HTTPException(409, "A verified or pending payment already exists for this order")
    previous_intent = (await db.execute(select(PaymentIntent).where(
        PaymentIntent.entity_type == "stock_movement_payment",
        PaymentIntent.entity_id == movement.id,
        PaymentIntent.vendor_id == buyer.id,
    ).order_by(PaymentIntent.created_at.desc()).limit(1))).scalars().first()
    if previous_intent and previous_intent.status == "refunded":
        raise HTTPException(409, "This order was fully refunded. Create a new order rather than charging it again.")

    total = int(transaction.product_amount_ksh + transaction.platform_fee_ksh + quote.price_ksh)
    if total <= 0 or total > settings.COLLECT_PER_TRANSACTION_LIMIT_KSH:
        raise HTTPException(400, "The order total is outside the configured payment limit")
    try:
        from app.services.payments import PaymentError, create_collection_intent, start_collection

        record_movement_event(db, movement.id, "payment_requested", actor_vendor_id=buyer.id,
                              payload={"amount_ksh": total})
        intent = await create_collection_intent(
            db, buyer,
            entity_type="stock_movement_payment",
            entity_id=movement.id,
            amount_ksh=total,
            target_psp_sub=settings.TRADE_PSP_SUB_ACCOUNT,
            provider=body.provider,
            phone=body.phone,
        )
        await start_collection(db, intent)
    except PaymentError as exc:
        raise HTTPException(400, str(exc))
    except psp_client.PSPError as exc:
        raise HTTPException(502, f"Payment provider could not start this request: {exc}")
    return {
        "intent_id": str(intent.id), "status": intent.status,
        "amount_ksh": intent.amount_ksh, "provider": intent.provider,
        "reference": intent.psp_api_ref,
        "message": "Payment request sent. Paid status appears only after the provider callback is verified.",
    }


@router.post("/{movement_id}/disputes", status_code=201)
async def open_order_dispute(
    movement_id: UUID,
    body: OrderDisputeIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    movement, _item, supplier, buyer = await _load_order(
        db, movement_id, vendor, lock=True, allow_fulfillment_provider=True,
    )
    is_fulfillment_provider = vendor.id not in (supplier.id, buyer.id)
    if is_fulfillment_provider and body.category != "delivery_failure":
        raise HTTPException(403, "A selected delivery provider can only report a delivery failure")
    if movement.status == MovementStatus.CANCELLED.value and body.category not in ("cancellation", "payment_problem", "other"):
        raise HTTPException(409, "A cancelled order can only report a cancellation or payment issue")
    existing = await db.scalar(_has_active_dispute(db, movement.id))
    if existing:
        raise HTTPException(409, "This order already has an open support case")

    dispute = OrderDispute(
        movement_id=movement.id, opened_by_vendor_id=vendor.id,
        category=body.category, description=body.description.strip(),
    )
    db.add(dispute)
    transaction = await ensure_order_transaction(db, movement)
    active_payout = await db.scalar(select(Disbursement.id).where(
        Disbursement.entity_type.in_(("movement_settlement", "movement_delivery")),
        Disbursement.entity_id == movement.id,
        Disbursement.status.in_(("pending_approval", "approved", "queued", "completed")),
    ).limit(1))
    if not active_payout and transaction.settlement_status not in ("settled", "refunded"):
        transaction.settlement_status = "blocked_by_dispute"
    record_movement_event(db, movement.id, "dispute_opened", actor_vendor_id=vendor.id,
                          payload={"dispute_id": str(dispute.id), "category": body.category})

    # Notify the configured support operators. If none are configured, the
    # case is still durably stored and visible to both counterparties.
    handles = []
    for entry in (settings.MARKET_OPS_ROLES or "").split(","):
        role, sep, handle = entry.strip().partition(":")
        if sep and role.strip() in ("admin", "clerk") and handle.strip():
            handles.append(handle.strip().lower())
    if handles:
        operators = (await db.execute(select(Vendor).where(Vendor.vendor_handle.in_(handles)))).scalars().all()
        for operator in operators:
            await create_notification(
                db, operator.id, NotificationType.PAYMENT_UPDATE,
                f"Order dispute: {body.category.replace('_', ' ')}",
                f"@{vendor.vendor_handle} opened a case for order {str(movement.id)[:8]}.",
                sender_id=vendor.id,
                data={"movement_id": str(movement.id), "dispute_id": str(dispute.id), "support_case": True},
            )
    await db.commit()
    return {"id": str(dispute.id), "status": dispute.status, "funds_frozen": False,
            "message": "Support case recorded. A dispute report does not itself freeze or reverse a payment."}


@router.post("/{movement_id}/disputes/{dispute_id}/resolve")
async def resolve_order_dispute(
    movement_id: UUID,
    dispute_id: UUID,
    body: ResolveDisputeIn,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    if settings.market_ops_role(vendor.vendor_handle) not in ("admin", "clerk"):
        raise HTTPException(403, "Only configured platform support staff can resolve order disputes")
    movement = await db.get(StockMovement, movement_id, with_for_update=True)
    dispute = await db.get(OrderDispute, dispute_id, with_for_update=True)
    if not movement or not dispute or dispute.movement_id != movement_id:
        raise HTTPException(404, "Order dispute not found")
    if dispute.status == "resolved":
        raise HTTPException(409, "This dispute is already resolved")
    if dispute.outcome == "refund_pending":
        raise HTTPException(409, "A provider refund is already in progress for this case")
    transaction = await ensure_order_transaction(db, movement)

    if body.outcome == "release":
        dispute.status = "resolved"
        dispute.outcome = "released"
        dispute.resolution_note = body.resolution_note.strip()
        dispute.resolved_by_vendor_id = vendor.id
        dispute.resolved_at = datetime.utcnow()
        if transaction.settlement_status == "blocked_by_dispute":
            transaction.settlement_status = "not_started"
        record_movement_event(db, movement.id, "dispute_resolved", actor_vendor_id=vendor.id,
                              payload={"dispute_id": str(dispute.id), "outcome": "released"})
        await db.flush()
        if movement.status == MovementStatus.RECEIVED.value:
            from app.modules.orders.settlement import start_order_settlement
            await start_order_settlement(db, movement.id)
        await db.commit()
        return {"id": str(dispute.id), "status": dispute.status, "outcome": dispute.outcome}

    payment = (await db.execute(select(PaymentIntent).where(
        PaymentIntent.entity_type == "stock_movement_payment",
        PaymentIntent.entity_id == movement.id,
        PaymentIntent.status.in_(("completed", "refunded")),
    ).order_by(PaymentIntent.created_at.desc()).limit(1))).scalar_one_or_none()
    if not payment:
        raise HTTPException(409, "There is no provider-verified payment to refund")
    existing_payout = await db.scalar(select(Disbursement.id).where(
        Disbursement.entity_type.in_(("movement_settlement", "movement_delivery")),
        Disbursement.entity_id == movement.id,
        Disbursement.status.in_(("pending_approval", "approved", "queued", "completed")),
    ).limit(1))
    if existing_payout:
        raise HTTPException(409, "A supplier or courier payout has started; support must reconcile it before refunding")

    from app.services.payments import PaymentError, request_refund
    refund_total, refund_pending_total, prior_refunds = await _refund_summary(db, payment)
    if refund_pending_total:
        raise HTTPException(409, "A provider refund is already processing for this payment")
    completed_rows = [row for row in prior_refunds if row["status"] == "completed"]
    product_used = sum(row["product_refund_ksh"] for row in completed_rows)
    delivery_used = sum(row["delivery_refund_ksh"] for row in completed_rows)
    fee_used = sum(row["platform_fee_refund_ksh"] for row in completed_rows)
    selected = await db.get(DeliveryQuote, transaction.selected_quote_id) if transaction.selected_quote_id else None
    if selected is None:
        raise HTTPException(409, "The paid order has no selected fulfilment quote to reconcile")
    product_remaining = max(0, transaction.product_amount_ksh - product_used)
    delivery_remaining = max(0, selected.price_ksh - delivery_used)
    fee_remaining = max(0, transaction.platform_fee_ksh - fee_used)
    refundable = max(0, payment.amount_ksh - refund_total)
    components_remaining = product_remaining + delivery_remaining + fee_remaining
    if refundable != components_remaining:
        raise HTTPException(409, "Recorded refund allocations do not reconcile; support must review the payment ledger")

    product_refund = body.refund_product_ksh
    delivery_refund = body.refund_delivery_ksh
    fee_refund = body.refund_platform_fee_ksh
    if body.refund_amount_ksh is None and not any((product_refund, delivery_refund, fee_refund)):
        # An unspecified refund means return all remaining paid components.
        product_refund, delivery_refund, fee_refund = product_remaining, delivery_remaining, fee_remaining
    refund_amount = body.refund_amount_ksh or (product_refund + delivery_refund + fee_refund)
    if refund_amount <= 0 or refund_amount > refundable:
        raise HTTPException(400, "Refund exceeds the remaining provider-verified payment")
    if (product_refund + delivery_refund + fee_refund != refund_amount
            or product_refund > product_remaining
            or delivery_refund > delivery_remaining
            or fee_refund > fee_remaining):
        raise HTTPException(400, "Refund component amounts must fit within the remaining recorded order components")

    product_after = product_remaining - product_refund
    delivery_after = delivery_remaining - delivery_refund
    fee_after = fee_remaining - fee_refund
    supplier_after = (product_after + delivery_after - fee_after
                      if selected.provider_type == "supplier_delivery" else product_after - fee_after)
    if supplier_after < 0:
        raise HTTPException(400, "This allocation would make the supplier settlement negative; adjust the component amounts")

    dispute.status = "in_review"
    dispute.outcome = "refund_pending"
    dispute.resolution_note = body.resolution_note.strip()
    dispute.resolved_by_vendor_id = vendor.id
    transaction.settlement_status = "refund_pending"
    try:
        refund = await request_refund(
            db, payment, amount_ksh=refund_amount, reason=body.resolution_note,
            product_refund_ksh=product_refund,
            delivery_refund_ksh=delivery_refund,
            platform_fee_refund_ksh=fee_refund,
        )
    except PaymentError as exc:
        dispute.status = "open"
        dispute.outcome = "refund_failed"
        dispute.resolved_by_vendor_id = None
        transaction.settlement_status = "blocked_by_dispute"
        await db.commit()
        raise HTTPException(502, str(exc))
    return {"id": str(dispute.id), "status": dispute.status,
            "outcome": dispute.outcome, "refund_id": str(refund.id), "refund_status": refund.status,
            "refund_amount_ksh": refund.amount_ksh,
            "allocation": {"product_ksh": refund.product_refund_ksh,
                           "delivery_ksh": refund.delivery_refund_ksh,
                           "platform_fee_ksh": refund.platform_fee_refund_ksh}}


@router.post("/{movement_id}/settlement/retry")
async def retry_order_settlement(
    movement_id: UUID,
    vendor: Vendor = Depends(get_current_vendor),
    db: AsyncSession = Depends(get_db),
):
    if settings.market_ops_role(vendor.vendor_handle) not in ("admin", "clerk"):
        raise HTTPException(403, "Only configured platform support staff can retry a payout")
    movement = await db.get(StockMovement, movement_id, with_for_update=True)
    if movement is None:
        raise HTTPException(404, "Order not found")
    if movement.status != MovementStatus.RECEIVED.value:
        raise HTTPException(409, "Payouts can only be retried after receipt is confirmed")
    transaction = await ensure_order_transaction(db, movement)
    if not settings.TRADE_SETTLEMENT_ENABLED or not settings.TRADE_PSP_SUB_ACCOUNT:
        raise HTTPException(503, "A provider-managed settlement account is not configured")
    if transaction.settlement_status not in ("failed", "unavailable"):
        raise HTTPException(409, "This order has no failed or unavailable settlement to retry")
    if await db.scalar(_has_active_dispute(db, movement.id)):
        raise HTTPException(409, "Resolve the active order dispute before retrying settlement")
    from app.modules.orders.settlement import start_order_settlement
    await start_order_settlement(db, movement.id, retry_failed=True)
    await db.commit()
    await db.refresh(transaction)
    return {"movement_id": str(movement.id), "settlement_status": transaction.settlement_status}

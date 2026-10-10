"""
Stock Engine — what happens to shelves when vendors deal with each other.

A sourcing request reserves stock on the supplier's shelf (a `StockReservation`
hold, v2.1 §3.4). The movement then walks pending → confirmed → shipped →
received (or → cancelled at any point before it is received). On `received`
the supplier's shelf is debited, the buyer's shelf is credited with a
`network_transfer` item, and the parasitism engine re-scores the pair. On
`cancelled` the reservation is released. Unconfirmed holds lapse after
RESERVATION_HOLD_HOURS (`expire_stale_holds`, run by the scheduler).

Every step notifies the other side (v2.1 §2.3) and refreshes the supplier's
SRM-lite metrics (§4.4). Callers commit.
"""

import secrets
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.modules.orders.audit import ensure_order_transaction, record_movement_event
from app.modules.orders.models import DeliveryQuote, DeliveryQuoteRequest, OrderDispute, OrderTransaction
from app.models.notification import NotificationType
from app.models.stock import MovementStatus, StockItem, StockMovement, StockReservation, StockSource
from app.models.tools import CourierRegistration, CourierShipment
from app.models.vendor import Vendor
from app.services import notification_service, parasitism_engine, performance_service


class StockError(Exception):
    """A rule of the shelf was broken. Routes translate this to HTTP 400/403."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def recompute_available(item: StockItem) -> None:
    item.quantity_available = max(0, (item.quantity_in_stock or 0) - (item.quantity_reserved or 0))


# --- pricing ------------------------------------------------------------------------

def base_unit_price(item: StockItem) -> float:
    """Network price for a line: wholesale when set, else the unit price."""
    return float(item.wholesale_price or item.unit_price or 0.0)


def tier_for(item: StockItem, quantity: int) -> Optional[dict]:
    """The best matching bulk tier: `[{"qty": 100, "discount": 10}, ...]`
    (discount in %; a `price` key sets an absolute unit price instead)."""
    best = None
    for tier in item.bulk_discount_tiers or []:
        try:
            threshold = int(float(tier.get("qty") or 0))
        except (TypeError, ValueError, AttributeError):
            continue
        if threshold <= 0 or quantity < threshold:
            continue
        if best is None or threshold > int(float(best.get("qty") or 0)):
            best = tier
    return best


def effective_unit_price(item: StockItem, quantity: int) -> float:
    """Price per unit at this quantity once bulk tiers apply (v2.1 §3.3)."""
    base = base_unit_price(item)
    tier = tier_for(item, quantity)
    if not tier:
        return round(base, 2)
    if tier.get("price") not in (None, ""):
        try:
            return round(float(tier["price"]), 2)
        except (TypeError, ValueError):
            return round(base, 2)
    try:
        discount = float(tier.get("discount") or 0)
    except (TypeError, ValueError):
        discount = 0.0
    return round(base * (1 - max(0.0, min(discount, 100.0)) / 100), 2)


def fulfillment_rate(vendor: Vendor) -> Optional[float]:
    """Share of confirmed movements this vendor delivered (None until there is a sample)."""
    done = int(getattr(vendor, "movements_completed", 0) or 0)
    lost = int(getattr(vendor, "movements_cancelled", 0) or 0)
    if done + lost == 0:
        return None
    return round(100.0 * done / (done + lost), 1)


# --- sourcing -----------------------------------------------------------------------

async def request_sourcing(
    db: AsyncSession, item: StockItem, buyer: Vendor,
    quantity: int, proposed_price: Optional[float], notes: Optional[str],
    confirmed: bool = False,
) -> StockMovement:
    """Reserve `quantity` of `item` for `buyer`. `confirmed=True` is for deals
    both sides already agreed to in chat: the movement starts at `confirmed`."""
    if item.vendor_id == buyer.id:
        raise StockError("Can't source from yourself")
    if not item.visible_to_network:
        raise StockError("This stock is not offered to the network", 403)
    if quantity <= 0:
        raise StockError("Quantity must be positive")
    if quantity < item.min_order_quantity:
        raise StockError(f"Minimum order: {item.min_order_quantity}")
    if item.quantity_available < quantity:
        raise StockError(f"Only {item.quantity_available} available")

    unit_price = proposed_price if proposed_price is not None else effective_unit_price(item, quantity)
    now = datetime.utcnow()
    movement = StockMovement(
        stock_item_id=item.id,
        from_vendor_id=item.vendor_id,
        to_vendor_id=buyer.id,
        quantity=quantity,
        unit_price=unit_price,
        total_value=round(unit_price * quantity, 2),
        movement_type="sourcing",
        status=MovementStatus.CONFIRMED.value if confirmed else MovementStatus.PENDING.value,
        notes=notes,
        confirmed_at=now if confirmed else None,
    )
    item.quantity_reserved += quantity
    recompute_available(item)
    db.add(movement)
    await db.flush()  # movement.id for the hold and the notification deep link
    await ensure_order_transaction(db, movement)
    record_movement_event(db, movement.id, "order_requested", actor_vendor_id=buyer.id)
    if confirmed:
        record_movement_event(db, movement.id, "supplier_confirmed", actor_vendor_id=item.vendor_id,
                              payload={"confirmed_in_chat": True})

    db.add(StockReservation(
        stock_item_id=item.id, reserving_vendor_id=buyer.id, movement_id=movement.id,
        quantity=quantity, agreed_price=unit_price, status="held",
        hold_expires_at=now + timedelta(hours=settings.RESERVATION_HOLD_HOURS),
    ))

    if not confirmed:
        await notification_service.create_notification(
            db, item.vendor_id, NotificationType.SOURCE_REQUEST,
            f"@{buyer.vendor_handle} wants {quantity} {item.unit_of_measure} of {item.name}",
            f"At {unit_price:g} per {item.unit_of_measure} · total {movement.total_value:g}"
            + (f" · “{notes}”" if notes else "") + f" · hold {settings.RESERVATION_HOLD_HOURS}h",
            sender_id=buyer.id,
            data={"movement_id": movement.id, "stock_id": item.id, "vendor_handle": buyer.vendor_handle,
                  "direction": "outgoing"},
        )
    return movement


async def _hold_for(db: AsyncSession, movement_id: UUID) -> Optional[StockReservation]:
    return (await db.execute(select(StockReservation).where(
        StockReservation.movement_id == movement_id, StockReservation.status == "held",
    ))).scalars().first()


async def _resolve_hold(db: AsyncSession, movement: StockMovement, status: str) -> None:
    hold = await _hold_for(db, movement.id)
    if hold is not None:
        hold.status = status
        hold.resolved_at = datetime.utcnow()


_TRANSITIONS = {
    "confirm": (MovementStatus.PENDING, MovementStatus.CONFIRMED, "supplier"),
    "ship": (MovementStatus.CONFIRMED, MovementStatus.SHIPPED, "supplier"),
    "receive": (MovementStatus.SHIPPED, MovementStatus.RECEIVED, "buyer"),
}


async def transition(db: AsyncSession, movement: StockMovement, action: str, actor: Vendor,
                     reason: Optional[str] = None, receipt_code: Optional[str] = None) -> StockMovement:
    """Advance a movement. Supplier confirms and ships; buyer receives; either
    side may cancel before receipt."""
    item = await db.get(StockItem, movement.stock_item_id)
    if item is None:
        raise StockError("Stock item no longer exists", 404)

    if action == "cancel":
        if actor.id not in (movement.from_vendor_id, movement.to_vendor_id):
            raise StockError("Not your movement", 403)
        if movement.status == MovementStatus.SHIPPED.value:
            transaction = (await db.execute(select(OrderTransaction).where(
                OrderTransaction.movement_id == movement.id,
            ))).scalar_one_or_none()
            quote = await db.get(DeliveryQuote, transaction.selected_quote_id) if transaction and transaction.selected_quote_id else None
            if quote is None or quote.provider_type != "self_pickup":
                raise StockError("This order has been dispatched. Open a support case so the provider, stock and payment can be reconciled before cancellation.", 409)
        if movement.status == MovementStatus.RECEIVED.value:
            raise StockError("Already received; open a dispute if something is wrong")
        if movement.status == MovementStatus.CANCELLED.value:
            return movement
        from app.models.payments import PaymentIntent
        active_payment = (await db.execute(select(PaymentIntent.id).where(
            PaymentIntent.entity_type == "stock_movement_payment",
            PaymentIntent.entity_id == movement.id,
            PaymentIntent.status.in_(("pending", "completed")),
        ).limit(1))).scalar_one_or_none()
        if active_payment:
            raise StockError("A payment is pending or verified. Resolve it or open a dispute before cancelling.", 409)
        await _cancel(db, movement, item, actor.id, reason or "cancelled", actor)
        await performance_service.recalculate(db, movement.from_vendor_id)
        return movement

    if action not in _TRANSITIONS:
        raise StockError(f"Unknown action '{action}'")
    expected, nxt, side = _TRANSITIONS[action]
    if movement.status != expected.value:
        raise StockError(f"Movement is '{movement.status}', expected '{expected.value}' to {action}")

    order_transaction = await ensure_order_transaction(db, movement)
    selected_quote = None
    if action in ("ship", "receive"):
        if not order_transaction.selected_quote_id:
            raise StockError("The customer must choose pickup or a delivery quote before travel.", 409)
        selected_quote = await db.get(DeliveryQuote, order_transaction.selected_quote_id)
        if selected_quote is None or selected_quote.status != "selected":
            raise StockError("The selected fulfilment option is no longer available.", 409)
        if not order_transaction.pickup_address or not order_transaction.ready_for_collection:
            raise StockError("The supplier must confirm the exact pickup address and mark the order ready first.", 409)
        if selected_quote.pickup_address != order_transaction.pickup_address:
            raise StockError("Pickup details changed. Ask the customer to review the fulfilment options again.", 409)
        if not selected_quote.ready_for_collection:
            raise StockError("The selected option predates the supplier's ready confirmation. Review it again.", 409)
        if action == "ship" and selected_quote.expires_at and selected_quote.expires_at <= datetime.utcnow():
            raise StockError("The selected delivery quote has expired. Ask the customer to choose a fresh quote.", 409)
        if selected_quote.provider_type != "self_pickup" and not selected_quote.destination_address:
            raise StockError("The selected delivery option has no confirmed destination.", 409)

    owner = movement.from_vendor_id if side == "supplier" else movement.to_vendor_id
    if action == "receive":
        # A one-time code generated by the buyer and entered by the chosen
        # fulfilment provider is the proof-of-receipt step. The buyer cannot
        # mark their own order as received just by pressing a button.
        if selected_quote is None or actor.id != selected_quote.provider_vendor_id:
            raise StockError("Only the selected supplier or courier can confirm receipt with the buyer's code.", 403)
    elif actor.id != owner:
        raise StockError(f"Only the {side} can {action} this movement", 403)

    if action in ("ship", "receive"):
        open_dispute = (await db.execute(select(OrderDispute.id).where(
            OrderDispute.movement_id == movement.id,
            OrderDispute.status.in_(("open", "in_review")),
        ).limit(1))).scalar_one_or_none()
        if open_dispute:
            raise StockError("This order has an open support case. Resolve it before dispatch or receipt.", 409)

        from app.models.payments import PaymentIntent, PaymentRefund
        from sqlalchemy import func

        payment = (await db.execute(select(PaymentIntent).where(
            PaymentIntent.entity_type == "stock_movement_payment",
            PaymentIntent.entity_id == movement.id,
        ).order_by(PaymentIntent.created_at.desc()).limit(1).with_for_update())).scalar_one_or_none()
        if payment and payment.status == "pending":
            raise StockError("Payment is still being verified; wait for the provider's result before dispatch or receipt.", 409)
        if payment and payment.status == "refunded":
            raise StockError("This order was fully refunded by the provider and cannot be dispatched or received.", 409)
        if payment and payment.status == "completed":
            pending_refund = (await db.execute(select(PaymentRefund.id).where(
                PaymentRefund.payment_intent_id == payment.id,
                PaymentRefund.status == "pending",
            ).limit(1))).scalar_one_or_none()
            if pending_refund:
                raise StockError("A provider refund is still processing; wait before dispatch or receipt.", 409)
            refunded_amount = (await db.execute(select(func.coalesce(func.sum(PaymentRefund.amount_ksh), 0)).where(
                PaymentRefund.payment_intent_id == payment.id,
                PaymentRefund.status == "completed",
            ))).scalar_one()
            if int(refunded_amount or 0) >= payment.amount_ksh:
                raise StockError("This order was fully refunded by the provider and cannot be dispatched or received.", 409)

    if action == "receive":
        import hashlib
        import hmac

        supplied_hash = hashlib.sha256((receipt_code or "").strip().encode()).hexdigest()
        if (not receipt_code or not order_transaction.receipt_code_hash
                or not hmac.compare_digest(supplied_hash, order_transaction.receipt_code_hash)):
            raise StockError("Enter the current six-digit code shared by the buyer to confirm delivery.", 400)
        if order_transaction.receipt_code_expires_at and order_transaction.receipt_code_expires_at < datetime.utcnow():
            raise StockError("The receipt code expired. Ask the buyer to generate a new one.", 400)
        if selected_quote and selected_quote.provider_type in ("courier", "errand", "scheduled"):
            shipment = (await db.execute(select(CourierShipment).where(
                CourierShipment.movement_id == movement.id,
            ).with_for_update())).scalars().first()
            if shipment and shipment.status == "failed":
                raise StockError("The courier marked this delivery as failed. Open support before confirming receipt.", 409)

    now = datetime.utcnow()
    movement.status = nxt.value
    if nxt is MovementStatus.CONFIRMED:
        movement.confirmed_at = now
        record_movement_event(db, movement.id, "supplier_confirmed", actor_vendor_id=actor.id)
    elif nxt is MovementStatus.SHIPPED:
        movement.shipped_at = now
        record_movement_event(db, movement.id, "dispatch_marked", actor_vendor_id=actor.id,
                              payload={"delivery_mode": selected_quote.provider_type if selected_quote else None})
        if selected_quote and selected_quote.provider_type in ("courier", "errand", "scheduled"):
            request = await db.get(DeliveryQuoteRequest, selected_quote.request_id) if selected_quote.request_id else None
            registration = await db.get(CourierRegistration, request.courier_registration_id) if request and request.courier_registration_id else None
            if (registration is None or registration.vendor_id != selected_quote.provider_vendor_id
                    or registration.vendor_id in (movement.from_vendor_id, movement.to_vendor_id)):
                raise StockError("The selected courier registration is no longer valid.", 409)
            shipment = (await db.execute(select(CourierShipment).where(
                CourierShipment.movement_id == movement.id,
            ).with_for_update())).scalars().first()
            if shipment is None:
                tracking_number = "BRF-" + secrets.token_hex(3).upper() + "-" + secrets.token_hex(2).upper()
                shipment = CourierShipment(
                    courier_id=registration.id,
                    sender_vendor_id=movement.from_vendor_id,
                    receiver_vendor_id=movement.to_vendor_id,
                    movement_id=movement.id,
                    tracking_number=tracking_number,
                    status="picked_up",
                    origin=selected_quote.pickup_address,
                    destination=selected_quote.destination_address,
                    cost=selected_quote.price_ksh,
                    notes=f"Order {str(movement.id)[:8]}",
                    picked_up_at=now,
                    status_history=[{"status": "picked_up", "at": now.isoformat(), "by": actor.vendor_handle}],
                )
                db.add(shipment)
                await db.flush()
                record_movement_event(db, movement.id, "delivery_tracking_created", actor_vendor_id=actor.id,
                                      payload={"tracking_number": tracking_number, "courier_name": registration.courier_name})
                for recipient_id in {movement.to_vendor_id, registration.vendor_id} - {actor.id}:
                    await notification_service.create_notification(
                        db, recipient_id, NotificationType.SHIPMENT_UPDATE,
                        f"Order shipment {tracking_number} is ready to track",
                        f"Via {registration.courier_name}. The buyer's receipt code is still required at hand-off.",
                        sender_id=actor.id,
                        data={"movement_id": movement.id, "tracking_number": tracking_number},
                    )
            elif shipment.courier_id != registration.id:
                raise StockError("A different courier shipment is already linked to this order.", 409)
    elif nxt is MovementStatus.RECEIVED:
        await _settle_receipt(db, movement, item)
        if selected_quote and selected_quote.provider_type in ("courier", "errand", "scheduled"):
            shipment = (await db.execute(select(CourierShipment).where(
                CourierShipment.movement_id == movement.id,
            ).with_for_update())).scalars().first()
            if shipment:
                shipment.status = "delivered"
                shipment.delivered_at = now
                history = list(shipment.status_history or [])
                history.append({"status": "delivered", "at": now.isoformat(), "by": actor.vendor_handle,
                                "note": "Buyer receipt code verified"})
                shipment.status_history = history
        record_movement_event(db, movement.id, "order_received", actor_vendor_id=actor.id,
                              payload={"delivery_mode": selected_quote.provider_type if selected_quote else None})

    counterpart = movement.to_vendor_id if side == "supplier" else movement.from_vendor_id
    ntype, title = {
        "confirm": (NotificationType.SOURCE_ACCEPTED, f"@{actor.vendor_handle} confirmed your {item.name} request"),
        "ship": (NotificationType.SOURCE_SHIPPED, f"@{actor.vendor_handle} shipped {movement.quantity} {item.unit_of_measure} of {item.name}"),
        "receive": (NotificationType.SOURCE_RECEIVED, f"@{actor.vendor_handle} received {item.name} — movement settled"),
    }[action]
    await notification_service.create_notification(
        db, counterpart, ntype, title,
        f"{movement.quantity} {item.unit_of_measure} · total {movement.total_value:g}",
        sender_id=actor.id,
        data={"movement_id": movement.id, "stock_id": item.id, "vendor_handle": actor.vendor_handle,
              "direction": "incoming" if side == "supplier" else "outgoing"},
    )
    await performance_service.recalculate(db, movement.from_vendor_id)
    return movement


async def _cancel(db: AsyncSession, movement: StockMovement, item: StockItem, by_vendor_id: Optional[UUID],
                  reason: str, actor: Optional[Vendor] = None, hold_status: str = "released") -> None:
    item.quantity_reserved = max(0, item.quantity_reserved - movement.quantity)
    recompute_available(item)
    was = movement.status
    movement.status = MovementStatus.CANCELLED.value
    movement.completed_at = datetime.utcnow()
    movement.cancelled_by_vendor_id = by_vendor_id
    await _resolve_hold(db, movement, hold_status)
    record_movement_event(db, movement.id, "order_cancelled", actor_vendor_id=by_vendor_id,
                          payload={"reason": reason[:80]})

    if actor is not None:
        other = movement.to_vendor_id if actor.id == movement.from_vendor_id else movement.from_vendor_id
        recipients = [other]
        title = f"@{actor.vendor_handle} cancelled the {item.name} movement"
    else:  # system expiry: tell both sides
        recipients = [movement.from_vendor_id, movement.to_vendor_id]
        title = f"Hold expired: {item.name} request was not confirmed in time"
    for rid in recipients:
        await notification_service.create_notification(
            db, rid, NotificationType.SOURCE_CANCELLED, title,
            f"{movement.quantity} {item.unit_of_measure} released" + (f" (was {was})" if was else "") + f" · {reason}",
            sender_id=actor.id if actor else None,
            data={"movement_id": movement.id, "stock_id": item.id,
                  "vendor_handle": actor.vendor_handle if actor else None,
                  "direction": "incoming" if rid == movement.to_vendor_id else "outgoing"},
        )


async def expire_stale_holds(db: AsyncSession) -> int:
    """Cancel sourcing requests still `pending` past their hold. Caller commits."""
    now = datetime.utcnow()
    holds = (await db.execute(select(StockReservation).where(
        StockReservation.status == "held", StockReservation.hold_expires_at <= now,
    ))).scalars().all()
    expired = 0
    for hold in holds:
        movement = await db.get(StockMovement, hold.movement_id) if hold.movement_id else None
        if movement is None:
            hold.status = "released"
            hold.resolved_at = now
            continue
        if movement.status != MovementStatus.PENDING.value:
            # Confirmed deals don't lapse; the hold simply follows the movement.
            hold.hold_expires_at = now + timedelta(hours=settings.RESERVATION_HOLD_HOURS)
            continue
        item = await db.get(StockItem, movement.stock_item_id)
        if item is None:
            hold.status = "released"
            hold.resolved_at = now
            continue
        await _cancel(db, movement, item, None, "hold expired", None, hold_status="expired")
        expired += 1
    return expired


async def _settle_receipt(db: AsyncSession, movement: StockMovement, item: StockItem) -> None:
    """Debit the supplier, credit the buyer, score the pair."""
    qty = movement.quantity
    previous_qty = item.quantity_in_stock
    item.quantity_reserved = max(0, item.quantity_reserved - qty)
    item.quantity_in_stock = max(0, item.quantity_in_stock - qty)
    recompute_available(item)
    movement.completed_at = datetime.utcnow()
    await _resolve_hold(db, movement, "fulfilled")

    # The goods now sit on the buyer's shelf. Same SKU on the buyer's side is
    # topped up; otherwise a new network_transfer item is opened.
    buyer_item = None
    if item.sku:
        buyer_item = (await db.execute(
            select(StockItem).where(StockItem.vendor_id == movement.to_vendor_id, StockItem.sku == item.sku)
        )).scalars().first()
    if buyer_item is None:
        buyer_item = StockItem(
            vendor_id=movement.to_vendor_id,
            sku=item.sku,
            name=item.name,
            category=item.category,
            subcategory=item.subcategory,
            description=item.description,
            unit_of_measure=item.unit_of_measure,
            cost_price=movement.unit_price,
            unit_price=item.unit_price,
            wholesale_price=item.wholesale_price,
            source=StockSource.NETWORK_TRANSFER,
            visible_to_network=False,  # the buyer decides when to offer it onward
            tags=list(item.tags or []),
            quantity_in_stock=0,
            # Provenance travels with the goods; verification does not.
            batch_number=item.batch_number,
            origin_country=item.origin_country,
            expiry_date=item.expiry_date,
            spec_sheet_url=item.spec_sheet_url,
        )
        db.add(buyer_item)
    buyer_item.quantity_in_stock = (buyer_item.quantity_in_stock or 0) + qty
    recompute_available(buyer_item)

    supplier = await db.get(Vendor, movement.from_vendor_id)
    buyer = await db.get(Vendor, movement.to_vendor_id)
    if supplier:
        supplier.total_stock_moved += qty
    if buyer:
        buyer.total_stock_moved += qty

    # A shelf that just ran low tells its owner.
    await notification_service.low_stock_alert(db, item, previous_qty=previous_qty)

    before = await parasitism_engine.stored_connection_score(movement.from_vendor_id, movement.to_vendor_id, db)
    after = await parasitism_engine.update_connection_score(movement.from_vendor_id, movement.to_vendor_id, db)
    await parasitism_engine.update_vendor_network_score(movement.from_vendor_id, db)
    await parasitism_engine.update_vendor_network_score(movement.to_vendor_id, db)
    milestone = notification_service.crossed_milestone(before, after)
    if milestone and supplier and buyer:
        for me, other in ((supplier, buyer), (buyer, supplier)):
            await notification_service.create_notification(
                db, me.id, NotificationType.PARASITISM_MILESTONE,
                f"Mutual benefit with @{other.vendor_handle} reached {milestone}",
                "Trade flows both ways — the network is working.",
                data={"vendor_handle": other.vendor_handle, "score": after, "milestone": milestone},
            )


# --- comparison ---------------------------------------------------------------------

async def find_alternatives(db: AsyncSession, stock_item_id: UUID, for_vendor: Optional[Vendor] = None,
                            limit: int = 10) -> list:
    """Similar stock from other vendors for comparison (v2.1 §3.2). Matches the
    same SKU or category + any name keyword; the viewer's own shelf is left
    out (you can't source from yourself). Returns (StockItem, Vendor) rows
    ordered by network price."""
    item = await db.get(StockItem, stock_item_id)
    if not item:
        return []

    query = (
        select(StockItem, Vendor)
        .join(Vendor, StockItem.vendor_id == Vendor.id)
        .where(StockItem.id != stock_item_id)
        .where(StockItem.visible_to_network.is_(True))
        .where(StockItem.quantity_available > 0)
    )
    if for_vendor is not None:
        query = query.where(StockItem.vendor_id != for_vendor.id)

    keywords = [kw for kw in (item.name or "").replace("-", " ").split() if len(kw) > 3][:3]
    name_match = [StockItem.name.ilike(f"%{kw}%") for kw in keywords]
    if not name_match and item.name:
        name_match = [StockItem.name.ilike(f"%{item.name.strip()}%")]
    similar = []
    if item.sku:
        similar.append(StockItem.sku == item.sku)
    if item.category and name_match:
        similar.append((StockItem.category.ilike(item.category)) & or_(*name_match))
    elif name_match:
        similar.append(or_(*name_match))
    elif item.category:
        similar.append(StockItem.category.ilike(item.category))
    if similar:
        query = query.where(or_(*similar))

    query = query.order_by(
        StockItem.wholesale_price.asc().nullslast(),
        StockItem.unit_price.asc().nullslast(),
        StockItem.quantity_available.desc(),
    ).limit(limit)
    return (await db.execute(query)).all()


# --- POS / CSV import ---------------------------------------------------------------

async def upsert_from_pos(
    db: AsyncSession, vendor: Vendor, rows: list[dict], source: StockSource,
    sync_config: Optional[dict] = None,
) -> dict:
    """Idempotent import used by the POS bridge and the CSV importer. Matches an
    existing shelf line by `pos_item_id`, then by `sku`; otherwise adds one.
    Returns counts for the sync log."""
    cfg = sync_config or {}
    exclude = set(cfg.get("exclude_sku") or [])
    min_stock = int(cfg.get("min_stock") or 0)
    added = updated = skipped = 0
    errors: list[str] = []
    now = datetime.utcnow()

    for i, row in enumerate(rows):
        try:
            name = (row.get("name") or "").strip()
            if not name:
                raise ValueError("missing name")
            sku = (row.get("sku") or None) or None
            if sku in exclude:
                skipped += 1
                continue
            qty = int(float(row.get("quantity") or row.get("quantity_in_stock") or 0))
            if qty < min_stock:
                skipped += 1
                continue
            pos_item_id = row.get("pos_item_id") or None

            item = None
            if pos_item_id:
                item = (await db.execute(select(StockItem).where(
                    StockItem.vendor_id == vendor.id, StockItem.pos_item_id == str(pos_item_id)
                ))).scalars().first()
            if item is None and sku:
                item = (await db.execute(select(StockItem).where(
                    StockItem.vendor_id == vendor.id, StockItem.sku == str(sku)
                ))).scalars().first()

            previous_qty: Optional[int]
            if item is None:
                item = StockItem(vendor_id=vendor.id, name=name, source=source)
                db.add(item)
                added += 1
                previous_qty = None
            else:
                updated += 1
                previous_qty = item.quantity_in_stock

            item.name = name
            item.sku = str(sku) if sku else item.sku
            item.pos_item_id = str(pos_item_id) if pos_item_id else item.pos_item_id
            item.category = row.get("category") or item.category
            item.description = row.get("description") or item.description
            item.unit_of_measure = row.get("unit_of_measure") or item.unit_of_measure or "units"
            for field in ("unit_price", "wholesale_price", "cost_price"):
                val = row.get(field)
                if val not in (None, ""):
                    setattr(item, field, float(val))
            if row.get("tags"):
                tags = row["tags"]
                item.tags = [t.strip() for t in tags.split("|")] if isinstance(tags, str) else list(tags)
            for field in ("batch_number", "origin_country"):
                if row.get(field):
                    setattr(item, field, str(row[field])[:100])
            item.quantity_in_stock = qty
            recompute_available(item)
            item.last_pos_sync = now
            item.visible_to_network = bool(row.get("visible_to_network", item.visible_to_network if item.visible_to_network is not None else True))
            if previous_qty is not None:
                await notification_service.low_stock_alert(db, item, previous_qty)
        except Exception as exc:  # one bad row must not sink the sync
            errors.append(f"row {i + 1}: {exc}")

    return {"processed": len(rows), "added": added, "updated": updated, "skipped": skipped, "errors": errors}

"""Service layer for Market Runs and their order ledger (v2.15).

Every figure on the ledger is computed from `run_orders`, `run_purchases`
and `run_expenses` at request time. The profit identity is shown, never
hidden: selling revenue − supplier cost − delivery − handling/repacking
− expenses. A bulk order is not assumed profitable.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.market_locks import LockProduct, MarketZone, SupplierMOQ
from app.models.vendor import Vendor
from app.modules.runs import rules
from app.modules.runs.models import MarketRun, RunExpense, RunOrder, RunPurchase
from app.services.market_locks import minimum_bid_quantity

ACTIVE_ORDER = ("requested", "confirmed", "purchased", "allocated", "ready", "collected", "delivered")
CONFIRMED_ORDER = ("confirmed", "purchased", "allocated", "ready", "collected", "delivered")


def _kes(value) -> int:
    return int(round(float(value or 0)))


def order_amounts(order: RunOrder) -> dict:
    """Final amount & balance for one allocation, fees included."""
    qty = order.quantity_allocated if order.quantity_allocated is not None else order.quantity
    unit = order.actual_unit_price if order.actual_unit_price is not None else (order.estimated_unit_price or 0)
    goods = float(qty or 0) * float(unit or 0)
    fees = int(order.delivery_fee_kes or 0) + int(order.handling_fee_kes or 0) + int(order.repack_fee_kes or 0)
    final = _kes(goods + fees)
    return {
        "quantity_charged": qty, "unit_price_charged": unit,
        "goods_amount_kes": _kes(goods), "fees_kes": fees, "final_amount_kes": final,
        "amount_paid_kes": int(order.amount_paid_kes or 0),
        "balance_due_kes": final - int(order.amount_paid_kes or 0),
    }


def order_out(order: RunOrder, vendor: Optional[Vendor] = None,
              collection_point: Optional[Vendor] = None) -> dict:
    amounts = order_amounts(order)
    estimated_value = _kes(float(order.quantity or 0) * float(order.estimated_unit_price or 0))
    on_delivery = order.payment_method in ("cash_on_delivery", "mpesa_on_delivery", "shop_backed_collection")
    return {
        "id": str(order.id), "run_id": str(order.run_id),
        "product_name": order.product_name, "product_id": str(order.product_id) if order.product_id else None,
        "unit_of_measure": order.unit_of_measure, "package_size": order.package_size,
        "wholesale_package": bool(order.wholesale_package),
        "repack_required": bool(order.repack_required),
        "vendor_handle": vendor.vendor_handle if vendor else None,
        "business_name": vendor.business_name if vendor else None,
        "participant_type": order.participant_type,
        "quantity": order.quantity, "quantity_allocated": order.quantity_allocated,
        "status": order.status,
        "payment_method": order.payment_method,
        "payment_method_note": rules.PAYMENT_METHOD_NOTES.get(order.payment_method),
        "money_responsibility": order.money_responsibility,
        "funding_source": order.funding_source,
        "delivery_mode": order.delivery_mode,
        "collection_point_handle": collection_point.vendor_handle if collection_point else None,
        "delivery_area": order.delivery_area,
        "estimated_unit_price": order.estimated_unit_price,
        "actual_unit_price": order.actual_unit_price,
        "delivery_fee_kes": order.delivery_fee_kes, "handling_fee_kes": order.handling_fee_kes,
        "repack_fee_kes": order.repack_fee_kes,
        "payment_status": order.payment_status, "payment_note": order.payment_note,
        "deposit_recommended": bool(on_delivery and order.status in ("requested", "confirmed")
                                    and estimated_value >= rules.LARGE_ORDER_FLAG_KES),
        "deposit_note": (
            "Large on-delivery order: a deposit is recommended and shown to the buyer — "
            "never required by the platform. The customer decides."
            if on_delivery and estimated_value >= rules.LARGE_ORDER_FLAG_KES else None
        ),
        **amounts,
        "confirmed_at": order.confirmed_at.isoformat() if order.confirmed_at else None,
        "collected_at": order.collected_at.isoformat() if order.collected_at else None,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


def run_out(run: MarketRun, buyer: Optional[Vendor] = None) -> dict:
    return {
        "id": str(run.id), "zone_id": str(run.zone_id) if run.zone_id else None,
        "market_name": run.market_name, "market_city": run.market_city,
        "title": run.title, "run_kind": run.run_kind, "run_date": run.run_date.isoformat(),
        "order_deadline": run.order_deadline.isoformat() if run.order_deadline else None,
        "status": run.status,
        "buyer_handle": buyer.vendor_handle if buyer else None,
        "funding_model": run.funding_model,
        "funding_note": rules.FUNDING_MODEL_NOTES.get(run.funding_model),
        "cold_chain_required": bool(run.cold_chain_required),
        "cold_chain_plan": run.cold_chain_plan, "notes": run.notes,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }


async def get_run(db: AsyncSession, run_id: UUID) -> MarketRun:
    run = await db.get(MarketRun, run_id)
    if run is None:
        raise rules.RunRuleError("Market run not found", status=404)
    return run


def is_run_manager(run: MarketRun, vendor: Vendor) -> bool:
    return vendor.id in (run.created_by_vendor_id, run.buyer_vendor_id) or \
        settings.market_ops_role(vendor.vendor_handle) in ("admin", "clerk", "negotiator")


def require_manager(run: MarketRun, vendor: Vendor) -> None:
    if not is_run_manager(run, vendor):
        raise rules.RunRuleError(
            "Only the run's buyer/organiser (or market ops) can do this", status=403)


# ── runs ─────────────────────────────────────────────────────────────────────


async def create_run(db: AsyncSession, vendor: Vendor, *, data: dict) -> dict:
    zone = None
    if data.get("zone_id"):
        zone = await db.get(MarketZone, data["zone_id"])
        if zone is None or not zone.is_active:
            raise rules.RunRuleError("Market zone not found", status=404)
    buyer = vendor
    if data.get("buyer_handle"):
        buyer = (await db.execute(select(Vendor).where(
            func.lower(Vendor.vendor_handle) == data["buyer_handle"].strip().lstrip("@").lower()
        ))).scalar_one_or_none()
        if buyer is None:
            raise rules.RunRuleError("Buyer vendor not found", status=404)
    kind = (data.get("run_kind") or "consolidated_supply").strip().lower()
    if kind not in ("fresh_market", "bulk_dry_goods", "consolidated_supply"):
        raise rules.RunRuleError(f"Unknown run_kind '{kind}'", status=400)
    funding = (data.get("funding_model") or "mixed_open").strip().lower()
    if funding not in ("customer_advance", "buyer_capital", "supplier_credit", "shop_consolidated", "pooled", "mixed_open"):
        raise rules.RunRuleError(f"Unknown funding_model '{funding}'", status=400)
    cold = bool(data.get("cold_chain_required"))
    if kind == "fresh_market":
        cold = True
    run = MarketRun(
        zone_id=zone.id if zone else None,
        market_name=((data.get("market_name") or (zone.name if zone else "")).strip()
                     or (zone.name if zone else "Market")),
        market_city=((data.get("market_city") or (zone.city if zone else "Nairobi")).strip() or "Nairobi"),
        title=(data.get("title") or "").strip() or "Market run",
        run_kind=kind, run_date=data["run_date"], order_deadline=data["order_deadline"],
        buyer_vendor_id=buyer.id, created_by_vendor_id=vendor.id,
        funding_model=funding, cold_chain_required=cold,
        cold_chain_plan=(data.get("cold_chain_plan") or "").strip() or None,
        notes=(data.get("notes") or "").strip() or None,
    )
    if cold and not run.cold_chain_plan:
        raise rules.RunRuleError(
            "A fresh-goods run needs a cold-chain plan (insulated containers, fresh allocations first)", status=400)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run_out(run, buyer)


async def list_runs(db: AsyncSession, *, status: Optional[str] = None) -> list[dict]:
    stmt = select(MarketRun).order_by(MarketRun.run_date.desc(), MarketRun.created_at.desc()).limit(50)
    if status:
        stmt = stmt.where(MarketRun.status == status)
    rows = (await db.execute(stmt)).scalars().all()
    out = []
    for run in rows:
        buyer = await db.get(Vendor, run.buyer_vendor_id) if run.buyer_vendor_id else None
        out.append(run_out(run, buyer))
    return out


async def set_run_status(db: AsyncSession, run: MarketRun, vendor: Vendor, status: str) -> dict:
    require_manager(run, vendor)
    clean = (status or "").strip().lower()
    flow = {"open": 0, "buying": 1, "allocating": 2, "delivering": 3, "completed": 4}
    if clean == "cancelled":
        run.status = "cancelled"
    elif clean in flow and run.status in flow and flow[clean] >= flow[run.status]:
        run.status = clean
    elif clean in flow:
        raise rules.RunRuleError(f"Run cannot move from {run.status} back to {clean}", status=400)
    else:
        raise rules.RunRuleError(f"Unknown run status '{status}'", status=400)
    run.updated_at = datetime.utcnow()
    await db.commit()
    buyer = await db.get(Vendor, run.buyer_vendor_id) if run.buyer_vendor_id else None
    return run_out(run, buyer)


# ── orders ───────────────────────────────────────────────────────────────────


async def create_order(db: AsyncSession, run: MarketRun, vendor: Vendor, *, data: dict) -> dict:
    """Open ordering: no zone check, no forced payment method, no minimum
    beyond a positive quantity. A request is not a confirmed order."""
    if run.status != "open":
        raise rules.RunRuleError(f"This run is {run.status} and is not accepting orders", status=400)
    if datetime.utcnow() > run.order_deadline:
        raise rules.RunRuleError("The order deadline for this run has passed", status=400)
    qty = float(data.get("quantity") or 0)
    if qty <= 0:
        raise rules.RunRuleError("Quantity must be greater than zero", status=400)
    participant = (data.get("participant_type") or "shop").strip().lower()
    if participant not in ("family", "shop"):
        raise rules.RunRuleError("participant_type must be family or shop", status=400)
    payment = (data.get("payment_method") or "cash_on_delivery").strip().lower()
    if payment not in rules.PAYMENT_METHOD_NOTES:
        raise rules.RunRuleError(f"payment_method must be one of {', '.join(rules.PAYMENT_METHOD_NOTES)}", status=400)
    delivery = (data.get("delivery_mode") or "collect_at_hub").strip().lower()
    if delivery not in ("collect_at_hub", "collect_at_shop", "home_delivery"):
        raise rules.RunRuleError("Unknown delivery_mode", status=400)

    collection_point = None
    if data.get("collection_point_handle"):
        collection_point = (await db.execute(select(Vendor).where(
            func.lower(Vendor.vendor_handle) == data["collection_point_handle"].strip().lstrip("@").lower()
        ))).scalar_one_or_none()
        if collection_point is None:
            raise rules.RunRuleError("Collection-point vendor not found", status=404)
    if payment == "shop_backed_collection" and collection_point is None:
        raise rules.RunRuleError(
            "Shop-backed collection needs a participating shop: set collection_point_handle", status=400)

    responsibility = (data.get("money_responsibility") or
                      ("shop" if payment == "shop_backed_collection" else "customer")).strip().lower()
    if responsibility not in ("customer", "shop", "buyer", "platform"):
        raise rules.RunRuleError("Unknown money_responsibility", status=400)
    funding = (data.get("funding_source") or "customer_advance").strip().lower()
    if funding not in ("customer_advance", "buyer_capital", "supplier_credit", "shop_funded", "pooled"):
        raise rules.RunRuleError("Unknown funding_source", status=400)
    product = None
    if data.get("product_id"):
        product = await db.get(LockProduct, data["product_id"])
        if product is None:
            raise rules.RunRuleError("Lock product not found", status=404)

    order = RunOrder(
        run_id=run.id,
        product_id=product.id if product else None,
        product_name=((data.get("product_name") or (product.name if product else "")).strip()),
        unit_of_measure=((data.get("unit_of_measure") or (product.unit_of_measure if product else "units")).strip() or "units"),
        package_size=(data.get("package_size") or "").strip() or None,
        wholesale_package=bool(data.get("wholesale_package")),
        repack_required=bool(data.get("repack_required")),
        vendor_id=vendor.id, participant_type=participant, quantity=qty,
        payment_method=payment, money_responsibility=responsibility, funding_source=funding,
        delivery_mode=delivery,
        collection_point_vendor_id=collection_point.id if collection_point else None,
        delivery_area=(data.get("delivery_area") or "").strip() or None,
        estimated_unit_price=data.get("estimated_unit_price"),
        delivery_fee_kes=int(data.get("delivery_fee_kes") or 0),
        handling_fee_kes=int(data.get("handling_fee_kes") or 0),
        repack_fee_kes=int(data.get("repack_fee_kes") or 0),
    )
    if not order.product_name:
        raise rules.RunRuleError("Name the product to order", status=400)
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return order_out(order, vendor, collection_point)


async def confirm_order(db: AsyncSession, order: RunOrder, vendor: Vendor) -> dict:
    """Request → confirmed order. Only confirmed demand is bought."""
    if order.vendor_id != vendor.id:
        raise rules.RunRuleError("Only the customer can confirm their order", status=403)
    if order.status != "requested":
        raise rules.RunRuleError(f"Order is already {order.status}", status=400)
    order.status = "confirmed"
    order.confirmed_at = datetime.utcnow()
    order.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(order)
    return order_out(order, vendor)


async def cancel_order(db: AsyncSession, order: RunOrder, vendor: Vendor) -> dict:
    if order.vendor_id != vendor.id:
        raise rules.RunRuleError("Only the customer can cancel their order", status=403)
    if order.status in ("collected", "delivered"):
        raise rules.RunRuleError("That order has already been handed over", status=400)
    order.status = "cancelled"
    order.updated_at = datetime.utcnow()
    await db.commit()
    return {"cancelled": True, "order_id": str(order.id)}


async def allocate_order(db: AsyncSession, run: MarketRun, order: RunOrder, vendor: Vendor,
                         *, quantity_allocated: float, delivery_fee_kes: Optional[int],
                         handling_fee_kes: Optional[int], repack_fee_kes: Optional[int]) -> dict:
    require_manager(run, vendor)
    if order.status not in ("confirmed", "purchased", "allocated"):
        raise rules.RunRuleError(f"Cannot allocate an order that is {order.status}", status=400)
    if float(quantity_allocated) < 0:
        raise rules.RunRuleError("Allocated quantity cannot be negative", status=400)
    order.quantity_allocated = float(quantity_allocated)
    # The purchase sets the actual price for the whole product line.
    purchase = (await db.execute(select(RunPurchase).where(
        RunPurchase.run_id == run.id,
        func.lower(RunPurchase.product_name) == order.product_name.lower(),
    ))).scalar_one_or_none()
    if purchase is not None:
        order.actual_unit_price = purchase.actual_unit_price
        order.status = "allocated"
    else:
        order.status = "allocated"
    for field, value in (("delivery_fee_kes", delivery_fee_kes), ("handling_fee_kes", handling_fee_kes),
                         ("repack_fee_kes", repack_fee_kes)):
        if value is not None:
            setattr(order, field, int(value))
    order.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(order)
    owner = await db.get(Vendor, order.vendor_id)
    return order_out(order, owner)


async def record_payment(db: AsyncSession, run: MarketRun, order: RunOrder, vendor: Vendor,
                         *, amount_kes: int, note: Optional[str]) -> dict:
    """Record money that changed hands (advance, on delivery, at a shop).

    This records — it does not hold funds. Custody/escrow remains the Lock
    settlement path; a run payment note says who recorded what."""
    allowed = is_run_manager(run, vendor) or order.vendor_id == vendor.id or \
        order.collection_point_vendor_id == vendor.id
    if not allowed:
        raise rules.RunRuleError("Only the customer, collection shop or run buyer can record this payment", status=403)
    if int(amount_kes) <= 0:
        raise rules.RunRuleError("Payment amount must be greater than zero", status=400)
    order.amount_paid_kes = int(order.amount_paid_kes or 0) + int(amount_kes)
    amounts = order_amounts(order)
    order.payment_status = "paid" if amounts["balance_due_kes"] <= 0 else "deposit_paid"
    if note:
        order.payment_note = note.strip()
    order.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(order)
    owner = await db.get(Vendor, order.vendor_id)
    return order_out(order, owner)


async def mark_handover(db: AsyncSession, run: MarketRun, order: RunOrder, vendor: Vendor,
                        *, outcome: str) -> dict:
    allowed = is_run_manager(run, vendor) or order.collection_point_vendor_id == vendor.id
    if not allowed:
        raise rules.RunRuleError("Only the run buyer or the collection shop can hand over this order", status=403)
    clean = (outcome or "").strip().lower()
    if clean not in ("collected", "delivered", "refused"):
        raise rules.RunRuleError("outcome must be collected, delivered or refused", status=400)
    if order.status not in ("allocated", "ready", "purchased", "confirmed"):
        raise rules.RunRuleError(f"Order is {order.status} and cannot be handed over", status=400)
    order.status = clean
    if clean in ("collected", "delivered"):
        order.collected_at = datetime.utcnow()
    order.updated_at = datetime.utcnow()
    await db.commit()
    owner = await db.get(Vendor, order.vendor_id)
    return order_out(order, owner)


# ── purchases & expenses ─────────────────────────────────────────────────────


async def record_purchase(db: AsyncSession, run: MarketRun, vendor: Vendor, *, data: dict) -> dict:
    """The supplier purchase order, per product, with its receipt.

    Buying only confirmed demand is the default ledger view; the purchase
    itself records what the buyer actually bought, at what actual price,
    minus weight loss and rejected stock."""
    require_manager(run, vendor)
    name = (data.get("product_name") or "").strip()
    if not name:
        raise rules.RunRuleError("Name the purchased product", status=400)
    qty, price = float(data.get("quantity_purchased") or 0), float(data.get("actual_unit_price") or 0)
    if qty <= 0:
        raise rules.RunRuleError("quantity_purchased must be greater than zero", status=400)
    key = name.lower()
    purchase = (await db.execute(select(RunPurchase).where(
        RunPurchase.run_id == run.id, RunPurchase.product_name_key == key))).scalar_one_or_none()
    if purchase is None:
        purchase = RunPurchase(run_id=run.id, product_name=name, product_name_key=key)
        db.add(purchase)
    purchase.unit_of_measure = (data.get("unit_of_measure") or "units").strip() or "units"
    purchase.supplier_name = (data.get("supplier_name") or "").strip() or None
    purchase.quantity_purchased, purchase.actual_unit_price = qty, price
    purchase.receipt_ref = (data.get("receipt_ref") or "").strip() or None
    purchase.weight_loss_quantity = float(data.get("weight_loss_quantity") or 0)
    purchase.rejected_quantity = float(data.get("rejected_quantity") or 0)
    purchase.notes = (data.get("notes") or "").strip() or None
    purchase.purchased_by_vendor_id = vendor.id
    purchase.updated_at = datetime.utcnow()
    # Confirmed orders for this product now count as purchased stock.
    orders = (await db.execute(select(RunOrder).where(
        RunOrder.run_id == run.id, RunOrder.status == "confirmed",
        func.lower(RunOrder.product_name) == key))).scalars().all()
    for order in orders:
        order.status = "purchased"
        order.actual_unit_price = price
    if run.status == "open":
        run.status = "buying"
    await db.commit()
    await db.refresh(purchase)
    return {
        "id": str(purchase.id), "run_id": str(run.id), "product_name": purchase.product_name,
        "unit_of_measure": purchase.unit_of_measure, "supplier_name": purchase.supplier_name,
        "quantity_purchased": purchase.quantity_purchased,
        "actual_unit_price": purchase.actual_unit_price, "receipt_ref": purchase.receipt_ref,
        "weight_loss_quantity": purchase.weight_loss_quantity,
        "rejected_quantity": purchase.rejected_quantity,
        "usable_quantity": purchase.quantity_purchased - purchase.weight_loss_quantity - purchase.rejected_quantity,
        "notes": purchase.notes,
    }


async def record_expense(db: AsyncSession, run: MarketRun, vendor: Vendor, *, data: dict) -> dict:
    require_manager(run, vendor)
    kind = (data.get("kind") or "other").strip().lower()
    if kind not in ("transport", "handling", "repacking", "cold_chain", "market_fees", "other"):
        raise rules.RunRuleError("Unknown expense kind", status=400)
    expense = RunExpense(
        run_id=run.id, kind=kind, amount_kes=int(data.get("amount_kes") or 0),
        receipt_ref=(data.get("receipt_ref") or "").strip() or None,
        note=(data.get("note") or "").strip() or None, recorded_by_vendor_id=vendor.id)
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    return {"id": str(expense.id), "run_id": str(run.id), "kind": expense.kind,
            "amount_kes": expense.amount_kes, "receipt_ref": expense.receipt_ref, "note": expense.note}


# ── ledger ───────────────────────────────────────────────────────────────────


async def ledger(db: AsyncSession, run: MarketRun) -> dict:
    orders = (await db.execute(select(RunOrder).where(
        RunOrder.run_id == run.id).order_by(RunOrder.created_at))).scalars().all()
    purchases = (await db.execute(select(RunPurchase).where(
        RunPurchase.run_id == run.id))).scalars().all()
    expenses = (await db.execute(select(RunExpense).where(
        RunExpense.run_id == run.id))).scalars().all()

    vendors: dict = {}
    points: dict = {}
    order_rows = []
    for order in orders:
        if order.vendor_id not in vendors:
            vendors[order.vendor_id] = await db.get(Vendor, order.vendor_id)
        point = None
        if order.collection_point_vendor_id:
            if order.collection_point_vendor_id not in points:
                points[order.collection_point_vendor_id] = await db.get(Vendor, order.collection_point_vendor_id)
            point = points[order.collection_point_vendor_id]
        order_rows.append(order_out(order, vendors[order.vendor_id], point))

    # Three figures, never merged — per product.
    by_product: dict[str, dict] = {}
    for order in orders:
        if order.status in ("cancelled", "refused"):
            continue
        entry = by_product.setdefault(order.product_name.lower(), {
            "product_name": order.product_name, "unit_of_measure": order.unit_of_measure,
            "total_pooled_demand": 0.0, "confirmed_purchasing_demand": 0.0,
            "family_quantity": 0.0, "shop_quantity": 0.0, "orders": 0,
        })
        entry["orders"] += 1
        entry["total_pooled_demand"] += float(order.quantity or 0)
        if order.participant_type == "family":
            entry["family_quantity"] += float(order.quantity or 0)
        else:
            entry["shop_quantity"] += float(order.quantity or 0)
        if order.status in CONFIRMED_ORDER:
            entry["confirmed_purchasing_demand"] += float(order.quantity or 0)

    purchase_by_product = {p.product_name.lower(): p for p in purchases}
    for key, entry in by_product.items():
        thresholds = []
        if run.zone_id:
            product_ids = {o.product_id for o in orders if o.product_id and o.product_name.lower() == key}
            for pid in product_ids:
                offers = (await db.execute(select(SupplierMOQ).where(
                    SupplierMOQ.zone_id == run.zone_id, SupplierMOQ.product_id == pid,
                    SupplierMOQ.is_active.is_(True)))).scalars().all()
                thresholds.extend(minimum_bid_quantity(o.minimum_order_quantity) for o in offers)
        entry["wholesale_threshold"] = min(thresholds) if thresholds else None
        entry["threshold_reached"] = bool(
            thresholds and entry["confirmed_purchasing_demand"] >= min(thresholds))
        purchase = purchase_by_product.get(key)
        entry["purchase"] = None if purchase is None else {
            "quantity_purchased": purchase.quantity_purchased,
            "actual_unit_price": purchase.actual_unit_price,
            "receipt_ref": purchase.receipt_ref, "supplier_name": purchase.supplier_name,
            "weight_loss_quantity": purchase.weight_loss_quantity,
            "rejected_quantity": purchase.rejected_quantity,
            "usable_quantity": purchase.quantity_purchased - purchase.weight_loss_quantity - purchase.rejected_quantity,
        }
        confirmed_orders = [o for o in orders if o.product_name.lower() == key and o.status in CONFIRMED_ORDER]
        if purchase is not None and confirmed_orders:
            estimated = [o.estimated_unit_price for o in confirmed_orders if o.estimated_unit_price]
            entry["saving_per_unit_kes"] = (
                round(sum(estimated) / len(estimated) - purchase.actual_unit_price, 2) if estimated else None)
        else:
            entry["saving_per_unit_kes"] = None

    revenue = sum(r["final_amount_kes"] for r in order_rows if r["status"] not in ("cancelled", "refused"))
    collected = sum(int(o.amount_paid_kes or 0) for o in orders if o.status not in ("cancelled", "refused"))
    supplier_cost = sum(_kes(p.quantity_purchased * p.actual_unit_price) for p in purchases)
    delivery_handling = sum(r["fees_kes"] for r in order_rows if r["status"] not in ("cancelled", "refused"))
    expense_total = sum(int(e.amount_kes or 0) for e in expenses)
    handed = sum(1 for o in orders if o.status in ("collected", "delivered"))
    refused = sum(1 for o in orders if o.status == "refused")
    settled_orders = [o for o in orders if o.status not in ("cancelled",)]

    buyer = await db.get(Vendor, run.buyer_vendor_id) if run.buyer_vendor_id else None
    out = run_out(run, buyer)
    out["orders"] = order_rows
    out["ledger"] = {
        "products": list(by_product.values()),
        "expenses": [{"kind": e.kind, "amount_kes": e.amount_kes, "receipt_ref": e.receipt_ref, "note": e.note} for e in expenses],
        "totals": {
            "selling_revenue_kes": revenue,
            "supplier_cost_kes": supplier_cost,
            "delivery_handling_fees_kes": delivery_handling,
            "run_expenses_kes": expense_total,
            "amount_collected_kes": collected,
            "balance_outstanding_kes": revenue - collected,
            "estimated_profit_kes": revenue - supplier_cost - expense_total,
            "profit_formula": "Selling revenue − supplier cost − run expenses (transport/handling/cold chain). Fees charged to customers are inside revenue; expected losses show as refused/unpaid orders below.",
        },
        "fulfilment": {
            "orders_total": len(settled_orders),
            "handed_over": handed, "refused": refused,
            "received_and_paid_rate": (
                round(100.0 * sum(1 for o in settled_orders
                                  if o.status in ("collected", "delivered") and order_amounts(o)["balance_due_kes"] <= 0)
                      / len(settled_orders), 1) if settled_orders else None
            ),
        },
        "money_note": (
            "Payments on a run are recorded by the customer, collection shop or buyer — "
            "who recorded what is on each order. They are not held in platform custody."
        ),
    }
    return out


async def my_orders(db: AsyncSession, vendor: Vendor) -> list[dict]:
    rows = (await db.execute(select(RunOrder).where(
        RunOrder.vendor_id == vendor.id).order_by(RunOrder.created_at.desc()).limit(50))).scalars().all()
    return [order_out(o, vendor) for o in rows]

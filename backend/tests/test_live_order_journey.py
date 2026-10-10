"""Integration coverage for the confirmed pickup/delivery and receipt journey."""

import uuid

import pytest

pytestmark = pytest.mark.asyncio


async def _register(client, handle, categories, phone=None):
    suffix = uuid.uuid4().hex[:7]
    response = await client.post("/api/auth/register", json={
        "business_name": handle.replace("_", " ").title(),
        "vendor_handle": f"{handle}_{suffix}",
        "email": f"{handle}_{suffix}@example.com",
        "phone": phone,
        "password": "Correct-horse-9",
        "business_categories": categories,
        "physical_location": "Nairobi",
    })
    assert response.status_code == 201, response.text
    token = response.json()
    return token, {"Authorization": f"Bearer {token['access_token']}"}


async def _self_pickup_order(client, supplier, buyer):
    response = await client.post("/api/stock/add", headers=supplier, json={
        "name": "Payment test produce", "sku": f"PAY-{uuid.uuid4().hex[:6]}",
        "category": "produce", "quantity_in_stock": 20,
        "unit_of_measure": "crate", "unit_price": 1500,
        "wholesale_price": 1200, "min_order_quantity": 1,
    })
    assert response.status_code == 201, response.text
    stock_id = response.json()["stock_id"]
    response = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 2})
    assert response.status_code == 201, response.text
    movement_id = response.json()["movement_id"]
    response = await client.post(f"/api/stock/movements/{movement_id}/confirm", headers=supplier)
    assert response.status_code == 200, response.text
    response = await client.put(f"/api/orders/{movement_id}/pickup", headers=supplier, json={
        "address": "Test market, stall 15, Nairobi",
        "pickup_hours": "Confirmed collection hours",
        "ready_for_collection": True,
    })
    assert response.status_code == 200, response.text
    response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
    assert response.status_code == 200, response.text
    quote = next(item for item in response.json()["delivery_quotes"] if item["provider_type"] == "self_pickup")
    response = await client.post(
        f"/api/orders/{movement_id}/delivery-quotes/{quote['id']}/select", headers=buyer,
    )
    assert response.status_code == 200, response.text
    return movement_id


async def test_delivery_quote_selection_provider_privacy_and_receipt(client):
    _supplier_token, supplier = await _register(client, "order_supplier", ["produce"], "254700000001")
    _buyer_token, buyer = await _register(client, "order_buyer", ["food"], "254700000002")
    _courier_token, courier = await _register(client, "order_courier", ["logistics"])
    _other_token, other = await _register(client, "other_courier", ["logistics"])
    for headers in (supplier, buyer):
        response = await client.put("/api/vendors/me", headers=headers, json={"allow_direct_calls": True})
        assert response.status_code == 200, response.text

    response = await client.post("/api/stock/add", headers=supplier, json={
        "name": "Test produce", "sku": f"ORD-{uuid.uuid4().hex[:6]}",
        "category": "produce", "quantity_in_stock": 20,
        "unit_of_measure": "crate", "unit_price": 1500,
        "wholesale_price": 1200, "min_order_quantity": 1,
    })
    assert response.status_code == 201, response.text
    stock_id = response.json()["stock_id"]

    response = await client.post("/api/tools/courier/register", headers=courier, json={
        "courier_name": "Test courier service",
        "coverage_areas": ["Nairobi"],
        "service_types": ["same_day"],
        "base_rate": 300,
    })
    assert response.status_code == 201, response.text
    courier_registration_id = response.json()["courier_id"]

    response = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 2})
    assert response.status_code == 201, response.text
    movement_id = response.json()["movement_id"]

    response = await client.post(f"/api/stock/movements/{movement_id}/confirm", headers=supplier)
    assert response.status_code == 200, response.text
    response = await client.post(f"/api/stock/movements/{movement_id}/ship", headers=supplier)
    assert response.status_code == 409

    response = await client.put(f"/api/orders/{movement_id}/pickup", headers=supplier, json={
        "address": "Test market, stall 12, Nairobi",
        "pickup_hours": "Supplier-confirmed hours",
        "instructions": "Ask for the supplier at the listed stall",
        "ready_for_collection": True,
    })
    assert response.status_code == 200, response.text

    response = await client.post(f"/api/orders/{movement_id}/delivery-requests", headers=buyer, json={
        "provider_type": "courier",
        "courier_registration_id": courier_registration_id,
        "destination_address": "Test receiving market, Nairobi",
        "customer_note": "Keep the produce upright",
    })
    assert response.status_code == 201, response.text
    request_id = response.json()["id"]

    response = await client.get("/api/orders/delivery-requests/inbox", headers=courier)
    assert response.status_code == 200, response.text
    assert [request["id"] for request in response.json()] == [request_id]

    response = await client.post(f"/api/orders/delivery-requests/{request_id}/quote", headers=courier, json={
        "price_ksh": 325,
        "eta_text": "Provider-confirmed timing",
        "note": "Quote valid for this order",
    })
    assert response.status_code == 201, response.text
    quote_id = response.json()["id"]

    response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
    assert response.status_code == 200, response.text
    buyer_view = response.json()
    assert buyer_view["supplier"]["call_phone"] == "254700000001"
    courier_quote = next(quote for quote in buyer_view["delivery_quotes"] if quote["id"] == quote_id)
    pickup_quote = next(quote for quote in buyer_view["delivery_quotes"] if quote["provider_type"] == "self_pickup")
    assert courier_quote["price_ksh"] == 325
    assert courier_quote["destination_address"] == "Test receiving market, Nairobi"
    assert pickup_quote["price_ksh"] == 0
    assert buyer_view["terms"]["product_amount_ksh"] == 2400
    assert buyer_view["terms"]["platform_fee_ksh"] >= 0

    response = await client.get(f"/api/orders/{movement_id}", headers=other)
    assert response.status_code == 404

    response = await client.post(f"/api/orders/{movement_id}/delivery-quotes/{quote_id}/select", headers=buyer)
    assert response.status_code == 200, response.text
    selected_view = response.json()
    assert selected_view["selected_quote_id"] == quote_id
    assert selected_view["terms"]["delivery_amount_ksh"] == 325
    assert selected_view["terms"]["total_amount_ksh"] == (
        selected_view["terms"]["product_amount_ksh"]
        + selected_view["terms"]["platform_fee_ksh"] + 325
    )

    # The selected courier can see the hand-off/tracking facts it needs, but
    # does not receive buyer payment amounts, provider references or contact data.
    response = await client.get(f"/api/orders/{movement_id}", headers=courier)
    assert response.status_code == 200, response.text
    provider_view = response.json()
    assert provider_view["direction"] == "fulfillment"
    assert provider_view["terms"]["product_amount_ksh"] is None
    assert provider_view["terms"]["platform_fee_ksh"] is None
    assert provider_view["terms"]["total_amount_ksh"] is None
    assert provider_view["payment"]["amount_ksh"] is None
    assert provider_view["payment"]["reference"] is None
    assert provider_view["payment"]["availability"] is None
    assert provider_view["buyer"]["call_phone"] is None
    assert provider_view["supplier"]["call_phone"] is None
    response = await client.get(f"/api/orders/{movement_id}", headers=supplier)
    assert response.status_code == 200, response.text
    assert response.json()["buyer"]["call_phone"] == "254700000002"
    assert provider_view["delivery_requests"] == []
    assert provider_view["disputes"] == []

    response = await client.post(f"/api/chat/orders/{movement_id}", headers=buyer)
    assert response.status_code in (200, 201), response.text
    room_id = response.json()["room_id"]
    assert response.json()["room"]["stock_movement_id"] == movement_id
    response = await client.post(f"/api/chat/orders/{movement_id}", headers=supplier)
    assert response.status_code in (200, 201), response.text
    assert response.json()["room_id"] == room_id
    response = await client.post(f"/api/chat/orders/{movement_id}", headers=courier)
    assert response.status_code == 404

    response = await client.post(f"/api/stock/movements/{movement_id}/ship", headers=supplier)
    assert response.status_code == 200, response.text
    response = await client.get(f"/api/orders/{movement_id}", headers=courier)
    provider_view = response.json()
    shipment = provider_view["tracking"]["shipments"][0]
    assert shipment["tracking_number"]
    assert shipment["destination"] == "Test receiving market, Nairobi"
    dispatched_cancel = await client.post(f"/api/stock/movements/{movement_id}/cancel", headers=buyer)
    assert dispatched_cancel.status_code == 409

    response = await client.post(
        f"/api/tools/shipments/{shipment['id']}/status",
        headers=courier,
        params={"status": "delivered"},
    )
    assert response.status_code == 409

    response = await client.post(f"/api/orders/{movement_id}/receipt-code", headers=buyer)
    assert response.status_code == 200, response.text
    code = response.json()["receipt_code"]
    response = await client.post(f"/api/orders/{movement_id}/receive", headers=courier, json={"receipt_code": code})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "received"
    assert response.json()["payment"]["status"] == "unpaid"
    assert response.json()["settlement"]["status"] == "not_applicable"


async def test_order_payment_requires_verified_provider_callback_and_refunds_through_support(client, monkeypatch):
    from app.config import settings
    from app.modules.orders import router as orders_router
    from app.services.payments import process_inbound_event
    from app.services.psp_client import mock_psp

    _supplier_token, supplier = await _register(client, "payment_supplier", ["produce"], "254711000001")
    _buyer_token, buyer = await _register(client, "payment_buyer", ["food"], "254711000002")
    movement_id = await _self_pickup_order(client, supplier, buyer)

    response = await client.post(
        f"/api/orders/{movement_id}/payments", headers=buyer,
        json={"phone": "254711000002", "provider": "MPESA"},
    )
    assert response.status_code == 503, response.text
    response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
    assert response.status_code == 200, response.text
    assert response.json()["payment"]["status"] == "unpaid"

    # This test-only override drives the callback path with the in-memory PSP;
    # it does not assert or represent real money movement or live-provider readiness.
    monkeypatch.setattr(orders_router, "_payment_readiness", lambda: {"enabled": True, "reason": None})
    monkeypatch.setattr(settings, "TRADE_PSP_SUB_ACCOUNT", "ORDER_TEST")
    _ops_token, ops = await _register(client, "payment_ops", ["support"])
    ops_profile = await client.get("/api/vendors/me", headers=ops)
    assert ops_profile.status_code == 200, ops_profile.text
    monkeypatch.setattr(settings, "MARKET_OPS_ROLES", f"admin:{ops_profile.json()['vendor_handle']}")

    psp = mock_psp()
    psp.paused = True
    try:
        response = await client.post(
            f"/api/orders/{movement_id}/payments", headers=buyer,
            json={"phone": "254711000002", "provider": "MPESA"},
        )
        assert response.status_code == 202, response.text
        payment_request = response.json()
        assert payment_request["status"] == "pending"

        response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
        assert response.json()["payment"]["status"] == "processing"
        forged_result = await process_inbound_event({
            "type": "payment.completed",
            "id": "unverified-payment-reference",
            "api_ref": payment_request["reference"],
            "amount": payment_request["amount_ksh"] + 1,
            "currency": "KES",
        })
        assert forged_result is False
        response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
        assert response.json()["payment"]["status"] == "processing"

        await psp.flush()
        psp.paused = False
        response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
        assert response.status_code == 200, response.text
        verified = response.json()
        assert verified["payment"]["status"] == "paid"
        assert verified["payment"]["amount_ksh"] == payment_request["amount_ksh"]
        assert verified["payment"]["receipt"]

        response = await client.post(f"/api/orders/{movement_id}/disputes", headers=buyer, json={
            "category": "payment_problem",
            "description": "Please review this verified marketplace payment.",
        })
        assert response.status_code == 201, response.text
        dispute_id = response.json()["id"]
        blocked_dispatch = await client.post(f"/api/stock/movements/{movement_id}/ship", headers=supplier)
        assert blocked_dispatch.status_code == 409

        forbidden = await client.get("/api/orders/support/disputes", headers=buyer)
        assert forbidden.status_code == 403

        response = await client.get("/api/orders/support/disputes", headers=ops)
        assert response.status_code == 200, response.text
        support_case = next(row for row in response.json() if row["id"] == dispute_id)
        assert support_case["movement_id"] == movement_id
        assert support_case["description"] == "Please review this verified marketplace payment."
        assert support_case["payment"]["status"] == "completed"
        assert support_case["payment"]["amount_ksh"] == payment_request["amount_ksh"]

        psp.paused = True
        response = await client.post(
            f"/api/orders/{movement_id}/disputes/{dispute_id}/resolve", headers=ops,
            json={"outcome": "refund", "resolution_note": "Refund the verified payment in full."},
        )
        assert response.status_code == 200, response.text
        assert response.json()["refund_status"] == "pending"
        await psp.flush()
        psp.paused = False

        response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
        assert response.status_code == 200, response.text
        refunded = response.json()
        assert refunded["payment"]["status"] == "refunded"
        assert refunded["payment"]["refunded_amount_ksh"] == payment_request["amount_ksh"]
        assert refunded["disputes"][0]["status"] == "resolved"
        assert refunded["disputes"][0]["outcome"] == "refunded"
        assert refunded["settlement"]["status"] == "refunded"
        refunded_dispatch = await client.post(f"/api/stock/movements/{movement_id}/ship", headers=supplier)
        assert refunded_dispatch.status_code == 409
    finally:
        psp.paused = False
        await psp.flush()


async def test_order_settlement_waits_for_receipt_and_provider_payout_callback(client, monkeypatch):
    from app.config import settings
    from app.modules.orders import router as orders_router
    from app.services.psp_client import mock_psp

    _supplier_token, supplier = await _register(client, "settle_supplier", ["produce"], "254712000001")
    _buyer_token, buyer = await _register(client, "settle_buyer", ["food"], "254712000002")
    movement_id = await _self_pickup_order(client, supplier, buyer)
    # This test uses only the in-memory PSP to exercise the settlement callback;
    # production readiness rejects the mock provider and defaults trade payments off.
    monkeypatch.setattr(orders_router, "_payment_readiness", lambda: {"enabled": True, "reason": None})
    monkeypatch.setattr(settings, "TRADE_PSP_SUB_ACCOUNT", "ORDER_SETTLEMENT_TEST")
    monkeypatch.setattr(settings, "TRADE_SETTLEMENT_ENABLED", True)

    psp = mock_psp()
    psp.paused = True
    try:
        response = await client.post(
            f"/api/orders/{movement_id}/payments", headers=buyer,
            json={"phone": "254712000002", "provider": "MPESA"},
        )
        assert response.status_code == 202, response.text
        payment_request = response.json()
        await psp.flush()
        psp.paused = False

        response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
        assert response.status_code == 200, response.text
        assert response.json()["payment"]["status"] == "paid"
        assert response.json()["settlement"]["status"] == "not_started"

        response = await client.post(f"/api/stock/movements/{movement_id}/ship", headers=supplier)
        assert response.status_code == 200, response.text
        code_response = await client.post(f"/api/orders/{movement_id}/receipt-code", headers=buyer)
        assert code_response.status_code == 200, code_response.text

        psp.paused = True
        response = await client.post(
            f"/api/orders/{movement_id}/receive", headers=supplier,
            json={"receipt_code": code_response.json()["receipt_code"]},
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "received"
        assert response.json()["payment"]["status"] == "paid"
        assert response.json()["settlement"]["status"] == "pending"
        assert response.json()["settlement"]["payouts"][0]["status"] == "queued"
        await psp.flush()
        psp.paused = False

        response = await client.get(f"/api/orders/{movement_id}", headers=supplier)
        assert response.status_code == 200, response.text
        settled = response.json()
        assert settled["settlement"]["status"] == "settled"
        assert settled["settlement"]["payouts"][0]["status"] == "completed"
        assert settled["settlement"]["payouts"][0]["amount_ksh"] == (
            settled["terms"]["product_amount_ksh"] - settled["terms"]["platform_fee_ksh"]
        )
    finally:
        psp.paused = False
        await psp.flush()

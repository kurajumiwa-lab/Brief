"""P0: repeat an existing trade, confirm handover, own a portable record.

These exercise real Postgres row locking, vendor isolation, snapshots and CSV.
"""

import asyncio
import csv
import io
import uuid

import pytest

from app.config import Settings, settings
from app.modules.orders.router import _payment_readiness
from tests.order_helpers import complete_self_pickup
from tests.test_live_order_journey import _register

pytestmark = pytest.mark.asyncio


def repeat_body(movement_id, quantity=2, proposed_price=None):
    body = {"source_movement_id": movement_id, "quantity": quantity}
    if proposed_price is not None:
        body["proposed_price"] = proposed_price
    return body


async def seed_completed_trade(client, supplier, buyer, *, name="Fresh cassava", unit_price=240.25):
    stock = await client.post("/api/stock/add", headers=supplier, json={
        "name": name, "sku": f"REC-{uuid.uuid4().hex[:8]}", "category": "produce",
        "quantity_in_stock": 12, "unit_of_measure": "crate", "unit_price": unit_price,
    })
    assert stock.status_code == 201, stock.text
    stock_id = stock.json()["stock_id"]
    source = await client.post(f"/api/stock/{stock_id}/source", headers=buyer, json={"quantity": 2})
    assert source.status_code == 201, source.text
    movement_id = source.json()["movement_id"]
    await complete_self_pickup(client, movement_id, supplier, buyer)
    return stock_id, movement_id


async def test_repeat_is_scoped_idempotent_and_rechecks_stock(client):
    _, supplier = await _register(client, "repeat_supplier", ["produce"])
    _, buyer = await _register(client, "repeat_buyer", ["food"])
    _, stranger = await _register(client, "repeat_stranger", ["food"])
    stock_id, old_id = await seed_completed_trade(client, supplier, buyer)

    prior = await client.get("/api/orders/repeatable", headers=buyer)
    assert prior.status_code == 200, prior.text
    candidate = next(row for row in prior.json() if row["source_movement_id"] == old_id)
    assert candidate["quantity"] == 2
    assert candidate["last_unit_price_kes"] == 240.25
    assert candidate["last_total_kes"] == 481  # ROUND_HALF_UP, not banker's rounding
    assert candidate["unavailable_reason"] is None
    assert (await client.get("/api/orders/repeatable", headers=stranger)).json() == []
    assert (await client.post("/api/orders/repeat", headers=stranger, json=repeat_body(old_id),
                              )).status_code == 400  # missing key is always rejected

    headers = {**buyer, "Idempotency-Key": uuid.uuid4().hex}
    first = await client.post("/api/orders/repeat", headers=headers, json=repeat_body(old_id))
    second = await client.post("/api/orders/repeat", headers=headers, json=repeat_body(old_id))
    assert first.status_code == 201, first.text
    assert second.status_code == 200, second.text
    assert second.json()["movement_id"] == first.json()["movement_id"]
    assert first.json()["status"] == "pending"
    assert second.json()["replayed"] is True
    different = await client.post("/api/orders/repeat", headers=headers, json=repeat_body(old_id, 3))
    assert different.status_code == 409
    assert "Idempotency-Key" in different.json()["detail"]

    wrong_buyer = await client.post("/api/orders/repeat", headers={**stranger, "Idempotency-Key": uuid.uuid4().hex}, json=repeat_body(old_id))
    assert wrong_buyer.status_code == 404
    source = await client.get(f"/api/orders/{first.json()['movement_id']}", headers=buyer)
    assert source.json()["terms"]["product_amount_ksh"] == 481
    assert "order_repeated" in [e["type"] for e in source.json()["events"]]

    # The previously displayed availability is not a reservation. Recheck it
    # at submit time under a stock-row lock and refuse without creating a row.
    update = await client.put(f"/api/stock/{stock_id}", headers=supplier, json={"quantity_in_stock": 3})
    assert update.status_code == 200, update.text
    too_much = await client.post("/api/orders/repeat", headers={**buyer, "Idempotency-Key": uuid.uuid4().hex}, json=repeat_body(old_id, 10))
    assert too_much.status_code == 409
    assert "Only 1 crate left; adjust quantity" == too_much.json()["detail"]
    count = (await client.get("/api/orders/records", headers=buyer)).json()["summary"]
    assert count == {"recorded": 2, "received": 1, "needs_action": 0}

    delist = await client.delete(f"/api/stock/{stock_id}", headers=supplier)
    assert delist.status_code == 400  # the repeat reservation is still open
    await client.post(f"/api/stock/movements/{first.json()['movement_id']}/cancel", headers=buyer)
    delist = await client.delete(f"/api/stock/{stock_id}", headers=supplier)
    assert delist.status_code == 200
    candidates = await client.get("/api/orders/repeatable", headers=buyer)
    assert "delisted" in candidates.json()[0]["unavailable_reason"]
    disabled = await client.post("/api/orders/repeat", headers={**buyer, "Idempotency-Key": uuid.uuid4().hex}, json=repeat_body(old_id))
    assert disabled.status_code == 409


async def test_simultaneous_double_tap_is_one_movement(client):
    _, supplier = await _register(client, "repeat_lock_supplier", ["produce"])
    _, buyer = await _register(client, "repeat_lock_buyer", ["food"])
    _, old_id = await seed_completed_trade(client, supplier, buyer)
    headers = {**buyer, "Idempotency-Key": uuid.uuid4().hex}
    responses = await asyncio.gather(*(
        client.post("/api/orders/repeat", headers=headers, json=repeat_body(old_id)) for _ in range(2)
    ))
    assert sorted(r.status_code for r in responses) == [200, 201], [r.text for r in responses]
    assert responses[0].json()["movement_id"] == responses[1].json()["movement_id"]
    assert (await client.get("/api/orders/records", headers=buyer)).json()["summary"]["recorded"] == 2


async def test_trade_records_export_is_private_paged_and_payment_honest(client):
    _, supplier = await _register(client, "record_supplier", ["produce"])
    _, buyer = await _register(client, "record_buyer", ["food"])
    _, stranger = await _register(client, "record_stranger", ["food"])
    stock_id, old_id = await seed_completed_trade(client, supplier, buyer, name="=2+2 crate")
    # Today's shelf price changes. The old amount and unit price in the
    # recorded trade must stay unchanged in the screen and exported page.
    update = await client.put(f"/api/stock/{stock_id}", headers=supplier, json={"unit_price": 260})
    assert update.status_code == 200
    candidate = (await client.get("/api/orders/repeatable", headers=buyer)).json()[0]
    assert candidate["last_unit_price_kes"] == 240.25
    assert candidate["current_unit_price_kes"] == 260
    assert candidate["last_total_kes"] == 481

    page = await client.get("/api/orders/records", headers=buyer, params={"limit": 1})
    assert page.status_code == 200, page.text
    assert page.json()["summary"] == {"recorded": 1, "received": 1, "needs_action": 0}
    record = page.json()["items"][0]
    assert record["id"] == old_id
    assert record["goods_status"] == "received"
    assert record["settlement_status"] == "not_applicable"
    assert record["unit_price_kes"] == 240.25
    assert record["total_kes"] == 481

    export = await client.get("/api/orders/records.csv", headers=buyer, params={"limit": 1})
    assert export.status_code == 200, export.text
    assert "attachment" in export.headers["content-disposition"]
    assert "no-store" in export.headers["cache-control"]
    rows = list(csv.reader(io.StringIO(export.text)))
    assert "not a receipt, an invoice, or a tax document" in rows[0][0]
    assert rows[1] == ["date", "reference", "counterparty handle", "item", "quantity", "unit",
                       "unit price KES", "total KES", "goods status", "settlement status"]
    assert rows[2][1] == old_id
    assert rows[2][3] == "'=2+2 crate"  # CSV/spreadsheet formula injection escaped
    assert rows[2][6:] == ["240.25", "481", "received", "not_applicable"]
    assert export.text.count(old_id) == 1
    assert "receipt_code" not in export.text

    other = await client.get("/api/orders/records", headers=stranger)
    assert other.json()["items"] == [] and other.json()["summary"]["recorded"] == 0
    assert (await client.get("/api/orders/records", headers=buyer, params={"cursor": "bad!"})).status_code == 400
    assert (await client.get("/api/orders/records", headers=buyer, params={"q": "100%"})).json()["items"] == []
    assert (await client.get("/api/orders/records", headers=buyer, params={"q": "=2+2"})).json()["items"][0]["id"] == old_id
    assert (await client.get("/api/orders/records", headers=buyer, params={"q": "record_supplier"})).json()["items"][0]["id"] == old_id
    assert (await client.get("/api/orders/records", headers=buyer, params={"q": "@record_supplier"})).json()["items"][0]["id"] == old_id
    assert (await client.get("/api/orders/records", headers=buyer, params={"q": "record_buyer"})).json()["items"] == []

    next_order = await client.post("/api/orders/repeat", headers={**buyer, "Idempotency-Key": uuid.uuid4().hex}, json=repeat_body(old_id))
    assert next_order.status_code == 201
    first = (await client.get("/api/orders/records", headers=buyer, params={"limit": 1})).json()
    assert first["next_cursor"]
    next_page = (await client.get("/api/orders/records", headers=buyer, params={"limit": 1, "cursor": first["next_cursor"]})).json()
    assert next_page["items"][0]["id"] == old_id
    csv_page = await client.get("/api/orders/records.csv", headers=buyer, params={"limit": 1, "cursor": first["next_cursor"]})
    assert list(csv.reader(io.StringIO(csv_page.text)))[2][1] == old_id


async def test_default_order_money_guard_cannot_charge_a_real_rail(client, monkeypatch):
    # CI fails if a default flips. An actual HTTP payment attempt must fail
    # before creating a collection intent or contacting any PSP, not just
    # report a disabled button in the frontend.
    defaults = Settings.model_fields
    assert defaults["TRADE_PAYMENTS_ENABLED"].default is False
    assert defaults["TRADE_SETTLEMENT_ENABLED"].default is False
    assert defaults["TRADE_PLATFORM_FEE_RATE"].default == 0.0
    assert defaults["TRADE_PSP_SUB_ACCOUNT"].default == ""
    assert defaults["PSP_PROVIDER"].default == "mock"
    assert settings.TRADE_PAYMENTS_ENABLED is False
    assert settings.TRADE_SETTLEMENT_ENABLED is False
    assert settings.TRADE_PLATFORM_FEE_RATE == 0.0
    assert settings.PSP_PROVIDER == "mock"
    assert settings.TRADE_PSP_SUB_ACCOUNT == ""
    assert _payment_readiness()["enabled"] is False

    from app.services import payments

    async def unexpected_money_movement(*args, **kwargs):
        raise AssertionError("A disabled trade attempted to create an intent or call a provider")

    monkeypatch.setattr(payments, "create_collection_intent", unexpected_money_movement)
    monkeypatch.setattr(payments, "start_collection", unexpected_money_movement)
    _, supplier = await _register(client, "guard_supplier", ["produce"])
    _, buyer = await _register(client, "guard_buyer", ["food"])
    stock = await client.post("/api/stock/add", headers=supplier, json={
        "name": "Guarded stock", "sku": f"NO-MONEY-{uuid.uuid4().hex[:6]}",
        "category": "produce", "quantity_in_stock": 5,
        "unit_of_measure": "crate", "unit_price": 100,
    })
    assert stock.status_code == 201, stock.text
    movement = await client.post(f"/api/stock/{stock.json()['stock_id']}/source", headers=buyer, json={"quantity": 1})
    assert movement.status_code == 201, movement.text
    order_id = movement.json()["movement_id"]
    confirmed = await client.post(f"/api/stock/movements/{order_id}/confirm", headers=supplier)
    assert confirmed.status_code == 200, confirmed.text
    attempt = await client.post(f"/api/orders/{order_id}/payments", headers=buyer, json={"phone": "254700000001"})
    assert attempt.status_code == 503, attempt.text
    assert attempt.json()["detail"] == _payment_readiness()["reason"]

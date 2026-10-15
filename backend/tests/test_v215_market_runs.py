"""v2.15 — Market Runs: Ruiru Fresh, Githurai Sukari, Daraja Mbili.

Acceptance criteria:

    1. Templates describe Run A (fresh, cold chain), Run B (sugar, bags vs
       repacked retail) and Daraja Mbili consolidated supply (outside the
       walkable ring) with the three funding models.
    2. Ordering is open: a vendor whose registered zone is elsewhere (or
       nowhere) orders into a Daraja run, chooses pay-on-delivery, and is
       not blocked — fees and money responsibility ride on the order.
    3. Request ≠ confirmed ≠ purchase: pooled demand counts requests,
       confirmed demand counts only confirmed orders, and the wholesale
       threshold is a third figure.
    4. A family order (2 kg, repack) and a shop order (20 bags) pool into
       one product line while keeping separate quantities and prices basis.
    5. The ledger records actual purchase price + receipt, weight loss and
       rejected stock, transport costs, allocation, amount paid and the
       balance due; profit = revenue − supplier cost − expenses.
    6. Shop-backed collection names the shop, which can hand over and
       record the on-delivery payment; large on-delivery orders are
       flagged with a deposit recommendation, never refused.
    7. A fresh run without a cold-chain plan is refused.
"""

import uuid
from datetime import datetime, timedelta

import pytest

pytestmark = pytest.mark.asyncio

PASSWORD = "Correct-horse-9"


async def _register(client, prefix="run"):
    suffix = uuid.uuid4().hex[:8]
    handle = f"{prefix}_{suffix}"
    res = await client.post("/api/auth/register", json={
        "business_name": f"Business {suffix[:4]}",
        "vendor_handle": handle,
        "email": f"{handle}@example.com",
        "phone": "254712345678",
        "password": PASSWORD,
        "business_categories": ["groceries"],
        "physical_location": "Kisumu outskirts",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, handle


async def _run(client, headers, **overrides):
    deadline = (datetime.utcnow() + timedelta(hours=12)).isoformat()
    payload = {
        "title": "Daraja Mbili — supply & collection hub",
        "market_name": "Daraja Mbili", "market_city": "Kisumu",
        "run_kind": "consolidated_supply",
        "run_date": (datetime.utcnow() + timedelta(days=1)).date().isoformat(),
        "order_deadline": deadline, "funding_model": "mixed_open",
    }
    payload.update(overrides)
    res = await client.post("/api/locks/runs", headers=headers, json=payload)
    assert res.status_code == 201, res.text
    return res.json()


async def _order(client, headers, run_id, **overrides):
    payload = {
        "product_name": "Sugar", "unit_of_measure": "kg", "quantity": 2,
        "participant_type": "family", "payment_method": "cash_on_delivery",
        "delivery_mode": "home_delivery", "delivery_area": "Outside the ring — Migosi",
        "estimated_unit_price": 180,
    }
    payload.update(overrides)
    res = await client.post(f"/api/locks/runs/{run_id}/orders", headers=headers, json=payload)
    assert res.status_code == 201, res.text
    return res.json()


async def test_templates_cover_Ruiru_githurai_and_daraja(client):
    headers, _ = await _register(client, "tpl")
    res = await client.get("/api/locks/runs/templates", headers=headers)
    assert res.status_code == 200, res.text
    templates = {t["key"]: t for t in res.json()["templates"]}
    assert templates["Ruiru_fresh"]["cold_chain_required"] is True
    assert "insulated" in templates["Ruiru_fresh"]["cold_chain_plan"].lower()
    assert templates["githurai_sukari"]["products"][0] == "Sugar"
    assert "outside" in templates["daraja_consolidated"]["audience"].lower()
    funding = {f["key"] for f in res.json()["funding_models"]}
    assert {"customer_advance", "buyer_capital", "shop_consolidated"} <= funding
    methods = {p["key"] for p in res.json()["payment_methods"]}
    assert {"advance_mpesa", "cash_on_delivery", "shop_backed_collection"} <= methods


async def test_open_ordering_outside_zone_with_pay_on_delivery(client):
    buyer, _ = await _register(client, "byr")
    family, _ = await _register(client, "fam")  # registered nowhere near Daraja
    run = await _run(client, buyer)
    order = await _order(client, family, run["id"])
    assert order["status"] == "requested"
    assert order["payment_method"] == "cash_on_delivery"
    assert order["money_responsibility"] == "customer"
    assert order["delivery_area"].startswith("Outside the ring")
    assert order["deposit_recommended"] is False  # small order, no flag


async def test_request_confirmed_and_threshold_are_three_figures(client):
    buyer, _ = await _register(client, "byr")
    family, _ = await _register(client, "fam")
    shop, _ = await _register(client, "shp")
    run = await _run(client, buyer)

    fam_order = await _order(client, family, run["id"], quantity=2, package_size="2 kg packet",
                             repack_required=True)
    shop_order = await _order(client, shop, run["id"], quantity=20, participant_type="shop",
                              package_size="50 kg bag", wholesale_package=True,
                              payment_method="advance_mpesa")

    res = await client.get(f"/api/locks/runs/{run['id']}/ledger", headers=buyer)
    product = res.json()["ledger"]["products"][0]
    assert product["total_pooled_demand"] == 22       # both requests counted
    assert product["confirmed_purchasing_demand"] == 0  # nothing confirmed yet
    assert product["family_quantity"] == 2 and product["shop_quantity"] == 20

    # Only the shop confirms — confirmed demand is the buying list.
    res = await client.post(f"/api/locks/runs/orders/{shop_order['id']}/confirm", headers=shop)
    assert res.status_code == 200 and res.json()["status"] == "confirmed"
    # The family cannot confirm someone else's order, and vice versa.
    res = await client.post(f"/api/locks/runs/orders/{fam_order['id']}/confirm", headers=shop)
    assert res.status_code == 403, res.text

    res = await client.get(f"/api/locks/runs/{run['id']}/ledger", headers=buyer)
    product = res.json()["ledger"]["products"][0]
    assert product["total_pooled_demand"] == 22
    assert product["confirmed_purchasing_demand"] == 20


async def test_full_run_ledger_purchase_allocation_payment_and_profit(client):
    buyer, buyer_handle = await _register(client, "byr")
    shop, _ = await _register(client, "shp")
    run = await _run(client, buyer)
    order = await _order(client, shop, run["id"], quantity=20, participant_type="shop",
                         package_size="50 kg bag", wholesale_package=True,
                         payment_method="mpesa_on_delivery", estimated_unit_price=7000,
                         unit_of_measure="bag")
    await client.post(f"/api/locks/runs/orders/{order['id']}/confirm", headers=shop)

    # Buyer purchases at an actual price, keeps the receipt, records loss.
    res = await client.post(f"/api/locks/runs/{run['id']}/purchases", headers=buyer, json={
        "product_name": "Sugar", "unit_of_measure": "bag", "quantity_purchased": 20,
        "actual_unit_price": 6500, "receipt_ref": "receipt book 4 p.12",
        "supplier_name": "Githurai wholesale", "weight_loss_quantity": 0, "rejected_quantity": 1})
    assert res.status_code == 201, res.text
    assert res.json()["usable_quantity"] == 19

    # A non-buyer cannot allocate.
    res = await client.post(f"/api/locks/runs/orders/{order['id']}/allocate",
                            headers=shop, json={"quantity_allocated": 19})
    assert res.status_code == 403, res.text

    res = await client.post(f"/api/locks/runs/orders/{order['id']}/allocate",
                            headers=buyer, json={"quantity_allocated": 19, "delivery_fee_kes": 500})
    assert res.status_code == 200, res.text
    allocated = res.json()
    assert allocated["actual_unit_price"] == 6500
    assert allocated["final_amount_kes"] == 19 * 6500 + 500
    assert allocated["balance_due_kes"] == allocated["final_amount_kes"]

    await client.post(f"/api/locks/runs/{run['id']}/expenses", headers=buyer, json={
        "kind": "transport", "amount_kes": 3000, "receipt_ref": "fuel receipt 88"})
    # Customer pays on delivery (M-Pesa), recorded by the buyer at handover.
    res = await client.post(f"/api/locks/runs/orders/{order['id']}/payments",
                            headers=buyer, json={"amount_kes": allocated["final_amount_kes"],
                                                 "note": "M-Pesa on delivery"})
    assert res.json()["payment_status"] == "paid" and res.json()["balance_due_kes"] == 0
    res = await client.post(f"/api/locks/runs/orders/{order['id']}/handover",
                            headers=buyer, json={"outcome": "delivered"})
    assert res.json()["status"] == "delivered"

    res = await client.get(f"/api/locks/runs/{run['id']}/ledger", headers=buyer)
    totals = res.json()["ledger"]["totals"]
    assert totals["supplier_cost_kes"] == 20 * 6500
    assert totals["amount_collected_kes"] == allocated["final_amount_kes"]
    assert totals["estimated_profit_kes"] == totals["selling_revenue_kes"] - totals["supplier_cost_kes"] - 3000
    assert res.json()["ledger"]["fulfilment"]["received_and_paid_rate"] == 100.0
    assert res.json()["orders"][0]["payment_note"] == "M-Pesa on delivery"


async def test_shop_backed_collection_and_large_order_flag_not_block(client):
    buyer, _ = await _register(client, "byr")
    family, _ = await _register(client, "fam")
    _, collection_handle = await _register(client, "col")
    run = await _run(client, buyer)

    # Shop-backed without naming the shop is the one refusal — no one to hold the goods.
    res = await client.post(f"/api/locks/runs/{run['id']}/orders", headers=family, json={
        "product_name": "Rice", "unit_of_measure": "bag", "quantity": 1,
        "payment_method": "shop_backed_collection"})
    assert res.status_code == 400, res.text

    order = await _order(client, family, run["id"], product_name="Rice", quantity=2,
                         unit_of_measure="bag", estimated_unit_price=6000,
                         payment_method="shop_backed_collection",
                         collection_point_handle=collection_handle,
                         delivery_mode="collect_at_shop")
    assert order["money_responsibility"] == "shop"
    assert order["collection_point_handle"] == collection_handle

    # A large pay-on-delivery order is flagged with a recommendation — and accepted.
    big = await _order(client, family, run["id"], product_name="Cooking oil", quantity=30,
                       unit_of_measure="carton", estimated_unit_price=2500,
                       payment_method="cash_on_delivery")
    assert big["deposit_recommended"] is True
    assert "never required" in big["deposit_note"]


async def test_fresh_run_requires_cold_chain_plan(client):
    buyer, _ = await _register(client, "byr")
    deadline = (datetime.utcnow() + timedelta(hours=6)).isoformat()
    res = await client.post("/api/locks/runs", headers=buyer, json={
        "title": "Run A — Ruiru Fresh Market", "market_name": "Ruiru Fresh Market",
        "market_city": "Ruiru", "run_kind": "fresh_market",
        "run_date": (datetime.utcnow() + timedelta(days=1)).date().isoformat(),
        "order_deadline": deadline})
    assert res.status_code == 400, res.text
    assert "cold" in res.text.lower()

    run = await _run(client, buyer, title="Run A — Ruiru Fresh Market",
                     market_name="Ruiru Fresh Market", market_city="Ruiru",
                     run_kind="fresh_market",
                     cold_chain_plan="Insulated boxes with ice; fish allocated first.")
    assert run["cold_chain_required"] is True
    order = await _order(client, buyer, run["id"], product_name="Fish", quantity=5.5,
                         unit_of_measure="kg", estimated_unit_price=600)
    assert order["quantity"] == 5.5  # kilograms are never rounded to whole units

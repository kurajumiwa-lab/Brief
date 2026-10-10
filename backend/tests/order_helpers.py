"""Small, explicit helpers for the required pre-travel order journey tests."""


async def complete_self_pickup(client, movement_id, supplier, buyer, *, already_confirmed=False):
    if not already_confirmed:
        response = await client.post(
            f"/api/stock/movements/{movement_id}/confirm", headers=supplier,
        )
        assert response.status_code == 200, response.text

    response = await client.put(
        f"/api/orders/{movement_id}/pickup",
        headers=supplier,
        json={
            "address": "Test market, stall 12, Nairobi",
            "pickup_hours": "Supplier-confirmed collection hours",
            "instructions": "Ask for the supplier at the listed stall",
            "ready_for_collection": True,
        },
    )
    assert response.status_code == 200, response.text

    response = await client.get(f"/api/orders/{movement_id}", headers=buyer)
    assert response.status_code == 200, response.text
    order = response.json()
    quote = next(q for q in order["delivery_quotes"] if q["provider_type"] == "self_pickup")
    assert quote["ready_for_collection"] is True
    response = await client.post(
        f"/api/orders/{movement_id}/delivery-quotes/{quote['id']}/select",
        headers=buyer,
    )
    assert response.status_code == 200, response.text

    response = await client.post(f"/api/stock/movements/{movement_id}/ship", headers=supplier)
    assert response.status_code == 200, response.text
    response = await client.post(f"/api/orders/{movement_id}/receipt-code", headers=buyer)
    assert response.status_code == 200, response.text
    receipt_code = response.json()["receipt_code"]

    response = await client.post(
        f"/api/orders/{movement_id}/receive",
        headers=supplier,
        json={"receipt_code": receipt_code},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "received"
    return response.json()

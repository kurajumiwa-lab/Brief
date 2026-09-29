"""
Square adapter — reads the catalog and inventory counts with a Square access
token that never leaves the shop computer. (The server can also pull Square
directly if you store the token in the connection; this adapter is for vendors
who would rather keep it local.)
"""

from __future__ import annotations

import httpx

from .base import POSAdapter, StockRow

SQUARE_API = "https://connect.squareup.com/v2"
SQUARE_VERSION = "2023-12-13"


class SquareAdapter(POSAdapter):
    name = "square"

    def __init__(self, access_token: str, location_id: str | None = None, **options):
        super().__init__(location_id=location_id, **options)
        self.token = access_token
        self.location_id = location_id
        self.client = httpx.Client(
            base_url=SQUARE_API, timeout=30,
            headers={"Authorization": f"Bearer {access_token}", "Square-Version": SQUARE_VERSION, "Content-Type": "application/json"},
        )

    def _catalog(self) -> list[dict]:
        objects, cursor = [], None
        while True:
            params = {"types": "ITEM"}
            if cursor:
                params["cursor"] = cursor
            r = self.client.get("/catalog/list", params=params)
            r.raise_for_status()
            data = r.json()
            objects.extend(data.get("objects", []))
            cursor = data.get("cursor")
            if not cursor:
                return objects

    def _counts(self, variation_ids: list[str]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for i in range(0, len(variation_ids), 100):
            body = {"catalog_object_ids": variation_ids[i:i + 100], "states": ["IN_STOCK"]}
            if self.location_id:
                body["location_ids"] = [self.location_id]
            r = self.client.post("/inventory/counts/batch-retrieve", json=body)
            r.raise_for_status()
            for c in r.json().get("counts", []):
                counts[c["catalog_object_id"]] = counts.get(c["catalog_object_id"], 0) + int(float(c.get("quantity", "0")))
        return counts

    def read(self):
        items = self._catalog()
        variations = [v for it in items for v in it.get("item_data", {}).get("variations", [])]
        counts = self._counts([v["id"] for v in variations])
        for it in items:
            item_data = it.get("item_data", {})
            for v in item_data.get("variations", []):
                vd = v.get("variation_data", {})
                money = vd.get("price_money") or {}
                name = item_data.get("name", "")
                if vd.get("name") and vd["name"].lower() not in ("regular", "default"):
                    name = f"{name} - {vd['name']}"
                yield StockRow(
                    name=name,
                    sku=vd.get("sku") or None,
                    pos_item_id=v["id"],
                    quantity=counts.get(v["id"], 0),
                    unit_price=(money.get("amount") or 0) / 100.0,
                    category=(item_data.get("category_id") or None),
                    description=item_data.get("description"),
                )

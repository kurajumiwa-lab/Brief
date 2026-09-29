"""
Shopify adapter — products + variants + inventory levels through the Admin
REST API with a private-app access token (shpat_...).
"""

from __future__ import annotations

import httpx

from .base import POSAdapter, StockRow

API_VERSION = "2024-01"


class ShopifyAdapter(POSAdapter):
    name = "shopify"

    def __init__(self, shop_domain: str, access_token: str, **options):
        super().__init__(shop_domain=shop_domain, **options)
        domain = shop_domain.replace("https://", "").replace("http://", "").strip("/")
        self.client = httpx.Client(
            base_url=f"https://{domain}/admin/api/{API_VERSION}", timeout=30,
            headers={"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"},
        )

    def _products(self) -> list[dict]:
        products, url = [], "/products.json?limit=250&status=active"
        while url:
            r = self.client.get(url)
            r.raise_for_status()
            products.extend(r.json().get("products", []))
            link = r.headers.get("Link", "")
            url = None
            for part in link.split(","):
                if 'rel="next"' in part:
                    url = part[part.find("<") + 1:part.find(">")].split("/admin/api/" + API_VERSION)[-1]
        return products

    def read(self):
        for p in self._products():
            for v in p.get("variants", []):
                name = p.get("title", "")
                if v.get("title") and v["title"] != "Default Title":
                    name = f"{name} - {v['title']}"
                yield StockRow(
                    name=name,
                    sku=v.get("sku") or None,
                    pos_item_id=str(v.get("id")),
                    quantity=int(v.get("inventory_quantity") or 0),
                    unit_price=self._num(v.get("price")),
                    cost_price=None,
                    category=p.get("product_type") or None,
                    description=None,
                    tags=[t.strip() for t in (p.get("tags") or "").split(",") if t.strip()],
                )

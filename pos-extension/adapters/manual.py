"""
Manual adapter — a JSON file you edit by hand or generate from a spreadsheet:

    [{"name": "Sukuma wiki", "sku": "SUK-1", "quantity": 80, "unit_price": 30}, ...]
"""

from __future__ import annotations

import json
from pathlib import Path

from .base import POSAdapter, StockRow


class ManualAdapter(POSAdapter):
    name = "manual"

    def __init__(self, file: str = "stock.json", **options):
        super().__init__(file=file, **options)
        self.path = Path(file)

    def read(self):
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("items", [])
        for entry in data:
            if not entry.get("name"):
                continue
            yield StockRow(
                name=entry["name"],
                sku=entry.get("sku"),
                pos_item_id=entry.get("pos_item_id"),
                quantity=self._int(entry.get("quantity")),
                unit_price=self._num(entry.get("unit_price")),
                wholesale_price=self._num(entry.get("wholesale_price"), None),
                cost_price=self._num(entry.get("cost_price"), None),
                category=entry.get("category"),
                description=entry.get("description"),
                unit_of_measure=entry.get("unit_of_measure") or "pieces",
                tags=list(entry.get("tags") or []),
                visible_to_network=bool(entry.get("visible_to_network", True)),
            )

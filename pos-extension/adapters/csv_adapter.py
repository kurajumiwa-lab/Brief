"""
CSV adapter — the universal fallback. Point it at the file your till exports.

Recognised headers (case-insensitive, first match wins):
  name | item | product | description
  sku | code | barcode | item_code
  quantity | qty | stock | on_hand | in_stock
  unit_price | price | retail | selling_price
  wholesale_price | wholesale | trade_price
  cost_price | cost | buying_price
  category | department | group
  unit | uom | unit_of_measure
  tags  (pipe- or comma-separated)
"""

from __future__ import annotations

import csv
from pathlib import Path

from .base import POSAdapter, StockRow

ALIASES = {
    "name": ["name", "item", "product", "item_name", "product_name", "description"],
    "sku": ["sku", "code", "barcode", "item_code", "product_code"],
    "quantity": ["quantity", "qty", "stock", "on_hand", "in_stock", "quantity_in_stock"],
    "unit_price": ["unit_price", "price", "retail", "retail_price", "selling_price"],
    "wholesale_price": ["wholesale_price", "wholesale", "trade_price"],
    "cost_price": ["cost_price", "cost", "buying_price", "purchase_price"],
    "category": ["category", "department", "group", "type"],
    "unit_of_measure": ["unit", "uom", "unit_of_measure"],
    "tags": ["tags", "labels"],
    "pos_item_id": ["pos_item_id", "id", "item_id"],
}


class CSVAdapter(POSAdapter):
    name = "csv"

    def __init__(self, file: str, encoding: str = "utf-8-sig", **options):
        super().__init__(file=file, encoding=encoding, **options)
        self.path = Path(file)
        self.encoding = encoding

    def _pick(self, row: dict, field: str):
        for alias in ALIASES[field]:
            for key in row:
                if key and key.strip().lower() == alias:
                    return row[key]
        return None

    def read(self):
        if not self.path.exists():
            raise FileNotFoundError(f"CSV export not found: {self.path}")
        with self.path.open(newline="", encoding=self.encoding) as fh:
            for raw in csv.DictReader(fh):
                name = (self._pick(raw, "name") or "").strip()
                if not name:
                    continue
                tags_raw = (self._pick(raw, "tags") or "").replace("|", ",")
                yield StockRow(
                    name=name,
                    sku=(self._pick(raw, "sku") or "").strip() or None,
                    pos_item_id=(self._pick(raw, "pos_item_id") or "").strip() or None,
                    quantity=self._int(self._pick(raw, "quantity")),
                    unit_price=self._num(self._pick(raw, "unit_price")),
                    wholesale_price=self._num(self._pick(raw, "wholesale_price"), None),
                    cost_price=self._num(self._pick(raw, "cost_price"), None),
                    category=(self._pick(raw, "category") or "").strip() or None,
                    unit_of_measure=(self._pick(raw, "unit_of_measure") or "pieces").strip() or "pieces",
                    tags=[t.strip() for t in tags_raw.split(",") if t.strip()],
                )

    def fingerprint(self, rows):
        # Cheap change detection: file mtime + size, then content.
        stat = self.path.stat()
        return f"{stat.st_mtime_ns}:{stat.st_size}:{super().fingerprint(rows)}"

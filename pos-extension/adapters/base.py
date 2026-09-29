from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Iterable, Optional


@dataclass
class StockRow:
    name: str
    quantity: int = 0
    unit_price: float = 0.0
    sku: Optional[str] = None
    pos_item_id: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    unit_of_measure: str = "pieces"
    wholesale_price: Optional[float] = None
    cost_price: Optional[float] = None
    tags: list[str] = field(default_factory=list)
    visible_to_network: bool = True

    def to_payload(self) -> dict:
        d = asdict(self)
        d["quantity"] = max(0, int(d["quantity"] or 0))
        d["unit_price"] = float(d["unit_price"] or 0.0)
        return d


class POSAdapter:
    """Base class. Subclasses implement `read()` and may override `fingerprint()`
    so the daemon only pushes when something changed."""

    name = "base"

    def __init__(self, **options):
        self.options = options

    def read(self) -> Iterable[StockRow]:
        raise NotImplementedError

    def fingerprint(self, rows: list[StockRow]) -> str:
        blob = json.dumps([r.to_payload() for r in rows], sort_keys=True).encode()
        return hashlib.sha256(blob).hexdigest()

    @staticmethod
    def _num(value, default=0.0) -> float:
        if value in (None, ""):
            return default
        try:
            return float(str(value).replace(",", "").strip())
        except ValueError:
            return default

    @staticmethod
    def _int(value, default=0) -> int:
        try:
            return int(round(POSAdapter._num(value, default)))
        except (TypeError, ValueError):
            return default

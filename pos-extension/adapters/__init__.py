"""
POS adapters. Each adapter turns one till's data into the row shape the
Brief_ push endpoint accepts:

    {"name": str, "sku": str|None, "pos_item_id": str|None, "category": str|None,
     "quantity": int, "unit_price": float, "wholesale_price": float|None,
     "cost_price": float|None, "unit_of_measure": str, "tags": [str], "description": str|None}
"""

from .base import POSAdapter, StockRow
from .csv_adapter import CSVAdapter
from .manual import ManualAdapter
from .shopify import ShopifyAdapter
from .square import SquareAdapter

ADAPTERS = {
    "csv": CSVAdapter,
    "manual": ManualAdapter,
    "square": SquareAdapter,
    "shopify": ShopifyAdapter,
}

__all__ = ["ADAPTERS", "POSAdapter", "StockRow", "CSVAdapter", "ManualAdapter", "SquareAdapter", "ShopifyAdapter"]

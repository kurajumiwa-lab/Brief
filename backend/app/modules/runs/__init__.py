"""Market Runs — scheduled buying runs on top of Market Locks (v2.15).

Run A (Ruiru Fresh Market: chicken & fish, cold chain), Run B (Githurai
Sukari Run: sugar and dry goods, wholesale bags vs repacked retail), and
the Daraja Mbili consolidated-supply pattern (demand pooled across zones,
delivered through hubs, collection shops and routes). A run is an order
ledger: request ≠ confirmed order ≠ supplier purchase; pooled demand,
confirmed demand and the wholesale threshold are three separate figures;
and the customer chooses how to pay — advance, on delivery or
shop-backed — with fees and money responsibility on the order.

Public interface:

    from app.modules.runs import service, rules
    rules.RUN_TEMPLATES      # Ruiru · Githurai Sukari · Daraja Mbili
"""

from app.modules.runs import models, router, rules, service  # noqa: F401

__all__ = ["models", "router", "rules", "service"]

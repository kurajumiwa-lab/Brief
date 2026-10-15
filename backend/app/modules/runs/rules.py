"""Market Run templates, payment choices and openness rules (v2.15).

The moat is openness, with the costs visible — "open, but you'll pay for
the necessary shake":

* **Ordering is open.** Any vendor account may order into any run,
  whatever their registered market zone and wherever they receive goods.
  Demand is collected in one place; delivery happens in another. The
  30-day zone-change rule governs a vendor's *home* zone only and is
  never consulted here.
* **The customer decides how to pay.** Advance, cash/M-Pesa on delivery,
  or shop-backed collection are all first-class. The platform does not
  force prepayment; instead every order shows its fees (delivery,
  handling, repacking) and names who is responsible for the money, and
  the ledger flags large on-delivery orders with a *recommendation* —
  never a block.
* **Three figures are never merged:** total pooled demand (requested +
  confirmed), confirmed purchasing demand (the buying list), and the
  wholesale threshold (the supplier MOQ that unlocks the price, reusing
  the Lock 85% rule). Families pool with shops but keep their own price
  basis: package size, repacking and payment terms are per-order.
"""

# On-delivery orders at or above this estimated value are *flagged* with
# a deposit recommendation. Flagged, not refused — the customer decides.
LARGE_ORDER_FLAG_KES = 20000

RUN_TEMPLATES: tuple[dict, ...] = (
    {
        "key": "Ruiru_fresh",
        "title": "Run A — Ruiru Fresh Market",
        "market_name": "Ruiru Fresh Market", "market_city": "Ruiru",
        "run_kind": "fresh_market", "schedule_label": "Scheduled morning buying",
        "audience": "Families + shops",
        "products": ("Chicken", "Fish", "Other approved fresh goods"),
        "workflow": (
            "Families and shops submit quantities before the order deadline",
            "Orders are grouped by product and size or weight",
            "A designated buyer goes to the market early in the morning",
            "The buyer purchases the confirmed quantities, records actual prices and keeps receipts",
            "Goods are weighed, allocated and delivered to customers or collection shops",
        ),
        "cold_chain_required": True,
        "cold_chain_plan": (
            "Chicken and fish travel in insulated containers with temperature control. "
            "A run must not depend on fresh goods sitting unrefrigerated while the buyer "
            "completes other deliveries — fresh allocations go first or in a separate cold box."
        ),
        "funding_note": "Start with advance confirmation and prepaid or shop-funded orders; add cash on delivery once refusal risk is understood.",
    },
    {
        "key": "githurai_sukari",
        "title": "Run B — Githurai Sukari Run",
        "market_name": "Githurai", "market_city": "Nairobi",
        "run_kind": "bulk_dry_goods", "schedule_label": "Scheduled bulk buying",
        "audience": "Shops + families",
        "products": ("Sugar", "Other dry goods (later)"),
        "workflow": (
            "Shops submit bags or packets required; families submit smaller quantities",
            "Demand is totalled by brand, package size and supplier",
            "A buyer obtains a wholesale quotation and checks whether the combined quantity qualifies for a better price",
            "The order is confirmed, purchased and divided into each customer's allocation",
            "Shops collect their stock; households collect locally or request delivery",
        ),
        "cold_chain_required": False,
        "cold_chain_plan": None,
        "funding_note": (
            "A full wholesale bag and a smaller retail quantity are different orders: "
            "package size and any repacking cost are recorded per order, so a family "
            "buying 2 kg benefits from the pooled price without buying a whole bag. "
            "Supplier prices and terms for the sugar run must be confirmed with traders."
        ),
    },
    {
        "key": "daraja_consolidated",
        "title": "Daraja Mbili — supply & collection hub",
        "market_name": "Daraja Mbili", "market_city": "Kisumu",
        "run_kind": "consolidated_supply", "schedule_label": "Consolidated supply order",
        "audience": "Shops + families, including customers outside the walkable ring",
        "products": ("Rice", "Flour", "Sugar", "Cooking oil", "Soap"),
        "workflow": (
            "Customers and shops submit quantities — from inside or outside Daraja Mbili",
            "Demand is pooled by product, supplier, delivery route and deadline",
            "Only products reaching the supplier's wholesale threshold move to purchasing",
            "The supplier fulfils the bulk order; goods are received, checked and separated into individual orders",
            "Customers collect at the hub or a participating shop, or receive a scheduled delivery, and pay by their chosen method",
        ),
        "cold_chain_required": False,
        "cold_chain_plan": None,
        "funding_note": (
            "Customers outside the 1 km ring order exactly like neighbours — they choose a "
            "participating collection shop or a delivery route with its fee and minimum shown. "
            "A request is never a confirmed order, and a confirmed order is never a supplier "
            "purchase order: the three states stay separate so nobody buys stock customers "
            "later refuse."
        ),
    },
)

PAYMENT_METHOD_NOTES = {
    "advance_mpesa": "Paid before the buyer goes to the market. Lowest refusal risk.",
    "advance_cash": "Cash handed over before buying (e.g. at the collection shop) and recorded.",
    "cash_on_delivery": "Cash when the goods arrive. The customer carries the choice; refusal/loss risk sits with whoever the order names.",
    "mpesa_on_delivery": "M-Pesa when the goods arrive, recorded against the order at handover.",
    "shop_backed_collection": "Collect and pay at a participating shop. The shop is named on the order and carries the handover.",
}

FUNDING_MODEL_NOTES = {
    "customer_advance": "Model 1 — customers fund the purchase; the buyer buys only confirmed, funded orders and refunds are reconciled per order.",
    "buyer_capital": "Model 2 — the buyer uses their own working capital and collects on delivery; convenient, but refusal/late-payment losses sit with the buyer.",
    "supplier_credit": "Supplier gives stock on credit; settlement terms must be written on the run, not assumed.",
    "shop_consolidated": "Model 3 — participating shops consolidate orders, pay for their allocations (or a documented group arrangement), and act as collection points for households.",
    "pooled": "Several customers or shops contribute together; each contribution is recorded per order.",
    "mixed_open": "Open: each order records its own funding source. Recommended until one arrangement is proven with the pilot traders.",
}


class RunRuleError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status

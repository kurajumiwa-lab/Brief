# Market Runs — the buying-run model on Market Locks (v2.15)

> **Built on, not beside, Market Locks.** Daily Flash windows, zones,
> supplier MOQs and the 85% bid threshold stay as they are. v2.15 adds
> `market_runs`, `run_orders`, `run_purchases` and `run_expenses`
> (`backend/app/modules/runs/`), surfaced as the **Market Runs** section
> of `/locks`. A run is a scheduled buying trip with its own order
> ledger — the design follows the real trade (a buyer goes early, buys,
> returns with stock) instead of forcing traders into a new one.

---

## 1. The two Market Runs (and the third pattern they unlock)

**Run A — Ruiru Fresh Market** (`fresh_market`, morning buying, families +
shops): chicken, fish and other approved fresh goods. Quantities are
submitted before the deadline, grouped by product and size/weight; the
designated buyer purchases confirmed quantities, records actual prices
and keeps receipts; goods are weighed, allocated and delivered or
collected at shops. **Cold chain is a run requirement, not a note:** a
fresh run cannot be created without a cold-chain plan (insulated
containers, temperature control, fresh allocations first) — chicken and
fish must not sit unrefrigerated while other deliveries happen.

**Run B — Githurai Sukari Run** (`bulk_dry_goods`, shops + families):
sugar first, other dry goods later. Demand is totalled by brand, package
size and supplier; the buyer checks whether the combined quantity earns
a wholesale price; allocations split back per customer. A full wholesale
bag and a 2 kg retail quantity are *different orders on the same pooled
line* — package size and repacking cost are recorded per order.
(Githurai's trading base, including Githurai 45 market, makes shop
participation a reasonable model to investigate; actual supplier
prices, arrangements and payment terms for a sugar run still have to be
confirmed with traders.)

**Daraja Mbili consolidated supply** (`consolidated_supply`): Daraja is
the supply/collection hub; an outer neighbourhood is the second market.
Customers outside the 1 km walkable ring order into the same run —
**where demand is collected is not where goods are delivered** — and
receive goods at the hub, at a participating collection shop, or on a
scheduled delivery route with its fee shown.

## 2. Who funds the purchase — all three models, recorded per order

| Model | How it works | Recorded as |
|---|---|---|
| 1. Customers fund | Advance payment; buyer buys only confirmed, funded orders; platform records collections, purchase cost, expenses and any refund due | `funding_source=customer_advance`, advance payment methods |
| 2. Buyer capital | Buyer pays the supplier, collects on delivery; refusal/late-payment losses sit with the buyer | `funding_source=buyer_capital`, on-delivery methods |
| 3. Shops consolidate | Shops pool orders, pay for their allocations (or a documented group arrangement); households order through a shop that acts as collection point | `funding_source=shop_funded`, `shop_backed_collection`, collection shop named |

Recommendation for the pilot stands: start with advance confirmation
and prepaid or shop-funded orders; introduce cash on delivery once
refusal risk is measured. But the shipped default is the user's call —
**`mixed_open`: every order records its own funding, and the customer
chooses the payment method.** Open is the moat; the necessary fees are
what the customer pays, shown on the order, never hidden.

## 3. The per-run order ledger

Every order records: run date & market · product & quantity (float — kg
is never rounded) · customer/shop and participant type · package size &
wholesale/repack flags · estimated vs actual purchase price · buyer &
supplier receipts (receipt refs on purchases and expenses) · transport,
handling, repacking and cold-chain costs · delivery/collection mode,
collection shop and delivery area · amount paid, balance due, and who
is responsible for the money. A 100 kg fish purchase reconciles as:
allocations per customer, weight-loss and rejected quantities on the
purchase line, usable quantity, and the final amount charged per
allocation. Sugar reconciles by bags, package sizes and repacked
quantities the same way.

**Three figures, never merged** (per product, on the ledger):

1. **Total pooled demand** — every live request + confirmed order.
2. **Confirmed purchasing demand** — the buying list; only this is bought.
3. **Wholesale threshold** — the supplier's MOQ (Lock 85% rule) that
   unlocks the price, with `threshold_reached` computed from *confirmed*
   demand. Five shops + twenty households can carry a product over it;
   the illustrative "50 bags of rice" is a supplier's number, not ours.

State separation is enforced: `requested → confirmed → purchased →
allocated → ready → collected/delivered` (+ `cancelled`/`refused`).
Nobody buys stock customers later refuse, because unconfirmed requests
never reach the purchase line.

## 4. Payment on delivery — implemented, and so are the others

The customer decides: `advance_mpesa`, `advance_cash`,
`cash_on_delivery`, `mpesa_on_delivery`, `shop_backed_collection`.
Nothing is limited or blocked by the platform:

- Large on-delivery orders (≥ KSh 20,000 estimated) are **flagged**
  with a deposit recommendation shown to both sides — a recommendation,
  never a requirement. Cancellation stays the customer's act until
  handover; refusals are recorded as `refused` and counted.
- Payments are **recorded, not custodied**: the customer, collection
  shop or buyer records what changed hands (the existing PSP escrow
  path remains the Lock settlement route for Daily Flash clusters).
- Each order names `money_responsibility` (customer / shop / buyer /
  platform) so a shop buying on behalf of customers never leaves the
  money question ambiguous.
- Registered home market is irrelevant to ordering: the 30-day zone
  rule governs *home zone*, and runs never consult it. A customer keeps
  one fixed home market and still orders into Daraja runs for delivery
  or collection elsewhere.

## 5. The money identity and pilot tracking

Profit per order/run is shown, not assumed:

```
profit = selling revenue − supplier cost − delivery cost
         − handling & payment costs − run expenses − expected losses
```

The ledger totals revenue, supplier cost, fees, expenses, collected,
outstanding and estimated profit, plus the pilot's five numbers:
quantities requested · quantities confirmed · wholesale price achieved
vs expected · delivery/handling cost per order · % of customers who
receive **and** pay (`received_and_paid_rate`).

**Pilot:** one product category, a few reliable suppliers, a small
group of shops; a few scheduled cycles at Ruiru (fresh) *or* Githurai
(sugar) before a second market. Expand only when pooled demand shows a
genuine saving after delivery and payment risk are inside the numbers.
Lessons kept from the field: like Taimba's retailer model, register
shops and make fulfilment predictable; like DeliveryMall in Kisumu,
keep order collection separate from last-mile delivery.

# Receipt rewards — server layer

The phone can read a QR without a server. The server exists for the things a
phone cannot do alone: settle one invoice once across every account, price a
receipt against the server clock, let a shop publish an offer, and turn many
receipts into a regional aggregate without exposing any one of them.

**There is no KRA verification call and no cash movement in this layer.** A QR
is recorded as evidence the paper carried. A voucher is a merchant-funded
discount, checked by a fixed six-character code; `receipt_vouchers` has `redeemed_at` and
no payout field.

## Endpoints

Prefix: `/api/receipts`.

| Method | Path | Auth | What it does |
|---|---|---|---|
| `POST` | `/` | member | Submit the raw QR (`payload`), or a typed record (`source: "manual"`). Server parses and prices it. |
| `GET` | `/` | member | My ledger, merchant breakdown and point balance. |
| `GET` | `/summary` | member | Totals and available points only. |
| `GET` | `/insights?region=&days=` | member | Anonymised, cohort-gated region aggregate. |
| `GET` | `/merchants` | public | Verified shops, optionally by `region`. |
| `GET` | `/merchants/{pin}` | public | Shop card with running offers. |
| `GET` | `/merchants/me` | member | Shops I have claimed. |
| `POST` | `/merchants/{pin}/claim` | member | Apply to run a shop. Enters `pending`. |
| `PATCH` | `/merchants/{id}` | owner | Edit a verified shop's name, region or phone. |
| `GET` | `/offers` | public | Active merchant-funded deals. |
| `POST` | `/offers` | verified owner | Publish a deal. |
| `PATCH` | `/offers/{id}` | verified owner | Edit or pause a deal. |
| `GET` | `/offers/mine` | member | All of my shop's deals, including paused. |
| `POST` | `/offers/{id}/claim` | member | Spend points; returns a voucher with its fixed `HO-XXX` code. |
| `GET` | `/vouchers` | member | My wallet, with fixed codes and any redemption receipt. |
| `GET` | `/vouchers/{id}` | owner | One voucher, used by the wallet to notice a redemption. |
| `POST` | `/vouchers/{id}/cancel` | owner | Cancel an unused voucher and release its points. |
| `POST` | `/merchant/redeem` | verified owner | Check a six-character code and mark the voucher used. |
| `GET` | `/trade-proofs?status=` | member | Receipt-backed trades as buyer and seller. |
| `POST` | `/trade-proofs/{id}/confirm` | seller | Both sides agree; each profile is credited once. |
| `POST` | `/trade-proofs/{id}/dispute` | seller | Question a receipt, with a reason. |
| `GET` | `/ops/merchants?status=` | operator | Claim review queue. |
| `POST` | `/ops/merchants/{id}/verify` | operator | Approve or reject a claim. |

Operators are configured with `OPERATOR_HANDLES`. The role fails closed when
unset.

## Receipt → a two-sided trade

A QR submission also creates a `trade_proofs` row. The server tries to match the
shop, strongest evidence first:

1. a verified merchant record already bound to a vendor account;
2. the KRA PIN matching the vendor profile's tax id;
3. the printed business name matching exactly after punctuation is removed.

A name match must be unique; the buyer is never the seller. A matched shop gets
a `trade_proof_request` notification and can confirm or dispute. Confirmation
increments `vendors.confirmed_trade_proofs` for **both** accounts in the same
transaction, once. The phone's rank ladder reads that counter alongside
`movements_completed`, so level 3 (Trading) is reachable from a receipt-backed
purchase without inventing a stock movement.

An unmatched row is deliberate: it says the shop is not on Home Office yet and
offers a WhatsApp invite. A typed receipt never creates a proof.

## What the server decides, not the client

- **Freshness**: from `issued_at` in the code and the server clock. 15 min /
  1 h / 24 h / 7 d / expired, with an undated receipt at half value.
- **Points**: `max(1, floor(total / 50)) × freshness`, then × 1.0 for a QR with
  PIN + invoice + total, × 0.5 for partial evidence, × 0 for a typed record.
  A client cannot post a point value.
- **Identity**: `dedupe_key` is globally unique (`pin:invoice`, else token, else
  verification URL). The second account to scan the same paper gets `409`.
- **Voucher code**: `HMAC(secret, voucher id + seed)`, rendered as `HO-` plus
  three characters from an unambiguous alphabet — six characters at the
  counter, e.g. `HO-84K`. It is fixed at issue so the wallet can show it with
  no signal; `status` and `expires_at` enforce single use and expiry. The seed
  never leaves the server, and a code is unique among one shop's open vouchers.
- **Redemption receipt**: a used voucher carries the same `confirmation` object
  on the customer's and the shop's screens: code, value, customer, shop, time
  and the customer's verified-trade count. A discount never increments that
  count; only a confirmed receipt-backed trade does.

## Data products

`GET /insights` returns only aggregates: cohort size, spend, average and median
basket, basket bands, hour and weekday counts, and up to five shops by receipt
count. It refuses a cohort below 20 receipts or 3 merchants. No user id, receipt
id or invoice number appears in the response. Line items are not modelled yet,
so `line_items` is explicitly `false` rather than estimated.

## Deliberate gaps

- **KRA confirmation**: no lookup/signature check. The schema records what the
  QR said; it does not claim the tax authority confirmed it.
- **Merchant ownership**: claims are reviewed by an operator. Phone OTP or a
  printed claim code would remove that queue, but would add an SMS cost or a
  print step; the review is the zero-cost MVP.
- **Cash**: none, by design. Vouchers are discounts, funded by the merchant.
- **Wrong-shop safety**: a claim or a name match can be wrong. The seller's
  confirmation is the second signature; a dispute is recorded and notified rather
  than silently discarded.
- **Movement credit**: a confirmed proof does not create a `stock_movements`
  row. It moves a separate counter so `performance_service` cannot overwrite it.

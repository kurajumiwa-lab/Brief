# Receipt rewards — server layer

The phone can read a QR without a server. The server exists for the things a
phone cannot do alone: settle one invoice once across every account, price a
receipt against the server clock, let a shop publish an offer, and turn many
receipts into a regional aggregate without exposing any one of them.

**There is no KRA verification call and no cash movement in this layer.** A QR
is recorded as evidence the paper carried. A voucher is a merchant-funded
discount, checked by a rotating code; `receipt_vouchers` has `redeemed_at` and
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
| `POST` | `/offers/{id}/claim` | member | Spend points; returns a voucher and its current four digits. |
| `GET` | `/vouchers` | member | My wallet, with rotating codes for unused vouchers. |
| `GET` | `/vouchers/{id}` | owner | One voucher. |
| `POST` | `/vouchers/{id}/cancel` | owner | Cancel an unused voucher and release its points. |
| `POST` | `/merchant/redeem` | verified owner | Check a four-digit code and mark the voucher used. |
| `GET` | `/ops/merchants?status=` | operator | Claim review queue. |
| `POST` | `/ops/merchants/{id}/verify` | operator | Approve or reject a claim. |

Operators are configured with `OPERATOR_HANDLES`. The role fails closed when
unset.

## What the server decides, not the client

- **Freshness**: from `issued_at` in the code and the server clock. 15 min /
  1 h / 24 h / 7 d / expired, with an undated receipt at half value.
- **Points**: `max(1, floor(total / 50)) × freshness`, then × 1.0 for a QR with
  PIN + invoice + total, × 0.5 for partial evidence, × 0 for a typed record.
  A client cannot post a point value.
- **Identity**: `dedupe_key` is globally unique (`pin:invoice`, else token, else
  verification URL). The second account to scan the same paper gets `409`.
- **Voucher code**: `HMAC(secret, voucher id + seed + one-minute window)`,
  truncated to four digits. The seed never leaves the server. Redemption
  accepts the current and previous minute to survive a code expiring mid-type.

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

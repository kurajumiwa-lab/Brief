# Town commerce — implementation notes

Three engines share one commercial spine. They do not share a wallet.

```
receipt photo / QR ──► Receipt ──► ReceiptItem
                         │
                         └── merchant prepaid credit ──► points (redeemable only if funded)

referral listing ──► share link ──► click ──► conversion (pending)
                                               │
                                    operator verify
                                               ├── bounty due (paid directly)
                                               └── lead fee % (platform)

merchant task ──► scout claim ──► proof ──► merchant approves
                                               ├── direct M-Pesa payout
                                               ├── platform fee % (invoiced)
                                               └── rating / payment signals
```

## Accounting invariants

1. `merchant_credit_accounts.available_kes` is a promotional budget. It is never
   revenue and never withdrawable.
2. On a purchase confirmation: `purchased += amount`, `available += amount`,
   expiry moves forward. A pending purchase posts nothing.
3. On a receipt reward: `available -= funded`, `spent += funded`,
   `outstanding += funded`. The receipt records `reward_funded_kes = funded`;
   `calculated_points - funded` is shown but not promised.
4. On a voucher redemption: `outstanding -= value` (capped at the outstanding
   balance). The redemption row is append-only and stores a hash of the code.
5. On expiry: `available → expired_kes`. Expired credit is reported separately
   from revenue and from spend.
6. Only `platform_fee_entries.status = 'paid'` is recognized revenue. The ops
   overview exposes accrued, invoiced, paid and waived separately.
7. A referral bounty is `due` only after an operator verifies the conversion;
   `paid` is recorded by the funder with an M-Pesa reference. The platform never
   holds the bounty.
8. A scout payment confirmation is `reported` when the scout submits it and
   `confirmed` only when the merchant acknowledges it. Neither changes the fee
   ledger or makes the platform a party to the payment.

## Runtime configuration

`commerce_settings` is the source of truth for disclosed percentages:

| key | default | meaning |
|---|---|---|
| `referral_campaign_fee` | 2% | platform fee on a referral campaign budget (invoiced externally) |
| `referral_lead_fee` | 6% | platform fee on a verified referral bounty |
| `merchant_credit_expiry` | 365 days | validity of prepaid credit from the latest purchase |
| `scout_fee_<task_type>` | 5–8% | platform fee on a completed scout task, per task type |

`FREE_FOR_NOW` suppresses collection even when a rate is configured. The quote
still shows the percentage and says why nothing was charged. Existing accrued
fees are never rewritten when a rate changes.

Scout fees default to the per-type percentages in
`app/modules/corridor_tasks/models.py` (5–8%, including QR distribution and
customer acquisition) but are read from `scout_fee_<task_type>` at task
creation. Changing one affects the next task; tasks already created keep the
percentage copied onto them. The merchant pays the fee on top; the scout
receives the full payout.

## API map

### Receipt rewards (`/api/town`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/receipts/ocr` | multipart photo → OCR draft; stores the photo only with consent |
| POST | `/receipts/ocr/text` | pasted text → OCR draft (works with no engine) |
| POST | `/receipts/capture` | create the receipt (`photo`, `text`, `qr` or `manual`), items, priority window and funded points |
| GET | `/trust/me` | evidence-backed trust ladder |

The original `/api/receipts` QR and manual routes are unchanged. The new capture
route is additive; it uses the same `receipt_value` freshness ladder and the
same dedupe rules.

### Merchant (`/api/town/merchant`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` or `/{id}/dashboard` | credit, policy, sales, redemptions, recent receipts |
| PATCH | `/{id}/policy` | points per KES 100, cap, 15-minute bonus |
| GET | `/{id}/credits` | balance, purchases, subscription |
| POST | `/{id}/credits/purchase` | record an external payment (pending) |
| POST | `/{id}/analytics/subscribe` | request premium analytics (pending) |

### Referral index (`/api/town/referral-index`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/public/listings` | public search; sponsored rows labelled |
| GET | `/public/go/{code}` | share-link landing; records a click |
| GET | `/listings`, `/mine` | signed-in search and own listings |
| POST | `/listings` | create a listing (starts unverified) |
| PATCH | `/listings/{id}` | edit terms, budget, status |
| POST | `/listings/{id}/share` | create a seeder code |
| POST | `/listings/{id}/claim` | submit a conversion with proof |
| POST | `/listings/{id}/sponsor` | buy a labelled sponsored slot; the winning bid is platform revenue, capped by the listing's bounty |
| POST | `/listings/{id}/bounty` | record a funder's direct bounty budget |
| POST | `/conversions/{id}/verify` | operator-only independent verification |
| POST | `/conversions/{id}/paid` | owner records the direct bounty payment |
| POST | `/conversions/{id}/dispute` | open a referral dispute |

### Scout (`/api/town/scout`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/board` | corridor task board in the viewer's region |
| GET | `/tasks/{id}` | task detail with rating and payment signals |
| POST | `/tasks/{id}/rating` | merchant rates a completed scout |
| POST | `/tasks/{id}/payment-confirmation` | scout reports the direct payment |
| POST | `/tasks/{id}/payment-confirmation/ack` | merchant acknowledges it |
| POST | `/tasks/{id}/dispute` | open a task dispute |
| GET | `/profile`, `/fees` | scout record and fee catalogue |

### Ops (`/api/ops/commerce`)

Overview, pending credit purchases, subscriptions, listings, conversions,
disputes, fee entries, audit events and the runtime rate editor. Every route uses
`require_operator`, the existing fail-closed allowlist.

## Trust ladder

| Level | Name | Evidence |
|---|---|---|
| 1 | New | signed in |
| 2 | Reachable | 20 points from a verified receipt or completed task |
| 3 | Verified | 40 points and at least one independently verified action |
| 4 | Trading | 60 points and a completed trade or verified referral |
| 5 | Trusted | 80 points, five verified actions, no open dispute |

A click, a screenshot or a pasted M-Pesa message never moves the level. A
resolved dispute against the person subtracts 10 points per case; an open dispute
subtracts 5. The latest 300-second snapshot is reused; `/trust/me` forces a fresh
computation.

## Test commands

```bash
cd backend && .venv/bin/python -m pytest tests/test_town_commerce.py -q
cd frontend && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/test/townCommerce.test.jsx
cd frontend && npm run build
```

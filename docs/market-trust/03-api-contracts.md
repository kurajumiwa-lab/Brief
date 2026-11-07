# 03. API contracts (proposed)

## Conventions

- **Prefix:** the blueprint says `/api/v1`. Brief's live API uses `/api/...` with no version segment, and every existing route is at that prefix. Changing the prefix would break the live site. So new endpoints use `/api/trust/...`, and versioning starts only when a breaking change is needed. See decision D3 in `06`.
- **Auth:** the existing bearer token (`get_current_vendor`). Public reads need no login.
- **Idempotency:** every financial write requires an `Idempotency-Key` header. The same key with the same body returns the first result. The same key with a different body returns `409`.
- **Pagination:** `?limit=` (max 50) and `?cursor=`. Responses return `next_cursor` (null when done).
- **Errors:** `{ "detail": "plain reason" }`, the same shape as existing routes. Codes: `400` bad input, `401` not signed in, `403` not allowed, `404` not found or not visible, `409` conflict or already done, `422` rule broken, `429` rate limited.
- **Server decides trust:** the client never sends `evidence_weight`, `verification_level`, `status` of a review, reward amounts, or wallet balances. Any such field sent is ignored.
- **Plain language:** `detail` text is written for a shop owner, not for a developer.

## 1. Public directory (no login)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/trust/businesses` | Search businesses. Query: `q`, `category`, `lat`, `lng`, `radius_m` (max 10000), `limit`, `cursor`. |
| GET | `/api/trust/businesses/{vendor_id}` | Business profile with branches and reputation summary. |
| GET | `/api/trust/businesses/{vendor_id}/branches` | Branches with verification level and coordinates. |
| GET | `/api/trust/branches/{branch_id}` | One branch: listings, freshness, reputation. |
| GET | `/api/trust/products` | Product search. Query: `q`, `category`. |
| GET | `/api/trust/products/{product_id}/prices` | Latest accepted price per branch, with `observed_at`, `fresh` flag and a normalised unit price. |
| GET | `/api/trust/branches/{branch_id}/reviews` | Published reviews, newest first. Query: `verified_only`, `stage`. |

### Sample: GET /api/trust/products/{id}/prices

```json
{
  "product": { "id": "7f1c…", "canonical_name": "Cooking oil", "category": "groceries" },
  "variant": { "id": "a02e…", "variant_label": "2 L bottle", "pack_size": 2, "pack_unit": "l" },
  "prices": [
    {
      "branch": { "id": "b11d…", "branch_name": "CBD", "business_name": "Shop A" },
      "amount_minor": 56000,
      "currency_code": "KES",
      "unit_price_minor_per_l": 28000,
      "observed_at": "2026-11-06T06:40:00Z",
      "source": "shelf_photo",
      "fresh": true,
      "status": "accepted"
    }
  ],
  "disagreement": false,
  "note": "Observations from contributors. Not live market prices."
}
```

Rules: a price older than its freshness window carries `"fresh": false` and is never labelled "current". If two accepted observations disagree on the same day, `disagreement` is `true` and both appear.

## 2. Branches and verification

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/trust/branches` | Claimed business owner | Add a branch. Starts at `pending`, level 0. |
| PATCH | `/api/trust/branches/{id}` | Owner or branch manager | Update name, address, hours. Coordinates reset to pending verification if changed. |
| POST | `/api/trust/branches/{id}/evidence` | Owner or contributor | Upload evidence (signed URL flow, see below). |
| POST | `/api/trust/admin/branches/{id}/verifications` | Verifier (not the owner) | `{ "method", "result", "note" }`. Writes an append-only row. |

### Sample: POST /api/trust/branches

```json
{ "branch_name": "Kondele", "address_text": "Kondele Market, Kisumu", "latitude": -0.1022, "longitude": 34.7617 }
```

```json
{ "id": "b22a…", "status": "pending", "verification_level": 0, "detail": "Branch added. It becomes public after a storefront check." }
```

### Evidence upload

Two steps. Evidence never passes through the API in one request.

1. `POST /api/trust/evidence/upload-url` with `{ "media_type", "size_bytes", "sha256" }` returns a signed `upload_url` valid for 10 minutes.
2. `POST /api/trust/evidence` with `{ "upload_id", "sha256" }` confirms the upload. The server recomputes the hash and rejects a mismatch with `422`.

## 3. Prices and stock (contributions)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/trust/listings/{listing_id}/prices` | Submit a price observation. |
| POST | `/api/trust/listings/{listing_id}/stock` | Submit a stock observation. |
| POST | `/api/trust/products` | Propose a new product. Duplicate candidates are returned, not merged. |

### Sample: POST /api/trust/listings/{id}/prices

```json
{ "amount_minor": 56000, "currency_code": "KES", "observed_at": "2026-11-06T06:40:00Z", "source": "shelf_photo", "evidence_id": "e91c…" }
```

```json
{ "id": "p33f…", "status": "accepted", "detail": "Thanks. Your price is now shown with today's date." }
```

Rules:

- `observed_at` may not be in the future and may not be older than 30 days.
- A repeat of an identical observation from the same contributor within 24 hours returns `409` with "You already sent this price today."
- The response never shows a reward amount. Rewards appear only after acceptance in the wallet.

## 4. Reviews

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/trust/branches/{id}/reviews` | Stage 1: `{ "rating": 1-5 }`, optional `transaction_token` or `receipt_id`. |
| PATCH | `/api/trust/reviews/{id}` | Stage 2: adds `comment`, `language`. Creates a new version (see `02`). |
| POST | `/api/trust/reviews/{id}/reports` | Report: `{ "reason" }`. |
| POST | `/api/trust/reviews/{id}/responses` | Business reply (owner only, one per review). |
| POST | `/api/trust/reviews/{id}/disputes` | Business dispute: `{ "reason_text" }` (required). |
| POST | `/api/trust/transaction-tokens/consume` | Customer enters a branch token: `{ "token" }`. Returns the consumed transaction. |

### Sample: POST /api/trust/branches/{id}/reviews

```json
{ "rating": 4, "transaction_token": "TKN-7H2Q-9X" }
```

```json
{
  "id": "r44c…",
  "stage": "quick",
  "status": "published",
  "evidence_tier": "confirmed_token",
  "detail": "Thanks for your rating. Add a comment for an extra contribution point."
}
```

Rules:

- One current review per person per branch. A second post returns `409` with "You have already rated this branch. You can edit your review."
- The business cannot review its own branch (`403`).
- A review of a branch where the reviewer has no link to a transaction is accepted with `evidence_tier = unverified`.
- `evidence_weight` is never returned to the reviewer. The public sees the tier label only.

## 5. Reputation

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/trust/businesses/{vendor_id}/reputation` | Latest snapshot per branch, plus the business total. |

```json
{
  "business": { "vendor_id": "v1…", "sentiment_score": 4.1, "transaction_score": 4.4, "confidence": 0.62, "review_count": 38, "verified_review_count": 11, "method_version": "rep-v1", "calculated_at": "2026-11-06T04:00:00Z" },
  "branches": [],
  "message": null
}
```

When `review_count` is 0 the score fields are `null` and `message` is "Not enough reviews yet."

## 6. Tasks and wallet

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/trust/tasks` | Open tasks near the contributor, with the reward shown in plain words. |
| POST | `/api/trust/tasks/{id}/claim` | Claim a task. |
| POST | `/api/trust/tasks/{id}/submissions` | Submit. Body depends on the task type. |
| GET | `/api/trust/contributions/me` | History with status for each submission. |
| GET | `/api/trust/wallet` | Balance per currency, derived from the ledger. Read only. |
| GET | `/api/trust/wallet/ledger` | Ledger lines for this contributor. |
| POST | `/api/trust/withdrawals` | Request a payout. Requires `Idempotency-Key`. |
| GET | `/api/trust/withdrawals/{id}` | Status. |

**Not available in the pilot:** any endpoint that lets a user set a balance, and any withdrawal while the money feature is in mock mode (see `06`). In mock mode, `POST /api/trust/withdrawals` returns `503` with "Payouts are not switched on yet."

### Sample: POST /api/trust/withdrawals

```json
{ "amount_minor": 10000, "currency_code": "KES", "destination_token": "dst_9f2…" }
```

```json
{ "id": "w55e…", "status": "requested", "detail": "Request received. It is checked before any money moves." }
```

Rules: minimum withdrawal per `04`; destination must be a token already on the account; the same `Idempotency-Key` never creates a second request.

## 7. Admin and trust operations

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/trust/admin/queue` | Pending evidence, submissions, branch verifications, reports. Filter by `type`. |
| POST | `/api/trust/admin/submissions/{id}/decision` | `{ "decision": "accept" | "reject", "reason" }`. Reason is required for reject. |
| GET | `/api/trust/admin/fraud-cases` | Open cases. |
| POST | `/api/trust/admin/fraud-cases/{id}/actions` | `{ "action", "reason" }`. Actions are scoped to one item, not the whole account. |
| POST | `/api/trust/admin/withdrawals/{id}/approve` | Second approver only. The first approver cannot approve. |
| GET | `/api/trust/admin/audit` | Audit events. Read only. Nothing can be deleted through the API. |

Rules: every admin write needs a reason of at least 10 characters, and writes an `audit_events` row in the same transaction.

## 8. Rate limits

| Action | Limit |
|---|---|
| Price or stock submission | 30 per contributor per day |
| Review (any stage) | 10 per person per day |
| Report | 20 per person per day |
| Withdrawal request | 2 per contributor per day |
| Public search | per IP, existing limiter |

Limits are returned as `429` with a plain reason and `Retry-After`.

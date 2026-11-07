# 01. Gap analysis: blueprint modules against Brief

Key: **Reuse** = use as is. **Extend** = add fields or endpoints, keep the table. **New** = build. **Defer** = not in the first pilot.

## Module 01: Business Registry

| Blueprint need | What Brief has | Verdict |
|---|---|---|
| Business profile | `vendors` (business_name, vendor_handle, business_categories, country-agnostic) and `vendor_profiles` | **Reuse.** `vendors` is the business. |
| Multiple branches | None. No branch table. `warehouse_rentals` and `popup_shops` are unrelated. | **New:** `business_branches` |
| Addresses and coordinates | Vendor-level location only, if any | **New** at branch level |
| Ownership and claims | `business_claims` (claim_key, status, evidence, verified_by, rejection_reason) and `claim_events` | **Reuse** and extend with a branch scope |
| Physical verification | Membership verification (`/api/membership/me/verification`) confirms identity, not premises. `standing` claims cover documents. | **Extend:** add `branch_verifications` for premises |
| Verification history | `claim_events`, `governance_audit_events` | **Reuse** the pattern |
| Categories | `business_categories` (JSONB list on `vendors`) | **Extend** later with a category table if the directory needs a hierarchy |
| Duplicate detection | None for businesses. `market_presences` has a naming step only. | **New** (basic: normalised name + phone + location, then a human check) |

## Module 02: Product Intelligence

| Blueprint need | What Brief has | Verdict |
|---|---|---|
| Canonical product catalogue | None. `stock_items` is one vendor's own inventory line, not a shared product. | **New:** `products` |
| Variants and package sizes | `stock_items.unit_of_measure` (text) only | **New:** `product_variants` with a numeric pack size and unit |
| Branch-specific listings | None | **New:** `branch_listings` |
| Price observations with history | `market_observations` (product, price_kes, market, confidence, status) from screenshot intake. `stock_items.unit_price` holds only the current price. | **Reuse** `market_observations` as the seed source. **New:** `price_observations` (append-only). |
| Stock observations | `stock_items.quantity_in_stock` holds a live number, not a history | **New:** `stock_observations` |
| Product images | `stock_items.images` (JSONB), `media_objects` | **Reuse** |
| Duplicate and merge | None | **New:** `product_merges` (defer to phase 2) |

## Module 03: Trust & Reviews

| Blueprint need | What Brief has | Verdict |
|---|---|---|
| Business reviews | Reviews exist only for vendor lists (`vendor_list_reviews`) and directory knowledge sessions (`knowledge_reviews`). Neither is about a business or branch. | **New:** `business_reviews`. Keep the two existing review tables as they are. |
| Verified transaction indicator | `order_transactions`, `stock_movements` (status received), `offer_confirmations` (hand confirmation). These are B2B trades. | **Reuse** the offer rule as the model for "verified". Consumer receipts are **new.** |
| Two-stage review | None | **New** (fields on `business_reviews`) |
| Business responses | None | **New:** `review_responses` |
| Reports and disputes | `social_reports`, `outside_content_reports` (different domains) | **Reuse the pattern**, new tables |
| Confidence-adjusted score | None. `vendor_list.avg_rating` is a plain average. | **New:** `reputation_snapshots` |

Two existing rating systems already exist (vendor lists and directory sessions). They must not be merged silently. The decision is listed in `06`.

## Module 04: Contribution Marketplace

| Blueprint need | What Brief has | Verdict |
|---|---|---|
| Tasks and claims | `routine_*` (personal checklist), `runs` (market runs). Neither is a paid task. | **New:** `contribution_tasks`, `task_submissions` |
| Evidence review | `governance_proposals` and `vendor_appeals` are for governance, not evidence | **New** review queue, reusing the dual-approval pattern |
| Contribution scoring | `biashara_score_events` is a business score, not a contributor score | **New** contributor score; do not reuse the Biashara score |

## Module 05: Rewards & Payouts

| Blueprint need | What Brief has | Verdict |
|---|---|---|
| Append-only ledger | `custody_ledger` (trigger-enforced append-only, payments). `vendor_credit_ledger` (governance benefits). | **Pattern reusable.** Do **not** reuse the custody ledger for rewards until legal review (see `06`). |
| Double-entry | Custody ledger is single-entry | **New:** `reward_ledger` with debit and credit lines |
| Withdrawals | `disbursements` with dual approval above `DUAL_APPROVAL_THRESHOLD_KSH` | **Reuse** the dual-approval logic |
| Payout provider abstraction | `services/psp_client.py` (`PSPClient`, `MockPSPClient`, `IntaSendClient` stub) | **Reuse.** Mock mode stays on (standing rule). |
| Reconciliation | `reconciliation_runs`, nightly job | **Reuse** the job, extend to reward payouts |

## Module 06: Business Intelligence

| Blueprint need | What Brief has | Verdict |
|---|---|---|
| Business dashboard | Business Desk, Standing, Ops pages, `analytics` module | **Extend** |
| Branch analytics, reputation trends | Nothing branch-level | **Defer** until branches and reviews exist |

## Module 07: Discovery & Search

| Blueprint need | What Brief has | Verdict |
|---|---|---|
| Public browse without login | `GET /api/offers/public`, `/api/knowledge/*`, `/api/blueprints` (public read prefixes) | **Reuse** the public-read pattern |
| Search by product, shop, nearby | `/explore`, `market_search`, network-first map (`map` module) | **Extend** |
| Price comparison | Nothing comparing `price_observations` yet | **New** after price observations exist |
| Sponsored discovery | None | **Blocked:** conflicts with the free-for-now rule (see `06`) |

## Module 08: Trust Operations & Admin

| Blueprint need | What Brief has | Verdict |
|---|---|---|
| Verification queue | Membership and standing verification queues, OPERATOR_HANDLES | **Reuse** |
| Fraud cases | None | **New:** `fraud_signals`, `fraud_cases`, `fraud_case_events` |
| Appeals | `vendor_appeals`, governance appeals | **Reuse** |
| Audit trail | `governance_audit_events`, `claim_events`, `movement_events` | **Reuse**, one append-only audit table for trust actions |
| Country administration | Single-country today | **Defer** until a second country is in scope |

## Summary of what must be built

Four new domains: **branches**, **product catalogue and observations**, **business reviews and reputation**, and **contribution tasks, rewards and fraud cases**. Most of the rest is reuse or extension. The data model in `02` is sized to that.

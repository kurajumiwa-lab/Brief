# 02. Data model

Scope: the **new** tables needed for the pilot, with field types and constraints. Existing tables are listed at the end and are not changed.

## Conventions (apply to every new table)

- Primary keys: `UUID`, generated in the app (`uuid.uuid4`), as the existing models do.
- Timestamps: `timestamptz` in UTC. The Kenyan local time is derived for display only.
- Money: **integer minor units** (cents) with an explicit ISO currency code. Never `float`.
  - Note: existing `stock_items` prices are `Float`, and `market_observations.price_kes` is an integer. The new tables follow this rule. Changing the old columns is a separate decision (see `06`).
- Foreign keys to `vendors.id` use `ON DELETE CASCADE` for owned data and `SET NULL` for actor references, as in the current code.
- Country: every operational table carries `country_code CHAR(2)`, defaulting to `'KE'`. The `countries` table is created in phase 1 with one row, Kenya.
- Append-only tables (`price_observations`, `stock_observations`, `reward_ledger`, `branch_verifications`, `fraud_case_events`, `audit_events`): `UPDATE` and `DELETE` are blocked by a trigger, the same approach as `trg_custody_ledger_append_only`.
- Enums: stored as `VARCHAR` with a `CHECK` constraint, not native PostgreSQL enums. This avoids the `ALTER TYPE` problems already seen in earlier migrations.
- Alembic revision IDs stay at 32 characters or fewer.

## A. Foundation

### `countries`
| Column | Type | Constraints |
|---|---|---|
| code | CHAR(2) | PK |
| name | VARCHAR(80) | NOT NULL |
| currency_code | CHAR(3) | NOT NULL |
| status | VARCHAR(12) | CHECK in (`planned`, `pilot`, `live`) |

Seed: `KE`, Kenya, `KES`, `pilot`.

## B. Business registry

### `business_branches`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| vendor_id | UUID | FK `vendors.id` CASCADE, NOT NULL, indexed |
| country_code | CHAR(2) | FK `countries.code`, NOT NULL, default `KE` |
| branch_name | VARCHAR(120) | NOT NULL |
| address_text | VARCHAR(300) | NOT NULL |
| latitude | NUMERIC(9,6) | nullable until verified |
| longitude | NUMERIC(9,6) | nullable until verified |
| status | VARCHAR(20) | CHECK in (`pending`, `active`, `closed`, `removed`) |
| verification_level | SMALLINT | CHECK 0–4 (see `04`), default 0 |
| created_at, updated_at | TIMESTAMPTZ | NOT NULL |

- Unique (`vendor_id`, `branch_name`).
- Index on (`latitude`, `longitude`) for nearby search. PostGIS is **not** required in phase 1. Confirm the extension is available on the chosen database before adding it.

### `branch_verifications` (append-only)
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| branch_id | UUID | FK `business_branches.id` CASCADE, indexed |
| method | VARCHAR(30) | CHECK in (`storefront_photo`, `field_visit`, `document`, `community_corroboration`) |
| result | VARCHAR(12) | CHECK in (`approved`, `rejected`) |
| verifier_vendor_id | UUID | FK `vendors.id` SET NULL |
| evidence_id | UUID | FK `evidence_assets.id` SET NULL |
| note | TEXT | required when `result = rejected` (CHECK) |
| created_at | TIMESTAMPTZ | NOT NULL |

Rule: a verifier cannot verify a branch of their own business (checked in the service, and covered by a test).

## C. Product intelligence

### `products`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| canonical_name | VARCHAR(200) | NOT NULL |
| brand | VARCHAR(120) | nullable |
| category | VARCHAR(60) | NOT NULL, indexed |
| gtin | VARCHAR(14) | nullable, unique when present |
| status | VARCHAR(12) | CHECK in (`active`, `merged`) |
| merged_into_id | UUID | FK `products.id`, nullable |
| created_by_vendor_id | UUID | FK `vendors.id` SET NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

### `product_variants`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| product_id | UUID | FK `products.id` CASCADE |
| variant_label | VARCHAR(120) | NOT NULL, e.g. "2 L bottle" |
| pack_size | NUMERIC(12,3) | NOT NULL, > 0 |
| pack_unit | VARCHAR(10) | CHECK in (`ml`, `l`, `g`, `kg`, `piece`) |

- Unique (`product_id`, `variant_label`).
- Comparisons use the normalised unit price (price per litre or per kilogram). Two variants with different units are never compared directly.

### `branch_listings`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| branch_id | UUID | FK `business_branches.id` CASCADE |
| variant_id | UUID | FK `product_variants.id` CASCADE |
| status | VARCHAR(12) | CHECK in (`listed`, `unlisted`) |

- Unique (`branch_id`, `variant_id`).

### `price_observations` (append-only)
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| listing_id | UUID | FK `branch_listings.id` CASCADE, indexed |
| amount_minor | BIGINT | NOT NULL, > 0 |
| currency_code | CHAR(3) | NOT NULL |
| observed_at | TIMESTAMPTZ | NOT NULL (when the price was seen) |
| source | VARCHAR(20) | CHECK in (`receipt`, `shelf_photo`, `staff_entry`, `screenshot_import`) |
| evidence_id | UUID | FK `evidence_assets.id` SET NULL, nullable |
| contributor_vendor_id | UUID | FK `vendors.id` SET NULL |
| status | VARCHAR(12) | CHECK in (`accepted`, `flagged`, `rejected`), default `accepted` |
| confidence | NUMERIC(3,2) | CHECK 0–1 |
| created_at | TIMESTAMPTZ | NOT NULL |

- Index (`listing_id`, `observed_at` DESC).
- **Status changes are the only allowed update**, and they are logged to `audit_events`. The amount is never changed.
- Disagreement rule: two accepted observations on the same day with different amounts are both kept and the listing is flagged. No overwrite.
- Freshness is computed at read time from `observed_at` and the freshness target for the category. It is not stored.

### `stock_observations` (append-only)
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| listing_id | UUID | FK `branch_listings.id` CASCADE, indexed |
| availability | VARCHAR(12) | CHECK in (`in_stock`, `low`, `out`) |
| quantity_band | VARCHAR(12) | CHECK in (`none`, `few`, `some`, `many`) |
| observed_at | TIMESTAMPTZ | NOT NULL |
| source | VARCHAR(20) | CHECK in (`staff_entry`, `shelf_photo`, `contributor_check`) |
| contributor_vendor_id | UUID | FK `vendors.id` SET NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

- A stock fact older than its freshness window (24 hours in the blueprint) is shown as "last seen" and never as current.

### `evidence_assets` (private)
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| owner_vendor_id | UUID | FK `vendors.id` CASCADE, indexed |
| file_sha256 | CHAR(64) | NOT NULL, indexed (duplicate detection) |
| storage_key | VARCHAR(500) | NOT NULL, private bucket only |
| media_type | VARCHAR(60) | CHECK in (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`) |
| is_private | BOOLEAN | NOT NULL, default TRUE |
| created_at | TIMESTAMPTZ | NOT NULL |

Public responses never include `storage_key` or any URL to evidence. Access is by a short-lived signed URL for staff only.

## D. Reviews and reputation

### `business_reviews`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| branch_id | UUID | FK `business_branches.id` CASCADE, indexed |
| reviewer_vendor_id | UUID | FK `vendors.id` CASCADE, indexed |
| transaction_id | UUID | FK `consumer_transactions.id` SET NULL, nullable |
| stage | VARCHAR(10) | CHECK in (`quick`, `detailed`) |
| rating | SMALLINT | CHECK 1–5 |
| comment | TEXT | nullable, max 2000 chars (check in app) |
| language | VARCHAR(8) | nullable (`en`, `sw`, ...) |
| evidence_tier | VARCHAR(24) | CHECK in (`confirmed_token`, `validated_receipt`, `corroborated`, `receipt_incomplete`, `unverified`) |
| evidence_weight | NUMERIC(3,2) | CHECK 0–1, set by the system, never by the reviewer |
| status | VARCHAR(20) | CHECK in (`published`, `hidden_pending_review`, `removed`) |
| version | INTEGER | NOT NULL, default 1 |
| supersedes_id | UUID | FK `business_reviews.id`, nullable |
| created_at | TIMESTAMPTZ | NOT NULL |

- Edits create a new row with `supersedes_id` set. Old rows are kept. Deletion is `status = removed` through moderation, never a row delete.
- One current review per reviewer per branch: a partial unique index on (`branch_id`, `reviewer_vendor_id`) where `supersedes_id` is the latest version. Implementation detail: keep a `is_current` boolean and make the unique index partial on `is_current = TRUE`.

### `review_responses`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| review_id | UUID | FK `business_reviews.id` CASCADE |
| responder_vendor_id | UUID | FK `vendors.id` SET NULL |
| body | TEXT | NOT NULL, max 1000 |
| created_at | TIMESTAMPTZ | NOT NULL |

- One response per review. A business cannot respond to its own review.

### `review_reports` and `review_disputes`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| review_id | UUID | FK CASCADE |
| actor_vendor_id | UUID | FK SET NULL |
| reason | VARCHAR(30) | CHECK in (`spam`, `threat`, `personal_data`, `fake`, `off_topic`, `other`) |
| status | VARCHAR(12) | CHECK in (`open`, `upheld`, `dismissed`) |
| decided_by | UUID | FK SET NULL |
| decided_at | TIMESTAMPTZ | nullable |

`review_disputes` has the same shape, with `business_vendor_id` in place of `actor_vendor_id`, plus a mandatory `reason_text`.

### `reputation_snapshots` (append-only)
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| scope | VARCHAR(10) | CHECK in (`branch`, `business`) |
| scope_id | UUID | NOT NULL |
| sentiment_score | NUMERIC(3,2) | nullable when there are no reviews |
| transaction_score | NUMERIC(3,2) | nullable when there are no verified reviews |
| confidence | NUMERIC(3,2) | CHECK 0–1 |
| review_count | INTEGER | NOT NULL |
| verified_review_count | INTEGER | NOT NULL |
| method_version | VARCHAR(20) | NOT NULL, e.g. `rep-v1` |
| input_hash | CHAR(64) | NOT NULL, hash of the inputs, so any score can be reproduced |
| calculated_at | TIMESTAMPTZ | NOT NULL |

Rule: when `review_count` is zero, the scores are `NULL`. The UI then shows "Not enough reviews yet".

## E. Contributions, rewards and payouts

### `contribution_tasks`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| country_code | CHAR(2) | FK `countries.code` |
| task_type | VARCHAR(30) | CHECK in (`new_branch`, `product_discovery`, `receipt_submission`, `price_check`, `stock_check`, `physical_verification`) |
| target_type | VARCHAR(20) | e.g. `branch`, `listing`, `product` |
| target_id | UUID | nullable (null for discovery tasks) |
| reward_rule_id | UUID | FK `reward_rules.id` |
| status | VARCHAR(12) | CHECK in (`open`, `claimed`, `closed`, `expired`) |
| budget_key | VARCHAR(60) | e.g. `KE:price_check:2026-11` (spend cap) |
| expires_at | TIMESTAMPTZ | NOT NULL |

### `task_submissions`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| task_id | UUID | FK `contribution_tasks.id` CASCADE |
| contributor_vendor_id | UUID | FK `vendors.id` CASCADE |
| evidence_id | UUID | FK `evidence_assets.id` SET NULL |
| payload | JSONB | NOT NULL, validated by the task type's schema |
| status | VARCHAR(12) | CHECK in (`submitted`, `accepted`, `rejected`, `duplicate`) |
| risk_score | SMALLINT | CHECK 0–100 |
| decided_by | UUID | FK `vendors.id` SET NULL |
| decided_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | NOT NULL |

- A reward exists only for `accepted`. The reward is written at acceptance, never at submission.
- Unique (`task_id`, `contributor_vendor_id`).

### `reward_rules`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| country_code | CHAR(2) | FK |
| task_type | VARCHAR(30) | NOT NULL |
| points | INTEGER | CHECK >= 0 |
| cash_amount_minor | BIGINT | CHECK >= 0 |
| currency_code | CHAR(3) | NOT NULL |
| active | BOOLEAN | NOT NULL, default FALSE |
| effective_from | TIMESTAMPTZ | NOT NULL |

- Rules are **off by default**. Turning one on is a dual-approved change.
- Rewards must not depend on the rating given. The quick review reward is the same for 1 star and 5 stars (test in `05`).

### `reward_ledger` (append-only, double-entry)
| Column | Type | Constraints |
|---|---|---|
| id | BIGSERIAL | PK |
| journal_id | UUID | NOT NULL, indexed |
| account | VARCHAR(60) | e.g. `reward_expense`, `contributor_payable:<vendor_id>`, `settlement_bank` |
| direction | CHAR(1) | CHECK in (`D`, `C`) |
| amount_minor | BIGINT | CHECK > 0 |
| currency_code | CHAR(3) | NOT NULL |
| entry_type | VARCHAR(30) | e.g. `reward_accrued`, `payout_sent`, `payout_failed_reversal` |
| reference_type | VARCHAR(30) | NOT NULL |
| reference_id | UUID | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL |

- Unique (`reference_type`, `reference_id`, `entry_type`, `account`) makes writes idempotent.
- Every `journal_id` must sum to zero (debits = credits). This is checked in the service inside the same transaction, and a nightly job re-checks it.
- No balance column. The balance is the sum of the ledger for an account.

### `withdrawal_requests`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| contributor_vendor_id | UUID | FK `vendors.id` CASCADE |
| amount_minor | BIGINT | CHECK >= minimum |
| currency_code | CHAR(3) | NOT NULL, the country's currency only |
| destination_token | VARCHAR(120) | a provider-issued token. Raw phone numbers are not stored here. |
| status | VARCHAR(12) | CHECK in (`requested`, `held`, `approved`, `sent`, `settled`, `failed`, `reversed`) |
| idempotency_key | VARCHAR(80) | UNIQUE |
| requested_at | TIMESTAMPTZ | NOT NULL |

### `payout_transactions`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| withdrawal_id | UUID | FK CASCADE |
| provider | VARCHAR(30) | e.g. `mock`, `intasend` |
| provider_reference | VARCHAR(120) | UNIQUE when present |
| status | VARCHAR(12) | CHECK in (`pending`, `success`, `failed`) |
| callback_hash | CHAR(64) | UNIQUE, makes callback handling idempotent |
| settled_at | TIMESTAMPTZ | nullable |

## F. Fraud and audit

### `fraud_signals`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| subject_type | VARCHAR(20) | `vendor`, `review`, `submission`, `withdrawal`, `branch`, `price` |
| subject_id | UUID | NOT NULL, indexed |
| signal_type | VARCHAR(40) | NOT NULL |
| severity | SMALLINT | CHECK 0–100 |
| created_at | TIMESTAMPTZ | NOT NULL |

### `fraud_cases`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| subject_type | VARCHAR(20) | NOT NULL |
| subject_id | UUID | NOT NULL |
| risk_score | SMALLINT | CHECK 0–100 |
| status | VARCHAR(16) | CHECK in (`open`, `investigating`, `resolved_clear`, `resolved_action`, `appealed`) |
| assigned_to | UUID | FK `vendors.id` SET NULL |
| opened_at | TIMESTAMPTZ | NOT NULL |

### `fraud_case_events` and `audit_events` (append-only)
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| case_id | UUID | nullable for `audit_events` |
| actor_vendor_id | UUID | FK SET NULL |
| action | VARCHAR(60) | NOT NULL |
| entity_type | VARCHAR(40) | NOT NULL |
| entity_id | UUID | NOT NULL |
| payload | JSONB | NOT NULL, default `{}`. Never contains personal data or secrets. |
| created_at | TIMESTAMPTZ | NOT NULL |

`consumer_transactions` is referenced in section D, so it is defined here:

### `consumer_transactions`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| account_vendor_id | UUID | FK `vendors.id` CASCADE, the person who made the purchase |
| branch_id | UUID | FK `business_branches.id` CASCADE, indexed |
| transaction_at | TIMESTAMPTZ | NOT NULL |
| amount_minor | BIGINT | CHECK > 0 |
| currency_code | CHAR(3) | NOT NULL |
| merchant_reference | VARCHAR(80) | nullable |
| receipt_evidence_id | UUID | FK `evidence_assets.id` SET NULL |
| status | VARCHAR(16) | CHECK in (`submitted`, `validated`, `rejected`, `disputed`) |
| evidence_tier | VARCHAR(24) | same values as `business_reviews.evidence_tier` |
| created_at | TIMESTAMPTZ | NOT NULL |

- Unique (`branch_id`, `merchant_reference`) where `merchant_reference` is not null. This blocks reuse of one receipt number.
- A receipt upload is `submitted`. It becomes `validated` only after the validation step. Uploading a receipt never counts as a confirmed transaction by itself.

### `transaction_tokens`
| Column | Type | Constraints |
|---|---|---|
| id | UUID | PK |
| branch_id | UUID | FK CASCADE |
| token_hash | CHAR(64) | UNIQUE. The token itself is never stored. |
| expires_at | TIMESTAMPTZ | NOT NULL |
| consumed_at | TIMESTAMPTZ | nullable |
| consumed_by_vendor_id | UUID | FK SET NULL |

- A token can be consumed once, and only before `expires_at`. Consumption must be atomic (`UPDATE ... WHERE consumed_at IS NULL`).

## G. Existing tables: reused, not changed

| Table | How MarketTrust uses it |
|---|---|
| `vendors` | Business and person account identity. No schema change. |
| `business_claims`, `claim_events` | Ownership claims. Branch scope added later through a new field, not now. |
| `market_observations`, `market_intake_batches` | Seed source for `price_observations` (import, one-off). Kept as the intake record. |
| `stock_items`, `stock_movements` | Shop inventory and B2B trades. The consumer-side stock fact is `stock_observations`. |
| `offer_confirmations` | Model for the verified-trade rule. |
| `custody_ledger`, `disbursements`, `reconciliation_runs` | Pattern and job reused. Rewards get their own ledger (see section E). |
| `psp_client.py` (mock mode) | Payout provider. Mock stays on. |
| `governance_audit_events`, `vendor_appeals` | Appeals and audit reuse. |
| `vendor_list_reviews`, `knowledge_reviews` | Left as they are. Different subjects. |

## Migration order

1. `countries`, `evidence_assets`, `audit_events`.
2. `business_branches`, `branch_verifications`.
3. `products`, `product_variants`, `branch_listings`, `price_observations`, `stock_observations`.
4. `consumer_transactions`, `transaction_tokens`, `business_reviews`, `review_responses`, `review_reports`, `review_disputes`, `reputation_snapshots`.
5. `contribution_tasks`, `reward_rules`, `task_submissions`. No money tables yet.
6. `reward_ledger`, `withdrawal_requests`, `payout_transactions`, only after the legal review in `06` is complete.
7. `fraud_signals`, `fraud_cases`, `fraud_case_events`.

Each step is one Alembic migration, additive only, with a downgrade and a test that runs upgrade, downgrade and upgrade on a throwaway database.

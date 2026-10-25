# Remediation log — 2026-10-25

What shipped in response to `2026-10-25-saas-readiness-audit.md` and the build
notes, in the order they demanded: security → configuration → revenue → trust →
intelligence → measurement.

Four statuses, used strictly:

* **PASS** — executed here, with the evidence written down.
* **FAIL** — executed and did not hold. Anything found this way is listed with its fix.
* **BLOCKED** — could not execute in this environment (no credentials, no egress,
  no production database). Never counted as a pass.
* **NOT RUN** — deliberately not built or not attempted, with the reason.

---

## 1. Security boundary — PASS

| Gap | Change | Evidence |
|---|---|---|
| G-01 default JWT secret | `validate_production_settings()` rejects the shipped default or any key < 32 chars when `ENVIRONMENT=production`. Runs on `Settings` construction **and** again at app startup. | `tests/test_security_defaults.py` — 9 tests. The forgery test replays the original attack: default key → `200` as another vendor; private key → `401`; genuine token still `200`. |
| G-02 default webhook secret | Same guard for `PSP_WEBHOOK_SECRET` once `PSP_PROVIDER != mock`. | A body signed with the public default → `401`; a correctly signed body still reaches the handler. |
| G-05 open ops endpoints | `require_operator` on every `/api/ops/*` route, backed by `OPERATOR_HANDLES`. Empty list grants nobody — it fails closed. | Plain vendor `403`, listed operator `200`, unauthenticated `401`. |
| G-10 public metrics | Production with no `METRICS_TOKEN` returns `404`; with one, `?token=` or bearer is required. | Dev `200`, prod-without-token `404`. |
| G-15 DDL at boot | `settings.auto_create_tables` is false in production unless `ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION=true`. | Property test pins both branches. |

Rotating `SECRET_KEY` invalidates existing sessions. With one real account that is
free; do it deliberately, not during a deploy.

## 2. Production determinism — partial

- **PASS** — startup fails loudly on a bad secret and on unreachable dependencies;
  `/api/health` names the fault.
- **PASS** — `/api/ops/status` publishes the payment mode (`provider`, `available`,
  `reason`), so "mock in production" can never again be silent.
- **PASS** — schema is Alembic's job. `alembic upgrade head` on an empty database and
  a table/column parity check (`backend/scripts/schema_parity.py`, added this phase):
  **114 model tables, 0 missing tables, 0 missing columns**, and `downgrade -1`
  reverses cleanly.
- **FAIL (pre-existing, not fixed)** — `alembic check` is *not* clean. It reports
  index **name** drift on ~40 indexes across request/hustle/market tables: the models
  use `index=True` (auto-named `ix_<table>_<column>`) while older migrations used
  hand-written names. Nothing is missing and no query is affected — the same indexes
  exist under different names — but the gate cannot be used as-is. Fixing it means
  renaming either the migrations or ~40 model indexes; that is a deliberate, boring
  migration in its own change, not something to smuggle into a security release.
- **BLOCKED** — Vercel environment audit, Supabase backup/PITR entitlement check and a
  restore drill need dashboard access this environment does not have.

## 3. Payments

**Track 1 — transaction payments**

- **PASS** — `PSPError` maps to `503` with a stated reason and the provider name;
  `settings.payments_available` is the single source of truth.
- **PASS** — duplicate webhooks do not duplicate financial effects (existing suite).
- **PASS** — a vendor now sees every payment attempt, its state and its receipt:
  `/payments` reads `GET /api/payments/intents` and shows paid / awaiting provider /
  failed separately, prints a receipt number **only** when the provider confirmed
  it, carries the failure reason, and links to support and the refund policy. A
  pending payment says "do not pay twice" rather than leaving a blank state.
- **BLOCKED** — a real IntaSend collection and disbursement, and settlement against
  the internal ledger. No PSP credentials, no egress to the provider.

**Track 2 — subscription billing (built this phase)**

- **PASS** — `subscriptions` + `subscription_invoices` (migration `0023`), with a
  partial unique index allowing one live subscription per vendor and a unique
  `psp_reference` as the idempotency key.
- **PASS** — plans activate only from a *verified* `subscription.paid` event arriving
  through the same HMAC-verified webhook as money; a mismatch between the provider's
  amount and the invoice amount refuses to settle (`502`, so the PSP retries).
- **PASS** — failure → `past_due` + 7-day grace (entitlements retained); lapse →
  `expired` + back to Starter, records and verification untouched; `cancel_at_period_end`
  keeps the paid period.
- **PASS** — one trial per vendor, ever: cancel-and-resubscribe is not a free plan.
- **PASS** — `billing.live` is false on the mock provider and every billing response
  carries it; the mock payment simulator refuses to run once a real provider is set.
- **BLOCKED** — an actual recurring charge. The state machine is proven; the revenue
  is not. `TRIAL_TERMS.status` in the storefront catalogue therefore stays
  `not_yet_live`, because a live card trial has still never been verified for this
  merchant account.

## 4. Trust and data rights — PASS

| Gap | Change | Evidence |
|---|---|---|
| G-06 no export | `GET /api/vendors/me/export` — own account, stock, movements, requests, offers, claims, sent-message metadata. Counterparty notes and evidence excluded by design. | Contains mine, not another vendor's; `401` without a token. |
| G-06 no deletion | `POST /api/vendors/me/close` — typed handle, identity anonymised, claims withdrawn, sellable stock zeroed, password destroyed, **live sessions killed** (`closed_` prefix rejected in `get_current_vendor`). | Old password `401`, old token `401`, handle reusable, trade rows retained. |
| G-08 no trust surface | `/legal`: privacy, terms, payments/refunds/disputes, data rights, support — plus the two buttons that exercise them. | `subscription.test.jsx`, `morningBrief.test.jsx`, full suite green. |

Legal caveat, unchanged: erasure is not the same as deleting financial and audit
records; DPA 2019, VAT/eTIMS, KYC and PSP onboarding all still need Kenyan
professional review. The page says so rather than implying compliance.

## 5. Morning Brief — PASS (deterministic, no LLM)

`GET /api/brief/morning` — read-only, vendor-scoped from the token (no id parameter),
every line citing the records it came from and the route that opens them.

| Signal | Rule | Route |
|---|---|---|
| `low_stock` | sellable ≤ 5 units, or none | `/stock` |
| `pending_movements` | pending/confirmed/shipped, flagged when > 48 h old | `/orders` |
| `expiring_claims` | printed expiry within 30 days or past | `/me` |
| `open_requests` | open, not mine, no offer from me, last 14 days | `/` |
| `receivables` | a movement I supplied that the buyer *received*, with no completed `stock_movement_payment`; flagged critical when unpaid for more than 7 days | `/orders` |

Each signal carries `record_ids` (first 10), `severity`, `occurred_at`. One failing
signal degrades to a labelled line instead of blanking the screen. On the client:
loading, empty, populated, error+retry, and a **retained-stale** state — a failed
refresh keeps the last brief on screen with its generation time rather than losing a
list of overdue work to a dropped connection.

**Receivables — now PASS, without inventing a table.** The schema has no
receivable model, and adding one would duplicate what the ledger already knows.
The record that proves a debt exists is a movement the vendor supplied
(`from_vendor_id`) that the buyer has *received*, with no completed
`stock_movement_payment` against it: delivered, unpaid, citable by movement id.
Payments merely in flight are counted separately from debts, because the vendor's
next action differs. Verified paid → the signal clears (tested). Two things stay
out of scope and are named as such: interest/credit terms, and money owed by
someone who never placed an order on the platform.

## 6. Measurement — PASS

`GET /api/ops/measurement` (operator only), plus a panel in the Ops console.

- Registered → activated → repeated-use funnel, active-last-7-days, payment
  completion rate, stock items, requests, offers, movements.
- **Every number ships with the definition that produced it** — the response includes
  a `definitions` block, so a metric cannot drift from its meaning unnoticed.
- `benchmark_gate` answers "may we publish a comparison?" in code: ≥25 vendors
  with settled trade, ≥3 publishable categories, ≥5 vendors per published cell
  (k-anonymity) and a ≥30-day window. It returns the reasons it is refusing and
  the categories it suppressed — named, never silently rounded away.
- `not_measured` names what the platform *cannot* honestly measure and why:
  `cost_per_vendor` (needs invoices this service cannot read), `brief_opens` (no
  client event store — adding one is a consent decision), `revenue` (payment intents
  are not platform revenue; only the PSP and bank statements are).

## 7. Operations — documented, drilled where possible

`docs/ops/runbook.md`: secret generation and rotation, restore drill against an
isolated database, migration policy, dependency-outage drills, interrupted-transaction
drill, incident response, quarterly access review, low-bandwidth device check.

| Drill | Result |
|---|---|
| Ledger rejects `UPDATE` and `DELETE` | **PASS** — `custody_ledger is append-only: UPDATE/DELETE` raised by the trigger |
| API with Postgres refusing connections | **PASS** — `/api/health` `503`, `database=false`, `ConnectionRefusedError`, process alive |
| API with Postgres accepting, then stalling | **FAIL → fixed** — the request hung until the client gave up. `app/database.py` now sets `connect_args.timeout=10`, `command_timeout=30`, `pool_timeout=10`, so a dead database becomes a `503` instead of a hang. Found by running the drill, not by reading the code. |
| `scripts/restore_check.py` on a healthy copy | **PASS** — schema 114/114, ledger UPDATE refused by `trg_custody_ledger_append_only`, 0 orphans, exit 0 |
| Same check with the trigger dropped | **PASS as a negative test** — `[FAIL] ledger: trigger MISSING`, exit 1. The check is not vacuous. |
| Backup restore from Supabase | **BLOCKED** — no Supabase access from here |
| Access review | **NOT RUN** — needs the production dashboards |

## 8. Verification summary

Executed 2026-10-25 in this environment:

| Gate | Result |
|---|---|
| Backend suite | **324 passed** (audit baseline 280) |
| Frontend suite | **237 passed**, 25 files (baseline 214) |
| Production build | clean (`vite build`, ~6 s) |
| ESLint (changed files) | clean |
| Migration | `alembic upgrade head` + `downgrade -1` on empty DB: **PASS**; table/column parity **114/114** |
| `alembic check` | **FAIL (pre-existing index-name drift)** — see §2 |
| Live end-to-end on real Postgres | register `201` → brief cites the stock id → export `200` → ops `403`/`200` → measurement `200` → billing trial → mock payment `paid` → plan `readiness` → sweep `200` → metrics `200`/`404` → close `200`, then `401` |
| Offline states (`/brief`, `/payments`) | **PASS** — cached copy paints while the radio is off, the refresh control is disabled rather than lying, the cache is per account and is purged on logout and account closure; 19 new tests across page and cache |
| Tenant isolation (new surfaces) | **PASS** — another vendor's brief cites none of my owned record ids, my export contains none of their stock, their payment intent is a `404`, their subscription and invoices are invisible |
| Flake note | one frontend failure was observed once in a full run and did not reproduce in two subsequent full runs (227/227 each). Recorded rather than hidden; worth watching. |
| Deployed verification | **BLOCKED** — no Vercel egress |
| Real PSP transaction | **BLOCKED** — no credentials |
| Physical Android / throttled network | **BLOCKED** |
| Vendor pilot | **BLOCKED** — no consenting vendors in this environment |

## 9. Deployment notes

New or changed environment variables:

```
ENVIRONMENT=production                      # turns on every guard below
SECRET_KEY=<openssl rand -hex 32>           # required; startup refuses the default
PSP_WEBHOOK_SECRET=<openssl rand -hex 32>   # required once PSP_PROVIDER != mock
OPERATOR_HANDLES=<your handle>              # who may read /api/ops/*; empty = nobody
METRICS_TOKEN=<random>                      # or /api/metrics is 404 in production
ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION=false # leave false; Alembic owns the schema
```

Order of operations: set `SECRET_KEY` **before** `ENVIRONMENT=production`, or the
deploy will (correctly) refuse to start — and every existing session will need a
fresh login. Run `alembic upgrade head` before starting the new code; migration
`0023` is additive and safe to apply first.

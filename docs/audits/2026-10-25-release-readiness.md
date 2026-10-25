# Release readiness — 2026-10-25

The build notes' §8 checklist, answered item by item. Four statuses, used
strictly: **PASS** (executed here, evidence named) · **FAIL** (executed and it did
not hold) · **BLOCKED** (cannot execute in this environment) · **NOT RUN**
(deliberately not built or not attempted, with the reason).

A blocked check is never counted as a pass. Where something is blocked, what it
would take to close it is written down.

Baseline before this work (audit, 2026-10-25): 280 backend tests, 214 frontend
tests, two reproduced security failures. Current: **322 backend**, **237
frontend**, both suites green.

---

## Security

| Item | Status | Evidence |
|---|---|---|
| Production startup rejects default signing and webhook secrets | **PASS** | `validate_production_settings()` runs on `Settings` construction **and** in `lifespan`. `tests/test_security_defaults.py` constructs the bad configurations and boots the app with them. |
| Ops routes reject vendors without the required role | **PASS** | `require_operator` on every `/api/ops/*`; `OPERATOR_HANDLES` empty = nobody. Plain vendor `403`, anonymous `401`, listed operator `200`. |
| Metrics protected or disabled | **PASS** | Production without `METRICS_TOKEN` → `404`. With one → `?token=`/bearer required. |
| Security regressions cover the two reproduced exploits | **PASS** | Forged JWT: default key `200` as another vendor → private key `401`, genuine token still `200`. Forged webhook: signature from the published default → `401`; correctly signed body still processed. |

## Revenue

| Item | Status | Evidence |
|---|---|---|
| Live PSP collection verified in the intended environment | **BLOCKED** | No PSP credentials and no egress to IntaSend from this environment. Closing it needs: a sandbox key, one real collection, the callback landing on the deployed URL, and the receipt visible in `/payments`. |
| Disbursement and settlement reconcile against the internal ledger | **PASS (mock PSP)** | `tests/test_v25_payments_chamas.py::test_reconciliation_matched_then_variance_then_resolved` — wallet balances reconcile to the ledger, a tampered PSP side produces `variance_found` with the exact difference, the run upserts per (date, wallet) rather than duplicating, and resolution is audited. **BLOCKED** against a real provider. |
| Duplicate webhooks do not duplicate financial effects | **PASS** | `test_webhook_rejects_bad_signature_accepts_valid_and_is_idempotent`: replay leaves exactly one ledger row and one balance movement. Billing has its own replay test keyed on the unique `psp_reference`. |
| Unavailable payments return explicit, documented errors | **PASS** | `PSPError` → `503` with `reason` and `provider`; `/api/ops/status` publishes `payments.available`; the mock provider refuses to sell a plan in production (`503`, no plan change). |

## Trust

| Item | Status | Evidence |
|---|---|---|
| Privacy, terms, refund and support surfaces are published | **PASS** | `/legal` — privacy, terms, payments/refunds/disputes, data rights, support. States plainly that formal counsel-reviewed versions are required, rather than implying compliance. |
| Personal-data export and account-closure workflows are tested | **PASS** | `GET /api/vendors/me/export`, `POST /api/vendors/me/close`: old password `401`, old token `401`, handle reusable, trade rows retained, counterparty notes excluded. Cross-vendor leak tests added. The device copy is cleared on logout and on closure. |
| Backup restoration and incident procedures are documented | **PASS (documented) / BLOCKED (executed against Supabase)** | `docs/ops/runbook.md` + `backend/scripts/restore_check.py`, which verifies schema parity, the append-only trigger firing on a real row, data landmarks and orphans, and exits non-zero on failure. Proven non-vacuous: dropping the trigger gives exit 1. **A real Supabase backup has not been restored here** — no access. |

## Product

| Item | Status | Evidence |
|---|---|---|
| Morning Brief is vendor-scoped, read-only, and record-cited | **PASS** | `GET /api/brief/morning`, no parameters. Five signals, each with `record_ids`, `severity`, `occurred_at`, `route`. Cross-vendor test proves one vendor's brief cites none of another's records. No write path exists. |
| Loading, empty, stale, offline and failure states are designed | **PASS** | `/brief` and `/payments`: skeleton, empty-as-a-real-answer, cached copy after a failed refresh (labelled with its time), explicit offline banner with the saved copy and a disabled refresh, and retryable failure with no copy. Cache is per account, purged on logout and on closure; another account's copy is removed when a new account uses the device. 7 brief tests, 6 receipts tests, 6 cache tests. |
| Activation and recurring usage can be measured | **PASS** | `GET /api/ops/measurement` — registered → activated → repeated funnel with **the definition returned alongside every number**, plus `not_measured` naming what cannot be measured and why. Surfaced in the Ops console. |

## Release

| Item | Status | Evidence |
|---|---|---|
| Backend and frontend suites pass after the changes | **PASS** | 322 backend, 237 frontend. |
| Production build completes cleanly | **PASS** | `vite build`, ~6 s. ESLint clean on changed files. |
| Deployment checks verified rather than inferred | **BLOCKED** | No Vercel or Supabase access. Closing it needs: a deploy of this branch, `/api/health` and `/api/ops/status` read from the deployed URL, and one authenticated request against production. |
| Every blocked external dependency is explicitly recorded | **PASS** | This document and `docs/audits/2026-10-25-remediation-log.md`. |

---

## The four things that are still open, and what closes them

1. **Live money (Track 1).** Needs PSP credentials and a callback reaching the
   deployed host. The code path is exercised end to end against the mock; the
   provider's signature scheme is the only unverified link.
2. **A real restore drill.** Needs Supabase access. The check script is written
   and proven; it has never seen a production backup.
3. **Deployed smoke tests.** Needs the deployment. Everything here ran against a
   local Postgres and an in-process app.
4. **A vendor pilot.** Needs consenting Kenyan vendors. Without it, every claim
   above about usefulness is a claim about code, not about people — the brief is
   explicit that consumer behaviour is only knowable by measuring it.

## Deliberately not built (NOT RUN)

- **Benchmark.** Now gated in code rather than in prose:
  `/api/ops/measurement` returns `benchmark_gate` with the thresholds
  (≥25 vendors with settled trade, ≥3 publishable categories, ≥5 vendors per
  published cell, ≥30-day window) and the reasons it is refusing today. Cells
  below the k-anonymity floor are suppressed and **named**, never rounded.
- **An LLM anywhere in the brief.** The brief's own rule is that a model must
  earn its place measurably. No baseline exists yet, so a summariser now would be
  an unmeasurable cost on top of a system that already answers the question.
- **Subscription revenue.** Track 2's state machine is built and tested; live
  recurring billing is not claimed, `billing.live` is false on the mock provider,
  and the storefront trial stays `not_yet_live`.

## Known defects carried forward, not hidden

- **`alembic check` fails** on pre-existing index-*name* drift (models use
  `index=True`, older migrations hand-named). No table or column is missing
  (`scripts/schema_parity.py`: 114/114, 0 missing columns). Fixing it is a rename
  migration in its own change.
- **In-memory rate limiter** on serverless: limits are per instance, so a
  multi-instance deployment effectively multiplies them. Needs Redis to be real.
- **One frontend test flaked once** in a full run during this work and passed in
  two subsequent full runs. Recorded rather than re-run until green.
- **`frontend/src/pages/noticeboard/NoticeBoardPage.jsx` has 6 pre-existing
  ESLint errors** (unused vars, untouched by this work, on `main` since
  `109b35e`). Left alone deliberately: it is unrelated to the security or
  compliance gates, and sweeping it into this branch would make the diff harder
  to review. ESLint is clean on every file this branch changed.

# Remediation log — 2026-10-25

What shipped in response to `2026-10-25-saas-readiness-audit.md`, in the order the
audit demanded (security → configuration → revenue-readiness → trust → intelligence).

Status vocabulary: **PASS** (executed, evidence below) · **FAIL** · **BLOCKED**
(could not execute here) · **NOT RUN**.

---

## 1. Security boundary — PASS

| Gap | Change | Evidence |
|---|---|---|
| G-01 default JWT secret | `validate_production_settings()` rejects the shipped default or any key < 32 chars when `ENVIRONMENT=production`. Called on `Settings` construction **and** again at app startup. | `tests/test_security_defaults.py` — 9 tests. The forgery test reproduces the original attack: with the default key a forged token returns `200`; with a private key it returns `401`, while a genuine token still returns `200`. |
| G-02 default webhook secret | Same guard for `PSP_WEBHOOK_SECRET` once `PSP_PROVIDER != mock`. | Forged HMAC with the public default → `401`; correctly signed body still reaches the handler. |
| G-05 open ops endpoints | `require_operator` on all five `/api/ops/*` routes, backed by `OPERATOR_HANDLES` (comma-separated handles). Empty list grants nobody — it fails closed. | Plain vendor → `403`; listed operator → `200`; unauthenticated → `401`. |
| G-10 public metrics | Production with no `METRICS_TOKEN` returns `404`; a token, when set, is required via `?token=` or bearer. | Dev `200`, prod-without-token `404`. |
| G-15 DDL at boot | `settings.auto_create_tables` is **false** in production unless `ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION=true`. | Property test pins both branches. |

Rotating `SECRET_KEY` invalidates existing sessions. With one real account that is free;
do it deliberately on a quiet afternoon rather than during a deploy.

## 2. Production determinism — partial PASS

- **PASS** — startup fails loudly on a bad secret; `/api/health` still reports
  `database` and `schema` and now names the fault (from the previous fix).
- **PASS** — `/api/ops/status` publishes the payment mode (`provider`, `available`,
  `reason`) so "mock in production" can never be silent again.
- **BLOCKED** — Vercel environment audit, Supabase backup/PITR entitlement check and a
  restore drill all need dashboard access this environment does not have.

## 3. Payments — partial

- **PASS** — `PSPError` now maps to `503` with a stated reason and the provider name,
  instead of a 500. `settings.payments_available` is a single source of truth for
  "can this deployment take money".
- **PASS** — mock payments remain refused in production (pre-existing, now surfaced).
- **BLOCKED** — a real IntaSend collection and disbursement. No PSP credentials here.
- **NOT RUN** — subscription billing (Track 2). Deliberately not built: a state machine
  that cannot be exercised against a provider event stream is not evidence, it is
  guesswork with a deploy attached. The catalogue already states the tier is not live.

## 4. Trust and data rights — PASS

| Gap | Change | Evidence |
|---|---|---|
| G-06 no export | `GET /api/vendors/me/export` returns the member's own account, stock, movements, requests, offers, claims and sent-message metadata. Counterparty notes and evidence are excluded by design. | Export contains mine, not another vendor's stock; `401` without a token. |
| G-06 no deletion | `POST /api/vendors/me/close` — handle-typed confirmation, anonymises identity, withdraws claims, zeroes sellable stock, destroys the password, and **kills live sessions** (a closed handle is rejected in `get_current_vendor`). | Old password → `401`; old access token → `401`; handle reusable; trade rows retained. |
| G-08 no trust surface | `/legal` page: privacy, terms, payments/refunds/disputes, data rights, support — plus the two buttons that exercise them. | Frontend test suite green; page reachable from Profile → Trust & data. |

Legal caveat carried forward unchanged: erasure is not the same as deleting financial and
audit records, and DPA 2019, VAT/eTIMS, KYC and PSP onboarding all still need Kenyan
professional review. The page says so rather than implying compliance.

## 5. Morning Brief — PASS (deterministic; no LLM)

`GET /api/brief/morning` — read-only, vendor-scoped from the token (no id parameter),
and every line cites the records it came from plus the route that opens them.

| Signal | Rule | Route |
|---|---|---|
| `low_stock` | sellable ≤ 5 units, or none | `/stock` |
| `pending_movements` | pending/confirmed/shipped, flagged when > 48 h old | `/orders` |
| `expiring_claims` | printed expiry within 30 days or past | `/me` |
| `open_requests` | open, not mine, no offer from me, last 14 days | `/` |

Every signal carries `record_ids`, `severity`, `occurred_at`. One failing signal degrades
to a labelled "could not be checked" line instead of blanking the screen.

**No AI is used.** The audit's guidance was to start deterministic and add a model only
when it measurably helps; the endpoint's contract (cited, read-only, no writes) is the
part that matters, and it holds whether or not a summariser is ever added later.

**Receivables signal: NOT RUN.** There is no receivable/payable model in this schema
(orders settle at delivery), so inventing one for a dashboard card would have meant a
migration plus a policy decision about credit terms. Left out rather than faked.

## 6. Verification summary

Executed 2026-10-25 in this environment:

| Gate | Result |
|---|---|
| Backend suite | **303 passed** (was 280; +9 security defaults, +14 v2.15 trust/brief) |
| Frontend suite | **217 passed**, 22 files (was 214) |
| Production build | clean, `vite build` 8.35s |
| ESLint (changed files) | clean |
| Live end-to-end (real Postgres) | register 201 → brief cites the stock id → export 200 → ops 403/200 → metrics 200/404 → close 200, then 401 |
| Deployed verification | **BLOCKED** — no Vercel egress |
| Real PSP transaction | **BLOCKED** — no credentials |
| Physical Android / throttled network | **BLOCKED** |
| Backup restore drill | **BLOCKED** |

## 7. Deployment notes

New or changed environment variables:

```
ENVIRONMENT=production                 # turns on every guard below
SECRET_KEY=<openssl rand -hex 32>      # required; startup refuses the default
PSP_WEBHOOK_SECRET=<openssl rand -hex 32>   # required once PSP_PROVIDER != mock
OPERATOR_HANDLES=<your handle>         # who may read /api/ops/*; empty = nobody
METRICS_TOKEN=<random>                 # or /api/metrics is 404 in production
ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION=false   # leave false unless first boot
```

Order of operations: set `SECRET_KEY` **before** enabling `ENVIRONMENT=production`, or the
deploy will (correctly) refuse to start, and every existing session will need a fresh login.

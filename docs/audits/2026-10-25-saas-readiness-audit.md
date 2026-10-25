# Brief — SaaS AI-Readiness & African Market-Fit Audit

**Date:** 2026-10-25
**Commit audited:** `109b35e` (`main`)
**Scope:** backend (FastAPI), frontend (Vite/React), schema, auth, payments, tests, deployment config
**Method:** inspect code → run the suites → attempt the attacks → report only what produced evidence

---

## 0. Method, and what this audit could not do

Everything in section C was executed in this environment. Where a required resource
was unavailable, the row says **BLOCKED** and names the resource — no row is marked
passed on the strength of the code existing.

| Resource | Available? | Consequence |
|---|---|---|
| PostgreSQL 16/17 (local, via `pgserver`) | Yes | Full backend suite + live journey tests ran against a real dialect |
| Test suite (pytest / vitest) | Yes | 280 + 214 tests executed today |
| Supabase project `hdxhoovnleuepnnulsel` | Partially — schema and SQL via API, **no TLS egress** | Table/constraint facts verified; could not connect as the app |
| Vercel deployment | **No** | Dashboard env, live URLs, cold-start behaviour, real-device testing all BLOCKED |
| IntaSend (real PSP) credentials | **No** | Real money movement BLOCKED; mock PSP used to exercise the flow |
| Physical Android device / throttled network | **No** | Mobile usability BLOCKED (code-level review only) |

The audit is therefore strong on **code, schema, tests and attack surface**, and silent
on **production configuration**. Section B marks which gaps are config-dependent.

---

## A. Executive summary

**Is it ready for real customers?** The product is a genuinely serious system of record.
It is **not yet a business**: the money path is switched off in production, the
subscription engine is deliberately not built, and two shipped defaults would let an
attacker take over accounts if they reach production unset.

**What is working (verified today)**

- 280 backend tests and 214 frontend tests pass (section C). These are not smoke tests:
  they cover the order lifecycle, custody ledger append-only enforcement, dual-approval
  disbursements, reconciliation variance, chama loans, and webhook idempotency.
- The core journey runs end to end against a real Postgres: register `201` → login `200`
  → `/vendors/me` `200` → add stock `201` → read stock `200`.
- Clean error semantics where it matters: no token `401`, duplicate registration `400`,
  wrong password `401`, login lockout `429` on the 5th failure.
- The schema is real: **113 tables**, an append-only custody-trigger enforced *in the
  database*, 22 Alembic migrations, and a migration/model drift test in the suite.
- Payment corridor is correctly shaped: HMAC-verified single webhook, idempotent on
  intent state, mock PSP **refused in production**, append-only ledger, dual approval
  above KSh 10,000.

**What is risky (verified today)**

1. **Account takeover via the shipped default `SECRET_KEY`.** With `ENVIRONMENT=production`
   and no `SECRET_KEY` set, a token signed with the public default value authenticated as
   an existing vendor → `200 victim_user`. Reproduced, not theorised (T-09).
2. **Forged payment webhooks via the shipped default `PSP_WEBHOOK_SECRET`.** A body signed
   with the public default passed signature verification (T-10). Correct signature
   handling otherwise — a wrong signature is rejected `401`.
3. **No revenue path in production.** `PSP_PROVIDER` defaults to `mock`, and production
   refuses mock; subscription billing is explicitly `not_yet_live`. A vendor cannot pay
   you, and a market cannot take money, until a real PSP is configured.
4. **No data-subject rights.** No account deletion and no personal-data export, both of
   which Kenya's Data Protection Act 2019 makes requestable.
5. **Ops surfaces are member-readable.** `/api/ops/status`, `/api/ops/slow`,
   `/api/ops/jobs` require only *any* authenticated vendor, not an operator role.

**The one-line verdict:** the engineering is ahead of the commercial and operational
readiness; the next 30 days should finish the money path and the trust surface, not add
features.

---

## B. Gap register

Severity: **Critical** (exploitable/unsafe to ship) · **High** (blocks launch or revenue) ·
**Medium** (material but survivable) · **Low** (hygiene).

| ID | Gap | Evidence | Impact | Sev | Complexity |
|---|---|---|---|---|---|
| G-01 | Default `SECRET_KEY` accepted in production | `backend/app/config.py:89`; forged JWT → `200` as another vendor (T-09) | Total account takeover; all JWTs forgeable | **Critical** | S |
| G-02 | Default `PSP_WEBHOOK_SECRET` accepted in production | `config.py:136`; forged signature passed the gate (T-10) | Attacker can settle/complete payments for a known reference | **Critical** | S |
| G-03 | Payments disabled in production by default | `config.py:131` `PSP_PROVIDER="mock"`; `psp_client.py:417` refuses mock in prod | No vendor can transact; checkout raises, revenue zero | **High** | M |
| G-04 | No subscription billing engine | `modules/catalog/models.py:13` states the tier is `not_yet_live` until a recurring provider is verified | Cannot charge for the SaaS itself; no MRR | **High** | L |
| G-05 | Ops endpoints not role-gated | `routes/ops.py:331,389,398,538,574` use `get_current_vendor` only | Any member reads internal config, pool stats, job control | **High** | S |
| G-06 | No account deletion / personal-data export | No `DELETE /vendors/me`, no export of a member's own profile; only trade-record export exists (`modules/orders/router.py:542`) | DPA 2019 rights unmeetable; blocks enterprise/institutional sales | **High** | M |
| G-07 | Backup & recovery unverified on the deployed stack | `pg_dump` job exists only in `docker-compose.prod.yml:127`; Vercel+Supabase path has no application-level backup or restore drill | Data loss is unrecoverable if Supabase plan lacks PITR | **High** | M |
| G-08 | No privacy notice, terms, or support channel in the UI | No `privacy`/`terms` route in `frontend/src`; no support address surfaced | Trust, app-store/M-Pesa onboarding, and DPA notice duty all fail | **High** | S |
| G-09 | Brute-force budget is per-instance on serverless | `middleware/rate_limiter.py` falls back to `_MemoryBackend`; `REDIS_URL` default host `redis` is unreachable on Vercel | Lockout still works per instance (T-11) but scales with concurrency | **Medium** | S |
| G-10 | `/api/metrics` public by default | `routes/ops.py:317`; `METRICS_TOKEN=""`; whitelisted in `middleware/vendor_only.py:17` | Leaks traffic, latency, error rates | **Medium** | S |
| G-11 | No offline cache / service worker; weak-network behaviour unproven | `sessionStorage` receipt queue only (`lib/offlineReceipt.js`); no SW in `frontend/public` | First-load failure on 3G leaves a blank app; unverified on device | **Medium** | M |
| G-12 | Uploaded files public by unguessable URL | `/static` mount (`main.py:209`); documented as intentional | Spec sheets can carry prices; a leaked link is permanent access | **Medium** | M |
| G-13 | Single currency + fixed timezone | KSh caps in `config.py:138-169`; `Africa/Nairobi` in 4 places; catalog prices in KES | "Kenya first" is coherent; any second country is a data-model change | **Medium** | L |
| G-14 | English only | No i18n framework; no Swahili strings | Limits reach among Kenyan SMEs; not a launch blocker | **Medium** | L |
| G-15 | `AUTO_CREATE_TABLES=true` by default | `config.py:80`; DDL at boot | Schema drift risk once Alembic is authoritative | **Low** | S |
| G-16 | `/docs` and `/openapi.json` still served by the backend | FastAPI defaults; hidden only by the Vercel rewrite | Protected at the edge, not in the app | **Low** | S |
| G-17 | No tax computation (VAT/eTIMS) | KRA PIN and eTIMS appear only as *evidence types* in `modules/standing/catalog.py` | Fine as a record-keeper; invoicing compliance is a product decision | **Low** | — |

### Detail on the two critical gaps

**G-01 — token forgery.** `create_access_token` signs with `settings.SECRET_KEY`, whose
default is the literal string `vendor-network-secret-change-in-production`. Nothing
refuses to start in production with that value. Anyone who reads the repository can mint
a token for any `sub`. Reproducer in Appendix A; result below.

```
ENVIRONMENT = production | is_production = True
SECRET_KEY is the public default = True
victim registered: 201
FORGED TOKEN -> /api/vendors/me: 200 victim_user
```

**Mitigation status:** if `SECRET_KEY` was set in the Vercel dashboard (it was in the deploy
notes), the deployment is *currently* safe — but safety depends on an operator remembering
a step, and the next environment (preview, staging, a colleague's clone) starts unsafe.
**Fix:** fail closed. Refuse to boot when `is_production` and the secret equals the default
or is shorter than 32 chars. Same guard for `PSP_WEBHOOK_SECRET`.

**G-02 — forged webhooks.** `verify_webhook_signature` HMACs the body with
`PSP_WEBHOOK_SECRET`, default `psp-webhook-secret-dev`. A forged body reached the handler
(`502 "Event not processed yet"` — rejected for an unknown reference, not for the
signature). The signature machinery itself is correct (T-10 wrong-signature → `401`), so
this is purely the default value.

---

## C. Test matrix

Executed 2026-10-25, 11:12–11:20 UTC. Environment: local Postgres 16 via `pgserver`,
Python 3.11, Node 22.

| ID | Test | Steps | Expected | Actual | Status |
|---|---|---|---|---|---|
| T-01 | Backend suite | `pytest tests -q` | all pass | **280 passed**, 132.38s | ✅ |
| T-02 | Frontend suite | `vitest run` | all pass | **214 passed**, 21 files, 116s | ✅ |
| T-03 | Frontend production build | `npm ci && vite build` | clean | clean, 8.35s (index 353 kB / 96 kB gz) | ✅ |
| T-04 | Health probe | `GET /api/health` | ok + db + schema | `200 {status:ok, database:true, schema:true}` | ✅ |
| T-05 | Register | `POST /api/auth/register` | 201 + token | `201` | ✅ |
| T-06 | Login by email / handle | `POST /api/auth/login` (form) | 200 | `200` / `200` | ✅ |
| T-07 | Session read | `GET /api/vendors/me` | 200 own profile | `200 achieng_o` | ✅ |
| T-08 | Create + retrieve stock | `POST /api/stock/add` → `GET /my-stock`, `GET /{id}` | 201 / 200 | `201`, `200` (1 item), `200` | ✅ |
| T-09 | **Forged JWT (default secret)** | sign `{sub: victim}` with public default | must be rejected | **`200 victim_user`** | ❌ **FAIL** |
| T-10 | Webhook signature | forged sig with default secret; then wrong sig | forged rejected | **forged accepted** (`502` past the gate); wrong sig `401` | ❌ **FAIL** |
| T-11 | Login lockout | 5 wrong passwords | 429 at limit | `401×4` then `429`, stays `429` | ✅ |
| T-12 | Unauthenticated access | `GET /api/vendors/me` no header | 401 | `401 "Not authenticated…"` | ✅ |
| T-13 | Duplicate registration | re-POST same email/handle | 400 | `400 "Email or handle already registered"` | ✅ |
| T-14 | Wrong password | login with bad password | 401 | `401 "Invalid credentials"` | ✅ |
| T-15 | Cross-tenant isolation | `test_live_order_journey.py`, `test_smoke.py` | 403 for non-owner | **8 passed**; e.g. buyer reading another's disputes → `403` | ✅ |
| T-16 | Ledger append-only | `test_custody_ledger_is_append_only` | UPDATE/DELETE refused | passed (DB trigger present in prod schema) | ✅ |
| T-17 | Migration/model drift | `test_migrations.py` | no drift | passed | ✅ |
| T-18 | Mock PSP refused in production | code path `psp_client.py:417` | raises | raises `PSPError` (code-level, no live PSP) | ⚠️ partial |
| T-19 | Real PSP end-to-end (IntaSend) | requires credentials | funds move | — | ⛔ **BLOCKED** (no PSP account) |
| T-20 | Deployed-app verification | requires Vercel access | /api/health ok | — | ⛔ **BLOCKED** (no egress) |
| T-21 | Mobile / 3G usability | requires device + throttle | usable | — | ⛔ **BLOCKED** (code review only) |
| T-22 | Backup restore drill | requires prod DB | restore succeeds | — | ⛔ **BLOCKED** |

**Score: 15 pass, 2 fail, 1 partial, 4 blocked.** Two failures are both configuration
defaults, both fixable in under an hour, both Critical.

---

## D. AI-threat assessment and moat scorecard

### D1. AI readiness

There is **no LLM, agent, embedding, or prompt in the codebase** (`grep -riE
"openai|anthropic|llm|gemini|prompt"` returns only "fulfillment"). Consequences:

- **Prompt-injection surface: zero today.** Nothing to test, nothing to leak through a
  model. This is a good starting position — most competitors have already bolted an agent
  onto the same CRUD surface.
- **Commoditization risk is real but narrow.** An AI builder can reproduce the screens,
  listings, chat and search in days. It cannot cheaply reproduce the parts that produce
  evidence: the append-only custody ledger with a database trigger, dual-approval
  disbursement rules, reconciliation with variance tolerance, market-ops roles, POS
  adapters, and the trade-record export customers would hand to a lender.
- **Third-party dependence** is ordinary and substitutable: Supabase (Postgres), Vercel,
  IntaSend, map tiles, Square/Shopify. The asset is the data model and the operating
  rules — both are in-repo, not in a vendor.
- **Seat-based pricing exposure:** none today, because there is no pricing at all.
  The per-account `plan_tier` exists as data; billing is explicitly not live (G-04).

### D2. The smallest useful agent

Not a chatbot over the whole database. The smallest agent that improves a real outcome:

> **A read-only "morning brief" for one vendor**, built from their own records: stock below
> reorder point, movements stuck awaiting confirmation, expiring claims, unanswered
> requests, and receivables due — each line citing the record ID it came from.

Why this one: it converts the system of record into a daily habit (retention), it needs no
write access (no new blast radius), and no competitor can copy it without the same
records. Guardrails if/when it is built:

- scope queries by `vendor_id` from the token, never from the prompt;
- read-only database role, no payment or admin credentials;
- hard caps on rows and tokens per request; log prompt + output + cited IDs;
- any *action* (restock, message, pay) requires explicit human approval and produces an
  audit row — the existing `audit` patterns and outbox are the place to put it;
- degrade to the deterministic summary when the provider is unavailable.

### D3. Eight-moat scorecard (0–5, with evidence)

| # | Moat | Score | Evidence |
|---|---|---|---|
| 1 | Customer trust & distribution | **2** | Primitives exist (standing/verification catalogue, public passport, audit exports); **no** privacy notice, terms, support channel, or a single verified production user |
| 2 | System of record | **4** | 113 tables; append-only ledger enforced by DB trigger; movement events; trade-record export; migration drift test |
| 3 | Ability to act | **3** | Order lifecycle, delivery quotes, POS bridge, custody desk all implemented and tested; **money path disabled in production** (G-03) |
| 4 | Reliable outputs customers trust | **3** | Reconciliation with variance tolerance, dual approval, audit trails, idempotent webhooks; but no alerting and no verified backup/restore on the deployed path |
| 5 | Regulatory approvals | **1** | Correct hedge (licensed PSP holds funds, app never custodies); no privacy notice, no DSR handling, no documented KYC/AML posture |
| 6 | Network effects | **1** | Coordination primitives exist (chamas, groups, market ops, connections) but zero vendors — no liquidity, no cross-side effect yet |
| 7 | Privacy-preserving learning loops | **1** | Scoring tables exist (`biashara_score_events`, `vendor_performance`); no aggregation, benchmarking, or privacy controls shipped |
| 8 | Difficult ongoing operations | **3** | POS adapters (Square/Shopify), offline receipt handling, reconciliation, market-ops roles — genuinely fiddly to operate; unproven at volume |

**Strongest two:** #2 system of record (4) and #8 difficult operations (3, tied with #3).
**Most achievable improvements:** #1 trust & distribution (days of work, no new tech) and
#7 privacy-preserving benchmarks (weeks — the data is already there).

> Honest caveat required by the checklist: storing customer data is **not** a learning
> moat. Until an aggregate benchmark ships (e.g. "your margin vs similar vendors in your
> zone"), #7 stays at 1.

---

## E. African market-fit report

### E1. Kenya (configured — this is the only supported market today)

| Area | Finding | Status |
|---|---|---|
| Currency | KSh/KES throughout config and catalogue | ✅ coherent |
| Timezone | `Africa/Nairobi` used for activity days and governance windows | ✅ |
| Phone / telco | 254-prefix → M-Pesa/Airtel/TKash mapping in `psp_client.py` | ✅ |
| Payments | IntaSend client implemented; mock refused in prod; HMAC webhook + idempotency tested | ⚠️ **blocked on credentials** (G-03) |
| Payment UX | Offers M-Pesa alternative to card-required trials in catalogue copy | ✅ good instinct |
| Connectivity | No service worker, no offline cache; only a session-scoped receipt queue | ⚠️ gap (G-11) |
| Devices | Responsive Tailwind, correct viewport meta; bundle 96 kB gz main + 43 kB leaflet | ⚠️ unverified on device |
| Privacy (DPA 2019) | No privacy notice, no data-subject access/erasure endpoints | ❌ gap (G-06, G-08) — **professional verification required** |
| Tax (VAT / eTIMS) | KRA PIN + eTIMS tracked as *credentials*, no invoice issuance or VAT compute | ⚠️ product decision — **professional verification required** |
| Language | English only | ⚠️ (G-14) |
| Support / refunds | No in-app support path or refund policy text | ❌ (G-08) |
| Unit economics | Per-request serverless + Supabase Nano; no metering of cost per vendor | ⚠️ unmeasured |

### E2. Expansion markets (not configured — do not claim support)

| Country | Blocker if launched today |
|---|---|
| Uganda / Tanzania / Rwanda | KES-only amounts and caps; no local PSP client; no local tax evidence types |
| Nigeria / Ghana | No Paystack/Flutterwave client; phone-prefix mapping is 254-specific; different data-protection regimes |
| Any | One currency field set, one timezone constant, one language — all would be schema or copy work |

**Rule applied:** one payment method, tax rule and legal framework does **not** generalise
across Africa; every country row above needs local counsel before it is claimed.

---

## F. Prioritised 30-day roadmap

Sequenced by risk × revenue, not by feature appeal.

### Days 1–7 — Prove the core, close the two critical holes
1. **G-01 / G-02: fail closed on default secrets.** Startup guard refusing the shipped
   defaults in production; regenerate `SECRET_KEY` and `PSP_WEBHOOK_SECRET` per environment.
   Rotating `SECRET_KEY` invalidates existing sessions — acceptable with one user.
2. **G-05: gate ops behind a role** (`require_market_ops` already exists).
3. **G-10: require `METRICS_TOKEN`.**
4. **G-07: confirm the Supabase plan's backup regime** and schedule a restore drill.
5. Interview 5–10 target vendors; record the top reason each would not pay.

*Exit: no Critical open; a written answer to "who pays, for what".*

### Days 8–14 — Make money possible
6. **G-03: configure IntaSend** (keys, webhook URL, sandbox → live), run one real
   collection and one disbursement end to end.
7. Add a **payment-mode banner** in ops so "mock in production" is loud, not silent.
8. **G-08: publish privacy notice, terms, refund policy, support address** in-app.
9. **G-06: ship delete-my-account and export-my-data** (soft delete + anonymise, JSON
   export) — this also unlocks institutional sales.
10. Validate onboarding on a real Android phone on throttled 3G.

*Exit: a vendor can pay you and can leave cleanly.*

### Days 15–21 — One defensible advantage
11. Pick **one** workflow and make it feel inevitable. Recommended: the **read-only morning
    brief** (D2), because it turns the ledger into a habit without adding write risk.
12. If time remains, ship the **zone benchmark** ("your margin vs similar vendors") — the
    first real activation of moat #7, computed from data already stored.

*Exit: one feature a competitor cannot copy without the same records.*

### Days 22–30 — Validate retention and economics
13. Run the full suite plus a failure drill: DB down, PSP down, duplicate webhook, expired
    token, interrupted upload.
14. Instrument activation (first stock item, first order), repeat usage, paid conversion.
15. Measure cost per vendor (Supabase + Vercel + PSP fees + any AI tokens).
16. Decide: what to fix, what to remove, what to build next.

*Exit: numbers, not opinions.*

---

## G. Automated tests to add (highest-risk first)

Specifications — not implemented here, per the audit-only rule. Each is small and belongs
in the existing suites.

**G-01 regression — `backend/tests/test_security_defaults.py`**

```python
def test_production_refuses_default_secret(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError):          # fail closed, not a warning
        importlib.reload(app.config)
```
Acceptance: importing config in production with the default secret raises; a forged token
signed with the default returns `401` (today it returns `200`, T-09).

**G-02 regression** — same pattern for `PSP_WEBHOOK_SECRET`; assert a body signed with the
default is rejected `401` (today it reaches the handler, T-10).

**G-05 regression** — a vendor with no ops role calling `/api/ops/status` expects `403`
(today `200`).

**G-06 acceptance** — `DELETE /api/vendors/me` → subsequent login `401`, and the row is
anonymised; `GET /api/vendors/me/export` returns a JSON document containing the vendor's
own records only.

**G-03 canary** — with `PSP_PROVIDER=mock` and `ENVIRONMENT=production`, collection
returns a typed `503 "payments unavailable"` rather than a generic 500.

**Frontend** — `RequireVendor` with a token and a failing profile call renders the
"Almost in" card (added in #57) and does **not** redirect to `/auth`.

---

## H. Highest-value improvements (retention, defensibility, willingness to pay)

1. **Make payments real, then say so on the landing page.** A trusted rail with a visible
   receipt is the single biggest driver of both retention and price tolerance.
2. **Publish the trust surface** (privacy, terms, refunds, support, who verifies a
   business). Cheap, and it converts "prototype" into "supplier" in a buyer's mind.
3. **Turn records into a daily habit** — the morning brief (§D2). Habit beats features.
4. **Ship one benchmark only you can compute** (zone-level margin/stockout comparison).
   This is moat #7's first real turn, and it is a paid-tier justification.
5. **Export that a lender accepts.** The trade-record export already exists; package it as
   a "credit pack" — that is a willingness-to-pay feature in this market, not a nicety.
6. **Deletion and export as a badge.** For institutions and co-operatives, "we can leave
   with our data" is a procurement requirement, not a favour.

---

## Appendix A — Reproducing the two critical findings

Both run against a throwaway Postgres with `ENVIRONMENT=production` and the secret unset.

```python
# G-01: token forgery
forged = jose.jwt.encode({"sub": victim_id, "exp": 4102444800, "type": "access"},
                         "vendor-network-secret-change-in-production", algorithm="HS256")
GET /api/vendors/me  Authorization: Bearer <forged>
→ 200 {"vendor_handle": "victim_user"}      # expected 401
```

```python
# G-02: forged webhook signature
sig = hmac.new(b"psp-webhook-secret-dev", body, hashlib.sha256).hexdigest()
POST /api/payments/webhook  X-Webhook-Signature: <sig>
→ 502 "Event not processed yet"             # signature gate passed; expected 401
```

## Appendix B — Commands used

```bash
# backend
python3 -m venv /tmp/bv && /tmp/bv/bin/pip install -r requirements.txt -r requirements-dev.txt
/tmp/bv/bin/python -m pytest tests -q          # 280 passed
# frontend
cd frontend && npm ci && npx vitest run        # 214 passed
npm run build                                  # clean
```

---

*Audit only. No production schema was altered; the single database change made during this
session (removing one test account) was authorised by the operator beforehand.*

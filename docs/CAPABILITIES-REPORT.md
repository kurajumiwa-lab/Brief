# Brief_ — current capabilities report

Date: 2026-10-11 · Branch: `arena/435dc440-brief` (working tree on top of `main` @ `1d6cfba`,
v2.11) · Scope: what the platform can actually do today, plus an audit of how the v2.11 work
was integrated — every change below either **updates an existing file** or **adds a file
alongside the code that already owns that concern**. Nothing was started as a parallel app,
service, database or client.

> **Provenance.** Every number and path in this report was read from the repository on this
> date, and every test result was produced by commands in §7 run in this session. Nothing is
> from memory or from the strategy documents. Sections 2–4 are capabilities that exist;
> §6 is the integration audit; §8 is the honest list of what does **not** exist yet.

---

## 1. At a glance (measured)

| Dimension | Count | Where it comes from |
|---|---|---|
| Backend | Python 3.11 · FastAPI 0.104 · SQLAlchemy 2 async (asyncpg) · Pydantic v2 · Postgres 16 · Redis | `backend/requirements.txt`, `app/main.py` |
| Routers | 31 in `app/routes/` + 2 module routers (`modules/trade`, `modules/standing`) | `ls app/routes/`, `include_router` calls |
| Endpoints | ≈306 route decorators | `grep -rhoE '@router\.(get\|post\|put\|patch\|delete)' app \| wc -l` |
| Models | 22 model files, ~75 tables | `ls app/models/*.py` |
| Migrations | `0001` … `0015_business_standing` (linear chain) | `alembic/versions/` |
| Backend tests | 15 test modules · **195 tests** | `pytest --collect-only -q` |
| Frontend | React 18 · Vite 5 · Tailwind 3 · zustand · axios · lucide-react | `frontend/package.json` |
| Frontend pages | 36 page components, 26 lazy route imports | `find src/pages -name '*.jsx'`, `App.jsx` |
| UI kit / client | 26 `components/ui` primitives · 27 API sections in `lib/api.js` · 12 zustand stores | `ls`, `grep '^export const .*API'` |
| Frontend tests | 12 files · **112 tests** | `vitest run` |
| Strategy docs | 8 briefs in `docs/briefs/`, latest the Kenya opportunity-network strategy | `ls docs/briefs/` |

---

## 2. Backend capability inventory

Capabilities are labelled **[shipped]** (in code and reachable), **[partial]** (works, gaps
noted in §8) or **[config-gated]** (behaviour requires an operator to set a value).

### Identity, profiles and trust
- Vendor identity with `@handle`, profiles, categories, locations; JWT auth with refresh,
  login lockout and a `VendorOnlyMiddleware`. **[shipped]** `routes/auth.py`, `routes/vendors.py`
- Connections between vendors plus patron standing recomputed per read (never stored).
  **[shipped]** `services/market_patrons.py`
- Explainable discovery ranking with per-candidate reasons and fixed weights
  (complementarity 25 / reciprocity 20 / trade_evidence 20 / proximity 15 / graph 10 /
  reputation 10); connected vendors are excluded unless explicitly included. **[shipped]**
  `services/discovery.py`

### Stock, quality and movements
- Stock Room with `QualityStatus`, provenance/verification flows, movement ledger, balances
  and reservations; verification and revocation endpoints. **[shipped]**
  `routes/stock.py`, `routes/verification.py`, `models/stock.py`

### Trade — requests, offers, requirements, watches (v2.9 → v2.11)
- Business requests of 6 kinds (stock, worker, delivery, rental, errand, service) with
  explicit state machines (`REQUEST_FLOW` / `OFFER_FLOW`), append-only `request_events`
  audit trail, offers (one per responder) and requester acceptance. **[shipped]**
  `modules/trade/service.py`
- **Requirements on a request** (v2.11): up to 12 requirement entries, `stated` for the
  buyer's own words; `normalize_requirements()` sanitises them. **[shipped]**
- **Fit check** (v2.11): `GET /api/requests/{id}/fit` returns counts, per-item state
  (met / needs_confirmation / missing / unverifiable), the sentence "you meet N of M",
  next steps and the disclaimer. **Advisory only** — `eligible_on_paper` never blocks an
  offer. **[shipped]**
- **Watches** (v2.11): create/list/pause/delete saved searches (type + keywords + zone +
  budget floor, ≥1 filter, max 10); newly posted requests notify matching watchers, and
  requirement-level matches notify capable vendors, both inside `create_request`'s commit
  (failures logged, not fatal); capped at 25 notifications per match. **[shipped]**
- Trade events are emitted through the transactional outbox. **[shipped]**

### Standing & the passport (v2.11 — the newest layer)
- **Claim catalogue**: 18 claims across identity, tax, licences, cover, ownership; printed
  `validity_months` vs platform `review_months`; owner-declared `attribute` claims (women/
  youth/PWD ownership); sector licences (PPB, public health, NCA, KEBS, halal, export).
  **[shipped]** `modules/standing/catalog.py`
- **Claim lifecycle**: `declared → documented → verified`, plus `rejected`, `expired`,
  `withdrawn`; a rejected claim keeps its reason verbatim; changing the paper clears
  verification and logs `reopened`; renewal resets the clock. **[shipped]**
  `modules/standing/service.py`
- **Append-only claim history**: every state change writes a `ClaimEvent`. **[shipped]**
- **Verification desk**: a config-gated verifier allowlist (`VERIFIER_HANDLES`, empty =
  desk disabled), queue with age, request-more-evidence, verify, reject-with-reason;
  self-verification is 403. **[config-gated]** `config.py`, `standing/router.py`
- **Expiry clock**: `expire_due` flips lapsed claims, `remind_expiring` queues 30/14/7-day
  reminders idempotently; runs in both scheduler owners (lifespan and `app/worker.py`).
  **[shipped]** `standing/sweep.py`, `app/main.py`, `app/worker.py`
- **Readiness evaluation**: per-checklist counts only — never a score; "you have 2 of 3
  verified" with named gaps. **[shipped]** `evaluate()` / `_sentence()`
- **Public passport**: live verified facts only, with counts, published checklists and a
  disclaimer; no evidence, verifier identity, rejection history or declared rows ever
  appears publicly. **[shipped]** `GET /api/passport/{handle}`
- **Matcher interface**: `verified_keys()` is the only thing the trade matcher reads —
  standing does not leak documents into matching. **[shipped]**
- 10 endpoints under `/api/passport` (`catalog`, `""`, `claims` POST/DELETE,
  `claims/{id}/request-verification`, `readiness/{key}`, `queue`, `claims/{id}/verify`,
  `claims/{id}/reject`, `{handle}`), static paths ordered before `{handle}`.

### Communication and community
- Chat: direct/group/deal/niche/list rooms, voice notes, receive-only WebSocket, private
  voice-note delivery through the authenticated route. **[shipped]** `routes/chat.py`
- Deal rooms, groups and collective sourcing, vendor lists, patrons, reviews, events and
  check-ins. **[shipped]** `routes/groups.py`, `collective.py`, `vendor_lists.py`, `reviews.py`, `events.py`

### Markets, locks and surfaces
- Markets with a boot-seeded catalogue, Daily Flash Locks, the ops desk (roles via
  `MARKET_OPS_ROLES`), the surface feed, map/geo/route planning. **[shipped]**
  `routes/markets.py`, `market_locks.py`, `surface.py`, `map.py`, `geo.py`, `route_planner.py`

### Work, tools and orders
- Squad/temp-work engine: job calls, contracts with start/complete/confirm/rate/cancel,
  squads, a league. **[shipped]** `routes/squad.py`, `models/hustle.py`
- Vendor tools, bookings and couriers with delivery quotes; live order journey and support
  inbox. **[shipped]** `routes/tools.py`, `bookings.py`, `orders/`

### Money and governance
- Custody ledger, payment intents, holds, disbursements and daily reconciliation; chama
  (group savings), murabaha and halal finance flows. **[shipped]** `routes/payments.py`,
  `chamas.py`, `murabaha.py`, `models/payments.py`
- Governance: data-class consent, appeals, benefit allocations, cooperative votes behind
  the `GOVERNANCE_COOPERATIVE_ENABLED` + `GOVERNANCE_LEGAL_BASIS` gate. **[config-gated]**
  `routes/governance.py`, `models/governance.py`

### Platform plumbing
- Transactional outbox: `emit()` inside the caller's transaction, `drain()` with
  `FOR UPDATE SKIP LOCKED` on the worker loop; today the drain marks `processed_at` (the
  designated hook for future consumers — §8). **[shipped]** `platform/event_outbox.py`
- Notifications: created and flushed in the caller's transaction, deduped via `notify_many`,
  delivered pull-only (client polls). **[shipped]** `services/notification_service.py`
- Storage: PDF/image/CSV uploads to S3 or local `UPLOAD_DIR`, unguessable
  `uploads/<uuid>/<name>` keys, private voice notes. **[shipped]** `services/storage.py`
- Ops surface: `/api/metrics` and `/api/ops/status`, JSON 404s, real DB round-trip health
  check, SPA/dist serving. **[shipped]** `routes/ops.py`, `app/main.py`
- POS Bridge: outbound integration with configurable `ALLOWED_POS_SYSTEMS`. **[shipped]**
  `routes/pos_bridge.py`

---

## 3. Frontend capability inventory

- **Routes/screens (26 lazy imports)**: `/` home hub, browse, listing, orders + order detail,
  work, tasks, locks, tools, chat, stock, nearby + place profile, feed, search, map, news,
  markets + detail, network, groups, events, lists, me, analytics, pos, governance, ops,
  `/@:handle` vendor profiles, and the new `/passport`. **[shipped]** `App.jsx`
- **Information architecture**: five primary tabs (Home, Browse, Work, Chat, Business);
  the Business inventory holds `/me`, `/stock`, `/analytics`, `/pos`, `/groups`, `/lists`
  and now `/passport`. **[shipped]** `config/navigation.js`
- **Standing surfaces (v2.11)**:
  - `pages/standing/PassportPage.jsx` — headline editor, expiring-soon renewal panel, claim
    forms grouped by catalogue category, facts list with ask-for-check/replace/withdraw,
    readiness publish gating, and the verifier desk (hidden on 403) with per-item notes.
    **[shipped]**
  - `components/trust/VerifiedFacts.jsx` — one status vocabulary for claim rows plus
    `VerifiedStrip` for a vendor's shop front (vendor profile). **[shipped]**
  - `components/requests/FitChecklist.jsx` — the fit panel on a request card: state icons
    per requirement, the server's sentence, reasons, next steps and the disclaimer;
    short-circuits for unsupported request types. **[shipped]**
  - `components/requests/RequestComposer.jsx` — optional "Ask for documents" fieldset that
    reads the passport catalogue lazily; free-text entries are labelled "your words,
    unchecked". **[shipped]**
  - Integration points: `MePage` destination card, `VendorProfile` verified strip,
    `RequestCard` fit panel, `lib/api.js` (`passportAPI`, `requestsAPI.fit/watches`).
    **[shipped]**
- **Mobile/low-bandwidth posture**: route-split lazy chunks (PassportPage ships as its own
  chunk — 17.89 kB, 5.48 kB gzipped), dark glass design system, mobile tab bar, voice notes.
  Absent: service worker/offline queue (§8).

---

## 4. What was verified working, with the commands

| Check | Command | Result |
|---|---|---|
| Backend suite | `cd backend && .venv/bin/python -m pytest tests/ -q` | **195 passed**, 13 warnings, 98.00 s, exit 0 |
| Backend collection | `.venv/bin/python -m pytest tests/ --collect-only -q` | 195 tests collected |
| v2.11 suite alone | `.venv/bin/python -m pytest tests/test_v211_standing.py -q` | 21 tests (included in the 195 above) |
| Frontend suite | `cd frontend && npx vitest run` | **12 files, 112 tests passed**, exit 0 |
| Production build | `cd frontend && npm run build` | exit 0, 2176 modules, `PassportPage` chunk emitted |
| Lint | `npm run lint` | **cannot run** — `eslint` is not installed in this checkout (§8) |

The suite is the same harness as before v2.11: bundled Postgres 16 via `pgserver`,
`AUTO_CREATE_TABLES=true`, lifespan-aware client, rate-limit reset fixture. The 174 tests
that existed before v2.11 still pass unchanged; the 21 new ones live in
`tests/test_v211_standing.py`.

---

## 5. Integration audit — added to and updated existing code

### 5.1 Modified files (18 tracked files, +788 / −11 lines)

| File | Change | Integration point |
|---|---|---|
| `backend/app/config.py` (+15) | `VERIFIER_HANDLES`, `STANDING_SWEEP_INTERVAL`, `verifier_handles`/`is_verifier()` | Mirrors the existing `MARKET_OPS_ROLES`/`market_ops_role()` pattern — the role lives in config, not in a grant |
| `backend/app/main.py` (+9/−) | imports standing router + sweep; mount at `/api/passport`; loop added to the existing lifespan task tuple/cleanup; `api_root` lists `passport` | Uses the file's existing mount list, lifespan and cleanup paths |
| `backend/app/worker.py` (+6) | `standing_sweep.scheduler_loop` added to the existing `asyncio.gather` | Appended to the existing pos/payments/outbox loop set |
| `backend/app/models/__init__.py` (+4) | re-exports 4 standing models + `RequestWatch` | Keeps `AUTO_CREATE_TABLES`/metadata discovery working for the existing boot path |
| `backend/app/models/notification.py` (+6) | 5 values added to the existing `NotificationType` enum | Extended in place; existing values untouched |
| `backend/app/modules/trade/models.py` (+40) | `BusinessRequest.requirements` JSONB; `RequestWatch` table | Added to the existing trade models, not a new module |
| `backend/app/modules/trade/schemas.py` (+25) | `RequirementIn`, `WatchIn` | Added alongside `RequestIn`/`OfferIn` |
| `backend/app/modules/trade/service.py` (+437) | requirement normalisation, `fit_for`, watch matching + notification ring inside `create_request` | `REQUEST_FLOW`/`OFFER_FLOW`, `_require_transition` and the existing audit trail are untouched; new code calls them |
| `backend/app/modules/trade/router.py` (+72) | watch CRUD + `/{request_id}/fit`, ordered before `/{request_id}` | Extended the existing 6-endpoint router; static paths first (§7 invariant preserved) |
| `frontend/src/App.jsx` (+2) | lazy `PassportPage` + `/passport` route before `/@:handle` | Same lazy-route pattern as the other 25 pages |
| `frontend/src/config/navigation.js` (±2) | `/passport` added to the Business inventory (`ME_ROOTS`) | No new sidebar section invented; the IA test documents it |
| `frontend/src/lib/api.js` (+47) | `requestsAPI.fit/watches/...` + new `passportAPI` (section 27) | Extended the existing client module |
| `frontend/src/components/requests/RequestComposer.jsx` (+101) | optional requirements fieldset | Same form, same submit path, `requirements` added to the existing payload |
| `frontend/src/components/requests/RequestCard.jsx` (+4) | renders `FitChecklist` for non-owned, open, requirement-bearing requests | Existing card component |
| `frontend/src/pages/me/MePage.jsx` (+8) | passport destination card | Existing destination-card pattern |
| `frontend/src/pages/vendor/VendorProfile.jsx` (+14) | `VerifiedStrip` under `TrustRow` | Existing profile page |
| `frontend/src/test/actionNetwork.test.jsx` (+5) | `passportAPI` added to the partial mock | Same test file, same mock factory |
| `frontend/src/test/navigation.test.jsx` (±2) | `/passport` asserted in the Business inventory | The file's own documented assertion |

### 5.2 New files (12) and where each hooks in

| Path | Role | Hooks into |
|---|---|---|
| `backend/app/modules/standing/{__init__,catalog,models,service,router,sweep}.py` (1,770 lines) | the standing/passport module | Third module in `app/modules/` (after `trade`, `orders`); imports `get_current_vendor` from `routes/auth.py`, `get_db`, `storage`, `create_notification`/`notify_many`, `event_outbox.emit` — i.e. the platform's existing services |
| `backend/alembic/versions/0015_business_standing.py` | additive migration: 4 tables (`business_claims`, `claim_events`, `standing_profiles`, `request_watches`), 1 column (`business_requests.requirements`), 5 enum values | `down_revision = "0014_live_order_journey"` — appended to the existing linear chain; `_enum(checkfirst=True)` keeps auto-create DBs working; downgrade drops only the new objects |
| `backend/tests/test_v211_standing.py` (21 tests) | coverage for the new layer | Same `conftest.py` harness, same naming convention as `test_v29_*`, `test_v210_*` |
| `frontend/src/pages/standing/PassportPage.jsx` | owner + verifier screens | Lazy route, existing UI kit (`Badge`, `Button`, `Input`, `Skeleton*`, `Card`) |
| `frontend/src/components/trust/VerifiedFacts.jsx` | fact display + shop-front strip | Placed beside the existing `TrustSignals.jsx` in `components/trust/` |
| `frontend/src/components/requests/FitChecklist.jsx` | requirement fit panel | Beside `RequestCard`/`RequestComposer` in `components/requests/` |
| `docs/briefs/kenya-opportunity-network-strategy.md` | the strategy deliverable | `docs/briefs/` house style |

### 5.3 Reuse checks — no parallel implementations

| Check | Result |
|---|---|
| Duplicate models | one `BusinessClaim`, one `ClaimEvent`, one `StandingProfile`, one `RequestWatch` — `grep` finds exactly one definition each |
| Duplicate catalogue | one `CLAIMS` definition (`modules/standing/catalog.py`) |
| Duplicate routes | single `/api/passport` mount in `main.py` (34 `include_router` calls total); single `/passport` route in `App.jsx`; single `passportAPI` export in `lib/api.js` |
| Auth | standing reuses `get_current_vendor` from `routes/auth.py`; no second auth path |
| Notifications | standing/trade reuse `notification_service.create_notification`/`notify_many`; no second notification channel |
| Events | standing reuses `platform/event_outbox.emit`; no second outbox |
| Storage | standing reuses `services/storage.upload`; no second uploader |
| Tests | reused the existing `conftest.py` harness; the 174 pre-v2.11 tests were not rewritten |

### 5.4 Deliberately untouched

POS Bridge, stock/quality flows, payments/custody, chat internals, governance, markets/locks,
squad and the map stack were **not modified** by the v2.11 work. The only edits outside the
new module are the wiring points in §5.1 — the pattern the repo's own migration briefs
(`modular-architecture.md`) ask for: one authoritative writer per domain, extended in place.

---

## 6. Where the capability sits against the strategy brief

| Strategy-brief capability | State in this repo |
|---|---|
| Small-business readiness / document vault | **shipped** (`modules/standing`) |
| Verified facts separated from estimates and suggestions | **shipped** (claim states + passport + UI labels) |
| Explainable matching ("you meet 8 of 10") | **shipped** (`fit_for`, `evaluate`, discovery `reasons`) |
| Human approval before consequential actions | **shipped for verification** (verifier allowlist, mandatory rejection reason); **not yet built** for introductions/messages |
| Consent-based introductions with attribution | **not built** (connections/patrons exist; no introduction workflow) |
| Consortium / bid-team builder | **not built** |
| Market-entry intelligence | **not built** (outbox is the hook) |
| Business growth coach | **not built** |
| Post-contract visibility | **partial** (order journey + custody ledger; no supplier acknowledgement loop) |
| Integration layer around mandatory systems | **partial** (POS Bridge only; no eTIMS/KRA/BRS/e-GP adapters) |

---

## 7. How to reproduce every claim in this report

```bash
# backend — 195 tests
cd backend && .venv/bin/python -m pytest tests/ -q

# the new layer alone — 21 tests
cd backend && .venv/bin/python -m pytest tests/test_v211_standing.py -q

# frontend tests — 12 files, 112 tests
cd frontend && npx vitest run

# production build
cd frontend && npm run build

# the integration audit
git diff --stat                 # 18 modified files
git status --porcelain | grep '^??'   # 7 new paths
grep -rn '^class \(BusinessClaim\|RequestWatch\)' backend/app   # single definitions
```

---

## 8. Known limitations — what this report does **not** claim

Capability gaps, kept honest because the product's position depends on it:

1. **No frontend test file for the v2.11 surfaces.** `PassportPage`, `VerifiedFacts` and
   `FitChecklist` are covered by the production build and the existing suites only; a
   `test/v211.test.jsx` in the repo's per-version convention is the obvious next step.
2. **Notifications are pull-only.** `notificationStore` polls on an interval; no email, SMS
   or push. That undercuts the expiry-save feature in the field, where suppliers do not sit
   in the app.
3. **The outbox has no consumers yet.** `drain()` marks `processed_at`; market-entry
   intelligence and integrations are a hook, not a feature.
4. **Verifier desk is config-gated.** Appointing a verifier means editing `VERIFIER_HANDLES`
   and restarting; there is no in-app admin screen, and no SLA metrics surfaced yet.
5. **`npm run lint` cannot run** — `eslint` is not installed in this checkout, so lint is
   not part of the verified state.
6. **Evidence access control is "unguessable URL".** No signed or expiring URLs, no
   per-download audit.
7. **Fit is advisory.** `eligible_on_paper` never blocks an offer — deliberate, but it means
   the platform cannot yet enforce a must-have requirement.
8. **Missing product surfaces** (from the strategy brief): team/multi-seat accounts,
   introductions, consortium builder, admin/support inbox, buyer-side shortlists, billing/
   subscriptions, and any outbound integration beyond POS Bridge.
9. **Version string is stale.** `settings.VERSION` reads `"2.2.0"` while the product line is
   v2.11; it appears in `/api` and `/api/health`.
10. **Nothing here implies compliance or reliability.** No reliability score exists, no
    profile claims regulatory standing, and the public passport exposes verified facts plus
    a disclaimer only. That is the intended state, not a gap.

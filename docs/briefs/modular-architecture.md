# Modular architecture — the real codebase, the target shape, and the migration

Written against the actual repository (inventory run 2026-10-09, `main` + v2.9),
not against guesses. This is the answer to "tailor the refactor to what Ogallo
runs on" — and the migration plan for getting to the proposed module structure
without breaking a single screen.

---

## Locked decisions — where each one lives in code now

From the critique's decision table (v2.10). Postponed until scale demands
them: microservices, a dedicated event broker, distributed infrastructure,
a separate analytics warehouse.

| Decision | Status | Where it lives |
|---|---|---|
| Modular monolith first | **in force** | `app/modules/` + module law (§2); Wave 0 pilot shipped; ruff import discipline next |
| PostgreSQL | **always was** | the entire stack; pgserver-backed tests run the real dialect |
| Business tenancy: explicit memberships, scoped permissions | Wave 2 | today: caller-is-the-business (`get_current_vendor`); token mechanics already extracted to `platform/security.py` |
| Inventory = movements, balances, reservations | Wave 3 | tables exist (`stock_items/movements/reservations`); they move under `modules/inventory` with one writer |
| Trade lifecycle: explicit state machine + auditable history | **shipped v2.10** | `trade/service.py`: `REQUEST_FLOW`/`OFFER_FLOW` maps, `_require_transition` (409 on anything unmapped); `request_events` append-only audit, requester-visible via `events` in the detail payload |
| Integrations: transactional outbox + background workers | **shipped v2.10** | `platform/event_outbox.py`: `emit()` in the same transaction, `drain()` (FOR UPDATE SKIP LOCKED) on the scheduler loop (`main.py` lifespan + `app/worker.py`); `trade` emits posted/offer_received/fulfilled/cancelled |
| Vendor Tools → resources + bookings + fulfilment domains | Wave 4 | mapped in §2; `/api/tools` URLs frozen, code splits |
| Analytics: read models from canonical records | Wave 5 | outbox table is the substrate; read models rebuild from it |
| Trust: reproducible metrics from qualifying recorded events | Wave 5 | events carry no prices/notes (negotiation privacy preserved); completion facts (`request_fulfilled`, rival-declines) are the seed |
| Migration: incremental, tested, reversible | **in force** | §3 wave table; revert = git revert (no data migrations except additive 0013) |

---

## 0. What Ogallo actually runs on (known facts, read from the repo)

The stack questions don't need answers from memory — the repo *is* the answer:

| Question | Fact from the code |
|---|---|
| Frontend | **React 18 + Vite SPA** (not Next.js). `react-router-dom`, TailwindCSS design system (`glass`, ink/brand tokens), 12 zustand stores, axios client (`src/lib/api.js`, 25 API sections, 445 lines), vitest + Testing Library (108 tests). Mobile-first. |
| Backend | **Python 3.11 / FastAPI**, SQLAlchemy 2 **async** (asyncpg), Pydantic v2. 32 routers, **~280 endpoints**, 24 model files, **~75 tables**, 30 service files (8,696 LOC). |
| Database | **PostgreSQL** + Alembic (12 migrations) + raw-SQL guardrails (`db_triggers.py` append-only custody ledger, `map_indexes.py`). Dev can `AUTO_CREATE_TABLES` instead. |
| Auth | JWT HS256 (24 h access / 30 d refresh), OAuth2 bearer, login guard (5 attempts → 15 min lockout), `VendorOnlyMiddleware`. **`get_current_vendor` lives inside `routes/auth.py`** — every module imports it from a router file. |
| Background jobs | **In-process asyncio loops**: POS sync (300 s), payment worker (60 s: expire intents, flag chama/murabaha defaults, daily reconciliation), open-data refresh. Same image, `RUN_SCHEDULER=false` turns the web container into web-only; `python -m app.worker` runs one pass. No Celery/arq. Redis is used for the rate-limiter backend. |
| Deployment | `Dockerfile` + `docker-compose.prod.yml`, **single container**: FastAPI serves the built SPA (catch-all → `index.html`). No CI workflows, no IaC files in the repo. |
| Stage | Early/MVP: boot-time table creation default on, market catalog seeded at boot, `VERSION` string stale ("2.2.0" while the product is at v2.9). |

**Assumptions** (not verifiable from the repo — confirm before they matter):
actual hosting (compose file suggests a single VPS); whether any data exists in
production yet; whether POS integrations are live or declared-only; Redis
persistence expectations.

---

## 1. Inventory — what exists, and where the boundaries already hurt

### 1.1 Routers (32 files → 280 endpoints)

Biggest: governance 26, market_locks 21, chamas 20, vendors 18, squad 16,
stock 14, chat 13, payments 12, tools 11, events 11. Smallest: verification 1,
onboarding 1, news 1, nearby 1.

### 1.2 The URL prefixes hide module boundaries (audit finding #1)

Three prefixes are each served by **multiple unrelated routers**:

| URL prefix | Routers behind it | Problem |
|---|---|---|
| `/api/tools` | `tools.py` (listings) + `bookings.py` (calendars) + `route_planner.py` (courier routing) | Resources, fulfilment-scheduling and courier logistics are three domains sharing one door |
| `/api/stock` | `stock.py` (stock) + `verification.py` (patron verification) | Verification is a trust flow, not stock CRUD |
| `/api/vendor-lists` | `vendor_lists.py` (lists) + `reviews.py` (reputation) | Reviews are reputation events, not list rows |

The **URLs are fine** — the frontend depends on them and they read well. It is
the *code* behind them that needs to belong to modules. The migration keeps
every URL byte-for-byte; contract tests will pin them.

### 1.3 Entity duplicates and mis-homes (audit finding #2)

- **"Orders" don't exist as a table.** The order lifecycle *is* `stock_movements`
  (+ `price_negotiations`, `stock_reservations`). Trade state is smeared across
  `stock.py`, `collective.py` and now `business_requests`/`request_offers`.
- **Three scoring surfaces**: `vendor_performance` (performance.py),
  `biashara_score_events` (governance.py), `hustle_gold_ledger` (hustle.py).
  Reputation is computed in three places from three ledgers.
- **Places**: `public_places` vs the market catalog (`geo_data` seeds East-African
  markets at boot) vs `events` vs `popup_shops` — four "somewhere" tables.
- **Identity is split**: `vendors` + `vendor_profiles` (vendor.py), `patrons`
  (defined in *vendor_list.py* of all places), `market_members`
  (market_locks.py), plus group/squad/chama membership tables.
- **Resources vs fulfilment tangle**: `tools.py` owns six listing families
  (`tool_listings`, `warehouse_rentals`, `transport_services`, `popup_shops`,
  `hotel_sourcing`, `courier_registrations`) **and** `courier_shipments` —
  a fulfilment object living in the resources file.

### 1.4 Where rules actually live today

`app/services/` is a mixed bag: genuine domain engines (`stock_engine` 469,
`lock_settlement` 450, `chamas` 959, `payments` 450, `hustle` 343,
`booking_service` 331, `discovery` 328) sit beside pure infrastructure
(`psp_client`, `storage`, `tile_providers`, `login_guard`, `notification_service`)
and cross-domain glue (`parasitism_engine`, `market_patrons`, `biashara`).
"Shared infrastructure must not become a place for miscellaneous business
logic" — today `services/` is exactly that grab-bag.

---

## 2. Target structure (tailored, not transcribed)

The proposed tree is a good *logical* map; here is how it lands on this
codebase without fiction:

```
Brief/
├── backend/                      # = apps/api  (FastAPI, one deployable)
│   └── app/
│       ├── main.py               # composition root: wires routers, middleware, lifespans
│       ├── modules/              # THE DOMAINS — each: models.py, schemas.py, service.py, router.py
│       │   ├── identity/         #   auth, vendors, vendor_profiles, patrons, login_guard
│       │   ├── businesses/       #   onboarding, business profile & tenancy
│       │   ├── catalogue/        #   stock_items catalog, taxonomy, market catalog
│       │   ├── inventory/        #   quantities, reservations, POS bridge + sync
│       │   ├── trade/            #   ✅ PILOT LANDED: requests+offers; then sourcing,
│       │   │                     #      movements, negotiations, collective buying
│       │   ├── fulfilment/       #   courier_shipments, route_plans, bookings & calendars
│       │   ├── resources/        #   tool_listings, warehouse_rentals, transport_services,
│       │   │                     #   popup_shops, hotel_sourcing, courier_registrations
│       │   ├── suppliers/        #   vendor_network, discovery of suppliers
│       │   ├── market_locks/     #   zones, members, windows, picks, quotes, settlement
│       │   ├── collaboration/    #   groups, vendor_lists, reviews*, squads/hustle, events
│       │   ├── messaging/        #   chat, notifications
│       │   ├── network/          #   map, geo/open-data, markets, news, surface, nearby
│       │   ├── analytics/        #   trade analytics + vendor_performance
│       │   ├── finance/          #   ⚠ not in the proposal, but ~2,300 LOC exist:
│       │   │                     #   payments, custody ledger, disbursements,
│       │   │                     #   reconciliation, chamas, murabaha/halal
│       │   └── governance/       #   ⚠ same: 26 endpoints — rules, votes, benefits,
│       │                         #   credit ledger, appeals, consents
│       ├── platform/             # = the proposal's platform/ (extracted incrementally)
│       │   ├── database.py       #   (today app/database.py) + db_triggers + indexes
│       │   ├── security.py       #   JWT mint/verify + get_current_vendor (from routes/auth)
│       │   ├── jobs.py           #   the asyncio loops + app/worker.py, one registry
│       │   ├── storage.py        #   (today app/services/storage.py)
│       │   ├── observability/    #   metrics middleware, health, structured logs
│       │   ├── rate_limit.py     #   (today middleware/rate_limiter.py)
│       │   └── event_outbox.py   #   Wave 5: cross-module facts → recorded events
│       └── middleware/           #   thin remaining shells that delegate to platform/
├── frontend/                     # = apps/web (React SPA — stays; api.js is the adapter)
└── tests/                        # backend tests reorganized:
    ├── integration/              #   the existing pytest suites (per-module files)
    ├── contracts/                #   NEW: OpenAPI-pinned URL/verb/response-shape tests
    └── e2e/                      #   frontend flows (vitest today; playwright later)
```

Deliberate deviations from the proposal, and why:

1. **`backend/` + `frontend/` keep their names instead of `apps/web|api`.**
   They already *are* the apps layer; a rename is churn with zero boundary
   gain. The proposal itself says "logical structure, not one deployable per
   folder."
2. **`finance/` and `governance/` are added** — the proposal omits them, but
   they are ~2,300 LOC and 46 endpoints of real product. Leaving them
   homeless would recreate the grab-bag.
3. **`reviews` go to a reputation home** inside collaboration for now, with
   the three scoring surfaces converging in Wave 5 (below).
4. **No microservices.** One FastAPI app, modules enforced by import
   discipline (a module imports another's `service.py`, never its `models.py`
   internals or `router.py`), plus a contract test suite that fails if a
   module reaches around the interface.

Module rules (enforced by convention now, ruff import-linter later):

- `modules/X` may import: `platform/*`, `modules/X/*`, and `modules/Y.service`
  (public functions only).
- `modules/X` may **not** import: `modules/Y.models`, `modules/Y.router`,
  `app/routes/*` legacy paths.
- `services/` shrinks to infrastructure only; domain engines move into their
  modules as `service.py`.
- Every module ships its own pytest file; integration DB tests stay the
  source of truth (166 passing today).

---

## 3. Migration — incremental, one authoritative writer per domain

The standing rule from the critique, restated as we'll enforce it: **during
and after migration, each table has exactly one module that writes it.**
Read-only cross-module reads go through the owner's service. No parallel
writers, ever.

| Wave | Their step | What we do | Authoritative writer becomes | Done when |
|---|---|---|---|---|
| **0** ✅ | 1–2 (inventory, boundaries) | This document; **pilot extraction of `trade`** (v2.10 also shipped: flow maps, `request_events` audit, `platform/event_outbox`, `platform/security`) (`business_requests` + offers) into `modules/trade/{models,schemas,service,router}.py` — service owns the rules and raises `RequestFlowError(status)`, router is a translator; URLs and behavior unchanged, 166 tests green | `trade.service` for requests/offers | ✅ this commit |
| **1** | 2 | Extract `platform/`: `security.py` (JWT + `get_current_vendor` out of `routes/auth.py`), `jobs.py` (the three loops + worker under one registry), `storage.py`, `observability/`; add `tests/contracts/` with an OpenAPI pin so the URL contract can't drift while code moves | platform owns tokens, time, storage | contract tests green on unchanged URLs |
| **2** | 2 | `modules/identity` (auth, vendors, vendor_profiles, patrons out of vendor_list.py, login_guard) + `modules/businesses` (onboarding). Frontend untouched | identity owns vendors/patrons writes | auth + vendor tests pass from new home |
| **3** | 3 | `modules/catalogue` + `modules/inventory` (stock quantities, reservations, POS bridge/sync) + trade foundations: sourcing, `stock_movements`, negotiations, collective → `trade.service`. Transaction boundary: one command = one service call = one transaction | inventory owns quantities; trade owns movement/request state machines | stock + collective + requests suites green; movements written only by trade |
| **4** | 4 | `modules/resources` (the six listing families) + `modules/fulfilment` (shipments, route plans, bookings/calendars). The `/api/tools` triple-prefix stays as URLs; three routers behind it come from two modules | resources owns listings; fulfilment owns shipments/bookings | booking + routing tests green; shipments no longer in tools.py |
| **5** | 5 | `modules/market_locks` re-reads catalogue/trade/inventory **via services** (no raw joins into other modules' tables); `platform/event_outbox` lands: request-fulfilled, movement-confirmed, lock-settled become recorded events; reputation (biashara + vendor_performance + gold) rebuilt as *read models over events* | locks reference authoritative records; events are the cross-module feed | settlement tests green; one scoring read model |
| **6** | 6 | Retire duplication: `app/routes/*` and `app/services/*` shells deleted once nothing imports them; frontend `api.js` comments reorganized to mirror modules; `VERSION` bumped to reality | each domain has one home and one writer | repo grep: no `app/routes` imports outside main.py; suites green |

Each wave is one reviewable PR: move code, keep URLs, run full backend suite +
frontend suite + contract pins, then delete the old shells. If a wave stalls,
the app is still shippable at every commit — that is the point of the
strangler order.

**Rollback stance:** because every wave is import-level refactoring with
identical URLs and response shapes, rollback = revert the commit. No data
migrations are required by any wave except Wave 5's outbox table (additive).

---

## 4. What this costs the frontend

Nothing, by design. `src/lib/api.js` is already the adapter layer: 25 named
clients over stable URLs. The SPA never imports backend code, so module
extraction is invisible to it. Only Wave 6 touches it, and only to re-group
the api.js sections in module order.

---

## 5. Known facts vs assumptions (decision ledger)

**Facts** (verified in repo this week): FastAPI/SQLAlchemy-async/Postgres
stack; ~280 endpoints; 75 tables; 32 routers; in-process asyncio schedulers;
single-container compose deploy; JWT in routes/auth.py; three shared URL
prefixes; no orders table (movements play that role); three scoring ledgers;
finance+governance omitted from the proposed module list but present in code.

**Assumptions** (flag before relying): single-VPS hosting; no meaningful
production data yet (Wave 6's "reconcile data" step is cheap *only* if this
holds — if there IS production data, Wave 3 and 5 need dual-write-free
backfills planned per table); POS integrations not yet live; Redis is
disposable (rate-limit state only).

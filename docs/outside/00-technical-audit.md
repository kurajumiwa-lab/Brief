# Outside — Phase 1 technical audit of the existing application

Baseline commit `b247e53` (`main`), branch `arena/064f3268-brief`.
Every statement below was read out of the repository or produced by a command
run against it in this session.

## 1. What the application actually is

Not a generic social network and not a marketplace mockup: a working, tested
vendor-to-vendor trade platform.

| layer | what is there |
|---|---|
| backend | FastAPI 0.104, SQLAlchemy 2 async + asyncpg, PostgreSQL 16, Alembic (20 revisions, head `0020_reorder_key`), JWT + bcrypt, Redis rate limiter with in-process fallback, local/S3 storage. 189 Python files. |
| frontend | React 18, Vite 5, Tailwind 3, zustand, axios, lucide-react, framer-motion, Leaflet. 199 JS/JSX files. |
| routes | 31 route modules in `backend/app/routes`, 6 feature modules in `backend/app/modules`, 33 services. |
| nav | 5 primary tabs (`frontend/src/config/navigation.js`): Home · Browse · Work · Inbox · Business. |
| design | A real token system already exists: `frontend/src/styles/tokens.css` → `tailwind.config.js` resolves every colour through `rgb(var(--token))`, with a true `.dark` peer theme. |

## 2. Baseline build & test status (measured, not assumed)

```
backend   ./.venv/bin/python -m pytest -q     → 229 passed, 0 failed   (1:47)
frontend  npx vitest run                      → 172 passed, 1 failed   (82s)
```

The single frontend failure is **pre-existing** and unrelated to this work:
`src/test/enterprise.test.jsx:83` asserts `screen.getByText("Achieng Field Services")`,
which the rendered enterprise register does not contain. It fails on a clean
checkout and is carried forward as a known baseline, not caused by Outside.

Neither dependency set was installed on arrival (`frontend/node_modules`
absent, `fastapi` not importable). Both were installed from the repo's own
`package.json` / `requirements.txt` + `requirements-dev.txt`; the backend suite
uses the bundled `pgserver` PostgreSQL 16, so no external database is needed.

## 3. What already exists and must be preserved

These are the reusable assets the brief tells us not to rebuild:

* **Location infrastructure is already sound.** `GET /api/nearby` (haversine,
  radius clamp 0.5–50 km, member + open-data sources, group counts),
  `GET /api/geo/*` (Nominatim geocode, zones, OSM ingest, public-place
  directory), `GET /api/map/viewport` (grid clusters when zoomed out, capped
  pins when zoomed in — a deliberate fix for a real mobile hang). Vendors carry
  `geo_lat`, `geo_lng`, `physical_location`, `market_zone_id`.
* **The shelf concept is already data-driven.** `frontend/src/config/homeShelves.js`
  (447 lines) is a registry: `key / title / subtitle / seeAll / card / group /
  limit / load()`, with per-shelf loading and failure isolation in
  `stores/homeFeedStore.js` (`idle → loading → ready | error`, 5-minute staleness,
  concurrent-call collapsing) and 9 card renderers resolved by name in
  `components/home/cards/index.jsx`. This is exactly the "shelves as browsing
  surfaces" architecture asked for — it needs extending, not replacing.
* **A polymorphic feed already exists** in `backend/app/routes/surface.py`
  (`GET /api/surface/feed`): a mixed feed of product / call-up / movement /
  event / market / place / vendor / index, round-robin by freshness. It has
  **no location term and no ranking** — by design at the time.
* **Events** are a first-class table (`app/models/events.py`): organiser,
  patron/group/list scoping, `start_date`/`end_date`, `location` + `geo_lat`/
  `geo_lng`, `is_virtual`, `max_vendors`, `registered_count`, `entry_fee`,
  `status` (`upcoming|active|completed|cancelled`), registrations with
  `registered|confirmed|attended|no_show` and check-in.
* **Communities** = `vendor_groups` (typed open/niche/regional/trade/sourcing/event,
  approval, roles, auto-created chat room). **Collections** = `vendor_lists`
  (patron or group created, registration, approval, capacity, entry criteria,
  denormalised review aggregates). **Opportunities** = `business_requests`
  (6 request types, urgency enum, **`budget_kes` already nullable** —
  "open to quotes" is a documented answer) and `hustle_job_calls`.
* **Chat, notifications, files, moderation-adjacent controls** all exist
  (`/api/chat`, `/api/notifications` with a 40-case `NotificationType` enum,
  `/api/files`, `VendorOnlyMiddleware`, `RateLimitMiddleware`,
  `fraud_suspended_at` on the vendor).

## 4. The four gaps the brief names, verified in code

### 4.1 There is no social content primitive at all

`grep` for a post/update table returns nothing. The nearest surfaces are
`surface.py` (a read-only union of other people's trade rows), `news.py`
(derived report lines from rows written in a window) and `NoticeBoard.jsx`,
which has **no backend** (`grep -rn noticeboard backend/` → 0 hits). So
"a house party, a hiking trip, a community cleanup, a request for company"
currently has nowhere to live.

### 4.2 Navigation is organised around trade, not discovery

`frontend/src/config/navigation.js` `PRIMARY_NAV` is
`Home · Browse · Work · Inbox · Business`, and `HomeFeed.jsx` documents its own
hierarchy in a comment: *"trade first, your business second, the rest of the
network after that."* There is no Explore destination, no Create destination and
no Activity destination. Creation is scattered across at least six separate
module forms (stock, events, tools, groups, lists, requests).

### 4.3 Onboarding is a forced, shop-first modal

`components/layout/Shell.jsx` renders `<OnboardingFlow />` unconditionally on
every screen. `OnboardingFlow.jsx` fetches `GET /api/onboarding` on mount and
opens itself whenever `completion < 1` and a `localStorage` dismiss key is
absent. Its two steps are *your shop page* and *walk your market* — i.e. the
user is made to complete a business profile before the product is usable. That
is the "shelf-specific onboarding" the brief tells us to eliminate.

### 4.4 Trade value is surfaced as identity

`grep -rniE "trade_value|trade value"` finds 25 hits. Two are user-facing
identity claims:

* `frontend/src/pages/analytics/Analytics.jsx:90` — a hero `<Stat label="Trade value">`.
* `frontend/src/pages/vendor/VendorProfile.jsx:617` — `label="Trade value"` on
  a **public** profile, i.e. a person's worth rendered as a KSh figure.

`frontend/src/test/v22.test.jsx:260` asserts the analytics label exists, so the
old assumption is pinned by a test. Related scoring (`network_score`,
`parasitism_index`, 76 references to `parasitism`) is a *relationship* score,
not a price — it stays.

Also worth noting: **price is already optional everywhere it matters** —
`StockItem.unit_price`/`wholesale_price`, `Event.entry_fee` (default 0),
`BusinessRequest.budget_kes` are all nullable. The barrier is presentation and
IA, not the schema.

## 5. Migration risk assessment

* **Low risk.** All four new tables are additive; no existing column is
  altered, dropped or renamed. `AUTO_CREATE_TABLES=true` is already used by the
  test suite, and `entrypoint.sh` runs `alembic upgrade head` before uvicorn.
* **Historical data preserved by construction.** `vendors.total_trade_value`
  equivalents (`vendor_performance.total_trade_value`, the analytics
  aggregations) keep returning the same numbers; only their UI prominence
  changes. No backfill is required and none is performed.
* **URL compatibility.** `App.jsx` already carries a "v2 URLs that moved"
  block and `StockRoomRouter` redirects `?tab=network`/`?tab=movements`. The
  same pattern is reused: `/browse`, `/work`, `/feed`, `/brief`, `/profile`,
  `/movements`, `/stock/:id` all keep resolving.
* **The one deliberate break** is the removed "Trade value" UI, which changes
  one assertion in `src/test/v22.test.jsx`. Recorded in
  [`03-deprecations.md`](03-deprecations.md).

## 6. What is therefore in scope for the first increments

1. A unified content model + one creation endpoint (`/api/outside/content`).
2. A location-aware ranked feed and unified search (`/api/outside/feed`,
   `/api/outside/search`) reading existing tables — no parallel database.
3. Navigation to Home · Explore · Create · Activity · Profile, with every old
   route still resolving.
4. Design-token refresh for Outside on the existing token architecture.
5. Removal of the forced shop-first onboarding and of trade-value UI.
6. Server-side configurable shelf manifest (`/api/outside/shelves`) so shelf
   names stop being hardcoded into the app.

Out of scope for these increments and explicitly deferred: payments/ticketing
for events, group messaging (existing `/api/chat` is the integration boundary),
and any rewrite of the trade loop, market locks, enterprise or POS modules.

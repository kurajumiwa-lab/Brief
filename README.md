# My Shop App — the trade information network

**The information layer around the shop.** Home is a shelf — News, Suppliers, Stock, Rentals, Groups, Events — and the vendor workspace (Brief: stock, deals, chat, analytics, POS) lives inside as a feature. *You source today, you sell tomorrow.*

Brief_ is a vendor-centric community commerce platform: distribution-and-economic
infrastructure for people who already trade with each other — market women,
kiosk owners, wholesalers, couriers, hotel suppliers. Every account is a
business. There is no shopper side, no cart, no "buy now". There is stock, and
there are the vendors who move it between each other.

## What is in the box

| module | what it does |
|---|---|
| **Vendor identity** | `@handle`, business categories, a *fluid role* — sourcing / selling / both / dormant — switched with one click. `network_score` and `parasitism_index` are earned, not entered. |
| **Stock Room** | Stock, not listings: `quantity_in_stock`, `quantity_reserved`, `quantity_available`. Manual entry, CSV bulk import, or POS sync. Browse *network stock* (never your own), **compare alternatives** (same category, cheapest first, with vendor reliability) and `POST /source` it. |
| **Quality & provenance** | Every item carries a `quality_status`: `unverified → self_declared → patron_verified → lab_certified`. Vendors declare batch / origin / expiry and attach a spec sheet; a patron of a list the vendor is on can vouch for it. |
| **Movements** | Every sourcing request is a movement: `pending → confirmed → shipped → received` (or cancelled). Reservation on request (holds expire after `RESERVATION_HOLD_HOURS`), shelves debited/credited on receipt, connection created, scores recomputed. |
| **Deals** | A deal room per stock item. Proposals are structured — quantity, price per unit, delivery and payment terms — and the other side **accepts** (stock reserved, movement confirmed), **counters** (new round) or **declines**. |
| **Parasitism engine** | Live score per vendor: fulfilment rate 40 % · reciprocity 30 % · network contribution 20 % · reliability 10 %, recomputed on every movement and nightly. Pair scores still feed the dashboard's "strongest links" and the `/graph`. |
| **Patrons & Vendor Lists** | Any vendor can become a patron (starter → established → mogul → legend, promoted automatically by vendors sponsored, events run and reputation) and run curated lists with registration, approval, capacity and entry criteria. Groups can create lists without a patron. |
| **Vendor Groups & collective sourcing** | niche / regional / trade / sourcing / event / open groups with roles, approval and an auto-created chat room. Members pool an order: open a collective request, pledge units, the organiser moves it `gathering → quota_met → negotiating → ordered → fulfilled`. |
| **Daily Flash Locks** | Named market zones, a once-per-30-days vendor zone selection, canonical products, spotter-entered supplier MOQs and daily 15:00–20:00 EAT pick windows. SQL sums demand by product + zone; `ceil(MOQ × 0.85)` qualifies a cluster to bid. Unmet clusters roll once, then dissolve. Negotiators record supplier quotes at the exact pooled volume; a human negotiator compares them and selects the supplier. |
| **Chat** | group, vendor-list, deal, direct and open niche-topic rooms. Messages go over HTTP; a receive-only WebSocket broadcasts them (Redis fan-out across workers). Share stock or send a previewable voice note (up to 15 seconds) straight into a room; voice audio is fetched only on tap and served through room-authorized endpoints. |
| **Vendor Tools & couriers** | warehouse, cold storage, transport, courier, pop-up shop, hotel sourcing, equipment, packaging. Courier registration, warehouse booking, and **shipments**: book a courier for a movement, tracking number, forward-only status history, receiver rating. |
| **Events** | market days, sourcing trips, trade fairs — capacity, fee, requirements, optionally scoped to a list or group. Vendors **check in** on the day (or the organiser does it at the door); organisers get fill rate, attendance and category analytics. |
| **Notifications** | Every consequential action (sourcing steps, deals, list/group decisions, collective progress, shipments, reviews, bookings, routes, low stock, verification, promotions) lands in the bell — `GET /notifications`, polled every 30 s by the UI. |
| **POS Bridge** | Square / Shopify pulled on a schedule; CSV / manual / custom API pushed from the shop by `pos-extension/sync_daemon.py` (idempotent, back-off, health file) or a CSV upload. Every sync is logged. |
| **Trade analytics dashboard** | `/analytics` — what you supplied and sourced over 30/90/180/365 days, stacked trend, top counterparties, category mix, **price position** against the network average per category, your share of the network and your parasitism index/live score, plus a per-counterparty drill-down (net position, history, top items). `GET /analytics/*`. |
| **Vendor-list reviews** | Approved members rate a list 1–5 with a title and body; the drawer shows the star distribution, sorts by recent / rating / helpful, and lets each vendor edit or delete their one review. Aggregates (`avg_rating`, `review_count`) are denormalised onto the list for browse and sort, and the patron is notified on every new review. |
| **Discovery / recommendation** | `GET /vendors/discover` ranks vendors you have not connected to yet on six weighted factors — complementarity, reciprocity, trade evidence, proximity, graph distance and reputation — with the weights exposed at `/discover/weights` and a human-readable `reasons` list per candidate (the Network → Suggested tab). |
| **Courier route optimisation** | A courier plans a run from explicit stops or straight from their undelivered shipments; nearest-neighbour + 2-opt ordering, per-leg distance, cumulative km and ETA, and an honest `saved_km` against the booking order. Dispatch notifies the senders whose parcels are on the run; stops are ticked off one by one. |
| **Bookings & calendars** | One dated-hold model for the three tool flows: **warehouse / cold-storage space**, **pop-up shop pitches** (shared spaces) and **hotel sourcing rooms** for travelling vendors. Live day-by-day availability calendar, request → confirm/decline → complete, and cancellation that frees the window. |
| **Marketplace map** | A viewport-driven Leaflet map over the open-data directory: `GET /api/map/viewport?bbox=…&zoom=…` returns **grid clusters** when zoomed out ("7.6K places" → "1,240") and a **capped list of pins** when zoomed in — never the 7,640-row directory. Counters double as filters (one dataset at a time), details load on tap, pins are drawn on one canvas, and tiles are configurable so the public OSM server is never a production dependency. `backend/app/services/map_viewport.py`, `frontend/src/pages/map/MapPage.jsx` |
| **Monitoring & ops** | In-process metrics registry (`/metrics`, Prometheus text) with per-route percentiles and a slow-request list, `X-Request-ID` on every response, and an **Ops** console (`/ops`) showing version, environment, p50/p95/p99, error rate, pool and the raw scrape. Prometheus + Grafana + alerts ship in `deploy/monitoring/`. |

## Stack

* **Backend** — FastAPI 0.104, SQLAlchemy 2 (async, asyncpg), PostgreSQL 16, Alembic, JWT access + refresh tokens (python-jose) + bcrypt, Redis (rate limiter, login lockout, WebSocket fan-out) with an in-process fallback, local or S3-compatible file storage. `backend/`
* **Frontend** — React 18, Vite 5, Tailwind 3, zustand, axios, lucide-react. Dark theme, sidebar: Dashboard · Stock Room · Network · Analytics · Vendor Lists · Groups · Chat · Tools · Events · POS Bridge · Ops. `frontend/`
* **POS extension** — Python daemon + adapters (csv, manual, square, shopify). `pos-extension/`
* **Ops** — `docker-compose.yml` for development, `docker-compose.prod.yml` (Caddy TLS, nginx, 4 API workers, scheduler worker, nightly `pg_dump`, optional POS daemon), a GitHub Actions pipeline in `deploy/github-deploy.yml`, an observability stack in `deploy/monitoring/` (Prometheus scrape of `/metrics`, alert rules, Grafana dashboard) and a load-test harness in `loadtest/`.

## Run it

### Docker (everything)

```bash
cp .env.example .env            # set SECRET_KEY at least
docker compose up --build
# frontend http://localhost:3000 · API http://localhost:8000 · docs http://localhost:8000/docs
```

### Production

```bash
cp .env.example .env            # SECRET_KEY, POSTGRES_PASSWORD, DOMAIN, CORS_ORIGINS, (S3_* optional)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml --profile pos up -d pos-daemon   # optional: push ./pos-data/stock.csv
```

The backend entrypoint runs `alembic upgrade head` before starting; the API runs
with 4 uvicorn workers and `RUN_SCHEDULER=false`, and the single `worker`
service owns the scheduler (POS pulls, hold expiry, nightly score recompute and
event reminders). Caddy terminates TLS for `$DOMAIN`; `db-backup` keeps 14
nightly dumps in the `backups` volume.

`deploy/github-deploy.yml` is a ready CI/CD pipeline (backend pytest with
migrations applied, checked and rolled back on the Postgres service; a
load-test smoke run against a booted API; frontend tests + build; image build
to GHCR; SSH deploy). Copy it to `.github/workflows/deploy.yml` in a commit
made with your own credentials — the bot that opened this branch is not allowed
to write under `.github/workflows/`.

### Monitoring

`GET /api/metrics` is a Prometheus scrape target served from the API's own
in-process registry (per-route counters and latency histogram, in-flight and
5xx counters) — no exporter sidecar. Point a scraper at it, or bring up the
bundled stack:

```bash
docker compose -f docker-compose.prod.yml -f deploy/monitoring/docker-compose.observability.yml up -d
# Prometheus :9090 (alert rules for down / p95 / 5xx / 429 storms)
# Grafana    :3001 (the "Brief_ API" dashboard is provisioned)
```

`/ops` in the UI reads the same registry: version and environment, p50/p95/p99,
error rate, DB pool, rate-limit budget and the busiest/slowest routes.

### Load testing

```bash
python loadtest/brief_load.py --smoke                    # CI: 2 vendors, 40 requests, SLO gate
python loadtest/brief_load.py --vendors 25 --duration 60 --p95 800 --error-rate 2
k6 run loadtest/k6-brief.js                              # same scenario, k6 reporting
```

Both harnesses drive the read paths a vendor actually uses and exit non-zero
when p95 or the error rate misses the budget. See `loadtest/README.md`.

### Local, no Docker

The backend can bring its own PostgreSQL (via `pgserver`) so you need nothing installed but Python and Node.

```bash
# API
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python dev_local.py             # embedded Postgres in ./.pgdata, API on :8000
# …or against your own Postgres:
#   export DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/brief_vendors
#   alembic upgrade head && uvicorn app.main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                     # http://localhost:3000, proxies /api (+ WebSocket) to :8000
```

`npm run build` produces `frontend/dist/`; when it exists the API serves it at
`/`, which is what the single-container `Dockerfile` / `railway.json` deploy does.

### Demo data

```bash
cd backend && python seed_demo.py            # BASE_URL=https://… for a remote API
```

Seeds four vendors through the public API (idempotent) and exercises the whole
v2.1 loop — verification, a deal, a collective buy, a shipment, an event
check-in. Password for all four is `Brief-demo-2026`, email
`{handle}@brief-demo.co.ke`:

| handle | role | what they have |
|---|---|---|
| `@mama_mboga` | patron · selling | fresh produce, the *Nairobi Fresh Produce Vendors* list, the *Wakulima Sourcing Collective* group with a tomato collective, a farm-gate Saturday event, a CSV POS connection |
| `@kibanda_kitchen` | sourcing | a small eatery buying from the network, an open deal room |
| `@gikomba_textiles` | both | second-hand textiles (one patron-verified line), runs *Eastlands Traders* and a niche topic |
| `@boda_express` | courier | registered courier with one delivered, rated shipment |

### Tests

```bash
cd backend && pytest            # boots an embedded Postgres, walks the whole vendor loop (incl. v2.1, v2.2, v2.5 payment/chama and v2.6 halal flows)
cd frontend && npm test         # renders every page against a fake API (37 specs)
cd backend && alembic upgrade head && alembic check && alembic downgrade base   # migrations replay cleanly
```

## API in one screen

All routes are under `/api` and, apart from `auth/*` and `health`, require
`Authorization: Bearer <token>`. A middleware refuses anything else with
*"Not authenticated. All users must be vendors."*

```
POST /auth/register  /auth/login (form: username = email or @handle)  /auth/refresh  /auth/change-password
GET  /vendors/me  /vendors/network  /vendors/connections  /vendors/suggested  /vendors/graph  /vendors/{handle}  /vendors/{handle}/performance
POST /vendors/switch-role/{role}  /vendors/connect/{id}  /vendors/become-patron          GET /vendors/me/patron
POST /stock/add  /stock/bulk-import(csv)   GET /stock/my-stock  /stock/network-stock  /stock/movements  /stock/{id}/alternatives
POST /stock/{id}/source  /stock/{id}/verify (multipart)  /stock/{id}/patron-verify   POST /stock/movements/{id}/{confirm|ship|receive|cancel}
POST /vendor-lists/create  /{id}/register  /{id}/approve/{vendor}  GET /vendor-lists/browse  /mine  /{id}/members
POST /groups/create  /{id}/join  /{id}/create-vendor-list           GET /groups/browse  /mine  /{id}  /{id}/members
POST /collective/create  /{id}/pledge  /{id}/withdraw  /{id}/status   GET /collective?group_id=  /collective/{id}
POST /chat/niche-topic  /chat/direct/{vendor}  /chat/deal/{stock}  /chat/{room}/message
GET  /locks/me  /locks/zones  POST /locks/me/zone  POST /locks/windows/{id}/picks
GET  /locks/ops/board   POST /locks/ops/{zones|products|offers|windows}  POST /locks/ops/clusters/{id}/quotes
POST /chat/{room}/voice (multipart audio + duration_seconds; max 15s / 512 KiB)
GET  /chat/{room}/voice/{message} (authenticated room member only)
POST /chat/{room}/deals/{message}/{accept|counter|decline}
GET  /chat/rooms  /chat/{room}/messages       WS /chat/{room}/ws?token=<jwt>   (frames: hello · message · message_update)
POST /tools/list  /tools/courier/register  /tools/{id}/book-warehouse   GET /tools/browse  /mine  /couriers
POST /tools/couriers/{courier}/shipments  /tools/shipments/{id}/status  /tools/shipments/{id}/rate   GET /tools/shipments?role=  /tools/shipments/track/{tn}
POST /events/create  /{id}/register  /{id}/status  /{id}/check-in  /{id}/check-in/{vendor}   GET /events/browse  /mine  /{id}/registrations  /{id}/analytics
GET  /notifications?unread_only=  /notifications/unread-count     POST /notifications/read-all  /notifications/{id}/read
POST /files/upload (multipart)   GET /files/limits
POST /pos/connect  /pos/{id}/sync  /pos/{id}/push  /pos/{id}/push-csv  GET /pos/connections  /pos/sync-logs/{id}
# v2.2
GET  /analytics/overview  /trend  /counterparties  /categories  /price-position  /network  /counterparty/{handle}  /weights
GET  /vendors/discover  /vendors/discover/weights
GET  /vendor-lists/{id}/reviews  /{id}/reviews/mine  /{id}/rating      POST /{id}/reviews  /{id}/reviews/{review_id}/helpful   PUT|DELETE /{id}/reviews/mine
POST /tools/{id}/book  /tools/{id}/book-warehouse (legacy alias)  /tools/bookings/{id}/status?status=   GET /tools/{id}/availability-calendar  /tools/bookings?role=
POST /tools/couriers/{courier}/routes  /{courier}/routes/from-shipments   GET /tools/routes?role=  /tools/routes/{id}
POST /tools/routes/{id}/status?status=  /tools/routes/{id}/stops/{stop_id}/solve       GET /metrics  /ops/status  /ops/slow
# v2.7 — the marketplace map (see "The map" below)
GET  /map/config  /map/counts           GET /map/viewport?bbox=minLng,minLat,maxLng,maxLat&zoom=&kind=&q=&filter=&scope=
GET  /map/places/{id}  /map/vendors/{id}  /map/markets/{id}      (lazy detail, on tap)
# retired: GET /api/surface/map — the whole-directory dump that hung the phone
```

Auth returns an `access_token` (24 h) and a `refresh_token` (30 d); the frontend
refreshes transparently on a 401. Passwords need 8+ characters, an uppercase
letter and a digit. Five failed logins for one account or from one client lock
it out for `LOGIN_LOCKOUT_MINUTES`; `RATE_LIMIT_AUTH` / `RATE_LIMIT_API`
requests per minute apply on top.

Interactive docs at `/docs`.

## The map

The map is a **market discovery surface**, not a map with businesses pinned to
it. Its first version selected every public place (7,640 rows), shipped them to
the phone and built a Leaflet marker per row — which is why it froze on mobile.
The fix is architectural, not a tuning flag:

```
map viewport ──▶ GET /api/map/viewport?bbox=…&zoom=…&kind=…&filter=…
                        │  indexed bbox range scan (public_places (lat, lng))
                        ▼
                 clusters below the threshold zoom · ≤300 pins above it
                        │  ETag / 304 / Cache-Control · 60 s server cache
                        ▼
                 ~20–200 objects on the phone, drawn on one <canvas>
```

| zoom | what you see |
|---|---|
| 2–7 | region clusters — *"7.6K places" · "25 markets"* |
| 8–11 | city and market clusters — *Nairobi 1,240 · Kampala 840* |
| 12–14 | individual markets and vendors |
| 15+ | individual businesses, with details on tap |

* **Clustering happens in Postgres** (`GROUP BY floor(lat/cell)` over the
  bbox-limited rows), so the database never hands the app 7,640 rows and the app
  never hands the phone more than a few hundred objects.
* **Counters are filters.** `Markets 25 · Vendors 0 · Places 7.6K` load one
  dataset each — never all three at once.
* **Details are lazy.** Tapping a pin fetches one place (phone, hours, source,
  freshness); a bottom sheet shows it. Nothing fetches images.
* **Pins are canvas, not DOM.** `preferCanvas` plus `circleMarker` keeps a few
  hundred pins at one element; tiles use `updateWhenIdle` and
  `detectRetina: false` so a pan does not request a screenful of 2× PNGs.
* **Indexes are part of the schema** (alembic `0011`): composite `(lat, lng)`
  btrees make a bounding box two range scans. `EXPLAIN` on the seeded 7,640-row
  table: *Bitmap Index Scan on ix_public_places_mappable_lat_lng, 0.8 ms.*

Run it against real volume:

```bash
python backend/seed_demo.py            # vendors, stock, movements
python backend/seed_map_demo.py        # 7,640 places around 25 real markets
# then: /map shows the directory at production scale
```

### Tiles: MapTiler by default, everything else one setting away

The public OpenStreetMap tile server is community-funded, rate-limited, and its
tile usage policy forbids bulk downloading and heavy use — so it is the
**development** default only, and `/api/ops/status` keeps reporting
`tile_dev_only: true` / `tile_warning` until it is replaced.

**Production default: MapTiler** — OSM-derived (so the basemap and the directory
share the ODbL credit), raster tiles that drop straight into Leaflet, keyed with
a free tier and a global CDN, and a self-host migration that is a URL change
(OpenMapTiles + `tileserver-gl`) once volume makes hosting cheaper than paying
per 1,000 tiles.

```bash
MAP_TILE_PROVIDER=auto     # maptiler when MAP_TILE_KEY is set, else osm (dev)
MAP_TILE_KEY=…             # fills {key} in the provider template
# or: MAP_TILE_PROVIDER=stadia|thunderforest|custom   MAP_TILE_URL=https://tiles.you/{z}/{x}/{y}.png
```

The provider is resolved server-side and served to the client by
`GET /api/map/config` with the attribution its licence requires, so the phone
never hardcodes a tile URL and the ODbL credit cannot drift. A keyed provider
with no key falls back to the dev tiles and says so (`key_missing`, `warning`)
rather than handing the client a URL that can only 401.

Offline note: the app caches the last screenful of *its own* data for a dead
connection, and never caches or pre-fetches tiles — bulk-downloading the public
OSM tile servers is exactly what their policy prohibits. Offline **maps** need a
licensed provider. Full rationale, measurements and the PostGIS upgrade path:
[`docs/briefs/map-performance.md`](docs/briefs/map-performance.md).

## Configuration

See `.env.example`. `DATABASE_URL` accepts `postgres://`, `postgresql://` or
`postgresql+asyncpg://`; Alembic derives the sync URL, and a TLS option may be
written `?sslmode=require` or `?ssl=require` (each driver gets its own spelling).
The container entrypoint waits `DB_WAIT_TIMEOUT` seconds (60) for Postgres before
it migrates and serves — see Troubleshooting if it gives up. `CORS_ORIGINS` and
`ALLOWED_POS_SYSTEMS` are comma-separated. `REDIS_URL` empty → in-memory rate
limiter, login guard and single-process WebSocket fan-out (fine for one
worker). `S3_BUCKET` empty → uploads land in `UPLOAD_DIR` and are served at
`/static`; set it (plus `S3_ENDPOINT` for R2 / MinIO / Spaces) to use a bucket.
`RUN_SCHEDULER=false` on the API when you run `python -m app.worker`
separately. Chat voice notes are capped by `VOICE_MAX_SECONDS` (15) and
`VOICE_MAX_BYTES` (512 KiB); local files use `VOICE_UPLOAD_DIR`, separate from
public `/static`. S3 voice objects omit public ACLs and are streamed only to
room members, so configure the bucket itself as private. Voice notes are not
transcribed in this release. Daily Flash staff access is allow-listed with
`MARKET_OPS_ROLES=admin:handle,clerk:handle,spotter:handle,negotiator:handle`;
set real, registered vendor handles to expose the staff desk. Supplier MOQs are
entered from human-verified price sheets. Lock quotes do not move money; PSP,
deposits, escrow and supplier settlement are deliberately not implemented.
`AUTO_CREATE_TABLES=false` in production — migrations own the schema
(`alembic upgrade head`; `0002_v21_upgrade` carries the v2.1 features,
`0003_v22_marketplace` the reviews, bookings and route-plan tables, and `0004_market_locks` the Daily Flash schema).
`METRICS_ENABLED=false` removes the timing middleware entirely; `METRICS_TOKEN`
gates `/api/metrics` behind `?token=` or a bearer token;
`SLOW_REQUEST_MS` (1000) is the threshold `/ops/slow` lists against;
`BOOKING_MAX_DAYS` (365) caps one booking window and
`ROUTE_DEFAULT_SPEED_KMH` (25) seeds the route ETA.

## Troubleshooting

### `database never became reachable`

`backend/entrypoint.sh` waits up to `DB_WAIT_TIMEOUT` seconds (default 60) for
Postgres, then exits 1. That message is only the verdict — the lines around it name
the target, say which setting supplied the URL, quote the driver's own error and
suggest a fix (abridged):

```
[wait-for-db] waiting up to 60s for brief@db:5432/brief_vendors (from the built-in default — DATABASE_URL is not set)
[wait-for-db] not ready: could not translate host name "db" to address: Name or service not known
[wait-for-db] database never became reachable: brief@db:5432/brief_vendors (from …) — gave up after 60s and 61 attempts
[wait-for-db] hint: DATABASE_URL is not set, so the built-in default was used and its host "db" only exists inside docker compose. …
```

| last error | usual cause | fix |
|---|---|---|
| `could not translate host name "db"` (source: *built-in default*) | `DATABASE_URL` is not set. The default host `db` exists only inside docker compose. | Set `DATABASE_URL` on the service. **Railway:** add a Postgres service, then on the app service set `DATABASE_URL=${{Postgres.DATABASE_URL}}` and deploy — variable changes are staged until you do. |
| `Connection refused` | Nothing listens on that host:port — often `localhost` copied from `.env.example`; inside a container that is the container itself. | Use the database's service or host name; check it is running. |
| `password authentication failed` | Wrong credentials, or `POSTGRES_PASSWORD` was changed after the data volume was created (the image reads it only on first init). | Fix the URL, or reset the volume (`docker compose down -v`, **deletes data**) / `ALTER USER`. |
| `database "x" does not exist` | The URL names a database the server lacks. | Create it or fix the last path segment. |
| `server does not support SSL` · `pg_hba.conf` | TLS mismatch, or the host's allow-list excludes this machine. | `?sslmode=require` if the server demands TLS, `?sslmode=disable` if it has none; allow this host. |
| `timeout expired` · `Network is unreachable` | Firewall / IP allow-list, wrong host or port, private network not up yet. | Check reachability from the same network; raise `DB_WAIT_TIMEOUT` for slow starters. |
| `DATABASE_URL has a second "@"` | An unencoded `@` in the password. | Write it as `%40` (other reserved characters: `%3A` `%2F` `%3F` `%23` `%25`). |
| `DATABASE_URL is empty` · `not a valid database URL` | The variable is empty, or a `${{…}}` placeholder was not resolved by the platform. | Check the variable and the referenced service's name. |

The last two rows fail at once (waiting cannot fix them); everything else is retried
for the full budget. To re-check a running container without restarting it:

```bash
docker compose exec backend python -m app.wait_for_db --timeout 5
```

## Repository layout

```
backend/     app/{models,services,routes,middleware,worker.py,wait_for_db.py}, alembic/versions/{0001_initial…0011_map_viewport_indexes}.py,
             tests/, dev_local.py, seed_demo.py, seed_map_demo.py, entrypoint.sh
             models: bookings.py (tool bookings) · reviews.py (list reviews) · routing.py (route plans & stops)
                    payments.py (intents, custody ledger, payouts, reconciliation, dispute holds) · chamas.py (groups, pool, loans, dividends)
                    halal.py (murabaha contracts)
             services: psp_client.py (provider + mock) · payments.py · custody.py · chamas.py · lock_settlement.py · halal.py · biashara.py
             routes: analytics.py · reviews.py · bookings.py · route_planner.py · ops.py · payments.py · chamas.py · murabaha.py · map.py
             services: map_viewport.py (bbox queries, grid clustering, viewport cache) · map_indexes.py (the bbox DDL)
frontend/    src/{config,lib,stores,components/{layout,ui,vendor,stock,chat,groups,tools,lists,notifications,forms,map},pages/*,test}
             pages/analytics/ (trade dashboard) · pages/ops/ (monitoring console)
             components/map/{MarketMap,MapSheet}.jsx · lib/{mapViewport,useMapViewport}.js (viewport maths, debounce, cancel)
             components/tools/{RoutePlanner,BookingPanel}.jsx · components/lists/ReviewPanel.jsx
pos-extension/  sync_daemon.py, adapters/, Dockerfile
deploy/      github-deploy.yml (copy to .github/workflows/) · monitoring/ (Prometheus, alerts, Grafana)
loadtest/    brief_load.py (repo-only harness, CI gate) · k6-brief.js · README.md
docker-compose.yml  docker-compose.prod.yml  Dockerfile  railway.json  .env.example
```

## What v2.2 added

Every item below is implemented end to end — model, migration, route, service,
UI and tests — not just named:

| # | feature | where |
|---|---|---|
| 1 | **Trade analytics dashboard** | `pages/analytics/Analytics.jsx`, `routes/analytics.py`, `services/analytics_service.py`, `GET /api/analytics/*` |
| 2 | **Vendor-list reviews** | `components/lists/ReviewPanel.jsx`, `routes/reviews.py`, `models/reviews.py`, `GET|POST /api/vendor-lists/{id}/reviews` |
| 3 | **Discovery / recommendation algorithm** | Network → Suggested, `services/discovery.py`, `routes/vendors.py`, `GET /api/vendors/discover(+weights)` |
| 4 | **Courier route optimisation** | `components/tools/RoutePlanner.jsx`, `services/routing.py`, `routes/route_planner.py`, `POST /api/tools/couriers/{id}/routes` |
| 5 | **Warehouse calendar / pop-up / hotel flows** | `components/tools/BookingPanel.jsx`, `services/booking_service.py`, `routes/bookings.py`, `POST /api/tools/{id}/book` + `/availability-calendar` |
| 6 | **Monitoring & load-test harnesses** | `middleware/metrics.py`, `routes/ops.py`, `pages/ops/Ops.jsx`, `deploy/monitoring/`, `loadtest/` |

## What v2.5 added (payments & digital chamas — backend)

The PSP payment stack and digital chama flows, implemented end to end in the
backend (models, migration `0006_payments_chamas.py`, services, routes,
worker jobs and 15 E2E tests). The corresponding member/admin UIs ship in
Layer 3 of the roadmap; the briefs are saved under `docs/briefs/`.

| # | feature | where |
|---|---|---|
| 1 | **PSP provider abstraction** (collections, payouts, balance, sub-accounts; HMAC webhook client + in-process **mock** with fail-mode and real-log **replay**) | `services/psp_client.py` |
| 2 | **Payment intents + append-only custody ledger** (DB trigger blocks UPDATE/DELETE; corrections are reversal rows) | `models/payments.py`, `services/payments.py` |
| 3 | **Webhook sink** — the only place money is booked; HMAC-verified, idempotent, safe-duplicate/stale handling, retry-safe | `POST /api/payments/webhook` (`routes/payments.py`) |
| 4 | **Payouts with dual approval + in-flight freeze** (pending payouts can never be double-sent; freeze/unfreeze for disputes) | `services/payments.py`, `GET /api/payments/payouts/in-flight` |
| 5 | **Daily reconciliation** (wallet per wallet, variance detection, resolution) | `services/custody.py`, `/api/payments/reconciliation/*` |
| 6 | **Custody desk** (intent/disbursement status, holds, in-flight alerts, pending-approval queue) | `/api/payments/ops/*` |
| 7 | **Digital chamas** (groups, pool, deposits, dual-approved loans + quorum, repayment, dividend payouts, Biashara Score events, overdue-worker flags) | `models/chamas.py`, `services/chamas.py`, `routes/chamas.py` |
| 8 | **Lock settlement flow** (pay selected supplier from pick escrow, fee to platform wallet, dispute freeze/refund with dual approval, settle books + score) | `services/lock_settlement.py`, `routes/locks.py` |

## What v2.6 added (Halal trade — backend)

Halal-compliant money flows from the halal-trade brief
(`docs/briefs/halal-trade-finance.md`): migration `0007_halal_finance.py`,
services, routes and 8 E2E tests. Branding and the after-hours Vibe-Tag pins
stay out of backend scope (Layer 3 / social layer).

| # | feature | where |
|---|---|---|
| 1 | **Vendor `finance_mode`** (`halal_sharia` vendors are blocked from interest chamas and interest loans — Riba gate) | `PUT /api/vendors/me`, `services/chamas.py` |
| 2 | **Halal chama pools** (`qard_hasan` / `musharakah_trade` / `murabaha_credit`): zero-interest loans, flat admin fee netted from the payout, dividend base = fees + remitted profits (never interest) | `chamas.model_type`, `services/chamas.py` (`pool_distributable`) |
| 3 | **Musharakah profit remittance** (real PSP collection into the pool → distributable surplus) | `POST /api/chamas/{id}/profit` |
| 4 | **Murabaha (cost-plus) stock advances** (fixed cost + disclosed margin at signing, staff desk, PSP repayment into `SACCO_ADVANCES`, default worker with grace — no late-payment interest) | `models/halal.py`, `services/halal.py`, `routes/murabaha.py` (`/api/murabaha/*`) |
| 5 | **Pick hedging as Bay' al-Salam** | already satisfied by the v2.5 lock-escrow flow (physical goods, escrow, settle-on-delivery) |

Ops notes: the webhook endpoint is public (PSPs can't authenticate as vendors)
and verifies an `HMAC-SHA256` signature of the raw body against
`PSP_WEBHOOK_SECRET`; unknown or not-yet-applicable events get a **502** so
real PSPs retry. `PSP_PROVIDER=mock` (the default) keeps the whole stack
self-contained in dev and tests. Architecture and invariants:
`docs/briefs/payment-custody-architecture.md`.

## What v2.7 added (the marketplace map)

1. **Viewport loading** — `GET /api/map/viewport?bbox=…&zoom=…` replaces the
   whole-directory dump. The map asks for one screenful at a time.
2. **Server-side clustering** — `GROUP BY floor(lat/cell)` inside the bbox, with
   screen-sized, world-fixed cells. The phone receives aggregates, not rows.
3. **Progressive disclosure** — regions → cities → markets → businesses, each
   layer with its own zoom threshold.
4. **Counters as filters** — Markets / Vendors / Places each load one dataset.
5. **Lazy details** — tapping a pin fetches one place; a bottom sheet shows it.
   No images are fetched on the map at all.
6. **Canvas pins** — `preferCanvas` + `circleMarker`: a few hundred pins cost one
   DOM node, and tiles use `updateWhenIdle` / `keepBuffer: 1` / no retina.
7. **Debounce, cancel, guard** — 250 ms debounce, `AbortController` on the
   previous request, and a request id so a slow response cannot overwrite a newer
   one.
8. **HTTP + server caching** — 60 s process cache, ETag/304 and
   `Cache-Control: private, max-age=30`.
9. **Offline honesty** — the last screenful of our own data is kept for a dead
   connection and labelled; tiles are never cached or bulk-downloaded.
10. **Production-ready tile configuration** — `MAP_TILE_URL` (plus attribution
    and subdomains) served to the client from the server, with the public OSM
    server flagged dev-only in `/api/ops/status` until it is changed.
11. **Spatial indexes** — `0011_map_viewport_indexes`: composite `(lat, lng)`
    btrees on places, vendors and markets, installed by both `init_db()` and
    `alembic upgrade head`. A bbox is now two range scans (0.8 ms on 7,640 rows).
13. **A tile backend that is production-grade** — MapTiler by default
    (`MAP_TILE_PROVIDER=auto` + `MAP_TILE_KEY`), with Stadia, Thunderforest and
    self-hosted presets one setting away, resolved in
    `app/services/tile_providers.py` and served to the client with its
    attribution. The public OSM server stays development-only and keeps warning.
14. **`GET /api/surface/map` retired** — deleted rather than capped, along with
    `surfaceAPI.map`, so the whole-directory dump cannot be reintroduced by
    accident.
12. **Scale you can reproduce** — `backend/seed_map_demo.py` seeds 7,640 places
    around 25 real East-African markets.

Details, measurements and the PostGIS/Vector-tile upgrade paths:
[`docs/briefs/map-performance.md`](docs/briefs/map-performance.md).

## History

This is the second incarnation of the repository. The earlier consumer-facing
app (market / shops / trade doors, townhubs, dukabook) lives in git history at
commit `26ffa9d` and on `main`; `git checkout 26ffa9d -- <path>` recovers any
part of it.

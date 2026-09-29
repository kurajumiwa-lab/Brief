# Brief_ — the vendor network

**No consumers. Only vendors.** *You source today, you sell tomorrow.*

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
| **Chat** | group, vendor-list, deal, direct and open niche-topic rooms. Messages go over HTTP; a receive-only WebSocket broadcasts them (Redis fan-out across workers). Share a stock item straight into a room. |
| **Vendor Tools & couriers** | warehouse, cold storage, transport, courier, pop-up shop, hotel sourcing, equipment, packaging. Courier registration, warehouse booking, and **shipments**: book a courier for a movement, tracking number, forward-only status history, receiver rating. |
| **Events** | market days, sourcing trips, trade fairs — capacity, fee, requirements, optionally scoped to a list or group. Vendors **check in** on the day (or the organiser does it at the door); organisers get fill rate, attendance and category analytics. |
| **Notifications** | Every consequential action (sourcing steps, deals, list/group decisions, collective progress, shipments, reviews, bookings, routes, low stock, verification, promotions) lands in the bell — `GET /notifications`, polled every 30 s by the UI. |
| **POS Bridge** | Square / Shopify pulled on a schedule; CSV / manual / custom API pushed from the shop by `pos-extension/sync_daemon.py` (idempotent, back-off, health file) or a CSV upload. Every sync is logged. |
| **Trade analytics dashboard** | `/analytics` — what you supplied and sourced over 30/90/180/365 days, stacked trend, top counterparties, category mix, **price position** against the network average per category, your share of the network and your parasitism index/live score, plus a per-counterparty drill-down (net position, history, top items). `GET /analytics/*`. |
| **Vendor-list reviews** | Approved members rate a list 1–5 with a title and body; the drawer shows the star distribution, sorts by recent / rating / helpful, and lets each vendor edit or delete their one review. Aggregates (`avg_rating`, `review_count`) are denormalised onto the list for browse and sort, and the patron is notified on every new review. |
| **Discovery / recommendation** | `GET /vendors/discover` ranks vendors you have not connected to yet on six weighted factors — complementarity, reciprocity, trade evidence, proximity, graph distance and reputation — with the weights exposed at `/discover/weights` and a human-readable `reasons` list per candidate (the Network → Suggested tab). |
| **Courier route optimisation** | A courier plans a run from explicit stops or straight from their undelivered shipments; nearest-neighbour + 2-opt ordering, per-leg distance, cumulative km and ETA, and an honest `saved_km` against the booking order. Dispatch notifies the senders whose parcels are on the run; stops are ticked off one by one. |
| **Bookings & calendars** | One dated-hold model for the three tool flows: **warehouse / cold-storage space**, **pop-up shop pitches** (shared spaces) and **hotel sourcing rooms** for travelling vendors. Live day-by-day availability calendar, request → confirm/decline → complete, and cancellation that frees the window. |
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
cd backend && pytest            # boots an embedded Postgres, walks the whole vendor loop (incl. v2.1 and v2.2 flows)
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
```

Auth returns an `access_token` (24 h) and a `refresh_token` (30 d); the frontend
refreshes transparently on a 401. Passwords need 8+ characters, an uppercase
letter and a digit. Five failed logins for one account or from one client lock
it out for `LOGIN_LOCKOUT_MINUTES`; `RATE_LIMIT_AUTH` / `RATE_LIMIT_API`
requests per minute apply on top.

Interactive docs at `/docs`.

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
separately. `AUTO_CREATE_TABLES=false` in production — migrations own the schema
(`alembic upgrade head`; `0002_v21_upgrade` carries the v2.1 features,
`0003_v22_marketplace` the reviews, bookings and route-plan tables).
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
backend/     app/{models,services,routes,middleware,worker.py,wait_for_db.py}, alembic/versions/{0001_initial,0002_v21_upgrade,0003_v22_marketplace}.py,
             tests/, dev_local.py, seed_demo.py, entrypoint.sh
             models: bookings.py (tool bookings) · reviews.py (list reviews) · routing.py (route plans & stops)
             services: analytics_service.py · discovery.py · routing.py · booking_service.py
             routes: analytics.py · reviews.py · bookings.py · route_planner.py · ops.py
frontend/    src/{config,lib,stores,components/{layout,ui,vendor,stock,chat,groups,tools,lists,notifications,forms},pages/*,test}
             pages/analytics/ (trade dashboard) · pages/ops/ (monitoring console)
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

## History

This is the second incarnation of the repository. The earlier consumer-facing
app (market / shops / trade doors, townhubs, dukabook) lives in git history at
commit `26ffa9d` and on `main`; `git checkout 26ffa9d -- <path>` recovers any
part of it.

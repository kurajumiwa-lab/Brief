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
| **Notifications** | Every consequential action (sourcing steps, deals, list/group decisions, collective progress, shipments, low stock, verification, promotions) lands in the bell — `GET /notifications`, polled every 30 s by the UI. |
| **POS Bridge** | Square / Shopify pulled on a schedule; CSV / manual / custom API pushed from the shop by `pos-extension/sync_daemon.py` (idempotent, back-off, health file) or a CSV upload. Every sync is logged. |

## Stack

* **Backend** — FastAPI 0.104, SQLAlchemy 2 (async, asyncpg), PostgreSQL 16, Alembic, JWT access + refresh tokens (python-jose) + bcrypt, Redis (rate limiter, login lockout, WebSocket fan-out) with an in-process fallback, local or S3-compatible file storage. `backend/`
* **Frontend** — React 18, Vite 5, Tailwind 3, zustand, axios, lucide-react. Dark theme, sidebar: Dashboard · Stock Room · Network · Vendor Lists · Groups · Chat · Tools · Events · POS Bridge. `frontend/`
* **POS extension** — Python daemon + adapters (csv, manual, square, shopify). `pos-extension/`
* **Ops** — `docker-compose.yml` for development, `docker-compose.prod.yml` (Caddy TLS, nginx, 4 API workers, scheduler worker, nightly `pg_dump`, optional POS daemon), a GitHub Actions pipeline in `deploy/github-deploy.yml`.

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

`deploy/github-deploy.yml` is a ready CI/CD pipeline (backend pytest + frontend
build, image build to GHCR, SSH deploy). Copy it to
`.github/workflows/deploy.yml` in a commit made with your own credentials — the
bot that opened this branch is not allowed to write under `.github/workflows/`.

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
cd backend && pytest            # boots an embedded Postgres, walks the whole vendor loop (incl. v2.1 flows)
cd frontend && npm test         # renders every page against a fake API (28 specs)
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
```

Auth returns an `access_token` (24 h) and a `refresh_token` (30 d); the frontend
refreshes transparently on a 401. Passwords need 8+ characters, an uppercase
letter and a digit. Five failed logins for one account or from one client lock
it out for `LOGIN_LOCKOUT_MINUTES`; `RATE_LIMIT_AUTH` / `RATE_LIMIT_API`
requests per minute apply on top.

Interactive docs at `/docs`.

## Configuration

See `.env.example`. `DATABASE_URL` accepts `postgres://`, `postgresql://` or
`postgresql+asyncpg://`; Alembic derives the sync URL. `CORS_ORIGINS` and
`ALLOWED_POS_SYSTEMS` are comma-separated. `REDIS_URL` empty → in-memory rate
limiter, login guard and single-process WebSocket fan-out (fine for one
worker). `S3_BUCKET` empty → uploads land in `UPLOAD_DIR` and are served at
`/static`; set it (plus `S3_ENDPOINT` for R2 / MinIO / Spaces) to use a bucket.
`RUN_SCHEDULER=false` on the API when you run `python -m app.worker`
separately. `AUTO_CREATE_TABLES=false` in production — migrations own the schema
(`alembic upgrade head`; `0002_v21_upgrade` adds everything listed above).

## Repository layout

```
backend/     app/{models,services,routes,middleware,worker.py}, alembic/versions/{0001_initial,0002_v21_upgrade}.py,
             tests/, dev_local.py, seed_demo.py, entrypoint.sh
frontend/    src/{config,lib,stores,components/{layout,ui,vendor,stock,chat,groups,tools,notifications,forms},pages/*,test}
pos-extension/  sync_daemon.py, adapters/, Dockerfile
deploy/      github-deploy.yml (copy to .github/workflows/)
docker-compose.yml  docker-compose.prod.yml  Dockerfile  railway.json  .env.example
```

### Not built (named in the v2.1 manifest only)

Trade analytics dashboard, vendor-list reviews, the discovery/recommendation
algorithm, courier route optimisation, warehouse calendar / pop-up / hotel
booking flows, monitoring and load-test harnesses. Each is a manifest line
without a specification; nothing in the code pretends to provide them.

## History

This is the second incarnation of the repository. The earlier consumer-facing
app (market / shops / trade doors, townhubs, dukabook) lives in git history at
commit `26ffa9d` and on `main`; `git checkout 26ffa9d -- <path>` recovers any
part of it.

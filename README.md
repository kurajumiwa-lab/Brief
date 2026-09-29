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
| **Stock Room** | Stock, not listings: `quantity_in_stock`, `quantity_reserved`, `quantity_available`. Manual entry, CSV bulk import, or POS sync. Browse *network stock* (never your own) and `POST /source` it. |
| **Movements** | Every sourcing request is a movement: `pending → confirmed → shipped → received` (or cancelled). Reservation on request, shelves debited/credited on receipt, connection created, scores recomputed. |
| **Parasitism engine** | Scores a vendor *pair* on deals, reciprocity and balance; a vendor's `parasitism_index` is the average of their links. Feeds the dashboard's "strongest links" and the `/graph`. |
| **Patrons & Vendor Lists** | Any vendor can become a patron (starter → established → mogul by track record) and run curated lists with registration, approval, capacity and entry criteria. Groups can create lists without a patron. |
| **Vendor Groups** | niche / regional / trade / sourcing / event / open groups with roles, approval and an auto-created chat room. |
| **Chat** | group, vendor-list, deal (per stock item), direct and open niche-topic rooms. Messages go over HTTP; a receive-only WebSocket broadcasts them. Share a stock item straight into a room. |
| **Vendor Tools** | warehouse, cold storage, transport, courier, pop-up shop, hotel sourcing, equipment, packaging. Courier registration, warehouse booking. |
| **Events** | market days, sourcing trips, trade fairs — capacity, fee, requirements, optionally scoped to a list or group. |
| **POS Bridge** | Square / Shopify pulled on a schedule; CSV / manual / custom API pushed from the shop by `pos-extension/sync_daemon.py` or a CSV upload. Every sync is logged. |

## Stack

* **Backend** — FastAPI 0.104, SQLAlchemy 2 (async, asyncpg), PostgreSQL 16, Alembic, JWT (python-jose) + bcrypt, optional Redis for the shared rate limiter. `backend/`
* **Frontend** — React 18, Vite 5, Tailwind 3, zustand, axios, lucide-react. Dark theme, sidebar: Dashboard · Stock Room · Vendor Lists · Groups · Chat · Tools · Events · POS Bridge. `frontend/`
* **POS extension** — Python daemon + adapters (csv, manual, square, shopify). `pos-extension/`

## Run it

### Docker (everything)

```bash
cp .env.example .env            # set SECRET_KEY at least
docker compose up --build
# frontend http://localhost:3000 · API http://localhost:8000 · docs http://localhost:8000/docs
```

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
npm run dev                     # http://localhost:5173, proxies /api (+ WebSocket) to :8000
```

`npm run build` produces `frontend/dist/`; when it exists the API serves it at
`/`, which is what the single-container `Dockerfile` / `railway.json` deploy does.

### Tests

```bash
cd backend && pytest            # boots an embedded Postgres, walks the whole vendor loop
cd frontend && npm test         # renders every page against a fake API
```

## API in one screen

All routes are under `/api` and, apart from `auth/*` and `health`, require
`Authorization: Bearer <token>`. A middleware refuses anything else with
*"Not authenticated. All users must be vendors."*

```
POST /auth/register  /auth/login (form: username = email or @handle)
GET  /vendors/me  /vendors/network  /vendors/connections  /vendors/suggested  /vendors/graph  /vendors/{handle}
POST /vendors/switch-role/{role}  /vendors/connect/{id}  /vendors/become-patron
POST /stock/add  /stock/bulk-import(csv)   GET /stock/my-stock  /stock/network-stock  /stock/movements
POST /stock/{id}/source   POST /stock/movements/{id}/{confirm|ship|receive|cancel}
POST /vendor-lists/create  /{id}/register  /{id}/approve/{vendor}  GET /vendor-lists/browse  /mine  /{id}/members
POST /groups/create  /{id}/join  /{id}/create-vendor-list           GET /groups/browse  /mine  /{id}  /{id}/members
POST /chat/niche-topic  /chat/direct/{vendor}  /chat/deal/{stock}  /chat/{room}/message
GET  /chat/rooms  /chat/{room}/messages       WS /chat/{room}/ws?token=<jwt>
POST /tools/list  /tools/courier/register  /tools/{id}/book-warehouse   GET /tools/browse  /mine  /couriers
POST /events/create  /{id}/register  /{id}/status                     GET /events/browse  /mine  /{id}/registrations
POST /pos/connect  /pos/{id}/sync  /pos/{id}/push  /pos/{id}/push-csv  GET /pos/connections  /pos/sync-logs/{id}
```

Interactive docs at `/docs`.

## Configuration

See `.env.example`. `DATABASE_URL` accepts `postgres://`, `postgresql://` or
`postgresql+asyncpg://`; Alembic derives the sync URL. `CORS_ORIGINS` and
`ALLOWED_POS_SYSTEMS` are comma-separated. `REDIS_URL` empty → in-memory rate
limiter.

## Repository layout

```
backend/     app/{models,services,routes,middleware}, alembic/, tests/, dev_local.py
frontend/    src/{pages,components,hooks,store,lib}, vite.config.js, nginx.conf
pos-extension/  sync_daemon.py, adapters/
docker-compose.yml  Dockerfile  railway.json  .env.example
```

## History

This is the second incarnation of the repository. The earlier consumer-facing
app (market / shops / trade doors, townhubs, dukabook) lives in git history at
commit `26ffa9d` and on `main`; `git checkout 26ffa9d -- <path>` recovers any
part of it.

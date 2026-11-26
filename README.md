# Brief

**The digital connection layer for everyday trade.** A network for people who
already trade with each other — market traders, kiosk owners, wholesalers,
couriers, hotel suppliers — where every account is a business and the record of
what was bought, sold and delivered is what makes the next trade possible.

This README describes the application as it is built today. It was previously
621 lines announcing a product called "My Shop App", alongside nine root
documents describing a fifth product called "Byway" that no longer exists. Those
are gone.

> **Before you run this:** the production database is 26 migrations behind the
> code. Read [`docs/briefs/production-migrations.md`](docs/briefs/production-migrations.md)
> before deploying anything that touches a feature added after migration `0057`.

---

## What the application is

Five destinations, and everything else is a row inside one of them.

| Tab | Route | What it answers |
|---|---|---|
| **Home** | `/` | What is happening for *me* today |
| **Regions** | `/regions` | What is happening *here* |
| **Create** | `/create` | Publish one thing |
| **Inbox** | `/inbox` | What is waiting on me |
| **You** | `/you` | My page, my rank, my identity |

The full sitemap is `frontend/src/App.jsx` (138 routes). The five destinations
are declared in `frontend/src/config/navigation.js`, which is the single source
of truth for navigation. Old URLs still resolve — a link in a WhatsApp thread
must keep working — but only five are *navigation*.

### The Inbox

One screen. `pages/inbox/InboxPage.jsx`. It used to be four:

| was | now |
|---|---|
| `pages/activity/ActivityPage` | absorbed — its three-number summary, neighbourhood watches and grouped feed live in the Inbox |
| `pages/mail/MailPage` | absorbed — `/mail` renders the Inbox filtered to conversations |
| the notification bell | the same feed, same page |
| `/inbox` | the page itself |

`/activity` and `/mail` are kept as routes so old links work, and both render
the one Inbox. Every notification type the backend can emit maps to a real route
in `frontend/src/config/constants.js`; `tests/notificationRoutes.test.js` fails
the build if one does not.

---

## Repository layout

```
backend/            FastAPI application
  app/routes/       older route modules (43 files)
  app/modules/      newer feature modules (48 packages)
  alembic/versions/ 83 migrations, single head
  tests/            89 test files, 1071 tests
frontend/           React + Vite single-page app
  src/pages/        route-level screens
  src/components/   shared UI
  src/styles/tokens.css   every colour, spacing and shadow
  src/test/         93 test files
docs/briefs/        design and scope notes that are still true
.github/workflows/  CI: tests, build, compile check, migration-head check
```

**The backend has two generations of structure** — `routes/` and `modules/` —
and both are live: `main.py` registers routers from both. New features go in
`modules/`; the older `routes/` modules are not dead, they are just older.

---

## Running it locally

### Everything, with Docker

```bash
docker compose up --build
```

`db` (PostgreSQL 16), `redis`, `backend` on `:8000`, `frontend` on `:3000`.
The backend entrypoint waits for Postgres, applies migrations, then serves.

### Frontend only, against any API

```bash
cd frontend
npm ci
npm run dev          # http://localhost:3000, proxies /api to VITE_API_URL
npm test             # vitest
npm run build        # production bundle
```

`frontend/.env` holds the dev proxy target and contains no secrets.

### Backend only

```bash
cd backend
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

`requirements-dev.txt` includes `pgserver`, which bundles PostgreSQL 16 — the
tests need a real Postgres because they take advisory locks and call
`to_regclass`. SQLite will not work.

Environment variables that matter:

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | required | `postgresql+asyncpg://…` |
| `SECRET_KEY` | required | JWT signing |
| `RUN_MIGRATIONS` | `true` (container) | runs `alembic upgrade head` on boot |
| `RUN_SCHEDULER` | `true` | nightly standing recompute and sweeps |
| `AUTO_CREATE_TABLES` | `false` | dev only; never in production |

### Tests

```bash
cd frontend && npx vitest run
cd backend  && python -m pytest -q     # 1071 tests
```

One backend test, `tests/test_smoke.py::test_full_loop`, fails on a clean
checkout. It is a pre-existing failure and not a signal about your change.

---

## Migrations

```bash
cd backend
alembic current    # what this database has
alembic heads      # must print exactly one: 0083_merit
```

**Migrations are applied by hand.** `RUN_MIGRATIONS` is `false` in production.
Before applying any, read
[`docs/briefs/production-migrations.md`](docs/briefs/production-migrations.md) —
it lists what each unapplied revision enables and the safe order to apply them
(one at a time, never `upgrade head`).

Features whose tables are missing report `503` with the migration named, rather
than crashing. See `backend/app/modules/merit/router.py`.

---

## Deployment

Production is a Vercel project with two services (`vercel.json`): FastAPI at
`backend/app/main.py` for `/api/*` and `/static/*`, and the Vite SPA for
everything else with a history-API rewrite. The database is Supabase PostgreSQL.

Deployment protection (SSO) is enabled on the production aliases, so the running
app is not publicly reachable.

---

## CI

The CI-only workflow is prepared at `docs/ci/ci.yml`, with an identical copy
ready at `.github/workflows/ci.yml`. Installing the latter needs a GitHub
account/token with workflow-file permission; Arena's current GitHub App was
refused that push. See [`docs/ci/README.md`](docs/ci/README.md) for activation
and required status checks. Once installed, on every push and pull request to
`main`:

- **Frontend** — `npm ci`, changed-file lint, tests, production build,
  bundle-size report.
- **Backend** — `compileall`, then the full suite on a bundled PostgreSQL.
- **Migrations** — one Alembic head, migration drill over seeded data, and
  schema parity after `alembic upgrade head`.

The frontend tests include repository-wide invariants that no single component
test could catch:

| test | what it prevents |
|---|---|
| `notificationRoutes.test.js` | a notification type with no destination; a link to a route that does not exist; a duplicate route path |
| `contrast.test.js` | unreadable text — it reads the real tokens and computes WCAG ratios |
| `brand.test.js` | a second product name reaching the interface |

---

## Conventions worth knowing before you change something

- **Colour** lives in `frontend/src/styles/tokens.css` and nowhere else. Adding a
  hex literal to a component is how this product ended up with a magenta banner
  in a green interface.
- **Navigation** lives in `frontend/src/config/navigation.js`. Adding a route
  does not make it a destination.
- **Money**: Brief never holds client funds and never lends. Payments go directly
  between the parties; Brief records that they happened.
- **Discovery position** is capped at 5% of ranking weight, and no feature may
  spend Brief's own capital.
- **Design notes** for anything non-obvious go in `docs/briefs/`, named for the
  decision rather than the sprint.

# Move the whole project to Railway — plan

Status: scope chosen by the owner (whole project). This is a plan only. Nothing in
this document has been run against live. Each step is a phone-browser task
unless marked.

Scope: backend API, background worker, frontend. **The database stays on
Supabase** in every option. Live site stays on Vercel until the cutover step.

## What the repository already has

- `Dockerfile` at the repo root and `backend/Dockerfile` (API), `frontend/Dockerfile` (static site behind nginx).
- `railway.json` at the root: builds the root `Dockerfile`, health check `/api/health`.
- `backend/entrypoint.sh`: waits for Postgres, **runs `alembic upgrade head` on every start unless `RUN_MIGRATIONS=false`**, then starts uvicorn.
- `frontend/nginx.conf`: proxies `/api` to `http://backend:8000`.

## Things that will bite if we skip them

1. **Migrations on every start.** With several API instances, each one runs migrations at boot. Set `RUN_MIGRATIONS=false` on every service, and run migrations once from one place (see step 3).
2. **Service name `backend`.** The frontend's nginx config hard-codes `backend`. On Railway the internal name is the service name, so name the API service `backend`, or make nginx read an environment variable. Decide before step 2.
3. **Background jobs.** `RUN_SCHEDULER=true` must be set on exactly one always-on process: the worker (`python -m app.worker`), not on the API. Never on more than one process.
4. **Connection limit.** Supabase's session pooler has a small connection limit (the cause of the live 500s). Set `DB_POOL_SIZE` and `DB_MAX_OVERFLOW` on every service, and add the totals: (API instances × (pool + overflow)) + (worker × (pool + overflow)) must stay under the Supabase limit with headroom. Start with `DB_POOL_SIZE=2`, `DB_MAX_OVERFLOW=0` per process.
5. **Settings copied by hand.** Every environment variable on Vercel must be copied to Railway. Keep a checklist; do not rely on memory.
6. **Cookies and domain.** Check how the session cookie domain and CORS origins are set before the frontend moves, so logins keep working.
7. **Uploaded media.** Check where uploads are stored today. If they live on Vercel's disk or a service tied to Vercel, they must move first.

## Steps

### Step 1 — Inventory (no change to live)
- List every environment variable on Vercel (names only, never values in chat).
- Note which variables are secrets. Record them in the password manager.
- Confirm where uploaded media is stored.

### Step 2 — Build on Railway, staging only
- Create a Railway project with three services: `backend` (API), `worker`, `frontend`.
- Point each at the matching Dockerfile.
- `backend`: `RUN_MIGRATIONS=false`, `RUN_SCHEDULER=false`, pool settings from item 4.
- `worker`: `RUN_MIGRATIONS=false`, `RUN_SCHEDULER=true`, same database settings.
- `frontend`: nginx must reach `backend` (item 2).
- Check `/api/health` on the Railway URL. Do not move any domain yet.

### Step 3 — Migrations, once
- Run `alembic upgrade head` once from one service, with a note of the start and end time.
- Confirm the head revision matches the repository (currently `0034_offers` after this change).
- Run the schema parity check (`backend/scripts/schema_parity.py`) against the same database.

### Step 4 — Test on the Railway address
- Sign in, open the home feed, open the calendar, post an offer, run a test booking.
- Check the worker logs for scheduled jobs running once, not twice.
- Check there are no `EMAXCONNSESSION` errors in the logs.

### Step 5 — Cutover (the only step that touches the live site)
- Lower the domain's TTL one day before.
- Point the domain at Railway's frontend. Keep Vercel running, untouched, for at least 48 hours.
- **Rollback:** point the domain back to Vercel. Nothing in the database changes during cutover, so rollback is one DNS change.

### Step 6 — Decommission Vercel
- Only after 2 weeks with no rollback. Keep the Vercel project, but remove its deploy hooks so nothing deploys by accident.

## What I cannot check from this sandbox
- Railway and Supabase cannot be reached from here. Steps 2–5 need the owner, or a session with access, to run them.
- Pricing on Railway should be checked on Railway's own pricing page before step 2.

## Decisions still open
- Service name for the API (`backend`, or change nginx to read a variable).
- Who runs the migration in step 3, and when.

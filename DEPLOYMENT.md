# Brief — production deployment & durability

## What runs where

- **Build:** `npm run build:client` (Vite → `preview/dist`), registered in
  `railway.json` as `buildCommand`.
- **Start:** `npm start` → `NODE_ENV=production node server/src/index.js`.
- **Port:** `PORT` supplied by Railway (the code defaults to 8787). Express serves the API and, in
  production, the compiled frontend + SPA fallback (see `DEPLOYMENT-FIX-REPORT.md`).

## Data durability (the one thing to get right)

Brief's store is a synchronous JSON document store (`BRIEF_DATA_DIR/brief.json`,
default `server/data`). It writes atomically and takes snapshots, but **Railway's
container filesystem is ephemeral**: everything under the default path is wiped
on every redeploy. That is why the discovery surface resets to empty after a
fresh deploy.

### Fix: attach a persistent volume

1. In Railway → your service → **Volumes**, add a volume, e.g. named `brief-data`,
   mount path `/data`.
2. Set the environment variable **`BRIEF_DATA_DIR=/data`**.
3. Redeploy. The store (and its `backups/` snapshots) now live on the volume and
   survive redeploys.

### Defense in depth (already in code)

- **Snapshots on a cadence** — `BRIEF_BACKUP_INTERVAL_MS` (default 15 min)
  copies the data file into `backups/`; the newest 14 are kept on the SAME volume. Keep an independent offsite copy.
- **Boot restore** — BEFORE loading the live store, Brief validates the primary and newest populated snapshot; missing/empty/corrupt primaries are restored from a valid backup, then loaded into memory. Corrupt primary files are preserved aside. A corrupt primary without a usable backup refuses startup. A missing **or empty** production primary with no populated backup also refuses startup unless `BRIEF_ALLOW_EMPTY_STORE=1` is set for a confirmed first deployment; remove this override immediately after initialization.
- **Graceful-shutdown backup** — a final snapshot is taken on SIGTERM/SIGINT.
- **Corrupt-file recovery** — an unreadable primary is preserved and replaced only when a validated snapshot exists; otherwise startup fails visibly. Do not delete that copy.

> Note: snapshots alone do NOT survive an ephemeral filesystem. The volume is
> the durability guarantee; snapshots are the crash-recovery guarantee.

## Environment variables

| Var | Purpose | Required |
|---|---|---|
| `PORT` | Listen port (Railway sets it) | yes |
| `BRIEF_DATA_DIR` | Data dir (point at a mounted persistent volume) | required for production startup |
| `BRIEF_ALLOW_EMPTY_STORE` | One-time explicit first-deployment bootstrap if volume has neither primary nor snapshot; remove afterwards | no |
| `RESEND_API_KEY` / `BRIEF_EMAIL_FROM` | Opt-in mailbox sign-in, requiring a verified sender domain and HTTPS origin; no provider means email login is disabled | for email login |
| `BRIEF_CORS_ORIGINS` | Comma-separated allowed cross-origin API consumers (same-origin needs none) | no |
| `BRIEF_PUBLIC_ORIGIN` | Canonical HTTPS origin for share links + Buni callback | for distribution/payments |
| `BRIEF_BACKUP_INTERVAL_MS` | Snapshot cadence (default 900000) | no |
| `BUNI_CONSUMER_KEY` / `BUNI_CONSUMER_SECRET` / `BUNI_WEBHOOK_SECRET` | Buni collection credentials and callback secret; server-side only | for collection |
| `BUNI_ENV` | `uat` (default) or `production` | choose explicitly for payments |
| `BUNI_BASE_URL` | Host confirmed by KCB; UAT has a code default | for production payments |
| `BUNI_ORG_SHORT_CODE` / `BUNI_ORG_PASS_KEY` / `BUNI_TILL_NO` | Account-specific values from KCB; UAT shortcode defaults to 522522 | as required by KCB |
| `SETTLEMENT_RAIL` | Keep `manual`; automated Buni payouts are not implemented | defaults to manual |
| `BRIEF_UPLOAD_DIR` | Uploaded files; defaults to the data directory's `uploads/` | mount persistently |
| `HANDOFF_SECRET` | Signs vault handoff/entry tokens | for Vault |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` | Ingestion connectors | per connector |

## Payment enablement is not a deployment smoke test

The commerce provider registry is **KCB Buni**, not Tuma. The separate Daraja
connector is for Huduma. Configure secrets in Railway's variable manager; do
not commit them or put them in browser-visible `VITE_*` variables.

1. Start in `BUNI_ENV=uat` with KCB-issued sandbox credentials and account values.
2. Set `BRIEF_PUBLIC_ORIGIN` to your reachable HTTPS origin; callbacks use
   `/api/webhooks/buni/:secret`.
3. Inspect `/api/capabilities`, but do not treat `configured: true` as proof that
   a transaction works. The connector reports `documented_not_exercised`.
4. Plan an explicitly approved provider exercise, verifying the intent,
   reference, amount, callback and reconciliation. Deploy/build checks do not
   authorize a real charge.
5. Before production, obtain KCB's confirmed host and account enablement. Set
   `BUNI_ENV=production` and `BUNI_BASE_URL` to that confirmed host.

**Payouts remain manual + finance-confirmed.** Credentials or
`BUNI_ALLOW_UNVERIFIED_TRANSFERS=1` cannot implement a transfer payload. Do not
use that switch. Automated payouts stay outside the active implementation
queue until the verified KCB contract is available.

`npm start` reads the process environment, not `.env` files. Railway supplies
variables directly. For local env-file commands see [README.md](README.md).
The checked-in templates are `.env.example` (deployment) and
`server/.env.example` (local development).

## Release verification

Run `/api/health` and `/api/ready`, verify the served production asset changes,
and verify records and uploads survive a redeploy on the mounted volume.
Do not infer deployment health or provider readiness from a local test pass.
See [the active backlog](docs/ACTIVE-BACKLOG.md) for the pending release gates.

## Demo content

`npm run seed` populates the discovery surface with realistic Nairobi-local demo
content through the real extraction pipeline (marked `seedBatch`, removable with
`npm run seed:clear`). It creates no money records. Seed the deployed instance
via Railway's shell (`npm run seed`) to see the product behave before real
ingestion is connected.

## Safe recovery and identity release gate

1. Stop writers and preserve the primary, uploads and `backups/` offsite before recovery. Never run `seed:clear` or a destructive reset on a live volume.
2. Validate a snapshot offline; restore by restarting the process with the same `BRIEF_DATA_DIR`. The store prepares recovery **before** importing live rows and refuses invalid snapshots. Compare `/api/ready` and representative records before accepting traffic or permitting writes.
3. Perform a disposable-volume drill for missing, empty and corrupt primaries, then a write and restart. On real infrastructure, verify mount persistence and an independent offsite backup; local tests cannot establish those facts.
4. `BRIEF_DEV_AUTH=1` now aborts production startup. Do not use `BRIEF_ALLOW_EMPTY_STORE=1` beyond a confirmed fresh installation. Railway health-checks `/api/ready` (store + reconciliation), not only `/api/health` (liveness).
5. The old member-minted signed `?bt=` links are revoked by code. If the vulnerable flow was exposed, review sessions and incident logs, revoke suspicious sessions, and notify affected users under your incident policy. A new email proof works only after a verified Resend sender, HTTPS `BRIEF_PUBLIC_ORIGIN` and both email variables are configured; test real delivery and inbox placement before enabling it. No real provider transaction or delivery was exercised by the repository tests.

The old `BRIEF_LINK_SECRET` is ignored by authentication; rotating it alone does not revoke already-issued sessions. Public collections require `BRIEF_PUBLIC_ORIGIN` for absolute share links; the production client routes `/collections/:id` to a public read-only page.

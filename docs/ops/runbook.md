# Operations runbook

For whoever is on call for this deployment. Every procedure below is written so
that someone who did not build the system can execute it at 2 a.m.

Status of the procedures in this document, as of 2026-10-25:

| Procedure | Written | Executed here |
|---|---|---|
| Secret generation and rotation | yes | **PASS** (generated, not stored) |
| Restore from backup into an isolated database | yes | **BLOCKED** — no Supabase egress |
| Migration drift check | yes | **PASS** (local Postgres) |
| Dependency-outage drill (database refused) | yes | **PASS** — `503`, `database: false`, `ConnectionRefusedError`, process alive |
| Dependency-outage drill (database accepted, then stalled) | yes | **FAIL** at drill time → fixed (driver timeouts added), re-run pending |
| Dependency-outage drill (PSP) | yes | **PASS** (503 path exercised by tests) |
| Interrupted-transaction drill | yes | **PASS** (webhook replay test) |
| Access review | yes | **NOT RUN** — needs the production dashboards |
| Incident response | yes | **NOT RUN** — no incident yet; the drill is the test |

Nothing in this file has been rehearsed against the production database. Do not
treat the procedure existing as evidence it works.

---

## 1. Secrets

**Generate** (never copy a value out of a chat, a commit or this document):

```bash
openssl rand -hex 32     # SECRET_KEY
openssl rand -hex 32     # PSP_WEBHOOK_SECRET
openssl rand -hex 24     # METRICS_TOKEN
```

Set them in the Vercel dashboard under Production. Never put a real value in
`.env.example`, a test fixture, or a log line. The application refuses to start
with the shipped defaults, so a forgotten secret fails the deploy rather than
quietly signing tokens everyone can forge.

**Rotate `SECRET_KEY`** — this signs every login token:

1. Announce the window; every signed-in user is logged out when it rotates.
2. Set the new value in Production, redeploy.
3. Confirm `/api/health` is 200 and a fresh login works.
4. Expect `401` on old tokens — that is the rotation working, not an outage.

**Rotate `PSP_WEBHOOK_SECRET`** — do this in the PSP dashboard and Vercel in the
same window; while they disagree, live callbacks are rejected `401` and retried
by the provider, which is the safe direction.

## 2. Backups and restore drill

Supabase's backup and PITR entitlement depends on the plan **and** on the project
settings, so confirm it in the dashboard rather than assuming it:

- [ ] Project → Database → Backups: note the retention window and whether PITR is on.
- [ ] Record the plan name and the date checked in the table at the bottom.
- [ ] If retention is shorter than 7 days, stop and fix that before taking payments.

**Restore drill** (the part that turns a backup into recoverability):

```bash
# 1. Create an isolated project or database. Never restore over production.
# 2. Restore the most recent backup into it (dashboard → Restore, or:
pg_restore --clean --no-owner --dbname "$DRILL_DATABASE_URL" "$DUMP_FILE"

# 3. Point a local API at the restored copy and let it read, not write:
DATABASE_URL="$DRILL_DATABASE_URL" ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION=false \
  uvicorn app.main:app --port 8099

# 4. Check the records that matter — schema, ledger immutability, landmarks and
#    orphans, in one read-only pass:
cd backend && DATABASE_URL="$DRILL_DATABASE_URL" python scripts/restore_check.py
#    expected last line:
#    RESTORE CHECK PASSED — schema complete, ledger immutable, no orphans.
#    It exits non-zero when the append-only trigger is missing or an orphan
#    exists, so paste the output into the evidence row instead of describing it.

# 5. Destroy the drill database.
```

Evidence to record: restore start/finish timestamps, the backup timestamp used, and
the check's output verbatim. A restore that "looked fine" is not evidence; the
numbers and the exit code are.

## 3. Schema and migrations

Production never creates tables at boot. `ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION`
defaults to `false` and should stay that way; Alembic owns the schema.

```bash
# Apply, then check that models and migrations agree:
cd backend && alembic upgrade head && alembic check

# Before deploying a migration, take a manual backup (see §2).
# Deploy order: migration first, then application. A migration must be
# backwards compatible with the running code for one release.
```

The one exception: a brand-new production environment with no schema at all.
Set the flag for exactly one boot, then unset it.

**Known drift (2026-10-25):** `alembic check` currently fails on index *names* only
— models use `index=True` (auto-named `ix_<table>_<column>`) while older migrations
used hand-written names. No table or column is missing (verified: 114/114 model
tables present after `upgrade head`). Do **not** use `alembic check` as a pass/fail
gate until that rename migration exists; use the table/column parity check instead:

```bash
# what actually breaks a deploy: a missing table or column (read-only)
cd backend && DATABASE_URL=... python scripts/schema_parity.py
```

## 4. Dependency outage drills

**Database unreachable**

1. Point `DATABASE_URL` at a closed port (or stop the container locally).
2. Expect: `/api/health` returns 503 with `database: false`; authenticated routes
   return 5xx with a generic message, not a stack trace.
3. Confirm the app process stays up and recovers when the database returns,
   without a redeploy.

Two failure shapes, both worth trying, because they behave differently:

- *Refused* (port closed): fails in milliseconds. `/api/health` → `503`,
  `database: false`.
- *Accepted then stalled* (server up, not answering): without driver timeouts
  this hangs until the client disconnects. `app/database.py` now sets
  `connect_args.timeout=10`, `command_timeout=30` and `pool_timeout=10` so a
  dead database becomes a `503`, not a hanging request. This was found by
  running the drill, not by reading the code.

**Payment provider unreachable**

1. Set `PSP_PROVIDER=intasend` with no API key, or block the provider host.
2. Expect: checkout returns **503** with a `reason` and the provider name, not a
   success, not a 500. `/api/ops/status` → `payments.available: false`.
3. The order remains payable; no ledger entry is written.

**Interrupted transaction**

1. Create a payment intent, then kill the request before the webhook arrives.
2. Deliver the webhook twice.
3. Expect: exactly one `completed` transition and exactly one ledger row.
   This is pinned by `tests/test_v25_payments_chamas.py` and should be re-run
   against production-like data after any change to webhook handling.

## 5. Incident response

**Severity**

| Level | Meaning | Response |
|---|---|---|
| SEV-1 | Money moves incorrectly, data loss, or credentials exposed | Freeze payments, rotate secrets, page the operator, notify affected vendors per DPA §43 |
| SEV-2 | Payments unavailable, ledger unreconcilable, auth broken | Stop the deploy, fail checkout closed, fix or roll back within the hour |
| SEV-3 | A feature is degraded, records intact | Fix in the next release |

**First fifteen minutes**

1. Stop the bleeding: if money is involved, set `PSP_PROVIDER=mock` **or** take
   the payment routes out of rotation. Closed is safe; wrong is not.
2. Preserve evidence: do not delete rows, do not "clean up" webhook logs. The
   ledger is append-only — use it.
3. Establish scope from `custody_ledger`, `payment_intents` and
   `reconciliation_runs`; the ledger tells you what actually happened.
4. Write the timeline as you go. Memory is not evidence.

**If a secret is exposed**

Rotate `SECRET_KEY` (logs everyone out) and `PSP_WEBHOOK_SECRET` immediately,
then review `payment_intents` for anything created while the old secret was
valid. Tokens signed with the old key stop working the moment it rotates.

**If payment state disagrees with the PSP**

Run reconciliation (`POST /api/payments/reconciliation/run`), then work the
variance queue. Never edit a ledger row; post a correcting entry through the
existing service so the correction is itself auditable.

## 6. Access review (quarterly)

- [ ] `OPERATOR_HANDLES` — is every handle still someone who should hold
      operator rights? Remove leavers the day they leave; an empty list means
      nobody.
- [ ] PSP dashboard users — who can move money, and does that match the business?
- [ ] Supabase users and roles — who can read production data, and by what path?
- [ ] Vercel project members — who can deploy, and who can read environment
      variables?
- [ ] Remove anything unused. Record the date and the reviewer.

## 7. Mobile and low-bandwidth check

Before calling a release fit for the market, on a physical Android device with
throttled network (Chrome DevTools → Network → Slow 3G is an approximation, not
substitute):

- [ ] Morning Brief: skeleton appears, populated state arrives, refresh failure
      keeps the previous brief and marks it stale.
- [ ] Checkout: pending state is visible within 2 s and the pending copy is
      honest about the wait.
- [ ] Every primary screen has a visible retry after a failed request.
- [ ] No screen depends on colour alone to convey payment status.

---

## Record of checks

| Date | Check | Result | Evidence |
|---|---|---|---|
| 2026-10-25 | `alembic upgrade head` + `downgrade -1` on empty DB | PASS | migration `0023` applied and reversed |
| 2026-10-25 | Table/column parity after `upgrade head` | PASS | 114 model tables, 0 missing tables, 0 missing columns |
| 2026-10-25 | `alembic check` | **FAIL (pre-existing)** | index-name drift only; not caused by `0023` |
| 2026-10-25 | Webhook replay → one ledger row | PASS | `tests/test_v25_payments_chamas.py` |
| 2026-10-25 | PSP unavailable → 503 + reason | PASS | `tests/test_v215_trust_and_brief.py` |
| 2026-10-25 | Ledger rejects UPDATE and DELETE | PASS | trigger raised `custody_ledger is append-only: UPDATE/DELETE` on a real Postgres |
| 2026-10-25 | API with Postgres refusing connections | PASS | `/api/health` → `503`, `database=false`, `ConnectionRefusedError`, process stayed up |
| 2026-10-25 | API with Postgres stopped mid-pool | **FAIL → fixed** | request hung until the client gave up. `engine` now sets `connect_args.timeout=10`, `command_timeout=30`, `pool_timeout=10`. Re-run the stopped-mid-pool case after the next deploy. |
| — | `scripts/restore_check.py` on a healthy copy | **PASS** | schema 114/114, ledger UPDATE refused by `trg_custody_ledger_append_only`, 0 orphans, exit 0 |
| Same check with the trigger dropped | **PASS as a negative test** | `[FAIL] ledger: trigger MISSING`, exit 1 — the check is not vacuous |
| Restore drill against isolated DB | **BLOCKED** | no Supabase egress from the build environment |
| — | Production access review | **NOT RUN** | requires dashboard access |

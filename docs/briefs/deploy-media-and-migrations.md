# Deploying media and migrations

_Two faults, one root cause: the deployment was never told where it was running._

This is the runbook for the afternoon two screenshots arrived from a phone:

1. a stock listing whose photograph was replaced by the designed "WHOLESALE STOCK"
   placeholder, and
2. a shop front that had become a full-page error reading **"The database is
   reachable but its tables do not exist yet"** above **"No vendor answers to
   @ogallo"**.

The vendor existed. Their shelf rendered one tab away. The database was not
empty. What follows is what actually happened, what was changed so it cannot
happen again, and the five-minute fix for a deployment that is in this state now.

---

## 1. What went wrong

### Every photograph was written to a disk the host throws away

`media_store` resolves like this:

```
S3_BUCKET set            → s3
ENVIRONMENT=production   → db        (media_objects, migration 0024)
otherwise                → local     (UPLOAD_DIR)
```

The deployment had no `ENVIRONMENT`. So `is_production` was `False`, so the store
was `local`, and `UPLOAD_DIR` resolved to a directory that does not exist in a
Vercel function's read-only image. `_ensure_writable_dir` did what it was written
to do: it fell back to `/tmp` so the app stayed bootable. The upload succeeded,
`POST /api/files/upload` returned `201` and a `/static/uploads/…` URL, the row
was saved — and the bytes lived in one instance's `/tmp`, which the next request
may not be handled by and which a redeploy certainly does not keep.

`GET /static/<key>` then answered `404`, `<Media>` caught `onError`, and every
card drew its designed placeholder. **Nothing raised, so nothing was logged.**

### The schema was behind the code, and the error said the opposite

The same deployment ran with `AUTO_CREATE_TABLES=true`. At boot that calls
`Base.metadata.create_all`, which:

- creates missing **tables**, and
- **never adds a column to an existing table.**

`alembic upgrade head` was never run, so `alembic_version` was empty and the
database was frozen at whatever the models looked like the first time it booted.
The first query that selected a column added after that point raised
`asyncpg.UndefinedColumnError` — a subclass of `ProgrammingError` — and
`app/main.py` mapped **every** `ProgrammingError` to:

> The database is reachable but its tables do not exist yet.

which is precisely wrong. `VendorProfile.jsx` then used the string returned by
`apiError()` as the page's **title**, and hardcoded "No vendor answers to @handle"
underneath it for good measure. A live business was reported as deleted, and the
one true fact — a request had failed — was the only thing not said.

---

## 2. What changed

### The host is asked where it is running

`settings.is_managed_host` reads the platform's own variables (`VERCEL`,
`K_SERVICE`, `DYNO`, `RENDER`, `FLY_APP_NAME`, `AWS_LAMBDA_FUNCTION_NAME`,
`NETLIFY`, `CF_PAGES`, `RAILWAY_ENVIRONMENT`). When it is true:

| setting | before | now |
|---|---|---|
| `media_store` (`auto`) | `local` — bytes thrown away | `db` — `media_objects` |
| `auto_create_tables` | `true` — hides drift | `false` — never on a deployed host |
| `run_migrations_on_boot` | — | `true` — `alembic upgrade head` |

`ENVIRONMENT` still works and still wins where it is set. It is no longer the
only thing standing between an upload and a `/tmp` directory.

### A local write on a managed host is refused

`storage.upload()` raises `StorageError` instead of writing into a disk it will
lose. The API answers **503** with the instruction:

> This host cannot store uploaded files: its disk is discarded between requests,
> so the photo would disappear. Set `MEDIA_STORE=db` (or `S3_BUCKET` for object
> storage) on the deployment and redeploy.

An upload that fails is a five-minute fix. An upload that succeeds and evaporates
is a mystery blamed on the phone.

### Startup migrates

`app/schema.py` runs `alembic upgrade head` at boot on a managed host, under a
Postgres advisory lock (`pg_advisory_lock`), so it is safe when ten function
instances cold-start at once. It is a no-op once the schema is at head.

It converges on head from **any** starting point, including the one that caused
this:

| starting state | what happens |
|---|---|
| empty database | every revision from `0001` is applied |
| schema at head | nothing (a single version read) |
| **built by `create_all`, no version row** | each revision is applied; one that fails only because its object is already there is **stamped**, not re-run — 29 stamped, `0011` (map indexes) actually applied, in the measured run |
| a revision that genuinely fails | recorded, surfaced by `/api/health`, the app still serves |

The `create_all` case is the important one, because it is the state the deployed
database was in. Verified against a real Postgres, from scratch:

```
create_all done (a dev database, no alembic_version row)
current: null   missing_tables: []   pending: 30
→ ran: true   applied: ["0011_map_viewport_indexes"]   stamped: [29 revisions]
→ current: 0030_market_intake   head: 0030_market_intake   at_head: true
second boot: ran → no-op
```

### `/api/health` reports the schema, not a boolean

It used to answer "tables exist: yes". A database can have every table migration
`0001` created and still be twelve migrations behind, which fails on the first
column it reads and looks like anything but a migration problem.

```jsonc
GET /api/health
{
  "status": "ok",                       // 503 + "degraded" when a table or column is absent
  "database": true,
  "schema": true,
  "media_store": "db",
  "media_durable": true,
  "schema_state": {
    "current": "0030_market_intake",    // what alembic_version says
    "head": "0030_market_intake",       // what this code expects
    "stamped": true,
    "pending": [], "pending_count": 0,
    "at_head": true,
    "missing_tables": [],               // the five tables a broken screen depends on
    "drifted": {}                       // …and the columns they are missing
  }
}
```

When something is absent it names it — `media_objects`, or
`stock_items.brand_line` — and says `create_all` never adds a column.

### A 503 describes what actually failed

`ProgrammingError` is a catch-all. `schema.describe_missing` separates a missing
table, a missing column, a missing function and a permission problem, returns
`code: "schema_out_of_date"`, and the hint points at the migration.

### The page says what broke

`frontend/src/lib/failure.js` classifies every failure into a kind with its own
headline and description. **A 5xx is never described in the server's words** —
`apiError()` keeps a 4xx `detail` (the server explaining a rule to the person
holding the phone) and replaces a 5xx one. The raw text is still available, in a
folded "What the server said" disclosure, because a fault report you can read
aloud is worth ten minutes of guessing.

The shop front now says:

> **The server's database is missing part of its schema**
> This is a deployment fault, not a problem with what you asked for. The operator
> needs to run the database migrations; then retry and this will load.
>
> `▸ What the server said`

and offers **Try again**, which re-runs the request. "No vendor answers to
@handle" is now said only when the API answers **404**, which is the only
response that means it.

Cards also distinguish three states, where before there were two:

| `data-photo` | meaning |
|---|---|
| `present` | a photograph, loaded |
| `missing` | the listing never had one — a design decision |
| `unavailable` | a photo is recorded but its file cannot be fetched — a bug |

### Lost photos can be found

A photograph that was written to `/tmp` is gone. It cannot be recovered; it only
has to be found. `GET /api/files/audit` (authenticated, own records only) returns
every photo the caller's records reference and this deployment cannot serve, by
name:

```jsonc
{ "store": "db", "durable": true, "checked": 12, "external": 1, "missing_count": 2,
  "missing": [
    { "where": "stock",   "id": "…", "label": "Flour, 50kg",  "url": "/static/uploads/…" },
    { "where": "gallery", "id": "…", "label": "Shop gallery", "url": "/static/uploads/…" } ],
  "advice": "Re-upload the photos listed in `missing` — the files are gone, not hidden. …" }
```

It is on **Stock → Why isn't my stock showing? → Step 4 — Confirm your photos
load**, so the seller who noticed a blank card can find the rest without opening
every listing.

---

## 3. Fix a deployment that is in this state now

The code above makes a new deployment self-correcting. A deployment already
serving the broken pages needs its environment set once.

```bash
# 1. What is actually wrong, in the deployment's own words.
curl -s https://<your-app>.vercel.app/api/health | jq
#    → schema_state.missing_tables / .drifted names the absent objects
#    → media_store must be "db" or "s3"; "local" means every photo will 404

# 2. Confirm the page-level fault. A 503 here is a schema problem, not a data one.
curl -s -o /dev/null -w '%{http_code}\n' https://<your-app>.vercel.app/api/vendors/ogallo
```

Then, in **Vercel → Project → Settings → Environment Variables** (Production).
Some of these probably already exist — set the *value*, do not try to create the
name again (see the next section if Vercel answers "already exists"):

| variable | value | why |
|---|---|---|
| `ENVIRONMENT` | `production` | turns on the published-secret guard and the production defaults |
| `MEDIA_STORE` | `db` | bytes go into `media_objects`; survives every redeploy |
| `RUN_MIGRATIONS_ON_BOOT` | `true` | optional — the host now implies it; set it to be explicit |
| `AUTO_CREATE_TABLES` | `false` | `create_all` must not run against a deployed database |
| `SECRET_KEY` | 64 hex chars | **required**: production refuses to start on the shipped default |
| `DATABASE_URL` | Supabase session-pooler URL | percent-encode reserved characters in the password |

Redeploy. The first cold start applies every pending migration under an advisory
lock; `/api/health` should answer `200` with `at_head: true` and
`media_store: "db"`.

Prefer to migrate out-of-band instead (CI, or a one-off from a laptop with the
production `DATABASE_URL`):

```bash
cd backend && alembic upgrade head
```

Either way, **do this before the first photo after the change**: a database
migrated after the first `db`-backend upload still works, but the run order is
easier to reason about when the schema is ahead of the traffic.

### If Vercel says the variable already exists, that is the goal

    A variable with the name `MEDIA_STORE` already exists for the target production

is not an error worth fixing. It means the **name** is registered. What it does
not mean — and what the dashboard will not tell you — is that the value is right,
or that it was picked up by a running process:

- a variable created months ago may hold `MEDIA_STORE=local`, which is the value
  that discarded every upload;
- a variable may hold `ENVIRONMENT=development`, which turns off the guard that
  refuses the shipped `SECRET_KEY` (the app serves perfectly, with a public
  signing key);
- **a new value does nothing until a new deployment is built.** Saving in the
  dashboard is not deploying.

Three ways to change a value, in order of least friction:

1. **Dashboard** — Settings → Environment Variables → edit the existing row →
   Save → **Redeploy** (Deployments → ⋯ → Redeploy, with "use existing build
   cache" unchecked).
2. **REST** — `POST /v10/projects/{id}/env?upsert=true` updates in place instead of
   failing with `403 …already exists`. Without `upsert` it refuses a duplicate,
   which is the message above.
3. **CLI** — `vercel env rm MEDIA_STORE production` then
   `vercel env add MEDIA_STORE production`; there is no `vercel env update`.

### Verify the deployment, not the settings panel

The settings panel says what the project *should* pass to a build. This says what
the running process actually resolved, and whether a photograph comes back:

```bash
cd backend
python scripts/check_deploy.py https://<your-app>.vercel.app \
  --photo /static/uploads/<uuid>/<file>.jpg
```

```
  PASS the database answers
  PASS every table and column this code reads exists
  PASS schema is at 0030_market_intake
  FAIL photos are stored on this host's disk (local) — every upload will 404 after the next request
        → Set MEDIA_STORE=db (or S3_BUCKET for object storage) and redeploy. …
  NOTE ENVIRONMENT is 'development', not 'production'
        → … the startup guard that refuses the shipped SECRET_KEY never runs …
```

Exit code 0 only when nothing is broken, so it also works as a post-deploy gate
in CI. `--json` for machines, `--photo` to prove a specific file still loads.
`/api/health` now reports `environment`, `production` and `managed_host` for
exactly this reason: a variable that exists is a claim, and this is the check.

### Then: re-add the photos that were lost

Files written to a discarded disk are gone. They are not hidden, not orphaned and
not recoverable — the bytes never reached anything durable. Every affected record
still carries its URL, and `/static/<key>` will answer `404` for it for ever.

1. open **Stock → Why isn't my stock showing?**
2. press **Check my photos**
3. re-add the photos it lists (the listing cards fall back to the designed
   placeholder meanwhile, which is why nothing looked broken)

Everything uploaded after the change is in `media_objects` and survives redeploys,
instance recycling and cold starts. Verified: a photograph uploaded by one
process was served, byte for byte, by a second process against the same database
that never saw the upload.

### If you would rather not keep bytes in Postgres

`MEDIA_STORE=db` is fine up to a few thousand photographs — each is capped by
`MAX_UPLOAD_MB` (10 MB) and downscaled before storage. Past that, set
`S3_BUCKET` (plus `S3_ENDPOINT`, `S3_PUBLIC_URL`, `AWS_ACCESS_KEY`,
`AWS_SECRET_KEY`). The public URL shape never changes, the reader checks the disk
first and then the store, and rows already written to `media_objects` keep
working after the switch.

---

## 4. What is covered by tests

| file | what it pins |
|---|---|
| `backend/tests/test_thread_l_boot_media.py` | host detection without `ENVIRONMENT`; `db` store + migrations + no `create_all` on a managed host; refusal to write a doomed upload; head == newest revision; every `CRITICAL_TABLES` entry is a real model; column-vs-table wording; the duplicate/stamp rule; health's schema state, missing table, missing column; the audit endpoint |
| `backend/tests/test_media_static.py` | upload → `/static/<key>` → identical bytes on the `db` backend; disk-then-store reads; key-shape refusals |
| `frontend/src/test/failureHonesty.test.jsx` | 5xx never described in the server's words; only a 404 may say "not found"; the shop front's headline, disclosure and retry; retry withheld for a 404; `data-photo` three states; the audit card |
| `frontend/src/test/media.test.jsx` | URL shapes, including a URL minted while another host was this app |

Measured on this branch: backend **528 passed**, frontend **409 passed / 39
files**, `vite build` clean.

---

## 5. Known limits

- **A lost file cannot be recovered.** Only named, and re-photographed.
- **`media_objects` has no retention job.** Deleting a listing does not delete
  its bytes; `storage.delete()` does, and nothing calls it on cascade.
- **Migrations at boot are not a substitute for reviewing a migration.** An
  instance cold-starting mid-deploy will happily apply one that was written
  against a different branch of the code; the advisory lock orders the runners,
  not the humans.
- **Column drift is only checked on five tables** (`vendors`,
  `vendor_profiles`, `stock_items`, `media_objects`, `market_observations`) —
  the ones whose absence produces a whole broken screen, chosen so the health
  poll stays one query.
- **The audit verifies only this deployment's own keys.** An absolute `https://`
  URL to a third party is counted as `external` and not fetched; a slow CDN and a
  lost file are different problems.

# Production migrations: where production is, and how it got there

**Status: applied. 2026-11-23.**

| | |
|---|---|
| Database | Supabase `Brief2`, project ref `qhdktjcvbyjjsxaxxchr`, eu-west-2, PostgreSQL 17.11 |
| Alembic head in this repository | `0083_merit` |
| `alembic_version` in production | **`0083_merit`** |
| Public tables | **240** |
| Columns | **2,744** |
| Vendors / profiles | 3 / 3 (unchanged) |

## Live deployment (verified 2026-11-23)

`https://brief-production-52d7.up.railway.app` — Railway, `host: railway`,
`environment: production`.

```json
{"status":"ok","database":true,"schema":true,"managed_host":true,"media_store":"db",
 "media_durable":true,
 "schema_state":{"current":"0083_merit","head":"0083_merit","at_head":true,
                 "pending":[],"missing_tables":[],"drifted":{}}}
```

`media_store: "db"` with `media_durable: true` matters more than it looks: the
uploads go to the database, not to a container disk, so a Railway restart does
not discard every photograph. That was the fault documented in `app/schema.py`
under a Vercel deployment writing to `/tmp`.

Merit serves from the migrated schema — `/api/merit/public/{brav,nyabere,wasafi}`
all return **200** with a computed breakdown ("Seed", 0/100, six components with
reasons), not the `503` that names `0083_merit`. An unknown handle returns 404,
so the route distinguishes "no such business" from "not migrated".

## Which database is production

There were two Supabase projects. `Brief` (`hdxhoovnleuepnnulsel`, PG 17.6.1,
created 2026-08-18) held the original six vendors and was at `0057`. It has since
been **deleted**; any call to that ref now returns `Resource has been removed`.

`Brief2` (`qhdktjcvbyjjsxaxxchr`, PG 17.11.0, created 2026-11-06) is the only
live project and is the database Railway serves from. Three vendors live there
(`brav`, `nyabere`, `wasafi`). **Apply migrations here, not to the old ref.**

## How the migration was applied

Not by hand, and not by an agent transcribing SQL. By the mechanism already in
the repository:

- Railway builds the root `Dockerfile` and runs `backend/entrypoint.sh`.
- That script runs `python -m app.wait_for_db`, then `alembic upgrade head`
  unless `RUN_MIGRATIONS=false`, then starts uvicorn.
- A service **restart** therefore applies every pending revision.
- Alembic runs the whole chain in **one transaction** (`env.py` does not set
  `transaction_per_migration`), so the upgrade is all-or-nothing.

This is the same code path as `app/schema.py::upgrade_to_head()`, which is what
Vercel used to run on boot. Both are correct; running both at once is not.

### One migrator only

Two hosts migrating the same database race each other. `entrypoint.sh` calls the
plain `alembic` CLI, which does **not** take the advisory lock that
`app/schema.py` uses. Keep exactly one host able to migrate:

- Railway backend: `RUN_MIGRATIONS` absent or `true` — it owns migration.
- Vercel: `RUN_MIGRATIONS_ON_BOOT=false` — set, so it can never race Railway.

### How it was verified

The upgrade was rehearsed locally against a populated `0057` database before it
ran in production, then production was diffed against that rehearsal:

```sql
SELECT count(*), md5(string_agg(sig, E'\n' ORDER BY sig COLLATE "C"))
FROM (SELECT table_name||'.'||column_name||'|'||data_type||'|'||is_nullable AS sig
      FROM information_schema.columns WHERE table_schema='public') x;
-- rehearsal: 2744, 46c1c820011047669fec757b7a1e1935
-- production: 2744, 46c1c820011047669fec757b7a1e1935
```

Table sets matched exactly (240 = 240, no table in one and not the other), and
the column digest matched byte for byte. That is a stronger check than "the
revision number advanced": it proves the shape of the database, not just its
bookkeeping.

## Corrections to the earlier version of this document

Two pieces of guidance here were wrong, and both were written before the run:

1. **"Apply one revision at a time."** As an operator instruction over a remote
   API this reasoning is sound, but as *the* method it was backwards. Editing 26
   generated SQL files by hand, or pasting ~1,800 lines of SQL into a query
   console in 26 pieces, introduces transcription errors that Alembic cannot
   catch. Alembic's own transaction is the safety mechanism. Use the real tool.
2. **"`RUN_MIGRATIONS_ON_BOOT` is deliberately false and nobody has run the
   migrations by hand since `0057`"** described the old `Brief` project. The live
   host is Railway, whose entrypoint migrates on start.

## If a future migration fails

The entrypoint uses `set -e`, so a failed `alembic upgrade head` stops the
container and the deploy fails visibly — the old version keeps serving. That is
the correct failure mode: no half-migrated service accepting traffic.

To diagnose, read the Railway deploy log for the revision Alembic named, fix
forward with a new revision, and redeploy. Do **not** `alembic stamp` a database
into agreement with the repository; that converts a visible failure into an
unprovable drift.

## What CI can and cannot check

A workflow can assert **exactly one head** — a merge that creates two heads is a
failure waiting to happen and is detectable without a database.

CI cannot tell you whether *production* has been migrated without holding the
production credential, which it must not have. That check is
`SELECT version_num FROM alembic_version` from an operator, or a
`/api/health` read, which reports `schema_state` including `at_head`.

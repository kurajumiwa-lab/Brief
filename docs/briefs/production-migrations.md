# Production migrations: where production actually is, and how to move it

## The discrepancy, stated plainly

| | revision |
|---|---|
| Alembic head in this repository | `0083_merit` |
| `alembic_version` in production (Supabase `Brief`, `hdxhoovnleuepnnulsel`) | `0057_public_page_settings` |
| Unapplied migrations | **26** (`0058` … `0083`) |

This is not a build error and not a broken deploy. It is a deployment in which
`RUN_MIGRATIONS_ON_BOOT` is deliberately `false` and nobody has run the
migrations by hand since `0057`. The code is ahead of the database, so every
feature added after `0057` is present in the bundle and absent from the schema.

**Consequence, stated honestly:** the following are not operational in
production today, regardless of what the interface shows.

| Migration | Feature it enables |
|---|---|
| `0058` receipt rewards | receipts, merchants, merchant-funded offers |
| `0059` trade proofs | two-sided receipt confirmation |
| `0060` merchant claim evidence | claim verification |
| `0061` event payments | declared payment notes |
| `0062` spotted deals | spotted-deal ledger and jury |
| `0063` spotted receipt link | dispute rate limiting |
| `0064` activity expiry | activity expiry |
| `0065` handle redirects | reserved old handles |
| `0066` wfh tasks | work-from-home task board |
| `0067` recurring routines | weekly hustle routines |
| `0068` social trust | social seller verification |
| `0069` corridor price index | the public price index |
| `0070` event cash payment | cash-at-door payments |
| `0071` referral engine | merchant-funded referral campaigns |
| `0072` town commerce | receipt funding, referral exchange, scouts |
| `0073` event vendor desk | vendor tables at events |
| `0074` office saved items | saved items in the office |
| `0075` event pass resale | pass resale |
| `0076` lead ledger | the lead ledger |
| `0077` flash drops | flash drops |
| `0078` street lobbies | street lobbies |
| `0079` street broadcasts | street broadcasts |
| `0080` location hex | hex-binned location |
| `0081` page gallery | the portfolio gallery |
| `0082` open market | the open market |
| `0083` merit | `merit_snapshots`, `trust_endorsements`, `mentorships` |

## The one thing that changed in the code

Merit now **reports** the gap instead of crashing on it. Every `/api/merit/*`
route carries a schema guard: it probes `to_regclass` for its three tables and
returns `503` naming the missing tables and the migration, where it previously
raised `UndefinedTable` and surfaced as a `500`. A 500 says "this is broken"; a
503 says "this has not been switched on". Only one of those is true.

`tests/test_merit.py::test_missing_schema_is_a_503_that_names_the_migration`
holds that behaviour.

## How to apply them — the reliable path

Nothing here was run automatically, and nothing should be. The user applies
migrations by hand; this is the procedure to follow, in order.

**1. Back up first.** Supabase → Database → Backups → take a manual snapshot.
Do not skip this because the migrations look additive; `0063` renames a status
column and `0065` backfills handles.

**2. Check for drift before touching anything.** If a table exists that the
migration also creates, the run stops halfway with a partially applied revision,
which is worse than being behind.

```bash
# from a machine with the production DATABASE_URL exported
cd backend
alembic current          # must print 0057_public_page_settings
alembic heads            # must print 0083_merit (single head)
```

**3. Apply one revision at a time and stop on the first failure.**

```bash
alembic upgrade 0058
alembic upgrade 0059
# … continue, checking each one, rather than `alembic upgrade head`
```

`alembic upgrade head` is the wrong command here. Twenty-six revisions applied
in one transaction means the first failure rolls back everything and leaves you
unable to tell a bad migration from a bad connection. One at a time also gives a
clean stopping point.

**4. Verify each stop point against the running app.**

```bash
curl -s $API/api/merit/public/<any-handle> | head -c 200
# 503 naming 0083 → not applied yet (correct before step 3; a defect after)
# 200             → applied
```

**5. Do not rewrite history.** If a migration fails, fix forward with a new
revision. `alembic stamp` to make `alembic current` agree with a database it
disagrees with is how a real drift becomes an unprovable one.

## What CI can and cannot check

`.github/workflows/ci.yml` runs an "exactly one head" check — a merge that
creates two heads is a failure waiting to happen and is detectable without a
database.

CI cannot tell you whether *production* has been migrated: that requires the
production credential, which CI must not have. Closing this gap is an
operational decision (apply the migrations, or gate the new features off), not
something a workflow can fix.

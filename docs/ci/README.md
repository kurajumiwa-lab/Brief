# CI

`ci.yml` in this directory is the GitHub Actions workflow. It is **not** in
`.github/workflows/` yet, because the App that produced this branch is not
allowed to create workflow files — GitHub rejects the push with
`refusing to allow a GitHub App to create or update workflow .github/workflows/ci.yml without workflows permission`.

## Install it

```bash
mkdir -p .github/workflows
cp docs/ci/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "Install CI workflow"
git push
```

Any account with `workflows` permission on the repository can do this. It is a
copy, not a rewrite — the file is complete and was exercised locally:

| step | verified how |
|---|---|
| `npx vitest run` | 95 files, 686 tests |
| `npx vite build` | 19s, 654.78 kB / 174.55 kB gzip |
| `python -m compileall -q app` | clean |
| `python -m pytest -q` | 1071 passed, 1 skipped (1 pre-existing failure, `test_smoke::test_full_loop`, fails identically with the app/ changes stashed) |
| Alembic single head | `0083_merit`, 83 revisions |
| `scripts/migration_drill.py` | PASS — 74 migrations over seeded data, rows unchanged |
| `scripts/schema_parity.py` | PASS — 234 model tables, 240 live, no missing tables or columns |

## What it checks

- **Frontend** — `npm ci` on the lockfile, tests, production build, bundle-size
  report to the job summary, dist artifact.
- **Backend** — compile check first (cheapest signal for a broken deploy), then
  the suite against a bundled PostgreSQL 16 via `pgserver`, because the tests
  take advisory locks and call `to_regclass`; SQLite cannot run them.
- **Migrations** — three checks, in increasing strength: exactly one Alembic
  head; `scripts/migration_drill.py`, which builds a months-old schema, seeds it
  with rows, then applies every remaining migration and verifies the rows are
  unchanged and readable through the models; and `scripts/schema_parity.py`
  against a database built by a real `alembic upgrade head`.

  The third one is the answer to a real incident. On 2026-11-22 an agent applied
  a migration by hand-writing SQL from memory instead of running Alembic. The
  revision number advanced; the columns were wrong. Parity compares the live
  schema to `Base.metadata`, so that class of mistake fails the build instead of
  reaching production.

ESLint runs and reports but does not block: there are 26 pre-existing errors in
`NoticeBoard.jsx`, `AuthPage.jsx` and `NoticeBoardPage.jsx`. Gating on them today
would block every PR for a condition that predates it. Remove
`continue-on-error: true` once they are cleared.

## What CI cannot do

It cannot tell you whether *production* has been migrated. That needs the
production database credential, which CI must not hold. See
[`../briefs/production-migrations.md`](../briefs/production-migrations.md).

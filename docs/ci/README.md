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
| `npx vitest run` | 94 files, 678 tests |
| `npx vite build` | 19s, 654.78 kB / 174.55 kB gzip |
| `python -m compileall -q app` | clean |
| `python -m pytest -q` | 1070 passed (1 pre-existing failure, `test_smoke::test_full_loop`) |
| Alembic single head | `0083_merit`, 83 revisions |

## What it checks

- **Frontend** — `npm ci` on the lockfile, tests, production build, bundle-size
  report to the job summary, dist artifact.
- **Backend** — compile check first (cheapest signal for a broken deploy), then
  the suite against a bundled PostgreSQL 16 via `pgserver`, because the tests
  take advisory locks and call `to_regclass`; SQLite cannot run them.
- **Migrations** — asserts exactly one Alembic head, which is a failed merge
  waiting to happen and is detectable without a database.

ESLint runs and reports but does not block: there are 26 pre-existing errors in
`NoticeBoard.jsx`, `AuthPage.jsx` and `NoticeBoardPage.jsx`. Gating on them today
would block every PR for a condition that predates it. Remove
`continue-on-error: true` once they are cleared.

## What CI cannot do

It cannot tell you whether *production* has been migrated. That needs the
production database credential, which CI must not hold. See
[`../briefs/production-migrations.md`](../briefs/production-migrations.md).

# CI

The CI-only workflow is ready at `ci.yml` in this directory, with an identical
working-tree copy at `.github/workflows/ci.yml`. It is **not active** until the
latter is pushed by an account or token with workflow-file permission. Arena's
GitHub App token was refused with `refusing to allow a GitHub App to create or
update workflow .github/workflows/ci.yml without workflows permission`, so the
copy must be installed from a permitted account/token. Once installed, it runs
on every push, every pull request to `main`, and on `workflow_dispatch`. Edit
both copies together.

## What it enforces

| job | required check name | gates |
|---|---|---|
| Frontend | `Frontend — tests and build` | `npm ci`, changed-file ESLint, full Vitest suite, production `vite build` |
| Backend | `Backend — compile and tests` | `python -m compileall -q app`, full pytest suite on bundled PostgreSQL |
| Migrations | `Migrations — single head and drill` | exactly one Alembic head, `scripts/migration_drill.py`, `scripts/schema_parity.py` after `alembic upgrade head` |

Once the workflow file is installed, the changed-file lint is blocking, so a
new error cannot hide behind the repository's pre-existing lint backlog. The full `eslint src` run still reports
but does not block: 26 pre-existing errors live in `NoticeBoard.jsx`,
`AuthPage.jsx` and `NoticeBoardPage.jsx`. Remove its `continue-on-error: true`
once those are cleared.

After installation, a repository administrator should require the three checks
in branch protection for `main`. CI existing on a branch is not the same as a
merge gate: without required status checks a reviewer can still merge a red run.
The current Arena token cannot read or write branch protection settings.

## Permissions and safest activation

The workflow's runtime `GITHUB_TOKEN` is least privilege:

```yaml
permissions:
  contents: read
```

It has no `packages: write`, `id-token: write`, deploy secrets, production
environment or SSH. `deploy/github-deploy.yml` is deliberately **not** used as
a CI shortcut: it deploys to production and needs `DEPLOY_*` secrets.

Installing a workflow file is a separate, one-time write that needs more than
the runtime token:

- `contents: write` to push the branch;
- `workflows: write` — classic PAT `workflow` scope, fine-grained PAT
  `Workflows: read and write`, or a GitHub App with `Workflows: write`.
- repository admin or `administration: write` only to set branch protection /
  required checks.

The historical GitHub App on this repository lacked `workflows`, and GitHub
rejected the push with:

```text
refusing to allow a GitHub App to create or update workflow .github/workflows/ci.yml without workflows permission
```

The safe installation is therefore a plain copy from an account/token with
workflow-file permission — not granting deploy secrets or package-write to CI:

```bash
mkdir -p .github/workflows
cp docs/ci/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "Install CI workflow"
git push origin <current-branch>
```

Actions are pinned to resolved commit SHAs rather than mutable major tags. If
`actions/setup-node` or `actions/setup-python` cache access is restricted by an
organisation policy, add only the minimal cache/actions permission needed and
document the exception; do not broaden this workflow to deploy permissions.

## Local verification commands

```bash
cd frontend && npm ci --no-audit --no-fund && npx vitest run && npx vite build
cd backend && python -m compileall -q app && python -m pytest -q
cd backend && python scripts/migration_drill.py
cd backend && python -m alembic upgrade head && python scripts/schema_parity.py
```

The backend suite and migration checks use `pgserver`'s bundled PostgreSQL, so
they need no service container. Migration checks must run against a database
built by `alembic upgrade head`, not `create_all`.

## What CI cannot do

It cannot tell you whether *production* has been migrated. That needs the
production database credential, which CI must not hold. See
[`../briefs/production-migrations.md`](../briefs/production-migrations.md).

## Verification record

These are fresh local equivalents of the workflow's checks on this branch, not
results copied from the older table that this document used to carry:

| check | result |
|---|---|
| `npm ci --no-audit --no-fund` | 485 packages |
| `npx vitest run` | 107 files, 839 tests passed |
| `npx vite build` | 2378 modules, built in 11.00 s; existing >500 kB main-chunk warning |
| `npm run lint:changed origin/main` | 22 changed files, no errors; one pre-existing unused-variable warning in `pages.test.jsx` |
| `python -m compileall -q app` | clean |
| `python -m pytest -q` | 1148 passed, 1 skipped, 76 warnings in 559.27 s |
| Alembic single head | `0083_merit`, 83 revisions |
| `scripts/migration_drill.py` | PASS — 74 migrations over seeded data, rows unchanged |
| `scripts/schema_parity.py` after `alembic upgrade head` | PASS — 234 model tables, 240 live tables, no missing tables or columns |
| workflow YAML | parses; three jobs; runtime `permissions: contents: read` |

The harmless `pgserver` teardown logging error, React Router future-flag
notices, jsdom `scrollTo`/XHR notices and the Vite chunk-size warning do not
fail their checks.

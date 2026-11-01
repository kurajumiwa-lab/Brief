#!/usr/bin/env bash
#
# SET UP EVERY ENVIRONMENT VARIABLE THIS DEPLOYMENT NEEDS, FROM NOTHING.
#
#   cd backend && ./scripts/vercel_env_fresh.sh
#
# Run it after deleting the project's variables, or on a brand-new project. It
# sets exactly the variables the application reads, generates the secrets that
# must not be typed by hand, and refuses to invent the one value it cannot know
# (your database URL).
#
# Re-runnable: `vercel env add` refuses a name that already exists, so each
# variable is removed first. That is safe here — this script owns these names.
#
# Why a script rather than a list to copy:
#   · a variable that *exists* is not a variable that is *right*. `MEDIA_STORE`
#     set to `local` was the value that discarded every photograph; `ENVIRONMENT`
#     set to `development` disarms the guard on the shipped `SECRET_KEY`. The
#     values below are the ones that work, in one place, reviewable.
#   · two of them must be random and long. Typing `change-me-in-production` is
#     how a public signing key reached a deploy.
#
# Requires: the Vercel CLI, signed in, with the project linked (`vercel link`).
#
set -euo pipefail

# ── what is being configured ────────────────────────────────────────────────

TARGET="${VERCEL_ENV_TARGET:-production}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v vercel >/dev/null || die "The Vercel CLI is not installed: npm i -g vercel"

say "Configuring ${TARGET} for: $(vercel project ls 2>/dev/null | head -1 || echo 'linked project')"
note "Target: ${TARGET}. Use VERCEL_ENV_TARGET=preview to repeat for previews."

# ── what we can generate, we generate ───────────────────────────────────────

SECRET_KEY="$(openssl rand -hex 32)"
PSP_WEBHOOK_SECRET="$(openssl rand -hex 32)"

# ── the one value we cannot know ────────────────────────────────────────────
#
# Supabase → Project Settings → Database → Connection string → "Session pooler".
# Not the "Direct connection" (IPv6-only on new projects) and not the transaction
# pooler (port 6543) — the session pooler on 5432 is what a long-lived API
# connection needs, and it is IPv4.

if [ -n "${DATABASE_URL:-}" ]; then
  DB_URL="$DATABASE_URL"
  note "Using DATABASE_URL from your shell."
else
  say "Database URL"
  note "Supabase → Settings → Database → Connection string → Session pooler."
  note "Paste it below. Nothing is echoed, and it is not stored anywhere but Vercel."
  printf '  postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres: '
  read -rs DB_URL
  echo
fi

[ -n "${DB_URL:-}" ] || die "A database URL is required — the API cannot start without one."
case "$DB_URL" in
  postgres://*|postgresql://*|postgresql+asyncpg://*) ;;
  *) die "That does not look like a Postgres URL (expected postgresql://…)." ;;
esac

# The single most common production outage here: a password containing @ : / or #
# pasted unencoded, so the driver reads half a password and half a hostname.
case "$DB_URL" in
  *://*@*@*) warn "This URL contains more than one '@' — the password probably needs percent-encoding (@ → %40, : → %3A, / → %2F, # → %23)." ;;
esac

# A local/development host is almost never what production should point at.
case "$DB_URL" in
  *localhost*|*127.0.0.1*|*@db:*|*:5432/brief_vendors) warn "This looks like a local database, not the production one. Continuing in 5s — Ctrl-C to stop."; sleep 5 ;;
esac

# ── the set ─────────────────────────────────────────────────────────────────
#
# Only what the application reads. Nothing here is guesswork: each line names the
# setting in backend/app/config.py that consumes it, and why the value is that
# value. Anything not listed keeps its default, which is the right default.

set_var() { # name value [sensitive]
  local name="$1" value="$2" sensitive="${3:-}"
  vercel env rm "$name" "$TARGET" --yes >/dev/null 2>&1 || true
  if [ -n "$sensitive" ]; then
    printf '%s' "$value" | vercel env add "$name" "$TARGET" --sensitive >/dev/null
  else
    printf '%s' "$value" | vercel env add "$name" "$TARGET" >/dev/null
  fi
  ok "$name"
}

say "Setting variables"

# ── the four that decide whether this deployment works ──────────────────────
set_var ENVIRONMENT production
#   Two effects: `is_production` becomes true (so the guard below is armed), and
#   `media_store` stops depending on anything else.

set_var MEDIA_STORE db
#   Bytes go into the `media_objects` table (migration 0024) instead of the
#   function's /tmp. This is the whole of "photos survive a redeploy". Switch to
#   `s3` only together with S3_BUCKET.

set_var AUTO_CREATE_TABLES false
#   `create_all` creates missing *tables* and never missing *columns*, so against
#   a live database it disguises drift. Alembic owns the schema.

set_var RUN_MIGRATIONS_ON_BOOT true
#   Applies `alembic upgrade head` at startup under a Postgres advisory lock.
#   Safe when several instances cold-start together; a no-op once at head.

# ── the database and the two secrets ────────────────────────────────────────
set_var DATABASE_URL "$DB_URL" sensitive
#   No default is usable in production: the shipped default points at host `db`.

set_var SECRET_KEY "$SECRET_KEY" sensitive
#   Signs every login token. Production REFUSES TO START on the shipped default —
#   which is the correct behaviour and looks like a blank 500 if you hit it.

set_var PSP_WEBHOOK_SECRET "$PSP_WEBHOOK_SECRET" sensitive
#   Authenticates payment callbacks. Not required while PSP_PROVIDER=mock, and
#   required by the same startup guard the moment it is not.

# ── the rest: set only where the default is wrong for a serverless host ─────

set_var RUN_SCHEDULER false
#   The POS/growth/standing sweeps are asyncio loops in the API process. A Vercel
#   function is frozen between requests, so leaving this on produces work that
#   runs unpredictably — or not at all — while looking configured. Run it in one
#   place instead: `python -m app.worker`.

# ── deliberately NOT set ────────────────────────────────────────────────────
#
#   UPLOAD_DIR / VOICE_UPLOAD_DIR   irrelevant with MEDIA_STORE=db, and the image
#                                   is read-only anyway
#   ALLOW_SCHEMA_AUTOCREATE_IN_PRODUCTION
#                                   only for a first boot on an empty database,
#                                   and never while migrations run at boot
#   CORS_ORIGINS                    the app is same-origin on Vercel (/api is
#                                   rewritten to the backend service)
#   VERCEL / VERCEL_ENV             the platform sets these; do not fake them
#   PSP_PROVIDER / PSP_API_*        stays `mock` — no money moves until a licensed
#                                   PSP has signed off (see the payment brief)
#   TRADE_PAYMENTS_ENABLED          stays false for the same reason
#   FRONTEND_DIST                   two services, not one container

say "Optional, if you have them"
note "OPERATOR_HANDLES=your_handle      opens /api/ops/* — empty means nobody"
note "REDIS_URL=rediss://…             shared rate limits; without it each instance"
note "                                 enforces its own budget"
note "METRICS_TOKEN=…                  gates /api/metrics behind a token"
note "S3_BUCKET=…                      object storage instead of Postgres; then"
note "                                 MEDIA_STORE=s3. Photos already in"
note "                                 media_objects keep working after the switch."

say "Done — now rebuild, then verify"
note "A saved variable does nothing until a new deployment exists:"
note "  vercel --prod          (or Deployments → ⋯ → Redeploy)"
note ""
note "Then check the deployment rather than the settings panel:"
note "  python scripts/check_deploy.py https://<your-app> --photo /static/uploads/<uuid>/<file>"
note ""
note "Expected: every line PASS, and READY. Exit code 0."
note ""
warn "Rotating SECRET_KEY signs everyone out once. Accounts, stock and trades are untouched."

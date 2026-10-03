#!/bin/sh
# Wait for Postgres, apply migrations, serve.
set -e

# Exits non-zero (set -e then stops the container) if Postgres never answers; the log
# says why and what to change. DB_WAIT_TIMEOUT=<seconds> changes the 60 s budget.
python -m app.wait_for_db

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  alembic upgrade head
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*" ${UVICORN_EXTRA:-}

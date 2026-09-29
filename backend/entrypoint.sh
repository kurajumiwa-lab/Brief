#!/bin/sh
# Wait for Postgres, apply migrations, serve.
set -e

python - <<'PY'
import os, sys, time
import psycopg2
from app.config import settings
url = settings.database_url_sync
for attempt in range(60):
    try:
        psycopg2.connect(url).close()
        break
    except Exception as exc:
        if attempt == 0:
            print(f"waiting for database ... ({type(exc).__name__})", file=sys.stderr)
        time.sleep(1)
else:
    print("database never became reachable", file=sys.stderr)
    sys.exit(1)
PY

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  alembic upgrade head
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*" ${UVICORN_EXTRA:-}

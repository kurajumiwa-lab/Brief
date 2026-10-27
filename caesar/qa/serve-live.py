"""Run the Brief API against a throwaway Postgres, for the live pass.

Not part of the app and not imported by it: this is the harness that lets the
Caesar prototype be driven in a browser against real rows. It creates its own
database directory under /tmp, so it can never touch a real deployment's data.

    python caesar/qa/serve-live.py          # → http://0.0.0.0:8000
"""
import os
import subprocess
import sys

TMP = os.environ.get("LIVE_PG_DIR", "/tmp/brief-live-pg")
os.makedirs(TMP, exist_ok=True)

import pgserver  # noqa: E402

server = pgserver.get_server(TMP)
dbname = os.environ.get("LIVE_DB_NAME", "brief_live")
try:
    server.psql(f'CREATE DATABASE "{dbname}";')
except Exception as exc:  # already exists — fine, this is a dev harness
    print(f"[pg] create database skipped: {exc}", flush=True)

os.environ["DATABASE_URL"] = f"postgresql+asyncpg://postgres@/{dbname}?host={TMP}"
os.environ.setdefault("AUTO_CREATE_TABLES", "true")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:1/0")
os.environ.setdefault("SECRET_KEY", "live-preview-secret-not-for-production")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("RUN_SCHEDULER", "false")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

port = os.environ.get("LIVE_PORT", "8000")
print(f"[pg] {dbname} at {TMP}; starting uvicorn on :{port}", flush=True)
sys.exit(
    subprocess.call(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", port],
        cwd=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "backend"),
    )
)
